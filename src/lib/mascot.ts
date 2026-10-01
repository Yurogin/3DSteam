import { useEffect, useState, useSyncExternalStore } from "react";
import { load, save } from "./storage";

/**
 * Les Svgii, des avatars à composer : une liste de pièces (forme du visage, oreilles, yeux…) et de
 * couleurs, dessinée en SVG par `Mascot.tsx`. On en crée autant qu'on veut, le favori représente
 * le joueur partout, et ceux des amis n'arrivent que s'ils les partagent (un code, ou un fichier
 * `.svgii` qui le contient).
 */

export const HEADS = ["round", "wide", "egg", "soft", "mochi"] as const;
export const EARS = ["human", "cat", "bunny", "bear", "dog", "antenna"] as const;
export const EYES = ["dot", "sparkle", "round", "happy", "sleepy", "star"] as const;
export const MOUTHS = ["smile", "cat", "open", "tiny", "tongue", "grin"] as const;
export const HAIRS = ["none", "tuft", "bangs", "bob", "spiky", "bun", "long", "pigtails"] as const;
export const ACCESSORIES = ["none", "glasses", "bow", "flower", "headphones", "crown", "sprout"] as const;

export type Head = (typeof HEADS)[number];
export type Ears = (typeof EARS)[number];
export type Eyes = (typeof EYES)[number];
export type Mouth = (typeof MOUTHS)[number];
export type Hair = (typeof HAIRS)[number];
export type Accessory = (typeof ACCESSORIES)[number];

/** Teintes de peau : réalistes, puis pastel, pour les mascottes qui n'ont rien d'humain. */
export const SKINS = ["#ffe3cf", "#f6c9a4", "#e2a77c", "#bb7a50", "#8a5636", "#ffd6e7", "#d3f2dd", "#d6e6ff", "#e7dbff", "#fff0b8", "#f4f4f6"];
export const HAIR_COLORS = ["#2d2a33", "#6b4226", "#a65a2e", "#f0c46a", "#e5793f", "#ff8fc7", "#6fa8ff", "#5fd4b0", "#b49bff", "#f3f3f3"];
/** Couleur préférée (le haut de la mascotte), comme une tenue. */
export const FAVORITES = ["#ff6b6b", "#ff9f43", "#ffc93c", "#6bd48f", "#2ec4b6", "#4aa3ff", "#5b6cff", "#a78bfa", "#ff8fc7", "#8d99ae", "#3d3d4a", "#f5f5f5"];

export interface MascotLook {
  head: Head;
  ears: Ears;
  eyes: Eyes;
  mouth: Mouth;
  hair: Hair;
  accessory: Accessory;
  cheeks: boolean;
  skin: string;
  hairColor: string;
  favorite: string;
}

export interface Profile {
  name: string;
  mascot: MascotLook;
}

/** Éclaircit (`amount` > 0) ou assombrit (< 0) une couleur hexadécimale. */
export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.round(Math.min(255, Math.max(0, amount < 0 ? c * (1 + amount) : c + (255 - c) * amount)));
  const [r, g, b] = [f(n >> 16), f((n >> 8) & 255), f(n & 255)];
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** Un Svgii au hasard, toujours mignon : yeux et bouches les plus sages un peu plus souvent. */
export function randomMascot(rng: () => number = Math.random): MascotLook {
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(rng() * list.length)];
  return {
    head: pick(HEADS),
    ears: rng() < 0.35 ? "human" : pick(EARS),
    eyes: pick([...EYES, "dot", "sparkle"]),
    mouth: pick([...MOUTHS, "smile", "cat"]),
    hair: pick(HAIRS),
    accessory: rng() < 0.4 ? "none" : pick(ACCESSORIES),
    cheeks: rng() < 0.75,
    skin: pick(SKINS),
    hairColor: pick(HAIR_COLORS),
    favorite: pick(FAVORITES),
  };
}

