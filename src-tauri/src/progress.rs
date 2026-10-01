//! Progression des téléchargements Steam, en direct.
//!
//! Steam n'a pas d'API, et ses manifestes ne suffisent pas : mesuré sur un téléchargement de
//! 5 Go, `BytesDownloaded` n'y est réécrit qu'environ toutes les quatre minutes, et la mise en
//! pause n'y apparaît pas du tout. Trois sources sont donc croisées :
//!
//! - les manifestes, pour les totaux, et comme repères exacts quand Steam les réécrit ;
//! - le journal `logs/content_log.txt`, qui annonce chaque phase (préparation, téléchargement,
//!   vérification, installation, pause) et donne les compteurs exacts à chaque démarrage ;
//! - entre deux repères, les octets que `steam.exe` écrit sur disque. Ils suivent les octets
//!   installés à 1 % près : 2 281 Mo écrits pour 2 252 Mo installés sur la mesure, quand les
//!   autres compteurs d'entrées-sorties du processus n'en voyaient que 1 259.

use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Instant;

use serde::Serialize;

use crate::steam::{self, STATE_PAUSED, STATE_RUNNING};

/// Au premier passage, seule la fin du journal est lue : de quoi retrouver l'état des
/// téléchargements en cours sans parcourir des mois d'historique.
const LOG_TAIL: u64 = 1 << 20;
/// Constante de temps du lissage du débit, en secondes : Steam écrit par salves.
const RATE_SMOOTHING: f64 = 4.0;

/// Où en est un téléchargement.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    /// En file, derrière un autre.
    Queued,
    /// Configuration, vérification des fichiers existants, réservation de l'espace disque.
    Preparing,
    Downloading,
    /// Vérification des fichiers reçus.
    Verifying,
    /// Déplacement des fichiers vers le dossier du jeu.
    Installing,
    Paused,
}

/// Un téléchargement, tel que l'interface l'affiche.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Download {
    pub appid: u32,
    pub name: String,
    pub bytes_downloaded: u64,
    pub bytes_to_download: u64,
    /// Débit lissé, en octets téléchargés par seconde ; nul hors téléchargement actif.
    pub rate: u64,
    pub phase: Phase,
}

/* ─── Journal de Steam ────────────────────────────────────────────────────────────────── */

/// Compteurs exacts, tels que le journal les donne au démarrage d'un téléchargement.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Counters {
    to_download: u64,
    staged: u64,
    to_stage: u64,
}

/// Ce que le journal dit d'un jeu, à sa dernière mention.
#[derive(Debug, Default)]
struct Logged {
    /// « Running Update,Downloading,Staging, »
    update: String,
    /// « Update Required,Update Queued,Update Started, (Suspended) »
    state: String,
    started: Option<Counters>,
    /// Numéro du dernier démarrage lu, pour ne s'en servir qu'une fois comme repère.
    seq: u64,
}

/// Lecture au fil de l'eau de `content_log.txt` : seules les lignes ajoutées depuis le dernier
/// passage sont lues.
#[derive(Debug)]
struct Journal {
    path: PathBuf,
    offset: Option<u64>,
    /// Fin de ligne pas encore écrite par Steam au dernier passage.
    partial: String,
    apps: HashMap<u32, Logged>,
    seq: u64,
}

impl Journal {
    fn new(steam_root: &Path) -> Self {
        Self {
            path: steam_root.join("logs").join("content_log.txt"),
            offset: None,
            partial: String::new(),
            apps: HashMap::new(),
            seq: 0,
        }
    }

