import { memo } from "react";
import { motion } from "framer-motion";
import { GameIcon } from "./GameIcon";
import { sound } from "../lib/sound";
import type { Folder } from "../lib/board";
import type { Game } from "../types";
import { useI18n } from "../lib/i18n";

/** Visuel d'un dossier : onglet + corps colorés, aperçu des icônes des 4 premiers jeux. `size` = largeur (px). */
export function FolderArt({ folder, games, size }: { folder: Folder; games: Game[]; size: number }) {
  const preview = games.slice(0, 4);
  const pad = Math.max(5, size * 0.09);
  const thumb = (size - pad * 2.6) / 2;
  return (
    <div className="absolute inset-0" style={{ color: folder.color }}>
      {/* Onglet du dossier */}
      <div
        className="absolute left-[10%] w-[42%] bg-current brightness-[0.88]"
        style={{ top: size * 0.02, height: size * 0.2, borderRadius: `${size * 0.08}px ${size * 0.08}px 0 0` }}
      />
      {/* Corps */}
      <div
        className="absolute inset-x-0 bottom-0 overflow-hidden bg-current shadow-[inset_0_-6px_0_rgba(0,0,0,0.12),inset_0_2px_0_rgba(255,255,255,0.35)]"
        style={{ top: size * 0.12, borderRadius: Math.max(10, size * 0.14) }}
      >
        <div className="absolute inset-0 grid grid-cols-2 grid-rows-2" style={{ padding: pad, gap: pad * 0.6 }}>
          {Array.from({ length: 4 }, (_, i) => {
            const game = preview[i];
            return (
              <div key={i} className="relative overflow-hidden bg-white/35" style={{ borderRadius: Math.max(4, size * 0.07) }}>
                {game && <GameIcon game={game} size={thumb} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface Props {
  folder: Folder;
  games: Game[];
  size: number;
  selected: boolean;
  lifted: boolean;
  animateLayout: boolean;
  dropHighlight: boolean;
  index: number;
  onSelect: (index: number) => void;
  onOpen: (index: number) => void;
}

export const FolderTile = memo(function FolderTile({ folder, games, size, selected, lifted, animateLayout, dropHighlight, index, onSelect, onOpen }: Props) {
  const { t } = useI18n();
  return (
    <motion.button
      layoutId={animateLayout ? `folder-${folder.id}` : undefined}
      type="button"
      onMouseEnter={() => sound.hover()}
      onClick={() => onSelect(index)}
      onDoubleClick={() => onOpen(index)}
      initial={false}
      animate={{
        opacity: lifted ? 0 : 1,
        scale: dropHighlight ? 1.14 : selected ? 1.07 : 1,
        y: selected ? -3 : 0,
      }}
      whileHover={{ scale: selected ? 1.1 : 1.08, y: -5 }}
      whileTap={{ scale: 0.92 }}
      transition={{ type: "spring", stiffness: 520, damping: 30 }}
      aria-label={t("folderAria", { name: folder.name })}
      title={folder.name}
      className={`absolute inset-0 cursor-pointer rounded-tile outline-none drop-shadow-[0_8px_14px_rgba(0,0,0,0.18)] ${selected ? "tile-selected z-10" : ""}`}
    >
      <FolderArt folder={folder} games={games} size={size} />
    </motion.button>
  );
});
