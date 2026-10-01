import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { GameArt } from "./GameArt";
import { GameIcon } from "./GameIcon";
import { Confetti } from "./Celebration";
import { gameState } from "../lib/api";
import { artSources } from "../lib/art";
import { useI18n } from "../lib/i18n";
import type { Game } from "../types";

/** Moment où l'icône se pose au centre : l'impact (son, onde, vibration). */
const LAND_S = 0.4;
/** Début de la plongée finale dans le jeu. */
const DIVE_S = 1.75;
/** Le flash blanc est à son comble : tout le décor de l'intro disparaît derrière lui. */
const FLASH_S = DIVE_S + 0.5;
/** Fin de l'intro : le flash s'est dissipé sur le fond noir. */
const INTRO_S = DIVE_S + 0.8;
/** Intro réduite, si l'utilisateur a demandé moins d'animations. */
const CALM_INTRO_S = 1.2;
/** Rythme auquel on demande à Steam si le jeu est ouvert. */
const POLL_MS = 600;
/** Au-delà, on prévient que ça traîne. */
const SLOW_MS = 20_000;
/** Au-delà, on rend la main : le jeu ne s'ouvrira sans doute pas. */
const GIVE_UP_MS = 180_000;

/** Pourquoi la séquence s'arrête : jeu ouvert, jeu refermé sans s'ouvrir, ou abandon. */
export type SplashEnd = "opened" | "closed" | "timeout";

/** La manette vibre à l'impact, si elle sait le faire (manettes Xbox sous Windows, entre autres). */
function rumble() {
  for (const pad of navigator.getGamepads?.() ?? []) {
    const actuator = (pad as (Gamepad & { vibrationActuator?: { playEffect?: (type: string, params: object) => Promise<unknown> } }) | null)
      ?.vibrationActuator;
    void actuator?.playEffect?.("dual-rumble", { duration: 260, strongMagnitude: 0.9, weakMagnitude: 0.6 }).catch(() => {});
  }
}

/**
 * Lancement d'un jeu, en grand, jusqu'à ce qu'il soit vraiment à l'écran.
 *
 * L'intro : le visuel du jeu envahit l'écran ; l'icône s'envole de sa case et s'écrase au centre
 * (onde de choc, étincelles, vibration) ; le logo apparaît ; l'icône fonce vers l'écran et un
 * flash blanc se dissipe sur le noir. Puis l'attente : un fond noir, tant que la fenêtre du jeu
 * n'est pas là (Steam démarre, le jeu charge). Dès qu'elle l'est, fondu, et la main au jeu.
 * Un clic, Ⓐ ou Ⓑ ramènent à 3DSteam à tout moment (géré par `App`).
 */
