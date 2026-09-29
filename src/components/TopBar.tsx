import { forwardRef, type ReactNode } from "react";
import { motion } from "framer-motion";
import { ExitFullscreenIcon, FullscreenIcon, RefreshIcon, SearchIcon, SettingsIcon, SoundOffIcon, SoundOnIcon } from "./Icons";
import { useI18n } from "../lib/i18n";
import { useClock } from "../hooks/useClock";
import { useBattery } from "../hooks/useBattery";
import { sound } from "../lib/sound";

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
}

const IconButton = ({ label, onClick, children, spin }: { label: string; onClick: () => void; children: ReactNode; spin?: boolean }) => (
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
  { query, onQuery, soundOn, onToggleSound, scanning, onRescan, fullscreen, onToggleFullscreen, onOpenSettings },
  searchRef,
) {
  const { t, locale } = useI18n();
  const now = useClock();
  const battery = useBattery();
  return (
    // Trois colonnes égales sur les côtés : l'horloge reste au centre exact de la barre.
    <header className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 px-5 pt-4">
      <div className="flex min-w-0 items-center">
        <label className="flex h-10 w-44 max-w-full items-center gap-2 rounded-full bg-surface px-3.5 text-muted shadow-soft focus-within:ring-3 focus-within:ring-accent lg:w-56">
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
        <span className="hidden text-sm font-bold capitalize text-muted sm:inline">
          {now.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" })}
        </span>
        {battery && <BatteryGauge percent={battery.percent} charging={battery.charging} />}
      </div>

      <div className="flex items-center justify-end gap-3">
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
      </div>
    </header>
  );
});

/** Pile façon 3DS : jauge colorée + pourcentage, éclair quand le secteur est branché. */
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
