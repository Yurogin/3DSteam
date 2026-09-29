//! Cache local `games_cache.json` : affichage instantané de la bibliothèque au démarrage.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::steam::Game;

pub const CACHE_FILE: &str = "games_cache.json";
/// Incrémenter si la structure de `Game` change : l'ancien cache est alors ignoré.
pub const CACHE_VERSION: u32 = 2;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Library {
    pub version: u32,
    /// Horodatage Unix (secondes) du dernier scan.
    pub scanned_at: u64,
    pub steam_root: Option<String>,
    pub games: Vec<Game>,
}

impl Library {
    pub fn new(steam_root: Option<&Path>, games: Vec<Game>) -> Self {
        let scanned_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        Self {
            version: CACHE_VERSION,
            scanned_at,
            steam_root: steam_root.map(|p| p.to_string_lossy().into_owned()),
            games,
        }
    }
}

pub fn cache_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(CACHE_FILE)
}

/// `Ok(None)` si le cache n'existe pas encore ou provient d'une ancienne version.
pub fn load(app_data_dir: &Path) -> Result<Option<Library>, String> {
    let path = cache_path(app_data_dir);
    let bytes = match fs::read(&path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("lecture de {} : {e}", path.display())),
    };
    match serde_json::from_slice::<Library>(&bytes) {
        Ok(lib) if lib.version == CACHE_VERSION => Ok(Some(lib)),
        // Cache corrompu ou obsolète : on le traite comme absent, le scan le réécrira.
        _ => Ok(None),
    }
}

/// Supprime le cache (il sera recréé au prochain scan).
pub fn clear(app_data_dir: &Path) -> Result<(), String> {
    match fs::remove_file(cache_path(app_data_dir)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Écriture atomique (fichier temporaire + renommage) pour ne jamais laisser un cache à moitié écrit.
pub fn save(app_data_dir: &Path, library: &Library) -> Result<(), String> {
    fs::create_dir_all(app_data_dir).map_err(|e| format!("création de {} : {e}", app_data_dir.display()))?;
    let path = cache_path(app_data_dir);
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_vec(library).map_err(|e| e.to_string())?;
    fs::write(&tmp, json).map_err(|e| format!("écriture de {} : {e}", tmp.display()))?;
    fs::rename(&tmp, &path).map_err(|e| format!("renommage vers {} : {e}", path.display()))
}
