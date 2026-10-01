//! Quels jeux tournent, le jeu qu'on vient de lancer est-il vraiment ouvert, et comment l'arrêter.
//!
//! Steam note les processus de chaque jeu dans `logs/gameprocess_log.txt` (« AppID 3431300 adding
//! PID 39220 as a tracked process "…\slowroads.exe" », puis « no longer tracking PID 39220 »).
//! Démarré ne suffit pas : un jeu tourne parfois plusieurs secondes avant d'afficher sa fenêtre ;
//! il est ouvert quand l'un de ses processus montre une vraie fenêtre. En attendant, 3DSteam garde
//! un fond noir.
//!
//! Pour l'arrêter, on demande d'abord à ses fenêtres de se fermer (comme la croix : le jeu peut
//! proposer de sauvegarder) ; forcer l'arrêt termine ses processus. Dans les deux cas, on ne touche
//! qu'à un processus encore vivant dont l'exécutable est bien celui que Steam a noté : un numéro de
//! processus repris entre-temps par un autre programme n'est jamais visé.

use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use serde::Serialize;

/// La fin du journal suffit : le lancement qu'on attend vient d'y être écrit.
const LOG_TAIL: u64 = 256 * 1024;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameState {
    /// Steam le considère comme lancé.
    pub running: bool,
    /// Une fenêtre du jeu est visible à l'écran.
    pub window: bool,
}

/// Ce qu'a donné une demande d'arrêt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StopOutcome {
    /// Ses fenêtres ont reçu l'ordre de se fermer : le jeu s'en va de lui-même, ou demande quelque chose.
    Closing,
    /// Aucune fenêtre à fermer : seul l'arrêt forcé peut l'interrompre.
    NoWindow,
    /// Ses processus ont été terminés.
    Killed,
    /// Rien ne tourne pour ce jeu.
    NotRunning,
}

/// Un processus suivi par Steam, et le nom de l'exécutable que le journal lui donne.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Tracked {
    pid: u32,
    /// Nom du fichier, en minuscules (`slowroads.exe`) ; vide si le journal ne le donne pas.
    exe: String,
}

fn read_tail(steam_root: &Path) -> String {
    let Ok(mut file) = File::open(steam_root.join("logs").join("gameprocess_log.txt")) else { return String::new() };
    let len = file.metadata().map(|m| m.len()).unwrap_or(0);
    if file.seek(SeekFrom::Start(len.saturating_sub(LOG_TAIL))).is_err() {
        return String::new();
    }
    let mut bytes = Vec::new();
    if file.read_to_end(&mut bytes).is_err() {
        return String::new();
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

/// Le numéro 32 bits d'un jeu : un jeu hors Steam est noté sous son identifiant 64 bits.
fn appid_of(id: u64) -> u32 {
    if id > u64::from(u32::MAX) {
        (id >> 32) as u32
    } else {
        id as u32
    }
}

/// Nom de l'exécutable d'une ligne de commande (`""C:\…\Potion Craft.exe""`, `"C:\…\x.exe" --type=…`).
fn exe_name(command: &str) -> String {
    let cmd = command.trim().trim_start_matches('"');
    let lower = cmd.to_ascii_lowercase();
    let Some(end) = lower.find(".exe") else { return String::new() };
    let path = &lower[..end + 4];
    path.rsplit(['\\', '/']).next().unwrap_or(path).to_owned()
}

/// Processus encore suivis par Steam, jeu par jeu.
fn tracked_all(log: &str) -> HashMap<u32, Vec<Tracked>> {
    let mut map: HashMap<u32, Vec<Tracked>> = HashMap::new();
    for line in log.lines() {
        let Some((_, rest)) = line.split_once("AppID ") else { continue };
        let Some((id, rest)) = rest.split_once(' ') else { continue };
        let Ok(id) = id.parse::<u64>() else { continue };
        let appid = appid_of(id);
        let pid = |marker: &str| rest.split_once(marker)?.1.split_whitespace().next()?.trim_end_matches(',').parse::<u32>().ok();
        if let Some(pid) = pid("adding PID ") {
            let exe = rest.split_once("as a tracked process ").map(|(_, cmd)| exe_name(cmd)).unwrap_or_default();
            let list = map.entry(appid).or_default();
            list.retain(|t| t.pid != pid);
            list.push(Tracked { pid, exe });
        } else if let Some(pid) = pid("no longer tracking PID ") {
            if let Some(list) = map.get_mut(&appid) {
                list.retain(|t| t.pid != pid);
            }
        }
    }
    map.retain(|_, list| !list.is_empty());
    map
}

fn tracked_of(steam_root: &Path, appid: u32) -> Vec<Tracked> {
    tracked_all(&read_tail(steam_root)).remove(&appid).unwrap_or_default()
}

#[cfg(test)]
fn tracked_pids(steam_root: &Path, appid: u32) -> HashSet<u32> {
    tracked_of(steam_root, appid).into_iter().map(|t| t.pid).collect()
}

/// Le processus tourne-t-il encore, et est-ce bien l'exécutable noté par Steam ?
#[cfg(windows)]
fn alive(t: &Tracked) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, t.pid);
        if handle.is_null() {
            return false;
        }
        let mut code = 0u32;
        let running = GetExitCodeProcess(handle, &mut code) != 0 && code == STILL_ACTIVE as u32;
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let named = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut len) != 0;
        CloseHandle(handle);
        if !running || !named {
            return false;
        }
        let path = String::from_utf16_lossy(&buf[..len as usize]).to_lowercase();
        let name = path.rsplit(['\\', '/']).next().unwrap_or(&path);
        t.exe.is_empty() || name == t.exe
    }
}

