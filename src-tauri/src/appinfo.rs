//! Lecture de `appcache/appinfo.vdf`, le cache de métadonnées du client Steam.
//!
//! C'est un format binaire, distinct du KeyValues texte de `vdf.rs` : un en-tête, puis une suite
//! d'entrées `<appid> <taille> <en-tête par application> <KeyValues binaire>`. Chaque valeur est
//! précédée d'un octet de type, et depuis la v29 les *clés* ne sont plus écrites en clair mais
//! remplacées par un index dans une table de chaînes rangée en fin de fichier.
//!
//! On n'en tire que le bloc `common` : le nom, le type, et surtout `clienticon`, l'empreinte du
//! `.ico` des raccourcis. C'est un progrès net sur la méthode précédente, qui cherchait à l'aveugle
//! une chaîne de 40 caractères hexadécimaux dans les octets de l'entrée.

use std::collections::HashMap;
use std::fs;
use std::path::Path;

/// Octet de type précédant chaque valeur.
const OBJECT: u8 = 0x00;
const STRING: u8 = 0x01;
const INT32: u8 = 0x02;
const FLOAT32: u8 = 0x03;
const POINTER: u8 = 0x04;
const WIDE_STRING: u8 = 0x05;
const COLOR: u8 = 0x06;
const UINT64: u8 = 0x07;
const END: u8 = 0x08;
const INT64: u8 = 0x0A;

/// Garde-fou : la vraie imbrication ne dépasse pas quelques niveaux.
const MAX_DEPTH: u32 = 32;

/// Ce qu'on retient du bloc `common` d'une application.
#[derive(Debug, Default, Clone)]
pub struct AppInfo {
    /// `name` et `kind` ne servent pas encore : ils sont la matière de la bibliothèque complète.
    #[allow(dead_code)]
    pub name: String,
    /// `Game`, `DLC`, `Tool`, `Demo`, `Config`…
    #[allow(dead_code)]
    pub kind: String,
    /// Empreinte du `.ico` des raccourcis, dans `<Steam>/steam/games/`.
    pub client_icon: Option<String>,
}

struct Reader<'a> {
    data: &'a [u8],
    pos: usize,
    /// Vide avant la v29 : les clés sont alors écrites en clair.
    strings: &'a [String],
}

impl<'a> Reader<'a> {
    fn byte(&mut self) -> Option<u8> {
        let b = *self.data.get(self.pos)?;
        self.pos += 1;
        Some(b)
    }

    fn skip(&mut self, n: usize) -> Option<()> {
        self.pos = self.pos.checked_add(n).filter(|&p| p <= self.data.len())?;
        Some(())
    }

    /// Chaîne terminée par un zéro, avancée au-delà de celui-ci.
    fn cstr(&mut self) -> Option<String> {
        let rest = self.data.get(self.pos..)?;
        let end = rest.iter().position(|&b| b == 0)?;
        self.pos += end + 1;
        Some(String::from_utf8_lossy(&rest[..end]).into_owned())
    }

    fn skip_wide(&mut self) -> Option<()> {
        let rest = self.data.get(self.pos..)?;
        let end = rest.chunks_exact(2).position(|c| c == [0, 0])?;
        self.skip(end * 2 + 2)
    }

    /// Une clé : un index dans la table (v29 et plus), sinon une chaîne en clair.
    fn key(&mut self) -> Option<String> {
        if self.strings.is_empty() {
            return self.cstr();
        }
        let bytes = self.data.get(self.pos..self.pos + 4)?;
        self.pos += 4;
        let index = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize;
        self.strings.get(index).cloned()
    }
}

/**
 * Parcourt un objet binaire jusqu'à sa marque de fin.
 *
 * `capture` n'est vrai que dans `common` lui-même, jamais dans ses sous-objets : `associations`
 * contient aussi des clés `name` (l'éditeur, le développeur) qui écraseraient le nom du jeu.
 */
fn object(r: &mut Reader, depth: u32, capture: bool, out: &mut AppInfo) -> Option<()> {
    if depth > MAX_DEPTH {
        return None;
    }
    loop {
        let kind = r.byte()?;
        if kind == END {
            return Some(());
        }
        let key = r.key()?;
        match kind {
            OBJECT => {
                let inside = depth == 1 && key.eq_ignore_ascii_case("common");
                object(r, depth + 1, inside, out)?;
            }
            STRING => {
                let value = r.cstr()?;
                if capture {
                    match key.to_ascii_lowercase().as_str() {
                        "name" => out.name = value,
                        "type" => out.kind = value,
                        "clienticon" => out.client_icon = Some(value),
                        _ => {}
                    }
                }
            }
            INT32 | FLOAT32 | POINTER | COLOR => r.skip(4)?,
            UINT64 | INT64 => r.skip(8)?,
            WIDE_STRING => r.skip_wide()?,
            _ => return None,
        }
    }
}

