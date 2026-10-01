import type { ReactNode } from "react";

/**
 * Catalogue de la Svgii Plaza : accessoires à porter, nourriture et fonds de la Place. Tout est
 * dessiné ici en SVG, sans aucune image.
 *
 * Un accessoire est un calque `<g id="item-…">` posé sur le Svgii par `Mascot.tsx`, dans l'un de
 * trois emplacements (`hat`, `eyewear`, `aura`). Il se cale sur la tête qu'il habille grâce au
 * contexte `WearContext` (sommet et demi-largeur de la tête, position des yeux) : un même chapeau
 * va à toutes les formes de tête. Ajouter un objet : une entrée dans `ITEMS`, un dessin dans
 * `WEAR` (ou `FOOD_ICONS` / `BACKDROPS`), et son nom dans `i18n.tsx` (`item_<id>`).
 */

export type Slot = "hat" | "eyewear" | "aura";
export const SLOTS: Slot[] = ["hat", "eyewear", "aura"];
/** Ce que porte un Svgii : un objet par emplacement. */
export type Equip = Partial<Record<Slot, string>>;

export type Item =
  | { id: string; kind: "wear"; slot: Slot; price: number }
  | { id: string; kind: "food"; price: number; fullness: number; joy: number }
  | { id: string; kind: "backdrop"; price: number };

export const ITEMS: Item[] = [
  { id: "partyhat", kind: "wear", slot: "hat", price: 60 },
  { id: "beanie", kind: "wear", slot: "hat", price: 80 },
  { id: "beret", kind: "wear", slot: "hat", price: 90 },
  { id: "chef", kind: "wear", slot: "hat", price: 110 },
  { id: "tophat", kind: "wear", slot: "hat", price: 140 },
  { id: "wizard", kind: "wear", slot: "hat", price: 220 },
  { id: "shades", kind: "wear", slot: "eyewear", price: 70 },
  { id: "heartglasses", kind: "wear", slot: "eyewear", price: 90 },
  { id: "monocle", kind: "wear", slot: "eyewear", price: 110 },
  { id: "visor", kind: "wear", slot: "eyewear", price: 150 },
  { id: "sparkles", kind: "wear", slot: "aura", price: 150 },
  { id: "bubbles", kind: "wear", slot: "aura", price: 160 },
  { id: "hearts", kind: "wear", slot: "aura", price: 190 },
  { id: "starring", kind: "wear", slot: "aura", price: 230 },
  { id: "rainbow", kind: "wear", slot: "aura", price: 320 },
  { id: "apple", kind: "food", price: 10, fullness: 15, joy: 1 },
  { id: "cookie", kind: "food", price: 12, fullness: 10, joy: 2 },
  { id: "riceball", kind: "food", price: 16, fullness: 25, joy: 1 },
  { id: "icecream", kind: "food", price: 20, fullness: 15, joy: 3 },
  { id: "soup", kind: "food", price: 24, fullness: 35, joy: 2 },
  { id: "cake", kind: "food", price: 35, fullness: 30, joy: 5 },
  { id: "meadow", kind: "backdrop", price: 0 },
  { id: "beach", kind: "backdrop", price: 250 },
  { id: "snow", kind: "backdrop", price: 260 },
  { id: "night", kind: "backdrop", price: 300 },
  { id: "candy", kind: "backdrop", price: 360 },
];

export const itemById = (id: string) => ITEMS.find((i) => i.id === id);

/** Ce que l'accessoire doit savoir de la tête qu'il habille. */
export interface WearContext {
  /** Sommet de la tête, demi-largeur et centre vertical. */
  top: number;
  hw: number;
  cy: number;
  eyeY: number;
  eyeDx: number;
  /** Couleur préférée du Svgii : certains accessoires s'y accordent. */
  favorite: string;
}

function heart(cx: number, cy: number, s: number, fill: string, key?: string | number) {
  return (
    <path
      key={key}
      d={`M${cx} ${cy + s * 0.9} C${cx - s * 1.6} ${cy - s * 0.1} ${cx - s * 0.9} ${cy - s * 1.3} ${cx} ${cy - s * 0.45} C${cx + s * 0.9} ${cy - s * 1.3} ${cx + s * 1.6} ${cy - s * 0.1} ${cx} ${cy + s * 0.9} Z`}
      fill={fill}
    />
  );
}