/// Les processus vivants et vérifiés d'un jeu.
#[cfg(windows)]
fn live(list: Vec<Tracked>) -> Vec<Tracked> {
    list.into_iter().filter(alive).collect()
}

/// Steam marque le jeu « en cours » dans le registre tant qu'il tourne.
#[cfg(windows)]
fn running_in_registry(appid: u32) -> bool {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(format!(r"Software\Valve\Steam\Apps\{appid}"))
        .and_then(|key| key.get_value::<u32, _>("Running"))
        .is_ok_and(|v| v == 1)
}

/// Tous les jeux que le registre de Steam dit lancés.
#[cfg(windows)]
fn registry_running() -> Vec<u32> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let Ok(apps) = RegKey::predef(HKEY_CURRENT_USER).open_subkey(r"Software\Valve\Steam\Apps") else { return Vec::new() };
    apps.enum_keys()
        .flatten()
        .filter_map(|name| {
            let appid: u32 = name.parse().ok()?;
            let on = apps.open_subkey(&name).and_then(|k| k.get_value::<u32, _>("Running")).is_ok_and(|v| v == 1);
            on.then_some(appid)
        })
        .collect()
}

/// Visite les fenêtres visibles de ces processus ; `visit` reçoit chacune, `true` pour continuer.
#[cfg(windows)]
fn each_window(pids: &HashSet<u32>, mut visit: impl FnMut(windows_sys::Win32::Foundation::HWND) -> bool) {
    use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowThreadProcessId, IsWindowVisible};

    struct Search<'a> {
        pids: &'a HashSet<u32>,
        visit: &'a mut dyn FnMut(HWND) -> bool,
    }
    unsafe extern "system" fn step(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let search = &mut *(lparam as *mut Search);
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if search.pids.contains(&pid) && IsWindowVisible(hwnd) != 0 && !(search.visit)(hwnd) {
            return 0;
        }
        1
    }
    if pids.is_empty() {
        return;
    }
    let mut search = Search { pids, visit: &mut visit };
    unsafe { EnumWindows(Some(step), &mut search as *mut Search as LPARAM) };
}

/// Une fenêtre visible, de taille réelle, appartient-elle à l'un de ces processus ?
#[cfg(windows)]
fn has_window(pids: &HashSet<u32>) -> bool {
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetWindowRect;
    let mut found = false;
    each_window(pids, |hwnd| {
        let mut r = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        // Les fenêtres minuscules (outils, fenêtres cachées d'un moteur) ne comptent pas.
        found = unsafe { GetWindowRect(hwnd, &mut r) } != 0 && r.right - r.left >= 200 && r.bottom - r.top >= 150;
        !found
    });
    found
}