fn u32_at(data: &[u8], at: usize) -> Option<u32> {
    data.get(at..at + 4)
        .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
}

fn string_table(data: &[u8], offset: usize) -> Option<Vec<String>> {
    let count = u32_at(data, offset)? as usize;
    let mut out = Vec::new();
    let mut pos = offset + 4;
    for _ in 0..count {
        let rest = data.get(pos..)?;
        let end = rest.iter().position(|&b| b == 0)?;
        out.push(String::from_utf8_lossy(&rest[..end]).into_owned());
        pos += end + 1;
    }
    Some(out)
}

/// Position de la première entrée, et la table de chaînes si le format en a une.
fn header(data: &[u8]) -> Option<(usize, Vec<String>)> {
    match u32_at(data, 0)? {
        0x0756_4429 | 0x0756_442A => {
            let bytes = data.get(8..16)?;
            let offset = i64::from_le_bytes(bytes.try_into().ok()?);
            let offset = usize::try_from(offset).ok()?;
            Some((16, string_table(data, offset)?))
        }
        0x0756_4427 | 0x0756_4428 => Some((8, Vec::new())),
        _ => None,
    }
}

fn read_entry(body: &[u8], strings: &[String]) -> Option<AppInfo> {
    // L'en-tête par application fait 60 octets depuis la v28, 40 avant (il y manque le sha1 du
    // bloc binaire). On reconnaît le début des données à son premier octet : l'objet racine.
    let start = [60usize, 40].into_iter().find(|&n| body.get(n) == Some(&OBJECT))?;
    let mut reader = Reader { data: body, pos: start, strings };
    // On consomme la racine (`appinfo`) au lieu de la lire comme un objet parmi d'autres : sans
    // cela, la boucle chercherait une entrée de plus une fois la racine fermée, et buterait sur
    // la fin du tampon.
    reader.byte()?;
    reader.key()?;
    let mut info = AppInfo::default();
    object(&mut reader, 1, false, &mut info)?;
    Some(info)
}

