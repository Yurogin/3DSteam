import { useCallback, useEffect, useMemo, useState } from "react";
import { load, save } from "../lib/storage";
import { listThemeFiles } from "../lib/api";
import type { Lang } from "../lib/i18n";
import { parseTheme, THEME_VAR_NAMES, themeName, themeVars, type ThemeDef } from "./format";
import sixteenBitRaw from "./builtin/seize-bits.3dstheme?raw";

/**
 * Un thème de la liste. Trois origines :
 * - `builtin` : fournis avec l'application (en CSS dans themes.css, ou au format `.3dstheme`) ;
 * - `user` : créés ou importés dans l'éditeur (stockage local) ;
 * - `folder` : fichiers déposés dans le dossier des thèmes.
 */
export interface ThemeEntry {
  id: string;
  source: "builtin" | "user" | "folder";
  dark: boolean;
  /** Thème CSS historique (`[data-theme="…"]`), sinon `def` est appliqué en variables. */
  css?: string;
  def?: ThemeDef;
  /** Point de départ proposé quand on duplique ce thème dans l'éditeur. */
  seed: ThemeDef;
  label: (lang: Lang) => string;
  fileName?: string;
}

const seed = (
  id: string,
  dark: boolean,
  [background, background2, surface, text, accent]: string[],
  pattern: [ThemeDef["pattern"]["type"], string, number, number] | null,
  [tileRadius, panelRadius, panelStyle]: [number, number, ThemeDef["shape"]["panelStyle"]] = [18, 24, "solid"],
): ThemeDef => ({
  format: 1,
  id,
  name: id,
  dark,
  colors: { background, background2, surface, text, accent },
  pattern: pattern ? { type: pattern[0], color: pattern[1], opacity: pattern[2], size: pattern[3] } : { type: "none", color: accent, opacity: 0.15, size: 22 },
  shape: { tileRadius, panelRadius, panelStyle },
});

/** Thèmes CSS d'origine, avec leur équivalent approché au format partageable (pour les dupliquer). */
const CSS_THEMES: { id: string; dark: boolean; label: Record<Lang, string>; seed: ThemeDef }[] = [
  { id: "sky", dark: false, label: { fr: "Bleu ciel", en: "Sky Blue" }, seed: seed("bleu-ciel", false, ["#f3f6fa", "#e4edf7", "#ffffff", "#2b3440", "#1e88e5"], ["dots", "#7d9cc2", 0.35, 22]) },
  { id: "frost", dark: false, label: { fr: "Givre", en: "Frost" }, seed: seed("givre", false, ["#f7fbfd", "#e3f3f9", "#ffffff", "#34444e", "#00a3d9"], ["grid", "#00a3d9", 0.09, 28], [22, 30, "solid"]) },
  { id: "cherry", dark: false, label: { fr: "Rouge cerise", en: "Cherry Red" }, seed: seed("rouge-cerise", false, ["#fff7f7", "#ffdfe1", "#ffffff", "#3a2c2c", "#e60012"], ["stripes", "#e60012", 0.05, 28]) },
  { id: "lemon", dark: false, label: { fr: "Jaune citron", en: "Lemon Yellow" }, seed: seed("jaune-citron", false, ["#fff4bf", "#ffd84f", "#fffdf2", "#3b3120", "#e0a800"], ["stripes", "#ffffff", 0.28, 36]) },
  { id: "candy", dark: false, label: { fr: "Rose bonbon", en: "Candy Pink" }, seed: seed("rose-bonbon", false, ["#fff0f6", "#ffc9df", "#fff8fb", "#4a2e3b", "#ff5fa2"], ["stars", "#ffffff", 0.55, 24], [24, 32, "solid"]) },
  { id: "forest", dark: false, label: { fr: "Forêt enchantée", en: "Enchanted Forest" }, seed: seed("foret-enchantee", false, ["#f1f6e6", "#d3e2b6", "#fbfcf4", "#2b3a25", "#2e7d4f"], ["triangles", "#b8962e", 0.14, 22], [14, 24, "border"]) },
  { id: "retro", dark: false, label: { fr: "Rétro crème", en: "Retro Cream" }, seed: seed("retro-creme", false, ["#f7efdc", "#e6d6b3", "#fffaf0", "#3d2a1e", "#a4282b"], ["lines", "#a4282b", 0.07, 16], [10, 14, "border"]) },
  { id: "sunset", dark: false, label: { fr: "Coucher de soleil", en: "Sunset" }, seed: seed("coucher-de-soleil", false, ["#ffd29b", "#9a6ad6", "#ffffff", "#3a2346", "#ff4f73"], null, [18, 24, "glass"]) },
  { id: "pocket", dark: false, label: { fr: "Écran de poche", en: "Pocket Screen" }, seed: seed("ecran-de-poche", false, ["#cadc9f", "#b4c887", "#d6e4ad", "#0f380f", "#306230"], ["checker", "#0f380f", 0.06, 16], [6, 10, "border"]) },
  { id: "night", dark: true, label: { fr: "Nuit douce", en: "Soft Night" }, seed: seed("nuit-douce", true, ["#1f2435", "#141724", "#272c3e", "#e7eaf3", "#8ab4ff"], ["dots", "#3a4260", 1, 22]) },
  { id: "neon", dark: true, label: { fr: "Néon", en: "Neon" }, seed: seed("neon", true, ["#26272b", "#1b1c1f", "#33353b", "#f2f2f4", "#ff3c28"], ["dots", "#ffffff", 0.06, 20]) },
  { id: "indigo", dark: true, label: { fr: "Indigo", en: "Indigo" }, seed: seed("indigo", true, ["#3b3783", "#1f1c52", "#433e96", "#f1efff", "#b9a8ff"], ["grid", "#ffffff", 0.05, 32], [16, 24, "solid"]) },
  { id: "scarlet", dark: true, label: { fr: "Écarlate", en: "Scarlet" }, seed: seed("ecarlate", true, ["#1c0202", "#000000", "#1c0404", "#ff4040", "#ff1f1f"], ["scanlines", "#ff1414", 0.07, 24], [8, 12, "border"]) },
];

