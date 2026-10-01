//! Jeux hors Steam ajoutés à la bibliothèque (« Ajouter un jeu non-Steam »).
//!
//! Steam les range dans `userdata/<compte>/config/shortcuts.vdf`, un VDF **binaire** : chaque
//! champ commence par un octet de type (0 objet, 1 texte, 2 entier 32 bits, 8 fin d'objet), puis
//! sa clé terminée par un zéro. Leur numéro a le bit de poids fort levé, il ne croise donc jamais
//! celui d'un vrai jeu Steam. Les visuels choisis par l'utilisateur sont dans `config/grid`.

use std::fs;
use std::path::{Path, PathBuf};

use crate::steam::{Game, GameArt};

/// Bit levé sur le numéro de tout raccourci.
const SHORTCUT_BIT: u32 = 0x8000_0000;

pub fn is_shortcut(appid: u32) -> bool {
    appid & SHORTCUT_BIT != 0
}

/// Identifiant 64 bits du raccourci : celui de `steam://rungameid/` et du journal des processus.
pub fn game_id(appid: u32) -> u64 {
    (u64::from(appid) << 32) | 0x0200_0000
}

/// Un raccourci tel que `shortcuts.vdf` le décrit.
#[derive(Debug, Clone, Default, PartialEq)]
struct Shortcut {
    appid: u32,
    name: String,
    exe: String,
    start_dir: String,
    icon: String,
    hidden: bool,
    last_played: u64,
}

struct Reader<'a> {
    data: &'a [u8],
    at: usize,
}

impl Reader<'_> {
    fn byte(&mut self) -> Option<u8> {
        let b = *self.data.get(self.at)?;
        self.at += 1;
        Some(b)
    }

    fn cstr(&mut self) -> Option<String> {
        let rest = self.data.get(self.at..)?;
        let end = rest.iter().position(|&b| b == 0)?;
        self.at += end + 1;
        Some(String::from_utf8_lossy(&rest[..end]).into_owned())
    }

    fn u32(&mut self) -> Option<u32> {
        let bytes = self.data.get(self.at..self.at + 4)?;
        self.at += 4;
        Some(u32::from_le_bytes(bytes.try_into().ok()?))
    }

    /// Saute un objet entier (les `tags`, par exemple), jusqu'à sa fin.
    fn skip_object(&mut self, depth: u32) -> Option<()> {
        if depth > 16 {
            return None;
        }
        loop {
            match self.byte()? {
                8 => return Some(()),
                0 => {
                    self.cstr()?;
                    self.skip_object(depth + 1)?;
                }
                1 => {
                    self.cstr()?;
                    self.cstr()?;
                }
                2 => {
                    self.cstr()?;
                    self.u32()?;
                }
                _ => return None,
            }
        }
    }

    fn shortcut(&mut self) -> Option<Shortcut> {
        let mut s = Shortcut::default();
        loop {
            match self.byte()? {
                8 => return Some(s),
                0 => {
                    self.cstr()?;
                    self.skip_object(1)?;
                }
                1 => {
                    // La casse des clés a changé selon les versions du client (`appname`, `AppName`).
                    let key = self.cstr()?.to_ascii_lowercase();
                    let value = self.cstr()?;
                    match key.as_str() {
                        "appname" => s.name = value,
                        "exe" => s.exe = value,
                        "startdir" => s.start_dir = value,
                        "icon" => s.icon = value,
                        _ => {}
                    }
                }
                2 => {
                    let key = self.cstr()?.to_ascii_lowercase();
                    let value = self.u32()?;
                    match key.as_str() {
                        "appid" => s.appid = value,
                        "ishidden" => s.hidden = value != 0,
                        "lastplaytime" => s.last_played = u64::from(value),
                        _ => {}
                    }
                }
                _ => return None,
            }
        }
    }
}

/// Lit `shortcuts.vdf`. Un fichier abîmé rend ce qui a pu être lu avant l'erreur.
fn parse(data: &[u8]) -> Vec<Shortcut> {
    let mut out = Vec::new();
    let mut r = Reader { data, at: 0 };
    // `\0shortcuts\0`, puis un objet par raccourci, nommé par son rang (« 0 », « 1 »…).
    if r.byte() != Some(0) || r.cstr().is_none() {
        return out;
    }
    while r.byte() == Some(0) {
        if r.cstr().is_none() {
            break;
        }
        match r.shortcut() {
            Some(mut s) => {
                if s.appid == 0 {
                    s.appid = legacy_appid(&s.exe, &s.name);
                }
                out.push(s);
            }
            None => break,
        }
    }
    out
}

/// Numéro calculé par les anciens clients quand le fichier n'en donne pas : CRC32 de l'exe suivi
/// du nom, bit de poids fort levé.
fn legacy_appid(exe: &str, name: &str) -> u32 {
    let mut crc = !0u32;
    for &b in exe.as_bytes().iter().chain(name.as_bytes()) {
        crc ^= u32::from(b);
        for _ in 0..8 {
            crc = (crc >> 1) ^ (0xEDB8_8320 & (crc & 1).wrapping_neg());
        }
    }
    !crc | SHORTCUT_BIT
}

/// Chemin écrit par Steam, entre guillemets ou non.
fn unquote(s: &str) -> &str {
    s.trim().trim_matches('"')
}

/// Dossier des visuels personnalisés du compte (jaquettes, bannières, logos).
pub fn grid_dir(user_dir: &Path) -> PathBuf {
    user_dir.join("config").join("grid")
}

