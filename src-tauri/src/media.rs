//! Ce que lisent les applis intégrées : la musique (lecteur) et les captures d'écran (album).
//!
//! Musique : les bandes-son achetées sur Steam (`steamapps/music`, avec leur pochette) et le
//! dossier Musique de l'utilisateur. Les titres viennent des étiquettes FLAC et MP3 quand il y en
//! a, du nom de fichier sinon. Captures : celles de Steam (rangées par jeu), celles de Windows
//! (Win + Impr. écran) et celles de la Xbox Game Bar.

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

const AUDIO: &[&str] = &["mp3", "flac", "ogg", "opus", "m4a", "aac", "wav"];
const IMAGES: &[&str] = &["png", "jpg", "jpeg"];
/// Noms de pochette usuels, essayés avant toute autre image du dossier.
const COVERS: &[&str] = &["cover", "folder", "front", "albumart", "album"];
/// Garde-fous : un dossier Musique énorme ne doit pas figer l'appli.
const MAX_TRACKS: usize = 5000;
const MAX_SHOTS: usize = 3000;
const MAX_DEPTH: usize = 6;

/* ─── Dossiers de l'utilisateur ───────────────────────────────────────────────────────── */

/// Dossiers connus de Windows (Musique, Images, Vidéos), là où l'utilisateur les a vraiment mis :
/// ils peuvent être déplacés, ou synchronisés par OneDrive.
#[cfg(windows)]
fn known_folder(name: &str) -> Option<PathBuf> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let key = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders")
        .ok()?;
    let path: String = key.get_value(name).ok()?;
    Some(PathBuf::from(path))
}

#[cfg(not(windows))]
fn known_folder(name: &str) -> Option<PathBuf> {
    let home = PathBuf::from(std::env::var_os("HOME")?);
    Some(match name {
        "My Music" => home.join("Music"),
        "My Pictures" => home.join("Pictures"),
        _ => home.join("Videos"),
    })
}

/// Dossier des captures Windows (Win + Impr. écran), s'il a été déplacé, sinon `Images\Screenshots`.
fn windows_screenshots() -> Option<PathBuf> {
    #[cfg(windows)]
    if let Some(dir) = known_folder("{B7BEDE81-DF94-4682-A7D8-57A52620B86F}") {
        return Some(dir);
    }
    known_folder("My Pictures").map(|p| p.join("Screenshots"))
}

fn has_ext(path: &Path, list: &[&str]) -> bool {
    path.extension().and_then(|e| e.to_str()).is_some_and(|e| list.iter().any(|x| e.eq_ignore_ascii_case(x)))
}

/// Fichiers sous `dir`, en profondeur limitée, sans suivre les liens.
fn walk(dir: &Path, depth: usize, out: &mut Vec<PathBuf>, keep: &dyn Fn(&Path) -> bool, max: usize) {
    if depth > MAX_DEPTH || out.len() >= max {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else { return };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let Ok(kind) = entry.file_type() else { continue };
        let path = entry.path();
        if kind.is_dir() {
            walk(&path, depth + 1, out, keep, max);
        } else if kind.is_file() && keep(&path) {
            out.push(path);
            if out.len() >= max {
                return;
            }
        }
    }
}

fn modified(path: &Path) -> u64 {
    path.metadata()
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_secs())
}

fn text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/* ─── Musique ─────────────────────────────────────────────────────────────────────────── */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub path: String,
    pub title: String,
    pub artist: Option<String>,
    pub album: String,
    pub number: Option<u32>,
    pub cover: Option<String>,
    /// `soundtrack` (Steam) ou `music` (dossier Musique).
    pub source: &'static str,
}

#[derive(Debug, Default, PartialEq)]
struct Tags {
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    number: Option<u32>,
}

/// « 3/12 » → 3.
fn track_number(value: &str) -> Option<u32> {
    value.split('/').next()?.trim().parse().ok()
}

/// Commentaires Vorbis d'un FLAC : blocs de métadonnées, le n° 4 porte `TITLE=…`, `ARTIST=…`.
fn flac_tags(file: &mut File) -> Option<Tags> {
    let mut magic = [0u8; 4];
    file.read_exact(&mut magic).ok()?;
    if &magic != b"fLaC" {
        return None;
    }
    loop {
        let mut header = [0u8; 4];
        file.read_exact(&mut header).ok()?;
        let last = header[0] & 0x80 != 0;
        let kind = header[0] & 0x7f;
        let len = u32::from_be_bytes([0, header[1], header[2], header[3]]) as usize;
        if kind == 4 {
            let mut block = vec![0u8; len.min(1 << 20)];
            file.read_exact(&mut block).ok()?;
            return Some(vorbis_comments(&block));
        }
        // Les pochettes intégrées (bloc 6) peuvent peser lourd : on les saute.
        file.seek(SeekFrom::Current(len as i64)).ok()?;
        if last {
            return None;
        }
    }
}