function sparkle(cx: number, cy: number, s: number, fill: string, key?: string | number, delay = 0) {
  return (
    <path
      key={key}
      className="aura-twinkle"
      style={{ animationDelay: `${delay}s`, transformBox: "fill-box", transformOrigin: "center" }}
      d={`M${cx} ${cy - s} Q${cx + s * 0.18} ${cy - s * 0.18} ${cx + s} ${cy} Q${cx + s * 0.18} ${cy + s * 0.18} ${cx} ${cy + s} Q${cx - s * 0.18} ${cy + s * 0.18} ${cx - s} ${cy} Q${cx - s * 0.18} ${cy - s * 0.18} ${cx} ${cy - s} Z`}
      fill={fill}
    />
  );
}

/**
 * Dessins des accessoires. `back` passe derrière le Svgii (une aura qui l'entoure), `front`
 * devant (un chapeau, des lunettes, des étincelles qui flottent devant lui).
 */
const WEAR: Record<string, (c: WearContext) => { back?: ReactNode; front?: ReactNode }> = {
  partyhat: ({ top }) => ({
    front: (
      <g transform={`rotate(-8 50 ${top})`}>
        <path d={`M38 ${top + 5} L50 ${top - 26} L62 ${top + 5} Z`} fill="#ff6b9a" stroke="#d94a7c" strokeWidth={1.2} strokeLinejoin="round" />
        <path d={`M41.5 ${top - 3} L58.5 ${top - 3} M45 ${top - 12} L55 ${top - 12}`} stroke="#ffd34d" strokeWidth={2.4} strokeLinecap="round" />
        <circle cx={50} cy={top - 27} r={3.6} fill="#ffd34d" stroke="#e0a81e" strokeWidth={1} />
      </g>
    ),
  }),
  beanie: ({ top, hw }) => ({
    front: (
      <g>
        <path d={`M${50 - hw + 3} ${top + 12} Q${50 - hw + 1} ${top - 14} 50 ${top - 14} Q${50 + hw - 1} ${top - 14} ${50 + hw - 3} ${top + 12} Z`} fill="#4aa3ff" stroke="#2f7fd0" strokeWidth={1.2} />
        <rect x={50 - hw + 2} y={top + 6} width={2 * hw - 4} height={8} rx={4} fill="#2f7fd0" />
        <circle cx={50} cy={top - 15} r={5} fill="#ffffff" stroke="#c9d6e3" strokeWidth={1} />
      </g>
    ),
  }),
  beret: ({ top, hw }) => ({
    front: (
      <g transform={`rotate(-10 50 ${top})`}>
        <ellipse cx={52} cy={top + 1} rx={hw * 0.86} ry={7.5} fill="#c0392b" stroke="#962d22" strokeWidth={1.2} />
        <path d={`M52 ${top - 6} q1 -5 3 -6`} stroke="#962d22" strokeWidth={2} fill="none" strokeLinecap="round" />
      </g>
    ),
  }),
  chef: ({ top }) => ({
    front: (
      <g fill="#ffffff" stroke="#d6dbe3" strokeWidth={1.2}>
        <rect x={38} y={top - 4} width={24} height={9} rx={2} />
        <circle cx={41} cy={top - 10} r={7} />
        <circle cx={50} cy={top - 15} r={8} />
        <circle cx={59} cy={top - 10} r={7} />
        <rect x={38.6} y={top - 6} width={22.8} height={5} stroke="none" />
      </g>
    ),
  }),
  tophat: ({ top, hw, favorite }) => ({
    front: (
      <g>
        <ellipse cx={50} cy={top + 3} rx={hw * 0.8} ry={3.4} fill="#2d2a33" />
        <rect x={38} y={top - 22} width={24} height={25} rx={3} fill="#3d3a45" />
        <rect x={38} y={top - 5} width={24} height={4.5} fill={favorite} />
        <rect x={40.5} y={top - 20} width={3} height={13} rx={1.5} fill="#fff" opacity={0.18} />
      </g>
    ),
  }),
  wizard: ({ top, hw }) => ({
    front: (
      <g>
        <ellipse cx={50} cy={top + 3} rx={hw * 0.95} ry={4} fill="#5b4bd6" stroke="#4536a8" strokeWidth={1} />
        <path d={`M37 ${top + 3} Q46 ${top - 14} 48 ${top - 30} Q56 ${top - 34} 66 ${top - 26} Q56 ${top - 22} 63 ${top + 3} Z`} fill="#6c5ce7" stroke="#4536a8" strokeWidth={1.2} strokeLinejoin="round" />
        {sparkle(46, top - 8, 3, "#ffd34d", "s1")}
        {sparkle(55, top - 16, 2.2, "#ffd34d", "s2", 0.6)}
      </g>
    ),
  }),
  shades: ({ eyeY, eyeDx }) => ({
    front: (
      <g>
        <rect x={50 - eyeDx - 7} y={eyeY - 4.5} width={14} height={9} rx={4} fill="#1f1d24" />
        <rect x={50 + eyeDx - 7} y={eyeY - 4.5} width={14} height={9} rx={4} fill="#1f1d24" />
        <path d={`M${50 - 3.5} ${eyeY - 1.5} H${50 + 3.5}`} stroke="#1f1d24" strokeWidth={2} />
        <path d={`M${50 - eyeDx - 4.5} ${eyeY - 2} l3 -1.4 M${50 + eyeDx - 4.5} ${eyeY - 2} l3 -1.4`} stroke="#fff" strokeOpacity={0.5} strokeWidth={1.4} strokeLinecap="round" />
      </g>
    ),
  }),
  heartglasses: ({ eyeY, eyeDx }) => ({
    front: (
      <g>
        {heart(50 - eyeDx, eyeY, 5.4, "#ff5c8a", "l")}
        {heart(50 + eyeDx, eyeY, 5.4, "#ff5c8a", "r")}
        <path d={`M${50 - 4} ${eyeY - 2} Q50 ${eyeY - 4} ${50 + 4} ${eyeY - 2}`} stroke="#d63d6c" strokeWidth={1.6} fill="none" />
      </g>
    ),
  }),
  monocle: ({ eyeY, eyeDx }) => ({
    front: (
      <g>
        <circle cx={50 + eyeDx} cy={eyeY} r={6.4} fill="#fff" fillOpacity={0.2} stroke="#c9a227" strokeWidth={1.8} />
        <path d={`M${50 + eyeDx + 4.5} ${eyeY + 4.6} Q${50 + eyeDx + 8} ${eyeY + 14} ${50 + eyeDx + 2} ${eyeY + 22}`} stroke="#c9a227" strokeWidth={1} fill="none" />
      </g>
    ),
  }),
  visor: ({ eyeY, hw }) => ({
    front: (
      <g>
        <rect x={50 - hw + 4} y={eyeY - 5.5} width={2 * hw - 8} height={11} rx={5.5} fill="#4dd6e8" fillOpacity={0.55} stroke="#2aa7bd" strokeWidth={1.4} />
        <path d={`M${50 - hw + 9} ${eyeY - 2.5} H${50 - 4}`} stroke="#fff" strokeOpacity={0.7} strokeWidth={1.6} strokeLinecap="round" />
      </g>
    ),
  }),
  sparkles: ({ cy }) => ({
    front: (
      <g>
        {[
          [14, cy - 18, 4.2],
          [86, cy - 10, 3.6],
          [20, cy + 22, 3],
          [82, cy + 26, 4],
          [50, cy - 40, 3.2],
        ].map(([x, y, s], i) => sparkle(x, y, s, "#ffd34d", i, i * 0.35))}
      </g>
    ),
  }),
  bubbles: ({ cy }) => ({
    back: (
      <g fill="#bfe6ff" fillOpacity={0.45} stroke="#7cc4f2" strokeWidth={1}>
        {[
          [12, cy - 6, 6],
          [88, cy - 16, 5],
          [18, cy + 24, 4],
          [86, cy + 18, 7],
          [30, cy - 34, 4],
          [72, cy - 36, 5],
        ].map(([x, y, r], i) => (
          <circle key={i} cx={x} cy={y} r={r} className="aura-twinkle" style={{ animationDelay: `${i * 0.4}s` }} />
        ))}
      </g>
    ),
  }),
  hearts: ({ cy }) => ({
    front: (
      <g>
        {[
          [13, cy - 12, 3.6],
          [87, cy - 4, 3],
          [22, cy + 24, 2.6],
          [80, cy + 28, 3.4],
          [64, cy - 38, 2.6],
        ].map(([x, y, s], i) => (
          <g key={i} className="aura-twinkle" style={{ animationDelay: `${i * 0.3}s` }}>
            {heart(x, y, s, "#ff6b9a")}
          </g>
        ))}
      </g>
    ),
  }),
  starring: ({ cy }) => ({
    back: <ellipse cx={50} cy={cy + 2} rx={44} ry={40} fill="none" stroke="#ffd34d" strokeOpacity={0.35} strokeWidth={1.2} strokeDasharray="2 5" />,
    front: (
      <g>
        {Array.from({ length: 8 }, (_, i) => {
          const a = (Math.PI * 2 * i) / 8;
          return sparkle(50 + 44 * Math.cos(a), cy + 2 + 40 * Math.sin(a), 3, "#ffd34d", i, i * 0.2);
        })}
      </g>
    ),
  }),
  rainbow: ({ top, cy }) => ({
    back: (
      <g fill="none" strokeWidth={4} strokeLinecap="round" opacity={0.75}>
        {["#ff6b6b", "#ffc93c", "#6bd48f", "#4aa3ff", "#a78bfa"].map((color, i) => (
          <path key={color} d={`M${6 + i * 4} ${cy + 18} A${44 - i * 4} ${cy + 18 - top + 14 - i * 4} 0 0 1 ${94 - i * 4} ${cy + 18}`} stroke={color} />
        ))}
      </g>
    ),
  }),
};

