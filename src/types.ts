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

/** Ce que renvoie le scan : un jeu présent sur le disque. */
export interface InstalledGame {
  appid: number;
  name: string;
  installDir: string;
  libraryPath: string;
  sizeOnDisk: number;
  lastPlayed: number;
  lastUpdated: number;
  art: GameArt;
}

/** Un jeu que le client Steam connaît mais qui n'est pas installé. */
export interface CatalogGame {
  appid: number;
  name: string;
  lastPlayed: number;
}

/**
 * Un jeu tel que l'interface le manipule. `installed` distingue les deux origines : le scan du
 * disque, ou le catalogue (vue « Tout »), qui n'a ni taille, ni chemin, ni visuels locaux.
 */
export interface Game extends InstalledGame {
  installed: boolean;
}

export interface Library {
  version: number;
  scannedAt: number;
  steamRoot: string | null;
  games: InstalledGame[];
  /** Absent des caches antérieurs à la vue « Tout ». */
  catalog?: CatalogGame[];
}
