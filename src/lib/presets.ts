import { useCallback, useEffect, useState } from "react";
import { load, save } from "./storage";
import type { Board } from "./board";

/** Instantané nommé de la disposition : placement des jeux, dossiers et thème. */
export interface Preset {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Id du thème (voir themes.ts). */
  theme: string;
  board: Board;
}

const isPreset = (p: unknown): p is Preset =>
  !!p && typeof p === "object" && typeof (p as Preset).id === "string" && Array.isArray((p as Preset).board?.slots);

/** Liste des presets, sauvegardée dans le stockage local (la plus récente en premier). */
export function usePresets() {
  const [presets, setPresets] = useState<Preset[]>(() => load<unknown[]>("presets", []).filter(isPreset));

  useEffect(() => save("presets", presets), [presets]);

  const add = useCallback((name: string, theme: string, board: Board) => {
    const now = Date.now();
    const preset: Preset = { id: `p${now.toString(36)}`, name, createdAt: now, updatedAt: now, theme, board };
    setPresets((list) => [preset, ...list]);
    return preset;
  }, []);

  const overwrite = useCallback((id: string, theme: string, board: Board) => {
    setPresets((list) => list.map((p) => (p.id === id ? { ...p, theme, board, updatedAt: Date.now() } : p)));
  }, []);

  const rename = useCallback((id: string, name: string) => {
    setPresets((list) => list.map((p) => (p.id === id ? { ...p, name } : p)));
  }, []);

  const remove = useCallback((id: string) => {
    setPresets((list) => list.filter((p) => p.id !== id));
  }, []);

  return { presets, add, overwrite, rename, remove };
}
