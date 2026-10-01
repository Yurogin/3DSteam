//! Détection de Steam, lecture des bibliothèques et des manifestes de jeux.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::vdf::{self, Vdf};

/// Chemins locaux (cache de Steam) des visuels d'un jeu. Le front complète avec le CDN si absent.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameArt {
    /// Jaquette verticale 600x900.
    pub capsule: Option<String>,
    /// Grande image de fond (bannière).
    pub hero: Option<String>,
    /// Logo transparent posé sur la bannière.
    pub logo: Option<String>,
    /// En-tête horizontal 460x215.
    pub header: Option<String>,
    /// Icône carrée du jeu (`.ico` du client, jusqu'à 256 px, sinon la petite icône 32 px).
    #[serde(default)]
    pub icon: Option<String>,
    /// Côté en pixels de l'icône ci-dessus, relevé au scan (voir `icons.rs`). Le front s'en sert
    /// pour ne pas étirer une icône trop petite.
    #[serde(default)]
    pub icon_size: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Game {
    pub appid: u32,
    pub name: String,
    pub install_dir: String,
    pub library_path: String,
    pub size_on_disk: u64,
    pub last_played: u64,
    pub last_updated: u64,
    /// Temps de jeu cumulé, en minutes, lu dans `localconfig.vdf`.
    pub playtime: u64,
    pub art: GameArt,
    /// Jeu hors Steam ajouté à la bibliothèque (voir `shortcuts.rs`) : `install_dir` est alors
    /// son dossier, et il n'a ni bibliothèque, ni taille, ni page dans le magasin.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub shortcut: bool,
}

/// Un jeu que le client connaît mais qui n'est pas installé : juste de quoi l'afficher.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogGame {
    pub appid: u32,
    pub name: String,
    pub last_played: u64,
    pub playtime: u64,
}

/// Ce qu'un compte a fait d'une application, d'après `localconfig.vdf`.
#[derive(Debug, Clone, Copy, Default)]
struct Usage {
    last_played: u64,
    /// En minutes.
    playtime: u64,
    /// En minutes, sur les deux dernières semaines.
    playtime_2wks: u64,
}

/// Le temps de jeu d'une application, pour le journal d'activité.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub appid: u32,
    pub last_played: u64,
    /// En minutes.
    pub playtime: u64,
    /// En minutes, sur les deux dernières semaines.
    pub playtime_2wks: u64,
}

/// Tout ce que le compte a lancé, avec son temps de jeu. Relu à chaque appel : le journal
/// d'activité veut des chiffres frais.
pub fn activity(steam_root: &Path) -> Vec<Activity> {
    seen_apps(steam_root)
        .into_iter()
        .filter(|(appid, usage)| usage.playtime > 0 && !HIDDEN_APPIDS.contains(appid))
        .map(|(appid, u)| Activity { appid, last_played: u.last_played, playtime: u.playtime, playtime_2wks: u.playtime_2wks })
        .collect()
}

/// Dossier `userdata/<compte>` du compte actif : ses captures d'écran y sont rangées.
pub fn user_dir(steam_root: &Path) -> Option<PathBuf> {
    active_user_dir(steam_root).or_else(|| newest_user_dir(steam_root))
}

/// Résultat d'un scan : ce qui est installé, et ce que le client connaît en plus.
pub struct Scan {
    pub games: Vec<Game>,
    pub catalog: Vec<CatalogGame>,
}

/// Écart entre un SteamID64 et le numéro de dossier dans `userdata`.
pub(crate) const STEAM_ID_BASE: u64 = 76_561_197_960_265_728;

/// Outils Steam installés comme des « jeux » mais qu'on ne veut pas voir dans la grille.
const HIDDEN_APPIDS: &[u32] = &[228980, 1070560, 1391110, 1628350, 1826330, 2180100];
const HIDDEN_PREFIXES: &[&str] = &[
    "Proton ",
    "Steam Linux Runtime",
    "Steamworks Common",
    "Source SDK Base",
    "SteamVR",
];

/// `StateFlags` : bit 4 = StateFullyInstalled.
const STATE_FULLY_INSTALLED: u64 = 4;

