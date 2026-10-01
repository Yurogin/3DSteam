import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { GameIcon } from "../components/GameIcon";
import { Placeholder, SectionTitle } from "./AppWindow";
import { dailyPlay, loadHistory, recordSnapshot } from "./activityHistory";
import { activityStats } from "../lib/api";
import { formatLastPlayed } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { sound } from "../lib/sound";
import type { Activity, Game } from "../types";

interface Props {
  /** Jeux connus (installés et catalogue), pour les noms et les icônes. */
  games: Map<number, Game>;
  /** Choisir un jeu dans le journal y amène le curseur. */
  onShowGame: (appid: number) => void;
}

/** Un jeu du journal qui n'est ni installé ni au catalogue : un nom et une icône génériques. */
function stub(appid: number, name: string): Game {
  return {
    appid,
    name,
    installDir: "",
    libraryPath: "",
    sizeOnDisk: 0,
    lastPlayed: 0,
    lastUpdated: 0,
    playtime: 0,
    art: { capsule: null, hero: null, logo: null, header: null },
    installed: false,
  };
}

/**
 * Journal d'activité, comme sur une console : combien on a joué, à quoi, et quand. Le temps total et
 * celui des deux dernières semaines viennent de Steam ; le détail jour par jour, de 3DSteam.
 */
