//! Installation, désinstallation, pause, reprise et annulation par un plugin Millennium, quand
//! Millennium est installé.
//!
//! Millennium lance l'interface de Steam avec un canal de débogage privé : le port de
//! `steamctl.rs` ne s'ouvre plus. Son plugin `3dsteam-bridge` (dans `millennium-plugin/`, posé par
//! 3DSteam dans `<Steam>/millennium/plugins/`) tourne, lui, dans cette interface, là où vit
//! `SteamClient`. Les deux se parlent par fichiers, dans le dossier `bridge` du plugin :
//! 3DSteam y dépose `command.json`, le plugin répond par `result-<id>.json` et tient à jour
//! `heartbeat` (heure et version). Aucun port n'est ouvert, et le plugin ne sait faire que ces
//! quelques actions.
//!
//! L'installation passe par l'assistant de Steam, que le plugin ne valide que si rien n'y pose
//! question : un contrat de licence, une clé ou un manque de place laissent la fenêtre de Steam à
//! l'utilisateur. La désinstallation est confirmée dans 3DSteam avant d'être demandée.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const PLUGIN: &str = "3dsteam-bridge";
const MANIFEST: &str = include_str!("../millennium-plugin/plugin.json");
const FILES: &[(&str, &str)] = &[
    ("plugin.json", MANIFEST),
    ("backend/main.lua", include_str!("../millennium-plugin/backend/main.lua")),
    (".millennium/Dist/index.js", include_str!("../millennium-plugin/.millennium/Dist/index.js")),
];
/// Le plugin écrit son battement chaque seconde où il interroge : au-delà, il ne tourne plus.
const HEARTBEAT_MAX_AGE: u64 = 5;
/// Le plugin passe toutes les demi-secondes ; Steam répond ensuite en quelques millisecondes.
const REPLY_TIMEOUT: Duration = Duration::from_secs(4);
/// L'assistant d'installation attend la licence et les informations du jeu avant de répondre.
const INSTALL_TIMEOUT: Duration = Duration::from_secs(25);
const REPLY_POLL: Duration = Duration::from_millis(50);

/// Une commande à la fois : il n'y a qu'un `command.json`.
static SENDING: Mutex<()> = Mutex::new(());

fn plugins_dir(steam_root: &Path) -> PathBuf {
    steam_root.join("millennium").join("plugins")
}

fn plugin_dir(steam_root: &Path) -> PathBuf {
    plugins_dir(steam_root).join(PLUGIN)
}

fn bridge_dir(steam_root: &Path) -> PathBuf {
    plugin_dir(steam_root).join("bridge")
}

fn config_path(steam_root: &Path) -> PathBuf {
    steam_root.join("millennium").join("config").join("config.json")
}

/// Version du plugin livré avec ce 3DSteam.
fn bundled_version() -> String {
    serde_json::from_str::<Value>(MANIFEST).ok().and_then(|v| v["version"].as_str().map(str::to_owned)).unwrap_or_default()
}

pub fn installed(steam_root: &Path) -> bool {
    plugin_dir(steam_root).join("plugin.json").is_file()
}

/// Version du plugin qui tourne, si son battement a moins de quelques secondes. Un plugin 1.0
/// n'écrivait que l'heure.
fn running_version(steam_root: &Path) -> Option<String> {
    let text = std::fs::read_to_string(bridge_dir(steam_root).join("heartbeat")).ok()?;
    let mut parts = text.split_whitespace();
    let beat: u64 = parts.next()?.parse().ok()?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    (now.saturating_sub(beat) <= HEARTBEAT_MAX_AGE).then(|| parts.next().unwrap_or("1.0.0").to_owned())
}

/// Le plugin tourne : pause, reprise et retrait passent par lui.
pub fn active(steam_root: &Path) -> bool {
    running_version(steam_root).is_some()
}

/// Le plugin qui tourne est celui de ce 3DSteam : il sait aussi installer et désinstaller.
pub fn current(steam_root: &Path) -> bool {
    running_version(steam_root).is_some_and(|v| v == bundled_version())
}

