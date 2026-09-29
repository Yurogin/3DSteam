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
}

/// Résultat d'un scan : ce qui est installé, et ce que le client connaît en plus.
pub struct Scan {
    pub games: Vec<Game>,
    pub catalog: Vec<CatalogGame>,
}

/// Écart entre un SteamID64 et le numéro de dossier dans `userdata`.
const STEAM_ID_BASE: u64 = 76_561_197_960_265_728;

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
    })
}

fn is_hidden(appid: u32, name: &str) -> bool {
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

/// Dossier `userdata` du compte le plus récemment utilisé, d'après `loginusers.vdf`.
fn active_user_dir(steam_root: &Path) -> Option<PathBuf> {
    let text = fs::read_to_string(steam_root.join("config").join("loginusers.vdf")).ok()?;
    let doc = vdf::parse(&text).ok()?;
    // Le tri porte sur le tuple : `MostRecent` d'abord, puis l'horodatage le plus grand.
    let (_, _, id64) = doc
        .get("users")?
        .entries()
        .iter()
        .filter_map(|(id, user)| {
            let id64: u64 = id.trim().parse().ok()?;
            let recent = user.get_str("MostRecent").is_some_and(|v| v == "1");
            Some((recent, user.get_u64("Timestamp").unwrap_or(0), id64))
        })
        .max()?;
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
    let Some(dir) = active_user_dir(steam_root).or_else(|| newest_user_dir(steam_root)) else {
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

    games.sort_by(|a, b| {
        b.last_played
            .cmp(&a.last_played)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    // Le temps de jeu n'est pas dans les manifestes : il vit dans la configuration du compte.
    let usage = seen_apps(steam_root);
    for game in &mut games {
        game.playtime = usage.get(&game.appid).map_or(0, |u| u.playtime);
    }
    let catalog = catalog(&apps, &usage, &appids);
    Scan { games, catalog }
}

/// Lance un jeu via le protocole `steam://run/<appid>` (Steam gère mises à jour et DRM).
pub fn launch(appid: u32) -> Result<(), String> {
    let uri = format!("steam://run/{appid}");

    #[cfg(windows)]
    let result = {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &uri])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
    };

    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(&uri).spawn();

    #[cfg(all(unix, not(target_os = "macos")))]
    let result = std::process::Command::new("xdg-open").arg(&uri).spawn();

    result
        .map(|_| ())
        .map_err(|e| format!("Impossible de lancer {uri} : {e}"))
}

#[cfg(test)]
mod tests {
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
