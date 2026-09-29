import { useEffect, useRef } from "react";
import { getBindings, gamepadCapture } from "../lib/bindings";
import { isDir, type Action, type Dir } from "../lib/nav";

const DEADZONE = 0.5;
const REPEAT_DELAY = 350;
const REPEAT_RATE = 110;
const DIRS: Dir[] = ["up", "down", "left", "right"];

/**
 * Sonde les manettes à chaque image (uniquement quand au moins une est branchée) et traduit les
 * boutons en actions selon les touches configurées (paramètres → Touches). Le stick gauche
 * déplace toujours, quelle que soit la configuration, pour ne jamais rester bloqué.
 */
export function useGamepad(onAction: (action: Action) => void) {
  const ref = useRef(onAction);
  ref.current = onAction;

  useEffect(() => {
    let frame = 0;
    let pressed = new Set<number>();
    let heldDir: Dir | null = null;
    let nextRepeat = 0;

    const poll = (time: number) => {
      const pad = navigator.getGamepads().find((p) => p?.connected);
      if (!pad) {
        frame = 0;
        return;
      }
      const down = new Set<number>();
      pad.buttons.forEach((b, i) => b.pressed && down.add(i));
      const fresh = [...down].filter((b) => !pressed.has(b));
      pressed = down;

      // Écran « Touches » en attente d'un bouton : il le reçoit, rien d'autre ne se déclenche.
      if (gamepadCapture.current) {
        if (fresh.length) gamepadCapture.current(fresh[0]);
        heldDir = null;
        frame = requestAnimationFrame(poll);
        return;
      }

      const { gamepad } = getBindings();
      for (const button of fresh) {
        const action = (Object.keys(gamepad) as Action[]).find((a) => !isDir(a) && gamepad[a].includes(button));
        if (action) ref.current(action);
      }

      const [ax = 0, ay = 0] = pad.axes;
      const stick: Dir | null = ay < -DEADZONE ? "up" : ay > DEADZONE ? "down" : ax < -DEADZONE ? "left" : ax > DEADZONE ? "right" : null;
      const dir = DIRS.find((d) => gamepad[d].some((b) => down.has(b))) ?? stick;
      if (dir && dir !== heldDir) {
        ref.current(dir);
        nextRepeat = time + REPEAT_DELAY;
      } else if (dir && time >= nextRepeat) {
        ref.current(dir);
        nextRepeat = time + REPEAT_RATE;
      }
      heldDir = dir;
      frame = requestAnimationFrame(poll);
    };

    const start = () => {
      if (!frame) frame = requestAnimationFrame(poll);
    };
    window.addEventListener("gamepadconnected", start);
    start();
    return () => {
      window.removeEventListener("gamepadconnected", start);
      cancelAnimationFrame(frame);
    };
  }, []);
}
