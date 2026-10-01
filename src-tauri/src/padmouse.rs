//! La manette et le clavier pilotent le curseur, le temps d'une fenêtre Steam (Windows).
//!
//! Steam n'expose sa boîte d'installation ni au clavier ni à l'accessibilité : on a mesuré zéro
//! bouton en UI Automation, et ni Tab ni Entrée n'y font quoi que ce soit. Cliquer à la place de
//! l'utilisateur reviendrait, devant un contrat de licence, à l'accepter pour lui. Le problème se
//! prend donc à l'envers : tant qu'une fenêtre de Steam est ouverte, les sticks ou les flèches
//! déplacent le curseur du système, et Ⓐ ou Entrée clique. C'est l'utilisateur qui décide, pour
//! n'importe quelle fenêtre et quelle que soit sa disposition.
//!
//! La manette est lue en XInput et le clavier par `GetAsyncKeyState`, plutôt que par la page :
//! elle ne reçoit plus rien dès qu'elle perd le focus, ce qui est précisément le cas ici.

use std::thread::sleep;
use std::time::{Duration, Instant};

use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM, POINT, RECT, TRUE};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    mouse_event, GetAsyncKeyState, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_WHEEL,
    VIRTUAL_KEY, VK_DOWN, VK_ESCAPE, VK_LEFT, VK_NEXT, VK_PRIOR, VK_RETURN, VK_RIGHT, VK_SHIFT, VK_UP,
};
use windows_sys::Win32::UI::Input::XboxController::{
    XInputGetState, XINPUT_GAMEPAD_A, XINPUT_GAMEPAD_B, XINPUT_STATE,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetClassNameW, GetCursorPos, GetForegroundWindow, GetWindowRect,
    GetWindowThreadProcessId, IsWindowVisible, SetCursorPos, SetForegroundWindow,
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
/// Facteur appliqué gâchette ou Maj enfoncée, pour viser un petit bouton.
const PRECISION: f32 = 0.25;
/// Au-delà, la gâchette compte comme enfoncée.
const TRIGGER: u8 = 60;
/// Part de la vitesse maximale à laquelle partent les flèches : un appui bref règle finement.
const KEY_START: f32 = 0.12;
/// Durée au bout de laquelle une flèche tenue atteint la vitesse maximale.
const KEY_RAMP: Duration = Duration::from_millis(600);
/// Vitesse de défilement, en crans de molette par seconde.
const SCROLL_SPEED: f32 = 12.0;
/// Un cran de molette, tel que Windows le compte.
const WHEEL_STEP: f32 = 120.0;
/// Délai laissé à la fenêtre pour passer au premier plan avant qu'on la tienne pour quittée.
const GRACE: Duration = Duration::from_millis(1500);
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

/// Vrai si la fenêtre au premier plan est une fenêtre de Steam.
pub fn steam_in_front() -> bool {
    let front = unsafe { GetForegroundWindow() };
    let mut buf = [0u16; 64];
    let len = unsafe { GetClassNameW(front, buf.as_mut_ptr(), buf.len() as i32) };
    len > 0 && String::from_utf16_lossy(&buf[..len as usize]) == CLASS
}

/// Vrai si cette fenêtre appartient à 3DSteam.
fn ours(hwnd: HWND) -> bool {
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
    pid == std::process::id()
}

/* ─── Manette, clavier et curseur ─────────────────────────────────────────────────────── */

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

/// Touche enfoncée en ce moment, quelle que soit la fenêtre qui a le focus.
fn held(key: VIRTUAL_KEY) -> bool {
    (unsafe { GetAsyncKeyState(key as i32) } as u16 & 0x8000) != 0
}

/// Ⓐ ou Entrée : ce qui déclenche un clic.
fn clicking(state: Option<&XINPUT_STATE>) -> bool {
    state.is_some_and(|s| s.Gamepad.wButtons & XINPUT_GAMEPAD_A != 0) || held(VK_RETURN)
}

/// Ⓑ ou Échap : revenir à 3DSteam.
fn going_back(state: Option<&XINPUT_STATE>) -> bool {
    state.is_some_and(|s| s.Gamepad.wButtons & XINPUT_GAMEPAD_B != 0) || held(VK_ESCAPE)
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
 * Laisse la manette et le clavier piloter le curseur tant qu'une fenêtre Steam apparue après
 * `before` reste ouverte. Rend la main dès qu'elle se ferme, si l'utilisateur passe ailleurs, ou
 * au bout de `budget`. Renvoie `true` si une fenêtre a bien été prise en charge.
 *
 * Stick gauche ou flèches : le curseur. Stick droit ou Page↑/Page↓ : le défilement — un contrat
 * de licence doit être parcouru avant que son bouton s'active. Gâchette ou Maj : ralenti, pour
 * viser une case à cocher. Ⓐ ou Entrée clique là où l'utilisateur a amené le curseur, et nulle
 * part ailleurs.
 */
pub fn drive(before: &[isize], appear: Duration, budget: Duration) -> bool {
    let Some(hwnd) = wait_for(appear, || opened(before)) else { return false };
    pilot(hwnd, budget, false, || opened(before));
    true
}

/// La plus grande fenêtre de Steam visible : sa fenêtre principale.
fn main_window() -> Option<isize> {
    windows()
        .into_iter()
        .filter_map(|hwnd| rect(hwnd).map(|r| (hwnd, (r.right - r.left) * (r.bottom - r.top))))
        .max_by_key(|&(_, area)| area)
        .map(|(hwnd, _)| hwnd)
}

/**
 * La fenêtre principale de Steam, qu'on vient d'amener sur une page (la liste des
 * téléchargements) : même pilotage, mais elle ne se ferme pas d'elle-même. Ⓑ ou Échap rend
 * donc la main à 3DSteam.
 */
pub fn drive_main(appear: Duration, budget: Duration) -> bool {
    let Some(hwnd) = wait_for(appear, main_window) else { return false };
    pilot(hwnd, budget, true, || (unsafe { IsWindowVisible(hwnd as HWND) } != 0).then_some(hwnd));
    true
}

fn wait_for(appear: Duration, find: impl Fn() -> Option<isize>) -> Option<isize> {
    let until = Instant::now() + appear;
    loop {
        if let Some(hwnd) = find() {
            return Some(hwnd);
        }
        if Instant::now() >= until {
            return None;
        }
        sleep(FRAME);
    }
}

/// Pilote `hwnd` tant que `current` la trouve encore. Avec `back`, Ⓑ ou Échap y mettent fin.
fn pilot(hwnd: isize, budget: Duration, back: bool, current: impl Fn() -> Option<isize>) {
    // Steam n'obtient pas toujours le premier plan, et sans lui ni les touches ni le pilotage ne
    // porteraient sur sa fenêtre. On le lui donne, mais seulement si l'utilisateur est encore dans
    // 3DSteam : s'il est passé ailleurs entre-temps, on ne l'en arrache pas.
    let front = unsafe { GetForegroundWindow() };
    if front as isize != hwnd && ours(front) {
        unsafe { SetForegroundWindow(hwnd as HWND) };
    }

    // Le curseur est amené au centre de la fenêtre : sans ça il faudrait parfois traverser tout
    // l'écran au stick avant d'atteindre quoi que ce soit. Au centre, et pas sur un bouton : le
    // choix reste entier.
    if let Some(r) = rect(hwnd) {
        unsafe { SetCursorPos((r.left + r.right) / 2, (r.top + r.bottom) / 2) };
    }

    let start = Instant::now();
    let stop = start + budget;
    // Relevés au départ : l'Entrée ou le Ⓐ qui a demandé l'installation est peut-être encore
    // enfoncé, et ne doit pas cliquer au centre d'une fenêtre à peine ouverte.
    let mut pressed = clicking(pad().as_ref());
    let mut leaving = going_back(pad().as_ref());
    let (mut paging_up, mut paging_down) = (held(VK_PRIOR), held(VK_NEXT));
    let mut arrows_since: Option<Instant> = None;
    let mut focused = false;
    // Les restes fractionnaires sont gardés d'une image à l'autre, sinon les petits déplacements
    // seraient arrondis à zéro et le curseur ne bougerait pas au ralenti.
    let (mut rest_x, mut rest_y, mut rest_scroll) = (0.0f32, 0.0f32, 0.0f32);

    while Instant::now() < stop {
        let Some(hwnd) = current() else { break };
        // L'utilisateur est parti sur une autre fenêtre : on ne touche plus à rien. Le temps que
        // Steam passe au premier plan, on patiente sans rien piloter.
        if unsafe { GetForegroundWindow() } as isize != hwnd {
            if focused || start.elapsed() >= GRACE {
                break;
            }
            sleep(FRAME);
            continue;
        }
        focused = true;

        let state = pad();
        let g = state.map(|s| s.Gamepad);
        let slow = held(VK_SHIFT)
            || g.is_some_and(|g| g.bLeftTrigger > TRIGGER || g.bRightTrigger > TRIGGER);
        let step = SPEED * FRAME.as_secs_f32() * if slow { PRECISION } else { 1.0 };

        let (mut vx, mut vy) = g.map_or((0.0, 0.0), |g| (axis(g.sThumbLX), -axis(g.sThumbLY)));
        let keys_x = held(VK_RIGHT) as i32 - held(VK_LEFT) as i32;
        let keys_y = held(VK_DOWN) as i32 - held(VK_UP) as i32;
        if keys_x != 0 || keys_y != 0 {
            // Les flèches partent lentement, pour un réglage au pixel près, puis accélèrent.
            let since = *arrows_since.get_or_insert_with(Instant::now);
            let ramp = (KEY_START + since.elapsed().as_secs_f32() / KEY_RAMP.as_secs_f32()).min(1.0);
            vx += keys_x as f32 * ramp;
            vy += keys_y as f32 * ramp;
        } else {
            arrows_since = None;
        }

        rest_x += vx.clamp(-1.0, 1.0) * step;
        rest_y += vy.clamp(-1.0, 1.0) * step;
        let (dx, dy) = (rest_x.trunc(), rest_y.trunc());
        if dx != 0.0 || dy != 0.0 {
            if let Some(at) = cursor() {
                unsafe { SetCursorPos(at.x + dx as i32, at.y + dy as i32) };
            }
            rest_x -= dx;
            rest_y -= dy;
        }

        // Page↑/Page↓ défilent d'un cran dès l'appui, puis en continu tant qu'elles sont tenues.
        let (up, down) = (held(VK_PRIOR), held(VK_NEXT));
        if up && !paging_up {
            rest_scroll += 1.0;
        }
        if down && !paging_down {
            rest_scroll -= 1.0;
        }
        (paging_up, paging_down) = (up, down);
        let keys_scroll = (up as i32 - down as i32) as f32;
        let stick_scroll = g.map_or(0.0, |g| axis(g.sThumbRY));
        rest_scroll +=
            (stick_scroll + keys_scroll).clamp(-1.0, 1.0) * SCROLL_SPEED * FRAME.as_secs_f32();
        let notches = rest_scroll.trunc();
        if notches != 0.0 {
            scroll(notches as i32);
            rest_scroll -= notches;
        }

        let down = clicking(state.as_ref());
        if down && !pressed {
            click();
        }
        pressed = down;

        let back_down = going_back(state.as_ref());
        if back && back_down && !leaving {
            break;
        }
        leaving = back_down;
        sleep(FRAME);
    }
}
