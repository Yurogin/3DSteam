/**
 * Format de thème partageable (fichier `.3dstheme`, du JSON). Quelques réglages simples suffisent :
 * l'application en déduit toutes les variables CSS de l'interface (voir `themeVars`).
 *
 * {
 *   "format": 1,
 *   "id": "ocean",
 *   "name": "Océan",                       // ou { "fr": "Océan", "en": "Ocean" }
 *   "dark": false,
 *   "colors": { "background": "#e6f4f8", "background2": "#cfe8f0", "surface": "#ffffff",
 *               "text": "#1f3a44", "accent": "#0096c7" },
 *   "pattern": { "type": "dots", "color": "#0096c7", "opacity": 0.15, "size": 22 },
 *   "shape": { "tileRadius": 18, "panelRadius": 24, "panelStyle": "glass" },
 *   "image": "data:image/jpeg;base64,…"    // facultatif : image de fond
 * }
 */

import { contrast, hexToRgb, isHex, mix, rgba } from "./color";
import type { Lang } from "../lib/i18n";

export const PATTERNS = ["none", "dots", "stripes", "grid", "checker", "stars", "triangles", "lines", "scanlines", "snes"] as const;
export type PatternType = (typeof PATTERNS)[number];
export const PANEL_STYLES = ["solid", "glass", "border"] as const;
export type PanelStyle = (typeof PANEL_STYLES)[number];

export interface ThemeDef {
  format: 1;
  id: string;
  name: string | Partial<Record<Lang, string>>;
  dark: boolean;
  colors: { background: string; background2: string; surface: string; text: string; accent: string };
  pattern: { type: PatternType; color: string; opacity: number; size: number };
  shape: { tileRadius: number; panelRadius: number; panelStyle: PanelStyle };
  image?: string;
}

export const THEME_EXTENSION = ".3dstheme";

export function themeName(def: ThemeDef, lang: Lang): string {
  return typeof def.name === "string" ? def.name : (def.name[lang] ?? Object.values(def.name)[0] ?? "Thème");
}

export const slug = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "theme";

const clamp = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

/** Lit un thème (fichier importé, code collé…) en complétant ce qui manque ; `null` si inutilisable. */
export function parseTheme(input: unknown): ThemeDef | null {
  let raw: unknown = input;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<ThemeDef> & Record<string, unknown>;
  const c = (r.colors ?? {}) as Partial<ThemeDef["colors"]>;
  if (!isHex(c.background) || !isHex(c.text) || !isHex(c.accent)) return null;
  const dark = typeof r.dark === "boolean" ? r.dark : contrast(c.background, "#000000") < contrast(c.background, "#ffffff");
  const surface = isHex(c.surface) ? c.surface : mix(c.background, dark ? "#000000" : "#ffffff", 0.6);
  const p = (r.pattern ?? {}) as Partial<ThemeDef["pattern"]>;
  const s = (r.shape ?? {}) as Partial<ThemeDef["shape"]>;
  const name = typeof r.name === "string" || (r.name && typeof r.name === "object") ? r.name : "Thème";
  return {
    format: 1,
    id: typeof r.id === "string" && r.id ? slug(r.id) : slug(typeof name === "string" ? name : "theme"),
    name: name as ThemeDef["name"],
    dark,
    colors: {
      background: c.background,
      background2: isHex(c.background2) ? c.background2 : mix(c.background, dark ? "#000000" : c.accent, 0.12),
      surface,
      text: c.text,
      accent: c.accent,
    },
    pattern: {
      type: PATTERNS.includes(p.type as PatternType) ? (p.type as PatternType) : "none",
      color: isHex(p.color) ? p.color : c.accent,
      opacity: clamp(p.opacity, 0, 1, 0.15),
      size: clamp(p.size, 6, 96, 22),
    },
    shape: {
      tileRadius: clamp(s.tileRadius, 0, 40, 18),
      panelRadius: clamp(s.panelRadius, 0, 48, 24),
      panelStyle: PANEL_STYLES.includes(s.panelStyle as PanelStyle) ? (s.panelStyle as PanelStyle) : "solid",
    },
    image: typeof r.image === "string" && r.image.startsWith("data:image/") ? r.image : undefined,
  };
}

/** Texte du fichier partagé (l'image de fond incluse, s'il y en a une). */
export const serializeTheme = (def: ThemeDef) => JSON.stringify(def, null, 2);

const svg = (body: string, w: number, h: number) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>${body}</svg>`)}")`;

