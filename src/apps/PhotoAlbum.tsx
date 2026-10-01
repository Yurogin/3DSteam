import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Placeholder, SectionTitle, useAppAction } from "./AppWindow";
import { listScreenshots, mediaSrc } from "../lib/api";
import { useI18n, type TFunction } from "../lib/i18n";
import { sound } from "../lib/sound";
import type { Game, Shot } from "../types";

type Filter = "all" | Shot["source"];
/** Assez pour une belle mosaïque ; « Afficher plus » ajoute la suite. */
const PAGE = 120;

interface Props {
  games: Map<number, Game>;
}

/** Nom affiché sous une capture : le jeu pour Steam, la provenance sinon. */
function sourceName(shot: Shot, games: Map<number, Game>, t: TFunction): string {
  if (shot.appid != null) return games.get(shot.appid)?.name ?? t("activityUnknownGame", { id: shot.appid });
  return shot.source === "gamebar" ? t("albumGameBar") : t("albumWindows");
}

/** « Aujourd'hui », « Hier », sinon la date. */
function dayLabel(seconds: number, t: TFunction, locale: string): string {
  const date = new Date(seconds * 1000);
  const today = new Date();
  const days = Math.round((new Date(today.toDateString()).getTime() - new Date(date.toDateString()).getTime()) / 86_400_000);
  if (days === 0) return t("albumToday");
  if (days === 1) return t("albumYesterday");
  return date.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

/**
 * Album, comme celui d'une console : les captures Steam (rangées par jeu), celles de Windows et de
 * la Xbox Game Bar, des plus récentes aux plus anciennes, groupées par jour. Ⓐ ouvre une capture
 * en grand, ← → passent à la voisine, Ⓑ revient à la mosaïque.
 */
export function PhotoAlbum({ games }: Props) {
  const { t, locale } = useI18n();
  const [shots, setShots] = useState<Shot[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    void listScreenshots()
      .then((list) => alive && setShots(list))
      .catch(() => alive && setShots([]));
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => (shots ?? []).filter((s) => filter === "all" || s.source === filter), [shots, filter]);
  const visible = filtered.slice(0, shown);
  const groups = useMemo(() => {
    const out: { label: string; items: { shot: Shot; index: number }[] }[] = [];
    visible.forEach((shot, index) => {
      const label = dayLabel(shot.taken, t, locale);
      if (out[out.length - 1]?.label !== label) out.push({ label, items: [] });
      out[out.length - 1].items.push({ shot, index });
    });
    return out;
  }, [visible, t, locale]);

  const step = (delta: number) => {
    if (open == null) return;
    const next = open + delta;
    if (next < 0 || next >= filtered.length) return sound.error();
    sound.move();
    if (next >= shown) setShown((n) => n + PAGE);
    setOpen(next);
  };

  // Dans la visionneuse, ← → changent de capture et Ⓑ la referme (sans fermer l'album).
  useAppAction((action) => {
    if (open == null) return false;
    if (action === "left" || action === "right") {
      step(action === "left" ? -1 : 1);
      return true;
    }
    if (action === "back" || action === "confirm") {
      setOpen(null);
      sound.zoom(-1);
      return true;
    }
    return action === "up" || action === "down";
  });

  if (!shots) return <Placeholder>{t("loading")}</Placeholder>;
  if (!shots.length) return <Placeholder>{t("albumEmpty")}</Placeholder>;

  const counts = (source: Shot["source"]) => shots.filter((s) => s.source === source).length;
  const filters: { id: Filter; label: string; count: number }[] = [
    { id: "all", label: t("albumAll"), count: shots.length },
    { id: "steam", label: "Steam", count: counts("steam") },
    { id: "windows", label: t("albumWindows"), count: counts("windows") },
    { id: "gamebar", label: t("albumGameBar"), count: counts("gamebar") },
  ];
  const current = open != null ? filtered[open] : null;

  return (
    <div className="flex flex-col gap-5 p-5 sm:p-6">
      <div className="flex flex-wrap gap-2">
        {filters
          .filter((f) => f.id === "all" || f.count > 0)
          .map((f) => (
            <button
              key={f.id}
              type="button"
              aria-current={f.id === filter || undefined}
              onMouseEnter={() => sound.hover()}
              onClick={() => {
                sound.select();
                setFilter(f.id);
                setShown(PAGE);
              }}
              className={`rounded-full px-4 py-1.5 text-sm font-extrabold outline-none focus:ring-3 focus:ring-accent ${
                f.id === filter ? "bg-accent text-on-accent" : "bg-surface-2 text-muted hover:text-ink"
              }`}
            >
              {f.label} <span className="tabular-nums opacity-70">{f.count}</span>
            </button>
          ))}
      </div>

      {groups.map((group) => (
        <section key={group.label}>
          <SectionTitle aside={t("albumCount", { n: group.items.length })}>
            <span className="capitalize">{group.label}</span>
          </SectionTitle>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2.5">
            {group.items.map(({ shot, index }) => (
              <motion.button
                key={shot.path}
                type="button"
                onMouseEnter={() => sound.hover()}
                onClick={() => {
                  sound.zoom(1);
                  setOpen(index);
                }}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                className="group relative aspect-video overflow-hidden rounded-xl bg-surface-2 shadow-soft outline-none focus:ring-4 focus:ring-accent"
              >
                <img
                  src={mediaSrc(shot.thumb ?? shot.path)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  className="absolute inset-0 h-full w-full object-cover"
                />
                <span className="absolute inset-x-0 bottom-0 truncate bg-linear-to-t from-black/70 to-transparent px-2 pb-1.5 pt-5 text-left text-[11px] font-extrabold text-white">
                  {sourceName(shot, games, t)}
                </span>
              </motion.button>
            ))}
          </div>
        </section>
      ))}

      {shown < filtered.length && (
        <button
          type="button"
          onMouseEnter={() => sound.hover()}
          onClick={() => {
            sound.select();
            setShown((n) => n + PAGE);
          }}
          className="self-center rounded-full bg-surface-2 px-5 py-2 text-sm font-extrabold text-ink outline-none hover:bg-accent-soft focus:ring-3 focus:ring-accent"
        >
          {t("albumMore", { n: filtered.length - shown })}
        </button>
      )}

      <AnimatePresence>
        {current && (
          <motion.div
            className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(null)}
          >
            <div className="relative min-h-0 flex-1">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.img
                  key={current.path}
                  src={mediaSrc(current.path)}
                  alt=""
                  draggable={false}
                  className="absolute inset-0 h-full w-full object-contain p-6"
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 1.02 }}
                  transition={{ duration: 0.2 }}
                />
              </AnimatePresence>
              {(["left", "right"] as const).map((side) => (
                <button
                  key={side}
                  type="button"
                  aria-label={side === "left" ? t("albumPrevious") : t("albumNext")}
                  onClick={(e) => {
                    e.stopPropagation();
                    step(side === "left" ? -1 : 1);
                  }}
                  className={`absolute top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white/15 text-2xl font-black text-white hover:bg-white/25 ${side === "left" ? "left-4" : "right-4"}`}
                >
                  {side === "left" ? "‹" : "›"}
                </button>
              ))}
            </div>
            <div className="flex shrink-0 items-center justify-between gap-4 px-6 pb-5 text-sm font-bold text-white/85">
              <span className="truncate">
                <span className="font-black text-white">{sourceName(current, games, t)}</span> ·{" "}
                {new Date(current.taken * 1000).toLocaleString(locale, { dateStyle: "long", timeStyle: "short" })}
              </span>
              <span className="shrink-0 tabular-nums">
                {open! + 1} / {filtered.length} · {t("albumViewerHint")}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
