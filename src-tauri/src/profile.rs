//! Profil Steam du compte actif, tel que le client le garde en local : pseudo et anciens pseudos,
//! avatar et niveau. Rien ne part sur le réseau, aucune clé d'API.
//!
//! Tout vient de `userdata/<compte>/config/localconfig.vdf` : la section `friends` y garde, pour le
//! compte lui-même, son pseudo, l'historique de ses pseudos et l'empreinte de son avatar ; le
//! niveau Steam est noté ailleurs dans le même fichier (`PlayerLevel`).

use std::fs;
use std::path::Path;

use serde::Serialize;

use crate::steam;
use crate::vdf::{self, Vdf};

/// Avatar par défaut de Steam (le point d'interrogation) : autant ne rien afficher.
const DEFAULT_AVATAR: &str = "fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamProfile {
    pub account_id: u32,
    pub persona: String,
    /// Anciens pseudos, du plus récent au plus ancien, sans le pseudo actuel.
    pub name_history: Vec<String>,
    pub level: Option<u32>,
    /// Avatar gardé en cache par le client (`config/avatarcache/<SteamID64>.png`).
    pub avatar_file: Option<String>,
    /// Empreinte de l'avatar, servi par le CDN de Steam (`avatars.steamstatic.com`).
    pub avatar: Option<String>,
}

/// Les pseudos Steam contiennent parfois des caractères invisibles (étiquettes Unicode) : on ne
/// garde que ce qui s'affiche.
fn clean(name: &str) -> String {
    name.chars()
        .filter(|c| !c.is_control() && !('\u{E0000}'..='\u{E007F}').contains(c) && *c != '\u{200B}')
        .collect::<String>()
        .trim()
        .to_owned()
}

fn avatar_of(entry: &Vdf) -> Option<String> {
    entry
        .get_str("avatar")
        .map(str::trim)
        .filter(|h| h.len() == 40 && h.bytes().all(|b| b.is_ascii_hexdigit()) && *h != DEFAULT_AVATAR && h.bytes().any(|b| b != b'0'))
        .map(str::to_ascii_lowercase)
}

/// Cherche une valeur numérique n'importe où sous `v` (la place de `PlayerLevel` a changé selon
/// les versions du client).
fn find_u64(v: &Vdf, key: &str, depth: u32) -> Option<u64> {
    if depth > 6 {
        return None;
    }
    if let Some(n) = v.get_u64(key) {
        return Some(n);
    }
    v.entries().iter().find_map(|(_, child)| find_u64(child, key, depth + 1))
}

fn parse(doc: &Vdf, account_id: u32, persona: String) -> SteamProfile {
    let root = doc.get("UserLocalConfigStore");
    let friends = root.and_then(|r| r.get("friends"));
    let me = friends.and_then(|f| f.get(&account_id.to_string()));

    let persona = if persona.is_empty() {
        me.and_then(|m| m.get_str("name")).map(clean).unwrap_or_default()
    } else {
        clean(&persona)
    };
    let mut name_history: Vec<String> = Vec::new();
    if let Some(history) = me.and_then(|m| m.get("NameHistory")) {
        let mut names: Vec<(u32, String)> = history
            .entries()
            .iter()
            .filter_map(|(i, v)| Some((i.trim().parse().ok()?, clean(v.as_str()?))))
            .collect();
        names.sort_by_key(|(i, _)| *i);
        for (_, name) in names {
            if !name.is_empty() && name != persona && !name_history.contains(&name) {
                name_history.push(name);
            }
        }
        name_history.truncate(8);
    }

    SteamProfile {
        account_id,
        persona,
        name_history,
        level: root.and_then(|r| find_u64(r, "PlayerLevel", 0)).map(|n| n as u32),
        avatar_file: None,
        avatar: me.and_then(avatar_of),
    }
}

pub fn load(steam_root: &Path) -> Option<SteamProfile> {
    let (id64, persona) = steam::active_user(steam_root)?;
    let account_id = u32::try_from(id64.checked_sub(steam::STEAM_ID_BASE)?).ok()?;
    let config = steam_root.join("userdata").join(account_id.to_string()).join("config");
    let doc = fs::read_to_string(config.join("localconfig.vdf"))
        .ok()
        .and_then(|text| vdf::parse(&text).ok())
        .unwrap_or_else(|| Vdf::Obj(Vec::new()));
    let mut profile = parse(&doc, account_id, persona);
    let cached = steam_root.join("config").join("avatarcache").join(format!("{id64}.png"));
    profile.avatar_file = cached.is_file().then(|| cached.to_string_lossy().into_owned());
    Some(profile)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"
"UserLocalConfigStore"
{
	"friends"
	{
		"84543199"
		{
			"NameHistory"
			{
				"1"		"Krife"
				"0"		"Yurogin"
				"2"		"󠁳Krife"
			}
			"avatar"		"2b1bdc540b9cb1ed5f7a85e85004c5e2ce66f17e"
			"name"		"Yurogin"
		}
		"PersonaName"		"Yurogin"
		"1139232504"
		{
			"name"		"Narax"
			"avatar"		"A8E7A546E9A94ED6E4D66FC369D229B4A202DEC4"
		}
	}
	"Software"
	{
		"Valve"
		{
			"Steam"
			{
				"PlayerLevel"		"45"
			}
		}
	}
}
"#;

    #[test]
    fn reads_the_local_profile() {
        let doc = vdf::parse(SAMPLE).unwrap();
        let p = parse(&doc, 84543199, "Yurogin".into());
        assert_eq!(p.persona, "Yurogin");
        // Le pseudo actuel et le doublon invisible sont écartés.
        assert_eq!(p.name_history, vec!["Krife".to_string()]);
        assert_eq!(p.level, Some(45));
        assert_eq!(p.avatar.as_deref(), Some("2b1bdc540b9cb1ed5f7a85e85004c5e2ce66f17e"));
    }

    #[test]
    fn ignores_empty_and_default_avatars() {
        let empty = vdf::parse(r#""a" { "avatar" "0000000000000000000000000000000000000000" }"#).unwrap();
        let default = vdf::parse(r#""a" { "avatar" "fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb" }"#).unwrap();
        assert_eq!(avatar_of(empty.get("a").unwrap()), None);
        assert_eq!(avatar_of(default.get("a").unwrap()), None);
    }

    /// Profil réel : `cargo test local_profile -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn local_profile() {
        let root = steam::find_steam_root().expect("Steam introuvable");
        let p = load(&root).expect("profil introuvable");
        println!(
            "niveau {:?}, {} anciens pseudos, avatar local {}",
            p.level,
            p.name_history.len(),
            p.avatar_file.is_some()
        );
    }
}