/** Calque CSS du motif de fond (image + taille). */
function patternLayer({ type, color, opacity, size: s }: ThemeDef["pattern"]): [string, string] | null {
  const c = rgba(color, opacity);
  const [r, g, b] = hexToRgb(color);
  const fill = `fill='rgb(${r},${g},${b})' fill-opacity='${opacity}'`;
  switch (type) {
    case "dots":
      return [`radial-gradient(${c} ${Math.max(1, s / 14)}px, transparent ${Math.max(1, s / 14)}px)`, `${s}px ${s}px`];
    case "stripes":
      return [`repeating-linear-gradient(135deg, ${c} 0 ${s / 2}px, transparent ${s / 2}px ${s}px)`, "auto"];
    case "lines":
      return [`repeating-linear-gradient(0deg, ${c} 0 2px, transparent 2px ${s}px)`, "auto"];
    case "scanlines":
      return [`repeating-linear-gradient(0deg, ${c} 0 1px, transparent 1px ${Math.max(3, s / 6)}px)`, "auto"];
    case "grid":
      return [`linear-gradient(${c} 1px, transparent 1px), linear-gradient(90deg, ${c} 1px, transparent 1px)`, `${s}px ${s}px, ${s}px ${s}px`];
    case "checker":
      return [`conic-gradient(${c} 25%, transparent 0 50%, ${c} 0 75%, transparent 0)`, `${s}px ${s}px`];
    case "stars":
      return [svg(`<path d='M12 4l2.4 5 5.4.6-4 3.7 1.1 5.3L12 16l-4.9 2.6 1.1-5.3-4-3.7 5.4-.6z' ${fill}/><circle cx='36' cy='34' r='2.2' ${fill}/>`, 48, 48), `${s * 2}px ${s * 2}px`];
    case "triangles":
      return [svg(`<path d='M28 10l6 10H22zM22 20l6 10H16zM34 20l6 10H28z' ${fill}/>`, 56, 48), `${s * 2.5}px ${s * 2.1}px`];
    case "snes": {
      // Les quatre boutons colorés de la Super Famicom, disposés en losange.
      const dot = (cx: number, cy: number, col: string) => `<circle cx='${cx}' cy='${cy}' r='3.2' fill='${col}' fill-opacity='${opacity}'/>`;
      return [svg(dot(24, 14, "#3b5fc9") + dot(14, 24, "#2e9e57") + dot(34, 24, "#d9322f") + dot(24, 34, "#f0b400"), 48, 48), `${s * 2.2}px ${s * 2.2}px`];
    }
    default:
      return null;
  }
}

/** Toutes les variables CSS de l'interface, calculées à partir du thème. */
export function themeVars(def: ThemeDef): Record<string, string> {
  const { background, background2, surface, text, accent } = def.colors;
  const { dark } = def;
  const onAccent = contrast(accent, "#ffffff") >= contrast(accent, "#101014") ? "#ffffff" : "#101014";
  const layers: string[] = [];
  const sizes: string[] = [];
  const pattern = patternLayer(def.pattern);
  if (pattern) {
    layers.push(pattern[0]);
    sizes.push(pattern[1]);
  }
  layers.push(`linear-gradient(170deg, ${background}, ${background2})`);
  sizes.push("100% 100%");
  if (def.image) {
    // L'image passe sous un voile de la couleur de fond, pour garder l'interface lisible.
    layers.splice(layers.length - 1, 1, `linear-gradient(${rgba(background, 0.45)}, ${rgba(background2, 0.65)})`, `url("${def.image}")`);
    sizes.splice(sizes.length - 1, 1, "100% 100%", "cover");
  }
  const style = def.shape.panelStyle;
  return {
    "--bg": background,
    "--bg-image": layers.join(", "),
    "--bg-size": sizes.join(", "),
    "--surface": style === "glass" ? rgba(surface, 0.82) : surface,
    "--surface-2": mix(surface, dark ? "#ffffff" : text, dark ? 0.06 : 0.05),
    "--panel": style === "glass" ? rgba(surface, 0.42) : rgba(surface, style === "border" ? 0.92 : 0.78),
    "--panel-border":
      style === "border" ? `2px solid ${mix(accent, text, 0.35)}` : style === "glass" ? `1px solid ${rgba("#ffffff", dark ? 0.1 : 0.55)}` : "0 solid transparent",
    "--panel-blur": style === "glass" ? "16px" : "6px",
    "--ink": text,
    "--muted": mix(text, background, 0.45),
    "--accent": accent,
    "--accent-strong": mix(accent, dark ? "#ffffff" : "#000000", 0.22),
    "--accent-soft": mix(accent, surface, dark ? 0.72 : 0.84),
    "--on-accent": onAccent,
    "--shadow-color": dark ? "rgb(0 0 0 / 0.45)" : rgba(mix(text, accent, 0.3), 0.2),
    "--tile-radius": `${def.shape.tileRadius}px`,
    "--panel-radius": `${def.shape.panelRadius}px`,
    "color-scheme": dark ? "dark" : "light",
  };
}

export const THEME_VAR_NAMES = Object.keys(themeVars(parseTheme({ colors: { background: "#ffffff", text: "#000000", accent: "#0000ff" } })!));

/** Mêmes variables sous forme d'objet `style` React (propriétés standard en camelCase). */
export function themeStyle(def: ThemeDef): Record<string, string> {
  const { "color-scheme": colorScheme, ...vars } = themeVars(def);
  return { ...vars, colorScheme };
}

/** Problèmes de lisibilité à signaler dans l'éditeur. */
export function readabilityIssues(def: ThemeDef): ("text" | "accent")[] {
  const issues: ("text" | "accent")[] = [];
  if (Math.min(contrast(def.colors.text, def.colors.background), contrast(def.colors.text, def.colors.surface)) < 4.5) issues.push("text");
  const vars = themeVars(def);
  if (contrast(def.colors.accent, vars["--on-accent"]) < 3) issues.push("accent");
  return issues;
}
