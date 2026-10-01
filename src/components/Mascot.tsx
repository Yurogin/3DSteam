import { useId, useMemo, type ReactNode } from "react";
import { motion, type TargetAndTransition } from "framer-motion";
import { shade, type Eyes, type Head, type MascotLook, type Mood, type Mouth } from "../lib/mascot";
import { wearLayers, type Equip } from "../lib/svgiiItems";

/**
 * La mascotte, dessinée en SVG dans un carré de 100 × 100 : tronc, cou, tête, puis le visage et
 * ce qui se pose dessus. Chaque pièce se cale sur la forme de la tête (son sommet et sa
 * demi-largeur), et les franges sont découpées par la tête elle-même : toute coiffure va à tout
 * visage.
 */

const INK = "#2d2a33";
/** Centre vertical de la tête. */
const CY = 47;
const EYE_Y = 51;
const EYE_DX = 10.5;

type ShapeProps = { fill?: string; stroke?: string; strokeWidth?: number };

interface HeadGeo {
  /** Sommet de la tête, et sa demi-largeur. */
  top: number;
  hw: number;
  draw: (p: ShapeProps) => ReactNode;
}

const HEAD: Record<Head, HeadGeo> = {
  round: { top: 21, hw: 27, draw: (p) => <ellipse cx={50} cy={CY} rx={27} ry={26} {...p} /> },
  wide: { top: 23, hw: 31, draw: (p) => <ellipse cx={50} cy={CY} rx={31} ry={24} {...p} /> },
  egg: {
    top: 18,
    hw: 26,
    draw: (p) => <path d="M50 18 C66 18 76 34 76 50 C76 64 65 74 50 74 C35 74 24 64 24 50 C24 34 34 18 50 18 Z" {...p} />,
  },
  soft: { top: 20, hw: 27, draw: (p) => <rect x={23} y={20} width={54} height={53} rx={20} {...p} /> },
  mochi: {
    top: 22,
    hw: 28,
    draw: (p) => <path d="M50 22 C64 22 74 30 77 44 C80 58 73 72 50 72 C27 72 20 58 23 44 C26 30 36 22 50 22 Z" {...p} />,
  },
};

/** Dessine une pièce à gauche, puis son reflet à droite. */
const Mirror = ({ children }: { children: ReactNode }) => (
  <>
    {children}
    <g transform="matrix(-1 0 0 1 100 0)">{children}</g>
  </>
);

