import { useCallback, useEffect, useRef, useState } from "react";
import { loadCache, scanLibrary } from "../lib/api";
import type { Game } from "../types";

/**
 * 1. Affiche immédiatement `games_cache.json` (lecture Rust synchrone, quelques ms).
 * 2. Lance le scan Steam en arrière-plan et remplace la liste quand il termine.
 */
export function useLibrary() {
  const [games, setGames] = useState<Game[]>([]);
  const [scannedAt, setScannedAt] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const rescan = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      const lib = await scanLibrary();
      if (!alive.current) return;
      setGames(lib.games);
      setScannedAt(lib.scannedAt);
    } catch (e) {
      if (alive.current) setError(String(e));
    } finally {
      if (alive.current) {
        setScanning(false);
        setLoaded(true);
      }
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    loadCache()
      .then((cached) => {
        if (cached && alive.current) {
          setGames(cached.games);
          setScannedAt(cached.scannedAt);
          setLoaded(true);
        }
      })
      .catch(() => {})
      .finally(() => void rescan());
    return () => {
      alive.current = false;
    };
  }, [rescan]);

  return { games, scannedAt, loaded, scanning, error, rescan };
}
