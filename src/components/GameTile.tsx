import { memo } from "react";
import { motion } from "framer-motion";
import { GameIcon } from "./GameIcon";
import { sound } from "../lib/sound";
import type { Game } from "../types";

interface Props {
  game: Game;
  /** Numéro de la case, renvoyé aux callbacks (qui restent ainsi stables pour `memo`). */
  index: number;
  size: number;
  selected: boolean;
  /** En cours de déplacement : l'icône flottante la remplace. */
  lifted: boolean;
  /** Animation de trajet entre deux cases (coupée pour l'icône qui vient d'être posée). */
  animateLayout: boolean;
  onSelect: (index: number) => void;
  onLaunch: (index: number) => void;
}

const spring = { type: "spring", stiffness: 520, damping: 32, mass: 0.7 } as const;

/** Icône de jeu. `layoutId` la fait glisser d'une case à l'autre quand on la déplace. */
export const GameTile = memo(function GameTile({ game, index, size, selected, lifted, animateLayout, onSelect, onLaunch }: Props) {
  return (
    <motion.button
      layoutId={animateLayout ? `tile-${game.appid}` : undefined}
      type="button"
      transition={spring}
      onMouseEnter={() => sound.hover()}
      onClick={() => onSelect(index)}
      onDoubleClick={() => onLaunch(index)}
      initial={false}
      animate={{ opacity: lifted ? 0 : 1, scale: selected ? 1.07 : 1, y: selected ? -3 : 0 }}
      whileHover={{ scale: selected ? 1.1 : 1.08, y: -5 }}
      whileTap={{ scale: 0.92 }}
      aria-label={game.name}
      aria-pressed={selected}
      title={game.name}
      className={`shine absolute inset-0 cursor-pointer overflow-hidden rounded-tile bg-surface shadow-soft outline-none hover:shadow-pop ${
        selected ? "tile-selected z-10" : ""
      }`}
    >
      <GameIcon game={game} size={size} />
      {/* Léger vernis brillant et fin liseré, façon icône 3DS. */}
      <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-linear-to-b from-white/25 to-transparent" />
      <span className="pointer-events-none absolute inset-0 rounded-tile ring-1 ring-inset ring-black/10" />
    </motion.button>
  );
});