/** Les calques d'un Svgii équipé, à placer derrière et devant lui. */
export function wearLayers(equip: Equip | undefined, ctx: WearContext): { back: ReactNode; front: ReactNode } {
  if (!equip) return { back: null, front: null };
  const back: ReactNode[] = [];
  const front: ReactNode[] = [];
  // L'aura d'abord (derrière tout), puis les lunettes, puis le chapeau par-dessus.
  for (const slot of ["aura", "eyewear", "hat"] as Slot[]) {
    const id = equip[slot];
    const draw = id ? WEAR[id] : undefined;
    if (!draw) continue;
    const layer = draw(ctx);
    if (layer.back) back.push(<g key={`b-${id}`} id={`item-${id}`}>{layer.back}</g>);
    if (layer.front) front.push(<g key={`f-${id}`} id={`item-${id}-front`}>{layer.front}</g>);
  }
  return { back, front };
}

/* ─── Nourriture ──────────────────────────────────────────────────────────────────────── */

const FOOD_ICONS: Record<string, ReactNode> = {
  apple: (
    <g>
      <path d="M50 34 C36 26 22 38 26 56 C29 70 40 80 50 74 C60 80 71 70 74 56 C78 38 64 26 50 34 Z" fill="#ff5c5c" stroke="#d63d3d" strokeWidth={2} />
      <path d="M50 34 Q50 24 56 18" stroke="#7a4b2a" strokeWidth={3.5} fill="none" strokeLinecap="round" />
      <ellipse cx={61} cy={24} rx={8} ry={4} transform="rotate(-30 61 24)" fill="#6bd48f" />
      <ellipse cx={38} cy={46} rx={4} ry={7} fill="#fff" opacity={0.35} />
    </g>
  ),
  cookie: (
    <g>
      <circle cx={50} cy={52} r={26} fill="#e0a86b" stroke="#b7834d" strokeWidth={2} />
      {[
        [40, 44],
        [58, 42],
        [48, 58],
        [62, 60],
        [36, 60],
      ].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r={3.4} fill="#5a3825" />
      ))}
    </g>
  ),
  riceball: (
    <g>
      <path d="M50 22 C60 22 78 50 78 62 C78 74 66 78 50 78 C34 78 22 74 22 62 C22 50 40 22 50 22 Z" fill="#ffffff" stroke="#d6dbe3" strokeWidth={2} />
      <rect x={36} y={58} width={28} height={20} rx={3} fill="#2d3b2d" />
    </g>
  ),
  icecream: (
    <g>
      <path d="M36 50 L50 84 L64 50 Z" fill="#f0c46a" stroke="#c9963d" strokeWidth={2} strokeLinejoin="round" />
      <circle cx={42} cy={44} r={11} fill="#ffb3d1" />
      <circle cx={58} cy={44} r={11} fill="#c8f0d8" />
      <circle cx={50} cy={32} r={11} fill="#fff1b8" />
      <circle cx={50} cy={20} r={3.5} fill="#ff5c5c" />
    </g>
  ),
  soup: (
    <g>
      <path d="M22 50 H78 Q78 76 50 76 Q22 76 22 50 Z" fill="#4aa3ff" stroke="#2f7fd0" strokeWidth={2} />
      <ellipse cx={50} cy={50} rx={28} ry={6} fill="#ffc93c" />
      <path d="M40 40 q-4 -8 0 -14 M52 40 q-4 -8 0 -14 M64 40 q-4 -8 0 -14" stroke="#c9d6e3" strokeWidth={2.5} fill="none" strokeLinecap="round" />
    </g>
  ),
  cake: (
    <g>
      <rect x={24} y={46} width={52} height={30} rx={5} fill="#ffe3cf" stroke="#e2b48f" strokeWidth={2} />
      <path d="M24 52 Q32 60 40 52 Q48 60 56 52 Q64 60 76 52 V46 H24 Z" fill="#ff8fc7" />
      <rect x={47} y={30} width={6} height={16} rx={2} fill="#4aa3ff" />
      <path d="M50 22 q4 4 0 8 q-4 -4 0 -8 Z" fill="#ffc93c" />
    </g>
  ),
};

