//! Pause, reprise et annulation des téléchargements, par l'interface de Steam elle-même.
//!
//! Steam n'offre aucune commande `steam://` pour ça : son interface appelle en interne
//! `SteamClient.Downloads.PauseAppUpdate`, `ResumeAppUpdate` ou `RemoveFromDownloadList`, dans
//! son contexte JavaScript partagé (`SharedJSContext`). On ne peut l'atteindre que par le port de
//! débogage de Steam, que Steam n'ouvre qu'en présence d'un fichier `.cef-enable-remote-debugging`
//! dans son dossier, à son démarrage — comme le font Decky Loader ou Millennium.
//!
//! C'est un choix de l'utilisateur, désactivé par défaut : une fois le port ouvert (sur
//! 127.0.0.1:8080 seulement), n'importe quel programme de ce PC peut piloter Steam.
//!
//! Millennium, lui, lance l'interface de Steam avec `--remote-debugging-pipe` : le débogage passe
//! par un canal privé, et le fichier n'ouvre plus aucun port. On le détecte dans
//! `logs/webhelper.txt`, et les commandes passent alors par le plugin de `millennium.rs`.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};
use tungstenite::Message;

use crate::millennium;

/// Fichier dont la présence fait ouvrir à Steam son port de débogage.
const FLAG_FILE: &str = ".cef-enable-remote-debugging";
const PORT: u16 = 8080;
/// Identifiant que l'interface de Steam donne à ce PC (les autres sont les PC distants).
const LOCAL_CLIENT: &str = "0";
/// Steam répond en quelques millisecondes : au-delà, il n'est pas là (ou pas prêt).
const CONNECT_TIMEOUT: Duration = Duration::from_millis(300);
const TIMEOUT: Duration = Duration::from_millis(1500);
/// Fin du journal de l'interface lue pour trouver son dernier lancement : plusieurs jours de
/// journal, sur un fichier qui dépasse vite les 5 Mo.
const WEBHELPER_LOG_TAIL: u64 = 1024 * 1024;
const WEBHELPER_LAUNCH: &str = "Startup - webhelper launched";

