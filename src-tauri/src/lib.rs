mod appinfo;
mod battery;
mod cache;
mod gamewatch;
mod icons;
mod media;
#[cfg(windows)]
mod padmouse;
mod profile;
mod progress;
mod shortcuts;
mod steam;
mod startup;
mod steamctl;
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
    let mut dirs = vec![
        steam_root.join("appcache").join("librarycache"),
        steam_root.join("steam").join("games"),
        // Avatar du compte, pour la page Profil.
        steam_root.join("config").join("avatarcache"),
    ];
    // Les visuels choisis pour les jeux hors Steam.
    if let Some(user) = steam::user_dir(steam_root) {
        dirs.push(shortcuts::grid_dir(&user));
    }
    for dir in dirs.iter().filter(|d| d.is_dir()) {
        if let Err(e) = app.asset_protocol_scope().allow_directory(dir, true) {
            eprintln!("[3dsteam] scope asset refusé pour {} : {e}", dir.display());
        }
    }
}

/// L'icône choisie pour un jeu hors Steam peut être n'importe où sur le disque : seul ce fichier est
/// autorisé, pas son dossier.
fn allow_shortcut_icons(app: &AppHandle, games: &[steam::Game]) {
    for path in games.iter().filter(|g| g.shortcut).filter_map(|g| g.art.icon.as_deref()) {
        let _ = app.asset_protocol_scope().allow_file(path);
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

/// Téléchargements en cours et leur progression en direct (voir `progress.rs`).
#[tauri::command]
fn downloads() -> Vec<progress::Download> {
    steam_root().map(progress::downloads).unwrap_or_default()
}

/// Ouvre la boîte d'installation de Steam. Avec `padMouse`, la manette et le clavier pilotent le
/// curseur tant que la fenêtre est ouverte (voir `padmouse.rs`), puis 3DSteam reprend le focus.
/// Renvoie vrai si une fenêtre a bien été prise en charge.
#[tauri::command]
async fn install_game(app: AppHandle, appid: u32, pad_mouse: bool) -> Result<bool, String> {
    steam_dialog(app, pad_mouse, move || steam::install(appid)).await
}

/// Ouvre la boîte de désinstallation de Steam, pilotable de la même façon : c'est l'utilisateur
/// qui confirme, dans Steam.
#[tauri::command]
async fn uninstall_game(app: AppHandle, appid: u32, pad_mouse: bool) -> Result<bool, String> {
    steam_dialog(app, pad_mouse, move || steam::uninstall(appid)).await
}

/// Ouvre une boîte de Steam par `open`, puis la fait piloter au clavier et à la manette.
async fn steam_dialog(
    app: AppHandle,
    pad_mouse: bool,
    open: impl FnOnce() -> Result<(), String>,
) -> Result<bool, String> {
    #[cfg(windows)]
    {
        // Relevé avant la demande : seule une fenêtre apparue ensuite sera prise en charge.
        let before = if pad_mouse { padmouse::windows() } else { Vec::new() };
        open()?;
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
        open().map(|_| false)
    }
}

/// Comment une action sur un téléchargement a été menée.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
enum Handled {
    /// Directement, par l'interface de Steam (`steamctl.rs`).
    Direct,
    /// Par la boîte de désinstallation de Steam, qui demande confirmation.
    Dialog,
    /// Par la liste des téléchargements de Steam, ouverte à l'écran, à piloter soi-même.
    Steam,
}

/// Pause, reprise ou annulation d'un téléchargement.
///
/// Annuler une installation, c'est désinstaller ce qui a déjà été reçu : la boîte de Steam le
/// confirme. Le reste passe par l'interface de Steam quand son port de débogage est ouvert ; sinon
/// sa liste des téléchargements s'ouvre, pilotable au clavier et à la manette (Ⓑ ou Échap pour
/// revenir).
#[tauri::command]
async fn download_action(
    app: AppHandle,
    appid: u32,
    action: String,
    installed: bool,
    pad_mouse: bool,
) -> Result<Handled, String> {
    let action = match action.as_str() {
        "pause" => steamctl::Action::Pause,
        "resume" => steamctl::Action::Resume,
        "cancel" if !installed => {
            steam_dialog(app, pad_mouse, move || steam::uninstall(appid)).await?;
            return Ok(Handled::Dialog);
        }
        "cancel" => steamctl::Action::Remove,
        other => return Err(format!("action inconnue : {other}")),
    };
    let direct = tauri::async_runtime::spawn_blocking(move || steamctl::download(appid, action))
        .await
        .map_err(|e| e.to_string())?;
    if direct.is_ok() {
        return Ok(Handled::Direct);
    }
    steam::open_downloads()?;
    #[cfg(windows)]
    if pad_mouse {
        let handled = tauri::async_runtime::spawn_blocking(|| {
            padmouse::drive_main(Duration::from_secs(8), Duration::from_secs(300))
        })
        .await
        .map_err(|e| e.to_string())?;
        if handled {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }
    }
    #[cfg(not(windows))]
    let _ = (app, pad_mouse);
    Ok(Handled::Steam)
}

/// Ouvre `asset://` sur ces dossiers, et seulement ceux-là : l'appli doit pouvoir lire la
/// musique et les captures qu'elle liste.
fn allow_media(app: &AppHandle, roots: &[(PathBuf, &'static str)]) {
    for (dir, _) in roots {
        if let Err(e) = app.asset_protocol_scope().allow_directory(dir, true) {
            eprintln!("[3dsteam] scope asset refusé pour {} : {e}", dir.display());
        }
    }
}

/// Journal d'activité : temps de jeu total et des deux dernières semaines, par application.
#[tauri::command]
fn activity() -> Vec<steam::Activity> {
    steam_root().map(steam::activity).unwrap_or_default()
}

/// Lecteur de musique : bandes-son Steam et dossier Musique.
#[tauri::command]
async fn music_library(app: AppHandle) -> Result<Vec<media::Track>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let libraries = steam_root().map(steam::library_folders).unwrap_or_default();
        let roots = media::music_roots(&libraries);
        allow_media(&app, &roots);
        media::music(&roots)
    })
    .await
    .map_err(|e| e.to_string())
}

/// Album : captures Steam, Windows et Xbox Game Bar, les plus récentes d'abord.
#[tauri::command]
async fn screenshots(app: AppHandle) -> Result<Vec<media::Shot>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let user = steam_root().and_then(steam::user_dir);
        let roots = media::shot_roots(user.as_deref());
        allow_media(&app, &roots);
        media::screenshots(&roots)
    })
    .await
    .map_err(|e| e.to_string())
}

