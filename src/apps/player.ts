import { useSyncExternalStore } from "react";
import { mediaSrc } from "../lib/api";
import { load, save } from "../lib/storage";
import type { Track } from "../types";

/**
 * Le lecteur de musique, partagé par toute l'interface : on ferme l'appli, la musique continue,
 * et la barre du haut la montre. Un seul élément <audio>, une file de lecture, et un petit magasin
 * auquel les composants s'abonnent.
 */
export interface PlayerState {
  queue: Track[];
  index: number;
  playing: boolean;
  /** Position et durée de la piste, en secondes. */
  time: number;
  duration: number;
  volume: number;
}

let state: PlayerState = { queue: [], index: -1, playing: false, time: 0, duration: 0, volume: load("music.volume", 0.8) };
const listeners = new Set<() => void>();
const publish = (patch: Partial<PlayerState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

let audio: HTMLAudioElement | null = null;
function element(): HTMLAudioElement {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = "auto";
  audio.volume = state.volume;
  audio.addEventListener("timeupdate", () => publish({ time: audio!.currentTime }));
  audio.addEventListener("durationchange", () => publish({ duration: Number.isFinite(audio!.duration) ? audio!.duration : 0 }));
  audio.addEventListener("play", () => publish({ playing: true }));
  audio.addEventListener("pause", () => publish({ playing: false }));
  // Fin de piste : la suivante, et à la fin de la file, on s'arrête.
  audio.addEventListener("ended", () => (state.index < state.queue.length - 1 ? player.next() : publish({ playing: false })));
  return audio;
}

function cue(index: number, autoplay: boolean) {
  const track = state.queue[index];
  if (!track) return;
  const el = element();
  el.src = mediaSrc(track.path);
  publish({ index, time: 0, duration: 0 });
  if (autoplay) void el.play().catch(() => publish({ playing: false }));
}

export const player = {
  /** Joue `queue` à partir de la piste `index`. */
  play(queue: Track[], index: number) {
    publish({ queue });
    cue(index, true);
  },
  toggle() {
    const el = element();
    if (state.index < 0) return;
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  },
  pause() {
    audio?.pause();
  },
  next() {
    if (state.index < state.queue.length - 1) cue(state.index + 1, true);
  },
  /** Au-delà de trois secondes, « précédent » revient au début de la piste, comme partout. */
  previous() {
    const el = element();
    if (el.currentTime > 3 || state.index <= 0) el.currentTime = 0;
    else cue(state.index - 1, true);
  },
  seek(seconds: number) {
    const el = element();
    el.currentTime = Math.max(0, Math.min(seconds, state.duration || seconds));
  },
  setVolume(volume: number) {
    const v = Math.max(0, Math.min(1, volume));
    element().volume = v;
    save("music.volume", v);
    publish({ volume: v });
  },
};

export function usePlayer(): PlayerState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export const currentTrack = (s: PlayerState): Track | null => s.queue[s.index] ?? null;

/** État du lecteur hors de React (l'aperçu des jeux vérifie qu'il ne couvre pas la musique). */
export const currentPlayerState = () => state;

/** « 3:07 ». */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
