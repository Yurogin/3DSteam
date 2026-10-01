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
        let lower = path.to_ascii_lowercase();
        // Un jeu hors Steam sans icône choisie : celle de son exécutable, qu'on ne peut pas
        // servir tel quel. Elle est toujours réécrite à part.
        let from_exe = lower.ends_with(".exe");
        let data = if from_exe { exe_icon(&path) } else { fs::read(&path).ok() };
        let Some(data) = data else {
            if from_exe {
                game.art.icon = None;
            }
            continue;
        };

        if !from_exe && !lower.ends_with(".ico") {
            game.art.icon_size = jpeg_width(&data).or_else(|| png_width(&data));
            continue;
        }
        let list = entries(&data);
        let Some(entry) = best(&list) else { continue };
        let frame = data.get(entry.offset..entry.offset + entry.len).unwrap_or(&[]);
        game.art.icon_size = Some(png_width(frame).unwrap_or(entry.size));
        if list.len() < 2 && !from_exe {
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

/// Icône principale d'un exécutable, remise sous forme de `.ico` : le groupe `RT_GROUP_ICON` donne
/// l'annuaire (14 octets par image, avec un numéro de ressource au lieu d'une position), chaque
/// image est une ressource `RT_ICON`. Les octets sont recopiés tels quels, comme pour un `.ico`.
#[cfg(windows)]
fn exe_icon(path: &str) -> Option<Vec<u8>> {
    use windows_sys::core::PCWSTR;
    use windows_sys::Win32::Foundation::{FreeLibrary, BOOL, FALSE, HMODULE};
    use windows_sys::Win32::System::LibraryLoader::{
        EnumResourceNamesW, FindResourceW, LoadLibraryExW, LoadResource, LockResource, SizeofResource,
        LOAD_LIBRARY_AS_DATAFILE, LOAD_LIBRARY_AS_IMAGE_RESOURCE,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{RT_GROUP_ICON, RT_ICON};

    /// Le nom d'une ressource : un numéro, ou un texte qu'il faut recopier pendant l'énumération.
    enum Name {
        Id(usize),
        Text(Vec<u16>),
    }
    unsafe extern "system" fn first(_: HMODULE, _: PCWSTR, name: PCWSTR, out: isize) -> BOOL {
        let out = &mut *(out as *mut Option<Name>);
        *out = Some(if (name as usize) >> 16 == 0 {
            Name::Id(name as usize)
        } else {
            let len = (0..).take_while(|&i| *name.add(i) != 0).count();
            Name::Text(std::slice::from_raw_parts(name, len + 1).to_vec())
        });
        FALSE
    }
    /// Octets d'une ressource, empruntés au module chargé.
    unsafe fn resource<'a>(module: HMODULE, name: PCWSTR, kind: PCWSTR) -> Option<&'a [u8]> {
        let found = FindResourceW(module, name, kind);
        if found.is_null() {
            return None;
        }
        let ptr = LockResource(LoadResource(module, found)) as *const u8;
        let len = SizeofResource(module, found) as usize;
        (!ptr.is_null() && len > 0).then(|| std::slice::from_raw_parts(ptr, len))
    }

    let wide: Vec<u16> = path.encode_utf16().chain(Some(0)).collect();
    // Chargé comme simple fichier de ressources : rien n'est exécuté.
    let module = unsafe {
        LoadLibraryExW(wide.as_ptr(), std::ptr::null_mut(), LOAD_LIBRARY_AS_DATAFILE | LOAD_LIBRARY_AS_IMAGE_RESOURCE)
    };
    if module.is_null() {
        return None;
    }
    let mut group: Option<Name> = None;
    let out = unsafe {
        EnumResourceNamesW(module, RT_GROUP_ICON, Some(first), &mut group as *mut Option<Name> as isize);
        let name = match &group {
            Some(Name::Id(id)) => *id as PCWSTR,
            Some(Name::Text(text)) => text.as_ptr(),
            None => std::ptr::null(),
        };
        let dir = if name.is_null() { None } else { resource(module, name, RT_GROUP_ICON) };
        dir.and_then(|dir| {
            let count = u16le(dir, 4)? as usize;
            let frames: Vec<(&[u8], &[u8])> = (0..count)
                .filter_map(|i| {
                    let entry = dir.get(6 + i * 14..6 + i * 14 + 14)?;
                    let id = u16le(entry, 12)? as usize;
                    Some((entry, resource(module, id as PCWSTR, RT_ICON)?))
                })
                .collect();
            (!frames.is_empty()).then(|| ico_from(&frames))
        })
    };
    unsafe { FreeLibrary(module) };
    out
}

#[cfg(not(windows))]
fn exe_icon(_: &str) -> Option<Vec<u8>> {
    None
}

/// Assemble un `.ico` à partir d'entrées d'annuaire de ressource (14 octets) et de leurs images.
#[cfg_attr(not(windows), allow(dead_code))]
fn ico_from(frames: &[(&[u8], &[u8])]) -> Vec<u8> {
    let mut out = vec![0, 0, 1, 0];
    out.extend_from_slice(&(frames.len() as u16).to_le_bytes());
    let mut offset = 6 + 16 * frames.len() as u32;
    for (entry, data) in frames {
        // Largeur, hauteur, couleurs, réservé, plans, profondeur : identiques ; puis la longueur
        // réelle de l'image et sa position dans le fichier, à la place du numéro de ressource.
        out.extend_from_slice(&entry[..8]);
        out.extend_from_slice(&(data.len() as u32).to_le_bytes());
        out.extend_from_slice(&offset.to_le_bytes());
        offset += data.len() as u32;
    }
    for (_, data) in frames {
        out.extend_from_slice(data);
    }
    out
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

    #[test]
    fn rebuilds_an_ico_from_resources() {
        // Deux entrées de ressource : 32 px (numéro 1) et 256 px (numéro 2, écrit 0).
        let small = [32, 32, 0, 0, 1, 0, 32, 0, 3, 0, 0, 0, 1, 0];
        let large = [0, 0, 0, 0, 1, 0, 32, 0, 5, 0, 0, 0, 2, 0];
        let ico = ico_from(&[(&small, b"abc"), (&large, b"defgh")]);
        let list = entries(&ico);
        assert_eq!(list.len(), 2);
        let top = best(&list).unwrap();
        assert_eq!(top.size, 256);
        assert_eq!(&ico[top.offset..top.offset + top.len], b"defgh");
    }

    #[cfg(windows)]
    #[test]
    fn extracts_the_icon_of_an_executable() {
        let ico = exe_icon(r"C:\Windows\explorer.exe").expect("icône d'explorer.exe");
        let list = entries(&ico);
        assert!(!list.is_empty());
        assert!(best(&list).unwrap().size >= 32);
        assert!(exe_icon(r"C:\nope\absent.exe").is_none());
    }

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
        for game in games.iter().filter(|g| g.shortcut) {
            println!("  hors Steam : {} -> {:?} ({:?} px)", game.name, game.art.icon, game.art.icon_size);
        }
        for (taille, n) in &par_taille {
            match taille {
                Some(px) => println!("  {n:3} jeux  ->  {px}x{px} px"),
                None => println!("  {n:3} jeux  ->  taille inconnue"),
            }
        }
    }
}
