import { useSyncExternalStore } from "react";
import type { Action } from "./nav";
import { load, save } from "./storage";

/** Actions qu'on peut réattribuer, dans l'ordre affiché dans les paramètres. */
export const BINDABLE: Action[] = [
  "up", "down", "left", "right",
  "confirm", "back", "grab", "create",
  "zoomOut", "zoomIn", "search", "settings", "fullscreen", "theme", "sound",
];

export type Device = "keyboard" | "gamepad";

export interface Bindings {
  /** Valeurs de `KeyboardEvent.key` (lettres en minuscules). */
  keyboard: Record<Action, string[]>;
  /** Index des boutons de la manette (disposition « standard » de la Gamepad API). */
  gamepad: Record<Action, number[]>;
}

export const DEFAULT_BINDINGS: Bindings = {
  keyboard: {
    up: ["ArrowUp"], down: ["ArrowDown"], left: ["ArrowLeft"], right: ["ArrowRight"],
    confirm: ["Enter"], back: ["Escape", "Backspace"], grab: [" "], create: ["n"],
    zoomOut: ["-"], zoomIn: ["+", "="], search: ["/"], settings: ["p"], fullscreen: ["F11"], theme: ["t"], sound: ["m"],
  },
  gamepad: {
    up: [12], down: [13], left: [14], right: [15],
    confirm: [0], back: [1], grab: [2], create: [3],
    zoomOut: [4], zoomIn: [5], search: [], settings: [8], fullscreen: [9], theme: [], sound: [],
  },
};

/** Les lettres sont comparées sans tenir compte de Maj. */
export const normalizeKey = (key: string) => (key.length === 1 ? key.toLowerCase() : key);

function merge(stored: Partial<Bindings> | null): Bindings {
  const pick = <T,>(device: Device) =>
    Object.fromEntries(
      BINDABLE.map((a) => {
        const saved = (stored?.[device] as Record<string, T[]> | undefined)?.[a];
        return [a, Array.isArray(saved) ? saved : (DEFAULT_BINDINGS[device] as Record<string, T[]>)[a]];
      }),
    );
  return { keyboard: pick<string>("keyboard") as Bindings["keyboard"], gamepad: pick<number>("gamepad") as Bindings["gamepad"] };
}

// Petit magasin partagé (clavier de l'app, sondage de la manette, écran des paramètres).
let current: Bindings = merge(load<Partial<Bindings> | null>("bindings", null));
const listeners = new Set<() => void>();
const publish = (next: Bindings) => {
  current = next;
  save("bindings", next);
  listeners.forEach((l) => l());
};

export const getBindings = () => current;

export function useBindings(): Bindings {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

export function keyAction(key: string): Action | null {
  const k = normalizeKey(key);
  return BINDABLE.find((a) => current.keyboard[a].includes(k)) ?? null;
}

export function buttonAction(button: number): Action | null {
  return BINDABLE.find((a) => current.gamepad[a].includes(button)) ?? null;
}

/**
 * Attribue une touche / un bouton à une action. S'il servait déjà à une autre action, les deux
 * échangent leurs touches : aucune action ne se retrouve sans commande par accident.
 */
export function rebind(device: Device, action: Action, input: string | number) {
  const value = typeof input === "string" ? normalizeKey(input) : input;
  const table = { ...current[device] } as Record<Action, (string | number)[]>;
  const previous = table[action];
  for (const other of BINDABLE) {
    if (other !== action && table[other].includes(value)) {
      table[other] = [...table[other].filter((v) => v !== value), ...previous.filter((v) => !table[other].includes(v))].slice(0, 2);
    }
  }
  table[action] = [value];
  publish({ ...current, [device]: table });
}

export function resetBindings(device?: Device) {
  publish(device ? { ...current, [device]: DEFAULT_BINDINGS[device] } : DEFAULT_BINDINGS);
}

/**
 * Capture en cours dans les paramètres : le prochain bouton de manette est envoyé ici au lieu
 * de déclencher une action (le clavier est capturé directement par l'écran des paramètres).
 */
export const gamepadCapture: { current: ((button: number) => void) | null } = { current: null };
