import { useCallback, useEffect, useRef, useState } from "react";
import { runningGames } from "../lib/api";

/** Relecture de la liste : quelques Ko de journal et une poignée de processus à vérifier. */
const POLL_MS = 2500;

const same = (a: Set<number>, b: number[]) => a.size === b.length && b.every((id) => a.has(id));

/**
 * Jeux qui tournent en ce moment (voir `gamewatch.rs`) : on ne les relance pas, et on peut les
 * arrêter. `refresh` relit la liste tout de suite, après un lancement ou une demande d'arrêt.
 */
export function useRunning(): { running: Set<number>; refresh: () => void } {
  const [running, setRunning] = useState<Set<number>>(() => new Set());
  const latest = useRef(running);
  latest.current = running;

  const refresh = useCallback(() => {
    void runningGames()
      .then((list) => {
        if (!same(latest.current, list)) setRunning(new Set(list));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  return { running, refresh };
}
