import { useEffect, useState } from "react";

const MIN_TILE = 44;
const MAX_TILE = 240;

/**
 * Taille des cases pour faire tenir exactement `rows` rangées dans la hauteur de la zone de grille
 * (comme le zoom de la 3DS), et nombre de colonnes visibles. Renvoie une ref-callback à poser sur
 * le conteneur.
 */
export function useGridMetrics(rows: number, labelHeight: number, gap: number) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [metrics, setMetrics] = useState({ tile: 104, columns: 1 });
  useEffect(() => {
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const fit = Math.floor((height - (rows - 1) * gap) / rows - labelHeight);
      const tile = Math.min(MAX_TILE, Math.max(MIN_TILE, fit));
      const columns = Math.max(1, Math.floor((width + gap) / (tile + gap)));
      setMetrics((m) => (m.tile === tile && m.columns === columns ? m : { tile, columns }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [el, rows, labelHeight, gap]);
  return [metrics, setEl] as const;
}