export function ActivityLog({ games, onShowGame }: Props) {
  const { t, locale } = useI18n();
  const [list, setList] = useState<Activity[] | null>(null);
  const [history, setHistory] = useState(loadHistory);

  useEffect(() => {
    let alive = true;
    void activityStats()
      .then((stats) => {
        if (!alive) return;
        setList(stats);
        setHistory(recordSnapshot(stats));
      })
      .catch(() => alive && setList([]));
    return () => {
      alive = false;
    };
  }, []);

  const gameOf = (appid: number) => games.get(appid) ?? stub(appid, t("activityUnknownGame", { id: appid }));
  const days = useMemo(() => dailyPlay(history, 7), [history]);

  if (!list) return <Placeholder>{t("loading")}</Placeholder>;
  if (!list.length) return <Placeholder>{t("activityEmpty")}</Placeholder>;

  const total = list.reduce((s, a) => s + a.playtime, 0);
  const recent = list.reduce((s, a) => s + a.playtime2wks, 0);
  const allTime = [...list].sort((a, b) => b.playtime - a.playtime).slice(0, 10);
  const twoWeeks = list.filter((a) => a.playtime2wks > 0).sort((a, b) => b.playtime2wks - a.playtime2wks).slice(0, 8);
  const lastSessions = list.filter((a) => a.lastPlayed > 0).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 8);
  const favorite = allTime[0];

  return (
    <div className="flex flex-col gap-7 p-5 sm:p-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={t("activityTotal")} value={formatHours(total, t, locale)} />
        <StatTile label={t("activityTwoWeeks")} value={formatHours(recent, t, locale)} />
        <StatTile label={t("activityGamesPlayed")} value={list.length.toLocaleString(locale)} />
        <StatTile label={t("activityFavorite")} value={gameOf(favorite.appid).name} game={gameOf(favorite.appid)} />
      </div>

      <section>
        <SectionTitle aside={t("activityDaysHint")}>{t("activityLastDays")}</SectionTitle>
        <DayChart days={days} gameOf={gameOf} />
      </section>

      <div className="grid gap-7 lg:grid-cols-2">
        <section>
          <SectionTitle>{t("activityRankTwoWeeks")}</SectionTitle>
          {twoWeeks.length ? (
            <Ranking rows={twoWeeks.map((a) => ({ game: gameOf(a.appid), minutes: a.playtime2wks }))} onPick={onShowGame} />
          ) : (
            <p className="text-sm font-bold text-muted">{t("activityNothingRecent")}</p>
          )}
        </section>
        <section>
          <SectionTitle>{t("activityRankAllTime")}</SectionTitle>
          <Ranking rows={allTime.map((a) => ({ game: gameOf(a.appid), minutes: a.playtime }))} onPick={onShowGame} />
        </section>
      </div>

      <section>
        <SectionTitle>{t("activityLastSessions")}</SectionTitle>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {lastSessions.map((a) => {
            const game = gameOf(a.appid);
            return (
              <button
                key={a.appid}
                type="button"
                onMouseEnter={() => sound.hover()}
                onClick={() => onShowGame(a.appid)}
                className="flex items-center gap-3 rounded-2xl bg-surface-2 p-2.5 text-left outline-none focus:ring-3 focus:ring-accent"
              >
                <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-xl bg-surface">
                  <GameIcon game={game} size={40} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-extrabold text-ink">{game.name}</span>
                  <span className="block truncate text-xs font-bold text-muted">{formatLastPlayed(a.lastPlayed, t, locale)}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

/** Heures, sans le « de jeu » des puces : ici, tout est du temps de jeu. */
export function formatHours(minutes: number, t: ReturnType<typeof useI18n>["t"], locale: string): string {
  if (minutes < 60) return t("durationMinutes", { n: minutes });
  return t("durationHours", { n: Math.round(minutes / 60).toLocaleString(locale) });
}

/** Chiffre clé : un libellé, une grande valeur. */
export function StatTile({ label, value, game }: { label: string; value: string; game?: Game }) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-2xl bg-surface-2 p-4">
      {game && (
        <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-surface shadow-soft">
          <GameIcon game={game} size={44} />
        </span>
      )}
      <span className="min-w-0">
        <span className="block text-xs font-extrabold uppercase tracking-wide text-muted">{label}</span>
        <span className={`block truncate font-black text-ink ${game ? "text-lg" : "text-3xl tabular-nums"}`}>{value}</span>
      </span>
    </div>
  );
}

/**
 * Minutes jouées par jour, sur une semaine. Une seule série : la couleur d'accent, pas de légende.
 * Seuls aujourd'hui et le jour le plus joué portent leur valeur ; les autres la donnent au survol
 * ou au focus (chaque colonne est un bouton, atteignable à la manette).
 */
function DayChart({ days, gameOf }: { days: ReturnType<typeof dailyPlay>; gameOf: (appid: number) => Game }) {
  const { t, locale } = useI18n();
  const known = days.filter((d) => d.minutes != null);
  const max = Math.max(60, ...known.map((d) => d.minutes ?? 0));
  // Repères ronds, quatre intervalles au plus : la demi-heure pour une petite semaine, jusqu'à
  // six heures pour une semaine de marathon.
  const step = [30, 60, 120, 180, 240, 360].find((s) => max / s <= 4) ?? 360;
  const top = Math.ceil(max / step) * step;
  const peak = known.reduce<(typeof days)[number] | null>((best, d) => ((d.minutes ?? 0) > (best?.minutes ?? 0) ? d : best), null);
  const [hover, setHover] = useState<string | null>(null);

  if (known.length === 0) return <p className="rounded-2xl bg-surface-2 p-5 text-sm font-bold text-muted">{t("activityHistoryEmpty")}</p>;

  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);
  return (
    <div className="rounded-2xl bg-surface-2 p-4 pl-14">
      <div className="relative h-44">
        {/* Repères discrets : la ligne de base et quelques graduations. */}
        {ticks.map((m) => (
          <div key={m} className="pointer-events-none absolute inset-x-0 border-t border-muted/15" style={{ bottom: `${(m / top) * 100}%` }}>
            <span className="absolute -left-12 -translate-y-1/2 text-[11px] font-bold tabular-nums text-muted">{formatPlay(m, t)}</span>
          </div>
        ))}
        <div className="absolute inset-0 flex items-end gap-[2px]">
          {days.map((d, i) => {
            const today = i === days.length - 1;
            const height = d.minutes != null ? Math.max(d.minutes > 0 ? 3 : 0, (d.minutes / top) * 100) : 0;
            const labelled = d.minutes != null && d.minutes > 0 && (today || d === peak);
            const open = hover === d.day;
            const topGame = d.top ? gameOf(d.top.appid) : null;
            return (
              <button
                key={d.day}
                type="button"
                aria-label={`${d.date.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" })} : ${
                  d.minutes == null ? t("activityNoData") : formatPlay(d.minutes, t)
                }`}
                onMouseEnter={() => setHover(d.day)}
                onMouseLeave={() => setHover((h) => (h === d.day ? null : h))}
                onFocus={() => setHover(d.day)}
                onBlur={() => setHover((h) => (h === d.day ? null : h))}
                // La zone cliquable est toute la colonne, pas seulement la barre.
                className="relative flex h-full flex-1 items-end justify-center rounded-lg outline-none focus-visible:bg-accent-soft/50"
              >
                {d.minutes == null ? (
                  <span className="mb-0 h-1.5 w-[46%] max-w-10 rounded-full border-2 border-dashed border-muted/30" />
                ) : (
                  <motion.span
                    className="w-[46%] max-w-10 rounded-t-[4px]"
                    style={{ background: open ? "var(--accent-strong)" : "var(--accent)" }}
                    initial={{ height: 0 }}
                    animate={{ height: `${height}%` }}
                    transition={{ type: "spring", stiffness: 260, damping: 26, delay: i * 0.04 }}
                  />
                )}
                {labelled && !open && (
                  <span
                    className="pointer-events-none absolute text-xs font-black tabular-nums text-ink"
                    style={{ bottom: `calc(${height}% + 4px)` }}
                  >
                    {formatPlay(d.minutes ?? 0, t)}
                  </span>
                )}
                {open && (
                  <span
                    className="pointer-events-none absolute z-10 w-max max-w-48 rounded-xl bg-ink px-3 py-2 text-left text-xs font-bold text-bg shadow-pop"
                    style={{ bottom: `calc(${height}% + 8px)` }}
                  >
                    <span className="block font-black">{d.date.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "short" })}</span>
                    <span className="block tabular-nums">{d.minutes == null ? t("activityNoData") : formatPlay(d.minutes, t)}</span>
                    {topGame && <span className="block truncate opacity-80">{topGame.name}</span>}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-2 flex gap-[2px]">
        {days.map((d, i) => (
          <span key={d.day} className={`flex-1 text-center text-xs capitalize ${i === days.length - 1 ? "font-black text-ink" : "font-bold text-muted"}`}>
            {i === days.length - 1 ? t("activityToday") : d.date.toLocaleDateString(locale, { weekday: "short" })}
          </span>
        ))}
      </div>
    </div>
  );
}

/** « 45 min », « 2 h », « 1 h 30 ». */
function formatPlay(minutes: number, t: ReturnType<typeof useI18n>["t"]): string {
  if (minutes < 60) return t("durationMinutes", { n: minutes });
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? t("durationHoursMinutes", { h, m: String(m).padStart(2, "0") }) : t("durationHours", { n: h });
}

/** Classement : rang, icône, nom, barre proportionnelle au premier, durée. */
function Ranking({ rows, onPick }: { rows: { game: Game; minutes: number }[]; onPick: (appid: number) => void }) {
  const { t } = useI18n();
  const max = rows[0]?.minutes || 1;
  return (
    <ol className="flex flex-col gap-1.5">
      {rows.map(({ game, minutes }, i) => (
        <li key={game.appid}>
          <button
            type="button"
            onMouseEnter={() => sound.hover()}
            onClick={() => onPick(game.appid)}
            className="flex w-full items-center gap-3 rounded-2xl p-1.5 pr-3 text-left outline-none hover:bg-surface-2 focus:bg-accent-soft"
          >
            <span className="w-5 shrink-0 text-center text-sm font-black tabular-nums text-muted">{i + 1}</span>
            <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-surface-2">
              <GameIcon game={game} size={36} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-extrabold text-ink">{game.name}</span>
              <span className="mt-1 block h-1.5 rounded-full bg-muted/12">
                <motion.span
                  className="block h-full rounded-full bg-accent"
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max(2, (minutes / max) * 100)}%` }}
                  transition={{ type: "spring", stiffness: 200, damping: 28, delay: i * 0.03 }}
                />
              </span>
            </span>
            {/* Largeur fixe : toutes les barres partagent la même longueur maximale. */}
            <span className="w-16 shrink-0 text-right text-sm font-black tabular-nums text-ink">{formatPlay(minutes, t)}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}