/// Dossier racine de Steam (celui qui contient `steamapps/`).
pub fn find_steam_root() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    #[cfg(windows)]
    {
        use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
        use winreg::RegKey;

        if let Ok(key) = RegKey::predef(HKEY_CURRENT_USER).open_subkey(r"Software\Valve\Steam") {
            if let Ok(path) = key.get_value::<String, _>("SteamPath") {
                candidates.push(PathBuf::from(path.replace('/', "\\")));
            }
        }
        if let Ok(key) =
            RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(r"SOFTWARE\WOW6432Node\Valve\Steam")
        {
            if let Ok(path) = key.get_value::<String, _>("InstallPath") {
                candidates.push(PathBuf::from(path));
            }
        }
        candidates.push(PathBuf::from(r"C:\Program Files (x86)\Steam"));
        candidates.push(PathBuf::from(r"C:\Program Files\Steam"));
    }

    #[cfg(not(windows))]
    {
        if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
            candidates.push(home.join(".steam/steam"));
            candidates.push(home.join(".local/share/Steam"));
            candidates.push(home.join("Library/Application Support/Steam"));
        }
    }

    candidates
        .into_iter()
        .find(|p| p.join("steamapps").is_dir())
}

/// Tous les dossiers `steamapps` connus (bibliothèque principale + disques additionnels).
pub fn library_folders(steam_root: &Path) -> Vec<PathBuf> {
    let mut roots = vec![steam_root.to_path_buf()];

    let vdf_path = steam_root.join("steamapps").join("libraryfolders.vdf");
    match fs::read_to_string(&vdf_path).map(|text| vdf::parse(&text)) {
        Ok(Ok(doc)) => {
            let entries = doc.get("libraryfolders").map(Vdf::entries).unwrap_or_default();
            for (key, value) in entries {
                // Seules les clés numériques sont des bibliothèques ("contentstatsid" etc. ignorées).
                if key.parse::<u32>().is_err() {
                    continue;
                }
                let path = match value {
                    // Format actuel : "0" { "path" "D:\SteamLibrary" ... }
                    Vdf::Obj(_) => value.get_str("path").map(str::to_owned),
                    // Ancien format : "1" "D:\SteamLibrary"
                    Vdf::Str(s) => Some(s.clone()),
                };
                roots.extend(path.map(PathBuf::from));
            }
        }
        Ok(Err(e)) => eprintln!("[3dsteam] libraryfolders.vdf illisible : {e}"),
        Err(_) => {}
    }

    let mut seen = HashSet::new();
    roots
        .into_iter()
        .map(|root| root.join("steamapps"))
        .filter(|steamapps| steamapps.is_dir())
        .filter(|steamapps| seen.insert(steamapps.to_string_lossy().to_lowercase()))
        .collect()
}

fn parse_manifest(path: &Path, library: &Path) -> Option<Game> {
    let text = fs::read_to_string(path).ok()?;
    let doc = vdf::parse(&text).ok()?;
    let app = doc.get("AppState")?;

    let appid: u32 = app.get_str("appid")?.trim().parse().ok()?;
    let name = app.get_str("name").unwrap_or_default().trim().to_owned();
    let flags = app.get_u64("StateFlags").unwrap_or(0);

    if flags & STATE_FULLY_INSTALLED == 0 || name.is_empty() || is_hidden(appid, &name) {
        return None;
    }

    Some(Game {
        appid,
        name,
        install_dir: app.get_str("installdir").unwrap_or_default().to_owned(),
        library_path: library.to_string_lossy().into_owned(),
        size_on_disk: app.get_u64("SizeOnDisk").unwrap_or(0),
        last_played: app.get_u64("LastPlayed").unwrap_or(0),
        last_updated: app.get_u64("lastupdated").unwrap_or(0),
        // Rempli après coup : le temps de jeu vit dans la configuration du compte, pas ici.
        playtime: 0,
        art: GameArt::default(),
        shortcut: false,
    })
}

pub fn is_hidden(appid: u32, name: &str) -> bool {
    HIDDEN_APPIDS.contains(&appid) || HIDDEN_PREFIXES.iter().any(|p| name.starts_with(p))
}

