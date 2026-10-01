//! Dossier des thèmes partagés (`<données de l'app>/themes/*.3dstheme`) : on y dépose un thème
//! téléchargé pour l'installer, et « Exporter » y enregistre les siens.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

const EXTENSIONS: &[&str] = &["3dstheme", "json"];
/// Un thème peut embarquer une image de fond, mais pas des dizaines de Mo.
const MAX_SIZE: u64 = 8 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeFile {
    pub file_name: String,
    pub content: String,
}

pub fn dir(app_data_dir: &Path) -> Result<PathBuf, String> {
    let dir = app_data_dir.join("themes");
    fs::create_dir_all(&dir).map_err(|e| format!("création de {} : {e}", dir.display()))?;
    Ok(dir)
}

pub fn list(dir: &Path) -> Vec<ThemeFile> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut files: Vec<ThemeFile> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        })
        .filter(|p| fs::metadata(p).is_ok_and(|m| m.len() <= MAX_SIZE))
        .filter_map(|p| {
            Some(ThemeFile {
                file_name: p.file_name()?.to_string_lossy().into_owned(),
                content: fs::read_to_string(&p).ok()?,
            })
        })
        .collect();
    files.sort_by(|a, b| a.file_name.cmp(&b.file_name));
    files
}

/// Enregistre un thème ; le nom de fichier est nettoyé (pas de chemin, pas de caractère spécial).
pub fn save(dir: &Path, file_name: &str, content: &str) -> Result<PathBuf, String> {
    save_as(dir, file_name, "3dstheme", content)
}

/// Enregistre un fichier partageable (thème, Svgii) sous `<nom nettoyé>.<extension>`.
pub fn save_as(dir: &Path, file_name: &str, extension: &str, content: &str) -> Result<PathBuf, String> {
    let stem: String = file_name
        .trim_end_matches(&format!(".{extension}"))
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(64)
        .collect();
    let stem = if stem.is_empty() { extension.to_string() } else { stem };
    let path = dir.join(format!("{stem}.{extension}"));
    fs::write(&path, content).map_err(|e| format!("écriture de {} : {e}", path.display()))?;
    Ok(path)
}

/// Dossier des Svgii exportés (`<données de l'app>/svgii/*.svgii`), à envoyer à un ami.
pub fn svgii_dir(app_data_dir: &Path) -> Result<PathBuf, String> {
    let dir = app_data_dir.join("svgii");
    fs::create_dir_all(&dir).map_err(|e| format!("création de {} : {e}", dir.display()))?;
    Ok(dir)
}

/// Ouvre le dossier dans l'explorateur de fichiers.
pub fn reveal(dir: &Path) -> Result<(), String> {
    #[cfg(windows)]
    let program = "explorer";
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(all(unix, not(target_os = "macos")))]
    let program = "xdg-open";
    std::process::Command::new(program)
        .arg(dir)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}
