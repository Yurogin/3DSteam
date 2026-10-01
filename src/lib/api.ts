import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import type { Activity, CatalogGame, Download, Game, Library, Shot, SteamProfile, Track } from "../types";

/**
 * Pont vers les commandes Rust. Hors Tauri (`npm run dev` dans un navigateur),
 * une bibliothèque de démonstration permet de travailler l'interface.
 */

export const inTauri = isTauri();

export function loadCache(): Promise<Library | null> {
  return inTauri ? invoke<Library | null>("load_cache") : Promise.resolve(null);
}

export function scanLibrary(): Promise<Library> {
  if (inTauri) return invoke<Library>("scan_library");
  return new Promise((resolve) =>
    setTimeout(
      () =>
        resolve({
          version: 1,
          scannedAt: Date.now() / 1000,
          steamRoot: null,
          games: (demoInstalled() ? [...DEMO_GAMES, DEMO_NEW] : DEMO_GAMES).filter((g) => !demoUninstalled.has(g.appid)),
          catalog: DEMO_CATALOG.filter((g) => g.appid !== DEMO_NEW.appid || !demoInstalled()),
        }),
      400,
    ),
  );
}

/**
 * Ouvre la boîte d'installation de Steam. Avec `padMouse`, la manette et le clavier pilotent le
 * curseur tant que la fenêtre est ouverte. Vrai si une fenêtre a bien été prise en charge.
 */
export function installGame(appid: number, padMouse: boolean): Promise<boolean> {
  if (inTauri) return invoke<boolean>("install_game", { appid, padMouse });
  console.info(`[démo] steam://install/${appid}`);
  return Promise.resolve(false);
}

/** Ouvre la boîte de désinstallation de Steam, pilotable comme celle d'installation. */
export function uninstallGame(appid: number, padMouse: boolean): Promise<boolean> {
  if (inTauri) return invoke<boolean>("uninstall_game", { appid, padMouse });
  console.info(`[démo] steam://uninstall/${appid}`);
  demoUninstalled.add(appid);
  return Promise.resolve(false);
}

export function openStore(appid: number): Promise<void> {
  if (inTauri) return invoke("open_store", { appid });
  console.info(`[démo] steam://store/${appid}`);
  return Promise.resolve();
}

/** État de la fenêtre à l'ouverture. `last` : comme à la dernière fermeture. */
export type StartupMode = "last" | "window" | "maximized" | "fullscreen" | "minimized";

export interface StartupSettings {
  mode: StartupMode;
  /** Lancé par Windows à l'ouverture de session : réduit, quel que soit `mode`. */
  autostartMinimized: boolean;
  /** Inscrit au démarrage de Windows. */
  autostart: boolean;
  /** Ce lancement-ci vient de Windows. */
  autostarted: boolean;
}

/** En démo, les réglages vivent dans la page : il n'y a ni registre, ni fenêtre à régler. */
let demoStartup: StartupSettings = { mode: "last", autostartMinimized: false, autostart: false, autostarted: false };

export function startupSettings(): Promise<StartupSettings> {
  return inTauri ? invoke<StartupSettings>("startup_settings") : Promise.resolve({ ...demoStartup });
}

export function setStartupMode(mode: StartupMode, autostartMinimized: boolean): Promise<StartupSettings> {
  if (inTauri) return invoke<StartupSettings>("set_startup_mode", { mode, autostartMinimized });
  demoStartup = { ...demoStartup, mode, autostartMinimized };
  return Promise.resolve({ ...demoStartup });
}

/** Inscrit 3DSteam au démarrage de Windows, ou l'en retire. */
export function setAutostart(enabled: boolean): Promise<StartupSettings> {
  if (inTauri) return invoke<StartupSettings>("set_autostart", { enabled });
  demoStartup = { ...demoStartup, autostart: enabled };
  return Promise.resolve({ ...demoStartup });
}

export interface GameState {
  /** Steam le considère comme lancé. */
  running: boolean;
  /** Une fenêtre du jeu est à l'écran : il est vraiment ouvert. */
  window: boolean;
}

