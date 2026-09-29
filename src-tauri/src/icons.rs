//! Choix de la meilleure image d'une icône, sans décodeur.
//!
//! Un `.ico` est un annuaire : 6 octets d'en-tête, puis 16 octets par image (taille, profondeur,
//! longueur, position). Beaucoup de ceux de Steam en contiennent huit ou dix, de 16 à 256 px, et
//! c'est alors le décodeur du navigateur qui choisit laquelle afficher. Plutôt que de dépendre de
//! ce choix, on réécrit à côté du cache un fichier ne contenant que la plus grande image : les
//! octets sont recopiés tels quels, rien n'est décodé et aucune dépendance n'est nécessaire.

use std::fs;
use std::path::{Path, PathBuf};

use crate::steam::Game;

const PNG_MAGIC: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
/// En-tête (6) + une entrée d'annuaire (16) : les données d'image commencent ici.
const SINGLE_HEADER: u32 = 22;

/// Une image d'un `.ico` : sa taille et où trouver ses octets.
struct Entry {
    size: u32,
    bits: u16,
    offset: usize,
    len: usize,
    /// Les 16 octets de l'annuaire, recopiés pour reconstruire un `.ico` d'une seule image.
    dir: [u8; 16],
}

fn u16le(data: &[u8], at: usize) -> Option<u16> {
    data.get(at..at + 2).map(|b| u16::from_le_bytes([b[0], b[1]]))
}

fn u32le(data: &[u8], at: usize) -> Option<u32> {
    data.get(at..at + 4)
        .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
}

/// Les images d'un `.ico`, ou rien si l'en-tête n'est pas celui d'une icône.
fn entries(data: &[u8]) -> Vec<Entry> {
    if u16le(data, 0) != Some(0) || u16le(data, 2) != Some(1) {
        return Vec::new();
    }
    let count = u16le(data, 4).unwrap_or(0) as usize;
    let mut out = Vec::with_capacity(count);
    for i in 0..count {
        let at = 6 + i * 16;
        let Some(dir) = data.get(at..at + 16).and_then(|d| <[u8; 16]>::try_from(d).ok()) else {
            break;
        };
        let len = u32le(data, at + 8).unwrap_or(0) as usize;
        let offset = u32le(data, at + 12).unwrap_or(0) as usize;
        if len == 0 || offset < 6 || offset.saturating_add(len) > data.len() {
            continue;
        }
        out.push(Entry {
            // Une largeur tient sur un octet : 0 se lit 256.
            size: if dir[0] == 0 { 256 } else { dir[0] as u32 },
            bits: u16le(data, at + 6).unwrap_or(0),
            offset,
            len,
            dir,
        });
    }
    out
}

/// La plus grande image ; à taille égale, la plus riche en couleurs.
fn best(list: &[Entry]) -> Option<&Entry> {
    list.iter().max_by_key(|e| (e.size, e.bits))
}

/// Fichier n'affichant que cette image : le PNG tel quel, sinon un `.ico` d'une seule entrée.
fn single(data: &[u8], entry: &Entry) -> (Vec<u8>, &'static str) {
    let frame = &data[entry.offset..entry.offset + entry.len];
    if frame.starts_with(&PNG_MAGIC) {
        return (frame.to_vec(), "png");
    }
    let mut out = Vec::with_capacity(SINGLE_HEADER as usize + entry.len);
    out.extend_from_slice(&[0, 0, 1, 0, 1, 0]);
    let mut dir = entry.dir;
    dir[12..16].copy_from_slice(&SINGLE_HEADER.to_le_bytes());
    out.extend_from_slice(&dir);
    out.extend_from_slice(frame);
    (out, "ico")
}

