//! La manette pilote le curseur, le temps d'une fenêtre Steam (Windows).
//!
//! Steam n'expose sa boîte d'installation ni au clavier ni à l'accessibilité, et cliquer à la
//! place de l'utilisateur reviendrait, devant un contrat de licence, à l'accepter pour lui. On
//! prend donc le problème à l'envers : tant qu'une fenêtre de Steam est ouverte, la manette
//! déplace le curseur du système et Ⓐ clique. C'est l'utilisateur qui décide de tout, sans lâcher
//! la manette — et ça marche pour n'importe quelle fenêtre, quelle que soit sa disposition.
//!
//! La manette est lue en XInput plutôt que par l'API du navigateur : la page ne reçoit plus rien
//! dès qu'elle perd le focus, ce qui est précisément le cas ici.

use std::thread::sleep;
use std::time::{Duration, Instant};

use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    mouse_event, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP,
};
use windows_sys::Win32::UI::Input::XboxController::{
    XInputGetState, XINPUT_GAMEPAD_A, XINPUT_GAMEPAD_B, XINPUT_STATE,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetForegroundWindow, SetCursorPos,
};
use windows_sys::Win32::Foundation::POINT;

use crate::dialog;

/// Période d'échantillonnage : environ soixante fois par seconde.
const FRAME: Duration = Duration::from_millis(16);
/// Zone morte des sticks, sur les 32767 de l'amplitude.
const DEADZONE: f32 = 8000.0;
/// Vitesse maximale du curseur, en pixels par seconde.
const SPEED: f32 = 1100.0;
/// Manettes XInput possibles.
const SLOTS: u32 = 4;

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
    for slot in 0..SLOTS {
        let mut state: XINPUT_STATE = unsafe { std::mem::zeroed() };
        if unsafe { XInputGetState(slot, &mut state) } == 0 {
            return Some(state);
        }
    }
    None
}

fn click() {
    unsafe {
        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
    }
}

fn move_by(dx: f32, dy: f32) {
    let mut at = POINT { x: 0, y: 0 };
    if unsafe { GetCursorPos(&mut at) } == 0 {
        return;
    }
    unsafe { SetCursorPos(at.x + dx as i32, at.y + dy as i32) };
}

/// La fenêtre Steam apparue après la demande, si elle est encore là.
fn opened(before: &[isize]) -> Option<isize> {
    dialog::windows()
        .into_iter()
        .find(|hwnd| !before.contains(hwnd) && dialog::is_dialog(*hwnd))
}

/**
 * Laisse la manette piloter le curseur tant qu'une fenêtre Steam apparue après `before` reste
 * ouverte. Rend la main dès qu'elle se ferme, si l'utilisateur passe ailleurs, ou au bout de
 * `budget`. Renvoie `true` si une fenêtre a bien été prise en charge.
 *
 * Aucun clic n'est décidé ici : Ⓐ clique là où l'utilisateur a amené le curseur, c'est tout.
 */
pub fn drive(before: &[isize], appear: Duration, budget: Duration) -> bool {
    let until = Instant::now() + appear;
    while opened(before).is_none() {
        if Instant::now() >= until {
            return false;
        }
        sleep(FRAME);
    }

    let stop = Instant::now() + budget;
    let mut pressed = false;
    // Les restes fractionnaires sont gardés d'une image à l'autre, sinon les petits déplacements
    // seraient arrondis à zéro et le curseur ne bougerait pas au ralenti.
    let (mut rest_x, mut rest_y) = (0.0f32, 0.0f32);

    while Instant::now() < stop {
        let Some(hwnd) = opened(before) else { break };
        // L'utilisateur est parti sur une autre fenêtre : on ne touche plus à rien.
        if unsafe { GetForegroundWindow() } as isize != hwnd {
            break;
        }
        if let Some(state) = pad() {
            let g = state.Gamepad;
            let step = SPEED * FRAME.as_secs_f32();
            rest_x += axis(g.sThumbLX) * step + axis(g.sThumbRX) * step;
            rest_y += -axis(g.sThumbLY) * step - axis(g.sThumbRY) * step;
            let (dx, dy) = (rest_x.trunc(), rest_y.trunc());
            if dx != 0.0 || dy != 0.0 {
                move_by(dx, dy);
                rest_x -= dx;
                rest_y -= dy;
            }
            let down = g.wButtons & (XINPUT_GAMEPAD_A | XINPUT_GAMEPAD_B) != 0;
            if down && !pressed {
                click();
            }
            pressed = down;
        }
        sleep(FRAME);
    }
    true
}
