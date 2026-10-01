import { useEffect, useState } from "react";

const MIN_TILE = 44;
const MAX_TILE = 240;
/** En dessous, une icône devient difficile à lire (écran du Steam Deck à 150 %) : on retire des rangées. */
const MIN_COMFORT_TILE = 64;
/** Rangées toujours permises, même sur un tout petit écran. */
const SMALL_SCREEN_ROWS = 2;

/**
 * Taille des cases pour faire tenir exactement `rows` rangées dans la hauteur de la zone de grille
 * (comme le zoom d'une console portable), et nombre de colonnes visibles. `maxRows` est le plus
 * grand nombre de rangées qui garde des icônes lisibles dans cette hauteur (jamais moins de 2) :
 * les rangées demandées au-delà sont ramenées à `maxRows`, sans toucher à la préférence enregistrée.
 * Le nom sous l'icône (`labelHeight`) n'est affiché qu'à 1 ou 2 rangées. Renvoie une ref-callback
 * à poser sur le conteneur.
 */
export function useGridMetrics(requestedRows: number, limitRows: number, labelHeight: number, gap: number) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [metrics, setMetrics] = useState({ tile: 104, columns: 1, rows: requestedRows, maxRows: limitRows });
  useEffect(() => {
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const fit = (r: number) => Math.floor((height - (r - 1) * gap) / r - (r <= 2 ? labelHeight : 0));
      let maxRows = limitRows;
      while (maxRows > SMALL_SCREEN_ROWS && fit(maxRows) < MIN_COMFORT_TILE) maxRows--;
      const rows = Math.min(requestedRows, maxRows);
      const tile = Math.min(MAX_TILE, Math.max(MIN_TILE, fit(rows)));
      const columns = Math.max(1, Math.floor((width + gap) / (tile + gap)));
      setMetrics((m) =>
        m.tile === tile && m.columns === columns && m.rows === rows && m.maxRows === maxRows
          ? m
          : { tile, columns, rows, maxRows },
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [el, requestedRows, limitRows, labelHeight, gap]);
  return [metrics, setEl] as const;
}
