//! Validation automatique de la boîte d'installation de Steam (Windows).
//!
//! Steam n'offre aucun moyen de lancer un téléchargement sans passer par sa boîte de dialogue, et
//! celle-ci ne répond pas au clavier : ni Tab, ni Entrée, aucun anneau de focus n'apparaît. Son
//! interface est dessinée dans une fenêtre `SDL_app` qui n'expose rien à l'UI Automation non plus
//! (trois descendants, zéro bouton). Le seul geste qui la valide est un clic de souris.
//!
//! On le synthétise donc, avec deux garde-fous stricts : la fenêtre visée doit être **apparue
//! après** notre demande, et elle doit avoir le focus au moment du clic. Si l'un des deux manque,
//! on ne fait rien et l'utilisateur valide lui-même. Sans cette prudence, une frappe ou un clic
//! synthétique peut atterrir dans la fenêtre active — un jeu, par exemple.
//!
//! C'est de l'automatisation de l'interface d'un autre programme : ça peut casser si Steam change
//! la disposition de sa boîte. D'où le réglage, désactivé par défaut.

use std::thread::sleep;
use std::time::{Duration, Instant};

use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM, POINT, RECT, TRUE};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    mouse_event, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetClassNameW, GetCursorPos, GetForegroundWindow, GetWindowRect, GetWindowTextW,
    IsWindowVisible, SetCursorPos,
};

/// Classe de toutes les fenêtres de Steam, la principale comme ses boîtes.
const CLASS: &str = "SDL_app";
/// Position du bouton de validation, mesurée depuis le coin bas-droit de la boîte. Les boutons y
/// sont ancrés, ce qui rend l'écart stable même quand le contenu change de hauteur.
const BUTTON_FROM_RIGHT: i32 = 122;
const BUTTON_FROM_BOTTOM: i32 = 42;
/// Délai laissé à Steam pour dessiner le contenu de sa boîte avant qu'on y clique.
const SETTLE: Duration = Duration::from_millis(900);
/// En dessous, ce n'est pas une boîte de dialogue mais la fenêtre principale ou un reliquat.
const MIN_SIZE: i32 = 200;

unsafe extern "system" fn collect(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let found = &mut *(lparam as *mut Vec<isize>);
    if IsWindowVisible(hwnd) != 0 {
        let mut buf = [0u16; 64];
        let len = GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
        if len > 0 && String::from_utf16_lossy(&buf[..len as usize]) == CLASS {
            found.push(hwnd as isize);
        }
    }
    TRUE
}

/// Titre d'une fenêtre.
fn title(hwnd: isize) -> String {
    let mut buf = [0u16; 256];
    let len = unsafe { GetWindowTextW(hwnd as HWND, buf.as_mut_ptr(), buf.len() as i32) };
    if len <= 0 {
        return String::new();
    }
    String::from_utf16_lossy(&buf[..len as usize])
}

/// Les fenêtres de Steam actuellement visibles.
pub fn windows() -> Vec<isize> {
    let mut found: Vec<isize> = Vec::new();
    unsafe {
        EnumWindows(Some(collect), &mut found as *mut Vec<isize> as LPARAM);
    }
    found
}

fn rect(hwnd: isize) -> Option<RECT> {
    let mut r = RECT { left: 0, top: 0, right: 0, bottom: 0 };
    let ok = unsafe { GetWindowRect(hwnd as HWND, &mut r) };
    (ok != 0 && r.right - r.left >= MIN_SIZE && r.bottom - r.top >= MIN_SIZE).then_some(r)
}

fn click(x: i32, y: i32) {
    unsafe {
        let mut origin = POINT { x: 0, y: 0 };
        let had_origin = GetCursorPos(&mut origin) != 0;
        SetCursorPos(x, y);
        sleep(Duration::from_millis(120));
        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
        sleep(Duration::from_millis(120));
        // La souris est rendue où l'utilisateur l'avait laissée.
        if had_origin {
            SetCursorPos(origin.x, origin.y);
        }
    }
}

/// Vrai si cette fenêtre a la taille d'une boîte de dialogue.
pub fn is_dialog(hwnd: isize) -> bool {
    rect(hwnd).is_some()
}

/// Ce qu'on a pu faire de la fenêtre apparue.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Outcome {
    /// La boîte attendue a été reconnue et validée.
    Confirmed,
    /// Une fenêtre est apparue, mais ce n'est pas celle qu'on sait valider : on n'y touche pas et
    /// on rend la main. C'est le cas d'un contrat de licence, par exemple.
    Unknown { title: String },
    /// Rien n'est apparu dans le délai imparti.
    Nothing,
}

/**
 * Attend la boîte d'installation puis la valide. `before` est la liste des fenêtres de Steam
 * relevée *avant* la demande : seule une fenêtre absente de cette liste est regardée.
 *
 * `expected` est le titre de la boîte d'installation, appris lors d'une installation précédente.
 * Sans lui, ou si le titre diffère, **on ne clique pas** : ce pourrait être un contrat de licence
 * ou un avertissement, et les accepter n'appartient pas au lanceur. L'utilisateur répond lui-même,
 * et le titre retenu servira la fois suivante.
 */
pub fn confirm(before: &[isize], expected: Option<&str>, timeout: Duration) -> Outcome {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        let candidate = windows()
            .into_iter()
            .find(|hwnd| !before.contains(hwnd) && rect(*hwnd).is_some());

        if let Some(hwnd) = candidate {
            let seen = title(hwnd);
            if expected != Some(seen.as_str()) {
                return Outcome::Unknown { title: seen };
            }
            // Deuxième garde-fou : sans le focus, le clic irait à la fenêtre active.
            if unsafe { GetForegroundWindow() } as isize != hwnd {
                sleep(Duration::from_millis(200));
                continue;
            }
            // La fenêtre existe avant que Steam n'y dessine ses boutons : cliquer aussitôt tombe
            // dans le vide, ou pire, à côté. On la laisse se poser, puis on revérifie tout.
            sleep(SETTLE);
            if unsafe { GetForegroundWindow() } as isize != hwnd || title(hwnd) != seen {
                continue;
            }
            let Some(r) = rect(hwnd) else { continue };
            click(r.right - BUTTON_FROM_RIGHT, r.bottom - BUTTON_FROM_BOTTOM);
            return Outcome::Confirmed;
        }
        sleep(Duration::from_millis(200));
    }
    Outcome::Nothing
}