export function FoodIcon({ id, size = 48 }: { id: string; size?: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden>
      {FOOD_ICONS[id]}
    </svg>
  );
}

/* ─── Fonds de la Place ───────────────────────────────────────────────────────────────── */

function Trees({ color, trunk = "#a0703c" }: { color: string; trunk?: string }) {
  return (
    <>
      {[
        [34, 58],
        [58, 54],
        [360, 57],
        [384, 61],
      ].map(([x, y]) => (
        <g key={x}>
          <rect x={x - 2} y={y} width="4" height="10" rx="1.5" fill={trunk} />
          <circle cx={x} cy={y - 4} r="10" fill={color} />
          <circle cx={x - 3} cy={y - 7} r="4" fill="#fff" opacity="0.18" />
        </g>
      ))}
    </>
  );
}

const BACKDROPS: Record<string, ReactNode> = {
  meadow: (
    <>
      <rect width="400" height="160" fill="#a9dcff" />
      <circle cx="340" cy="24" r="13" fill="#fff6b8" />
      <g fill="#fff" opacity="0.85">
        <ellipse cx="70" cy="24" rx="22" ry="7" />
        <ellipse cx="88" cy="20" rx="14" ry="7" />
        <ellipse cx="250" cy="34" rx="18" ry="5.5" />
      </g>
      <ellipse cx="80" cy="66" rx="120" ry="26" fill="#8fd77a" />
      <ellipse cx="320" cy="68" rx="130" ry="24" fill="#86d071" />
      <rect y="62" width="400" height="98" fill="#8ed46e" />
      <ellipse cx="200" cy="118" rx="150" ry="34" fill="#f3e2b8" opacity="0.75" />
      <Trees color="#4fb85a" />
      <ellipse cx="200" cy="74" rx="26" ry="7" fill="#c9d6e3" />
      <ellipse cx="200" cy="72" rx="21" ry="5" fill="#8fd0ff" />
      <rect x="197" y="56" width="6" height="16" rx="2" fill="#c9d6e3" />
      <path d="M200 56 Q192 50 188 62 M200 56 Q208 50 212 62" stroke="#8fd0ff" strokeWidth="2" fill="none" strokeLinecap="round" />
    </>
  ),
  beach: (
    <>
      <rect width="400" height="160" fill="#8fd6ff" />
      <circle cx="70" cy="28" r="15" fill="#ffe27a" />
      <rect y="52" width="400" height="30" fill="#3fb3e8" />
      <path d="M0 80 Q50 72 100 80 T200 80 T300 80 T400 80 V160 H0 Z" fill="#f6dfa4" />
      <path d="M0 80 Q50 74 100 80 T200 80 T300 80 T400 80" stroke="#fff" strokeWidth="3" fill="none" opacity="0.7" />
      <g>
        <path d="M352 96 Q356 70 350 50" stroke="#a0703c" strokeWidth="5" fill="none" strokeLinecap="round" />
        <path d="M350 50 q-22 -4 -30 8 M350 50 q20 -8 30 4 M350 50 q-8 -16 -24 -14 M350 50 q10 -16 26 -12" stroke="#3fae5a" strokeWidth="5" fill="none" strokeLinecap="round" />
      </g>
      <path d="M40 112 L58 86 L76 112 Z" fill="#ff6b6b" />
      <path d="M58 86 V120" stroke="#c9d6e3" strokeWidth="2" />
    </>
  ),
  snow: (
    <>
      <rect width="400" height="160" fill="#dceefb" />
      <ellipse cx="90" cy="70" rx="130" ry="30" fill="#f4f9ff" />
      <ellipse cx="320" cy="72" rx="130" ry="26" fill="#eef6ff" />
      <rect y="66" width="400" height="94" fill="#f8fbff" />
      {[
        [34, 58],
        [58, 54],
        [360, 57],
        [384, 61],
      ].map(([x, y]) => (
        <g key={x}>
          <path d={`M${x} ${y - 18} L${x - 11} ${y + 6} H${x + 11} Z`} fill="#3f8f6b" />
          <path d={`M${x} ${y - 18} L${x - 6} ${y - 6} H${x + 6} Z`} fill="#fff" />
        </g>
      ))}
      <g fill="#fff">
        {Array.from({ length: 26 }, (_, i) => (
          <circle key={i} cx={(i * 61) % 400} cy={(i * 37) % 70} r={1.6} />
        ))}
      </g>
      <g>
        <circle cx="200" cy="96" r="12" fill="#fff" stroke="#d6e6f5" />
        <circle cx="200" cy="78" r="8" fill="#fff" stroke="#d6e6f5" />
        <path d="M200 79 l6 1.5 -6 1.5 Z" fill="#ff9f43" />
      </g>
    </>
  ),
  night: (
    <>
      <rect width="400" height="160" fill="#1f2a5c" />
      <circle cx="330" cy="28" r="13" fill="#fff6d0" />
      <circle cx="336" cy="24" r="11" fill="#1f2a5c" />
      <g fill="#fff">
        {Array.from({ length: 30 }, (_, i) => (
          <circle key={i} cx={(i * 73) % 400} cy={(i * 29) % 58} r={i % 4 === 0 ? 1.4 : 0.8} opacity={0.85} />
        ))}
      </g>
      <ellipse cx="80" cy="68" rx="120" ry="26" fill="#2c4a3f" />
      <ellipse cx="320" cy="70" rx="130" ry="24" fill="#294538" />
      <rect y="64" width="400" height="96" fill="#2f5a45" />
      <Trees color="#1f4535" trunk="#3d2a1e" />
      <g fill="#ffe27a">
        {[
          [120, 96],
          [270, 110],
          [180, 132],
          [320, 92],
        ].map(([x, y]) => (
          <circle key={x} cx={x} cy={y} r={1.8} className="aura-twinkle" />
        ))}
      </g>
    </>
  ),
  candy: (
    <>
      <rect width="400" height="160" fill="#ffd6ec" />
      <g fill="#fff" opacity="0.9">
        <ellipse cx="90" cy="26" rx="22" ry="7" />
        <ellipse cx="290" cy="32" rx="18" ry="6" />
      </g>
      <ellipse cx="80" cy="68" rx="120" ry="26" fill="#ffb3d1" />
      <ellipse cx="320" cy="70" rx="130" ry="24" fill="#d6c6ff" />
      <rect y="64" width="400" height="96" fill="#ffe7f3" />
      <ellipse cx="200" cy="118" rx="150" ry="34" fill="#fff4b8" opacity="0.8" />
      {[
        [40, 52, "#ff6b9a"],
        [362, 54, "#7c6cff"],
      ].map(([x, y, c]) => (
        <g key={String(x)}>
          <rect x={Number(x) - 1.5} y={Number(y)} width="3" height="18" fill="#fff" />
          <circle cx={Number(x)} cy={Number(y)} r="11" fill={String(c)} />
          <path d={`M${Number(x) - 6} ${Number(y)} a6 6 0 0 1 12 0 a4 4 0 0 1 -8 0`} stroke="#fff" strokeWidth="2" fill="none" />
        </g>
      ))}
    </>
  ),
};

/** Fond de la Place, dessiné en SVG ; il couvre son parent en gardant ses proportions. */
export function Backdrop({ id, className = "absolute inset-0 h-full w-full" }: { id: string; className?: string }) {
  return (
    <svg viewBox="0 0 400 160" preserveAspectRatio="xMidYMid slice" className={className} aria-hidden>
      {BACKDROPS[id] ?? BACKDROPS.meadow}
    </svg>
  );
}