const demoLaunches = new Map<number, number>();

/** Le jeu lancé est-il vraiment ouvert ? En démo, il « s'ouvre » au bout de cinq secondes. */
export function gameState(appid: number): Promise<GameState> {
  if (inTauri) return invoke<GameState>("game_state", { appid });
  if (!demoLaunches.has(appid)) demoLaunches.set(appid, Date.now());
  const open = Date.now() - demoLaunches.get(appid)! > 5000;
  if (open) demoLaunches.delete(appid);
  return Promise.resolve({ running: true, window: open });
}

/** Quitte 3DSteam (Steam reste ouvert). */
export function quitApp(): Promise<void> {
  if (inTauri) return invoke("quit_app");
  console.info("[démo] quitter 3DSteam");
  return Promise.resolve();
}

/** Réduit la fenêtre de 3DSteam. */
export function minimizeApp(): Promise<void> {
  if (inTauri) return invoke("minimize_app");
  console.info("[démo] réduire 3DSteam");
  return Promise.resolve();
}

/** Liste des téléchargements du client, pour mettre en pause ou reprendre. */
export function openDownloads(): Promise<void> {
  if (inTauri) return invoke("open_downloads");
  console.info("[démo] steam://open/downloads");
  return Promise.resolve();
}

/** Dossier du jeu dans l'explorateur. */
export function revealGame(game: Game): Promise<void> {
  if (inTauri) return invoke("reveal_game", { appid: game.appid, libraryPath: game.libraryPath, installDir: game.installDir });
  console.info(`[démo] ouvrir ${game.libraryPath}\\steamapps\\common\\${game.installDir}`);
  return Promise.resolve();
}

/* ─── Applis intégrées ────────────────────────────────────────────────────────────────── */

/** Adresse d'un fichier local lisible par la page (musique, capture). En démo, déjà une URL. */
export function mediaSrc(path: string): string {
  return inTauri ? convertFileSrc(path) : path;
}

/** Temps de jeu par application, pour le journal d'activité. */
export function activityStats(): Promise<Activity[]> {
  if (inTauri) return invoke<Activity[]>("activity");
  return Promise.resolve(
    DEMO_GAMES.filter((g) => g.playtime > 0).map((g, i) => ({
      appid: g.appid,
      lastPlayed: g.lastPlayed,
      playtime: g.playtime,
      playtime2wks: i < 5 ? Math.round(g.playtime / (8 + i * 3)) : 0,
    })),
  );
}

/** Bandes-son Steam et dossier Musique. */
export function musicLibrary(): Promise<Track[]> {
  if (inTauri) return invoke<Track[]>("music_library");
  return Promise.resolve(demoTracks());
}

/** Captures Steam, Windows et Game Bar, les plus récentes d'abord. */
export function listScreenshots(): Promise<Shot[]> {
  if (inTauri) return invoke<Shot[]>("screenshots");
  return Promise.resolve(demoShots());
}

/** Mélodie de démonstration : quelques secondes de notes générées, pour essayer le lecteur. */
function demoTone(notes: number[]): string {
  const rate = 22050;
  const beat = 0.32;
  const samples = Math.floor(rate * beat * notes.length);
  const data = new Uint8Array(44 + samples);
  const view = new DataView(data.buffer);
  const ascii = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples, true);
  ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  ascii(36, "data");
  view.setUint32(40, samples, true);
  for (let i = 0; i < samples; i++) {
    const t = i / rate;
    const note = notes[Math.floor(t / beat)];
    const local = t % beat;
    const envelope = Math.exp(-local * 6);
    data[44 + i] = 128 + Math.round(48 * envelope * Math.sin(2 * Math.PI * note * t) + 12 * envelope * Math.sin(4 * Math.PI * note * t));
  }
  return URL.createObjectURL(new Blob([data], { type: "audio/wav" }));
}