/** Thèmes livrés directement au format `.3dstheme` (ils servent aussi d'exemples). */
const BUILTIN_DEFS: ThemeDef[] = [sixteenBitRaw].map((raw) => parseTheme(raw)).filter((d): d is ThemeDef => d != null);

export const DEFAULT_THEME = "sky";

const defId = (def: ThemeDef) => `def:${def.id}`;

const cssEntries: ThemeEntry[] = CSS_THEMES.map((t) => ({
  id: t.id,
  source: "builtin",
  dark: t.dark,
  css: t.id,
  seed: { ...t.seed, name: t.label },
  label: (lang) => t.label[lang],
}));

const defEntry = (def: ThemeDef, source: ThemeEntry["source"], fileName?: string): ThemeEntry => ({
  id: defId(def),
  source,
  dark: def.dark,
  def,
  seed: def,
  label: (lang) => themeName(def, lang),
  fileName,
});

/** Applique un thème à la page : attribut `data-theme` (CSS) ou variables en ligne (format). */
function applyToDocument(entry: ThemeEntry, preview: ThemeDef | null) {
  const root = document.documentElement;
  THEME_VAR_NAMES.forEach((name) => root.style.removeProperty(name));
  const def = preview ?? entry.def;
  if (def) {
    root.dataset.theme = "custom";
    Object.entries(themeVars(def)).forEach(([name, value]) => root.style.setProperty(name, value));
  } else {
    root.dataset.theme = entry.css ?? DEFAULT_THEME;
  }
}

export function useTheme() {
  const [themeId, setThemeId] = useState<string>(() => load<string>("theme", DEFAULT_THEME));
  const [userThemes, setUserThemes] = useState<ThemeDef[]>(() =>
    load<unknown[]>("customThemes", []).map((d) => parseTheme(d)).filter((d): d is ThemeDef => d != null),
  );
  const [folderThemes, setFolderThemes] = useState<{ def: ThemeDef; fileName: string }[]>([]);
  /** Thème en cours d'édition, appliqué en direct à toute l'interface. */
  const [preview, setPreview] = useState<ThemeDef | null>(null);

  const reloadFolder = useCallback(async () => {
    const files = await listThemeFiles().catch(() => []);
    setFolderThemes(files.flatMap((f) => {
      const def = parseTheme(f.content);
      return def ? [{ def, fileName: f.fileName }] : [];
    }));
  }, []);
  useEffect(() => void reloadFolder(), [reloadFolder]);

  useEffect(() => save("customThemes", userThemes), [userThemes]);

  const entries = useMemo(() => {
    const list: ThemeEntry[] = [...cssEntries, ...BUILTIN_DEFS.map((d) => defEntry(d, "builtin"))];
    const seen = new Set(list.map((e) => e.id));
    for (const def of userThemes) if (!seen.has(defId(def))) (seen.add(defId(def)), list.push(defEntry(def, "user")));
    for (const { def, fileName } of folderThemes) if (!seen.has(defId(def))) (seen.add(defId(def)), list.push(defEntry(def, "folder", fileName)));
    return list;
  }, [userThemes, folderThemes]);

  // Un thème du dossier peut ne pas être encore chargé : on garde l'id voulu, avec un repli.
  const current = entries.find((e) => e.id === themeId) ?? entries[0];

  useEffect(() => applyToDocument(current, preview), [current, preview]);

  const setTheme = useCallback((id: string) => {
    setThemeId(id);
    save("theme", id);
  }, []);

  const cycle = useCallback(() => {
    const index = entries.findIndex((e) => e.id === current.id);
    setTheme(entries[(index + 1) % entries.length].id);
  }, [entries, current.id, setTheme]);

  /** Crée ou met à jour un thème perso, puis l'applique. */
  const saveUserTheme = useCallback(
    (def: ThemeDef) => {
      setUserThemes((list) => [...list.filter((d) => d.id !== def.id), def]);
      setTheme(defId(def));
    },
    [setTheme],
  );

  const deleteUserTheme = useCallback(
    (id: string) => {
      setUserThemes((list) => list.filter((d) => defId(d) !== id));
      if (themeId === id) setTheme(DEFAULT_THEME);
    },
    [themeId, setTheme],
  );

  /** Id libre pour un nouveau thème (sans écraser un thème existant). */
  const freeId = useCallback(
    (base: string) => {
      const taken = new Set(entries.map((e) => e.def?.id).filter(Boolean));
      let id = base;
      for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
      return id;
    },
    [entries],
  );

  return { theme: current.id, current, entries, setTheme, cycle, saveUserTheme, deleteUserTheme, freeId, preview, setPreview, reloadFolder };
}

export type ThemeApi = ReturnType<typeof useTheme>;
