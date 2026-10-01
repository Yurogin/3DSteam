import type { TFunction } from "./i18n";

const DAY = 86_400;

export function formatLastPlayed(ts: number, t: TFunction, locale: string): string {
  if (!ts) return t("neverPlayed");
  const days = Math.floor((Date.now() / 1000 - ts) / DAY);
  if (days <= 0) return t("playedToday");
  if (days === 1) return t("playedYesterday");
  if (days < 30) return t("playedDaysAgo", { n: days });
  const date = new Date(ts * 1000).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
  return t("playedOn", { date });
}

/**
 * Temps de jeu cumulé, à partir de minutes. Au-delà de dix heures, la minute près n'apporte plus
 * rien et encombre la puce.
 */
export function formatPlaytime(minutes: number, t: TFunction, locale: string): string {
  if (!minutes) return "";
  if (minutes < 60) return t("playtimeMinutes", { n: minutes });
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours >= 10 || rest === 0) return t("playtimeHours", { n: hours.toLocaleString(locale) });
  return t("playtimeHoursMinutes", { h: hours, m: rest });
}

/** Débit de téléchargement, à une décimale près. */
export function formatRate(bytesPerSecond: number, t: TFunction, locale: string): string {
  const mb = bytesPerSecond / 1024 ** 2;
  return mb >= 1
    ? t("megabytesPerSecond", { n: mb.toLocaleString(locale, { maximumFractionDigits: 1 }) })
    : t("kilobytesPerSecond", { n: Math.max(1, Math.round(bytesPerSecond / 1024)) });
}

/** Temps restant, à la minute près : plus fin, il ne ferait que clignoter. */
export function formatEta(seconds: number, t: TFunction): string {
  const minutes = Math.ceil(seconds / 60);
  if (minutes <= 1) return t("etaSoon");
  if (minutes < 60) return t("etaMinutes", { n: minutes });
  return t("etaHours", { h: Math.floor(minutes / 60), m: String(minutes % 60).padStart(2, "0") });
}

export function formatSize(bytes: number, t: TFunction, locale: string): string {
  if (!bytes) return "";
  const gb = bytes / 1024 ** 3;
  return gb >= 1
    ? t("gigabytes", { n: gb.toLocaleString(locale, { maximumFractionDigits: 1 }) })
    : t("megabytes", { n: Math.max(1, Math.round(bytes / 1024 ** 2)) });
}