#[cfg(windows)]
pub fn state(steam_root: &Path, appid: u32) -> GameState {
    let pids: HashSet<u32> = tracked_of(steam_root, appid).into_iter().map(|t| t.pid).collect();
    let window = has_window(&pids);
    // Le registre ne connaît pas les jeux hors Steam : leurs processus suivis suffisent.
    let tracked = crate::shortcuts::is_shortcut(appid) && !pids.is_empty();
    GameState { running: window || tracked || running_in_registry(appid), window }
}

#[cfg(not(windows))]
pub fn state(steam_root: &Path, appid: u32) -> GameState {
    let running = !tracked_of(steam_root, appid).is_empty();
    GameState { running, window: running }
}

/// Les jeux qui tournent : un processus suivi par Steam encore vivant, ou le registre de Steam.
#[cfg(windows)]
pub fn running_games(steam_root: &Path) -> Vec<u32> {
    let mut out: HashSet<u32> = tracked_all(&read_tail(steam_root))
        .into_iter()
        .filter(|(_, list)| list.iter().any(alive))
        .map(|(appid, _)| appid)
        .collect();
    out.extend(registry_running());
    let mut out: Vec<u32> = out.into_iter().collect();
    out.sort_unstable();
    out
}

#[cfg(not(windows))]
pub fn running_games(steam_root: &Path) -> Vec<u32> {
    tracked_all(&read_tail(steam_root)).into_keys().collect()
}

/// Arrête un jeu : ses fenêtres reçoivent l'ordre de se fermer, ou (`force`) ses processus sont terminés.
#[cfg(windows)]
pub fn stop(steam_root: &Path, appid: u32, force: bool) -> StopOutcome {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE};
    use windows_sys::Win32::UI::WindowsAndMessaging::{PostMessageW, WM_CLOSE};

    let procs = live(tracked_of(steam_root, appid));
    if procs.is_empty() {
        return StopOutcome::NotRunning;
    }
    if !force {
        let pids: HashSet<u32> = procs.iter().map(|t| t.pid).collect();
        let mut asked = 0;
        each_window(&pids, |hwnd| {
            if unsafe { PostMessageW(hwnd, WM_CLOSE, 0, 0) } != 0 {
                asked += 1;
            }
            true
        });
        return if asked > 0 { StopOutcome::Closing } else { StopOutcome::NoWindow };
    }
    for t in &procs {
        // Vérifié juste avant de viser : le processus est toujours celui que Steam a noté.
        if !alive(t) {
            continue;
        }
        unsafe {
            let handle = OpenProcess(PROCESS_TERMINATE, 0, t.pid);
            if !handle.is_null() {
                TerminateProcess(handle, 1);
                CloseHandle(handle);
            }
        }
    }
    StopOutcome::Killed
}

#[cfg(not(windows))]
pub fn stop(_steam_root: &Path, _appid: u32, _force: bool) -> StopOutcome {
    StopOutcome::NotRunning
}

#[cfg(test)]
mod tests {
    use super::*;

    const LOG: &str = "[2026-10-01 14:39:47] AppID 2802290 adding PID 36496 as a tracked process \"x.exe\"\n\
         [2026-10-01 14:40:41] AppID 3431300 adding PID 39220 as a tracked process \"\"C:\\Games\\Slow Roads\\slowroads.exe\"\"\n\
         [2026-10-01 14:40:43] AppID 3431300 adding PID 12316 as a tracked process \"\"C:\\Games\\Slow Roads\\slowroads.exe\" --type=utility\"\n\
         [2026-10-01 14:41:02] AppID 3431300 no longer tracking PID 12316, exit code 0\n\
         [2026-10-01 14:42:00] AppID 16269074390564470784 adding PID 18444 as a tracked process \"paperclips.exe\"\n\
         [2026-10-01 14:43:00] AppID 2802290 no longer tracking PID 36496, exit code 0\n";

