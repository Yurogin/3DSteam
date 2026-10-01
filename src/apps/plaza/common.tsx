import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Mascot } from "../../components/Mascot";
import { shade, type MascotLook, type Mood } from "../../lib/mascot";
import type { Equip } from "../../lib/svgiiItems";
import type { TFunction } from "../../lib/i18n";
import { sound } from "../../lib/sound";

/** Nom d'un objet du catalogue (`item_<id>` dans les traductions). */
export const itemName = (t: TFunction, id: string) => t(`item_${id}` as Parameters<TFunction>[0]);

/** Une pièce d'or, dessinée : un disque et une étoile. */
export function GoldIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <circle cx="12" cy="12" r="10" fill="#ffd34d" stroke="#e0a81e" strokeWidth="2" />
      <circle cx="12" cy="12" r="6.5" fill="none" stroke="#fff3c4" strokeWidth="1.2" />
      <path d="m12 7.6 1.3 2.7 3 .4-2.2 2.1.5 3-2.6-1.4-2.6 1.4.5-3-2.2-2.1 3-.4L12 7.6Z" fill="#e0a81e" />
    </svg>
  );
}

export function Golds({ value, big }: { value: number; big?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 font-black tabular-nums ${big ? "text-lg" : "text-sm"}`}>
      <GoldIcon size={big ? 22 : 16} />
      {value.toLocaleString()}
    </span>
  );
}

/** Bouton d'action de la Plaza, au style des autres applis. */
export function PlazaButton({
  children,
  onClick,
  primary,
  disabled,
  danger,
  autoFocus,
}: {
  children: ReactNode;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
  danger?: boolean;
  /** Le bouton qui reçoit le focus à l'ouverture d'une fenêtre (manette, clavier). */
  autoFocus?: boolean;
}) {
  return (
    <motion.button
      type="button"
      data-autofocus={autoFocus ? "" : undefined}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => sound.hover()}
      whileHover={disabled ? undefined : { scale: 1.04 }}
      whileTap={disabled ? undefined : { scale: 0.95 }}
      className={`inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm font-extrabold shadow-soft outline-none focus-visible:ring-3 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-45 ${
        primary ? "bg-accent text-on-accent" : danger ? "bg-surface-2 text-[#e5484d]" : "bg-surface-2 text-ink"
      }`}
    >
      {children}
    </motion.button>
  );
}

/** Fond de carte à la couleur préférée du Svgii (pastel, lisible en thème clair comme sombre). */
export const cardBackground = (look: MascotLook) => `linear-gradient(180deg, ${shade(look.favorite, 0.82)}, ${shade(look.favorite, 0.6)})`;

/** Jauge horizontale (appétit, points de vie). */
export function Gauge({ value, color, label }: { value: number; color: string; label?: string }) {
  return (
    <span className="block w-full" title={label}>
      <span className="block h-2 overflow-hidden rounded-full bg-black/10">
        <motion.span className="block h-full rounded-full" style={{ background: color }} initial={false} animate={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </span>
    </span>
  );
}

export function Hearts({ n }: { n: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${n}/5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <svg key={i} viewBox="0 0 24 24" width={14} height={14} aria-hidden>
          <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" fill={i < n ? "#ff6b9a" : "#00000018"} />
        </svg>
      ))}
    </span>
  );
}

/** Zone où marchent les Svgii (position de leurs pieds, en % de la scène). */
const AREA = { left: 7, right: 93, top: 46, bottom: 95 };
const rand = (min: number, max: number) => min + Math.random() * (max - min);
const spot = () => ({ x: rand(AREA.left, AREA.right), y: rand(AREA.top, AREA.bottom) });

/** Un Svgii qui se promène sur la Place : il choisit un point, y marche, s'arrête, recommence. */
export function Stroller({
  look,
  equip,
  name,
  mood,
  bubble,
  onPick,
}: {
  look: MascotLook;
  equip?: Equip;
  name: string;
  mood: Mood;
  bubble?: ReactNode;
  onPick: () => void;
}) {
  const [pos, setPos] = useState(spot);
  const [target, setTarget] = useState(pos);
  const [moving, setMoving] = useState(false);
  const pause = useRef(0);
  const dist = Math.hypot(target.x - pos.x, target.y - pos.y);

  useEffect(() => {
    // Départ décalé : tout le monde ne se met pas en marche au même instant.
    pause.current = window.setTimeout(() => {
      setTarget(spot());
      setMoving(true);
    }, rand(300, 2400));
    return () => window.clearTimeout(pause.current);
  }, []);

  const arrived = () => {
    setPos(target);
    setMoving(false);
    pause.current = window.setTimeout(() => {
      setTarget(spot());
      setMoving(true);
    }, rand(900, 4200));
  };

  // Plus bas = plus près : plus grand, et devant les autres. La taille suit la marche.
  const depth = (target.y - AREA.top) / (AREA.bottom - AREA.top);
  const side = Math.round(66 + depth * 44);
  const walk = { duration: moving ? Math.max(0.3, dist / 6) : 0, ease: "linear" } as const;
  return (
    <motion.button
      type="button"
      aria-label={name}
      onClick={onPick}
      onMouseEnter={() => sound.hover()}
      className="group absolute -translate-x-1/2 -translate-y-full rounded-full outline-none"
      style={{ zIndex: Math.round(target.y) }}
      initial={{ left: `${pos.x}%`, top: `${pos.y}%` }}
      animate={{ left: `${target.x}%`, top: `${target.y}%` }}
      transition={walk}
      onAnimationComplete={() => moving && arrived()}
    >
      <span className="relative block">
        <span className="absolute bottom-0.5 left-1/2 h-2.5 w-[60%] -translate-x-1/2 rounded-[50%] bg-black/15" />
        <motion.span className="block" initial={false} animate={{ width: side, height: side }} transition={walk}>
          <motion.span
            className="block h-full w-full"
            style={{ transformOrigin: "50% 100%" }}
            animate={moving ? { rotate: [-5, 5], y: [0, -2] } : { rotate: 0, y: 0 }}
            transition={moving ? { duration: 0.32, repeat: Infinity, repeatType: "reverse", ease: "easeInOut" } : { duration: 0.2 }}
          >
            <Mascot look={look} equip={equip} size={110} mood={mood} className="h-full w-full" />
          </motion.span>
        </motion.span>
        <span className="pointer-events-none absolute left-1/2 top-full mt-0.5 -translate-x-1/2 whitespace-nowrap rounded-full bg-surface/90 px-2 py-0.5 text-[11px] font-black text-ink shadow-soft">
          {name}
        </span>
        <span className="pointer-events-none absolute inset-0 rounded-full ring-accent group-focus-visible:ring-4" />
        <AnimatePresence>{bubble}</AnimatePresence>
      </span>
    </motion.button>
  );
}

/** Bulle de parole au-dessus d'un Svgii. */
export function Bubble({ text }: { text: string }) {
  return (
    <motion.span
      className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 w-max max-w-56 -translate-x-1/2 rounded-2xl bg-surface px-3 py-2 text-center text-xs font-bold text-ink shadow-pop"
      initial={{ opacity: 0, y: 8, scale: 0.8 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 4, scale: 0.9 }}
      transition={{ type: "spring", stiffness: 500, damping: 26 }}
    >
      {text}
      <span className="absolute -bottom-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 bg-surface" />
    </motion.span>
  );
}

/** Fenêtre posée sur la Plaza (menu d'un Svgii…). Échap la referme sans fermer l'appli. */
export function PlazaDialog({ label, onClose, children, wide }: { label: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });
  }, []);
  return (
    <motion.div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/25 p-4 backdrop-blur-[2px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        ref={ref}
        role="dialog"
        aria-label={label}
        className={`soft-scroll flex max-h-[calc(100vh-24px)] w-full ${wide ? "max-w-2xl" : "max-w-lg"} flex-col gap-3 overflow-y-auto rounded-panel bg-surface p-6 shadow-pop`}
        initial={{ scale: 0.9, y: 16 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 8 }}
        transition={{ type: "spring", stiffness: 420, damping: 30 }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
