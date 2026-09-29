import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { BINDABLE, gamepadCapture, rebind, resetBindings, useBindings, type Device } from "../lib/bindings";
import { useI18n, type TFunction } from "../lib/i18n";
import { sound } from "../lib/sound";
import type { Action } from "../lib/nav";

/** Noms courts des boutons de la disposition « standard ». */
const BUTTON_NAMES = ["Ⓐ", "Ⓑ", "Ⓧ", "Ⓨ", "LB", "RB", "LT", "RT", "Select", "Start", "L3", "R3", "✚ ↑", "✚ ↓", "✚ ←", "✚ →", "Home"];
const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock", "Tab"]);

function keyLabel(key: string, t: TFunction): string {
  const named: Record<string, string> = {
    " ": t("keySpace"),
    Enter: t("keyEnter"),
    Escape: t("keyEscape"),
    Backspace: "⌫",
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
  };
  return named[key] ?? (key.length === 1 ? key.toUpperCase() : key);
}

/** Configuration des touches : dessin du clavier / de la manette et liste des actions. */
export function ControlsTab() {
  const { t } = useI18n();
  const bindings = useBindings();
  const [device, setDevice] = useState<Device>(() => (navigator.getGamepads().some((p) => p?.connected) ? "gamepad" : "keyboard"));
  const [selected, setSelected] = useState<Action>("confirm");
  const [listening, setListening] = useState<Action | null>(null);
  const [pad, setPad] = useState<string | null>(null);
  // Hauteur du dessin collant : les lignes de la liste gardent cette marge quand on y défile.
  const diagramRef = useRef<HTMLDivElement>(null);
  const [diagramHeight, setDiagramHeight] = useState(0);
  useEffect(() => {
    const el = diagramRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setDiagramHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Manette branchée ?
  useEffect(() => {
    const check = () => setPad(navigator.getGamepads().find((p) => p?.connected)?.id ?? null);
    check();
    const timer = window.setInterval(check, 1000);
    return () => clearInterval(timer);
  }, []);

  // Attente de la nouvelle touche / du nouveau bouton.
  useEffect(() => {
    if (!listening) return;
    const done = () => setListening(null);
    const onKey = (e: KeyboardEvent) => {
      // Capturé avant l'application et la fenêtre : la touche ne déclenche rien d'autre.
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return done();
      if (device !== "keyboard" || MODIFIERS.has(e.key)) return;
      rebind("keyboard", listening, e.key);
      sound.select();
      done();
    };
    window.addEventListener("keydown", onKey, true);
    if (device === "gamepad") {
      gamepadCapture.current = (button) => {
        rebind("gamepad", listening, button);
        sound.select();
        done();
      };
    }
    const timeout = window.setTimeout(done, 8000);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      gamepadCapture.current = null;
      clearTimeout(timeout);
    };
  }, [listening, device]);

  const selectedInputs = bindings[device][selected] as (string | number)[];
  const allInputs = new Set(BINDABLE.flatMap((a) => bindings[device][a] as (string | number)[]));
  const label = (v: string | number) => (typeof v === "number" ? (BUTTON_NAMES[v] ?? `#${v}`) : keyLabel(v, t));

  return (
    <section className="mb-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-black">{t("tabControls")}</h2>
        <div className="ml-auto flex rounded-full bg-surface-2 p-1">
          {(["keyboard", "gamepad"] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => {
                if (d !== device) sound.move();
                setListening(null);
                setDevice(d);
              }}
              className={`relative rounded-full px-4 py-1.5 text-sm font-extrabold ${d === device ? "text-on-accent" : "text-muted hover:text-ink"}`}
            >
              {d === device && <motion.span layoutId="device-pill" className="absolute inset-0 rounded-full bg-accent" />}
              <span className="relative">{d === "keyboard" ? t("deviceKeyboard") : t("deviceGamepad")}</span>
            </button>
          ))}
        </div>
      </div>
      <p className="mb-4 mt-1 text-sm font-bold text-muted">
        {t("controlsDesc")}
        {device === "gamepad" && <> {pad ? t("gamepadConnected", { name: pad.replace(/\s*\(.*\)$/, "") }) : t("noGamepad")}</>}
      </p>

      {/* Dessin de l'appareil : la touche de l'action choisie est allumée. Reste visible (collant)
          pendant qu'on parcourt la liste. */}
      <div ref={diagramRef} className="sticky -top-6 z-10 -mx-1 mb-3 bg-surface px-1 pb-1 pt-1">
      <div className="rounded-2xl bg-surface-2 p-4">
        {device === "keyboard" ? (
          <KeyboardDiagram highlight={selectedInputs as string[]} used={allInputs as Set<string>} t={t} />
        ) : (
          <GamepadDiagram highlight={selectedInputs as number[]} used={allInputs as Set<number>} />
        )}
        {device === "gamepad" && <p className="mt-2 text-center text-xs font-bold text-muted">{t("stickNote")}</p>}
      </div>
      </div>

      <ul className="flex flex-col gap-1.5">
        {BINDABLE.map((action) => {
          const inputs = bindings[device][action] as (string | number)[];
          const isListening = listening === action;
          return (
            <li key={action} style={{ scrollMarginTop: diagramHeight + 8 }}>
              <button
                type="button"
                style={{ scrollMarginTop: diagramHeight + 8 }}
                onMouseEnter={() => setSelected(action)}
                onFocus={() => setSelected(action)}
                onClick={() => {
                  sound.move();
                  setSelected(action);
                  setListening(isListening ? null : action);
                }}
                className={`flex w-full items-center gap-3 rounded-2xl px-4 py-2.5 text-left transition-colors ${
                  isListening ? "bg-accent text-on-accent" : selected === action ? "bg-accent-soft" : "bg-surface-2 hover:bg-accent-soft"
                }`}
              >
                <span className="min-w-0 flex-1 truncate text-sm font-extrabold">{t(`act_${action}` as Parameters<TFunction>[0])}</span>
                {isListening ? (
                  <motion.span
                    className="text-sm font-extrabold"
                    animate={{ opacity: [1, 0.4, 1] }}
                    transition={{ repeat: Infinity, duration: 1.2 }}
                  >
                    {device === "keyboard" ? t("pressKey") : t("pressButton")}
                  </motion.span>
                ) : (
                  <span className="flex flex-wrap justify-end gap-1.5">
                    {inputs.length ? (
                      inputs.map((v) => (
                        <kbd key={String(v)} className="min-w-8 rounded-lg bg-surface px-2 py-1 text-center text-xs font-black text-ink shadow-soft">
                          {label(v)}
                        </kbd>
                      ))
                    ) : (
                      <span className="text-xs font-bold text-muted">{t("unbound")}</span>
                    )}
                    <span className="ml-2 text-xs font-extrabold text-accent-strong">{t("rebind")}</span>
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={() => {
          sound.select();
          setListening(null);
          resetBindings(device);
        }}
        className="mt-4 rounded-full bg-surface-2 px-5 py-2 text-sm font-extrabold text-ink hover:bg-accent-soft"
      >
        {t("resetControls")}
      </button>
    </section>
  );
}

// ─── Dessins ─────────────────────────────────────────────────────────────────────────────

type Cap = { k: string; label?: string; w?: number };
const letters = (s: string): Cap[] => [...s].map((k) => ({ k }));

function keyboardRows(lang: "fr" | "en"): Cap[][] {
  const [r1, r2, r3] = lang === "fr" ? ["azertyuiop", "qsdfghjklm", "wxcvbn,;:!"] : ["qwertyuiop", "asdfghjkl'", "zxcvbnm,./"];
  return [
    [{ k: "Escape", w: 1.5 }, { k: "F11", w: 1.2 }, { k: "", w: 3 }, { k: "/" }, { k: "-" }, { k: "=" }, { k: "+" }, { k: "Backspace", w: 2 }],
    [{ k: "Tab", label: "Tab", w: 1.5 }, ...letters(r1)],
    [{ k: "CapsLock", label: "⇪", w: 1.8 }, ...letters(r2), { k: "Enter", w: 1.7 }],
    [{ k: "Shift", label: "⇧", w: 2.3 }, ...letters(r3)],
    [{ k: "", w: 2.5 }, { k: " ", w: 6 }, { k: "", w: 0.6 }, { k: "ArrowLeft" }, { k: "ArrowUp" }, { k: "ArrowDown" }, { k: "ArrowRight" }],
  ];
}

function KeyboardDiagram({ highlight, used, t }: { highlight: string[]; used: Set<string>; t: TFunction }) {
  const { lang } = useI18n();
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-1">
      {keyboardRows(lang).map((row, r) => (
        <div key={r} className="flex gap-1">
          {row.map((cap, c) => {
            if (!cap.k) return <div key={c} style={{ flex: cap.w ?? 1 }} />;
            const on = highlight.includes(cap.k);
            const bound = used.has(cap.k);
            return (
              <motion.div
                key={c}
                animate={{ y: on ? -2 : 0, scale: on ? 1.08 : 1 }}
                transition={{ type: "spring", stiffness: 500, damping: 26 }}
                className={`grid h-8 place-items-center rounded-md text-[11px] font-black shadow-[0_2px_0_rgba(0,0,0,0.15)] ${
                  on ? "bg-accent text-on-accent" : bound ? "bg-surface text-ink ring-2 ring-accent/40" : "bg-surface/70 text-muted"
                }`}
                style={{ flex: cap.w ?? 1 }}
              >
                {cap.label ?? keyLabel(cap.k, t)}
              </motion.div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function GamepadDiagram({ highlight, used }: { highlight: number[]; used: Set<number> }) {
  const fill = (i: number, base = "var(--surface)") => (highlight.includes(i) ? "var(--accent)" : base);
  const stroke = (i: number) => (highlight.includes(i) ? "var(--accent-strong)" : used.has(i) ? "var(--accent)" : "var(--muted)");
  const text = (i: number) => (highlight.includes(i) ? "var(--on-accent)" : "var(--ink)");
  const sw = (i: number) => (highlight.includes(i) || used.has(i) ? 3 : 1.5);
  const face: [number, string, number, number, string][] = [
    [3, "Y", 350, 92, "#e0b100"],
    [2, "X", 322, 120, "#2f7de1"],
    [1, "B", 378, 120, "#e04848"],
    [0, "A", 350, 148, "#2fa84f"],
  ];
  const dpad: [number, number, number, number, number, string][] = [
    [12, 158, 146, 22, 24, "▲"],
    [13, 158, 184, 22, 24, "▼"],
    [14, 132, 170, 26, 22, "◀"],
    [15, 180, 170, 26, 22, "▶"],
  ];
  return (
    <svg viewBox="0 0 460 270" className="mx-auto block w-full max-w-md" role="img" aria-label="Manette">
      {/* Gâchettes et boutons de tranche */}
      <rect x="100" y="6" width="70" height="20" rx="8" fill={fill(6, "var(--surface-2)")} stroke={stroke(6)} strokeWidth={sw(6)} />
      <rect x="290" y="6" width="70" height="20" rx="8" fill={fill(7, "var(--surface-2)")} stroke={stroke(7)} strokeWidth={sw(7)} />
      <rect x="88" y="30" width="92" height="22" rx="10" fill={fill(4)} stroke={stroke(4)} strokeWidth={sw(4)} />
      <rect x="280" y="30" width="92" height="22" rx="10" fill={fill(5)} stroke={stroke(5)} strokeWidth={sw(5)} />
      {[
        [6, "LT", 135, 20],
        [7, "RT", 325, 20],
        [4, "LB", 134, 45],
        [5, "RB", 326, 45],
      ].map(([i, l, x, y]) => (
        <text key={l as string} x={x as number} y={y as number} textAnchor="middle" fontSize="12" fontWeight="900" fill={text(i as number)}>
          {l}
        </text>
      ))}
      {/* Corps */}
      <path
        d="M110 56 Q230 40 350 56 Q425 66 442 150 Q456 232 402 252 Q364 264 330 222 L302 194 L158 194 L130 222 Q96 264 58 252 Q4 232 18 150 Q35 66 110 56 Z"
        fill="var(--surface)"
        stroke="var(--muted)"
        strokeOpacity="0.4"
        strokeWidth="2"
      />
      {/* Sticks */}
      <circle cx="118" cy="118" r="27" fill={fill(10, "var(--surface-2)")} stroke={stroke(10)} strokeWidth={sw(10)} />
      <circle cx="118" cy="118" r="15" fill="var(--surface)" stroke="var(--muted)" strokeOpacity="0.5" />
      <circle cx="292" cy="178" r="25" fill={fill(11, "var(--surface-2)")} stroke={stroke(11)} strokeWidth={sw(11)} />
      <circle cx="292" cy="178" r="14" fill="var(--surface)" stroke="var(--muted)" strokeOpacity="0.5" />
      {/* Croix */}
      {dpad.map(([i, x, y, w, h, l]) => (
        <g key={i}>
          <rect x={x} y={y} width={w} height={h} rx="4" fill={fill(i, "var(--surface-2)")} stroke={stroke(i)} strokeWidth={sw(i)} />
          <text x={x + w / 2} y={y + h / 2 + 4} textAnchor="middle" fontSize="10" fill={text(i)}>
            {l}
          </text>
        </g>
      ))}
      {/* Select / Home / Start */}
      <rect x="192" y="102" width="28" height="15" rx="7" fill={fill(8, "var(--surface-2)")} stroke={stroke(8)} strokeWidth={sw(8)} />
      <rect x="240" y="102" width="28" height="15" rx="7" fill={fill(9, "var(--surface-2)")} stroke={stroke(9)} strokeWidth={sw(9)} />
      <text x="206" y="132" textAnchor="middle" fontSize="9" fontWeight="800" fill="var(--muted)">SELECT</text>
      <text x="254" y="132" textAnchor="middle" fontSize="9" fontWeight="800" fill="var(--muted)">START</text>
      <circle cx="230" cy="150" r="10" fill={fill(16, "var(--surface-2)")} stroke={stroke(16)} strokeWidth={sw(16)} />
      {/* A B X Y */}
      {face.map(([i, l, x, y, color]) => (
        <g key={i}>
          <circle cx={x} cy={y} r="14" fill={highlight.includes(i) ? "var(--accent)" : color} stroke={stroke(i)} strokeWidth={sw(i)} />
          <text x={x} y={y + 5} textAnchor="middle" fontSize="14" fontWeight="900" fill="#fff">
            {l}
          </text>
        </g>
      ))}
    </svg>
  );
}
