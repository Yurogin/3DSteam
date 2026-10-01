import { useSyncExternalStore } from "react";
import { load, save } from "./storage";
import { itemById, ITEMS, type Equip, type Slot } from "./svgiiItems";

/**
 * L'état de la Svgii Plaza, gardé dans le stockage local : les Golds, ce qu'on a acheté, et pour
 * chaque Svgii ce qu'il porte, son appétit, son amitié et ses expéditions.
 *
 * Les Golds se gagnent en jouant : le temps de jeu total que Steam note (voir `localconfig.vdf`)
 * est relevé à chaque visite, et chaque tranche de `MINUTES_PER_GOLD` minutes jouées depuis le
 * relevé précédent rapporte un Gold. Les expéditions, le quiz et les combats en rapportent aussi.
 */

const KEY = "plaza";
/** Un Gold toutes les trois minutes de jeu : une heure de jeu en rapporte vingt. */
export const MINUTES_PER_GOLD = 3;
/** Cadeau de bienvenue, à la première visite. */
export const WELCOME_GOLDS = 200;
/** Un Svgii rassasié a faim au bout d'une journée environ. */
const HUNGER_PER_MS = 100 / (24 * 3600 * 1000);
/** On ne gagne d'amitié en parlant qu'une fois toutes les dix minutes, par Svgii. */
const TALK_COOLDOWN_MS = 10 * 60 * 1000;
/** Combats récompensés par jour. */
export const DAILY_BATTLES = 5;

export interface Care {
  equip: Equip;
  /** Appétit comblé (0 à 100) au moment `fedAt` ; il baisse avec le temps. */
  fullness: number;
  fedAt: number;
  friendship: number;
  meals: number;
  trips: number;
  /** Arrivée sur la Place (création, ou réception d'un ami). */
  arrivedAt: number;
  talkedAt: number;
}

export interface Trip {
  svgii: string;
  start: number;
  minutes: number;
  golds: number;
  /** Une friandise rapportée en souvenir, parfois. */
  food?: string;
}

export interface PlazaState {
  golds: number;
  /** Accessoires et fonds achetés. */
  owned: string[];
  /** Nourriture en réserve, par objet. */
  pantry: Record<string, number>;
  backdrop: string;
  care: Record<string, Care>;
  trips: Trip[];
  /** Temps de jeu total (minutes) déjà converti en Golds ; nul avant la première visite. */
  playedMinutes: number | null;
  /** Jour (AAAA-MM-JJ) du dernier quiz récompensé. */
  quizDay: string | null;
  battleDay: string | null;
  battlesToday: number;
}

const today = () => new Date().toISOString().slice(0, 10);

const fresh = (): PlazaState => ({
  golds: 0,
  owned: ["meadow"],
  pantry: { apple: 2, cookie: 1 },
  backdrop: "meadow",
  care: {},
  trips: [],
  playedMinutes: null,
  quizDay: null,
  battleDay: null,
  battlesToday: 0,
});

function sanitize(raw: Partial<PlazaState> | null): PlazaState {
  const base = fresh();
  if (!raw || typeof raw !== "object") return base;
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  return {
    golds: Math.max(0, Math.floor(num(raw.golds, 0))),
    owned: Array.isArray(raw.owned) ? [...new Set(["meadow", ...raw.owned.filter((id) => typeof id === "string" && itemById(id))])] : base.owned,
    pantry: raw.pantry && typeof raw.pantry === "object" ? Object.fromEntries(Object.entries(raw.pantry).filter(([id, n]) => itemById(id)?.kind === "food" && num(n, 0) > 0)) : base.pantry,
    backdrop: typeof raw.backdrop === "string" && itemById(raw.backdrop)?.kind === "backdrop" ? raw.backdrop : "meadow",
    care: raw.care && typeof raw.care === "object" ? (raw.care as Record<string, Care>) : {},
    trips: Array.isArray(raw.trips) ? raw.trips.filter((t) => t && typeof t.svgii === "string") : [],
    playedMinutes: typeof raw.playedMinutes === "number" ? raw.playedMinutes : null,
    quizDay: typeof raw.quizDay === "string" ? raw.quizDay : null,
    battleDay: typeof raw.battleDay === "string" ? raw.battleDay : null,
    battlesToday: num(raw.battlesToday, 0),
  };
}

