import { forwardRef, type MouseEvent, type ReactNode } from "react";
import { motion } from "framer-motion";
import { ExitFullscreenIcon, FullscreenIcon, PowerIcon, RefreshIcon, SearchIcon, SettingsIcon, SoundOffIcon, SoundOnIcon } from "./Icons";
import { useI18n } from "../lib/i18n";
import { useClock } from "../hooks/useClock";
import { useBattery } from "../hooks/useBattery";
import { sound } from "../lib/sound";
import { DownloadsPill } from "./DownloadProgress";
import { MusicPill } from "../apps/MusicPlayer";
import { Mascot } from "./Mascot";
import { isFreshProfile, shade, useMascotMood, useProfile } from "../lib/mascot";
import type { Download } from "../types";

interface Props {
  query: string;
  onQuery: (q: string) => void;
  soundOn: boolean;
  onToggleSound: () => void;
  scanning: boolean;
  onRescan: () => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onOpenSettings: () => void;
  /** Téléchargements en cours, résumés dans une pastille. */
  downloads: Download[];
  /** La pastille mène au jeu qui télécharge. */
  onShowDownload: (appid: number) => void;
  /** La pastille de musique rouvre le lecteur. */
  onOpenMusic: () => void;
  /** Le bouton marche/arrêt ouvre son menu sous lui (`rect` = sa position). */
  onPower: (rect: DOMRect) => void;
  /** La pastille de profil ouvre l'éditeur de mascotte. */
  onOpenProfile: () => void;
}

const IconButton = ({ label, onClick, children, spin }: { label: string; onClick: (e: MouseEvent<HTMLButtonElement>) => void; children: ReactNode; spin?: boolean }) => (
  <motion.button
    type="button"
    aria-label={label}
    title={label}
    onClick={onClick}
    onMouseEnter={() => sound.hover()}
    whileHover={{ scale: 1.1 }}
    whileTap={{ scale: 0.88 }}
    className="grid h-10 w-10 place-items-center rounded-full bg-surface text-muted shadow-soft hover:text-accent"
  >
    <motion.span
      className="grid place-items-center"
      animate={spin ? { rotate: 360 } : { rotate: 0 }}
      transition={spin ? { repeat: Infinity, duration: 0.9, ease: "linear" } : { duration: 0 }}
    >
      {children}
    </motion.span>
  </motion.button>
);

export const TopBar = forwardRef<HTMLInputElement, Props>(function TopBar(
  { query, onQuery, soundOn, onToggleSound, scanning, onRescan, fullscreen, onToggleFullscreen, onOpenSettings, downloads, onShowDownload, onOpenMusic, onPower, onOpenProfile },
  searchRef,
) {
  const { t, locale } = useI18n();
  const now = useClock();
  const battery = useBattery();
  return (
    // Trois colonnes égales sur les côtés : l'horloge reste au centre exact de la barre.
    <header className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-3 pt-3 md:gap-3 md:px-5 md:pt-4 [@media(max-height:640px)]:pt-2">
      <div className="flex min-w-0 items-center gap-2 md:gap-3">
        <ProfilePill onOpen={onOpenProfile} />
        <label className="flex h-10 w-32 min-w-10 max-w-full items-center gap-2 rounded-full bg-surface px-3.5 text-muted shadow-soft focus-within:ring-3 focus-within:ring-accent md:w-44 lg:w-56">
          <SearchIcon width={18} height={18} />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                onQuery("");
                e.currentTarget.blur();
              }
            }}
            placeholder={t("searchPlaceholder")}
            spellCheck={false}
            className="w-full bg-transparent text-sm font-bold text-ink outline-none placeholder:text-muted"
          />
        </label>
      </div>

      <div className="flex items-center gap-3 rounded-full bg-surface px-4 py-1.5 shadow-soft">
        <span className="text-lg font-black tabular-nums">
          {now.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
        </span>
        <span className="hidden text-sm font-bold capitalize text-muted lg:inline">
          {now.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" })}
        </span>
        {battery && <BatteryGauge percent={battery.percent} charging={battery.charging} />}
      </div>

      <div className="flex min-w-0 items-center justify-end gap-1.5 md:gap-2 lg:gap-3">
        <MusicPill onOpen={onOpenMusic} />
        <DownloadsPill downloads={downloads} onShow={onShowDownload} />
        <IconButton label={soundOn ? t("mute") : t("unmute")} onClick={onToggleSound}>
          {soundOn ? <SoundOnIcon /> : <SoundOffIcon />}
        </IconButton>
        <IconButton label={t("rescanTitle")} onClick={onRescan} spin={scanning}>
          <RefreshIcon />
        </IconButton>
        <IconButton label={fullscreen ? t("fullscreenExit") : t("fullscreenEnter")} onClick={onToggleFullscreen}>
          {fullscreen ? <ExitFullscreenIcon /> : <FullscreenIcon />}
        </IconButton>
        <IconButton label={`${t("settings")} (P)`} onClick={onOpenSettings}>
          <SettingsIcon />
        </IconButton>
        {/* Marche/arrêt, tout à droite comme sur une console : un menu, pour ne pas quitter par mégarde. */}
        <IconButton label={t("power")} onClick={(e) => onPower(e.currentTarget.getBoundingClientRect())}>
          <PowerIcon />
        </IconButton>
      </div>
    </header>
  );
});

