import { load, save } from "./storage";

/**
 * Musique du menu, comme celle d'un menu de console : douce, discrète, et générée à la volée
 * (Web Audio) — aucun fichier, aucun droit d'auteur, et elle ne se répète jamais tout à fait.
 *
 * Quatre accords chauds (Do maj7, La m7, Fa maj7, Sol 6) sur une nappe feutrée, une basse légère,
 * une mélodie pincée qui change à chaque tour, une cloche de temps en temps, un peu d'écho. Elle
 * reste en retrait : volume bas par défaut, et elle s'efface d'elle-même (voir `Duck`) dès que
 * quelque chose d'autre a la parole.
 */

/** Ce qui fait taire la musique, le temps qu'il dure. */
export type Duck = "player" | "launch" | "away" | "muted";

const BPM = 84;
const EIGHTH = 60 / BPM / 2;
/** Ordonnancement : on programme les notes un peu à l'avance, par petites tranches. */
const LOOKAHEAD = 0.6;
const TICK_MS = 120;
/** La musique reste sous les bruitages. */
const LEVEL = 0.2;

/** Fréquence d'une note MIDI. */
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** Do maj7, La m7, Fa maj7, Sol 6 : une boucle de quatre mesures. */
const CHORDS = [
  [48, 52, 55, 59],
  [45, 48, 52, 55],
  [41, 45, 48, 52],
  [43, 47, 50, 52],
];
/** Rythme de la mélodie sur une mesure de huit croches (1 = une note), varié à chaque tour. */
const RHYTHMS = [
  [1, 0, 1, 0, 1, 1, 0, 0],
  [1, 0, 0, 1, 0, 1, 0, 1],
  [0, 1, 0, 1, 1, 0, 1, 0],
  [1, 1, 0, 0, 1, 0, 1, 0],
];

class MenuMusic {
  enabled = load("menuMusic", true);
  volume = load("menuMusic.volume", 0.35);
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bus: AudioNode | null = null;
  private ducks = new Set<Duck>();
  private timer = 0;
  private next = 0;
  private step = 0;
  /** Note précédente de la mélodie : elle avance par petits pas, sans grands sauts. */
  private melody = 72;
  private seed = 7;

  private random() {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  /** À appeler au démarrage, puis au premier geste (un navigateur bloque le son avant). */
  start() {
    if (!this.enabled) return;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext({ latencyHint: "playback" });
      } catch {
        return;
      }
      const ctx = this.ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0;
      // Un filtre doux et un écho léger : la musique reste au fond, comme dans une pièce.
      const soften = ctx.createBiquadFilter();
      soften.type = "lowpass";
      soften.frequency.value = 2600;
      const delay = ctx.createDelay();
      delay.delayTime.value = EIGHTH * 3;
      const feedback = ctx.createGain();
      feedback.gain.value = 0.28;
      const wet = ctx.createGain();
      wet.gain.value = 0.3;
      soften.connect(this.master);
      soften.connect(delay);
      delay.connect(feedback).connect(delay);
      delay.connect(wet).connect(this.master);
      this.master.connect(ctx.destination);
      this.bus = soften;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => {});
    if (!this.timer) {
      this.next = this.ctx.currentTime + 0.1;
      this.timer = window.setInterval(() => this.tick(), TICK_MS);
    }
    this.level();
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    save("menuMusic", on);
    if (on) this.start();
    else this.level();
  }

  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
    save("menuMusic.volume", this.volume);
    this.level();
  }

  /** Fait taire (ou rend la parole à) la musique pour `reason`. */
  duck(reason: Duck, on: boolean) {
    if (on === this.ducks.has(reason)) return;
    if (on) this.ducks.add(reason);
    else this.ducks.delete(reason);
    this.level();
  }

  /** Fondu vers le niveau voulu ; à zéro un moment, la programmation s'arrête. */
  private level() {
    if (!this.ctx || !this.master) return;
    const target = this.enabled && this.ducks.size === 0 ? this.volume * LEVEL : 0;
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, target > 0 ? 0.8 : 0.25);
  }

  private tick() {
    const ctx = this.ctx;
    if (!ctx) return;
    // Silencieuse : inutile de programmer des notes que personne n'entend.
    if (!this.enabled || this.ducks.size > 0) {
      this.next = Math.max(this.next, ctx.currentTime + 0.1);
      return;
    }
    while (this.next < ctx.currentTime + LOOKAHEAD) {
      this.play(this.step, this.next);
      this.next += EIGHTH;
      this.step++;
    }
  }

  private play(step: number, time: number) {
    const eighth = step % 8;
    const bar = Math.floor(step / 8);
    const chord = CHORDS[bar % CHORDS.length];
    const loop = Math.floor(bar / CHORDS.length);
    if (eighth === 0) {
      // La nappe : l'accord entier, qui s'installe doucement et tient la mesure.
      for (const note of chord) this.voice(hz(note + 12), time, EIGHTH * 8.5, { type: "triangle", gain: 0.035, attack: 0.5 });
      // Une cloche toutes les deux mesures.
      if (bar % 2 === 0) this.voice(hz(chord[3] + 24), time, 2.4, { type: "sine", gain: 0.03, attack: 0.01 });
    }
    // La basse, sur les temps forts.
    if (eighth === 0 || eighth === 4) this.voice(hz(chord[0] - 12), time, EIGHTH * 3, { type: "sine", gain: 0.09, attack: 0.02 });
    // La mélodie : des notes de l'accord, en marchant vers la plus proche.
    if (RHYTHMS[(bar + loop) % RHYTHMS.length][eighth]) {
      const pool = [...chord, ...chord.map((n) => n + 12)].map((n) => n + 24).filter((n) => n >= 64 && n <= 84);
      const near = pool.sort((a, b) => Math.abs(a - this.melody) - Math.abs(b - this.melody)).slice(0, 3);
      this.melody = near[Math.floor(this.random() * near.length)];
      this.voice(hz(this.melody), time, 0.5, { type: "sine", gain: 0.05, attack: 0.005 });
      this.voice(hz(this.melody) * 2, time, 0.18, { type: "sine", gain: 0.012, attack: 0.005 });
    }
  }

  private voice(freq: number, time: number, dur: number, { type, gain, attack }: { type: OscillatorType; gain: number; attack: number }) {
    const ctx = this.ctx;
    if (!ctx || !this.bus) return;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    env.gain.setValueAtTime(0.0001, time);
    env.gain.exponentialRampToValueAtTime(gain, time + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(env).connect(this.bus);
    osc.start(time);
    osc.stop(time + dur + 0.05);
  }
}

export const menuMusic = new MenuMusic();