    #[test]
    fn follows_tracked_processes() {
        let map = tracked_all(LOG);
        assert_eq!(map.get(&3431300), Some(&vec![Tracked { pid: 39220, exe: "slowroads.exe".into() }]));
        // Un jeu dont tous les processus sont partis ne tourne plus.
        assert!(!map.contains_key(&2802290));
        // Jeu hors Steam : son numéro 32 bits, retrouvé sous son identifiant 64 bits.
        assert_eq!(map.get(&3_787_939_062).map(|l| l[0].pid), Some(18444));
    }

    #[test]
    fn reads_the_executable_name() {
        assert_eq!(exe_name("\"\"C:\\Program Files (x86)\\Steam\\steamapps\\common\\Potion Craft\\Potion Craft.exe\"\""), "potion craft.exe");
        assert_eq!(exe_name("\"C:\\Games\\X.EXE\" --type=renderer"), "x.exe");
        assert_eq!(exe_name("\"\""), "");
    }

    #[test]
    fn reads_the_log_file() {
        let dir = std::env::temp_dir().join(format!("3dsteam-gamewatch-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("logs")).unwrap();
        std::fs::write(dir.join("logs").join("gameprocess_log.txt"), LOG).unwrap();
        assert_eq!(tracked_pids(&dir, 3431300), HashSet::from([39220]));
        assert!(tracked_pids(&dir, 1).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Un numéro de processus ne suffit pas : l'exécutable doit être celui que Steam a noté.
    #[cfg(windows)]
    #[test]
    fn checks_the_process_identity() {
        let me = std::process::id();
        let exe = std::env::current_exe().unwrap();
        let name = exe.file_name().unwrap().to_string_lossy().to_lowercase();
        assert!(alive(&Tracked { pid: me, exe: name }));
        assert!(!alive(&Tracked { pid: me, exe: "un-autre-jeu.exe".into() }));
        assert!(!alive(&Tracked { pid: 0xFFFF_FFF0, exe: String::new() }));
    }

    /// Arrêt d'un « jeu » jetable : un `ping` sans fenêtre, noté dans un faux journal de Steam.
    #[cfg(windows)]
    #[test]
    fn stops_only_the_tracked_process() {
        use std::os::windows::process::CommandExt;
        let mut child = std::process::Command::new("ping")
            .args(["-n", "30", "127.0.0.1"])
            .stdout(std::process::Stdio::null())
            .creation_flags(0x0800_0000)
            .spawn()
            .unwrap();
        let dir = std::env::temp_dir().join(format!("3dsteam-stop-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("logs")).unwrap();
        let pid = child.id();
        let log = |exe: &str| format!("[2026-10-01 15:00:00] AppID 42 adding PID {pid} as a tracked process \"\"C:\\Windows\\System32\\{exe}\"\"\n");
        // Mauvais exécutable : le processus n'est pas celui que Steam a noté, on n'y touche pas.
        std::fs::write(dir.join("logs").join("gameprocess_log.txt"), log("autre.exe")).unwrap();
        assert_eq!(stop(&dir, 42, true), StopOutcome::NotRunning);
        assert!(child.try_wait().unwrap().is_none());

        std::fs::write(dir.join("logs").join("gameprocess_log.txt"), log("PING.EXE")).unwrap();
        assert!(running_games(&dir).contains(&42));
        // Pas de fenêtre : seul l'arrêt forcé peut le fermer.
        assert_eq!(stop(&dir, 42, false), StopOutcome::NoWindow);
        assert_eq!(stop(&dir, 42, true), StopOutcome::Killed);
        let status = child.wait().unwrap();
        assert!(!status.success());
        assert_eq!(stop(&dir, 42, true), StopOutcome::NotRunning);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Jeu réel : `cargo test gamewatch -- --ignored --nocapture` (variable APPID).
    #[test]
    #[ignore]
    fn live_game() {
        let root = crate::steam::find_steam_root().expect("Steam introuvable");
        let appid: u32 = std::env::var("APPID").ok().and_then(|v| v.parse().ok()).unwrap_or(3431300);
        println!("processus suivis : {:?}", tracked_of(&root, appid));
        println!("état : {:?}", state(&root, appid));
        println!("jeux lancés : {:?}", running_games(&root));
    }
}
