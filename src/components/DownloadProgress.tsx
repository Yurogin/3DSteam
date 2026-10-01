import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { GameArt } from "./GameArt";
import { seeded } from "./Celebration";
import { useLiveBytes } from "../hooks/useLiveBytes";
import { artSources, gameHue } from "../lib/art";
import { formatEta, formatRate, formatSize } from "../lib/format";
import { useI18n, type TFunction } from "../lib/i18n";
import { sound } from "../lib/sound";
import type { Download, DownloadPhase, Game } from "../types";

/** Part téléchargée, entre 0 et 1. */
export function fractionOf(download: Download, bytes = download.bytesDownloaded): number {
  return download.bytesToDownload > 0 ? Math.min(1, bytes / download.bytesToDownload) : 0;
}

/** Pourcentage affiché : 100 seulement une fois tout reçu, pas à 99,6. */
export function percentOf(fraction: number): number {
  return fraction >= 1 ? 100 : Math.min(99, Math.floor(fraction * 100));
}

/** Nom de la phase. Un jeu déjà installé qui télécharge, c'est une mise à jour. */
export function phaseLabel(phase: DownloadPhase, installed: boolean, t: TFunction): string {
  switch (phase) {
    case "queued":
      return t("phaseQueued");
    case "preparing":
      return t("phasePreparing");
    case "downloading":
      return installed ? t("phaseUpdating") : t("phaseDownloading");
    case "verifying":
      return t("phaseVerifying");
    case "installing":
      return t("phaseInstalling");
    case "paused":
      return t("phasePaused");
  }
}

/** Seule la réception d'octets mérite du mouvement ; le reste attend ou travaille en silence. */
const moving = (phase: DownloadPhase) => phase === "downloading";
const waiting = (phase: DownloadPhase) => phase === "paused" || phase === "queued";

/** Pictogramme de la phase : flèche qui tombe, pause, horloge, rouage, boîte. */
export function PhaseIcon({ phase, size = 18 }: { phase: DownloadPhase; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (phase) {
    case "downloading":
      return (
        <svg {...common}>
          <g className="download-drop">
            <path d="M12 4v11M7 10.5 12 15.5l5-5" />
          </g>
          <path d="M5 20h14" />
        </svg>
      );
    case "paused":
      return (
        <svg {...common}>
          <path d="M9 6v12M15 6v12" />
        </svg>
      );
    case "queued":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v4l2.5 2" />
        </svg>
      );
    case "installing":
      return (
        <svg {...common}>
          <path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5v-7Z" />
          <path d="m4 8.5 8 4.5 8-4.5M12 13v7" />
        </svg>
      );
    default:
      // Préparation, vérification : un rouage qui tourne doucement.
      return (
        <motion.svg {...common} animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 2.4, ease: "linear" }}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" />
        </motion.svg>
      );
  }
}

/** Barre de progression : dégradé et reflet, rayures qui défilent tant que les octets arrivent. */
export function ProgressBar({ fraction, phase, className = "h-3" }: { fraction: number; phase: DownloadPhase; className?: string }) {
  const dim = waiting(phase);
  return (
    <div className={`relative overflow-hidden rounded-full bg-black/10 shadow-[inset_0_1px_3px_rgb(0_0_0/0.18)] ${className}`}>
      {/* La largeur suit déjà un affichage amorti (`useLiveBytes`) : pas d'animation en plus. */}
      <div
        className={`absolute inset-y-0 left-0 rounded-full ${moving(phase) ? "progress-stripes" : ""}`}
        style={{
          width: `${Math.max(fraction > 0 ? 3 : 0, fraction * 100)}%`,
          backgroundColor: dim ? "color-mix(in srgb, var(--muted) 70%, transparent)" : "var(--accent)",
          boxShadow: dim ? "none" : "0 0 12px color-mix(in srgb, var(--accent) 55%, transparent)",
        }}
      >
        <span className="absolute inset-x-0 top-0 h-1/2 rounded-t-full bg-white/30" />
      </div>
    </div>
  );
}

