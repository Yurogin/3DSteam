import { load, save } from "../lib/storage";
import type { Activity } from "../types";

/**
 * Steam ne garde qu'un temps de jeu cumulé par jeu (et celui des deux dernières semaines) :
 * aucun relevé jour par jour. 3DSteam en tient donc un lui-même : à chaque scan, il note le cumul
 * de chaque jeu pour la journée. Le temps joué un jour, c'est l'écart avec le relevé précédent.
 * Le journal se remplit ainsi au fil des jours où 3DSteam est ouvert.
 */
type Snapshot = Record<string, number>;
type History = Record<string, Snapshot>;

const KEY = "activity.history";
/** Trois mois suffisent au graphique, et gardent le stockage léger. */
const KEEP_DAYS = 92;

/** « 2026-10-01 », en heure locale : un jour de jeu finit à minuit chez soi, pas à Greenwich. */
export function dayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function loadHistory(): History {
  return load<History>(KEY, {});
}

/** Une journée n'a que 24 heures : aucun écart ne peut dépasser ça. */
const DAY_MINUTES = 24 * 60;

/**
 * Note le cumul du jour. Plusieurs relevés le même jour : le dernier l'emporte. Un relevé vide
 * (Steam introuvable, scan raté) n'est pas noté : il ferait passer pour « joué le lendemain »
 * tout le temps de jeu accumulé.
 */
export function recordSnapshot(list: Activity[]): History {
  const history = loadHistory();
  if (!list.length) return history;
  history[dayKey(new Date())] = Object.fromEntries(list.map((a) => [a.appid, a.playtime]));
  const days = Object.keys(history).sort();
  for (const day of days.slice(0, Math.max(0, days.length - KEEP_DAYS))) delete history[day];
  save(KEY, history);
  return history;
}

export interface DayPlay {
  /** Clé du jour (« 2026-10-01 »). */
  day: string;
  date: Date;
  /** Minutes jouées ce jour-là, `null` si on ne peut pas le savoir (pas de relevé). */
  minutes: number | null;
  /** Le jeu le plus joué ce jour-là. */
  top: { appid: number; minutes: number } | null;
}

/** Les `count` derniers jours, du plus ancien à aujourd'hui. */
export function dailyPlay(history: History, count: number): DayPlay[] {
  const keys = Object.keys(history).sort();
  const out: DayPlay[] = [];
  for (let back = count - 1; back >= 0; back--) {
    const date = new Date();
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - back);
    const day = dayKey(date);
    const snapshot = history[day];
    const previous = [...keys].reverse().find((k) => k < day);
    if (!snapshot || !previous) {
      out.push({ day, date, minutes: null, top: null });
      continue;
    }
    const before = history[previous];
    let minutes = 0;
    let top: DayPlay["top"] = null;
    for (const [appid, total] of Object.entries(snapshot)) {
      const known = before[appid];
      // Absent du relevé précédent : un jeu lancé pour la première fois, mais seulement si son
      // cumul tient en une journée. Au-delà, c'est un trou dans les relevés, pas une partie.
      if (known == null && total > DAY_MINUTES) continue;
      const played = Math.min(DAY_MINUTES, Math.max(0, total - (known ?? 0)));
      minutes += played;
      if (played > 0 && (!top || played > top.minutes)) top = { appid: Number(appid), minutes: played };
    }
    out.push({ day, date, minutes: Math.min(DAY_MINUTES, minutes), top });
  }
  return out;
}