/** Un Svgii lu dans le stockage peut venir d'une version plus ancienne : on complète. */
function sanitizeLook(raw: unknown): MascotLook | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Partial<MascotLook>;
  const base = randomMascot();
  const oneOf = <T,>(list: readonly T[], v: unknown, fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);
  const color = (v: unknown, fallback: string) => (typeof v === "string" && /^#[\da-f]{6}$/i.test(v) ? v : fallback);
  return {
    head: oneOf(HEADS, m.head, base.head),
    ears: oneOf(EARS, m.ears, base.ears),
    eyes: oneOf(EYES, m.eyes, base.eyes),
    mouth: oneOf(MOUTHS, m.mouth, base.mouth),
    hair: oneOf(HAIRS, m.hair, base.hair),
    accessory: oneOf(ACCESSORIES, m.accessory, base.accessory),
    cheeks: typeof m.cheeks === "boolean" ? m.cheeks : base.cheeks,
    skin: color(m.skin, base.skin),
    hairColor: color(m.hairColor, base.hairColor),
    favorite: color(m.favorite, base.favorite),
  };
}

/* ─── Code de partage ─────────────────────────────────────────────────────────────────── */

/**
 * Un Svgii tient en une douzaine d'octets : la version du format, le rang de chaque pièce dans sa
 * liste, les trois couleurs (rang dans leur palette), le nom en UTF-8, puis une somme de contrôle.
 * Le tout est écrit en base 32 de Crockford (chiffres et majuscules, sans I, L, O ni U : rien qui
 * se confonde en le recopiant) et découpé par groupes de cinq, derrière « SVGII- ».
 */
const CODE_VERSION = 1;
const PREFIX = "SVGII";
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const NAME_MAX = 20;

/** Rang d'une couleur dans sa palette ; une couleur hors palette prend la plus proche. */
function colorIndex(palette: string[], hex: string): number {
  const exact = palette.findIndex((c) => c.toLowerCase() === hex.toLowerCase());
  if (exact >= 0) return exact;
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r, g, b] = rgb(hex);
  let best = 0;
  let bestDist = Infinity;
  palette.forEach((c, i) => {
    const [r2, g2, b2] = rgb(c);
    const d = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
    if (d < bestDist) [best, bestDist] = [i, d];
  });
  return best;
}

const checksum = (bytes: number[]) => bytes.reduce((sum, b) => (sum * 31 + b) & 0xff, 7);

export function encodeSvgii(name: string, look: MascotLook): string {
  const bytes = [
    CODE_VERSION,
    HEADS.indexOf(look.head),
    EARS.indexOf(look.ears),
    EYES.indexOf(look.eyes),
    MOUTHS.indexOf(look.mouth),
    HAIRS.indexOf(look.hair),
    ACCESSORIES.indexOf(look.accessory),
    look.cheeks ? 1 : 0,
    colorIndex(SKINS, look.skin),
    colorIndex(HAIR_COLORS, look.hairColor),
    colorIndex(FAVORITES, look.favorite),
    ...new TextEncoder().encode([...name.trim()].slice(0, NAME_MAX).join("")),
  ];
  bytes.push(checksum(bytes));
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return [PREFIX, ...(out.match(/.{1,5}/g) ?? [])].join("-");
}