/** Écran du haut : phase, grand pourcentage, puis octets, débit et temps restant. */
export function DownloadStats({ download, installed }: { download: Download; installed: boolean }) {
  const { t, locale } = useI18n();
  const bytes = useLiveBytes(download);
  const fraction = fractionOf(download, bytes);
  const { phase, rate, bytesToDownload } = download;
  const remaining = Math.max(0, bytesToDownload - bytes);
  const details = [
    bytes > 0
      ? t("downloadProgress", { done: formatSize(bytes, t, locale), total: formatSize(bytesToDownload, t, locale) })
      : bytesToDownload > 0 && t("downloadTotal", { total: formatSize(bytesToDownload, t, locale) }),
    moving(phase) && rate > 0 && formatRate(rate, t, locale),
    moving(phase) && rate > 0 && remaining > 0 && formatEta(remaining / rate, t),
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-1.5">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={phase}
          className={`flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide ${waiting(phase) ? "text-muted" : "text-accent-strong"}`}
          initial={{ y: 6, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -6, opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <PhaseIcon phase={phase} size={16} />
          {phaseLabel(phase, installed, t)}
        </motion.span>
      </AnimatePresence>
      <span className={`text-5xl font-black leading-none tabular-nums ${waiting(phase) ? "text-muted" : "text-ink"}`}>
        {percentOf(fraction)}
        <span className="ml-1 text-2xl">%</span>
      </span>
      <ProgressBar fraction={fraction} phase={phase} className="mt-1 h-2.5 max-w-xs" />
      {details.length > 0 && <p className="truncate text-xs font-bold tabular-nums text-muted">{details.join("  ·  ")}</p>}
    </div>
  );
}

/** Blocs de données qui tombent dans la bannière : couleurs, tailles et cadences variées. */
const DROP_COLORS = ["#ff5d8f", "#ffd166", "#2fc6a4", "#4cc9f0", "#b388ff", "#ffffff"];

/**
 * La bannière du jeu, qui se remplit comme un bocal : la part encore vide reste en gris, bordée
 * d'une vague ; des blocs de données y tombent et plongent dans la part remplie, où remontent des
 * bulles. Un flotteur indique le pourcentage à la surface. En pause, tout se fige ; en file ou en
 * préparation, un badge dit ce qu'on attend.
 */
export function DownloadCard({ game, download }: { game: Game; download: Download }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.clientHeight));
    observer.observe(el);
    setHeight(el.clientHeight);
    return () => observer.disconnect();
  }, []);

  const fraction = fractionOf(download, useLiveBytes(download));
  const { phase } = download;
  const dry = height * (1 - fraction);
  const hue = gameHue(game.appid);
  const busy = phase === "verifying" || phase === "installing";

  const pieces = useMemo(() => {
    const random = seeded(game.appid);
    return {
      drops: Array.from({ length: 10 }, (_, i) => ({
        left: 6 + ((i * 9.3 + random() * 6) % 88),
        size: 7 + random() * 7,
        color: DROP_COLORS[i % DROP_COLORS.length],
        round: i % 3 === 1,
        duration: 1.1 + random() * 0.8,
        delay: -random() * 2,
        spin: (random() - 0.5) * 240,
      })),
      bubbles: Array.from({ length: 8 }, (_, i) => ({
        left: 8 + ((i * 11.7 + random() * 8) % 84),
        size: 4 + random() * 6,
        duration: 1.6 + random() * 1.4,
        delay: -random() * 3,
        sway: (random() - 0.5) * 24,
      })),
    };
  }, [game.appid]);

  const art = (className: string) => (
    <GameArt
      sources={artSources(game, "header")}
      alt=""
      className={className}
      fallback={
        <div
          className="absolute inset-0 grid place-items-center px-4 text-center text-2xl font-black text-white"
          style={{ background: `linear-gradient(145deg, hsl(${hue} 75% 66%), hsl(${(hue + 40) % 360} 70% 52%))` }}
        >
          {game.name}
        </div>
      }
    />
  );

  return (
    <div
      ref={ref}
      className={`absolute inset-0 overflow-hidden rounded-[18px] bg-surface-2 shadow-pop ring-4 ring-surface ${moving(phase) ? "" : "water-calm"} ${busy ? "water-shimmer" : ""}`}
    >
      {/* Part remplie : le visuel en couleurs, et des bulles qui remontent. */}
      {art("absolute inset-0 h-full w-full object-cover")}
      {moving(phase) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 overflow-hidden" style={{ height: height * fraction }}>
          {pieces.bubbles.map((b, i) => (
            <span
              key={i}
              className="water-bubble absolute rounded-full border-2 border-white/70 bg-white/20"
              style={{ left: `${b.left}%`, width: b.size, height: b.size, ["--dur" as string]: `${b.duration}s`, ["--delay" as string]: `${b.delay}s`, ["--sway" as string]: `${b.sway}px` }}
            />
          ))}
        </div>
      )}
      {/* Part vide : le même visuel en gris, coupé par la vague. */}
      {height > 0 && fraction < 1 && (
        <div className="water-dry pointer-events-none absolute inset-x-0 top-0" style={{ height: dry + 6 }}>
          <div className="absolute inset-x-0 top-0 grayscale brightness-[0.55]" style={{ height }}>
            {art("absolute inset-0 h-full w-full object-cover")}
          </div>
          {moving(phase) &&
            pieces.drops.map((d, i) => (
              <span
                key={i}
                className="water-drop absolute shadow-[0_2px_4px_rgb(0_0_0/0.3)]"
                style={{
                  left: `${d.left}%`,
                  width: d.size,
                  height: d.size,
                  background: d.color,
                  borderRadius: d.round ? "50%" : 3,
                  ["--dur" as string]: `${d.duration}s`,
                  ["--delay" as string]: `${d.delay}s`,
                  ["--spin" as string]: `${d.spin}deg`,
                }}
              />
            ))}
        </div>
      )}
      {height > 0 && fraction > 0 && fraction < 1 && (
        <>
          <div className="water-line pointer-events-none absolute inset-x-0 h-3" style={{ top: dry - 6 }} />
          {/* Le flotteur : le pourcentage, qui danse à la surface. */}
          <motion.span
            className="pointer-events-none absolute right-3 rounded-full bg-surface/90 px-2.5 py-0.5 text-sm font-black tabular-nums text-accent-strong shadow-soft"
            style={{ top: Math.max(4, dry - 30) }}
            animate={moving(phase) ? { y: [0, -3, 0, 2, 0], rotate: [0, -3, 0, 3, 0] } : { y: 0, rotate: 0 }}
            transition={moving(phase) ? { duration: 1.6, repeat: Infinity, ease: "easeInOut" } : { duration: 0.3 }}
          >
            {percentOf(fraction)} %
          </motion.span>
        </>
      )}
      {/* En attente : un badge au centre dit pourquoi rien ne bouge. */}
      <AnimatePresence>
        {!moving(phase) && (
          <motion.div
            key={phase}
            className="pointer-events-none absolute inset-0 grid place-items-center"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ type: "spring", stiffness: 420, damping: 24 }}
          >
            <span className="flex flex-col items-center gap-1.5 rounded-3xl bg-surface/85 px-5 py-3 text-accent-strong shadow-pop backdrop-blur-sm">
              <PhaseIcon phase={phase} size={30} />
              <span className="text-xs font-black uppercase tracking-wide text-ink">{phaseLabel(phase, game.installed, t)}</span>
            </span>
          </motion.div>
        )}
      </AnimatePresence>
      <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-linear-to-b from-white/20 to-transparent" />
    </div>
  );
}

