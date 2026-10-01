import { useMemo } from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "framer-motion";
import { GameIcon } from "./GameIcon";
import { seeded } from "./Celebration";
import type { Game } from "../types";

/** Temps pendant lequel la tuile se fissure et tremble, avant de voler en éclats. */
export const CRACK_S = 0.45;
/** Durée totale de la destruction : au-delà, la case est vide. */
export const SHATTER_MS = 1700;

/** Sommets d'une grille 4 × 4 un peu tordue : les bords restent droits, l'intérieur se casse. */
function shards(seed: number) {
  const random = seeded(seed);
  const n = 3;
  const points = Array.from({ length: n + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => {
      const edge = (k: number) => k === 0 || k === n;
      const jitter = () => (random() - 0.5) * 18;
      return [(j * 100) / n + (edge(j) ? 0 : jitter()), (i * 100) / n + (edge(i) ? 0 : jitter())] as const;
    }),
  );
  // Chaque case se fend en deux triangles, dans un sens ou dans l'autre : du verre brisé.
  const list: (readonly (readonly [number, number])[])[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const [a, b, c, d] = [points[i][j], points[i][j + 1], points[i + 1][j + 1], points[i + 1][j]];
      if (random() > 0.5) list.push([a, b, c], [a, c, d]);
      else list.push([a, b, d], [b, c, d]);
    }
  }
  return list.map((poly) => {
    const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
    const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
    return {
      clip: `polygon(${poly.map(([x, y]) => `${x}% ${y}%`).join(", ")})`,
      cx,
      cy,
      spin: (random() - 0.5) * 360,
      hop: random(),
      push: 0.5 + random() * 0.7,
      duration: 0.85 + random() * 0.35,
    };
  });
}

/** Fissures tracées depuis le point d'impact, pendant que la tuile tremble. */
export function Cracks() {
  const lines = ["M50 48 L22 8", "M50 48 L88 20", "M50 48 L94 70", "M50 48 L62 96", "M50 48 L8 78", "M36 28 L14 34", "M72 60 L84 90", "M30 62 L44 90"];
  return (
    <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="none" aria-hidden>
      {lines.map((d, i) => (
        <motion.path
          key={i}
          d={d}
          fill="none"
          stroke="white"
          strokeWidth={i < 5 ? 2.2 : 1.4}
          strokeLinecap="round"
          style={{ filter: "drop-shadow(0 0 1.5px rgb(0 0 0 / 0.7))" }}
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.18, delay: i < 5 ? i * 0.03 : 0.16 + (i - 5) * 0.04, ease: "easeOut" }}
        />
      ))}
    </svg>
  );
}

/**
 * Les éclats de la tuile, rendus à la racine de la page au-dessus d'elle (`anchor`) : ils
 * s'écartent, sautent un peu, puis tombent en tournoyant. Un nuage de poussière reste derrière.
 */
export function Shatter({ game, anchor }: { game: Game; anchor: DOMRect }) {
  const reduce = useReducedMotion();
  const size = anchor.width;
  const pieces = useMemo(() => shards(game.appid), [game.appid]);
  const dust = useMemo(() => {
    const random = seeded(game.appid + 7);
    return Array.from({ length: 9 }, (_, i) => {
      const angle = (i / 9) * Math.PI * 2 + random() * 0.6;
      return { x: Math.cos(angle) * size * 0.55, y: Math.sin(angle) * size * 0.35 + size * 0.1, scale: 0.6 + random() * 0.8 };
    });
  }, [game.appid, size]);

  return createPortal(
    <div
      className="pointer-events-none fixed z-50"
      style={{ left: anchor.left, top: anchor.top, width: anchor.width, height: anchor.height }}
      aria-hidden
    >
      {!reduce &&
        dust.map((d, i) => (
          <motion.span
            key={`d${i}`}
            className="absolute left-1/2 top-1/2 rounded-full bg-[rgb(160_150_140/0.55)] blur-[2px]"
            style={{ width: size * 0.3, height: size * 0.3, marginLeft: -size * 0.15, marginTop: -size * 0.15 }}
            initial={{ x: 0, y: 0, scale: 0.2, opacity: 0 }}
            animate={{ x: d.x, y: d.y, scale: d.scale, opacity: [0, 0.9, 0] }}
            transition={{ duration: 0.9, ease: "easeOut" }}
          />
        ))}
      {pieces.map((p, i) => (
        <motion.div
          key={i}
          className="absolute inset-0 overflow-hidden rounded-tile"
          style={{ clipPath: p.clip, transformOrigin: `${p.cx}% ${p.cy}%` }}
          initial={{ x: 0, y: 0, rotate: 0, opacity: 1 }}
          animate={
            reduce
              ? { opacity: 0 }
              : {
                  x: ((p.cx - 50) / 50) * size * 0.45 * p.push,
                  y: [0, -size * (0.08 + p.hop * 0.18), size * (1.1 + p.hop * 0.5)],
                  rotate: p.spin,
                  opacity: [1, 1, 0],
                }
          }
          transition={
            reduce
              ? { duration: 0.4 }
              : {
                  duration: p.duration,
                  // Les éclats du bord partent un rien après ceux du centre, là où la tuile a cédé.
                  delay: (Math.hypot(p.cx - 50, p.cy - 50) / 70) * 0.08,
                  y: { duration: p.duration, times: [0, 0.22, 1], ease: ["easeOut", "easeIn"] },
                  opacity: { duration: p.duration, times: [0, 0.75, 1] },
                }
          }
        >
          <div className="absolute inset-0 bg-surface grayscale-[0.6]">
            <GameIcon game={game} size={size} />
          </div>
          {/* Tranche claire : chaque éclat accroche un peu la lumière. */}
          <span className="absolute inset-0 bg-linear-to-br from-white/30 to-transparent" />
        </motion.div>
      ))}
    </div>,
    document.body,
  );
}
