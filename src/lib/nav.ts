/**
 * Navigation sans souris : actions abstraites (clavier et manette donnent les mêmes) et
 * déplacement « spatial » du focus entre les boutons, comme sur une interface de télé.
 */

export type Dir = "up" | "down" | "left" | "right";
export type Action =
  | Dir
  | "confirm"
  | "back"
  | "grab"
  | "create"
  | "zoomIn"
  | "zoomOut"
  | "settings"
  | "fullscreen"
  | "search"
  | "theme"
  | "sound";

export const isDir = (a: Action): a is Dir => a === "up" || a === "down" || a === "left" || a === "right";

const FOCUSABLE = "button:not([disabled]), input:not([disabled]), textarea, select, a[href], [tabindex]:not([tabindex='-1'])";

/** Zone de navigation : la fenêtre ouverte la plus haute, sinon toute la page. */
export function navScope(): HTMLElement {
  const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
  return dialogs[dialogs.length - 1] ?? document.body;
}

/** Éléments atteignables, hors zones marquées `data-nav-skip` (la grille a son propre curseur). */
export function focusables(scope: HTMLElement = navScope()): HTMLElement[] {
  return [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
    if (el.closest("[data-nav-skip]")) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
  });
}

/**
 * Déplace le focus vers l'élément le plus proche dans la direction donnée, en partant de
 * l'élément actif (ou du rectangle `from`). Renvoie `false` s'il n'y a rien dans cette direction.
 */
export function moveFocus(dir: Dir, from?: DOMRect): boolean {
  const list = focusables();
  const active = document.activeElement as HTMLElement | null;
  const origin = from ?? (active && list.includes(active) ? active.getBoundingClientRect() : null);
  if (!origin) return focusFirst(list);

  const ox = origin.left + origin.width / 2;
  const oy = origin.top + origin.height / 2;
  const horizontal = dir === "left" || dir === "right";
  // Distance « bord à bord » dans la direction voulue, et écart de centres sur l'autre axe.
  const scored = list
    .filter((el) => el !== active || from)
    .map((el) => {
      const r = el.getBoundingClientRect();
      const gap =
        dir === "right" ? r.left - origin.right : dir === "left" ? origin.left - r.right : dir === "down" ? r.top - origin.bottom : origin.top - r.bottom;
      const ahead =
        dir === "right" ? r.left + r.width / 2 > ox + 1 : dir === "left" ? r.left + r.width / 2 < ox - 1 : dir === "down" ? r.top + r.height / 2 > oy + 1 : r.top + r.height / 2 < oy - 1;
      const cross = horizontal ? Math.abs(r.top + r.height / 2 - oy) : Math.abs(r.left + r.width / 2 - ox);
      const overlap = horizontal
        ? Math.min(r.bottom, origin.bottom) - Math.max(r.top, origin.top)
        : Math.min(r.right, origin.right) - Math.max(r.left, origin.left);
      return { el, gap: Math.max(0, gap), ahead, cross, overlap };
    })
    .filter((c) => c.ahead);
  if (!scored.length) return false;
  type Candidate = (typeof scored)[number];
  /** Même ligne (← →) : la plus proche. */
  const pickRow = (cands: Candidate[]) => {
    const row = cands.filter((c) => c.overlap > 0);
    return row.length ? row.reduce((x, y) => (y.gap < x.gap ? y : x)).el : null;
  };
  /** Comme sur une télé : la rangée (ou colonne) la plus proche, puis l'élément le mieux aligné. */
  const pickBand = (cands: Candidate[]) => {
    if (!cands.length) return null;
    const nearest = Math.min(...cands.map((c) => c.gap));
    const band = cands.filter((c) => c.gap <= nearest + 24);
    // Élément courant d'un groupe (`aria-current`, ex. l'onglet ouvert), puis bouton principal
    // (`data-nav-primary`, ex. « Créer ») prioritaires dans leur rangée.
    return (
      band.find((c) => c.el.hasAttribute("aria-current"))?.el ??
      band.find((c) => c.el.hasAttribute("data-nav-primary"))?.el ??
      band.reduce((x, y) => (y.cross < x.cross ? y : x)).el
    );
  };

  // Zones (`data-nav-zone`, ex. onglets / contenu des paramètres) : on reste dans la zone
  // actuelle tant qu'il y a une cible dans cette direction.
  const zone = from ? null : active?.closest("[data-nav-zone]");
  const inZone = zone ? scored.filter((c) => zone.contains(c.el)) : scored;
  const outZone = zone ? scored.filter((c) => !zone.contains(c.el)) : [];
  const best = horizontal
    ? // ← → : même ligne d'abord ; sinon la zone voisine plutôt qu'une autre ligne de la zone.
      (pickRow(inZone) ?? pickRow(scored) ?? pickBand(outZone) ?? pickBand(inZone))!
    : (pickBand(inZone.length ? inZone : scored))!;
  focusEl(best);
  return true;
}

export function focusFirst(list: HTMLElement[] = focusables()): boolean {
  const first = [...list].sort((a, b) => {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    return ra.top - rb.top || ra.left - rb.left;
  })[0];
  if (!first) return false;
  focusEl(first);
  return true;
}

function focusEl(el: HTMLElement) {
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: "nearest", inline: "nearest" });
}

export const isTextInput = (el: Element | null): el is HTMLInputElement =>
  el instanceof HTMLInputElement && ["text", "search", ""].includes(el.type);

export const isRange = (el: Element | null): el is HTMLInputElement => el instanceof HTMLInputElement && el.type === "range";

/** Modifie la valeur d'un champ comme le ferait l'utilisateur (React voit l'évènement `input`). */
export function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Curseur (range) : un vingtième de sa plage par appui. */
export function nudgeRange(input: HTMLInputElement, direction: 1 | -1) {
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const step = (max - min) / 20;
  const next = Math.min(max, Math.max(min, Number(input.value) + direction * step));
  setInputValue(input, String(Math.round(next)));
}

/** Affiche les contours de focus quand on navigue sans souris (retirés dès que la souris bouge). */
export function setNavVisible(on: boolean) {
  document.documentElement.classList.toggle("nav-mode", on);
}