/**
 * Sur la tuile : l'icône se colore de bas en haut à mesure qu'elle se remplit, le reste en gris.
 * Un badge dit la phase, et une pastille le pourcentage quand la tuile a la place.
 */
export function TileDownload({ download, size }: { download: Download; size: number }) {
  const bytes = useLiveBytes(download);
  const fraction = fractionOf(download, bytes);
  const { phase } = download;
  const badge = Math.max(18, Math.round(size * 0.26));
  return (
    <span className="pointer-events-none absolute inset-0">
      <span
        className="download-veil absolute inset-x-0 top-0 transition-[height] duration-100 ease-linear"
        style={{ height: `${(1 - fraction) * 100}%` }}
      />
      {/* Ligne de remplissage, lumineuse tant que les octets arrivent. */}
      {fraction > 0 && fraction < 1 && (
        <span
          className="absolute inset-x-0 h-[2px] transition-[top] duration-100 ease-linear"
          style={{
            top: `${(1 - fraction) * 100}%`,
            background: waiting(phase) ? "rgb(255 255 255 / 0.5)" : "var(--accent)",
            boxShadow: waiting(phase) ? "none" : "0 0 8px 1px var(--accent)",
          }}
        />
      )}
      <span
        className={`absolute right-1.5 top-1.5 grid place-items-center rounded-full shadow-soft ring-2 ring-white/80 ${
          waiting(phase) ? "bg-surface text-muted" : "bg-accent text-on-accent"
        }`}
        style={{ width: badge, height: badge }}
      >
        <PhaseIcon phase={phase} size={Math.round(badge * 0.62)} />
      </span>
      {size >= 64 && (
        <span className="absolute inset-x-0 bottom-1.5 flex justify-center">
          <span className="rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-black tabular-nums text-white backdrop-blur-sm">
            {percentOf(fraction)} %
          </span>
        </span>
      )}
    </span>
  );
}

