//! La manette pilote le curseur, le temps d'une fenêtre Steam (Windows).
//!
//! Steam n'expose sa boîte d'installation ni au clavier ni à l'accessibilité : on a mesuré zéro
//! bouton en UI Automation, et ni Tab ni Entrée n'y font quoi que ce soit. Cliquer à la place de
//! l'utilisateur reviendrait, devant un contrat de licence, à l'accepter pour lui. Le problème se
//! prend donc à l'envers : tant qu'une fenêtre de Steam est ouverte, les sticks déplacent le
//! curseur du système et Ⓐ clique. C'est l'utilisateur qui décide, pour n'importe quelle fenêtre
//! et quelle que soit sa disposition.
//!
//! La manette est lue en XInput plutôt que par l'API du navigateur : la page ne reçoit plus rien
//! dès qu'elle perd le focus, ce qui est précisément le cas ici.

use std::thread::sleep;
use std::time::{Duration, Instant};

use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM, POINT, RECT, TRUE};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    mouse_event, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_WHEEL,
};
use windows_sys::Win32::UI::Input::XboxController::{
    XInputGetState, XINPUT_GAMEPAD_A, XINPUT_STATE,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetClassNameW, GetCursorPos, GetForegroundWindow, GetWindowRect, IsWindowVisible,
    SetCursorPos,
};

/// Classe de toutes les fenêtres de Steam, la principale comme ses boîtes.
const CLASS: &str = "SDL_app";
/// En dessous, ce n'est pas une fenêtre utile mais un reliquat.
const MIN_SIZE: i32 = 200;

/// Période d'échantillonnage : environ soixante fois par seconde.
const FRAME: Duration = Duration::from_millis(16);
/// Zone morte des sticks, sur les 32767 de l'amplitude.
const DEADZONE: f32 = 8000.0;
/// Vitesse maximale du curseur, en pixels par seconde.
const SPEED: f32 = 1100.0;
/// Facteur appliqué gâchette enfoncée, pour viser un petit bouton.
const PRECISION: f32 = 0.25;
/// Au-delà, la gâchette compte comme enfoncée.
const TRIGGER: u8 = 60;
/// Vitesse de défilement, en crans de molette par seconde.
const SCROLL_SPEED: f32 = 12.0;
/// Un cran de molette, tel que Windows le compte.
const WHEEL_STEP: f32 = 120.0;
/// Manettes XInput possibles.
const SLOTS: u32 = 4;

/* ─── Fenêtres de Steam ───────────────────────────────────────────────────────────────── */

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

/// La fenêtre Steam apparue après la demande, si elle est encore là.
fn opened(before: &[isize]) -> Option<isize> {
    windows()
        .into_iter()
        .find(|hwnd| !before.contains(hwnd) && rect(*hwnd).is_some())
}

/* ─── Manette et curseur ──────────────────────────────────────────────────────────────── */

/// Position d'un axe, ramenée entre -1 et 1, zone morte retirée. La courbe au carré donne de la
/// précision près du centre et de la vitesse au bord.
fn axis(raw: i16) -> f32 {
    let value = raw as f32;
    if value.abs() < DEADZONE {
        return 0.0;
    }
    let normalized = (value.abs() - DEADZONE) / (32767.0 - DEADZONE);
    normalized * normalized * value.signum()
}

/// État de la première manette branchée.
fn pad() -> Option<XINPUT_STATE> {
    (0..SLOTS).find_map(|slot| {
        let mut state: XINPUT_STATE = unsafe { std::mem::zeroed() };
        (unsafe { XInputGetState(slot, &mut state) } == 0).then_some(state)
    })
}

fn cursor() -> Option<POINT> {
    let mut at = POINT { x: 0, y: 0 };
    (unsafe { GetCursorPos(&mut at) } != 0).then_some(at)
}

fn click() {
    unsafe {
        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
    }
}

fn scroll(notches: i32) {
    unsafe { mouse_event(MOUSEEVENTF_WHEEL, 0, 0, (notches as f32 * WHEEL_STEP) as i32, 0) };
}

/**
 * Laisse la manette piloter le curseur tant qu'une fenêtre Steam apparue après `before` reste
 * ouverte. Rend la main dès qu'elle se ferme, si l'utilisateur passe ailleurs, ou au bout de
 * `budget`. Renvoie `true` si une fenêtre a bien été prise en charge.
 *
 * Stick gauche : le curseur. Stick droit : le défilement — un contrat de licence doit être
 * parcouru avant que son bouton s'active. Gâchette : ralenti, pour viser une case à cocher.
 * Ⓐ clique là où l'utilisateur a amené le curseur, et nulle part ailleurs.
 */
pub fn drive(before: &[isize], appear: Duration, budget: Duration) -> bool {
    let until = Instant::now() + appear;
    let hwnd = loop {
        if let Some(hwnd) = opened(before) {
            break hwnd;
        }
        if Instant::now() >= until {
            return false;
        }
        sleep(FRAME);
    };

    // Le curseur est amené au centre de la fenêtre : sans ça il faudrait parfois traverser tout
    // l'écran au stick avant d'atteindre quoi que ce soit. Au centre, et pas sur un bouton : le
    // choix reste entier.
    if let Some(r) = rect(hwnd) {
        unsafe { SetCursorPos((r.left + r.right) / 2, (r.top + r.bottom) / 2) };
    }

    let stop = Instant::now() + budget;
    let mut pressed = false;
    // Les restes fractionnaires sont gardés d'une image à l'autre, sinon les petits déplacements
    // seraient arrondis à zéro et le curseur ne bougerait pas au ralenti.
    let (mut rest_x, mut rest_y, mut rest_scroll) = (0.0f32, 0.0f32, 0.0f32);

    while Instant::now() < stop {
        let Some(hwnd) = opened(before) else { break };
        // L'utilisateur est parti sur une autre fenêtre : on ne touche plus à rien.
        if unsafe { GetForegroundWindow() } as isize != hwnd {
            break;
        }
        if let Some(state) = pad() {
            let g = state.Gamepad;
            let slow = g.bLeftTrigger > TRIGGER || g.bRightTrigger > TRIGGER;
            let step = SPEED * FRAME.as_secs_f32() * if slow { PRECISION } else { 1.0 };

            rest_x += axis(g.sThumbLX) * step;
            rest_y += -axis(g.sThumbLY) * step;
            let (dx, dy) = (rest_x.trunc(), rest_y.trunc());
            if dx != 0.0 || dy != 0.0 {
                if let Some(at) = cursor() {
                    unsafe { SetCursorPos(at.x + dx as i32, at.y + dy as i32) };
                }
                rest_x -= dx;
                rest_y -= dy;
            }

            rest_scroll += axis(g.sThumbRY) * SCROLL_SPEED * FRAME.as_secs_f32();
            let notches = rest_scroll.trunc();
            if notches != 0.0 {
                scroll(notches as i32);
                rest_scroll -= notches;
            }

            let down = g.wButtons & XINPUT_GAMEPAD_A != 0;
            if down && !pressed {
                click();
            }
            pressed = down;
        }
        sleep(FRAME);
    }
    true
}