function starPoints(cx: number, cy: number, outer: number, inner: number): string {
  return Array.from({ length: 10 }, (_, i) => {
    const r = i % 2 ? inner : outer;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    return `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
  }).join(" ");
}

type FaceEyes = Eyes | "closed";
type FaceMouth = Mouth | "frown";

function Eye({ kind, x }: { kind: FaceEyes; x: number }) {
  const y = EYE_Y;
  switch (kind) {
    case "dot":
      return (
        <>
          <ellipse cx={x} cy={y} rx={3} ry={3.8} fill={INK} />
          <circle cx={x + 1} cy={y - 1.4} r={1.1} fill="#fff" />
        </>
      );
    case "sparkle":
      return (
        <>
          <ellipse cx={x} cy={y} rx={4.4} ry={5.4} fill={INK} />
          <circle cx={x + 1.4} cy={y - 2} r={1.8} fill="#fff" />
          <circle cx={x - 1.5} cy={y + 2.1} r={0.9} fill="#fff" />
        </>
      );
    case "round":
      return (
        <>
          <ellipse cx={x} cy={y} rx={4.8} ry={5.2} fill="#fff" stroke={INK} strokeWidth={1.2} />
          <circle cx={x + 0.6} cy={y + 0.6} r={2.7} fill={INK} />
          <circle cx={x + 1.5} cy={y - 0.4} r={0.9} fill="#fff" />
        </>
      );
    case "happy":
      return <path d={`M${x - 4} ${y + 1.5} Q${x} ${y - 4.5} ${x + 4} ${y + 1.5}`} fill="none" stroke={INK} strokeWidth={2.2} strokeLinecap="round" />;
    case "sleepy":
      return (
        <>
          <ellipse cx={x} cy={y + 1} rx={3.6} ry={2.6} fill={INK} />
          <path d={`M${x - 4.6} ${y - 0.6} H${x + 4.6}`} stroke={INK} strokeWidth={1.8} strokeLinecap="round" />
        </>
      );
    case "star":
      return (
        <>
          <polygon points={starPoints(x, y, 5, 2.2)} fill={INK} strokeLinejoin="round" stroke={INK} strokeWidth={0.8} />
          <circle cx={x + 1.2} cy={y - 1.2} r={0.8} fill="#fff" />
        </>
      );
    case "closed":
      return <path d={`M${x - 4} ${y} Q${x} ${y + 3.5} ${x + 4} ${y}`} fill="none" stroke={INK} strokeWidth={2} strokeLinecap="round" />;
  }
}

function MouthShape({ kind }: { kind: FaceMouth }) {
  const line = { fill: "none", stroke: INK, strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (kind) {
    case "smile":
      return <path d="M45 61 Q50 66 55 61" {...line} />;
    case "cat":
      return <path d="M44 61 Q47 64.5 50 61.5 Q53 64.5 56 61" {...line} strokeWidth={1.8} />;
    case "open":
      return (
        <>
          <path d="M44.5 60.5 Q50 69.5 55.5 60.5 Z" fill={INK} stroke={INK} strokeWidth={1.2} strokeLinejoin="round" />
          <ellipse cx={50} cy={64.6} rx={2.8} ry={1.6} fill="#ff7a9a" />
        </>
      );
    case "tiny":
      return <ellipse cx={50} cy={62} rx={1.8} ry={2.2} fill={INK} />;
    case "tongue":
      return (
        <>
          <path d="M47.5 62.4 Q50 68.5 52.5 62.4 Z" fill="#ff7a9a" />
          <path d="M44.5 61 Q50 64.5 55.5 61" {...line} />
        </>
      );
    case "grin":
      return (
        <>
          <path d="M43.5 60 H56.5 Q56.5 67.5 50 67.5 Q43.5 67.5 43.5 60 Z" fill={INK} stroke={INK} strokeWidth={1} strokeLinejoin="round" />
          <rect x={45.5} y={60} width={9} height={2} rx={0.8} fill="#fff" />
        </>
      );
    case "frown":
      return <path d="M45.5 64 Q50 60 54.5 64" {...line} />;
  }
}

/** Ce que l'humeur change au visage. */
function faceFor(look: MascotLook, mood: Mood): { eyes: FaceEyes; mouth: FaceMouth; brows: boolean } {
  switch (mood) {
    case "happy":
      return { eyes: "happy", mouth: "open", brows: false };
    case "excited":
      return { eyes: look.eyes === "star" ? "star" : "sparkle", mouth: "grin", brows: false };
    case "sad":
      return { eyes: look.eyes === "happy" ? "dot" : look.eyes, mouth: "frown", brows: true };
    case "sleepy":
      return { eyes: "closed", mouth: "tiny", brows: false };
    default:
      return { eyes: look.eyes, mouth: look.mouth, brows: false };
  }
}

const MOTION: Record<Mood, TargetAndTransition> = {
  idle: { y: [0, -1.2, 0], rotate: 0, transition: { duration: 2.8, repeat: Infinity, ease: "easeInOut" } },
  happy: { y: [0, -8, 0, -4, 0], rotate: 0, transition: { duration: 0.9, ease: "easeOut" } },
  excited: { y: [0, -10, 0, -10, 0], rotate: [0, -5, 5, -3, 0], transition: { duration: 1.1, ease: "easeOut" } },
  sad: { y: 2, rotate: -3, transition: { type: "spring", stiffness: 120, damping: 12 } },
  sleepy: { y: [1.5, 2.6, 1.5], rotate: 4, transition: { duration: 3.6, repeat: Infinity, ease: "easeInOut" } },
};

interface Props {
  look: MascotLook;
  /** Côté en pixels. */
  size: number;
  mood?: Mood;
  /** Respiration, clignements et réactions ; coupé pour les vignettes de l'éditeur. */
  animated?: boolean;
  /**
   * `head` resserre le cadre sur la tête, dans une bulle ronde (avatar, vignettes) : le bas est
   * arrondi, mais oreilles et accessoires peuvent dépasser par le haut.
   */
  crop?: "bust" | "head";
  /** Change à chaque retouche dans l'éditeur : la mascotte sautille. */
  bounce?: number;
  /** Accessoires de la Svgii Plaza (chapeau, lunettes, aura), posés en calques par-dessus. */
  equip?: Equip;
  className?: string;
}

export function Mascot({ look, size, mood = "idle", animated = true, crop = "bust", bounce = 0, equip, className }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const clip = `mascot-head-${uid}`;
  // Chaque mascotte cligne à son rythme : sinon toutes celles de l'écran clignent ensemble.
  const blinkDelay = useMemo(() => `${(-Math.random() * 4).toFixed(2)}s`, []);
  const head = HEAD[look.head];
  const { top, hw } = head;
  const skinLine = shade(look.skin, -0.22);
  const hairLine = shade(look.hairColor, -0.25);
  const favLine = shade(look.favorite, -0.22);
  const face = faceFor(look, mood);
  const hair = look.hair;
  const blink = animated && mood !== "sleepy" && ["dot", "sparkle", "round", "star"].includes(face.eyes);

  const hairFill = { fill: look.hairColor, stroke: hairLine, strokeWidth: 1.2 };
  const scaled = (k: number) => `translate(50 ${CY}) scale(${k}) translate(-50 ${-CY})`;

  // Volume des cheveux, derrière la tête : la tête agrandie, coupée à la bonne hauteur.
  const back =
    hair === "bob" ? (
      <g clipPath={`url(#${clip}-bob)`} transform={scaled(1.14)}>
        {head.draw(hairFill)}
      </g>
    ) : hair === "long" ? (
      <>
        <rect x={50 - hw - 4} y={CY} width={2 * hw + 8} height={42} rx={12} {...hairFill} />
        <g transform={scaled(1.12)}>{head.draw(hairFill)}</g>
      </>
    ) : hair === "bangs" || hair === "spiky" || hair === "bun" || hair === "pigtails" ? (
      <g clipPath={`url(#${clip}-cap)`} transform={scaled(hair === "spiky" ? 1.07 : 1.09)}>
        {head.draw(hairFill)}
      </g>
    ) : null;

  // Frange, découpée par la tête.
  const t = top;
  const fringe =
    hair === "bangs" || hair === "pigtails"
      ? `M0 0 H100 V${t + 14} Q88 ${t + 19} 80 ${t + 13} Q70 ${t + 20} 62 ${t + 12} Q50 ${t + 21} 40 ${t + 12} Q30 ${t + 20} 22 ${t + 13} Q12 ${t + 19} 0 ${t + 14} Z`
      : hair === "bob" || hair === "long"
        ? `M0 0 H100 V${t + 18} Q78 ${t + 14} 60 ${t + 6} Q46 ${t + 24} 0 ${t + 26} Z`
        : hair === "spiky"
          ? `M0 0 H100 V${t + 12} L86 ${t + 16} L78 ${t + 8} L68 ${t + 17} L58 ${t + 7} L48 ${t + 16} L38 ${t + 6} L28 ${t + 15} L18 ${t + 8} L0 ${t + 14} Z`
          : hair === "bun"
            ? `M0 0 H100 V${t + 9} Q50 ${t + 16} 0 ${t + 9} Z`
            : null;

  const ears = (() => {
    const L = 50 - hw;
    switch (look.ears) {
      case "human":
        return (
          <Mirror>
            <circle cx={L + 0.5} cy={52} r={5.5} fill={look.skin} stroke={skinLine} strokeWidth={1.2} />
            <circle cx={L + 0.5} cy={52} r={2.4} fill={skinLine} opacity={0.35} />
          </Mirror>
        );
      case "cat":
        return (
          <Mirror>
            <path d={`M${L + 1} ${t + 16} L${L + 3} ${t - 9} L${L + 20} ${t + 3} Z`} fill={look.skin} stroke={skinLine} strokeWidth={1.4} strokeLinejoin="round" />
            <path d={`M${L + 5} ${t + 10} L${L + 6} ${t - 2} L${L + 15} ${t + 4} Z`} fill="#ffb3c8" strokeLinejoin="round" />
          </Mirror>
        );
      case "bunny":
        return (
          <Mirror>
            <g transform={`rotate(-12 ${50 - 11} ${t + 2})`}>
              <ellipse cx={50 - 11} cy={t - 12} rx={7} ry={17} fill={look.skin} stroke={skinLine} strokeWidth={1.4} />
              <ellipse cx={50 - 11} cy={t - 11} rx={3.4} ry={12} fill="#ffb3c8" />
            </g>
          </Mirror>
        );
      case "bear":
        return (
          <Mirror>
            <circle cx={50 - hw + 6} cy={t + 5} r={9} fill={look.skin} stroke={skinLine} strokeWidth={1.4} />
            <circle cx={50 - hw + 6} cy={t + 5} r={4.6} fill={skinLine} opacity={0.4} />
          </Mirror>
        );
      case "antenna":
        return (
          <Mirror>
            <path d={`M42 ${t + 3} L35 ${t - 13}`} stroke={INK} strokeWidth={1.8} strokeLinecap="round" />
            <circle cx={35} cy={t - 14} r={3.8} fill={look.favorite} stroke={favLine} strokeWidth={1.2} />
          </Mirror>
        );
      default:
        return null;
    }
  })();

  const dogEars =
    look.ears === "dog" ? (
      <Mirror>
        <ellipse cx={50 - hw + 1} cy={t + 21} rx={7.5} ry={15} transform={`rotate(18 ${50 - hw + 1} ${t + 21})`} fill={shade(look.skin, -0.28)} stroke={shade(look.skin, -0.42)} strokeWidth={1.2} />
      </Mirror>
    ) : null;

  const extras =
    hair === "tuft" ? (
      <path d={`M50 ${t + 3} C46 ${t - 6} 54 ${t - 11} 57.5 ${t - 5}`} fill="none" stroke={look.hairColor} strokeWidth={3.6} strokeLinecap="round" />
    ) : hair === "spiky" ? (
      <path d={`M33 ${t + 5} L37 ${t - 7} L43 ${t + 1} L50 ${t - 10} L57 ${t + 1} L63 ${t - 7} L67 ${t + 5} Z`} {...hairFill} strokeLinejoin="round" />
    ) : hair === "bun" ? (
      <circle cx={50} cy={t - 4} r={8} {...hairFill} />
    ) : hair === "pigtails" ? (
      <Mirror>
        <circle cx={50 - hw - 5} cy={CY - 1} r={8} {...hairFill} />
        <ellipse cx={50 - hw + 1} cy={CY - 3} rx={2.2} ry={3.2} fill={look.favorite} />
      </Mirror>
    ) : null;

  const accessory = (() => {
    switch (look.accessory) {
      case "glasses":
        return (
          <g fill="#fff" fillOpacity={0.18} stroke={INK} strokeWidth={1.6}>
            <circle cx={50 - EYE_DX} cy={EYE_Y} r={6.6} />
            <circle cx={50 + EYE_DX} cy={EYE_Y} r={6.6} />
            <path d={`M46.4 ${EYE_Y - 1} Q50 ${EYE_Y - 3} 53.6 ${EYE_Y - 1}`} fill="none" />
          </g>
        );
      case "bow": {
        const x = 50 + hw * 0.55;
        const y = t + 5;
        return (
          <g fill={look.favorite} stroke={favLine} strokeWidth={1.2} strokeLinejoin="round">
            <path d={`M${x} ${y} L${x - 9} ${y - 6} L${x - 9} ${y + 6} Z`} />
            <path d={`M${x} ${y} L${x + 9} ${y - 6} L${x + 9} ${y + 6} Z`} />
            <circle cx={x} cy={y} r={2.6} />
          </g>
        );
      }
      case "flower": {
        const x = 50 - hw * 0.6;
        const y = t + 7;
        return (
          <g>
            {[0, 72, 144, 216, 288].map((a) => (
              <circle key={a} cx={x + 3.6 * Math.cos((a * Math.PI) / 180)} cy={y + 3.6 * Math.sin((a * Math.PI) / 180)} r={3.1} fill="#ffd1e8" stroke="#f59ac0" strokeWidth={0.8} />
            ))}
            <circle cx={x} cy={y} r={2.3} fill="#ffc93c" />
          </g>
        );
      }
      case "headphones":
        return (
          <g>
            <path d={`M${50 - hw - 1} ${CY} C${50 - hw - 1} ${t - 13} ${50 + hw + 1} ${t - 13} ${50 + hw + 1} ${CY}`} fill="none" stroke="#3d3d4a" strokeWidth={3.4} strokeLinecap="round" />
            <Mirror>
              <rect x={50 - hw - 5} y={CY - 6} width={9} height={15} rx={4} fill={look.favorite} stroke={favLine} strokeWidth={1.2} />
            </Mirror>
          </g>
        );
      case "crown":
        return (
          <g fill="#ffd34d" stroke="#e0a81e" strokeWidth={1.1} strokeLinejoin="round">
            <path d={`M38 ${t + 3} L38 ${t - 8} L44 ${t - 2} L50 ${t - 11} L56 ${t - 2} L62 ${t - 8} L62 ${t + 3} Z`} />
            <circle cx={50} cy={t - 1} r={1.8} fill="#ff6b9a" stroke="none" />
          </g>
        );
      case "sprout":
        return (
          <g>
            <path d={`M50 ${t + 1} Q49 ${t - 8} 52 ${t - 12}`} fill="none" stroke="#4aa35a" strokeWidth={1.8} strokeLinecap="round" />
            <ellipse cx={56} cy={t - 14} rx={5.2} ry={2.6} transform={`rotate(-28 56 ${t - 14})`} fill="#6bd48f" stroke="#4aa35a" strokeWidth={1} />
          </g>
        );
      default:
        return null;
    }
  })();

  const viewBox = crop === "head" ? "10 4 80 80" : "0 0 100 100";
  const worn = wearLayers(equip, { top: t, hw, cy: CY, eyeY: EYE_Y, eyeDx: EYE_DX, favorite: look.favorite });
  const body = (
    <>
      {worn.back}
      {/* Tronc, à la couleur préférée, et son col. */}
      <path d="M18 100 C18 84 31 73 50 73 C69 73 82 84 82 100 Z" fill={look.favorite} stroke={favLine} strokeWidth={1.4} />
      <path d="M41 75.5 Q50 82 59 75.5" fill="none" stroke="#fff" strokeOpacity={0.55} strokeWidth={2.4} strokeLinecap="round" />
      {back}
      {ears}
      <rect x={43.5} y={64} width={13} height={12} rx={5} fill={shade(look.skin, -0.08)} />
      {head.draw({ fill: look.skin, stroke: skinLine, strokeWidth: 1.4 })}
      {/* Reflet sur le haut de la tête. */}
      <ellipse cx={50 - hw * 0.42} cy={t + 11} rx={6} ry={3.6} transform={`rotate(-28 ${50 - hw * 0.42} ${t + 11})`} fill="#fff" opacity={0.28} />
      {look.cheeks && (
        <Mirror>
          <ellipse cx={33} cy={59} rx={4.6} ry={2.8} fill="#ff8fab" opacity={0.45} />
        </Mirror>
      )}
      <g className={blink ? "mascot-blink" : undefined} style={blink ? { animationDelay: blinkDelay } : undefined}>
        <Eye kind={face.eyes} x={50 - EYE_DX} />
        <Eye kind={face.eyes} x={50 + EYE_DX} />
      </g>
      {face.brows && (
        <Mirror>
          <path d={`M${50 - EYE_DX - 4} ${EYE_Y - 7} L${50 - EYE_DX + 3} ${EYE_Y - 9}`} stroke={INK} strokeWidth={1.6} strokeLinecap="round" />
        </Mirror>
      )}
      <MouthShape kind={face.mouth} />
      {fringe && <path d={fringe} clipPath={`url(#${clip})`} {...hairFill} />}
      {dogEars}
      {extras}
      {accessory}
      {worn.front}
    </>
  );

  return (
    <svg viewBox={viewBox} width={size} height={size} overflow="visible" className={className} aria-hidden>
      <defs>
        <clipPath id={clip}>{head.draw({})}</clipPath>
        <clipPath id={`${clip}-cap`}>
          <rect x={0} y={0} width={100} height={CY + 2} />
        </clipPath>
        <clipPath id={`${clip}-bob`}>
          <rect x={0} y={0} width={100} height={CY + 18} />
        </clipPath>
        <clipPath id={`${clip}-frame`}>
          <rect x={-50} y={-60} width={200} height={104} />
          <circle cx={50} cy={44} r={40} />
        </clipPath>
      </defs>
      <g clipPath={crop === "head" ? `url(#${clip}-frame)` : undefined}>
        {animated ? (
          <motion.g key={`${mood}-${bounce}`} style={{ originX: 0.5, originY: 1 }} animate={MOTION[mood]}>
            {body}
          </motion.g>
        ) : (
          body
        )}
      </g>
      {animated && mood === "sleepy" && (
        <g fill={INK} fontWeight={900} fontFamily="inherit">
          {[0, 1].map((i) => (
            <motion.text
              key={i}
              x={crop === "head" ? 76 : 80}
              y={crop === "head" ? 26 : 24}
              fontSize={9 - i * 2}
              initial={{ opacity: 0, x: 0, y: 0 }}
              animate={{ opacity: [0, 1, 0], x: [0, 4, 8], y: [0, -8, -16] }}
              transition={{ duration: 2.4, repeat: Infinity, delay: i * 1.2, ease: "easeOut" }}
            >
              z
            </motion.text>
          ))}
        </g>
      )}
    </svg>
  );
}