/** Le téléchargement à mettre en avant : celui qui reçoit des octets, sinon le premier. */
function primaryOf(downloads: Download[]): Download | undefined {
  return downloads.find((d) => moving(d.phase)) ?? downloads.find((d) => !waiting(d.phase)) ?? downloads[0];
}

/** Pastille de la barre du haut : visible d'où qu'on soit, elle mène au jeu qui télécharge. */
export function DownloadsPill({ downloads, onShow }: { downloads: Download[]; onShow: (appid: number) => void }) {
  const shown = downloads.filter((d) => d.bytesToDownload > 0);
  const primary = primaryOf(shown);
  return (
    <AnimatePresence>
      {primary && (
        <motion.div
          initial={{ opacity: 0, scale: 0.8, x: 12 }}
          animate={{ opacity: 1, scale: 1, x: 0 }}
          exit={{ opacity: 0, scale: 0.8, x: 12 }}
          transition={{ type: "spring", stiffness: 420, damping: 28 }}
        >
          <PillContent download={primary} others={shown.length - 1} onShow={onShow} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function PillContent({ download, others, onShow }: { download: Download; others: number; onShow: (appid: number) => void }) {
  const { t, locale } = useI18n();
  const fraction = fractionOf(download, useLiveBytes(download));
  const { phase, rate } = download;
  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  const label = phaseLabel(phase, false, t);
  return (
    <motion.button
      type="button"
      onClick={() => onShow(download.appid)}
      onMouseEnter={() => sound.hover()}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.94 }}
      className="flex h-10 shrink-0 items-center gap-2 rounded-full bg-surface py-1 pl-1.5 pr-1.5 shadow-soft hover:shadow-pop xl:max-w-64 xl:shrink xl:pr-3.5"
      title={t("downloadShow", { name: download.name, status: `${label} ${percentOf(fraction)} %` })}
    >
      <span className={`relative grid h-7 w-7 shrink-0 place-items-center ${waiting(phase) ? "text-muted" : "text-accent"}`}>
        <svg viewBox="0 0 20 20" className="absolute inset-0 -rotate-90" aria-hidden>
          <circle cx="10" cy="10" r={radius} fill="none" stroke="currentColor" strokeOpacity={0.18} strokeWidth={2.6} />
          <circle
            cx="10"
            cy="10"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={2.6}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - fraction)}
          />
        </svg>
        <PhaseIcon phase={phase} size={12} />
      </span>
      {/* Fenêtre étroite : l'anneau seul, le détail est dans l'infobulle. Plus large, le nom garde
          de quoi se lire à côté de la pastille musique. */}
      <span className="hidden min-w-16 truncate text-sm font-extrabold text-ink xl:block">{download.name}</span>
      <span className="hidden shrink-0 text-sm font-black tabular-nums text-muted xl:block">
        {moving(phase) && rate > 0 ? formatRate(rate, t, locale) : `${percentOf(fraction)} %`}
      </span>
      {others > 0 && (
        <span className="shrink-0 rounded-full bg-accent-soft px-1.5 text-xs font-black text-accent-strong">
          {t("downloadsMore", { n: others })}
        </span>
      )}
    </motion.button>
  );
}