let state = sanitize(load<Partial<PlazaState> | null>(KEY, null));
const listeners = new Set<() => void>();

function commit(next: PlazaState) {
  state = next;
  save(KEY, next);
  listeners.forEach((f) => f());
}

export function usePlaza(): PlazaState {
  return useSyncExternalStore(
    (f) => {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    () => state,
  );
}

/** Les soins d'un Svgii ; un nouveau venu arrive à moitié rassasié. */
export function careOf(id: string, s: PlazaState = state): Care {
  return s.care[id] ?? { equip: {}, fullness: 60, fedAt: Date.now(), friendship: 0, meals: 0, trips: 0, arrivedAt: Date.now(), talkedAt: 0 };
}

/** Appétit comblé à l'instant `now`. */
export function fullnessOf(care: Care, now = Date.now()): number {
  return Math.max(0, Math.min(100, care.fullness - (now - care.fedAt) * HUNGER_PER_MS));
}

/** Niveau d'amitié (de 0 à 5 cœurs). */
export const heartsOf = (care: Care) => Math.min(5, Math.floor(care.friendship / 10));

const withCare = (id: string, change: (c: Care) => Care): PlazaState => ({ ...state, care: { ...state.care, [id]: change(careOf(id)) } });

/** Enregistre l'arrivée d'un Svgii sur la Place (sans rien changer s'il est déjà connu). */
export function welcome(ids: string[]) {
  const missing = ids.filter((id) => !state.care[id]);
  if (!missing.length) return;
  const care = { ...state.care };
  for (const id of missing) care[id] = careOf(id);
  commit({ ...state, care });
}

/**
 * Convertit en Golds le temps de jeu gagné depuis la dernière visite. Renvoie les Golds gagnés
 * (le cadeau de bienvenue compris, à la première visite).
 */
export function earnFromPlaytime(totalMinutes: number): number {
  if (state.playedMinutes == null) {
    commit({ ...state, golds: state.golds + WELCOME_GOLDS, playedMinutes: totalMinutes });
    return WELCOME_GOLDS;
  }
  const earned = Math.floor((totalMinutes - state.playedMinutes) / MINUTES_PER_GOLD);
  if (earned <= 0) {
    // Le compteur de Steam a pu baisser (autre compte, réinstallation) : on repart de là.
    if (totalMinutes < state.playedMinutes) commit({ ...state, playedMinutes: totalMinutes });
    return 0;
  }
  commit({ ...state, golds: state.golds + earned, playedMinutes: state.playedMinutes + earned * MINUTES_PER_GOLD });
  return earned;
}

export function addGolds(n: number) {
  if (n > 0) commit({ ...state, golds: state.golds + n });
}

export type BuyResult = "bought" | "poor" | "owned";

export function buy(id: string): BuyResult {
  const item = itemById(id);
  if (!item) return "poor";
  if (item.kind !== "food" && state.owned.includes(id)) return "owned";
  if (state.golds < item.price) return "poor";
  commit({
    ...state,
    golds: state.golds - item.price,
    owned: item.kind === "food" ? state.owned : [...state.owned, id],
    pantry: item.kind === "food" ? { ...state.pantry, [id]: (state.pantry[id] ?? 0) + 1 } : state.pantry,
  });
  return "bought";
}

export function setBackdrop(id: string) {
  if (state.owned.includes(id)) commit({ ...state, backdrop: id });
}

export function equipItem(svgii: string, slot: Slot, id: string | null) {
  if (id && !state.owned.includes(id)) return;
  commit(withCare(svgii, (c) => ({ ...c, equip: { ...c.equip, [slot]: id ?? undefined } })));
}

/** Nourrit un Svgii avec un objet de la réserve ; `false` s'il n'y en a plus. */
export function feed(svgii: string, food: string): boolean {
  const item = itemById(food);
  if (item?.kind !== "food" || !state.pantry[food]) return false;
  const pantry = { ...state.pantry, [food]: state.pantry[food] - 1 };
  if (!pantry[food]) delete pantry[food];
  const now = Date.now();
  commit({
    ...withCare(svgii, (c) => ({
      ...c,
      fullness: Math.min(100, fullnessOf(c, now) + item.fullness),
      fedAt: now,
      friendship: c.friendship + item.joy,
      meals: c.meals + 1,
    })),
    pantry,
  });
  return true;
}

/** Parler fait plaisir : un point d'amitié, une fois toutes les dix minutes. */
export function talk(svgii: string) {
  const now = Date.now();
  if (now - careOf(svgii).talkedAt < TALK_COOLDOWN_MS) return;
  commit(withCare(svgii, (c) => ({ ...c, friendship: c.friendship + 1, talkedAt: now })));
}

/* ─── Expéditions ─────────────────────────────────────────────────────────────────────── */

export const TRIPS = [
  { minutes: 15, golds: [18, 30] },
  { minutes: 60, golds: [60, 95] },
  { minutes: 240, golds: [220, 340] },
] as const;

export const tripOf = (svgii: string) => state.trips.find((t) => t.svgii === svgii);

export function startTrip(svgii: string, minutes: number) {
  const kind = TRIPS.find((k) => k.minutes === minutes);
  if (!kind || tripOf(svgii)) return;
  const [min, max] = kind.golds;
  const foods = ITEMS.filter((i) => i.kind === "food");
  // Plus le voyage est long, plus il a de chances de rapporter une friandise.
  const food = Math.random() < minutes / 300 ? foods[Math.floor(Math.random() * foods.length)].id : undefined;
  const golds = Math.round(min + Math.random() * (max - min));
  commit({ ...state, trips: [...state.trips, { svgii, start: Date.now(), minutes, golds, food }] });
}

export const tripDone = (trip: Trip, now = Date.now()) => now - trip.start >= trip.minutes * 60_000;

/** Ramène un Svgii de son expédition et encaisse ce qu'il rapporte. */
export function claimTrip(svgii: string): Trip | null {
  const trip = tripOf(svgii);
  if (!trip || !tripDone(trip)) return null;
  const pantry = trip.food ? { ...state.pantry, [trip.food]: (state.pantry[trip.food] ?? 0) + 1 } : state.pantry;
  commit({
    ...withCare(svgii, (c) => ({ ...c, trips: c.trips + 1, friendship: c.friendship + 2 })),
    golds: state.golds + trip.golds,
    pantry,
    trips: state.trips.filter((t) => t.svgii !== svgii),
  });
  return trip;
}

/** Le Svgii part d'une collection supprimée : on oublie ses soins et son expédition. */
export function forget(ids: Set<string>) {
  const care = Object.fromEntries(Object.entries(state.care).filter(([id]) => ids.has(id)));
  const trips = state.trips.filter((t) => ids.has(t.svgii));
  if (Object.keys(care).length !== Object.keys(state.care).length || trips.length !== state.trips.length) commit({ ...state, care, trips });
}

/* ─── Quiz et combats ─────────────────────────────────────────────────────────────────── */

export const quizRewardedToday = () => state.quizDay === today();

/** Récompense du quiz : une fois par jour, dix Golds par bonne réponse. */
export function rewardQuiz(correct: number): number {
  if (quizRewardedToday()) return 0;
  const golds = correct * 10;
  commit({ ...state, quizDay: today(), golds: state.golds + golds });
  return golds;
}

export const battlesLeft = () => (state.battleDay === today() ? Math.max(0, DAILY_BATTLES - state.battlesToday) : DAILY_BATTLES);

/** Récompense d'un combat : quinze Golds pour une victoire, cinq pour avoir essayé. */
export function rewardBattle(svgii: string, won: boolean): number {
  if (!battlesLeft()) return 0;
  const golds = won ? 15 : 5;
  const day = today();
  commit({
    ...withCare(svgii, (c) => ({ ...c, friendship: c.friendship + (won ? 1 : 0) })),
    golds: state.golds + golds,
    battleDay: day,
    battlesToday: (state.battleDay === day ? state.battlesToday : 0) + 1,
  });
  return golds;
}