fn flag(steam_root: &Path) -> PathBuf {
    steam_root.join(FLAG_FILE)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlState {
    /// Le fichier est posé : Steam ouvrira son port à son prochain démarrage.
    pub enabled: bool,
    /// Le port ou le plugin Millennium répond : les commandes passent dès maintenant.
    pub connected: bool,
    /// Millennium tient le débogage de Steam (canal privé) : le port ne s'ouvrira pas, et c'est
    /// le plugin qui sert.
    pub millennium: bool,
    /// Le plugin 3DSteam est posé dans Millennium : il tournera au prochain démarrage de Steam.
    pub bridge_installed: bool,
    /// Le plugin tourne dans l'interface de Steam.
    pub bridge_active: bool,
    /// Le plugin qui tourne est celui de ce 3DSteam : il sait aussi installer et désinstaller.
    /// Sinon, ses nouveaux fichiers attendent le prochain démarrage de Steam.
    pub bridge_current: bool,
}

pub fn state(steam_root: &Path) -> ControlState {
    // Un plugin posé par une version précédente de 3DSteam est mis à jour : le nouveau code tournera
    // au prochain démarrage de Steam.
    if let Err(e) = millennium::update_plugin(steam_root) {
        eprintln!("[3dsteam] mise à jour du plugin Millennium : {e}");
    }
    let bridge_active = millennium::active(steam_root);
    // Le port n'est interrogé que s'il peut servir : avec le plugin, c'est lui qui répond.
    let port = !bridge_active && shared_context().is_ok();
    ControlState {
        enabled: flag(steam_root).is_file(),
        connected: port || bridge_active,
        millennium: bridge_active || (!port && last_launch_uses_pipe(&webhelper_log_tail(steam_root))),
        bridge_installed: millennium::installed(steam_root),
        bridge_active,
        bridge_current: millennium::current(steam_root),
    }
}

/// Pose ou retire le plugin Millennium. Steam ne le charge (ou ne le lâche) qu'à son redémarrage.
pub fn set_bridge(steam_root: &Path, enabled: bool) -> Result<ControlState, String> {
    if enabled {
        millennium::install_plugin(steam_root)?;
    } else {
        millennium::remove_plugin(steam_root)?;
    }
    Ok(state(steam_root))
}

fn webhelper_log_tail(steam_root: &Path) -> String {
    let Ok(mut file) = File::open(steam_root.join("logs").join("webhelper.txt")) else { return String::new() };
    let len = file.metadata().map(|m| m.len()).unwrap_or(0);
    if file.seek(SeekFrom::Start(len.saturating_sub(WEBHELPER_LOG_TAIL))).is_err() {
        return String::new();
    }
    let mut bytes = Vec::new();
    if file.read_to_end(&mut bytes).is_err() {
        return String::new();
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

/// Le dernier lancement de l'interface dans le journal passe-t-il par un canal de débogage privé ?
fn last_launch_uses_pipe(log: &str) -> bool {
    log.lines()
        .rev()
        .find(|line| line.contains(WEBHELPER_LAUNCH))
        .is_some_and(|line| line.contains("--remote-debugging-pipe"))
}

/// Pose ou retire le fichier. Steam ne le lit qu'à son démarrage : il faut le relancer.
pub fn set_enabled(steam_root: &Path, enabled: bool) -> Result<ControlState, String> {
    let path = flag(steam_root);
    let result = if enabled {
        std::fs::write(&path, b"")
    } else if path.exists() {
        std::fs::remove_file(&path)
    } else {
        Ok(())
    };
    result.map_err(|e| format!("{} : {e}", path.display()))?;
    Ok(state(steam_root))
}

/* ─── Port de débogage ────────────────────────────────────────────────────────────────── */

/// GET minimal sur le port de débogage.
///
/// Mesuré : Steam répond en quelques millisecondes, mais ignore `Connection: close` et garde la
/// connexion ouverte. Attendre qu'il la ferme bloquait donc jusqu'au délai, et chaque requête
/// échouait. On lit l'en-tête, puis exactement les `Content-Length` octets annoncés.
fn http_get(path: &str) -> Result<String, String> {
    let addr = SocketAddr::from(([127, 0, 0, 1], PORT));
    let mut stream = TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT).map_err(|e| e.to_string())?;
    stream.set_read_timeout(Some(TIMEOUT)).map_err(|e| e.to_string())?;
    write!(stream, "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\nConnection: close\r\n\r\n").map_err(|e| e.to_string())?;
    let mut response = Vec::new();
    let mut chunk = [0u8; 16 * 1024];
    loop {
        if let Some(body) = complete_body(&response) {
            return Ok(body);
        }
        let read = stream.read(&mut chunk).map_err(|e| e.to_string())?;
        if read == 0 {
            // Fermée pour de bon : tout ce qui suit l'en-tête est le corps.
            let text = String::from_utf8_lossy(&response);
            return text.split_once("\r\n\r\n").map(|(_, body)| body.to_owned()).ok_or_else(|| "réponse HTTP illisible".to_string());
        }
        response.extend_from_slice(&chunk[..read]);
    }
}

/// Le corps d'une réponse HTTP, dès qu'il est arrivé en entier d'après son `Content-Length`.
fn complete_body(response: &[u8]) -> Option<String> {
    let end = response.windows(4).position(|w| w == b"\r\n\r\n")?;
    let head = String::from_utf8_lossy(&response[..end]);
    let length: usize = head.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        name.trim().eq_ignore_ascii_case("content-length").then(|| value.trim().parse().ok())?
    })?;
    let body = response.get(end + 4..end + 4 + length)?;
    Some(String::from_utf8_lossy(body).into_owned())
}