/** Le profil : la mascotte dans sa bulle, et le nom. Elle réagit à ce qui se passe (voir `mascot.ts`). */
function ProfilePill({ onOpen }: { onOpen: () => void }) {
  const { t } = useI18n();
  const profile = useProfile();
  const mood = useMascotMood();
  const name = profile.name || t("profileNoName");
  const fresh = isFreshProfile();
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      onMouseEnter={() => sound.hover()}
      title={fresh ? t("profileNew") : t("profileEdit")}
      aria-label={`${t("profile")} : ${name}`}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.94 }}
      className="relative flex h-10 shrink-0 items-center gap-2 rounded-full bg-surface pl-0.5 pr-0.5 shadow-soft md:pr-3.5"
    >
      {/* La tête dépasse un peu de sa bulle, comme un avatar de console : oreilles et accessoires ne sont pas coupés. */}
      <span
        className="relative h-9 w-9 shrink-0 rounded-full"
        style={{ background: `radial-gradient(circle at 50% 35%, ${shade(profile.mascot.favorite, 0.8)}, ${shade(profile.mascot.favorite, 0.45)})` }}
      >
        <Mascot look={profile.mascot} size={36} mood={mood} crop="head" className="absolute inset-0" />
      </span>
      <span className="hidden max-w-28 truncate text-sm font-black text-ink md:inline">{name}</span>
      {fresh && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-accent ring-2 ring-surface" />}
    </motion.button>
  );
}

/** Pile façon console portable : jauge colorée + pourcentage, éclair quand le secteur est branché. */
function BatteryGauge({ percent, charging }: { percent: number; charging: boolean }) {
  const { t } = useI18n();
  const low = percent <= 20 && !charging;
  const color = low ? "#ef4444" : percent <= 40 && !charging ? "#f59e0b" : "#22c55e";
  return (
    <span
      className={`flex items-center gap-1.5 text-sm font-extrabold tabular-nums ${low ? "text-[#ef4444]" : "text-muted"}`}
      title={charging ? t("batteryCharging", { p: percent }) : t("battery", { p: percent })}
    >
      <span className="relative flex h-3.5 w-7 items-center rounded-[4px] border-2 border-current p-[1.5px]">
        <motion.span
          className="h-full rounded-[2px]"
          style={{ background: color }}
          initial={false}
          animate={{ width: `${Math.max(6, percent)}%` }}
          transition={{ type: "spring", stiffness: 200, damping: 25 }}
        />
        <span className="absolute -right-[4px] top-1/2 h-1.5 w-[3px] -translate-y-1/2 rounded-r-sm bg-current" />
        {charging && (
          <svg viewBox="0 0 24 24" className="absolute inset-0 m-auto h-3 w-3 text-ink" fill="currentColor" aria-hidden>
            <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" stroke="var(--surface)" strokeWidth="2" />
          </svg>
        )}
      </span>
      {percent} %
    </span>
  );
}