/// Pose les fichiers du plugin (ou les met à jour). Millennium ne le charge qu'au démarrage de
/// Steam, une fois activé dans sa configuration (`sync_config`).
pub fn install_plugin(steam_root: &Path) -> Result<(), String> {
    if !plugins_dir(steam_root).is_dir() {
        return Err("Millennium introuvable".to_string());
    }
    let dir = plugin_dir(steam_root);
    for (name, content) in FILES {
        let path = dir.join(name);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("{} : {e}", parent.display()))?;
        }
        std::fs::write(&path, content).map_err(|e| format!("{} : {e}", path.display()))?;
    }
    let bridge = bridge_dir(steam_root);
    std::fs::create_dir_all(&bridge).map_err(|e| format!("{} : {e}", bridge.display()))
}

/// Remplace les fichiers d'un plugin posé par une version plus ancienne de 3DSteam. Celui qui
/// tourne garde l'ancien code jusqu'au prochain démarrage de Steam.
pub fn update_plugin(steam_root: &Path) -> Result<(), String> {
    let dir = plugin_dir(steam_root);
    let stale = FILES.iter().any(|(name, content)| std::fs::read_to_string(dir.join(name)).map_or(true, |c| c != *content));
    if installed(steam_root) && stale {
        install_plugin(steam_root)
    } else {
        Ok(())
    }
}

pub fn remove_plugin(steam_root: &Path) -> Result<(), String> {
    let dir = plugin_dir(steam_root);
    match std::fs::remove_dir_all(&dir) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(format!("{} : {e}", dir.display())),
        _ => Ok(()),
    }
}

/// Inscrit le plugin dans les plugins activés de Millennium s'il est posé, l'en retire sinon.
/// Steam doit être fermé : Millennium réécrit sa configuration en tournant.
pub fn sync_config(steam_root: &Path) -> Result<(), String> {
    let path = config_path(steam_root);
    let Ok(text) = std::fs::read_to_string(&path) else {
        // Pas encore de configuration : rien à désactiver, et rien où l'activer.
        return if installed(steam_root) { Err(format!("{} introuvable", path.display())) } else { Ok(()) };
    };
    let mut config: Value = serde_json::from_str(&text).map_err(|e| format!("{} : {e}", path.display()))?;
    if !set_enabled(&mut config, installed(steam_root)) {
        return Ok(());
    }
    let backup = path.with_extension("json.3dsteam-backup");
    if !backup.exists() {
        let _ = std::fs::write(&backup, &text);
    }
    let tmp = path.with_extension("json.tmp");
    let out = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, out).map_err(|e| format!("{} : {e}", tmp.display()))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("{} : {e}", path.display()))
}

/// Ajoute ou retire le plugin de `plugins.enabledPlugins`. Renvoie `true` si la configuration a changé.
fn set_enabled(config: &mut Value, enabled: bool) -> bool {
    let Some(root) = config.as_object_mut() else { return false };
    let plugins = root.entry("plugins").or_insert_with(|| json!({}));
    let Some(plugins) = plugins.as_object_mut() else { return false };
    let list = plugins.entry("enabledPlugins").or_insert_with(|| json!([]));
    let Some(list) = list.as_array_mut() else { return false };
    let present = list.iter().any(|v| v == PLUGIN);
    match (enabled, present) {
        (true, false) => list.push(json!(PLUGIN)),
        (false, true) => list.retain(|v| v != PLUGIN),
        _ => return false,
    }
    true
}

