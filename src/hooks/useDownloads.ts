import { useEffect, useRef, useState } from "react";
import { listDownloads } from "../lib/api";
import type { Download } from "../types";

/** Rythme d'interrogation : serré pendant un téléchargement, lâche le reste du temps. */
const BUSY_MS = 1200;
const IDLE_MS = 5000;

/**
 * Téléchargements Steam en cours, relus dans les manifestes.
 *
 * Steam n'a pas d'API : il tient ses compteurs à jour dans les `appmanifest_*.acf`, qu'on relit.
 * Quand un téléchargement disparaît de la liste, c'est qu'il est terminé — `onFinished` déclenche
 * alors un nouveau scan pour que le jeu passe de « non installé » à jouable.
 */
export function useDownloads(onFinished: () => void): Map<number, Download> {
  const [downloads, setDownloads] = useState<Map<number, Download>>(() => new Map());
  const finished = useRef(onFinished);
  finished.current = onFinished;

  useEffect(() => {
    let alive = true;
    let timer = 0;
    let busy = false;

    const tick = async () => {
      const list = await listDownloads().catch(() => [] as Download[]);
      if (!alive) return;
      setDownloads(new Map(list.map((d) => [d.appid, d])));
      if (busy && list.length === 0) finished.current();
      busy = list.length > 0;
      timer = window.setTimeout(() => void tick(), busy ? BUSY_MS : IDLE_MS);
    };

    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  return downloads;
}