/// Cherche les visuels dans `appcache/librarycache`. Deux dispositions coexistent selon la
/// version du client : `<appid>_header.jpg` (ancien) et `<appid>/[<hash>/]header.jpg` (récent).
fn resolve_art(librarycache: &Path, appid: u32) -> GameArt {
    let mut art = GameArt::default();
    let as_string = |p: PathBuf| Some(p.to_string_lossy().into_owned());

    let app_dir = librarycache.join(appid.to_string());
    if app_dir.is_dir() {
        let mut files: Vec<PathBuf> = Vec::new();
        if let Ok(entries) = fs::read_dir(&app_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    if let Ok(sub) = fs::read_dir(&path) {
                        files.extend(sub.flatten().map(|e| e.path()));
                    }
                } else {
                    files.push(path);
                }
            }
        }
        for file in files {
            let Some(name) = file.file_name().and_then(|n| n.to_str()).map(str::to_owned) else {
                continue;
            };
            match name.as_str() {
                "library_600x900.jpg" | "library_capsule.jpg" if art.capsule.is_none() => {
                    art.capsule = as_string(file)
                }
                "library_hero.jpg" if art.hero.is_none() => art.hero = as_string(file),
                "logo.png" if art.logo.is_none() => art.logo = as_string(file),
                "header.jpg" | "library_header.jpg" if art.header.is_none() => {
                    art.header = as_string(file)
                }
                // Petite icône communautaire, nommée par son empreinte : `<sha1>.jpg`.
                n if art.icon.is_none()
                    && file.parent() == Some(app_dir.as_path())
                    && n.len() == 44
                    && n.ends_with(".jpg")
                    && is_sha1(&n[..40]) =>
                {
                    art.icon = as_string(file)
                }
                _ => {}
            }
        }
    }

    let legacy = |suffix: &str| {
        let p = librarycache.join(format!("{appid}_{suffix}"));
        p.is_file().then(|| p.to_string_lossy().into_owned())
    };
    art.capsule = art.capsule.or_else(|| legacy("library_600x900.jpg"));
    art.hero = art.hero.or_else(|| legacy("library_hero.jpg"));
    art.logo = art.logo.or_else(|| legacy("logo.png"));
    art.header = art.header.or_else(|| legacy("header.jpg"));
    art
}