/// Envoie une commande au plugin et attend qu'il l'ait menée dans l'interface de Steam ; renvoie
/// ce qu'il a répondu.
fn request(steam_root: &Path, mut command: Value, timeout: Duration) -> Result<Value, String> {
    let _guard = SENDING.lock().unwrap_or_else(|e| e.into_inner());
    let bridge = bridge_dir(steam_root);
    let id = format!(
        "{}-{}",
        std::process::id(),
        SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0)
    );
    command["id"] = json!(id);
    let path = bridge.join("command.json");
    let tmp = bridge.join("command.json.tmp");
    std::fs::write(&tmp, command.to_string()).map_err(|e| format!("{} : {e}", tmp.display()))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("{} : {e}", path.display()))?;

    let result = bridge.join(format!("result-{id}.json"));
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if let Ok(text) = std::fs::read_to_string(&result) {
            let _ = std::fs::remove_file(&result);
            let reply: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
            return if reply["ok"] == true {
                Ok(reply["data"].clone())
            } else {
                Err(reply["error"].as_str().unwrap_or("erreur de Steam").to_owned())
            };
        }
        std::thread::sleep(REPLY_POLL);
    }
    // Pas de réponse : la commande ne doit pas partir plus tard, à la surprise de l'utilisateur.
    let _ = std::fs::remove_file(&path);
    Err("le plugin Millennium ne répond pas".to_string())
}

/// Pause (`pause`), reprise (`resume`) ou retrait de la file (`remove`).
pub fn download(steam_root: &Path, appid: u32, action: &str) -> Result<(), String> {
    request(steam_root, json!({ "action": action, "appid": appid }), REPLY_TIMEOUT).map(|_| ())
}

/// Une bibliothèque de Steam où installer un jeu.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub index: u32,
    pub path: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub drive: String,
    /// Place libre, en octets.
    #[serde(default)]
    pub free: f64,
    #[serde(default)]
    pub is_default: bool,
}

pub fn folders(steam_root: &Path) -> Result<Vec<Folder>, String> {
    let data = request(steam_root, json!({ "action": "folders" }), REPLY_TIMEOUT)?;
    serde_json::from_value(data).map_err(|e| e.to_string())
}

/// Issue d'une installation demandée au plugin.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InstallOutcome {
    /// Le téléchargement est lancé, sans fenêtre de Steam à valider.
    pub started: bool,
    /// Sinon, pourquoi : `eula` (contrat à accepter), `space`, `folder`, `steam` (clé, mot de
    /// passe…) laissent la fenêtre de Steam à l'utilisateur ; `failed`, `timeout`, `replaced` non.
    #[serde(default)]
    pub reason: Option<String>,
}

impl InstallOutcome {
    /// La fenêtre de Steam est restée ouverte, en attente de l'utilisateur.
    pub fn needs_steam_window(&self) -> bool {
        !self.started && matches!(self.reason.as_deref(), Some("eula" | "space" | "folder" | "steam"))
    }
}

/// Installe un jeu, dans la bibliothèque `folder` ou dans celle que Steam propose.
pub fn install(steam_root: &Path, appid: u32, folder: Option<u32>) -> Result<InstallOutcome, String> {
    let data = request(steam_root, json!({ "action": "install", "appid": appid, "folder": folder }), INSTALL_TIMEOUT)?;
    serde_json::from_value(data).map_err(|e| e.to_string())
}

