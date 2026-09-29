/**
 * Agrandissement ×2 d'une petite icône, par le calcul plutôt que par interpolation.
 *
 * Trois familles, aux rendus volontairement différents :
 *
 * - **Scale2x** (AdvMAME2x) : recopie pure. Un escalier d'un pixel devient une diagonale, mais
 *   aucune couleur nouvelle n'apparaît jamais.
 * - **xBR** (2xBR-lv1) : détection de contour orientée. Elle compare les deux diagonales possibles
 *   et prolonge la plus probable ; comme Scale2x, elle ne choisit que parmi les couleurs voisines,
 *   d'où un rendu net.
 * - **HQx** : même détection de voisinage, mais les coins sont *mélangés* au lieu d'être recopiés,
 *   ce qui adoucit les contours. C'est la méthode de hq2x — voisinage comparé en YUV puis
 *   interpolation pondérée des coins — et non un portage à l'octet près de sa table d'origine.
 */

export type Upscaler = "scale2x" | "xbr" | "hqx";

/** Côté visé : on double tant qu'on est en dessous. */
const TARGET = 128;
/** Nombre maximal de doublements (×8), garde-fou sur les icônes minuscules. */
const MAX_STEPS = 3;

/* ─── Pixels ──────────────────────────────────────────────────────────────────────────── */

/** Un pixel tient dans un entier de 32 bits ; l'ordre des octets dépend de la machine. */
const LE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
const chan = (p: number, i: number) => (p >>> (LE ? i * 8 : 24 - i * 8)) & 255;
const pack = (r: number, g: number, b: number, a: number) =>
  (LE ? ((a << 24) | (b << 16) | (g << 8) | r) : ((r << 24) | (g << 16) | (b << 8) | a)) >>> 0;

/**
 * Écart entre deux pixels, pondéré comme dans hq2x : la luminance pèse bien plus que la chrominance,
 * parce que l'œil y est bien plus sensible. La transparence compte autant que la luminance, sans
 * quoi le pourtour d'une icône détourée passerait pour un aplat.
 */
function delta(p: number, q: number): number {
  const dr = chan(p, 0) - chan(q, 0);
  const dg = chan(p, 1) - chan(q, 1);
  const db = chan(p, 2) - chan(q, 2);
  const da = chan(p, 3) - chan(q, 3);
  const y = 0.299 * dr + 0.587 * dg + 0.114 * db;
  const u = -0.169 * dr - 0.331 * dg + 0.5 * db;
  const v = 0.5 * dr - 0.419 * dg - 0.081 * db;
  return Math.abs(y) * 48 + Math.abs(u) * 7 + Math.abs(v) * 6 + Math.abs(da) * 48;
}

/** Seuil au-delà duquel deux pixels sont tenus pour distincts (celui de hq2x). */
const THRESHOLD = 48 * 48;
const differ = (p: number, q: number) => delta(p, q) > THRESHOLD;

/**
 * Mélange deux pixels selon leurs poids. Les couleurs sont pré-multipliées par leur transparence
 * le temps du calcul : sans ça, mélanger un pixel opaque avec un pixel transparent (dont le RVB
 * est souvent noir) cernerait l'icône d'un liseré sombre.
 */
function mix(p: number, q: number, wp: number, wq: number): number {
  const ap = chan(p, 3);
  const aq = chan(q, 3);
  const total = wp + wq;
  const a = (ap * wp + aq * wq) / total;
  if (a === 0) return 0;
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    out[i] = Math.round((chan(p, i) * ap * wp + chan(q, i) * aq * wq) / total / a);
  }
  return pack(out[0], out[1], out[2], Math.round(a));
}

/* ─── Voisinage ───────────────────────────────────────────────────────────────────────── */

/** Fenêtre 5×5 autour d'un pixel ; hors cadre, le bord est prolongé. */
function patch(src: Uint32Array, w: number, h: number, x: number, y: number): number[][] {
  const rows: number[][] = [];
  for (let dy = -2; dy <= 2; dy++) {
    const row: number[] = [];
    const yy = Math.min(h - 1, Math.max(0, y + dy));
    for (let dx = -2; dx <= 2; dx++) {
      row.push(src[yy * w + Math.min(w - 1, Math.max(0, x + dx))]);
    }
    rows.push(row);
  }
  return rows;
}

/** Rotation d'un quart de tour dans le sens horaire : `(l, c)` va en `(c, 4 - l)`. */
const rotate = (p: number[][]): number[][] =>
  p.map((_, l) => p.map((_, c) => p[4 - c][l]));

/**
 * Applique une règle de coin aux quatre coins, en faisant tourner la fenêtre plutôt qu'en
 * réécrivant la règle quatre fois. Une rotation horaire amène le coin haut-droit en bas-droite,
 * d'où l'ordre de sortie ci-dessous.
 */