/** Retrouve un Svgii dans un texte collé ou un fichier ; `null` si ce n'en est pas un. */
export function decodeSvgii(text: string): { name: string; look: MascotLook } | null {
  // Le code s'arrête à la fin de sa ligne ; tirets, espaces et casse ne comptent pas.
  const match = /SVGII[ \t-]*([0-9a-z][0-9a-z \t-]*)/i.exec(text);
  if (!match) return null;
  const symbols = match[1].toUpperCase().replace(/[ \t-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of symbols) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) return null;
    value = ((value << 5) | v) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  if (bytes.length < 12) return null;
  const sum = bytes.pop()!;
  if (bytes[0] !== CODE_VERSION || checksum(bytes) !== sum) return null;
  const [, head, ears, eyes, mouth, hair, accessory, cheeks, skin, hairColor, favorite] = bytes;
  const lists: [readonly unknown[], number][] = [
    [HEADS, head],
    [EARS, ears],
    [EYES, eyes],
    [MOUTHS, mouth],
    [HAIRS, hair],
    [ACCESSORIES, accessory],
    [SKINS, skin],
    [HAIR_COLORS, hairColor],
    [FAVORITES, favorite],
  ];
  if (lists.some(([list, i]) => i >= list.length) || cheeks > 1) return null;
  const name = [...new TextDecoder().decode(new Uint8Array(bytes.slice(11))).trim()].slice(0, NAME_MAX).join("");
  return {
    name,
    look: {
      head: HEADS[head],
      ears: EARS[ears],
      eyes: EYES[eyes],
      mouth: MOUTHS[mouth],
      hair: HAIRS[hair],
      accessory: ACCESSORIES[accessory],
      cheeks: cheeks === 1,
      skin: SKINS[skin],
      hairColor: HAIR_COLORS[hairColor],
      favorite: FAVORITES[favorite],
    },
  };
}

/* ─── Collection (page Profil, barre du haut) ─────────────────────────────────────────── */

export interface Svgii {
  id: string;
  name: string;
  look: MascotLook;
  /** Reçu d'un ami (code ou fichier) : c'est le sien, on ne le retouche pas. */
  received: boolean;
}

export interface Collection {
  list: Svgii[];
  /** Le Svgii qui te représente : la pastille, l'icône du Profil, les réactions. Toujours un des tiens. */
  favorite: string;
}

const KEY = "svgii";
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function sanitizeSvgii(raw: unknown): Svgii | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<Svgii>;
  const look = sanitizeLook(s.look);
  if (!look || typeof s.id !== "string") return null;
  return { id: s.id, name: typeof s.name === "string" ? s.name.slice(0, NAME_MAX) : "", look, received: s.received === true };
}

/** Un favori valide : le précédent s'il est toujours là et à toi, sinon ton premier Svgii. */
function withFavorite(list: Svgii[], favorite: string | undefined): Collection {
  const own = list.filter((s) => !s.received);
  if (!own.length) {
    const first: Svgii = { id: newId(), name: "", look: randomMascot(), received: false };
    return { list: [first, ...list], favorite: first.id };
  }
  return { list, favorite: own.some((s) => s.id === favorite) ? favorite! : own[0].id };
}

function loadCollection(): Collection {
  const raw = load<{ list?: unknown[]; favorite?: string } | null>(KEY, null);
  if (raw && Array.isArray(raw.list)) {
    const list = raw.list.map(sanitizeSvgii).filter((s): s is Svgii => s != null);
    return withFavorite(list, raw.favorite);
  }
  // Avant la collection, le profil ne gardait qu'un Svgii : il devient le premier, et le favori.
  const old = load<{ name?: unknown; mascot?: unknown } | null>("profile", null);
  const first: Svgii = {
    id: newId(),
    name: typeof old?.name === "string" ? old.name.slice(0, NAME_MAX) : "",
    look: sanitizeLook(old?.mascot) ?? randomMascot(),
    received: false,
  };
  return { list: [first], favorite: first.id };
}

const profileOf = (c: Collection): Profile => {
  const fav = c.list.find((s) => s.id === c.favorite)!;
  return { name: fav.name, mascot: fav.look };
};

let collection = loadCollection();
let profile = profileOf(collection);
save(KEY, collection);
const listeners = new Set<() => void>();

function commit(next: Collection) {
  collection = next;
  profile = profileOf(next);
  save(KEY, next);
  listeners.forEach((f) => f());
}

const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => listeners.delete(f);
};

/** Le favori, tel qu'il s'affiche partout : son nom et son allure. */
export function getProfile(): Profile {
  return profile;
}

export function useProfile(): Profile {
  return useSyncExternalStore(subscribe, () => profile);
}

export function useCollection(): Collection {
  return useSyncExternalStore(subscribe, () => collection);
}

