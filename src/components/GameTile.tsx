import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { GameIcon } from "./GameIcon";
import { TileDownload } from "./DownloadProgress";
import { ConfettiAt } from "./Celebration";
import { CRACK_S, Cracks, Shatter } from "./Shatter";
import { PlayIcon } from "./Icons";
import { sound } from "../lib/sound";
import type { Download, Game } from "../types";

interface Props {
  game: Game;
  /** Numéro de la case, renvoyé aux callbacks (qui restent ainsi stables pour `memo`). */
  index: number;
  size: number;
  selected: boolean;
  /** Téléchargement en cours pour ce jeu, s'il y en a un. */
  download?: Download;
  /** Le jeu vient de s'installer : petit bond de joie. */
  ready: boolean;
  /** Le jeu vient d'être désinstallé : la tuile se fissure, puis vole en éclats. */
  leaving: boolean;
  /** Le jeu tourne en ce moment. */
  running: boolean;
  /** En cours de déplacement : l'icône flottante la remplace. */
  lifted: boolean;
  /** Animation de trajet entre deux cases (coupée pour l'icône qui vient d'être posée). */
  animateLayout: boolean;
  onSelect: (index: number) => void;
  onLaunch: (index: number) => void;
}

const spring = { type: "spring", stiffness: 520, damping: 32, mass: 0.7 } as const;
/** Prêt à jouer : l'icône se tasse puis bondit. */
const pop = { duration: 0.7, times: [0, 0.3, 0.65, 1], ease: "easeOut" as const };
/** Désinstallé : elle tremble le temps que les fissures courent. */
const shake = { duration: CRACK_S, ease: "linear" as const };

/** Icône de jeu. `layoutId` la fait glisser d'une case à l'autre quand on la déplace. */
export const GameTile = memo(function GameTile({ game, index, size, selected, lifted, animateLayout, download, ready, leaving, running, onSelect, onLaunch }: Props) {
  const ref = useRef<HTMLButtonElement>(null);
  /** Écran tactile (Steam Deck…) : toucher la tuile déjà sélectionnée lance le jeu, comme sur une console. */
  const touched = useRef(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [broken, setBroken] = useState(false);
  // Confettis et éclats partent de la tuile mais s'affichent hors d'elle : on relève où elle est.
  useLayoutEffect(() => setAnchor(ready || leaving ? (ref.current?.getBoundingClientRect() ?? null) : null), [ready, leaving]);
  useEffect(() => {
    if (!leaving) return setBroken(false);
    sound.crack();
    const timer = window.setTimeout(() => {
      setBroken(true);
      sound.shatter();
    }, CRACK_S * 1000);
    return () => clearTimeout(timer);
  }, [leaving]);
  const scale = selected ? 1.07 : 1;

  return (
    <>
      <motion.button
        ref={ref}
        layoutId={animateLayout ? `tile-${game.appid}` : undefined}
        // Retrouvée par la séquence de lancement, qui fait partir l'icône d'ici.
        data-appid={game.appid}
        type="button"
        transition={ready ? { ...spring, scale: pop } : leaving ? { ...spring, x: shake, rotate: shake } : spring}
        onMouseEnter={() => sound.hover()}
        onPointerDown={(e) => {
          touched.current = e.pointerType === "touch";
        }}
        onClick={() => (touched.current && selected ? onLaunch(index) : onSelect(index))}
        onDoubleClick={() => onLaunch(index)}
        initial={false}
        // Un jeu du catalogue s'affiche en retrait : il est là, mais pas jouable.
        animate={{
          opacity: lifted || broken ? 0 : game.installed || download || ready || leaving ? 1 : 0.45,
          scale: ready ? [scale, scale * 0.9, scale * 1.14, scale] : scale,
          y: selected ? -3 : 0,
          x: leaving ? [0, -4, 4, -5, 5, -3, 3, 0] : 0,
          rotate: leaving ? [0, -2, 2, -3, 3, -1, 1, 0] : 0,
        }}
        whileHover={{ scale: selected ? 1.1 : 1.08, y: -5 }}
        whileTap={{ scale: 0.92 }}
        aria-label={game.name}
        aria-pressed={selected}
        title={game.name}
        className={`shine absolute inset-0 cursor-pointer overflow-hidden rounded-tile bg-surface shadow-soft outline-none hover:shadow-pop ${
          selected ? "tile-selected z-10" : ""
        } ${ready ? "tile-ready" : ""}`}
        style={leaving ? { filter: "grayscale(0.7) brightness(0.9)", transition: "filter 0.3s" } : undefined}
      >
        <GameIcon game={game} size={size} />
        {/* Léger vernis brillant et fin liseré, façon icône de console. */}
        <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-linear-to-b from-white/25 to-transparent" />
        <span className="pointer-events-none absolute inset-0 rounded-tile ring-1 ring-inset ring-black/10" />
        {download && !leaving && <TileDownload download={download} size={size} />}
        {/* En cours : une pastille verte qui bat doucement, comme une console allumée. */}
        {running && !leaving && (
          <span className="pointer-events-none absolute left-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-[#22c55e] text-white shadow-soft ring-2 ring-white">
            <span className="absolute inset-0 animate-ping rounded-full bg-[#22c55e] opacity-40" />
            <PlayIcon width={11} height={11} className="relative translate-x-[1px]" />
          </span>
        )}
        {leaving && <Cracks />}
      </motion.button>
      {ready && anchor && <ConfettiAt anchor={anchor} seed={game.appid} size={size} count={14} delay={0.15} />}
      {broken && anchor && <Shatter game={game} anchor={anchor} />}
    </>
  );
});
