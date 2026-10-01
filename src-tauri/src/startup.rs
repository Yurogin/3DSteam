//! Démarrage de 3DSteam : avec Windows ou non, et dans quel état s'ouvre la fenêtre.
//!
//! Le réglage est appliqué ici, avant que la fenêtre ne s'affiche (elle est créée invisible,
//! voir `tauri.conf.json`) : rien ne clignote en passant de la fenêtre au plein écran, et une
//! fenêtre qui doit démarrer réduite ne se montre pas d'abord en grand.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::WebviewWindow;

/// Argument ajouté quand c'est Windows qui lance 3DSteam, à l'ouverture de session.
pub const AUTOSTART_ARG: &str = "--autostart";
const FILE: &str = "startup.json";
#[cfg(windows)]
const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
#[cfg(windows)]
const RUN_VALUE: &str = "3DSteam";

/// État de la fenêtre à l'ouverture.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    /// Comme à la dernière fermeture (plein écran ou non) : c'est l'interface qui le rétablit.
    #[default]
    Last,
    Window,
    Maximized,
    Fullscreen,
    Minimized,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub mode: Mode,
    /// Lancé par Windows à l'ouverture de session : réduit, quel que soit `mode`.
    pub autostart_minimized: bool,
}

fn path(dir: &Path) -> PathBuf {
    dir.join(FILE)
}

pub fn load(dir: &Path) -> Settings {
    std::fs::read_to_string(path(dir)).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default()
}

pub fn save(dir: &Path, settings: &Settings) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let text = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(path(dir), text).map_err(|e| e.to_string())
}

/// Lancé par Windows à l'ouverture de session (et non par l'utilisateur) ?
pub fn autostarted() -> bool {
    std::env::args().any(|a| a == AUTOSTART_ARG)
}

/// L'état qui s'applique à ce lancement-ci.
pub fn effective(settings: &Settings, autostarted: bool) -> Mode {
    if autostarted && settings.autostart_minimized {
        Mode::Minimized
    } else {
        settings.mode
    }
}

/// Met la fenêtre dans l'état voulu, puis l'affiche.
pub fn apply(window: &WebviewWindow, mode: Mode) {
    match mode {
        Mode::Fullscreen => {
            let _ = window.set_fullscreen(true);
        }
        Mode::Maximized => {
            let _ = window.maximize();
        }
        _ => {}
    }
    if mode == Mode::Minimized {
        show_minimized(window);
    } else {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Affichée directement réduite, dans la barre des tâches, sans prendre le focus. Mesuré :
/// `minimize` seul la laisse invisible (réduite mais absente de la barre, impossible à rouvrir),
/// et `show` puis `minimize` la faisait revenir en grand.
#[cfg(windows)]
fn show_minimized(window: &WebviewWindow) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOWMINNOACTIVE};
    match window.hwnd() {
        Ok(hwnd) => unsafe {
            ShowWindow(hwnd.0 as _, SW_SHOWMINNOACTIVE);
        },
        Err(_) => {
            let _ = window.show();
            let _ = window.minimize();
        }
    }
}

#[cfg(not(windows))]
fn show_minimized(window: &WebviewWindow) {
    let _ = window.show();
    let _ = window.minimize();
}

/* ─── Démarrage avec Windows ──────────────────────────────────────────────────────────── */

/// Commande enregistrée dans `Run` : l'exécutable actuel, avec l'argument d'ouverture de session.
#[cfg(windows)]
fn command_line() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok(format!("\"{}\" {AUTOSTART_ARG}", exe.display()))
}

#[cfg(windows)]
pub fn autostart_enabled() -> bool {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(RUN_KEY)
        .and_then(|key| key.get_value::<String, _>(RUN_VALUE))
        .is_ok()
}

#[cfg(windows)]
pub fn set_autostart(enabled: bool) -> Result<(), String> {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};
    use winreg::RegKey;
    let key = RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(RUN_KEY, KEY_SET_VALUE).map_err(|e| e.to_string())?;
    if enabled {
        key.set_value(RUN_VALUE, &command_line()?).map_err(|e| e.to_string())
    } else {
        match key.delete_value(RUN_VALUE) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
            _ => Ok(()),
        }
    }
}

/// L'exécutable a changé de place (mise à jour, réinstallation) : l'entrée `Run` pointerait
/// dans le vide. On la remet sur l'exécutable actuel — seulement si l'ancien n'existe plus, pour
/// qu'une version de développement ne détourne pas l'entrée de la version installée.
#[cfg(windows)]
pub fn repair_autostart() {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let Ok(current) = RegKey::predef(HKEY_CURRENT_USER).open_subkey(RUN_KEY).and_then(|k| k.get_value::<String, _>(RUN_VALUE)) else {
        return;
    };
    let registered = current.trim().trim_start_matches('"').split('"').next().unwrap_or_default();
    if !Path::new(registered).exists() {
        let _ = set_autostart(true);
    }
}

#[cfg(not(windows))]
pub fn autostart_enabled() -> bool {
    false
}

#[cfg(not(windows))]
pub fn set_autostart(_enabled: bool) -> Result<(), String> {
    Err("Démarrage automatique disponible sous Windows seulement".to_string())
}

#[cfg(not(windows))]
pub fn repair_autostart() {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn autostart_can_force_minimized() {
        let settings = Settings { mode: Mode::Fullscreen, autostart_minimized: true };
        assert_eq!(effective(&settings, false), Mode::Fullscreen);
        assert_eq!(effective(&settings, true), Mode::Minimized);
        let settings = Settings { mode: Mode::Fullscreen, autostart_minimized: false };
        assert_eq!(effective(&settings, true), Mode::Fullscreen);
    }

    #[test]
    fn old_or_partial_files_still_load() {
        let settings: Settings = serde_json::from_str(r#"{ "mode": "maximized" }"#).unwrap();
        assert_eq!(settings.mode, Mode::Maximized);
        assert!(!settings.autostart_minimized);
    }
}
