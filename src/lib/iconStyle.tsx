/**
 * Rendu des icônes trop petites pour leur case. Plus de la moitié des icônes de Steam ne
 * dépassent pas 32 px : il n'y a pas de bonne réponse unique, c'est un goût. D'où ce réglage.
 *
 * Contexte plutôt que propriétés : `<GameIcon>` est utilisé loin dans l'arbre (tuiles, aperçus de
 * dossier, icône soulevée), et le faire descendre partout n'apporterait rien.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { load, save } from "./storage";

export const ICON_STYLES = ["plate", "fill", "smooth", "scale2x", "xbr", "hqx", "capsule"] as const;
export type IconStyle = (typeof ICON_STYLES)[number];
export const DEFAULT_ICON_STYLE: IconStyle = "plate";

const KEY = "iconStyle";

interface IconStyleApi {
  style: IconStyle;
  setStyle: (style: IconStyle) => void;
}

const IconStyleContext = createContext<IconStyleApi | null>(null);

export function IconStyleProvider({ children }: { children: ReactNode }) {
  const [style, setStyleState] = useState<IconStyle>(() => {
    const stored = load<unknown>(KEY, DEFAULT_ICON_STYLE);
    return ICON_STYLES.includes(stored as IconStyle) ? (stored as IconStyle) : DEFAULT_ICON_STYLE;
  });

  const setStyle = useCallback((next: IconStyle) => {
    setStyleState(next);
    save(KEY, next);
  }, []);

  const value = useMemo(() => ({ style, setStyle }), [style, setStyle]);
  return <IconStyleContext.Provider value={value}>{children}</IconStyleContext.Provider>;
}

export function useIconStyle(): IconStyleApi {
  const ctx = useContext(IconStyleContext);
  if (!ctx) throw new Error("useIconStyle doit être utilisé sous <IconStyleProvider>");
  return ctx;
}