function corners(p: number[][], rule: (p: number[][]) => number): [number, number, number, number] {
  const q1 = rotate(p);
  const q2 = rotate(q1);
  const q3 = rotate(q2);
  return [rule(q2), rule(q1), rule(q3), rule(p)];
}

/* ─── Les trois règles ────────────────────────────────────────────────────────────────── */

/** Scale2x : le coin prend le voisin commun quand deux bords opposés diffèrent. */
function scale2xRule(p: number[][]): number {
  const e = p[2][2];
  const b = p[1][2];
  const d = p[2][1];
  const f = p[2][3];
  const h = p[3][2];
  // Coin bas-droite : il bascule si `H` et `F` sont d'accord entre eux et opposés à `B` / `D`.
  return b !== h && d !== f && h === f ? h : e;
}

/** xBR lv1 : des deux diagonales possibles, on prolonge celle qui coûte le moins. */
function xbrRule(p: number[][]): number {
  const e = p[2][2];
  const b = p[1][2];
  const d = p[2][1];
  const f = p[2][3];
  const h = p[3][2];
  const c = p[1][3];
  const g = p[3][1];
  const i = p[3][3];
  const f4 = p[2][4];
  const i4 = p[3][4];
  const h5 = p[4][2];
  const i5 = p[4][3];
  if (e === h || e === f) return e;
  const straight = delta(e, c) + delta(e, g) + delta(i, h5) + delta(i, f4) + 4 * delta(h, f);
  const diagonal = delta(h, d) + delta(h, i5) + delta(f, i4) + delta(f, b) + 4 * delta(e, i);
  if (straight >= diagonal) return e;
  return delta(e, f) <= delta(e, h) ? f : h;
}

/** HQx : même détection, mais le coin est adouci au lieu d'être recopié. */
function hqxRule(p: number[][]): number {
  const e = p[2][2];
  const f = p[2][3];
  const h = p[3][2];
  const i = p[3][3];
  // Coin bas-droite : `H` et `F` font contour face à `B` et `D`.
  if (!differ(e, h) || !differ(e, f) || differ(h, f)) return e;
  // Un coin franc (la diagonale suit) s'arrondit plus qu'un simple angle rentrant.
  return differ(e, i) ? mix(h, e, 3, 1) : mix(mix(h, f, 1, 1), e, 1, 1);
}

const RULES: Record<Upscaler, (p: number[][]) => number> = {
  scale2x: scale2xRule,
  xbr: xbrRule,
  hqx: hqxRule,
};

/** Double la taille d'une image avec l'algorithme demandé. */
export function double(src: ImageData, algo: Upscaler): ImageData {
  const { width: w, height: h } = src;
  const pixels = new Uint32Array(src.data.buffer, src.data.byteOffset, w * h);
  const width = w * 2;
  const out = new Uint32Array(width * h * 2);
  const rule = RULES[algo];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [tl, tr, bl, br] = corners(patch(pixels, w, h, x, y), rule);
      const at = y * 2 * width + x * 2;
      out[at] = tl;
      out[at + 1] = tr;
      out[at + width] = bl;
      out[at + width + 1] = br;
    }
  }
  return new ImageData(new Uint8ClampedArray(out.buffer), width, h * 2);
}

/* ─── Chaîne complète : image → data URL ──────────────────────────────────────────────── */

/** Une entrée par icône et par algorithme : le calcul n'a lieu qu'une fois par session. */
const cache = new Map<string, Promise<string | null>>();

/** Charge une image ; `crossOrigin` est nécessaire pour pouvoir ensuite relire le canevas. */
function load(src: string, crossOrigin: string | null): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = crossOrigin;
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function compute(src: string, algo: Upscaler): Promise<string | null> {
  // Le mode CORS d'abord : sans lui le canevas serait « teinté » et illisible. S'il échoue (la
  // source ne le propose pas), on retente sans — ce qui suffit quand elle est de même origine.
  const img = (await load(src, "anonymous")) ?? (await load(src, null));
  if (!img?.naturalWidth) return null;

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);

  let data: ImageData;
  try {
    data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    // Canevas teinté : la source refuse qu'on relise ses pixels. L'appelant retombe sur son repli.
    return null;
  }
  for (let step = 0; step < MAX_STEPS && data.width < TARGET; step++) data = double(data, algo);

  canvas.width = data.width;
  canvas.height = data.height;
  ctx.putImageData(data, 0, 0);
  return canvas.toDataURL("image/png");
}

/** Version agrandie d'une icône, en data URL, ou `null` si elle n'a pas pu être calculée. */
export function upscaled(src: string, algo: Upscaler): Promise<string | null> {
  const key = `${algo}|${src}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = compute(src, algo).catch(() => null);
    cache.set(key, pending);
  }
  return pending;
}
