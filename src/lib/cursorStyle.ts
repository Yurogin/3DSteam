/**
 * Style du curseur : comment se signale l'icône sélectionnée. L'identifiant est posé en attribut
 * `data-cursor` sur <html>, comme le thème ; le rendu lui-même vit dans `index.css`.
 */

import { useCallback, useEffect, useState } from "react";
import { load, save } from "./storage";

export const CURSOR_STYLES = ["soft", "glow", "ring", "lift", "none"] as const;
export type CursorStyle = (typeof CURSOR_STYLES)[number];
export const DEFAULT_CURSOR: CursorStyle = "soft";

/** `cursor` est déjà pris par la case sélectionnée : ce réglage se range ailleurs. */
const KEY = "cursorStyle";

const parse = (value: unknown): CursorStyle =>
  CURSOR_STYLES.includes(value as CursorStyle) ? (value as CursorStyle) : DEFAULT_CURSOR;

export function useCursorStyle() {
  const [style, setStyleState] = useState<CursorStyle>(() => parse(load<unknown>(KEY, DEFAULT_CURSOR)));

  useEffect(() => {
    document.documentElement.dataset.cursor = style;
  }, [style]);

  const setStyle = useCallback((next: CursorStyle) => {
    setStyleState(next);
    save(KEY, next);
  }, []);

  return { style, setStyle };
}
