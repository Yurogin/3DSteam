import { useCallback, useEffect, useRef, useState } from "react";
import { loadCache, scanLibrary } from "../lib/api";
import type { CatalogGame, Game, InstalledGame, Library } from "../types";

/** Un jeu du disque : tout est connu, il est jouable tout de suite. */
const installed = (game: InstalledGame): Game => ({ ...game, installed: true });

/**
 * Un jeu du catalogue : seuls son numéro, son nom et sa dernière session sont connus. Les visuels
 * restent vides, `artSources` ira les chercher sur le CDN de Steam à partir du numéro.
 */
const fromCatalog = (game: CatalogGame): Game => ({
  ...game,
  installDir: "",
  libraryPath: "",
  sizeOnDisk: 0,
  lastUpdated: 0,
  art: { capsule: null, hero: null, logo: null, header: null },
  installed: false,
});

/**
 * 1. Affiche immédiatement `games_cache.json` (lecture Rust synchrone, quelques ms).
 * 2. Lance le scan Steam en arrière-plan et remplace la liste quand il termine.
 */
export function useLibrary() {
  const [games, setGames] = useState<Game[]>([]);
  const [catalog, setCatalog] = useState<Game[]>([]);
  const [scannedAt, setScannedAt] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const apply = useCallback((lib: Library) => {
    setGames(lib.games.map(installed));
    setCatalog((lib.catalog ?? []).map(fromCatalog));
    setScannedAt(lib.scannedAt);
  }, []);

  const rescan = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      const lib = await scanLibrary();
      if (!alive.current) return;
      apply(lib);
    } catch (e) {
      if (alive.current) setError(String(e));
    } finally {
      if (alive.current) {
        setScanning(false);
        setLoaded(true);
      }
    }
  }, [apply]);

  useEffect(() => {
    alive.current = true;
    loadCache()
      .then((cached) => {
        if (cached && alive.current) {
          apply(cached);
          setLoaded(true);
        }
      })
      .catch(() => {})
      .finally(() => void rescan());
    return () => {
      alive.current = false;
    };
  }, [rescan, apply]);

  return { games, catalog, scannedAt, loaded, scanning, error, rescan };
}