/// Adresse WebSocket du contexte JavaScript où vit `SteamClient`.
fn shared_context() -> Result<String, String> {
    let targets: Vec<Value> = serde_json::from_str(&http_get("/json")?).map_err(|e| e.to_string())?;
    targets
        .iter()
        .find(|t| t["title"] == "SharedJSContext")
        .and_then(|t| t["webSocketDebuggerUrl"].as_str())
        .map(str::to_owned)
        .ok_or_else(|| "contexte SharedJSContext introuvable".to_string())
}

/// Évalue `expression` dans l'interface de Steam, en attendant sa promesse ; renvoie sa valeur.
fn evaluate(expression: &str) -> Result<Value, String> {
    let url = shared_context()?;
    let (mut socket, _) = tungstenite::connect(url.as_str()).map_err(|e| e.to_string())?;
    if let tungstenite::stream::MaybeTlsStream::Plain(stream) = socket.get_mut() {
        let _ = stream.set_read_timeout(Some(TIMEOUT));
    }
    let request = json!({
        "id": 1,
        "method": "Runtime.evaluate",
        "params": { "expression": expression, "awaitPromise": true, "returnByValue": true },
    });
    socket.send(Message::Text(request.to_string())).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + TIMEOUT;
    while Instant::now() < deadline {
        let Message::Text(text) = socket.read().map_err(|e| e.to_string())? else { continue };
        let reply: Value = serde_json::from_str(text.as_ref()).map_err(|e| e.to_string())?;
        if reply["id"] != 1 {
            continue;
        }
        let _ = socket.close(None);
        if let Some(error) = reply["result"]["exceptionDetails"].as_object() {
            return Err(error.get("text").and_then(Value::as_str).unwrap_or("erreur de Steam").to_owned());
        }
        return Ok(reply["result"]["result"]["value"].clone());
    }
    Err("Steam ne répond pas".to_string())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Action {
    Pause,
    Resume,
    /// Retire de la file : pour une mise à jour, elle attendra ; une installation, elle, s'annule
    /// par la désinstallation (voir `lib.rs`).
    Remove,
}

/// Pause, reprise ou retrait de la file, exactement comme les boutons de la liste de Steam : par
/// le plugin Millennium s'il tourne, sinon par le port de débogage.
pub fn download(steam_root: &Path, appid: u32, action: Action) -> Result<(), String> {
    if millennium::active(steam_root) {
        let name = match action {
            Action::Pause => "pause",
            Action::Resume => "resume",
            Action::Remove => "remove",
        };
        return millennium::download(steam_root, appid, name);
    }
    let client = LOCAL_CLIENT;
    let call = match action {
        Action::Pause => format!("await SteamClient.Downloads.PauseAppUpdate({appid}, '{client}');"),
        // Reprendre un jeu ne suffit pas si toute la file est en pause : Steam fait les deux.
        Action::Resume => format!(
            "await SteamClient.Downloads.ResumeAppUpdate({appid}, '{client}');\
             await SteamClient.Downloads.EnableAllDownloads(true, '{client}');"
        ),
        Action::Remove => format!("await SteamClient.Downloads.RemoveFromDownloadList({appid}, '{client}');"),
    };
    evaluate(&format!("(async () => {{ {call} return true; }})()")).map(|_| ())
}

/* ─── Redémarrage de Steam ────────────────────────────────────────────────────────────── */

/// Identifiant du processus `steam.exe`, s'il tourne.
#[cfg(windows)]
pub fn steam_pid() -> Option<u32> {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return None;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut pid = None;
        let mut more = Process32FirstW(snapshot, &mut entry) != 0;
        while more {
            let name = &entry.szExeFile;
            let len = name.iter().position(|&c| c == 0).unwrap_or(name.len());
            if String::from_utf16_lossy(&name[..len]).eq_ignore_ascii_case("steam.exe") {
                pid = Some(entry.th32ProcessID);
                break;
            }
            more = Process32NextW(snapshot, &mut entry) != 0;
        }
        CloseHandle(snapshot);
        pid
    }
}