/// Largeur réelle d'un PNG, lue dans son IHDR. L'annuaire d'un `.ico` code la largeur sur un seul
/// octet et plafonne donc à 256 px, alors que le PNG qu'il contient peut être plus grand (512 px
/// se rencontre). Sans ça, une icône de 512 px serait annoncée à 256.
fn png_width(frame: &[u8]) -> Option<u32> {
    if !frame.starts_with(&PNG_MAGIC) || frame.get(12..16) != Some(&b"IHDR"[..]) {
        return None;
    }
    frame
        .get(16..20)
        .map(|b| u32::from_be_bytes([b[0], b[1], b[2], b[3]]))
}

/// Largeur d'un JPEG, lue dans son marqueur SOF (les petites icônes de Steam sont des `.jpg`).
fn jpeg_width(data: &[u8]) -> Option<u32> {
    if !data.starts_with(&[0xFF, 0xD8]) {
        return None;
    }
    let mut i = 2;
    while i + 8 < data.len() {
        if data[i] != 0xFF {
            i += 1;
            continue;
        }
        let marker = data[i + 1];
        // SOF0 à SOF15 portent les dimensions ; DHT, JPG et DAC partagent la plage sans les porter.
        if (0xC0..=0xCF).contains(&marker) && !matches!(marker, 0xC4 | 0xC8 | 0xCC) {
            return Some(u16::from_be_bytes([data[i + 7], data[i + 8]]) as u32);
        }
        // Marqueurs isolés, sans segment de longueur.
        if marker == 0x01 || marker == 0xD8 || (0xD0..=0xD7).contains(&marker) {
            i += 2;
            continue;
        }
        let len = u16::from_be_bytes([data[i + 2], data[i + 3]]) as usize;
        if len < 2 {
            break;
        }
        i += 2 + len;
    }
    None
}

/// Dossier des icônes dérivées, à côté du cache.
pub fn dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("icons")
}

/// Renseigne la taille réelle de chaque icône et, pour un `.ico` à plusieurs images, écrit sa plus
/// grande image dans un fichier à part vers lequel pointe alors le jeu. Silencieux en cas d'échec :
/// l'icône d'origine reste affichable.
pub fn refine(games: &mut [Game], app_data_dir: &Path) {
    let out_dir = dir(app_data_dir);
    let mut created = false;
    for game in games.iter_mut() {
        let Some(path) = game.art.icon.clone() else {
            continue;
        };
        let Ok(data) = fs::read(&path) else { continue };

        if !path.to_ascii_lowercase().ends_with(".ico") {
            game.art.icon_size = jpeg_width(&data);
            continue;
        }
        let list = entries(&data);
        let Some(entry) = best(&list) else { continue };
        let frame = data.get(entry.offset..entry.offset + entry.len).unwrap_or(&[]);
        game.art.icon_size = Some(png_width(frame).unwrap_or(entry.size));
        if list.len() < 2 {
            continue;
        }
        if !created {
            created = fs::create_dir_all(&out_dir).is_ok();
            if !created {
                continue;
            }
        }
        let (bytes, ext) = single(&data, entry);
        let target = out_dir.join(format!("{}.{ext}", game.appid));
        if fs::write(&target, bytes).is_ok() {
            game.art.icon = Some(target.to_string_lossy().into_owned());
        }
    }
}