/// Toutes les applications décrites par le cache, indexées par appid. Vide si le fichier est
/// absent ou d'un format inconnu : l'appelant se contente alors de moins d'informations.
pub fn load(steam_root: &Path) -> HashMap<u32, AppInfo> {
    let mut apps = HashMap::new();
    let Ok(data) = fs::read(steam_root.join("appcache").join("appinfo.vdf")) else {
        return apps;
    };
    let Some((mut offset, strings)) = header(&data) else {
        return apps;
    };
    while let (Some(appid), Some(size)) = (u32_at(&data, offset), u32_at(&data, offset + 4)) {
        if appid == 0 {
            break;
        }
        let start = offset + 8;
        let end = start.saturating_add(size as usize).min(data.len());
        if end <= start {
            break;
        }
        if let Some(info) = read_entry(&data[start..end], &strings) {
            apps.insert(appid, info);
        }
        offset = end;
    }
    apps
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Construit un `appinfo.vdf` de synthèse, au format v29 (clés indexées).
    struct Builder {
        keys: Vec<String>,
        body: Vec<u8>,
    }

    impl Builder {
        fn new() -> Self {
            Self { keys: Vec::new(), body: Vec::new() }
        }

        fn key(&mut self, name: &str) -> u32 {
            if let Some(i) = self.keys.iter().position(|k| k == name) {
                return i as u32;
            }
            self.keys.push(name.to_string());
            self.keys.len() as u32 - 1
        }

        fn open(&mut self, name: &str) -> &mut Self {
            let k = self.key(name);
            self.body.push(OBJECT);
            self.body.extend_from_slice(&k.to_le_bytes());
            self
        }

        fn string(&mut self, name: &str, value: &str) -> &mut Self {
            let k = self.key(name);
            self.body.push(STRING);
            self.body.extend_from_slice(&k.to_le_bytes());
            self.body.extend_from_slice(value.as_bytes());
            self.body.push(0);
            self
        }

        fn int(&mut self, name: &str, value: i32) -> &mut Self {
            let k = self.key(name);
            self.body.push(INT32);
            self.body.extend_from_slice(&k.to_le_bytes());
            self.body.extend_from_slice(&value.to_le_bytes());
            self
        }

        fn close(&mut self) -> &mut Self {
            self.body.push(END);
            self
        }

        /// Assemble le fichier complet autour d'une seule application.
        fn finish(self, appid: u32) -> Vec<u8> {
            let mut entry = vec![0u8; 60]; // en-tête par application, contenu sans importance ici
            entry.extend_from_slice(&self.body);

            let mut out = Vec::new();
            out.extend_from_slice(&0x0756_4429u32.to_le_bytes());
            out.extend_from_slice(&1u32.to_le_bytes()); // univers
            let table_at = 16 + 8 + entry.len() + 8;
            out.extend_from_slice(&(table_at as i64).to_le_bytes());
            out.extend_from_slice(&appid.to_le_bytes());
            out.extend_from_slice(&(entry.len() as u32).to_le_bytes());
            out.extend_from_slice(&entry);
            out.extend_from_slice(&0u32.to_le_bytes()); // appid 0 : fin des entrées
            out.extend_from_slice(&0u32.to_le_bytes());

            out.extend_from_slice(&(self.keys.len() as u32).to_le_bytes());
            for k in &self.keys {
                out.extend_from_slice(k.as_bytes());
                out.push(0);
            }
            out
        }
    }

    fn sample() -> Vec<u8> {
        let mut b = Builder::new();
        b.open("appinfo");
        b.int("appid", 440);
        b.open("common");
        b.string("name", "Team Fortress 2");
        b.string("type", "Game");
        b.string("clienticon", "e3f595a92552da3d664ad00277fad2107345f743");
        // Sous-objet : ses clés `name` ne doivent pas écraser celle du jeu.
        b.open("associations");
        b.open("0");
        b.string("name", "Valve");
        b.string("type", "developer");
        b.close();
        b.close();
        b.close(); // common
        b.open("extended");
        b.string("name", "surtout pas celui-ci");
        b.close();
        b.close(); // appinfo
        b.finish(440)
    }

    #[test]
    fn reads_name_type_and_icon() {
        let apps = {
            let data = sample();
            let (offset, strings) = header(&data).unwrap();
            let size = u32_at(&data, offset + 4).unwrap() as usize;
            read_entry(&data[offset + 8..offset + 8 + size], &strings).unwrap()
        };
        assert_eq!(apps.name, "Team Fortress 2");
        assert_eq!(apps.kind, "Game");
        assert_eq!(apps.client_icon.as_deref(), Some("e3f595a92552da3d664ad00277fad2107345f743"));
    }

    #[test]
    fn nested_objects_do_not_shadow_common() {
        // `associations/0/name` vaut « Valve » et `extended/name` autre chose : ni l'un ni
        // l'autre ne doit remplacer le nom du jeu.
        let data = sample();
        let (offset, strings) = header(&data).unwrap();
        let size = u32_at(&data, offset + 4).unwrap() as usize;
        let info = read_entry(&data[offset + 8..offset + 8 + size], &strings).unwrap();
        assert_eq!(info.name, "Team Fortress 2");
        assert_eq!(info.kind, "Game");
    }

    #[test]
    fn rejects_an_unknown_format() {
        assert!(header(b"pas un appinfo du tout").is_none());
    }

    #[test]
    fn survives_a_truncated_file() {
        let mut data = sample();
        data.truncate(data.len() / 2);
        // Ni panique, ni boucle sans fin : on s'arrête simplement sur ce qui est lisible.
        let _ = header(&data);
    }

    /// Lecture du vrai cache : `cargo test -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn read_local_appinfo() {
        let Some(root) = crate::steam::find_steam_root() else {
            return println!("Steam introuvable");
        };
        let apps = load(&root);
        let mut kinds: std::collections::BTreeMap<String, usize> = Default::default();
        for info in apps.values() {
            *kinds.entry(info.kind.to_ascii_lowercase()).or_default() += 1;
        }
        let with_icon = apps.values().filter(|a| a.client_icon.is_some()).count();
        let named = apps.values().filter(|a| !a.name.is_empty()).count();
        println!("{} applications, {named} nommées, {with_icon} avec clienticon", apps.len());
        for (kind, n) in kinds.iter().filter(|(_, &n)| n > 5) {
            println!("  {n:5}  {}", if kind.is_empty() { "(sans type)" } else { kind });
        }
    }
}
