import { useEffect, useState } from "react";
import { batteryStatus, type Battery } from "../lib/api";

const REFRESH_MS = 30_000;

/** Niveau de batterie, rafraîchi toutes les 30 s et au retour sur la fenêtre. */
export function useBattery() {
  const [battery, setBattery] = useState<Battery | null>(null);
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      void batteryStatus()
        .then((b) => alive && setBattery(b))
        .catch(() => {});
    refresh();
    const timer = window.setInterval(refresh, REFRESH_MS);
    window.addEventListener("focus", refresh);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  return battery;
}