#[cfg(not(windows))]
pub fn steam_pid() -> Option<u32> {
    None
}

/// Ferme Steam proprement, attend qu'il soit parti, puis le relance : il lit alors le fichier, et
/// Millennium charge (ou lâche) le plugin.
pub fn restart(steam_root: &Path) -> Result<(), String> {
    crate::steam::exit()?;
    let deadline = Instant::now() + Duration::from_secs(40);
    while steam_pid().is_some() {
        if Instant::now() >= deadline {
            return Err("Steam ne s'est pas fermé".to_string());
        }
        std::thread::sleep(Duration::from_millis(400));
    }
    // Steam fermé, Millennium aussi : sa configuration peut être modifiée sans être réécrite.
    // Une erreur ici n'empêche pas de relancer Steam.
    let synced = millennium::sync_config(steam_root);
    // Relancé par l'explorateur, pas comme enfant de 3DSteam : fermer 3DSteam (ou le relancer en
    // développement) ne doit pas emporter Steam avec lui.
    #[cfg(windows)]
    let mut command = {
        let mut c = std::process::Command::new("explorer");
        c.arg(steam_root.join("steam.exe"));
        c
    };
    #[cfg(not(windows))]
    let mut command = {
        let _ = steam_root;
        std::process::Command::new("steam")
    };
    command.spawn().map_err(|e| format!("Steam : {e}"))?;
    synced.map_err(|e| format!("Millennium : {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_body_without_waiting_for_close() {
        let head = b"HTTP/1.1 200 OK\r\nContent-Length:7\r\nContent-Type:application/json\r\n\r\n";
        let mut response = head.to_vec();
        response.extend_from_slice(b"[{\"a\"");
        assert_eq!(complete_body(&response), None);
        response.extend_from_slice(b":1}]");
        assert_eq!(complete_body(&response).as_deref(), Some("[{\"a\":1"));
    }

    #[test]
    fn detects_private_debug_pipe_from_last_launch() {
        let plain = "[2026-08-10 07:55:48] Startup - webhelper launched pid: 1 commandline: \"steamwebhelper.exe\" -nocrashdialog -lang=fr_FR";
        let piped = "[2026-10-01 19:08:18] Startup - webhelper launched pid: 2 commandline: \"steamwebhelper.exe\" --millennium-loopback-ipc-handles=1540,1552 --remote-debugging-io-pipes=1520,1532 --remote-debugging-pipe -nocrashdialog";
        let other = "[2026-10-01 19:10:00] SP Shared JS Context-'SharedJSCo': CreatingPopup name:notificationtoasts";
        assert!(last_launch_uses_pipe(&format!("{plain}\n{piped}\n{other}")));
        // Millennium désinstallé : seul le dernier lancement compte.
        assert!(!last_launch_uses_pipe(&format!("{piped}\n{plain}\n{other}")));
        assert!(!last_launch_uses_pipe(other));
        assert!(!last_launch_uses_pipe(""));
    }

    /// État réel sur ce PC, port et canal privé compris : `cargo test steamctl -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_state() {
        let root = crate::steam::find_steam_root().expect("Steam introuvable");
        println!("{:?}", state(&root));
    }

    /// Port de Steam réel, s'il est ouvert : `cargo test steamctl -- --ignored --nocapture`.
    /// Lecture seule : vérifie que l'API de pause existe, sans rien mettre en pause.
    #[test]
    #[ignore]
    fn live_port() {
        let start = Instant::now();
        let url = shared_context().expect("port fermé ou contexte introuvable");
        println!("SharedJSContext en {:?} : {url}", start.elapsed());
        let kind = evaluate("typeof SteamClient.Downloads.PauseAppUpdate").expect("évaluation refusée");
        println!("PauseAppUpdate : {kind}");
        assert_eq!(kind, "function");
    }
}
