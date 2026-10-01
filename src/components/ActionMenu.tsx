import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { sound } from "../lib/sound";

export interface MenuEntry {
  id: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  /** Action lourde de conséquences (désinstaller, supprimer) : en rouge, séparée du reste. */
  danger?: boolean;
}

interface Props {
  /** Point d'apparition : le pointeur au clic droit, le coin de la tuile au clavier. */
  x: number;
  y: number;
  /** Abscisse de repli si le menu déborde à droite (à gauche de la tuile, au clavier). */
  flipX?: number;
  title: string;
  /** Vignette du jeu ou du dossier, à côté du titre. */
  thumb?: ReactNode;
  entries: MenuEntry[];
  onClose: () => void;
}

/** Marge gardée avec les bords de la fenêtre. */
const EDGE = 12;

/**
 * Menu d'actions d'une case, au clic droit, à la touche Menu ou au bouton Ⓨ. C'est une petite
 * fenêtre (`role="dialog"`) : les flèches et la manette s'y déplacent comme partout ailleurs,
 * Ⓐ valide, Ⓑ referme.
 */
export function ActionMenu({ x, y, flipX, title, thumb, entries, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);

  // Le menu ne déborde jamais de la fenêtre : mesuré avant affichage, puis à chaque changement de
  // taille de la fenêtre ou de son contenu.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      // `offsetWidth` et non `getBoundingClientRect` : la taille réelle, sans l'échelle réduite
      // de l'animation d'ouverture, qui faisait croire qu'un menu trop grand rentrait.
      const width = el.offsetWidth;
      const height = el.offsetHeight;
      const right = window.innerWidth - EDGE;
      const bottom = window.innerHeight - EDGE;
      const left = x + width > right ? (flipX ?? x) - width : x;
      // Trop bas pour s'ouvrir sous le pointeur : il s'ouvre au-dessus, comme un menu du système.
      const top = y + height > bottom && y - height >= EDGE ? y - height : y;
      setPlace({
        left: Math.max(EDGE, Math.min(left, right - width)),
        top: Math.max(EDGE, Math.min(top, bottom - height)),
      });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    window.addEventListener("resize", fit);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [x, y, flipX]);

  // Une fois visible seulement : un élément masqué ne peut pas recevoir le focus.
  const placed = place != null;
  useEffect(() => {
    if (placed) ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus({ preventScroll: true });
  }, [placed]);

  const safe = entries.filter((e) => !e.danger);
  const danger = entries.filter((e) => e.danger);
  const item = (entry: MenuEntry) => (
    <button
      key={entry.id}
      type="button"
      role="menuitem"
      onMouseEnter={(e) => {
        sound.hover();
        e.currentTarget.focus({ preventScroll: true });
      }}
      onClick={() => {
        sound.select();
        onClose();
        entry.onSelect();
      }}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-extrabold outline-none transition-colors ${
        entry.danger ? "text-[#e5484d] focus:bg-[#e5484d]/12" : "text-ink focus:bg-accent-soft focus:text-accent-strong"
      }`}
    >
      <span className="grid h-5 w-5 shrink-0 place-items-center">{entry.icon}</span>
      {entry.label}
    </button>
  );

  return createPortal(
    <div className="fixed inset-0 z-50" onPointerDown={(e) => e.target === e.currentTarget && onClose()} onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      <motion.div
        ref={ref}
        role="dialog"
        aria-label={title}
        // Jamais plus grand que la fenêtre : au-delà, la liste défile.
        className="fixed flex max-h-[calc(100vh-24px)] w-60 max-w-[calc(100vw-24px)] origin-top-left flex-col rounded-2xl bg-surface p-1.5 shadow-pop ring-1 ring-black/5"
        style={place ?? { left: x, top: y, visibility: "hidden" }}
        initial={{ opacity: 0, scale: 0.85, y: -6 }}
        animate={place ? { opacity: 1, scale: 1, y: 0 } : undefined}
        transition={{ type: "spring", stiffness: 520, damping: 30 }}
      >
        <div className="flex items-center gap-2.5 px-2.5 pb-2 pt-1.5">
          {thumb && <span className="relative h-8 w-8 shrink-0 overflow-hidden rounded-lg bg-surface-2">{thumb}</span>}
          <span className="min-w-0 truncate text-sm font-black text-ink">{title}</span>
        </div>
        <div role="menu" className="soft-scroll flex min-h-0 flex-col overflow-y-auto">
          {safe.map(item)}
          {danger.length > 0 && safe.length > 0 && <span className="mx-2.5 my-1 h-px bg-muted/15" />}
          {danger.map(item)}
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}
