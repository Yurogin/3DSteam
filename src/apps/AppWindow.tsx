import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { motion } from "framer-motion";
import { AppIcon, builtinApp } from "./builtin";
import { useI18n } from "../lib/i18n";
import { sound } from "../lib/sound";
import type { Action } from "../lib/nav";
import type { BuiltinId } from "../types";

/** Une appli peut intercepter une action (← → dans la visionneuse…) : `true` = traitée. */
export type AppActionHandler = (action: Action) => boolean;

const ActionContext = createContext<(handler: AppActionHandler | null) => void>(() => {});

/**
 * Les actions clavier et manette passent d'abord par l'appli ouverte. Ce qu'elle ne traite pas
 * suit le chemin habituel : les flèches déplacent le focus, Ⓐ valide, Ⓑ referme la fenêtre.
 */
export function useAppAction(handler: AppActionHandler) {
  const register = useContext(ActionContext);
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    register((action) => latest.current(action));
    return () => register(null);
  }, [register]);
}

/**
 * Fenêtre d'une appli intégrée : elle prend tout l'écran, comme un logiciel de console. C'est une
 * fenêtre (`role="dialog"`), la navigation au clavier et à la manette s'y fait donc toute seule.
 */
export function AppWindow({
  id,
  title,
  onClose,
  onRegister,
  children,
}: {
  id: BuiltinId;
  title: string;
  onClose: () => void;
  onRegister: (handler: AppActionHandler | null) => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const [from, to] = builtinApp(id).colors;
  return (
    <motion.div
      className="fixed inset-0 z-40 bg-bg/70 backdrop-blur-md"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      <motion.div
        role="dialog"
        aria-label={title}
        className="absolute inset-3 flex flex-col overflow-hidden rounded-panel bg-surface shadow-pop sm:inset-5"
        initial={{ scale: 0.92, y: 18 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.94, y: 12 }}
        transition={{ type: "spring", stiffness: 420, damping: 32 }}
      >
        <header
          className="relative flex shrink-0 items-center gap-3 px-5 py-3 text-white [@media(max-height:640px)]:py-2"
          style={{ background: `linear-gradient(120deg, ${from}, ${to})` }}
        >
          <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-xl shadow-soft ring-2 ring-white/60">
            <AppIcon id={id} />
          </span>
          <h1 className="min-w-0 flex-1 truncate text-xl font-black drop-shadow-sm">{title}</h1>
          <button
            type="button"
            onMouseEnter={() => sound.hover()}
            onClick={onClose}
            className="rounded-full bg-white/25 px-4 py-1.5 text-sm font-extrabold backdrop-blur-sm hover:bg-white/35"
          >
            {t("appClose")}
          </button>
        </header>
        <ActionContext.Provider value={onRegister}>
          <div className="soft-scroll relative min-h-0 flex-1 overflow-y-auto">{children}</div>
        </ActionContext.Provider>
      </motion.div>
    </motion.div>
  );
}

/** En-tête de section, commun aux trois applis. */
export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-lg font-black text-ink">{children}</h2>
      {aside && <span className="text-xs font-bold text-muted">{aside}</span>}
    </div>
  );
}

/** Message d'attente ou d'absence, centré. */
export function Placeholder({ children }: { children: ReactNode }) {
  return <p className="grid min-h-48 place-items-center px-6 text-center text-sm font-bold text-muted">{children}</p>;
}
