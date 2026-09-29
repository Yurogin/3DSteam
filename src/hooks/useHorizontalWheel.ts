import { useEffect } from "react";

/** Pixels par cran de molette. */
const STEP = 120;
/** Raideur du ressort (s⁻²) : plus grand = plus vif. Amortissement critique : jamais de rebond. */
const STIFFNESS = 180;
const DAMPING = 2 * Math.sqrt(STIFFNESS);

/**
 * La molette fait défiler horizontalement (comme Maj + molette), avec une animation « ressort » :
 * chaque cran déplace la destination sans remettre la vitesse à zéro. Enchaîner plusieurs crans
 * donne donc un seul mouvement continu qui accélère puis ralentit, sans à-coups.
 * Les gestes déjà horizontaux (pavé tactile, Maj + molette) restent gérés par le navigateur.
 */
export function useHorizontalWheel(el: HTMLElement | null) {
  useEffect(() => {
    if (!el) return;
    let target = 0;
    let pos = 0;
    let velocity = 0;
    let frame = 0;
    let last = 0;

    const max = () => el.scrollWidth - el.clientWidth;

    const step = (now: number) => {
      // Pas de temps réel (plafonné si l'onglet a été mis en pause).
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      const accel = STIFFNESS * (target - pos) - DAMPING * velocity;
      velocity += accel * dt;
      pos = Math.min(max(), Math.max(0, pos + velocity * dt));
      el.scrollLeft = pos;
      if (Math.abs(target - pos) < 0.5 && Math.abs(velocity) < 10) {
        el.scrollLeft = pos = target;
        velocity = 0;
        frame = 0;
        return;
      }
      frame = requestAnimationFrame(step);
    };

    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) >= Math.abs(e.deltaY) || e.ctrlKey) return;
      e.preventDefault();
      if (!frame) {
        // Au repos : on repart de la position réelle (elle a pu bouger au clavier ou à la barre).
        pos = target = el.scrollLeft;
        velocity = 0;
        last = performance.now();
        frame = requestAnimationFrame(step);
      }
      // Un cran = STEP px, quelle que soit la souris (les pavés verticaux gardent leur finesse).
      const notches = e.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? e.deltaY / 100 : Math.sign(e.deltaY);
      target = Math.min(max(), Math.max(0, target + notches * STEP));
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      cancelAnimationFrame(frame);
    };
  }, [el]);
}