fn vorbis_comments(block: &[u8]) -> Tags {
    let mut tags = Tags::default();
    let u32_at = |at: usize| block.get(at..at + 4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize);
    let Some(vendor) = u32_at(0) else { return tags };
    let mut at = 4 + vendor;
    let Some(count) = u32_at(at) else { return tags };
    at += 4;
    for _ in 0..count {
        let Some(len) = u32_at(at) else { break };
        at += 4;
        let Some(raw) = block.get(at..at + len) else { break };
        at += len;
        let comment = String::from_utf8_lossy(raw);
        let Some((key, value)) = comment.split_once('=') else { continue };
        let value = value.trim().to_owned();
        match key.to_ascii_uppercase().as_str() {
            "TITLE" => tags.title = Some(value),
            "ARTIST" => tags.artist = Some(value),
            "ALBUM" => tags.album = Some(value),
            "TRACKNUMBER" => tags.number = track_number(&value),
            _ => {}
        }
    }
    tags
}

/// Étiquette ID3v2 d'un MP3 (versions 2.3 et 2.4) : titre, artiste, album, numéro.
fn id3_tags(file: &mut File) -> Option<Tags> {
    let mut header = [0u8; 10];
    file.read_exact(&mut header).ok()?;
    if &header[..3] != b"ID3" || !(3..=4).contains(&header[3]) {
        return None;
    }
    let version = header[3];
    let size = syncsafe(&header[6..10]);
    // Les cadres de texte précèdent d'ordinaire la pochette : pas besoin de tout lire.
    let mut tag = vec![0u8; size.min(512 * 1024)];
    let read = file.read(&mut tag).ok()?;
    tag.truncate(read);
    Some(id3_frames(&tag, version))
}

fn syncsafe(bytes: &[u8]) -> usize {
    bytes.iter().fold(0usize, |acc, b| (acc << 7) | (*b as usize & 0x7f))
}

fn id3_frames(tag: &[u8], version: u8) -> Tags {
    let mut tags = Tags::default();
    let mut at = 0;
    while at + 10 <= tag.len() {
        let id = &tag[at..at + 4];
        if id[0] == 0 {
            break;
        }
        let raw = &tag[at + 4..at + 8];
        let len = if version == 4 { syncsafe(raw) } else { u32::from_be_bytes([raw[0], raw[1], raw[2], raw[3]]) as usize };
        let Some(body) = tag.get(at + 10..at + 10 + len) else { break };
        at += 10 + len;
        let value = || id3_text(body);
        match id {
            b"TIT2" => tags.title = value(),
            b"TPE1" => tags.artist = value(),
            b"TALB" => tags.album = value(),
            b"TRCK" => tags.number = value().as_deref().and_then(track_number),
            _ => {}
        }
    }
    tags
}

/// Texte d'un cadre ID3 : le premier octet dit l'encodage.
fn id3_text(body: &[u8]) -> Option<String> {
    let (&encoding, data) = body.split_first()?;
    let text = match encoding {
        0 => data.iter().map(|&b| b as char).collect(),
        1 | 2 => {
            let (big_endian, data) = match data {
                [0xfe, 0xff, rest @ ..] => (true, rest),
                [0xff, 0xfe, rest @ ..] => (false, rest),
                _ => (encoding == 2, data),
            };
            let units: Vec<u16> = data
                .chunks_exact(2)
                .map(|c| if big_endian { u16::from_be_bytes([c[0], c[1]]) } else { u16::from_le_bytes([c[0], c[1]]) })
                .collect();
            String::from_utf16_lossy(&units)
        }
        _ => String::from_utf8_lossy(data).into_owned(),
    };
    let text = text.trim_matches(char::from(0)).trim().to_owned();
    (!text.is_empty()).then_some(text)
}

fn read_tags(path: &Path) -> Tags {
    let Ok(mut file) = File::open(path) else { return Tags::default() };
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    let tags = match ext.as_str() {
        "flac" => flac_tags(&mut file),
        "mp3" => id3_tags(&mut file),
        _ => None,
    };
    tags.unwrap_or_default()
}

/// Titre tiré du nom de fichier : « Portal2-1x04-The_Courtesy_Call » → « The Courtesy Call »,
/// « 03 - Intro » → « Intro ».
fn title_from_file(path: &Path) -> String {
    let stem = path.file_stem().map(|s| s.to_string_lossy().replace('_', " ")).unwrap_or_default();
    let parts: Vec<&str> = stem.split(['-', '.']).map(str::trim).collect();
    // Les morceaux de tête qui ne sont que des numéros (« 03 », « 1x04 ») sont des numéros de piste.
    let numeric = |p: &str| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit() || c == 'x' || c == 'X');
    if let Some(i) = parts.iter().position(|p| numeric(p)) {
        let rest = parts[i + 1..].join(" - ");
        if !rest.trim().is_empty() {
            return rest.trim().to_owned();
        }
    }
    stem.trim().to_owned()
}