/// Désinstalle un jeu sans la boîte de Steam : l'utilisateur a déjà confirmé dans 3DSteam.
pub fn uninstall(steam_root: &Path, appid: u32) -> Result<(), String> {
    request(steam_root, json!({ "action": "uninstall", "appid": appid }), REPLY_TIMEOUT).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lua_and_manifest_versions_match() {
        let lua = FILES.iter().find(|(name, _)| *name == "backend/main.lua").unwrap().1;
        let version = bundled_version();
        assert!(!version.is_empty());
        assert!(lua.contains(&format!("local VERSION = \"{version}\"")), "VERSION de main.lua ≠ plugin.json ({version})");
    }

    #[test]
    fn enables_and_disables_in_config() {
        let mut config = json!({ "general": { "injectCSS": true }, "plugins": { "enabledPlugins": ["extendium"] } });
        assert!(set_enabled(&mut config, true));
        assert_eq!(config["plugins"]["enabledPlugins"], json!(["extendium", PLUGIN]));
        assert!(!set_enabled(&mut config, true), "déjà activé : rien ne change");
        assert!(set_enabled(&mut config, false));
        assert_eq!(config["plugins"]["enabledPlugins"], json!(["extendium"]));
        assert_eq!(config["general"]["injectCSS"], true, "le reste de la configuration est gardé");

        let mut empty = json!({});
        assert!(set_enabled(&mut empty, true));
        assert_eq!(empty["plugins"]["enabledPlugins"], json!([PLUGIN]));
    }

    #[test]
    fn steam_window_is_left_to_the_user_only_when_waiting_for_them() {
        let outcome = |reason: &str| InstallOutcome { started: false, reason: Some(reason.to_owned()) };
        assert!(outcome("eula").needs_steam_window());
        assert!(outcome("space").needs_steam_window());
        assert!(!outcome("timeout").needs_steam_window());
        assert!(!InstallOutcome { started: true, reason: None }.needs_steam_window());
    }

    /// Un faux plugin : prend chaque commande, écrit son battement et sa réponse, comme `main.lua`.
    fn fake_plugin(bridge: PathBuf, answers: Vec<Value>) -> std::thread::JoinHandle<Vec<Value>> {
        std::thread::spawn(move || {
            let command = bridge.join("command.json");
            let mut seen = Vec::new();
            for _ in 0..500 {
                if seen.len() == answers.len() {
                    break;
                }
                if let Ok(text) = std::fs::read_to_string(&command) {
                    let _ = std::fs::remove_file(&command);
                    let cmd: Value = serde_json::from_str(&text).unwrap();
                    let id = cmd["id"].as_str().unwrap().to_owned();
                    let reply = json!({ "id": id, "ok": true, "data": answers[seen.len()] });
                    std::fs::write(bridge.join(format!("result-{id}.json")), reply.to_string()).unwrap();
                    seen.push(cmd);
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            seen
        })
    }

    #[test]
    fn talks_to_a_fake_plugin_through_files() {
        let root = std::env::temp_dir().join(format!("3dsteam-millennium-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(plugins_dir(&root)).unwrap();
        install_plugin(&root).unwrap();
        assert!(installed(&root));
        assert!(!active(&root));

        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
        // Un plugin 1.0 n'écrit que l'heure : il pilote les téléchargements, pas l'installation.
        std::fs::write(bridge_dir(&root).join("heartbeat"), now.to_string()).unwrap();
        assert!(active(&root) && !current(&root));
        std::fs::write(bridge_dir(&root).join("heartbeat"), format!("{now} {}", bundled_version())).unwrap();
        assert!(current(&root));

        let folder = json!([{ "index": 1, "path": "D:\\SteamLibrary", "label": "", "drive": "D:", "free": 1.5e11, "isDefault": false }]);
        let plugin = fake_plugin(bridge_dir(&root), vec![Value::Null, folder, json!({ "started": false, "reason": "eula" })]);
        download(&root, 570, "pause").unwrap();
        let listed = folders(&root).unwrap();
        assert_eq!(listed[0].path, "D:\\SteamLibrary");
        let outcome = install(&root, 570, Some(1)).unwrap();
        assert!(outcome.needs_steam_window());
        let seen = plugin.join().unwrap();
        assert_eq!(seen[0]["action"], "pause");
        assert_eq!(seen[0]["appid"], 570);
        assert_eq!(seen[2]["action"], "install");
        assert_eq!(seen[2]["folder"], 1);

        // Fichiers d'une version précédente : remplacés par ceux de ce 3DSteam.
        std::fs::write(plugin_dir(&root).join("backend/main.lua"), "-- ancien").unwrap();
        update_plugin(&root).unwrap();
        assert_eq!(std::fs::read_to_string(plugin_dir(&root).join("backend/main.lua")).unwrap(), FILES[1].1);

        remove_plugin(&root).unwrap();
        assert!(!installed(&root));
        let _ = std::fs::remove_dir_all(&root);
    }
}