/// État du contrôle direct. Il interroge le port de Steam : jamais sur le fil de l'interface,
/// qui se figerait le temps de la réponse.
#[tauri::command]
async fn steam_control_state() -> Result<steamctl::ControlState, String> {
    let root = steam_root().ok_or("Installation de Steam introuvable")?;
    tauri::async_runtime::spawn_blocking(move || steamctl::state(root))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn set_steam_control(enabled: bool) -> Result<steamctl::ControlState, String> {
    let root = steam_root().ok_or("Installation de Steam introuvable")?;
    tauri::async_runtime::spawn_blocking(move || steamctl::set_enabled(root, enabled))
        .await
        .map_err(|e| e.to_string())?
}

/// Relance Steam pour qu'il prenne en compte le réglage : il se ferme proprement, puis revient.
#[tauri::command]
async fn restart_steam() -> Result<(), String> {
    let root = steam_root().ok_or("Installation de Steam introuvable")?;
    tauri::async_runtime::spawn_blocking(move || steamctl::restart(root))
        .await
        .map_err(|e| e.to_string())?
}

/// Réglages de démarrage, tels que l'écran des paramètres les montre.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Startup {
    #[serde(flatten)]
    settings: startup::Settings,
    /// Inscrit au démarrage de Windows (lu dans le registre, pas dans le fichier).
    autostart: bool,
    /// Ce lancement-ci vient de Windows.
    autostarted: bool,
}

#[tauri::command]
fn startup_settings(app: AppHandle) -> Result<Startup, String> {
    Ok(Startup {
        settings: startup::load(&app_data_dir(&app)?),
        autostart: startup::autostart_enabled(),
        autostarted: startup::autostarted(),
    })
}

#[tauri::command]
fn set_startup_mode(app: AppHandle, mode: startup::Mode, autostart_minimized: bool) -> Result<Startup, String> {
    let dir = app_data_dir(&app)?;
    startup::save(&dir, &startup::Settings { mode, autostart_minimized })?;
    startup_settings(app)
}

#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<Startup, String> {
    startup::set_autostart(enabled)?;
    startup_settings(app)
}

/// Le jeu lancé est-il vraiment ouvert (une fenêtre à lui à l'écran) ? Voir `gamewatch.rs`.
#[tauri::command]
async fn game_state(appid: u32) -> Result<gamewatch::GameState, String> {
    let root = steam_root().ok_or("Installation de Steam introuvable")?;
    tauri::async_runtime::spawn_blocking(move || gamewatch::state(root, appid))
        .await
        .map_err(|e| e.to_string())
}