    fn refresh(&mut self) {
        let Ok(mut file) = File::open(&self.path) else { return };
        let Ok(len) = file.metadata().map(|m| m.len()) else { return };
        let (start, skip_first) = match self.offset {
            // Journal recommencé : Steam l'a archivé et en a ouvert un neuf.
            Some(offset) if offset > len => {
                self.partial.clear();
                (0, false)
            }
            Some(offset) => (offset, false),
            None => {
                let start = len.saturating_sub(LOG_TAIL);
                (start, start > 0)
            }
        };
        if file.seek(SeekFrom::Start(start)).is_err() {
            return;
        }
        let mut bytes = Vec::new();
        if file.take(len - start).read_to_end(&mut bytes).is_err() {
            return;
        }
        self.offset = Some(start + bytes.len() as u64);

        let mut text = std::mem::take(&mut self.partial);
        text.push_str(&String::from_utf8_lossy(&bytes));
        // La dernière ligne peut être en cours d'écriture : elle attend le passage suivant.
        let complete = text.rfind('\n').map_or(0, |i| i + 1);
        self.partial = text.split_off(complete);
        // Lu depuis le milieu du fichier, le début est un morceau de ligne.
        let lines = text.lines().skip(usize::from(skip_first));
        for line in lines {
            self.line(line);
        }
    }

    /// « [2026-09-30 09:42:34] AppID 586200 App update changed : Running Update,Downloading, »
    fn line(&mut self, line: &str) {
        let Some((_, rest)) = line.split_once("] AppID ") else { return };
        let Some((id, event)) = rest.split_once(' ') else { return };
        let Ok(appid) = id.parse::<u32>() else { return };
        if let Some(update) = event.strip_prefix("App update changed : ") {
            self.apps.entry(appid).or_default().update = update.trim().to_owned();
        } else if let Some(state) = event.strip_prefix("state changed : ") {
            self.apps.entry(appid).or_default().state = state.trim().to_owned();
        } else if let Some(counters) = event.strip_prefix("update started : ").and_then(started) {
            self.seq += 1;
            let logged = self.apps.entry(appid).or_default();
            logged.started = Some(counters);
            logged.seq = self.seq;
        }
    }
}

/// « download 2038755040/5001019184, store 0/0, reuse 0/0, delta 0/0, stage 2283910112/5309376830 »
fn started(text: &str) -> Option<Counters> {
    let pair = |name: &str| -> Option<(u64, u64)> {
        let value = text.split(',').find_map(|part| part.trim().strip_prefix(name))?;
        let (done, total) = value.trim().split_once('/')?;
        Some((done.parse().ok()?, total.parse().ok()?))
    };
    let (_, to_download) = pair("download ")?;
    let (staged, to_stage) = pair("stage ")?;
    Some(Counters { to_download, staged, to_stage })
}

/// La phase d'après le journal, ou à défaut d'après les drapeaux du manifeste.
fn phase(logged: Option<&Logged>, flags: u64) -> Phase {
    if let Some(logged) = logged {
        let (update, state) = (logged.update.as_str(), logged.state.as_str());
        if state.contains("Suspended") {
            return Phase::Paused;
        }
        if update.contains("Committing") {
            return Phase::Installing;
        }
        if update.contains("Verifying Staged") {
            return Phase::Verifying;
        }
        if update.contains("Downloading") || update.contains("Staging") {
            return Phase::Downloading;
        }
        if update.contains("Running Update") || state.contains("Update Running") {
            return Phase::Preparing;
        }
        if state.contains("Update Queued") {
            return Phase::Queued;
        }
    }
    if flags & STATE_PAUSED != 0 {
        Phase::Paused
    } else if flags & STATE_RUNNING != 0 {
        Phase::Downloading
    } else {
        Phase::Queued
    }
}

/* ─── Octets écrits par Steam ─────────────────────────────────────────────────────────── */

/// Total des octets écrits sur disque par `steam.exe` depuis son lancement.
#[cfg(windows)]
fn written() -> Option<u64> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        GetProcessIoCounters, OpenProcess, IO_COUNTERS, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    let pid = crate::steamctl::steam_pid()?;
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() {
            return None;
        }
        let mut counters: IO_COUNTERS = std::mem::zeroed();
        let ok = GetProcessIoCounters(process, &mut counters) != 0;
        CloseHandle(process);
        ok.then_some(counters.WriteTransferCount)
    }
}

#[cfg(not(windows))]
fn written() -> Option<u64> {
    None
}

/* ─── Suivi ───────────────────────────────────────────────────────────────────────────── */

