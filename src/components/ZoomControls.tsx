import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { MinusIcon, PlusIcon } from "./Icons";
import { sound } from "../lib/sound";
import { useI18n } from "../lib/i18n";

interface Props {
  level: number;
  levels: number;
  onZoom: (direction: 1 | -1) => void;
}

const RoundButton = ({ onClick, disabled, label, children }: { onClick: () => void; disabled: boolean; label: string; children: ReactNode }) => (
  <motion.button
    type="button"
    aria-label={label}
    title={label}
    disabled={disabled}
    onClick={onClick}
    onMouseEnter={() => sound.hover()}
    whileHover={{ scale: 1.12 }}
    whileTap={{ scale: 0.86 }}
    className="grid h-9 w-9 place-items-center rounded-full bg-surface text-accent shadow-soft disabled:opacity-35"
  >
    {children}
  </motion.button>
);

/** Boutons − / + façon 3DS, avec l'indicateur de niveau entre les deux. */
export function ZoomControls({ level, levels, onZoom }: Props) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2">
      <RoundButton label={t("zoomOut")} disabled={level === 0} onClick={() => onZoom(-1)}>
        <MinusIcon />
      </RoundButton>
      <div className="flex items-center gap-1" aria-hidden>
        {Array.from({ length: levels }, (_, i) => (
          <motion.span
            key={i}
            className="h-2 rounded-full bg-accent"
            animate={{ width: i === level ? 18 : 8, opacity: i <= level ? 1 : 0.3 }}
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
          />
        ))}
      </div>
      <RoundButton label={t("zoomIn")} disabled={level === levels - 1} onClick={() => onZoom(1)}>
        <PlusIcon />
      </RoundButton>
    </div>
  );
}