/** Tant qu'on n'a retouché aucun Svgii, la pastille invite à le faire. */
export function isFreshProfile(): boolean {
  return !load("profileEdited", false);
}

const edited = () => save("profileEdited", true);

export function createSvgii(name: string, look: MascotLook): Svgii {
  const svgii: Svgii = { id: newId(), name: name.trim().slice(0, NAME_MAX), look, received: false };
  edited();
  commit({ ...collection, list: [...collection.list, svgii] });
  return svgii;
}

export function updateSvgii(id: string, name: string, look: MascotLook) {
  edited();
  commit({ ...collection, list: collection.list.map((s) => (s.id === id && !s.received ? { ...s, name: name.trim().slice(0, NAME_MAX), look } : s)) });
}

/** Le favori ne se supprime pas : il en faut toujours un. */
export function deleteSvgii(id: string) {
  if (id === collection.favorite) return;
  commit({ ...collection, list: collection.list.filter((s) => s.id !== id) });
}

export function setFavorite(id: string) {
  if (!collection.list.some((s) => s.id === id && !s.received)) return;
  edited();
  commit({ ...collection, favorite: id });
}

export type ImportResult = { status: "added" | "duplicate"; svgii: Svgii } | { status: "invalid" };

/** Accueille le Svgii d'un ami, à partir de son code (collé, ou lu dans un fichier `.svgii`). */
export function importSvgii(text: string): ImportResult {
  const decoded = decodeSvgii(text);
  if (!decoded) return { status: "invalid" };
  const code = encodeSvgii(decoded.name, decoded.look);
  const known = collection.list.find((s) => encodeSvgii(s.name, s.look) === code);
  if (known) return { status: "duplicate", svgii: known };
  const svgii: Svgii = { id: newId(), name: decoded.name.slice(0, NAME_MAX), look: decoded.look, received: true };
  commit({ ...collection, list: [...collection.list, svgii] });
  return { status: "added", svgii };
}

/** Nom proposé au favori tant qu'il n'en a pas (le pseudo Steam). */
export function suggestName(name: string | null) {
  if (!name || profile.name || load("profileEdited", false)) return;
  commit({ ...collection, list: collection.list.map((s) => (s.id === collection.favorite ? { ...s, name: name.slice(0, NAME_MAX) } : s)) });
}

/* ─── Humeur : la mascotte réagit à ce qui se passe ───────────────────────────────────── */

export type Mood = "idle" | "happy" | "excited" | "sad" | "sleepy";

const moodListeners = new Set<(mood: Mood) => void>();

/** Une réaction passagère : un jeu se lance, un téléchargement se termine… */
export function mascotReact(mood: Exclude<Mood, "idle" | "sleepy">) {
  moodListeners.forEach((f) => f(mood));
}

const MOOD_MS: Record<Mood, number> = { idle: 0, happy: 2200, excited: 2600, sad: 2400, sleepy: 0 };

/** Humeur du moment : la dernière réaction pendant quelques secondes, et le sommeil quand 3DSteam n'est plus au premier plan. */
export function useMascotMood(): Mood {
  const [reaction, setReaction] = useState<Mood>("idle");
  const [awake, setAwake] = useState(() => document.hasFocus());
  useEffect(() => {
    let timer = 0;
    const onMood = (mood: Mood) => {
      window.clearTimeout(timer);
      setReaction(mood);
      timer = window.setTimeout(() => setReaction("idle"), MOOD_MS[mood]);
    };
    moodListeners.add(onMood);
    // Pas tout de suite endormie : on laisse quelques secondes avant de piquer du nez.
    let sleepTimer = 0;
    const onFocus = () => {
      window.clearTimeout(sleepTimer);
      setAwake(true);
    };
    const onBlur = () => {
      window.clearTimeout(sleepTimer);
      sleepTimer = window.setTimeout(() => setAwake(false), 4000);
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      moodListeners.delete(onMood);
      window.clearTimeout(timer);
      window.clearTimeout(sleepTimer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
  return reaction !== "idle" ? reaction : awake ? "idle" : "sleepy";
}
