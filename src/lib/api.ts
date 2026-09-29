import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Download, Game, Library } from "../types";

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
      () => resolve({ version: 1, scannedAt: Date.now() / 1000, steamRoot: null, games: DEMO_GAMES }),
      400,
    ),
  );
}

/** Ce qu'il est advenu de la fenêtre ouverte par Steam. */
export type InstallOutcome =
  /** La boîte d'installation a été reconnue et validée. */
  | { kind: "confirmed" }
  /** Une fenêtre inattendue est apparue : on n'y a pas touché, à l'utilisateur de répondre. */
  | { kind: "unknown"; title: string }
  /** Rien n'est apparu dans le délai. */
  | { kind: "nothing" }
  /** La validation automatique est désactivée. */
  | { kind: "skipped" };

/**
 * Ouvre la boîte d'installation de Steam. `dialogTitle` est le titre retenu d'une installation
 * précédente : sans lui, rien n'est cliqué (voir `dialog.rs`).
 */
export function installGame(
  appid: number,
  autoConfirm: boolean,
  dialogTitle: string | null,
  padMouse: boolean,
): Promise<InstallOutcome> {
  if (inTauri) return invoke<InstallOutcome>("install_game", { appid, autoConfirm, dialogTitle, padMouse });
  console.info(`[démo] steam://install/${appid}`);
  return Promise.resolve({ kind: "skipped" });
}

/** Téléchargements en cours (toujours vide dans le navigateur). */
export function listDownloads(): Promise<Download[]> {
  return inTauri ? invoke<Download[]>("downloads") : Promise.resolve([]);
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

export function launchGame(appid: number): Promise<void> {
  if (inTauri) return invoke("launch_game", { appid });
  console.info(`[démo] steam://run/${appid}`);
  return Promise.resolve();
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
];
