import { useEffect, useMemo, useState } from "react";
import { SHATTER_MS } from "../components/Shatter";
import type { Game } from "../types";

interface Departures {
  /** Jeux du plateau au relevé précédent. */
  games: Game[];
  /** Jeux partis, gardés le temps de leur destruction. */
  leaving: Map<number, Game>;
}

/**
 * Jeux qui quittent le plateau parce qu'on les a désinstallés (ou qu'on a annulé leur
 * installation) : on les garde le temps que leur tuile vole en éclats, puis la case se vide.
 *
 * Seuls les jeux de `watched` ont droit à ce sort : un jeu disparu pour une autre raison (retiré
 * hors de 3DSteam, scan au démarrage) s'en va sans bruit. Comme pour les arrivées, le passage est
 * calculé pendant le rendu : la tuile ne disparaît jamais avant d'avoir explosé.
 */
export function useDepartures(games: Game[], watched: ReadonlySet<number>) {
  const [state, setState] = useState<Departures>(() => ({ games, leaving: new Map() }));

  let current = state;
  if (state.games !== games) {
    const present = new Set(games.map((g) => g.appid));
    const gone = state.games.filter((g) => !present.has(g.appid) && watched.has(g.appid));
    // Réinstallé entre-temps : il reste là.
    const back = [...state.leaving.keys()].filter((appid) => present.has(appid));
    // La liste est relue à chaque relevé : on ne recrée les départs que s'ils changent, sinon le
    // minuteur qui les efface repartirait de zéro à chaque fois.
    let leaving = state.leaving;
    if (gone.length || back.length) {
      leaving = new Map(state.leaving);
      for (const game of gone) leaving.set(game.appid, game);
      for (const appid of back) leaving.delete(appid);
    }
    current = { games, leaving };
    setState(current);
  }

  useEffect(() => {
    if (!current.leaving.size) return;
    const ids = [...current.leaving.keys()];
    const timer = window.setTimeout(
      () => setState((s) => ({ ...s, leaving: new Map([...s.leaving].filter(([appid]) => !ids.includes(appid))) })),
      SHATTER_MS,
    );
    return () => clearTimeout(timer);
  }, [current.leaving]);

  const ghosts = useMemo(() => [...current.leaving.values()], [current.leaving]);
  const leaving = useMemo(() => new Set(current.leaving.keys()), [current.leaving]);
  return { ghosts, leaving };
}
