import { Mascot } from "../components/Mascot";
import type { TFunction } from "../lib/i18n";
import { useCollection, useProfile } from "../lib/mascot";
import { load, save } from "../lib/storage";
import type { BuiltinId, Game } from "../types";

/**
 * Applis intégrées, comme les logiciels d'un menu de console. Sur le plateau, ce sont des jeux
 * comme les autres — on les déplace, on les range dans un dossier, on les trie, on les cherche —
 * à ceci près que leur numéro est négatif : jamais celui d'un vrai jeu Steam, il ne part donc
 * jamais vers Steam. 3DSteam les ouvre lui-même.
 */
export interface BuiltinApp {
  id: BuiltinId;
  appid: number;
  /** Dégradé de l'icône et du fond de l'écran du haut. */
  colors: [string, string];
}

export const BUILTIN_APPS: BuiltinApp[] = [
  { id: "activity", appid: -1, colors: ["#3fd59a", "#17936a"] },
  { id: "music", appid: -2, colors: ["#ffa94d", "#ff5d8f"] },
  { id: "album", appid: -3, colors: ["#5aa9ff", "#7c5cff"] },
  { id: "profile", appid: -4, colors: ["#ffb3d1", "#a78bfa"] },
  { id: "plaza", appid: -5, colors: ["#8be3a6", "#3fb4e8"] },
];

export const builtinApp = (id: BuiltinId) => BUILTIN_APPS.find((a) => a.id === id)!;

const NAMES = { activity: "appActivity", music: "appMusic", album: "appAlbum", profile: "appProfile", plaza: "appPlaza" } as const;
const DESCRIPTIONS = { activity: "appActivityDesc", music: "appMusicDesc", album: "appAlbumDesc", profile: "appProfileDesc", plaza: "appPlazaDesc" } as const;

export function appName(id: BuiltinId, t: TFunction): string {
  return t(NAMES[id]);
}

export function appDescription(id: BuiltinId, t: TFunction): string {
  return t(DESCRIPTIONS[id]);
}

/** Dernière ouverture de chaque appli : le tri « Récents » les range comme des jeux joués. */
const OPENED_KEY = "apps.opened";
export const loadOpened = () => load<Partial<Record<BuiltinId, number>>>(OPENED_KEY, {});
export function markOpened(id: BuiltinId): Partial<Record<BuiltinId, number>> {
  const next = { ...loadOpened(), [id]: Math.floor(Date.now() / 1000) };
  save(OPENED_KEY, next);
  return next;
}

/** Les applis, sous la forme de jeux installés que le plateau sait déjà ranger. */
export function builtinGames(t: TFunction, opened: Partial<Record<BuiltinId, number>>): Game[] {
  return BUILTIN_APPS.map(({ id, appid }) => ({
    appid,
    name: appName(id, t),
    installDir: "",
    libraryPath: "",
    sizeOnDisk: 0,
    lastPlayed: opened[id] ?? 0,
    lastUpdated: 0,
    playtime: 0,
    art: { capsule: null, hero: null, logo: null, header: null },
    installed: true,
    builtin: id,
  }));
}

/** Icône d'une appli : un dégradé et un pictogramme dessiné, façon console. Remplit son parent. */
export function AppIcon({ id }: { id: BuiltinId }) {
  const [from, to] = builtinApp(id).colors;
  const gradient = `app-${id}`;
  return (
    <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden>
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#${gradient})`} />
      {/* Pastilles de lumière, comme sur les icônes d'un menu de console. */}
      <circle cx="84" cy="14" r="22" fill="white" opacity="0.12" />
      <circle cx="10" cy="92" r="26" fill="black" opacity="0.06" />
      {id === "activity" && <ActivityGlyph />}
      {id === "music" && <MusicGlyph />}
      {id === "album" && <AlbumGlyph />}
      {id === "profile" && <ProfileGlyph />}
      {id === "plaza" && <PlazaGlyph />}
    </svg>
  );
}

