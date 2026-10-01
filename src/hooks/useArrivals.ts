import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Download, Game } from "../types";

/** Durée de la fête quand un jeu devient jouable. */
export const READY_MS = 2600;

/** Un jeu inconnu du catalogue (tout juste acheté) : son nom suffit, les visuels viennent du CDN. */
const fromDownload = (d: Download): Game => ({
  appid: d.appid,
  name: d.name,
  installDir: "",
  libraryPath: "",
  sizeOnDisk: d.bytesToDownload,
  lastPlayed: 0,
  lastUpdated: 0,
  playtime: 0,
  art: { capsule: null, hero: null, logo: null, header: null },
  installed: false,
});

interface Waiting {
  /** Dernier état connu, figé « installation » à 100 %. */
  download: Download;
  /** Moment de la disparition, en secondes : seul un scan postérieur tranche. */
  since: number;
}

interface Arrivals {
  /** Relevés sur lesquels l'état ci-dessous a été calculé. */
  downloads: Map<number, Download>;
  installed: Set<number>;
  scannedAt: number | null;
  /** Téléchargements de jeux pas encore installés, au dernier relevé. */
  live: Map<number, Download>;
  waiting: Map<number, Waiting>;
  ready: Set<number>;
}

/**
 * Jeux en cours d'installation : ils prennent place sur le plateau dès le début de leur
 * téléchargement, comme sur une boutique de console, et la fête commence quand ils deviennent jouables.
 *
 * Quand un téléchargement disparaît de la liste, rien ne dit encore s'il est fini ou annulé : le
 * jeu reste à 100 % jusqu'au scan suivant, qui tranche. Jouable, c'est la fête ; toujours absent
 * du disque, il quitte le plateau.
 *
 * Ces passages sont calculés pendant le rendu, pas dans un effet : sinon, le temps d'un rendu, le
 * jeu quitterait le plateau, ou apparaîtrait installé avant que la fête ne commence.
 */
export function useArrivals(
  games: Game[],
  catalog: Game[],
  liveDownloads: Map<number, Download>,
  scannedAt: number | null,
  /** Bibliothèque chargée : avant, tout jeu qui télécharge passerait pour une installation. */
  loaded: boolean,
  onArrived: (game: Game) => void,
  onReady: (game: Game) => void,
) {
  const downloads = loaded ? liveDownloads : NONE;
  const installed = useMemo(() => new Set(games.map((g) => g.appid)), [games]);
  const [state, setState] = useState<Arrivals>(() => ({
    downloads,
    installed,
    scannedAt,
    live: liveOf(downloads, installed),
    waiting: new Map(),
    ready: new Set(),
  }));

  let current = state;
  if (state.downloads !== downloads || state.installed !== installed || state.scannedAt !== scannedAt) {
    current = advance(state, downloads, installed, scannedAt);
    setState(current);
  }

  const byCatalog = useMemo(() => new Map(catalog.map((g) => [g.appid, g])), [catalog]);
  const gameOf = useCallback((d: Download) => byCatalog.get(d.appid) ?? fromDownload(d), [byCatalog]);
  const callbacks = useRef({ onArrived, onReady });
  callbacks.current = { onArrived, onReady };

  // Effets de bord (sons, messages) une fois l'état posé. Le premier relevé ne fait pas de bruit :
  // les jeux déjà en route n'arrivent pas, ils étaient là.
  const seen = useRef<{ live: Set<number>; ready: Set<number> } | null>(null);
  useEffect(() => {
    const before = seen.current;
    seen.current = { live: new Set(current.live.keys()), ready: new Set(current.ready) };
    if (!before) return;
    for (const [appid, d] of current.live) if (!before.live.has(appid)) callbacks.current.onArrived(gameOf(d));
    for (const appid of current.ready) {
      if (before.ready.has(appid)) continue;
      const game = games.find((g) => g.appid === appid);
      if (game) callbacks.current.onReady(game);
    }
  }, [current, games, gameOf]);

  // La fête finie, le jeu redevient un jeu comme les autres.
  useEffect(() => {
    if (!current.ready.size) return;
    const timer = window.setTimeout(() => setState((s) => ({ ...s, ready: new Set() })), READY_MS);
    return () => clearTimeout(timer);
  }, [current.ready]);

  /** Jeux à poser sur le plateau en plus des jeux installés. */
  const arriving = useMemo(() => {
    const list = [...current.live.values()].map(gameOf);
    for (const [appid, { download }] of current.waiting) if (!current.live.has(appid)) list.push(gameOf(download));
    return list;
  }, [current.live, current.waiting, gameOf]);

  /** Téléchargements à afficher : les vrais, plus ceux qui attendent le verdict du scan. */
  const shownDownloads = useMemo(() => {
    if (!current.waiting.size) return liveDownloads;
    const all = new Map(liveDownloads);
    for (const [appid, w] of current.waiting) if (!all.has(appid)) all.set(appid, w.download);
    return all;
  }, [liveDownloads, current.waiting]);

  return { arriving, downloads: shownDownloads, ready: current.ready };
}

const NONE = new Map<number, Download>();

function liveOf(downloads: Map<number, Download>, installed: Set<number>) {
  return new Map([...downloads].filter(([appid]) => !installed.has(appid)));
}

/** Nouvel état, à partir des nouveaux relevés. */
function advance(prev: Arrivals, downloads: Map<number, Download>, installed: Set<number>, scannedAt: number | null): Arrivals {
  const live = liveOf(downloads, installed);
  const waiting = new Map(prev.waiting);
  let ready = prev.ready;
  const since = Math.floor(Date.now() / 1000);

  for (const [appid, d] of prev.live) {
    // Toujours en route, ou déjà installé (une mise à jour qu'on avait prise pour une installation) :
    // rien à fêter. Seul un téléchargement terminé, puis confirmé par le scan, l'est.
    if (live.has(appid) || installed.has(appid) || downloads.has(appid)) continue;
    waiting.set(appid, { download: { ...d, bytesDownloaded: d.bytesToDownload, rate: 0, phase: "installing" }, since });
  }
  for (const [appid, w] of waiting) {
    if (installed.has(appid)) {
      waiting.delete(appid);
      ready = new Set([...ready, appid]);
    } else if (live.has(appid) || (scannedAt != null && scannedAt >= w.since && scannedAt !== prev.scannedAt)) {
      // Reparti (reprise), ou un scan postérieur ne l'a pas trouvé : téléchargement annulé.
      waiting.delete(appid);
    }
  }
  return { downloads, installed, scannedAt, live, waiting, ready };
}
