mod appinfo;
mod battery;
mod cache;
mod icons;
#[cfg(windows)]
mod padmouse;
mod steam;
mod themes;
mod vdf;

use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::Duration;

use tauri::{AppHandle, Manager};

use cache::Library;

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

/// Autorise le protocole `asset://` à servir les visuels de Steam (jaquettes du cache et icônes
/// des jeux), et rien d'autre.
fn allow_steam_artwork(app: &AppHandle, steam_root: &std::path::Path) {
    let dirs = [
        steam_root.join("appcache").join("librarycache"),
        steam_root.join("steam").join("games"),
    ];
    for dir in dirs.iter().filter(|d| d.is_dir()) {
        if let Err(e) = app.asset_protocol_scope().allow_directory(dir, true) {
            eprintln!("[3dsteam] scope asset refusé pour {} : {e}", dir.display());
        }
    }
}

/// Autorise `asset://` à servir les icônes dérivées (la plus grande image extraite d'un `.ico`).
/// Appelé dès le démarrage : le cache peut déjà pointer vers elles au premier rendu.
fn allow_derived_icons(app: &AppHandle, app_data_dir: &std::path::Path) {
    let dir = icons::dir(app_data_dir);
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return eprintln!("[3dsteam] dossier d'icônes indisponible : {e}");
    }
    if let Err(e) = app.asset_protocol_scope().allow_directory(&dir, true) {
        eprintln!("[3dsteam] scope asset refusé pour {} : {e}", dir.display());
    }
}

/// Racine de Steam, cherchée une seule fois : la vue des téléchargements interroge souvent.
fn steam_root() -> Option<&'static std::path::Path> {
    static ROOT: OnceLock<Option<PathBuf>> = OnceLock::new();
    ROOT.get_or_init(steam::find_steam_root).as_deref()
}

/// Téléchargements en cours, relus à chaque appel dans les manifestes.
#[tauri::command]
fn downloads() -> Vec<steam::Download> {
    steam_root().map(steam::downloads).unwrap_or_default()
}

/// Ouvre la boîte d'installation de Steam. Avec `padMouse`, la manette pilote le curseur tant que
/// la fenêtre est ouverte (voir `padmouse.rs`), puis 3DSteam reprend le focus. Renvoie vrai si une
/// fenêtre a bien été prise en charge.
#[tauri::command]
async fn install_game(app: AppHandle, appid: u32, pad_mouse: bool) -> Result<bool, String> {
    #[cfg(windows)]
    {
        // Relevé avant la demande : seule une fenêtre apparue ensuite sera prise en charge.
        let before = if pad_mouse { padmouse::windows() } else { Vec::new() };
        steam::install(appid)?;
        if !pad_mouse {
            return Ok(false);
        }
        let handled = tauri::async_runtime::spawn_blocking(move || {
            padmouse::drive(&before, Duration::from_secs(20), Duration::from_secs(300))
        })
        .await
        .map_err(|e| e.to_string())?;
        // Steam n'est plus à l'écran : on reprend la main.
        if handled {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }
        Ok(handled)
    }
    #[cfg(not(windows))]
    {
        let _ = (app, pad_mouse);
        steam::install(appid).map(|_| false)
    }
}

/// Lecture instantanée du cache (appelée au tout premier rendu).
#[tauri::command]
fn load_cache(app: AppHandle) -> Result<Option<Library>, String> {
    cache::load(&app_data_dir(&app)?)
}

/// Scan complet des bibliothèques Steam, hors du thread principal, puis mise à jour du cache.
#[tauri::command]
async fn scan_library(app: AppHandle) -> Result<Library, String> {
    let dir = app_data_dir(&app)?;
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let root = steam::find_steam_root()
            .ok_or_else(|| "Installation de Steam introuvable".to_string())?;
        allow_steam_artwork(&handle, &root);
        let mut scan = steam::scan(&root);
        // Chaque icône est ramenée à sa plus grande image avant d'atteindre le front.
        icons::refine(&mut scan.games, &dir);
        let library = Library::new(Some(root.as_path()), scan);
        if let Err(e) = cache::save(&dir, &library) {
            eprintln!("[3dsteam] cache non sauvegardé : {e}");
        }
        Ok(library)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Thèmes déposés dans le dossier des thèmes.
#[tauri::command]
fn list_theme_files(app: AppHandle) -> Result<Vec<themes::ThemeFile>, String> {
    Ok(themes::list(&themes::dir(&app_data_dir(&app)?)?))
}

/// « Exporter » : enregistre un thème dans le dossier des thèmes et renvoie son chemin.
#[tauri::command]
fn save_theme_file(app: AppHandle, file_name: String, content: String) -> Result<String, String> {
    let dir = themes::dir(&app_data_dir(&app)?)?;
    themes::save(&dir, &file_name, &content).map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn open_themes_dir(app: AppHandle) -> Result<(), String> {
    themes::reveal(&themes::dir(&app_data_dir(&app)?)?)
}

/// Supprime `games_cache.json` (bouton « Vider le cache » des paramètres).
#[tauri::command]
fn clear_cache(app: AppHandle) -> Result<(), String> {
    let dir = app_data_dir(&app)?;
    icons::clear(&dir)?;
    cache::clear(&dir)
}

/// Niveau de batterie, ou `null` sur un PC sans batterie.
#[tauri::command]
fn battery_status() -> Option<battery::Battery> {
    battery::status()
}

#[tauri::command]
fn launch_game(appid: u32) -> Result<(), String> {
    steam::launch(appid)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // La lecture du registre est quasi instantanée : les images du cache s'affichent
            // dès le premier rendu, avant même la fin du scan.
            if let Some(root) = steam::find_steam_root() {
                allow_steam_artwork(app.handle(), &root);
            }
            if let Ok(dir) = app_data_dir(app.handle()) {
                allow_derived_icons(app.handle(), &dir);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_cache,
            scan_library,
            launch_game,
            install_game,
            downloads,
            battery_status,
            clear_cache,
            list_theme_files,
            save_theme_file,
            open_themes_dir
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de 3DSteam");
}