export function LaunchSplash({ game, from, onEnd }: { game: Game; from: DOMRect | null; onEnd: (why: SplashEnd) => void }) {
  const { t } = useI18n();
  const reduce = useReducedMotion();
  const intro = reduce ? CALM_INTRO_S : INTRO_S;
  // Mesuré une fois, à l'ouverture : la séquence ne dure que le temps d'un lancement.
  const [{ size, target, start }] = useState(() => {
    const size = Math.min(window.innerHeight * 0.3, 230);
    const target = { left: window.innerWidth / 2 - size / 2, top: window.innerHeight * 0.42 - size / 2, width: size, height: size };
    // Depuis la case du jeu ; à défaut (lancé depuis un menu, case hors champ), du bas de l'écran.
    const start = from ? { left: from.left, top: from.top, width: from.width, height: from.height } : { ...target, top: window.innerHeight };
    return { size, target, start };
  });
  const [introDone, setIntroDone] = useState(false);
  const [ended, setEnded] = useState<SplashEnd | null>(null);
  const [slow, setSlow] = useState(false);
  const endRef = useRef(onEnd);
  endRef.current = onEnd;

  // L'impact, puis la fin de l'intro.
  useEffect(() => {
    const land = window.setTimeout(rumble, LAND_S * 1000);
    const done = window.setTimeout(() => setIntroDone(true), intro * 1000);
    const slowly = window.setTimeout(() => setSlow(true), SLOW_MS);
    return () => [land, done, slowly].forEach(clearTimeout);
  }, [intro]);

  // Steam est interrogé dès le départ : un petit jeu peut s'ouvrir avant la fin de l'intro, qui
  // va quand même à son terme.
  useEffect(() => {
    let alive = true;
    let seenRunning = false;
    const startedAt = Date.now();
    const poll = async () => {
      const state = await gameState(game.appid).catch(() => null);
      if (!alive) return;
      if (state?.window) return setEnded("opened");
      if (state?.running) seenRunning = true;
      // Lancé puis refermé sans jamais montrer de fenêtre : un plantage, ou un jeu qui a refusé.
      else if (seenRunning) return setEnded("closed");
      if (Date.now() - startedAt > GIVE_UP_MS) return setEnded("timeout");
      timer = window.setTimeout(() => void poll(), POLL_MS);
    };
    let timer = window.setTimeout(() => void poll(), POLL_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [game.appid]);

  const closing = ended != null && introDone;
  const logo = artSources(game, "logo");

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[70] cursor-pointer overflow-hidden bg-black"
      initial={{ opacity: 0 }}
      animate={{ opacity: closing ? 0 : 1 }}
      transition={{ duration: closing ? 0.45 : 0.2 }}
      onAnimationComplete={() => closing && ended && endRef.current(ended)}
      aria-live="polite"
      aria-label={t("starting", { name: game.name })}
    >
      {/* Tout le décor de l'intro : il disparaît d'un coup derrière le flash blanc. */}
      <motion.div
        className="absolute inset-0"
        initial={{ opacity: 1 }}
        animate={{ opacity: reduce ? [1, 1, 0] : [1, 1, 0, 0] }}
        transition={reduce ? { duration: intro, times: [0, 0.75, 1] } : { duration: intro, times: [0, FLASH_S / intro - 0.01, FLASH_S / intro, 1] }}
      >
        {/* Le visuel du jeu : il sort du flou en zoomant, puis glisse lentement. */}
        <motion.div
          className="absolute inset-0"
          initial={{ scale: 1.35, opacity: 0, filter: "blur(16px)" }}
          animate={{ scale: [1.35, 1.08, 1.02], opacity: [0, 1, 1], filter: ["blur(16px)", "blur(0px)", "blur(0px)"] }}
          transition={{ duration: intro, times: [0, 0.35, 1], ease: "easeOut" }}
        >
          <GameArt sources={artSources(game, "hero", "header")} alt="" className="absolute inset-0 h-full w-full object-cover" />
        </motion.div>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,transparent_10%,rgb(0_0_0/0.55)_65%,rgb(0_0_0/0.85))]" />

        {!reduce && (
          <>
            {/* Rayons de lumière qui tournent derrière l'icône. */}
            <motion.div
              className="pointer-events-none absolute left-1/2 top-[42%] h-[160vmax] w-[160vmax] -translate-x-1/2 -translate-y-1/2"
              style={{
                background: "repeating-conic-gradient(rgb(255 255 255 / 0.16) 0deg 5deg, transparent 5deg 15deg)",
                maskImage: "radial-gradient(circle, black 0%, transparent 55%)",
              }}
              initial={{ opacity: 0, rotate: 0, scale: 0.6 }}
              animate={{ opacity: [0, 0, 1, 0.7], rotate: 50, scale: 1 }}
              transition={{ duration: intro, times: [0, 0.13, 0.25, 1], ease: "linear" }}
            />
            {/* Onde de choc à l'impact. */}
            {[0, 0.12].map((delay) => (
              <motion.span
                key={delay}
                className="pointer-events-none absolute rounded-full border-4 border-white/80"
                style={{ left: target.left, top: target.top, width: size, height: size }}
                initial={{ scale: 0.9, opacity: 0 }}
                // Invisible jusqu'au choc : sans 0 en tête, la première valeur s'affichait dès le départ.
                animate={{ scale: [0.9, 0.9, 3.4], opacity: [0, 0.9, 0] }}
                transition={{ duration: 0.75, delay: LAND_S + delay, times: [0, 0.06, 1], ease: "easeOut" }}
              />
            ))}
            {/* Étincelles. */}
            <span className="pointer-events-none absolute" style={{ left: target.left, top: target.top, width: size, height: size }}>
              <Confetti seed={game.appid + 11} size={size * 1.6} count={30} delay={LAND_S} />
            </span>
          </>
        )}

        {/* L'icône : de sa case au centre, elle s'écrase, puis fonce vers l'écran. */}
        <motion.div
          className="absolute overflow-hidden rounded-[24%] bg-surface shadow-[0_30px_80px_-10px_rgb(0_0_0/0.7)] ring-4 ring-white/90"
          initial={reduce ? { ...target, opacity: 0 } : { ...start, opacity: 1 }}
          animate={
            reduce
              ? { ...target, opacity: 1 }
              : {
                  left: [start.left, target.left, target.left, target.left],
                  top: [start.top, target.top, target.top, target.top],
                  width: [start.width, size, size, size],
                  height: [start.height, size, size, size],
                  scale: [1, 1.12, 1, 7],
                  rotate: [0, -4, 0, 0],
                  opacity: [1, 1, 1, 0],
                }
          }
          transition={
            reduce
              ? { duration: 0.4 }
              : { duration: DIVE_S + 0.45, times: [0, LAND_S / (DIVE_S + 0.45), DIVE_S / (DIVE_S + 0.45), 1], ease: ["easeIn", "easeOut", "easeIn"] }
          }
        >
          <GameIcon game={game} size={size} />
          <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-linear-to-b from-white/30 to-transparent" />
        </motion.div>

        {/* Le logo du jeu (ou son nom). */}
        <motion.div
          className="pointer-events-none absolute inset-x-0 flex flex-col items-center gap-4 px-6"
          style={{ top: target.top + size + 28 }}
          initial={{ opacity: 0, y: 24, scale: 0.85 }}
          animate={{ opacity: [0, 1, 1, 0], y: [24, 0, 0, -10], scale: [0.85, 1, 1, 1.05] }}
          transition={{ duration: intro, times: [0.2, 0.32, 0.7, 0.85], ease: "easeOut" }}
        >
          <GameArt
            sources={logo}
            alt={game.name}
            className="max-h-[14vh] max-w-[min(70vw,560px)] object-contain drop-shadow-[0_6px_20px_rgb(0_0_0/0.7)]"
            fallback={<span className="max-w-[80vw] text-center text-4xl font-black text-white drop-shadow-[0_4px_16px_rgb(0_0_0/0.8)]">{game.name}</span>}
          />
        </motion.div>
      </motion.div>

      {/* La plongée : un flash blanc, qui se dissipe sur le noir. */}
      {!reduce && (
        <motion.div
          className="pointer-events-none absolute inset-0 bg-white"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0, 1, 0] }}
          transition={{ duration: intro, times: [0, (DIVE_S + 0.3) / intro, FLASH_S / intro, 1] }}
        />
      )}

      {/* L'attente, sur fond noir, tant que le jeu ne s'est pas montré. */}
      <AnimatePresence>
        {introDone && !closing && (
          <motion.div
            className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-5 px-6 text-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
          >
            <span className="relative h-20 w-20">
              {/* Un halo tourne autour de l'icône, qui respire doucement. */}
              <motion.span
                className="absolute -inset-2 rounded-[30%] border-2 border-transparent border-t-white/70 border-r-white/20"
                animate={{ rotate: 360 }}
                transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }}
              />
              <motion.span
                className="absolute inset-0 overflow-hidden rounded-[26%] opacity-90"
                animate={{ scale: [1, 1.05, 1] }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
              >
                <GameIcon game={game} size={80} />
              </motion.span>
            </span>
            <span className="text-lg font-black text-white">{t("launchWaiting", { name: game.name })}</span>
            <span className="text-sm font-bold text-white/55">{slow ? t("launchSlow") : t("launchWaitingHint")}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>,
    document.body,
  );
}