fn is_sha1(s: &str) -> bool {
    s.len() == 40 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Associe chaque jeu à son icône `.ico` (`<Steam>/steam/games/<sha1>.ico`, celle des raccourcis).
/// L'empreinte vient de `common/clienticon` dans `appinfo.vdf` (voir `appinfo.rs`) ; on ne garde
/// que celles dont le fichier existe vraiment.
fn client_icons(
    steam_root: &Path,
    apps: &HashMap<u32, crate::appinfo::AppInfo>,
    wanted: &HashSet<u32>,
) -> HashMap<u32, PathBuf> {
    let games_dir = steam_root.join("steam").join("games");
    wanted
        .iter()
        .filter_map(|appid| {
            let hash = apps.get(appid)?.client_icon.as_deref()?;
            if !is_sha1(hash) {
                return None;
            }
            let path = games_dir.join(format!("{}.ico", hash.to_ascii_lowercase()));
            path.is_file().then_some((*appid, path))
        })
        .collect()
}

/// Le compte le plus récemment utilisé, d'après `loginusers.vdf` : son SteamID64 et son pseudo.
pub(crate) fn active_user(steam_root: &Path) -> Option<(u64, String)> {
    let text = fs::read_to_string(steam_root.join("config").join("loginusers.vdf")).ok()?;
    let doc = vdf::parse(&text).ok()?;
    // Le tri porte sur le tuple : `MostRecent` d'abord, puis l'horodatage le plus grand.
    let (_, _, id64, persona) = doc
        .get("users")?
        .entries()
        .iter()
        .filter_map(|(id, user)| {
            let id64: u64 = id.trim().parse().ok()?;
            let recent = user.get_str("MostRecent").is_some_and(|v| v == "1");
            let persona = user.get_str("PersonaName").unwrap_or_default().trim().to_owned();
            Some((recent, user.get_u64("Timestamp").unwrap_or(0), id64, persona))
        })
        .max()?;
    Some((id64, persona))
}

/// Pseudo Steam du compte actif : le nom proposé par défaut pour le profil.
pub fn persona_name(steam_root: &Path) -> Option<String> {
    active_user(steam_root).map(|(_, name)| name).filter(|name| !name.is_empty())
}

/// Dossier `userdata` du compte le plus récemment utilisé.
fn active_user_dir(steam_root: &Path) -> Option<PathBuf> {
    let (id64, _) = active_user(steam_root)?;
    let dir = steam_root.join("userdata").join(id64.checked_sub(STEAM_ID_BASE)?.to_string());
    dir.is_dir().then_some(dir)
}

/// Repli : le dossier `userdata` dont la configuration a été écrite le plus récemment.
fn newest_user_dir(steam_root: &Path) -> Option<PathBuf> {
    fs::read_dir(steam_root.join("userdata"))
        .ok()?
        .flatten()
        .filter_map(|entry| {
            let dir = entry.path();
            let time = dir.join("config").join("localconfig.vdf").metadata().ok()?.modified().ok()?;
            Some((time, dir))
        })
        .max_by_key(|(time, _)| *time)
        .map(|(_, dir)| dir)
}

/// Applications que le client a vues pour ce compte, avec leur dernière session.
///
/// `localconfig.vdf` n'est pas une liste de possession : il recense ce qui a été lancé ou
/// configuré. Il inclut donc des démos et des jeux gratuits essayés, et il manque les jeux
/// possédés jamais ouverts. C'est approximatif, mais local, instantané et sans clé d'API.
fn seen_apps(steam_root: &Path) -> HashMap<u32, Usage> {
    let mut out = HashMap::new();
    let Some(dir) = user_dir(steam_root) else {
        return out;
    };
    let Ok(text) = fs::read_to_string(dir.join("config").join("localconfig.vdf")) else {
        return out;
    };
    let Ok(doc) = vdf::parse(&text) else {
        return out;
    };
    let apps = doc
        .get("UserLocalConfigStore")
        .and_then(|v| v.get("Software"))
        .and_then(|v| v.get("Valve"))
        .and_then(|v| v.get("Steam"))
        .and_then(|v| v.get("apps"));
    let Some(apps) = apps else { return out };
    for (id, app) in apps.entries() {
        if let Ok(appid) = id.trim().parse::<u32>() {
            out.insert(
                appid,
                Usage {
                    last_played: app.get_u64("LastPlayed").unwrap_or(0),
                    playtime: app.get_u64("Playtime").unwrap_or(0),
                    playtime_2wks: app.get_u64("Playtime2wks").unwrap_or(0),
                },
            );
        }
    }
    out
}

/// Les jeux connus du client mais absents du disque, triés comme la grille principale.
fn catalog(
    apps: &HashMap<u32, crate::appinfo::AppInfo>,
    seen: &HashMap<u32, Usage>,
    installed: &HashSet<u32>,
) -> Vec<CatalogGame> {
    let mut list: Vec<CatalogGame> = seen
        .iter()
        .filter(|(appid, _)| !installed.contains(appid) && !HIDDEN_APPIDS.contains(appid))
        .filter_map(|(&appid, usage)| {
            let info = apps.get(&appid)?;
            // Uniquement des jeux : ni DLC, ni outils, ni configurations, ni démos.
            if !info.kind.eq_ignore_ascii_case("game") || info.name.is_empty() {
                return None;
            }
            if HIDDEN_PREFIXES.iter().any(|prefix| info.name.starts_with(prefix)) {
                return None;
            }
            Some(CatalogGame {
                appid,
                name: info.name.clone(),
                last_played: usage.last_played,
                playtime: usage.playtime,
            })
        })
        .collect();
    list.sort_by(|a, b| {
        b.last_played
            .cmp(&a.last_played)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    list
}

/// Scan complet : toutes les bibliothèques, tous les `appmanifest_*.acf`.
pub fn scan(steam_root: &Path) -> Scan {
    let librarycache = steam_root.join("appcache").join("librarycache");
    let mut seen = HashSet::new();
    let mut games = Vec::new();

    for steamapps in library_folders(steam_root) {
        let Ok(entries) = fs::read_dir(&steamapps) else {
            continue;
        };
        let library = steamapps.parent().unwrap_or(&steamapps).to_path_buf();
        for entry in entries.flatten() {
            let path = entry.path();
            let is_manifest = path
                .file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with("appmanifest_") && n.ends_with(".acf"));
            if !is_manifest {
                continue;
            }
            if let Some(mut game) = parse_manifest(&path, &library) {
                if seen.insert(game.appid) {
                    game.art = resolve_art(&librarycache, game.appid);
                    games.push(game);
                }
            }
        }
    }

    let appids: HashSet<u32> = games.iter().map(|g| g.appid).collect();
    let apps = crate::appinfo::load(steam_root);
    let icons = client_icons(steam_root, &apps, &appids);
    for game in &mut games {
        if let Some(ico) = icons.get(&game.appid) {
            game.art.icon = Some(ico.to_string_lossy().into_owned());
        }
    }

    // Le temps de jeu n'est pas dans les manifestes : il vit dans la configuration du compte.
    let usage = seen_apps(steam_root);
    for game in &mut games {
        game.playtime = usage.get(&game.appid).map_or(0, |u| u.playtime);
    }
    let catalog = catalog(&apps, &usage, &appids);
    // Les jeux hors Steam ajoutés à la bibliothèque, rangés avec les autres.
    if let Some(user) = user_dir(steam_root) {
        games.extend(crate::shortcuts::games(&user).into_iter().filter(|g| seen.insert(g.appid)));
    }
    games.sort_by(|a, b| {
        b.last_played
            .cmp(&a.last_played)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Scan { games, catalog }
}

/// Bits de `StateFlags` qui signalent une installation ou une mise à jour : requise (2), en file
/// (8), en cours (256), en pause (512), démarrée (1024).
const STATE_UPDATING: u64 = 2 | 8 | 256 | 512 | 1024;
/// Bit de mise en pause.
pub const STATE_PAUSED: u64 = 512;
/// Bit de mise à jour en cours.
pub const STATE_RUNNING: u64 = 256;
/// Bit de mise à jour démarrée (des données ont déjà été reçues).
const STATE_STARTED: u64 = 1024;

/// Une installation annulée laisse son manifeste derrière elle : « mise à jour requise, en
/// pause » (514), jamais démarrée, jeu absent, et plus rien dans `downloading/`. Mesuré sur deux
/// annulations : Steam a bien tout désinstallé, ce n'est plus un téléchargement.
fn cancelled_install(flags: u64, downloading: bool) -> bool {
    flags & STATE_PAUSED != 0 && flags & (STATE_FULLY_INSTALLED | STATE_STARTED | STATE_RUNNING) == 0 && !downloading
}

/// Un téléchargement en attente ou en cours, tel que son manifeste le décrit. Ces compteurs ne
/// sont réécrits par Steam que de loin en loin : `progress.rs` en tire une progression en direct.
#[derive(Debug, Clone)]
pub struct Pending {
    pub appid: u32,
    pub name: String,
    pub flags: u64,
    pub downloaded: u64,
    pub to_download: u64,
    /// Octets décompressés et écrits dans `downloading/`, et leur total.
    pub staged: u64,
    pub to_stage: u64,
}

/// Les téléchargements en attente ou en cours, toutes bibliothèques confondues : quelques petits
/// fichiers à relire, l'interface peut interroger souvent sans coût notable.
pub fn pending(steam_root: &Path) -> Vec<Pending> {
    let mut out = Vec::new();
    for steamapps in library_folders(steam_root) {
        let Ok(entries) = fs::read_dir(&steamapps) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let is_manifest = path
                .file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with("appmanifest_") && n.ends_with(".acf"));
            if !is_manifest {
                continue;
            }
            let Ok(text) = fs::read_to_string(&path) else {
                continue;
            };
            let Ok(doc) = vdf::parse(&text) else {
                continue;
            };
            let Some(app) = doc.get("AppState") else {
                continue;
            };
            let flags = app.get_u64("StateFlags").unwrap_or(0);
            if flags & STATE_UPDATING == 0 {
                continue;
            }
            let Some(appid) = app.get_u64("appid") else {
                continue;
            };
            if cancelled_install(flags, steamapps.join("downloading").join(appid.to_string()).is_dir()) {
                continue;
            }
            out.push(Pending {
                appid: appid as u32,
                name: app.get_str("name").unwrap_or_default().to_owned(),
                flags,
                downloaded: app.get_u64("BytesDownloaded").unwrap_or(0),
                to_download: app.get_u64("BytesToDownload").unwrap_or(0),
                staged: app.get_u64("BytesStaged").unwrap_or(0),
                to_stage: app.get_u64("BytesToStage").unwrap_or(0),
            });
        }
    }
    out
}

/// Ouvre la boîte d'installation de Steam pour ce jeu. Il n'existe pas de moyen de déclencher un
/// téléchargement sans elle : le client détient les licences.
pub fn install(appid: u32) -> Result<(), String> {
    open_uri(&format!("steam://install/{appid}"))
}

/// Ouvre la boîte de désinstallation de Steam : c'est lui qui demande confirmation.
pub fn uninstall(appid: u32) -> Result<(), String> {
    open_uri(&format!("steam://uninstall/{appid}"))
}

/// Un jeu hors Steam se lance par son identifiant 64 bits : Steam l'ouvre quand même, avec son
/// overlay et le suivi de ses processus.
pub fn launch(appid: u32) -> Result<(), String> {
    if crate::shortcuts::is_shortcut(appid) {
        return open_uri(&format!("steam://rungameid/{}", crate::shortcuts::game_id(appid)));
    }
    open_uri(&format!("steam://run/{appid}"))
}

/// Page du jeu dans le magasin, dans le client.
pub fn open_store(appid: u32) -> Result<(), String> {
    open_uri(&format!("steam://store/{appid}"))
}

/// Ferme le client proprement.
pub fn exit() -> Result<(), String> {
    open_uri("steam://exit")
}

/// Liste des téléchargements du client : pause, reprise, ordre de la file.
pub fn open_downloads() -> Result<(), String> {
    open_uri("steam://open/downloads")
}

/// Dossier d'un jeu installé, à partir de sa bibliothèque et de son `installdir`. Rien d'autre
/// qu'un dossier existant sous `steamapps/common` n'est accepté.
pub fn game_dir(library_path: &str, install_dir: &str) -> Option<PathBuf> {
    let plain = !install_dir.is_empty()
        && !install_dir.contains(['/', '\\'])
        && install_dir != "."
        && install_dir != "..";
    let dir = Path::new(library_path).join("steamapps").join("common").join(install_dir);
    (plain && dir.is_dir()).then_some(dir)
}

fn open_uri(uri: &str) -> Result<(), String> {
    #[cfg(windows)]
    let result = {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("cmd")
            .args(["/C", "start", "", uri])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
    };

    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(uri).spawn();

    #[cfg(all(unix, not(target_os = "macos")))]
    let result = std::process::Command::new("xdg-open").arg(uri).spawn();

    result
        .map(|_| ())
        .map_err(|e| format!("Impossible de lancer {uri} : {e}"))
}

#[cfg(test)]
mod tests {
    /// Drapeaux relevés sur une vraie bibliothèque, après deux installations annulées.
    #[test]
    fn leftover_of_a_cancelled_install_is_not_a_download() {
        use super::cancelled_install;
        // Installation annulée : 514, plus rien dans `downloading/`.
        assert!(cancelled_install(514, false));
        // Mise à jour en pause d'un jeu installé, démarrée : 1542, avec ses données.
        assert!(!cancelled_install(1542, true));
        // Mise à jour reportée d'un jeu installé, jamais démarrée : 518.
        assert!(!cancelled_install(518, false));
        // Première installation mise en pause après avoir reçu des données.
        assert!(!cancelled_install(2 | 512 | 1024, true));
        // Même jamais démarrée, une installation qui a déjà un dossier de téléchargement reste.
        assert!(!cancelled_install(514, true));
    }

    /// Scan de l'installation Steam réelle : `cargo test -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn scan_local_steam() {
        let root = super::find_steam_root().expect("Steam introuvable");
        println!("Steam : {}", root.display());
        for lib in super::library_folders(&root) {
            println!("Bibliothèque : {}", lib.display());
        }
        let scan = super::scan(&root);
        for g in &scan.games {
            let a = &g.art;
            let flag = |o: &Option<String>| if o.is_some() { "✓" } else { "·" };
            println!(
                "{:>8}  {:<40} capsule{} hero{} logo{} header{} icon: {}",
                g.appid,
                g.name,
                flag(&a.capsule),
                flag(&a.hero),
                flag(&a.logo),
                flag(&a.header),
                a.icon.as_deref().and_then(|p| p.rsplit(['\\', '/']).next()).unwrap_or("·")
            );
        }
        println!("{} installés, {} au catalogue", scan.games.len(), scan.catalog.len());
        for c in scan.catalog.iter().take(10) {
            println!("   {:>8}  {}", c.appid, c.name);
        }
    }
}