/// Visuels de `config/grid`, nommés d'après le numéro du raccourci : `<id>p` (jaquette),
/// `<id>` (en-tête large), `<id>_hero`, `<id>_logo`, `<id>_icon`.
fn grid_art(grid: &Path, appid: u32) -> GameArt {
    let find = |suffix: &str| {
        ["png", "jpg", "jpeg", "webp"].iter().find_map(|ext| {
            let p = grid.join(format!("{appid}{suffix}.{ext}"));
            p.is_file().then(|| p.to_string_lossy().into_owned())
        })
    };
    GameArt {
        capsule: find("p"),
        hero: find("_hero"),
        logo: find("_logo"),
        header: find(""),
        icon: find("_icon"),
        icon_size: None,
    }
}

/// L'icône d'un raccourci : celle qu'on lui a choisie, sinon l'exécutable lui-même (son icône en
/// est extraite par `icons::refine`).
fn icon_of(s: &Shortcut) -> Option<String> {
    [unquote(&s.icon), unquote(&s.exe)]
        .into_iter()
        .find(|p| !p.is_empty() && Path::new(p).is_file())
        .map(str::to_owned)
}

/// Dossier de travail du raccourci, sinon celui de son exécutable.
fn folder_of(s: &Shortcut) -> String {
    let start = unquote(&s.start_dir);
    if !start.is_empty() {
        return start.trim_end_matches(['\\', '/']).to_owned();
    }
    Path::new(unquote(&s.exe)).parent().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default()
}

fn read(user_dir: &Path) -> Vec<Shortcut> {
    fs::read(user_dir.join("config").join("shortcuts.vdf")).map(|d| parse(&d)).unwrap_or_default()
}

/// Les raccourcis visibles, comme des jeux installés. Ni taille ni temps de jeu : Steam ne les
/// connaît pas pour eux.
pub fn games(user_dir: &Path) -> Vec<Game> {
    let grid = grid_dir(user_dir);
    read(user_dir)
        .into_iter()
        .filter(|s| !s.hidden && !s.name.trim().is_empty() && is_shortcut(s.appid))
        .map(|s| {
            let mut art = grid_art(&grid, s.appid);
            if art.icon.is_none() {
                art.icon = icon_of(&s);
            }
            Game {
                appid: s.appid,
                name: s.name.trim().to_owned(),
                install_dir: folder_of(&s),
                library_path: String::new(),
                size_on_disk: 0,
                last_played: s.last_played,
                last_updated: 0,
                playtime: 0,
                art,
                shortcut: true,
            }
        })
        .collect()
}

/// Dossier d'un raccourci, relu dans `shortcuts.vdf` : l'interface ne choisit pas ce qu'on ouvre.
pub fn folder(user_dir: &Path, appid: u32) -> Option<PathBuf> {
    let s = read(user_dir).into_iter().find(|s| s.appid == appid)?;
    let dir = PathBuf::from(folder_of(&s));
    dir.is_dir().then_some(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn string(out: &mut Vec<u8>, key: &str, value: &str) {
        out.push(1);
        out.extend_from_slice(key.as_bytes());
        out.push(0);
        out.extend_from_slice(value.as_bytes());
        out.push(0);
    }

    fn int(out: &mut Vec<u8>, key: &str, value: u32) {
        out.push(2);
        out.extend_from_slice(key.as_bytes());
        out.push(0);
        out.extend_from_slice(&value.to_le_bytes());
    }

    fn sample() -> Vec<u8> {
        let mut d = b"\0shortcuts\0".to_vec();
        d.extend_from_slice(b"\x000\0");
        int(&mut d, "appid", 3_787_939_062);
        string(&mut d, "AppName", "Universal Paperclips");
        string(&mut d, "Exe", "\"C:\\Games\\paperclips.exe\"");
        string(&mut d, "StartDir", "C:\\Games\\");
        string(&mut d, "icon", "");
        int(&mut d, "IsHidden", 0);
        int(&mut d, "LastPlayTime", 1_777_000_000);
        d.extend_from_slice(b"\0tags\0");
        string(&mut d, "0", "favorite");
        d.push(8);
        d.push(8);
        // Ancien client : clés en minuscules, sans numéro.
        d.extend_from_slice(b"\x001\0");
        string(&mut d, "appname", "Old");
        string(&mut d, "exe", "old.exe");
        int(&mut d, "ishidden", 1);
        d.push(8);
        d.extend_from_slice(&[8, 8]);
        d
    }

    #[test]
    fn reads_shortcuts() {
        let list = parse(&sample());
        assert_eq!(list.len(), 2);
        let s = &list[0];
        assert_eq!(s.appid, 3_787_939_062);
        assert_eq!(s.name, "Universal Paperclips");
        assert_eq!(unquote(&s.exe), "C:\\Games\\paperclips.exe");
        assert_eq!(folder_of(s), "C:\\Games");
        assert_eq!(s.last_played, 1_777_000_000);
        assert!(!s.hidden);
        assert!(list[1].hidden);
        assert!(is_shortcut(list[1].appid));
    }

    #[test]
    fn survives_a_truncated_file() {
        let data = sample();
        for cut in 0..data.len() {
            let _ = parse(&data[..cut]);
        }
        assert!(parse(b"garbage").is_empty());
    }

    #[test]
    fn game_id_matches_steam() {
        // Relevé dans `gameprocess_log.txt` pour ce raccourci.
        assert_eq!(game_id(3_787_939_062), 16_269_074_390_564_470_784);
        assert!(!is_shortcut(1_145_360));
    }
}