/** Journal : un carnet, un graphique qui monte et une petite chaussure de marche. */
function ActivityGlyph() {
  return (
    <g>
      <rect x="20" y="20" width="60" height="62" rx="9" fill="white" />
      <rect x="20" y="20" width="60" height="14" rx="9" fill="#d9f7ea" />
      <rect x="20" y="28" width="60" height="6" fill="#d9f7ea" />
      <rect x="29" y="58" width="9" height="16" rx="3" fill="#3fd59a" />
      <rect x="43" y="48" width="9" height="26" rx="3" fill="#2bbd85" />
      <rect x="57" y="39" width="9" height="35" rx="3" fill="#17936a" />
      <path d="M30 52 L47 42 L61 33" stroke="#ffb938" strokeWidth="3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="61" cy="33" r="4" fill="#ffb938" />
      <path d="M64 86 q2 -10 10 -10 h6 q4 0 4 4 v4 q0 4 -4 4 h-14 q-3 0 -2 -2 Z" fill="#ff6b6b" stroke="white" strokeWidth="2.5" strokeLinejoin="round" />
    </g>
  );
}

/** Musique : un disque derrière une double croche. */
function MusicGlyph() {
  return (
    <g>
      <circle cx="58" cy="54" r="27" fill="#2b2140" opacity="0.9" />
      <circle cx="58" cy="54" r="19" fill="none" stroke="white" strokeOpacity="0.15" strokeWidth="2" />
      <circle cx="58" cy="54" r="8" fill="#ffd166" />
      <circle cx="58" cy="54" r="2.5" fill="#2b2140" />
      <path d="M30 30 L60 22 V64" stroke="white" strokeWidth="7" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M30 30 V72" stroke="white" strokeWidth="7" strokeLinecap="round" />
      <ellipse cx="23" cy="73" rx="10" ry="8" fill="white" transform="rotate(-18 23 73)" />
      <ellipse cx="53" cy="65" rx="10" ry="8" fill="white" transform="rotate(-18 53 65)" />
    </g>
  );
}

/** Profil : ton propre Svgii, qui change d'icône quand on le retouche. */
function ProfileGlyph() {
  const { mascot } = useProfile();
  return (
    <g transform="translate(9 12)">
      <Mascot look={mascot} size={82} animated={false} />
    </g>
  );
}

/** Svgii Plaza : une colline, un arbre et deux Svgii de ta collection qui s'y promènent. */
function PlazaGlyph() {
  const { list, favorite } = useCollection();
  const fav = list.find((s) => s.id === favorite) ?? list[0];
  const other = list.find((s) => s.id !== fav.id);
  return (
    <g>
      <circle cx="78" cy="22" r="8" fill="#fff6b8" />
      <path d="M-5 72 Q30 56 60 66 T105 62 V105 H-5 Z" fill="#6fd17a" />
      <path d="M-5 80 Q40 70 105 78 V105 H-5 Z" fill="#58bf66" />
      <rect x="15" y="50" width="3.5" height="12" rx="1.5" fill="#a0703c" />
      <circle cx="16.8" cy="46" r="9" fill="#3fae5a" />
      {other && (
        <g transform="translate(52 34)">
          <Mascot look={other.look} size={40} animated={false} />
        </g>
      )}
      <g transform={other ? "translate(20 40)" : "translate(26 32)"}>
        <Mascot look={fav.look} size={other ? 52 : 58} animated={false} />
      </g>
    </g>
  );
}

/** Album : deux photos posées l'une sur l'autre, un paysage au soleil. */
function AlbumGlyph() {
  return (
    <g>
      <g transform="rotate(-10 50 52)">
        <rect x="18" y="24" width="60" height="52" rx="5" fill="white" opacity="0.6" />
      </g>
      <g transform="rotate(6 50 52)">
        <rect x="22" y="22" width="60" height="58" rx="5" fill="white" />
        <rect x="27" y="27" width="50" height="38" rx="3" fill="#a8d8ff" />
        <circle cx="66" cy="36" r="6" fill="#ffd166" />
        <path d="M27 65 L44 44 L56 57 L63 50 L77 65 Z" fill="#3fbf7f" />
        <rect x="27" y="68" width="22" height="4" rx="2" fill="#c7d2e0" />
      </g>
    </g>
  );
}