/// Supprime les icônes dérivées (bouton « Vider le cache » : elles se réécrivent au scan suivant).
pub fn clear(app_data_dir: &Path) -> Result<(), String> {
    match fs::remove_dir_all(dir(app_data_dir)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `.ico` de trois images factices (16, 48, 32 px), la plus grande au milieu.
    fn sample() -> Vec<u8> {
        let frames: [(u8, u16, &[u8]); 3] = [(16, 4, b"aa"), (48, 32, b"bbbb"), (32, 8, b"ccc")];
        let mut out = vec![0, 0, 1, 0, 3, 0];
        let mut offset = 6 + 16 * 3;
        for (px, bits, body) in frames {
            out.extend_from_slice(&[px, px, 0, 0, 1, 0]);
            out.extend_from_slice(&bits.to_le_bytes());
            out.extend_from_slice(&(body.len() as u32).to_le_bytes());
            out.extend_from_slice(&(offset as u32).to_le_bytes());
            offset += body.len();
        }
        for (_, _, body) in frames {
            out.extend_from_slice(body);
        }
        out
    }

    #[test]
    fn picks_the_largest_frame() {
        let data = sample();
        let list = entries(&data);
        assert_eq!(list.len(), 3);
        assert_eq!(best(&list).map(|e| e.size), Some(48));
    }

    #[test]
    fn rewrites_a_single_frame_ico() {
        let data = sample();
        let list = entries(&data);
        let (out, ext) = single(&data, best(&list).unwrap());
        assert_eq!(ext, "ico");
        // Une seule entrée, la plus grande, et ses données juste après l'annuaire.
        let rebuilt = entries(&out);
        assert_eq!(rebuilt.len(), 1);
        assert_eq!(rebuilt[0].size, 48);
        assert_eq!(rebuilt[0].offset, SINGLE_HEADER as usize);
        assert_eq!(&out[SINGLE_HEADER as usize..], b"bbbb");
    }

    #[test]
    fn keeps_a_png_frame_as_is() {
        let mut body = PNG_MAGIC.to_vec();
        body.extend_from_slice(b"reste");
        let mut data = vec![0, 0, 1, 0, 1, 0];
        data.extend_from_slice(&[0, 0, 0, 0, 1, 0]); // largeur 0 = 256 px
        data.extend_from_slice(&32u16.to_le_bytes());
        data.extend_from_slice(&(body.len() as u32).to_le_bytes());
        data.extend_from_slice(&SINGLE_HEADER.to_le_bytes());
        data.extend_from_slice(&body);
        let list = entries(&data);
        assert_eq!(list[0].size, 256);
        let (out, ext) = single(&data, &list[0]);
        assert_eq!(ext, "png");
        assert_eq!(out, body);
    }

    #[test]
    fn reads_png_width_beyond_the_directory_cap() {
        let mut frame = PNG_MAGIC.to_vec();
        frame.extend_from_slice(&13u32.to_be_bytes());
        frame.extend_from_slice(b"IHDR");
        frame.extend_from_slice(&512u32.to_be_bytes());
        frame.extend_from_slice(&512u32.to_be_bytes());
        assert_eq!(png_width(&frame), Some(512));
        assert_eq!(png_width(b"pas un png"), None);
    }

    #[test]
    fn reads_jpeg_width() {
        // SOI, APP0 vide, puis SOF0 en 32x32.
        let mut data = vec![0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x02];
        data.extend_from_slice(&[0xFF, 0xC0, 0x00, 0x11, 0x08, 0x00, 0x20, 0x00, 0x20]);
        assert_eq!(jpeg_width(&data), Some(32));
    }

    #[test]
    fn ignores_a_file_that_is_not_an_ico() {
        assert!(entries(b"pas du tout une icone").is_empty());
    }

    /// Extraction sur la vraie bibliothèque : `cargo test -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn refine_local_library() {
        let Some(root) = crate::steam::find_steam_root() else {
            return println!("Steam introuvable");
        };
        let mut games = crate::steam::scan(&root).games;
        let dir = std::env::temp_dir().join("3dsteam-icons-test");
        let _ = fs::remove_dir_all(&dir);
        refine(&mut games, &dir);

        let mut par_taille: std::collections::BTreeMap<Option<u32>, usize> = Default::default();
        let mut derivees = 0;
        for game in &games {
            *par_taille.entry(game.art.icon_size).or_default() += 1;
            if game.art.icon.as_deref().is_some_and(|p| p.contains("3dsteam-icons-test")) {
                derivees += 1;
            }
        }
        println!("{} jeux, {derivees} icônes réécrites dans {}", games.len(), dir.display());
        for (taille, n) in &par_taille {
            match taille {
                Some(px) => println!("  {n:3} jeux  ->  {px}x{px} px"),
                None => println!("  {n:3} jeux  ->  taille inconnue"),
            }
        }
    }
}