/// Ce qu'on sait d'un téléchargement d'un passage à l'autre.
#[derive(Debug)]
struct Track {
    /// Octets installés, estimés.
    staged: f64,
    /// Derniers compteurs lus dans le manifeste : un changement en fait un repère exact.
    manifest: Option<(u64, u64)>,
    /// Dernier démarrage du journal déjà pris comme repère.
    seq: u64,
    /// Débit lissé, en octets téléchargés par seconde.
    rate: f64,
}

#[derive(Debug)]
struct Live {
    journal: Journal,
    tracks: HashMap<u32, Track>,
    written: Option<u64>,
    at: Instant,
}

static LIVE: Mutex<Option<Live>> = Mutex::new(None);

/// Les téléchargements en attente ou en cours, avec leur progression en direct.
pub fn downloads(steam_root: &Path) -> Vec<Download> {
    // Les redistribuables et autres outils se téléchargent aussi : ils ne sont pas des jeux.
    let mut pending = steam::pending(steam_root);
    pending.retain(|p| !steam::is_hidden(p.appid, &p.name));
    let mut guard = LIVE.lock().unwrap_or_else(|e| e.into_inner());
    let live = guard.get_or_insert_with(|| Live {
        journal: Journal::new(steam_root),
        tracks: HashMap::new(),
        written: None,
        at: Instant::now(),
    });
    live.journal.refresh();
    // Désinstallé d'après le journal : le manifeste qui traîne encore n'est plus un téléchargement.
    pending.retain(|p| !live.journal.apps.get(&p.appid).is_some_and(|l| l.state.starts_with("Uninstalled")));

    let now = Instant::now();
    let elapsed = now.duration_since(live.at).as_secs_f64();
    live.at = now;
    let written = written();
    // Steam relancé remet son compteur à zéro : ce passage-là ne compte rien.
    let mut fresh = match (live.written, written) {
        (Some(before), Some(after)) if after >= before => (after - before) as f64,
        _ => 0.0,
    };
    live.written = written;
    live.tracks.retain(|appid, _| pending.iter().any(|p| p.appid == *appid));

    pending
        .into_iter()
        .map(|p| {
            let logged = live.journal.apps.get(&p.appid);
            let phase = phase(logged, p.flags);
            let started = logged.and_then(|l| l.started.map(|c| (c, l.seq)));
            // Avant le premier démarrage, le manifeste ne connaît pas encore les totaux.
            let to_download = if p.to_download > 0 {
                p.to_download
            } else {
                started.map_or(0, |(c, _)| c.to_download)
            };
            let to_stage = if p.to_stage > 0 { p.to_stage } else { started.map_or(0, |(c, _)| c.to_stage) };

            let track = live.tracks.entry(p.appid).or_insert(Track {
                staged: 0.0,
                manifest: None,
                seq: 0,
                rate: 0.0,
            });
            let mut anchor: Option<u64> = None;
            if track.manifest != Some((p.downloaded, p.staged)) {
                track.manifest = Some((p.downloaded, p.staged));
                anchor = Some(p.staged);
            }
            if let Some((counters, seq)) = started.filter(|(_, seq)| *seq != track.seq) {
                track.seq = seq;
                anchor = Some(anchor.map_or(counters.staged, |a| a.max(counters.staged)));
            }

            // Steam ne télécharge qu'un jeu à la fois : ce qu'il écrit revient à celui-là.
            let active = phase == Phase::Downloading;
            let gained = if active { std::mem::take(&mut fresh) } else { 0.0 };
            match anchor {
                Some(exact) => track.staged = exact as f64,
                None => track.staged += gained,
            }
            if to_stage > 0 {
                track.staged = track.staged.min(to_stage as f64);
            }

            // Octets écrits et octets reçus diffèrent de la compression : on ramène à ces derniers.
            let ratio = if to_stage > 0 { to_download as f64 / to_stage as f64 } else { 1.0 };
            track.rate = if active && elapsed > 0.0 {
                let instant = gained / elapsed * ratio;
                let alpha = 1.0 - (-elapsed / RATE_SMOOTHING).exp();
                track.rate + (instant - track.rate) * alpha
            } else {
                0.0
            };

            let bytes_downloaded = if to_stage > 0 {
                (track.staged * ratio) as u64
            } else {
                p.downloaded
            };
            Download {
                appid: p.appid,
                name: p.name,
                bytes_downloaded: bytes_downloaded.min(to_download),
                bytes_to_download: to_download,
                rate: track.rate as u64,
                phase,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_started_counters() {
        let line = "download 2038755040/5001019184, store 0/0, reuse 0/0, delta 0/0, stage 2283910112/5309376830 ";
        assert_eq!(
            started(line),
            Some(Counters {
                to_download: 5001019184,
                staged: 2283910112,
                to_stage: 5309376830,
            })
        );
    }

    fn journal(lines: &[&str]) -> Journal {
        let mut journal = Journal::new(Path::new("."));
        for line in lines {
            journal.line(line);
        }
        journal
    }

    #[test]
    fn follows_phases() {
        let j = journal(&["[2026-09-30 09:42:31] AppID 586200 state changed : Update Required,Update Queued,"]);
        assert_eq!(phase(j.apps.get(&586200), 2), Phase::Queued);

        let j = journal(&[
            "[2026-09-30 09:42:34] AppID 586200 state changed : Update Required,Update Queued,Update Running,Update Started,",
            "[2026-09-30 09:42:34] AppID 586200 App update changed : Running Update,Preallocating,",
        ]);
        assert_eq!(phase(j.apps.get(&586200), 1026), Phase::Preparing);

        let j = journal(&[
            "[2026-09-30 09:42:34] AppID 586200 App update changed : Running Update,Downloading,Staging,",
        ]);
        assert_eq!(phase(j.apps.get(&586200), 1026), Phase::Downloading);

        let j = journal(&[
            "[2026-09-30 09:42:34] AppID 586200 App update changed : Running Update,Downloading,Staging,",
            "[2026-09-30 09:47:10] AppID 586200 App update changed : None",
            "[2026-09-30 09:47:10] AppID 586200 state changed : Update Required,Update Queued,Update Started, (Suspended)",
        ]);
        assert_eq!(phase(j.apps.get(&586200), 1026), Phase::Paused);

        let j = journal(&[
            "[2026-09-30 09:35:55] AppID 596590 App update changed : Running Update,Committing,",
        ]);
        assert_eq!(phase(j.apps.get(&596590), 1026), Phase::Installing);
    }

    #[test]
    fn falls_back_on_manifest_flags() {
        assert_eq!(phase(None, 2 | 512), Phase::Paused);
        assert_eq!(phase(None, 2 | 256), Phase::Downloading);
        assert_eq!(phase(None, 2), Phase::Queued);
    }

    /// Suivi réel pendant vingt secondes : `cargo test live -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live() {
        let root = steam::find_steam_root().expect("Steam introuvable");
        for _ in 0..20 {
            for d in downloads(&root) {
                println!(
                    "{} {:?} {:.1}/{:.1} Mo, {:.2} Mo/s",
                    d.appid,
                    d.phase,
                    d.bytes_downloaded as f64 / 1e6,
                    d.bytes_to_download as f64 / 1e6,
                    d.rate as f64 / 1e6
                );
            }
            std::thread::sleep(std::time::Duration::from_secs(1));
        }
    }

    #[test]
    fn records_each_start_once() {
        let j = journal(&[
            "[2026-09-30 09:42:34] AppID 586200 update started : download 0/5001019184, store 0/0, reuse 0/0, delta 0/0, stage 0/5309376830 ",
            "[2026-09-30 09:47:10] AppID 586200 update started : download 2038755040/5001019184, store 0/0, reuse 0/0, delta 0/0, stage 2283910112/5309376830 ",
        ]);
        let logged = j.apps.get(&586200).unwrap();
        assert_eq!(logged.seq, 2);
        assert_eq!(logged.started.unwrap().staged, 2283910112);
    }
}