/// Pochette d'un dossier : un nom usuel d'abord, sinon la première image venue.
fn cover_in(dir: &Path) -> Option<PathBuf> {
    let mut images: Vec<PathBuf> = fs::read_dir(dir).ok()?.flatten().map(|e| e.path()).filter(|p| has_ext(p, IMAGES)).collect();
    images.sort();
    let named = images.iter().find(|p| {
        let stem = p.file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
        COVERS.iter().any(|c| stem.starts_with(c))
    });
    named.or(images.first()).cloned()
}

/// Racines de la musique : `(dossier, source)`.
pub fn music_roots(steamapps: &[PathBuf]) -> Vec<(PathBuf, &'static str)> {
    let mut roots: Vec<(PathBuf, &'static str)> = steamapps
        .iter()
        .map(|s| (s.join("music"), "soundtrack"))
        .filter(|(p, _)| p.is_dir())
        .collect();
    if let Some(music) = known_folder("My Music").filter(|p| p.is_dir()) {
        roots.push((music, "music"));
    }
    roots
}

pub fn music(roots: &[(PathBuf, &'static str)]) -> Vec<Track> {
    let mut covers: HashMap<PathBuf, Option<String>> = HashMap::new();
    let mut tracks = Vec::new();
    for (root, source) in roots {
        let mut files = Vec::new();
        walk(root, 0, &mut files, &|p| has_ext(p, AUDIO), MAX_TRACKS - tracks.len().min(MAX_TRACKS));
        for path in files {
            let dir = path.parent().unwrap_or(root).to_path_buf();
            // Une bande-son Steam s'appelle comme son dossier de premier niveau (« Portal 2
            // Soundtrack »), même si les fichiers sont rangés plus bas (« FLAC/ »).
            let top = path.strip_prefix(root).ok().and_then(|rel| rel.components().next()).map(|c| root.join(c));
            let album_dir = if *source == "soundtrack" { top.clone().filter(|t| t.is_dir()).unwrap_or(dir.clone()) } else { dir.clone() };
            let folder_name = album_dir.file_name().map(|n| n.to_string_lossy().into_owned()).filter(|_| album_dir != *root);
            let cover = covers
                .entry(dir.clone())
                .or_insert_with(|| cover_in(&dir).or_else(|| cover_in(&album_dir)).map(|p| text(&p)))
                .clone();
            let tags = read_tags(&path);
            tracks.push(Track {
                path: text(&path),
                title: tags.title.unwrap_or_else(|| title_from_file(&path)),
                artist: tags.artist,
                album: tags.album.or(folder_name).unwrap_or_else(|| "Musique".to_string()),
                number: tags.number,
                cover,
                source,
            });
        }
    }
    dedupe(tracks)
}

/// Les bandes-son Steam sont souvent livrées deux fois, en FLAC et en MP3 : une seule copie de
/// chaque piste reste, la meilleure.
fn dedupe(tracks: Vec<Track>) -> Vec<Track> {
    let rank = |t: &Track| {
        let ext = Path::new(&t.path).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
        AUDIO.iter().position(|a| *a == ext).map_or(usize::MAX, |i| if ext == "flac" { 0 } else { i + 1 })
    };
    let key = |t: &Track| (t.source, t.album.to_lowercase(), t.number, t.title.to_lowercase());
    let mut best: HashMap<_, usize> = HashMap::new();
    for (i, track) in tracks.iter().enumerate() {
        best.entry(key(track))
            .and_modify(|kept| {
                if rank(track) < rank(&tracks[*kept]) {
                    *kept = i;
                }
            })
            .or_insert(i);
    }
    let keep: std::collections::HashSet<usize> = best.into_values().collect();
    tracks.into_iter().enumerate().filter(|(i, _)| keep.contains(i)).map(|(_, t)| t).collect()
}

/* ─── Captures d'écran ────────────────────────────────────────────────────────────────── */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Shot {
    pub path: String,
    /// Miniature toute prête (Steam en fait une pour chaque capture).
    pub thumb: Option<String>,
    /// Jeu capturé, pour les captures Steam.
    pub appid: Option<u32>,
    /// `steam`, `windows` ou `gamebar`.
    pub source: &'static str,
    /// Date de la capture, en secondes.
    pub taken: u64,
}

/// Racines des captures : `(dossier, source)`. Celles de Steam sont rangées par jeu.
pub fn shot_roots(user_dir: Option<&Path>) -> Vec<(PathBuf, &'static str)> {
    let mut roots = Vec::new();
    if let Some(dir) = user_dir.map(|d| d.join("760").join("remote")).filter(|d| d.is_dir()) {
        roots.push((dir, "steam"));
    }
    if let Some(dir) = windows_screenshots().filter(|d| d.is_dir()) {
        roots.push((dir, "windows"));
    }
    if let Some(dir) = known_folder("My Video").map(|v| v.join("Captures")).filter(|d| d.is_dir()) {
        roots.push((dir, "gamebar"));
    }
    roots
}

pub fn screenshots(roots: &[(PathBuf, &'static str)]) -> Vec<Shot> {
    let mut shots = Vec::new();
    for (root, source) in roots {
        if *source == "steam" {
            // remote/<appid>/screenshots/<nom>.jpg, et sa miniature dans screenshots/thumbnails/.
            let Ok(apps) = fs::read_dir(root) else { continue };
            for app in apps.flatten() {
                let Ok(appid) = app.file_name().to_string_lossy().parse::<u32>() else { continue };
                let dir = app.path().join("screenshots");
                let Ok(files) = fs::read_dir(&dir) else { continue };
                for file in files.flatten().map(|f| f.path()).filter(|p| p.is_file() && has_ext(p, IMAGES)) {
                    let thumb = file.file_name().map(|n| dir.join("thumbnails").join(n)).filter(|t| t.is_file());
                    shots.push(Shot { taken: modified(&file), path: text(&file), thumb: thumb.as_deref().map(text), appid: Some(appid), source });
                }
            }
        } else {
            let mut files = Vec::new();
            walk(root, MAX_DEPTH - 1, &mut files, &|p| has_ext(p, IMAGES), MAX_SHOTS);
            shots.extend(files.into_iter().map(|file| Shot { taken: modified(&file), path: text(&file), thumb: None, appid: None, source }));
        }
    }
    // Les plus récentes d'abord, et pas plus que de raison.
    shots.sort_by_key(|s| std::cmp::Reverse(s.taken));
    shots.truncate(MAX_SHOTS);
    shots
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_vorbis_comments() {
        let mut block = Vec::new();
        let push = |block: &mut Vec<u8>, s: &str| {
            block.extend((s.len() as u32).to_le_bytes());
            block.extend(s.as_bytes());
        };
        push(&mut block, "reference libFLAC");
        block.extend(3u32.to_le_bytes());
        push(&mut block, "TITLE=Science is Fun");
        push(&mut block, "artist=Aperture Science Psychoacoustics Laboratory");
        push(&mut block, "TRACKNUMBER=1/14");
        let tags = vorbis_comments(&block);
        assert_eq!(tags.title.as_deref(), Some("Science is Fun"));
        assert_eq!(tags.artist.as_deref(), Some("Aperture Science Psychoacoustics Laboratory"));
        assert_eq!(tags.number, Some(1));
    }

    #[test]
    fn reads_id3_frames() {
        let frame = |id: &[u8], body: &[u8]| {
            let mut f = id.to_vec();
            f.extend((body.len() as u32).to_be_bytes());
            f.extend([0, 0]);
            f.extend(body);
            f
        };
        let mut tag = frame(b"TIT2", b"\x03Want You Gone");
        // UTF-16 avec BOM, comme l'écrivent beaucoup de logiciels.
        let mut utf16 = vec![1u8, 0xff, 0xfe];
        for unit in "Jonathan Coulton".encode_utf16() {
            utf16.extend(unit.to_le_bytes());
        }
        tag.extend(frame(b"TPE1", &utf16));
        tag.extend(frame(b"TRCK", b"\x0005"));
        let tags = id3_frames(&tag, 3);
        assert_eq!(tags.title.as_deref(), Some("Want You Gone"));
        assert_eq!(tags.artist.as_deref(), Some("Jonathan Coulton"));
        assert_eq!(tags.number, Some(5));
    }

    #[test]
    fn cleans_file_names() {
        assert_eq!(title_from_file(Path::new("Portal2-1x04-The_Courtesy_Call.flac")), "The Courtesy Call");
        assert_eq!(title_from_file(Path::new("03 - Intro.mp3")), "Intro");
        assert_eq!(title_from_file(Path::new("Still Alive.mp3")), "Still Alive");
    }

    /// Bibliothèque réelle : `cargo test media -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn local_media() {
        let root = crate::steam::find_steam_root().expect("Steam introuvable");
        let tracks = music(&music_roots(&crate::steam::library_folders(&root)));
        println!("{} pistes", tracks.len());
        for t in tracks.iter().take(5) {
            println!("  {} — {} ({:?}) [{:?}]", t.album, t.title, t.number, t.cover.is_some());
        }
        let shots = screenshots(&shot_roots(crate::steam::user_dir(&root).as_deref()));
        println!("{} captures", shots.len());
    }
}
