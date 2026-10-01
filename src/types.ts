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
  /** Temps de jeu cumulé, en minutes. */
  playtime: number;
  art: GameArt;
  /**
   * Jeu hors Steam ajouté à la bibliothèque : `installDir` est son dossier, et il n'a ni
   * bibliothèque, ni taille, ni page dans le magasin. Visuels uniquement locaux.
   */
  shortcut?: boolean;
}

/** Un jeu que le client Steam connaît mais qui n'est pas installé. */
export interface CatalogGame {
  appid: number;
  name: string;
  lastPlayed: number;
  playtime: number;
}

/**
 * Un jeu tel que l'interface le manipule. `installed` distingue les deux origines : le scan du
 * disque, ou le catalogue (vue « Tout »), qui n'a ni taille, ni chemin, ni visuels locaux.
 */
export interface Game extends InstalledGame {
  installed: boolean;
  /** Appli intégrée (journal, musique, album) : rangée comme un jeu, mais ouverte par 3DSteam. */
  builtin?: BuiltinId;
}

export type BuiltinId = "activity" | "music" | "album" | "profile" | "plaza";

/** Profil Steam du compte actif, lu en local (`profile.rs`). */
export interface SteamProfile {
  accountId: number;
  persona: string;
  /** Anciens pseudos, du plus récent au plus ancien. */
  nameHistory: string[];
  level: number | null;
  /** Avatar gardé en cache par le client. */
  avatarFile: string | null;
  /** Empreinte de l'avatar sur le CDN de Steam. */
  avatar: string | null;
}

/** Temps de jeu d'une application, d'après `localconfig.vdf`. */
export interface Activity {
  appid: number;
  lastPlayed: number;
  /** En minutes. */
  playtime: number;
  /** En minutes, sur les deux dernières semaines. */
  playtime2wks: number;
}

/** Une piste du lecteur de musique : bande-son Steam ou dossier Musique. */
export interface Track {
  path: string;
  title: string;
  artist: string | null;
  album: string;
  number: number | null;
  cover: string | null;
  source: "soundtrack" | "music";
}

/** Une capture de l'album. */
export interface Shot {
  path: string;
  thumb: string | null;
  appid: number | null;
  source: "steam" | "windows" | "gamebar";
  /** Date de la capture, en secondes. */
  taken: number;
}

/** Où en est un téléchargement, d'après le journal de Steam (voir `progress.rs`). */
export type DownloadPhase = "queued" | "preparing" | "downloading" | "verifying" | "installing" | "paused";

/** Un téléchargement Steam, avec sa progression en direct. */
export interface Download {
  appid: number;
  name: string;
  bytesDownloaded: number;
  bytesToDownload: number;
  /** Débit lissé, en octets par seconde ; nul hors téléchargement actif. */
  rate: number;
  phase: DownloadPhase;
}

export interface Library {
  version: number;
  scannedAt: number;
  steamRoot: string | null;
  games: InstalledGame[];
  /** Absent des caches antérieurs à la vue « Tout ». */
  catalog?: CatalogGame[];
}
