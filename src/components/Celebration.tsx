import { useMemo } from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "framer-motion";

/** Couleurs des confettis : acidulées, lisibles sur tous les thèmes. */
const COLORS = ["#ff5d8f", "#ffd166", "#2fc6a4", "#4cc9f0", "#b388ff", "#ff9f43"];

/** Aléatoire reproductible : une même fête retombe toujours de la même façon. */
export function seeded(seed: number) {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

interface Props {
  seed: number;
  /** Échelle de la gerbe, en pixels : la distance parcourue et la taille des pièces en dépendent. */
  size: number;
  count?: number;
  delay?: number;
}

/**
 * Gerbe de confettis qui jaillit du centre de son parent (positionné), puis retombe en
 * tournoyant. Rien si l'utilisateur a demandé moins d'animations.
 */
export function Confetti({ seed, size, count = 22, delay = 0 }: Props) {
  const reduce = useReducedMotion();
  const pieces = useMemo(() => {
    const random = seeded(seed);
    return Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * Math.PI * 2 + random() * 0.5;
      const distance = size * (0.5 + random() * 0.6);
      const shape = i % 3;
      return {
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance * 0.8,
        color: COLORS[i % COLORS.length],
        width: shape === 0 ? size * 0.045 : size * 0.07,
        height: shape === 0 ? size * 0.09 : size * 0.07,
        round: shape === 1,
        star: shape === 2,
        spin: (random() - 0.5) * 900,
        duration: 1 + random() * 0.6,
        wait: random() * 0.12,
      };
    });
  }, [seed, size, count]);
  if (reduce) return null;

  return (
    <span className="pointer-events-none absolute inset-0 overflow-visible" aria-hidden>
      {pieces.map((p, i) => (
        <motion.span
          key={i}
          className="absolute left-1/2 top-1/2"
          style={{
            width: p.width,
            height: p.height,
            marginLeft: -p.width / 2,
            marginTop: -p.height / 2,
            background: p.star ? undefined : p.color,
            borderRadius: p.round ? "50%" : 2,
          }}
          initial={{ x: 0, y: 0, opacity: 0, scale: 0.3, rotate: 0 }}
          // Jaillit en arc, puis retombe en tournoyant.
          animate={{
            x: [0, p.x * 0.6, p.x * 0.9, p.x],
            y: [0, p.y * 0.6 - size * 0.2, p.y * 0.9, p.y + size * 0.5],
            opacity: [0, 1, 1, 0],
            scale: [0.3, 1.1, 1, 0.8],
            rotate: [0, p.spin * 0.4, p.spin * 0.75, p.spin],
          }}
          transition={{ duration: p.duration, delay: delay + p.wait, ease: "easeOut", times: [0, 0.25, 0.65, 1] }}
        >
          {p.star && (
            <svg viewBox="0 0 24 24" className="h-full w-full" aria-hidden>
              <path d="M12 1l3.2 6.9 7.3.8-5.4 5 1.5 7.3L12 17.3 5.4 21l1.5-7.3-5.4-5 7.3-.8Z" fill={p.color} />
            </svg>
          )}
        </motion.span>
      ))}
    </span>
  );
}

/** Même gerbe, rendue à la racine de la page au-dessus de `anchor` : elle déborde de la tuile. */
export function ConfettiAt({ anchor, ...props }: Props & { anchor: DOMRect }) {
  return createPortal(
    <div className="pointer-events-none fixed z-50" style={{ left: anchor.left, top: anchor.top, width: anchor.width, height: anchor.height }}>
      <Confetti {...props} />
    </div>,
    document.body,
  );
}
