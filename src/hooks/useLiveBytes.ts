import { useEffect, useRef, useState } from "react";
import type { Download } from "../types";

/** Au-delà du dernier relevé, l'affichage ne prolonge pas plus loin que ça au débit mesuré. */
const MAX_AHEAD_S = 2;
/** Constante de temps de l'amorti, en secondes. */
const EASE_S = 0.35;
/** Rythme de rafraîchissement de l'affichage. */
const FRAME_MS = 50;
/** Un recul plus grand que cette part du total est une vraie correction, pas du bruit. */
const SETBACK = 0.02;

/**
 * Octets téléchargés, affichés en continu. Un relevé arrive toutes les 800 ms environ, et Steam
 * écrit par salves : entre deux relevés, on prolonge au débit mesuré, amorti, sans jamais
 * reculer — sauf vraie correction, comme à la reprise après une pause, où Steam revient au
 * dernier morceau vérifié.
 */
export function useLiveBytes(download: Download): number {
  const { bytesDownloaded, bytesToDownload, rate, phase } = download;
  const [shown, setShown] = useState(bytesDownloaded);
  const active = phase === "downloading";
  const sample = useRef({ bytes: bytesDownloaded, rate: 0, at: performance.now() });

  useEffect(() => {
    sample.current = { bytes: bytesDownloaded, rate: active ? rate : 0, at: performance.now() };
  }, [bytesDownloaded, rate, active]);

  useEffect(() => {
    let last = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      const s = sample.current;
      const ahead = s.rate * Math.min(MAX_AHEAD_S, (now - s.at) / 1000);
      const target = Math.min(bytesToDownload, s.bytes + ahead);
      setShown((prev) => {
        if (target < prev - SETBACK * bytesToDownload) return target;
        if (target <= prev) return prev;
        const next = prev + (target - prev) * (1 - Math.exp(-dt / EASE_S));
        return target - next < 1024 ? target : next;
      });
    }, FRAME_MS);
    return () => clearInterval(timer);
  }, [bytesToDownload]);

  return shown;
}
