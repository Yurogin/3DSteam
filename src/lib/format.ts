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

export function formatSize(bytes: number, t: TFunction, locale: string): string {
  if (!bytes) return "";
  const gb = bytes / 1024 ** 3;
  return gb >= 1
    ? t("gigabytes", { n: gb.toLocaleString(locale, { maximumFractionDigits: 1 }) })
    : t("megabytes", { n: Math.max(1, Math.round(bytes / 1024 ** 2)) });
}