let demoTrackCache: Track[] | null = null;
function demoTracks(): Track[] {
  if (demoTrackCache) return demoTrackCache;
  const melodies = [
    [523, 659, 784, 659, 523, 659, 784, 1047, 784, 659, 523, 392, 523, 659, 784, 523],
    [440, 554, 659, 880, 659, 554, 440, 330, 440, 554, 659, 554, 440, 494, 554, 440],
    [392, 494, 587, 784, 587, 494, 392, 294, 392, 440, 494, 587, 494, 440, 392, 392],
  ];
  const album = (name: string, appid: number, titles: string[], source: Track["source"]): Track[] =>
    titles.map((title, i) => ({
      path: demoTone(melodies[(i + appid) % melodies.length]),
      title,
      artist: source === "soundtrack" ? "Darren Korb" : null,
      album: name,
      number: i + 1,
      cover: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`,
      source,
    }));
  demoTrackCache = [
    ...album("Hades Original Soundtrack", 1145360, ["No Escape", "The House of Hades", "Out of Tartarus", "Mouth of Styx"], "soundtrack"),
    ...album("Celeste Original Soundtrack", 504230, ["Prologue", "First Steps", "Resurrections"], "soundtrack"),
    ...album("Mes morceaux", 413150, ["Matin à la ferme", "Pluie d'été"], "music"),
  ];
  return demoTrackCache;
}

function demoShots(): Shot[] {
  const now = Date.now() / 1000;
  const shots: Shot[] = [];
  DEMO_GAMES.slice(0, 8).forEach((g, i) => {
    for (const kind of ["library_hero.jpg", "header.jpg"]) {
      const url = `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/${kind}`;
      shots.push({ path: url, thumb: url, appid: g.appid, source: "steam", taken: now - i * 86_400 * 1.7 - (kind === "header.jpg" ? 3600 : 0) });
    }
  });
  shots.push({ path: "https://cdn.cloudflare.steamstatic.com/steam/apps/620/library_hero.jpg", thumb: null, appid: null, source: "windows", taken: now - 600 });
  return shots.sort((a, b) => b.taken - a.taken);
}

export type DownloadAction = "pause" | "resume" | "cancel";
/**
 * Comment Steam a été sollicité : directement (`direct`), par sa boîte de désinstallation
 * (`dialog`, pour annuler une installation), ou en ouvrant sa liste des téléchargements (`steam`).
 */
export type DownloadHandled = "direct" | "dialog" | "steam";

/**
 * `confirmed` : l'utilisateur a confirmé dans 3DSteam. Seulement alors, avec le plugin Millennium,
 * l'annulation d'une installation se fait sans la boîte de Steam.
 */
export function downloadAction(
  appid: number,
  action: DownloadAction,
  installed: boolean,
  padMouse: boolean,
  confirmed = false,
): Promise<DownloadHandled> {
  if (inTauri) return invoke<DownloadHandled>("download_action", { appid, action, installed, padMouse, confirmed });
  if (action === "pause") demoPaused.add(appid);
  else if (action === "resume") demoPaused.delete(appid);
  else demoCancelled.add(appid);
  return Promise.resolve("direct");
}

export interface SteamControl {
  /** Le fichier est posé : Steam ouvrira son port de débogage à son prochain démarrage. */
  enabled: boolean;
  /** Le port ou le plugin Millennium répond : pause, reprise et annulation passent directement. */
  connected: boolean;
  /** Millennium tient le débogage de Steam : le port ne s'ouvrira pas, c'est le plugin qui sert. */
  millennium: boolean;
  /** Le plugin 3DSteam est posé dans Millennium : il tournera au prochain démarrage de Steam. */
  bridgeInstalled: boolean;
  /** Le plugin tourne dans l'interface de Steam. */
  bridgeActive: boolean;
  /** Le plugin qui tourne est celui de ce 3DSteam : il sait aussi installer et désinstaller. */
  bridgeCurrent: boolean;
}

/** Une bibliothèque de Steam où installer un jeu. */
export interface InstallFolder {
  index: number;
  path: string;
  label: string;
  drive: string;
  /** Place libre, en octets. */
  free: number;
  isDefault: boolean;
}

/**
 * Issue d'une installation par le plugin Millennium. Sans `started`, `reason` dit pourquoi :
 * `eula` (contrat à accepter), `space`, `folder` et `steam` laissent la fenêtre de Steam à
 * l'utilisateur ; `failed`, `timeout` et `replaced` non.
 */
export interface InstallOutcome {
  started: boolean;
  reason?: string | null;
}

export function bridgeFolders(): Promise<InstallFolder[]> {
  if (inTauri) return invoke<InstallFolder[]>("bridge_folders");
  return Promise.resolve([
    { index: 0, path: "C:\\Program Files (x86)\\Steam", label: "", drive: "C:", free: 84e9, isDefault: true },
    { index: 1, path: "D:\\SteamLibrary", label: "", drive: "D:", free: 612e9, isDefault: false },
  ]);
}

export function bridgeInstall(appid: number, folder: number | null, padMouse: boolean): Promise<InstallOutcome> {
  if (inTauri) return invoke<InstallOutcome>("bridge_install", { appid, folder, padMouse });
  return new Promise((resolve) => setTimeout(() => resolve({ started: true }), 600));
}

export function bridgeUninstall(appid: number): Promise<void> {
  if (inTauri) return invoke("bridge_uninstall", { appid });
  return Promise.resolve();
}

export function steamControlState(): Promise<SteamControl> {
  return inTauri ? invoke<SteamControl>("steam_control_state") : Promise.resolve({ ...demoControl });
}

export function setSteamControl(enabled: boolean): Promise<SteamControl> {
  if (inTauri) return invoke<SteamControl>("set_steam_control", { enabled });
  demoControl.enabled = enabled;
  return Promise.resolve({ ...demoControl });
}

/** Pose ou retire le plugin 3DSteam de Millennium ; il se charge au redémarrage de Steam. */
export function setSteamBridge(enabled: boolean): Promise<SteamControl> {
  if (inTauri) return invoke<SteamControl>("set_steam_bridge", { enabled });
  demoControl.bridgeInstalled = enabled;
  return Promise.resolve({ ...demoControl });
}

/** Ferme Steam, attend qu'il soit parti, puis le relance. */
export function restartSteam(): Promise<void> {
  if (inTauri) return invoke("restart_steam");
  demoControl.bridgeActive = demoControl.millennium && demoControl.bridgeInstalled;
  demoControl.bridgeCurrent = demoControl.bridgeActive;
  demoControl.connected = demoControl.millennium ? demoControl.bridgeActive : demoControl.enabled;
  return new Promise((resolve) => setTimeout(resolve, 1500));
}

const demoControl: SteamControl = {
  enabled: false,
  connected: false,
  millennium: false,
  bridgeInstalled: false,
  bridgeActive: false,
  bridgeCurrent: false,
};
/** Dead Cells commence en pause, pour montrer les deux états. */
const demoPaused = new Set<number>([588650]);
const demoCancelled = new Set<number>();
const demoUninstalled = new Set<number>();

/** Téléchargements en cours. Dans le navigateur, trois téléchargements simulés. */
export function listDownloads(): Promise<Download[]> {
  return inTauri ? invoke<Download[]>("downloads") : Promise.resolve(demoDownloads());
}

const demoStart = Date.now();

/** Le jeu qu'installe la démo : son téléchargement dure une trentaine de secondes. */
const DEMO_INSTALL_MS = 30_000;
const demoInstalled = () => Date.now() - demoStart > DEMO_INSTALL_MS && !demoCancelled.has(DEMO_NEW.appid);

/**
 * Une installation qui s'achève, une mise à jour qui avance par à-coups, une en pause et une
 * installation en file.
 */
function demoDownloads(): Download[] {
  const list: Download[] = [];
  const since = (Date.now() - demoStart) / 1000;
  if (!demoInstalled()) {
    const total = 0.9 * 1024 ** 3;
    const rate = 42e6 + 8e6 * Math.sin(since);
    const done = Math.min(total, Math.max(0, since - 3) * 45e6);
    const phase = since < 3 ? "preparing" : done >= total ? "installing" : "downloading";
    list.push({ appid: DEMO_NEW.appid, name: DEMO_NEW.name, bytesDownloaded: done, bytesToDownload: total, rate: phase === "downloading" ? rate : 0, phase });
  }
  const total = 2.4 * 1024 ** 3;
  const elapsed = since % 200;
  const rate = 14e6 + 4e6 * Math.sin(elapsed / 3);
  const done = Math.min(total, 0.2 * total + elapsed * 14e6);
  const phase = done >= total ? "installing" : elapsed < 3 ? "preparing" : "downloading";
  list.push(
    { appid: 1145360, name: "Hades", bytesDownloaded: done, bytesToDownload: total, rate: phase === "downloading" ? rate : 0, phase },
    { appid: 588650, name: "Dead Cells", bytesDownloaded: 0.62 * 1.5 * 1024 ** 3, bytesToDownload: 1.5 * 1024 ** 3, rate: 0, phase: "paused" },
    { appid: 1030300, name: "Hollow Knight: Silksong", bytesDownloaded: 0, bytesToDownload: 7 * 1024 ** 3, rate: 0, phase: "queued" },
  );
  // Pause et annulation de la démo : un téléchargement annulé disparaît, un en pause s'arrête.
  return list
    .filter((d) => !demoCancelled.has(d.appid))
    .map((d): Download => {
      if (demoPaused.has(d.appid)) return { ...d, rate: 0, phase: "paused" };
      if (d.phase === "paused") return { ...d, rate: 9e6, phase: "downloading" };
      return d;
    });
}

export function clearCache(): Promise<void> {
  return inTauri ? invoke("clear_cache") : Promise.resolve();
}

export interface ThemeFile {
  fileName: string;
  content: string;
}

/** Thèmes du dossier `themes` (vide dans le navigateur). */
export function listThemeFiles(): Promise<ThemeFile[]> {
  return inTauri ? invoke<ThemeFile[]>("list_theme_files") : Promise.resolve([]);
}

/** Enregistre un thème dans le dossier `themes` ; dans le navigateur, le fichier est téléchargé. */
export async function saveThemeFile(fileName: string, content: string): Promise<string> {
  if (inTauri) return invoke<string>("save_theme_file", { fileName, content });
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `${fileName}.3dstheme` });
  a.click();
  URL.revokeObjectURL(url);
  return `${fileName}.3dstheme`;
}

export function openThemesDir(): Promise<void> {
  return inTauri ? invoke("open_themes_dir") : Promise.resolve();
}

/** Exporte un Svgii dans le dossier `svgii` ; dans le navigateur, le fichier est téléchargé. */
export async function saveSvgiiFile(fileName: string, content: string): Promise<string> {
  if (inTauri) return invoke<string>("save_svgii_file", { fileName, content });
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `${fileName}.svgii` });
  a.click();
  URL.revokeObjectURL(url);
  return `${fileName}.svgii`;
}

export function openSvgiiDir(): Promise<void> {
  return inTauri ? invoke("open_svgii_dir") : Promise.resolve();
}

export interface Battery {
  percent: number;
  charging: boolean;
}

/** `null` si l'ordinateur n'a pas de batterie. En démo navigateur : API Battery si disponible. */
export async function batteryStatus(): Promise<Battery | null> {
  if (inTauri) return invoke<Battery | null>("battery_status");
  const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean }> };
  const b = await nav.getBattery?.().catch(() => null);
  return b ? { percent: Math.round(b.level * 100), charging: b.charging } : null;
}

/** Profil Steam du compte actif (pseudo, anciens pseudos, niveau, avatar), lu en local. */
export function steamProfile(): Promise<SteamProfile | null> {
  if (inTauri) return invoke<SteamProfile | null>("steam_profile");
  return Promise.resolve(DEMO_PROFILE);
}

/** Avatar Steam d'après son empreinte (`_full` : 184 px, `_medium` : 64 px). */
export function avatarUrl(hash: string, size: "full" | "medium" = "medium"): string {
  return `https://avatars.steamstatic.com/${hash}_${size}.jpg`;
}

/** Pseudo Steam du compte actif : le nom proposé pour le profil. */
export function steamPersona(): Promise<string | null> {
  if (inTauri) return invoke<string | null>("steam_persona");
  return Promise.resolve("Joueur");
}

export function launchGame(appid: number): Promise<void> {
  if (inTauri) return invoke("launch_game", { appid });
  console.info(`[démo] steam://run/${appid}`);
  demoRunning.add(appid);
  return Promise.resolve();
}

/** Jeux lancés en démo. Portal 2 fait la sourde oreille quand on lui demande de fermer : de quoi voir « Forcer l'arrêt ». */
const demoRunning = new Set<number>();
const DEMO_STUBBORN = 620;

/** Jeux qui tournent en ce moment (voir `gamewatch.rs`). */
export function runningGames(): Promise<number[]> {
  if (inTauri) return invoke<number[]>("running_games");
  return Promise.resolve([...demoRunning]);
}

/** Ce qu'a donné une demande d'arrêt. */
export type StopOutcome = "closing" | "noWindow" | "killed" | "notRunning";

/** Arrête un jeu : demande à ses fenêtres de se fermer, ou (`force`) termine ses processus. */
export function stopGame(appid: number, force: boolean): Promise<StopOutcome> {
  if (inTauri) return invoke<StopOutcome>("stop_game", { appid, force });
  if (!demoRunning.has(appid)) return Promise.resolve("notRunning");
  if (force) {
    demoRunning.delete(appid);
    return Promise.resolve("killed");
  }
  if (appid !== DEMO_STUBBORN) window.setTimeout(() => demoRunning.delete(appid), 2500);
  return Promise.resolve("closing");
}

const now = Math.floor(Date.now() / 1000);
const DAY = 86_400;
const demo = (appid: number, name: string, daysAgo: number, gb: number, playtime = 0): Game => ({
  appid,
  name,
  installDir: name,
  libraryPath: "C:\Program Files (x86)\Steam",
  sizeOnDisk: gb * 1024 ** 3,
  lastPlayed: daysAgo < 0 ? 0 : now - daysAgo * DAY,
  installed: true,
  playtime,
  lastUpdated: now - 30 * DAY,
  art: { capsule: null, hero: null, logo: null, header: null, icon: null },
});

const DEMO_GAMES: Game[] = [
  demo(413150, "Stardew Valley", 0, 0.6, 7320),
  demo(367520, "Hollow Knight", 1, 9, 2640),
  demo(1145360, "Hades", 3, 15, 1875),
  demo(504230, "Celeste", 6, 1.2, 545),
  demo(620, "Portal 2", 12, 12, 430),
  demo(105600, "Terraria", 20, 0.5, 12040),
  demo(1245620, "ELDEN RING", 45, 60, 5610),
  demo(292030, "The Witcher 3: Wild Hunt", 90, 50, 9200),
  demo(1794680, "Vampire Survivors", 120, 0.6, 38),
  demo(646570, "Slay the Spire", 200, 1, 3120),
  demo(588650, "Dead Cells", -1, 1.5),
  demo(1086940, "Baldur's Gate 3", -1, 150),
  // Un jeu hors Steam ajouté à la bibliothèque : ni taille, ni visuels.
  { ...demo(3787939062, "Universal Paperclips", 30, 0), libraryPath: "", installDir: "C:\\Games\\Paperclips", shortcut: true },
];

/** Installé à la fin de son téléchargement simulé. */
const DEMO_NEW: Game = demo(2379780, "Balatro", -1, 0.9);

const DEMO_CATALOG: CatalogGame[] = [
  { appid: 2379780, name: "Balatro", lastPlayed: 0, playtime: 0 },
  { appid: 1030300, name: "Hollow Knight: Silksong", lastPlayed: 0, playtime: 0 },
  // Ni installé ni en téléchargement : la vue « Tout » en montre aussi.
  { appid: 753640, name: "Outer Wilds", lastPlayed: 0, playtime: 0 },
];

const DEMO_PROFILE: SteamProfile = {
  accountId: 12345,
  persona: "Joueur",
  nameHistory: ["Joueur_42", "PetitPixel"],
  level: 45,
  avatarFile: null,
  avatar: null,
};
