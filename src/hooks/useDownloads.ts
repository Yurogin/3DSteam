import { useEffect, useRef, useState } from "react";
import { listDownloads } from "../lib/api";
import type { Download } from "../types";

/** Rythme d'interrogation : serré pendant un téléchargement, lâche le reste du temps. */
const BUSY_MS = 800;
const IDLE_MS = 5000;

/**
 * Téléchargements Steam en cours, avec leur progression en direct (voir `progress.rs`).
 *
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
    let previous = new Set<number>();

    const tick = async () => {
      const list = await listDownloads().catch(() => [] as Download[]);
      if (!alive) return;
      setDownloads(new Map(list.map((d) => [d.appid, d])));
      // Chaque téléchargement qui s'achève compte, même si d'autres restent en file.
      const current = new Set(list.map((d) => d.appid));
      if ([...previous].some((appid) => !current.has(appid))) finished.current();
      previous = current;
      timer = window.setTimeout(() => void tick(), list.length > 0 ? BUSY_MS : IDLE_MS);
    };

    void tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  return downloads;
}
