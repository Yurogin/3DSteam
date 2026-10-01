/**
 * Bruitages synthétisés en direct avec la Web Audio API : aucun fichier audio,
 * latence minimale, et des sons « pop / clic » dans l'esprit d'un menu de console.
 */

import { load, save } from "./storage";

interface Tone {
  freq: number;
  /** Fréquence d'arrivée (glissando exponentiel). */
  to?: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
  delay?: number;
  attack?: number;
}

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastHover = 0;

  enabled = load("sound", true);
  volume = load("volume", 0.7);

  /** À appeler sur le premier geste utilisateur : les navigateurs bloquent l'audio avant. */
  unlock() {
    this.context();
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    save("sound", on);
    if (on) this.toggle();
  }

  /** 0 à 1. */
  setVolume(v: number) {
    this.volume = Math.min(1, Math.max(0, v));
    save("volume", this.volume);
    if (this.master) this.master.gain.value = this.volume;
  }

  private context(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext({ latencyHint: "interactive" });
      } catch {
        return null;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  private tone({ freq, to, dur, type = "sine", gain = 0.2, delay = 0, attack = 0.004 }: Tone) {
    const ctx = this.context();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(env).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** Petit « tic » de bruit filtré, qui donne du mordant aux pops. */
  private click(gain = 0.06, delay = 0) {
    const ctx = this.context();
    if (!ctx || !this.master) return;
    if (!this.noise) {
      const len = Math.floor(ctx.sampleRate * 0.015);
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    const hp = ctx.createBiquadFilter();
    const env = ctx.createGain();
    src.buffer = this.noise;
    hp.type = "highpass";
    hp.frequency.value = 2500;
    env.gain.value = gain;
    src.connect(hp).connect(env).connect(this.master);
    src.start(t);
  }

  /** Survol à la souris : très court et limité en fréquence pour ne pas mitrailler. */
  hover() {
    const now = performance.now();
    if (now - this.lastHover < 45) return;
    this.lastHover = now;
    this.tone({ freq: 1900, to: 2300, dur: 0.035, type: "triangle", gain: 0.045 });
  }

  /** Déplacement au clavier / à la manette. */
  move() {
    this.tone({ freq: 1250, to: 1600, dur: 0.045, type: "triangle", gain: 0.08 });
  }

  /** Sélection : le « pop » caractéristique. */
  select() {
    this.tone({ freq: 420, to: 920, dur: 0.09, gain: 0.24 });
    this.click(0.05);
  }

  /** Lancement : petit arpège montant + scintillement. */
  launch() {
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) =>
      this.tone({ freq, dur: 0.24, type: "triangle", gain: 0.15, delay: i * 0.07 }),
    );
    this.tone({ freq: 2093, dur: 0.6, gain: 0.05, delay: 0.3, attack: 0.02 });
  }

  /** Souffle de bruit filtré dont la fréquence glisse : l'élan d'une icône qui s'envole. */
  private whoosh(from: number, to: number, dur: number, gain: number, delay = 0) {
    const ctx = this.context();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime + delay;
    const len = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    const band = ctx.createBiquadFilter();
    const env = ctx.createGain();
    src.buffer = buffer;
    band.type = "bandpass";
    band.Q.value = 1.2;
    band.frequency.setValueAtTime(from, t);
    band.frequency.exponentialRampToValueAtTime(to, t + dur);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + dur * 0.6);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(band).connect(env).connect(this.master);
    src.start(t);
  }

  /**
   * Lancement d'un jeu, en grand : l'élan, l'impact quand l'icône se pose (grave + éclat), un
   * accord qui s'ouvre, puis le souffle de la plongée finale. Calé sur `LaunchSplash`.
   */
  launchBig() {
    this.whoosh(300, 2400, 0.42, 0.18);
    this.tone({ freq: 140, to: 48, dur: 0.5, type: "sine", gain: 0.32, delay: 0.38 });
    this.click(0.12, 0.38);
    [261.63, 392, 523.25, 659.25, 783.99].forEach((freq, i) =>
      this.tone({ freq, dur: 0.9, type: "triangle", gain: 0.09, delay: 0.5 + i * 0.045, attack: 0.02 }),
    );
    this.tone({ freq: 1567.98, dur: 0.6, gain: 0.05, delay: 0.62, attack: 0.03 });
    this.whoosh(500, 6000, 0.5, 0.14, 1.72);
    this.tone({ freq: 1046.5, to: 2093, dur: 0.35, type: "triangle", gain: 0.06, delay: 1.85 });
  }

  /** Un jeu en cours d'installation se pose sur le plateau : petite chute, rebond. */
  arrive() {
    this.tone({ freq: 1320, to: 520, dur: 0.16, type: "triangle", gain: 0.1 });
    this.tone({ freq: 700, to: 980, dur: 0.08, gain: 0.12, delay: 0.16 });
    this.click(0.04, 0.16);
  }

  /** Prêt à jouer : fanfare de poche et pluie d'étincelles. */
  ready() {
    this.tone({ freq: 380, to: 1500, dur: 0.22, type: "triangle", gain: 0.09 });
    [783.99, 987.77, 1174.66, 1567.98].forEach((freq, i) =>
      this.tone({ freq, dur: 0.22, type: "triangle", gain: 0.13, delay: 0.12 + i * 0.075 }),
    );
    this.tone({ freq: 2349.3, dur: 0.5, gain: 0.05, delay: 0.42, attack: 0.02 });
    [3136, 2637, 3520].forEach((freq, i) => this.tone({ freq, dur: 0.12, gain: 0.03, delay: 0.48 + i * 0.09 }));
  }

  /** Désinstallation, premier temps : la tuile craque. */
  crack() {
    [0, 0.07, 0.16].forEach((delay, i) => this.click(0.09 - i * 0.02, delay));
    this.tone({ freq: 190, to: 120, dur: 0.12, type: "square", gain: 0.035, delay: 0.02 });
  }

  /** Puis elle vole en éclats : fracas de verre, chute grave. */
  shatter() {
    for (let i = 0; i < 7; i++) this.click(0.08 * (1 - i / 9), i * 0.035);
    [2600, 3300, 2100, 3900].forEach((freq, i) => this.tone({ freq, to: freq * 0.7, dur: 0.09, type: "triangle", gain: 0.04, delay: 0.02 + i * 0.05 }));
    this.tone({ freq: 300, to: 70, dur: 0.45, type: "sine", gain: 0.16 });
  }

  zoom(direction: 1 | -1) {
    const [a, b] = direction > 0 ? [660, 990] : [990, 660];
    this.tone({ freq: a, dur: 0.06, type: "triangle", gain: 0.12 });
    this.tone({ freq: b, dur: 0.08, type: "triangle", gain: 0.12, delay: 0.055 });
  }

  theme() {
    [523.25, 659.25, 783.99].forEach((freq, i) =>
      this.tone({ freq, dur: 0.35, gain: 0.07, delay: i * 0.03, attack: 0.01 }),
    );
  }

  toggle() {
    this.tone({ freq: 880, to: 1320, dur: 0.07, gain: 0.12 });
  }

  error() {
    this.tone({ freq: 240, to: 180, dur: 0.14, type: "square", gain: 0.05 });
    this.tone({ freq: 200, to: 150, dur: 0.18, type: "square", gain: 0.05, delay: 0.15 });
  }
}

export const sound = new SoundEngine();
