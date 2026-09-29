/** Miroir des structures Rust (`src-tauri/src/steam.rs` et `cache.rs`). */

export interface GameArt {
  capsule: string | null;
  hero: string | null;
  logo: string | null;
  header: string | null;
  /** Icône carrée du jeu (.ico jusqu'à 256 px, ou petite icône 32 px). Absente des anciens caches. */
  icon?: string | null;
  /** Côté en pixels de cette icône, relevé au scan. Absent en mode démo (navigateur). */
  iconSize?: number | null;
}

export interface Game {
  appid: number;
  name: string;
  installDir: string;
  libraryPath: string;
  sizeOnDisk: number;
  lastPlayed: number;
  lastUpdated: number;
  art: GameArt;
}

export interface Library {
  version: number;
  scannedAt: number;
  steamRoot: string | null;
  games: Game[];
}