/// Jeux qui tournent en ce moment (voir `gamewatch.rs`) : on ne les relance pas, on peut les arrêter.
#[tauri::command]
async fn running_games() -> Result<Vec<u32>, String> {
    let Some(root) = steam_root() else { return Ok(Vec::new()) };
    tauri::async_runtime::spawn_blocking(move || gamewatch::running_games(root))
        .await
        .map_err(|e| e.to_string())
}

/// Arrête un jeu : demande à ses fenêtres de se fermer, ou (`force`) termine ses processus.
#[tauri::command]
async fn stop_game(appid: u32, force: bool) -> Result<gamewatch::StopOutcome, String> {
    let root = steam_root().ok_or("Installation de Steam introuvable")?;
    tauri::async_runtime::spawn_blocking(move || gamewatch::stop(root, appid, force))
        .await
        .map_err(|e| e.to_string())
}

/// Bouton marche/arrêt : quitte 3DSteam. Steam, lui, reste ouvert.
#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// Bouton marche/arrêt : réduit la fenêtre, pour revenir au bureau sans quitter.
#[tauri::command]
fn minimize_app(app: AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("fenêtre introuvable")?;
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
fn open_store(appid: u32) -> Result<(), String> {
    steam::open_store(appid)
}

#[tauri::command]
fn open_downloads() -> Result<(), String> {
    steam::open_downloads()
}

/// « Afficher les fichiers » : le dossier du jeu dans l'explorateur.
#[tauri::command]
fn reveal_game(appid: u32, library_path: String, install_dir: String) -> Result<(), String> {
    let dir = if shortcuts::is_shortcut(appid) {
        steam_root().and_then(steam::user_dir).and_then(|user| shortcuts::folder(&user, appid))
    } else {
        steam::game_dir(&library_path, &install_dir)
    };
    let dir = dir.ok_or_else(|| "Dossier du jeu introuvable".to_string())?;
    themes::reveal(&dir)
}

/// Lecture instantanée du cache (appelée au tout premier rendu).
#[tauri::command]
fn load_cache(app: AppHandle) -> Result<Option<Library>, String> {
    let library = cache::load(&app_data_dir(&app)?)?;
    if let Some(library) = &library {
        allow_shortcut_icons(&app, &library.games);
    }
    Ok(library)
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
        allow_shortcut_icons(&handle, &scan.games);
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

/// « Exporter » un Svgii : un petit fichier texte (son code), à envoyer à un ami.
#[tauri::command]
fn save_svgii_file(app: AppHandle, file_name: String, content: String) -> Result<String, String> {
    let dir = themes::svgii_dir(&app_data_dir(&app)?)?;
    themes::save_as(&dir, &file_name, "svgii", &content).map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn open_svgii_dir(app: AppHandle) -> Result<(), String> {
    themes::reveal(&themes::svgii_dir(&app_data_dir(&app)?)?)
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

/// Profil Steam du compte actif, lu en local (voir `profile.rs`).
#[tauri::command]
async fn steam_profile() -> Result<Option<profile::SteamProfile>, String> {
    let Some(root) = steam_root() else { return Ok(None) };
    tauri::async_runtime::spawn_blocking(move || profile::load(root))
        .await
        .map_err(|e| e.to_string())
}

/// Pseudo Steam du compte actif, pour nommer le profil au premier lancement.
#[tauri::command]
fn steam_persona() -> Option<String> {
    steam_root().and_then(steam::persona_name)
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
            let dir = app_data_dir(app.handle()).ok();
            if let Some(dir) = &dir {
                allow_derived_icons(app.handle(), dir);
            }
            // La fenêtre est créée invisible : elle ne se montre qu'une fois dans l'état voulu.
            let settings = dir.as_deref().map(startup::load).unwrap_or_default();
            if let Some(window) = app.get_webview_window("main") {
                startup::apply(&window, startup::effective(&settings, startup::autostarted()));
            }
            startup::repair_autostart();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_cache,
            scan_library,
            launch_game,
            install_game,
            uninstall_game,
            download_action,
            activity,
            music_library,
            screenshots,
            steam_control_state,
            set_steam_control,
            restart_steam,
            quit_app,
            game_state,
            running_games,
            stop_game,
            minimize_app,
            startup_settings,
            set_startup_mode,
            set_autostart,
            open_store,
            open_downloads,
            reveal_game,
            downloads,
            battery_status,
            steam_persona,
            steam_profile,
            clear_cache,
            list_theme_files,
            save_theme_file,
            open_themes_dir,
            save_svgii_file,
            open_svgii_dir
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de 3DSteam");
}
