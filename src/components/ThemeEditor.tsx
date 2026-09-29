import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { useI18n, type TFunction } from "../lib/i18n";
import { sound } from "../lib/sound";
import { hexToHsl, hslToHex } from "../themes/color";
import { PANEL_STYLES, PATTERNS, readabilityIssues, themeName, themeStyle, type ThemeDef } from "../themes/format";

interface Props {
  initial: ThemeDef;
  isNew: boolean;
  /** À chaque modification : l'application affiche le thème en direct. */
  onChange: (def: ThemeDef) => void;
  onSave: (def: ThemeDef) => void;
  onCancel: () => void;
}

type ColorKey = keyof ThemeDef["colors"];
const COLOR_KEYS: ColorKey[] = ["background", "background2", "surface", "text", "accent"];
const MAX_IMAGE = 1600;

/**
 * Éditeur de thème, en panneau latéral : l'interface derrière sert d'aperçu en direct.
 * Tout se règle aussi à la manette (curseurs ← →, boutons, clavier virtuel pour le nom).
 */
export function ThemeEditor({ initial, isNew, onChange, onSave, onCancel }: Props) {
  const { t, lang } = useI18n();
  const [def, setDef] = useState<ThemeDef>(initial);
  const [name, setName] = useState(themeName(initial, lang));
  const [openColor, setOpenColor] = useState<ColorKey | "pattern" | null>("accent");
  const fileRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const update = (patch: (d: ThemeDef) => ThemeDef) => setDef((d) => patch(d));
  useEffect(() => onChange(def), [def, onChange]);
  useEffect(() => panelRef.current?.focus(), []);

  const issues = readabilityIssues(def);

  const pickImage = async (file: File) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => null);
    const scale = Math.min(1, MAX_IMAGE / Math.max(img.naturalWidth, img.naturalHeight, 1));
    const canvas = Object.assign(document.createElement("canvas"), {
      width: Math.round(img.naturalWidth * scale),
      height: Math.round(img.naturalHeight * scale),
    });
    canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    const data = canvas.toDataURL("image/jpeg", 0.82);
    update((d) => ({ ...d, image: data }));
    sound.select();
  };

  const submit = () => {
    sound.select();
    onSave({ ...def, name: name.trim() || themeName(initial, lang) });
  };

  return (
    <motion.div
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-label={isNew ? t("editorTitleNew") : t("editorTitleEdit")}
      className="fixed inset-y-3 right-3 z-50 flex w-[400px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-panel bg-surface shadow-pop outline-none ring-1 ring-muted/20"
      initial={{ x: 40, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 40, opacity: 0 }}
      transition={{ type: "spring", stiffness: 420, damping: 34 }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <div className="flex items-center gap-3 border-b border-muted/15 p-4">
        <div className="h-12 w-16 shrink-0 overflow-hidden rounded-xl" style={themeStyle(def)} data-theme="custom">
          <div className="theme-bg h-full w-full p-1.5">
            <div className="h-full rounded-md bg-surface p-1">
              <div className="h-2 w-6 rounded-full bg-accent" />
            </div>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-extrabold uppercase tracking-wide text-muted">{isNew ? t("editorTitleNew") : t("editorTitleEdit")}</p>
          <input
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            aria-label={t("themeNameLabel")}
            placeholder={t("themeNameLabel")}
            className="w-full rounded-xl bg-surface-2 px-3 py-1.5 text-lg font-black text-ink outline-none focus:ring-3 focus:ring-accent"
          />
        </div>
      </div>

      <div className="soft-scroll min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <Toggle label={t("themeDarkLabel")} on={def.dark} onChange={() => update((d) => ({ ...d, dark: !d.dark }))} />

        <Group title={t("sectionColors")}>
          {COLOR_KEYS.map((key) => (
            <ColorField
              key={key}
              label={t(`color_${key}` as Parameters<TFunction>[0])}
              value={def.colors[key]}
              open={openColor === key}
              onToggle={() => setOpenColor(openColor === key ? null : key)}
              onChange={(v) => update((d) => ({ ...d, colors: { ...d.colors, [key]: v } }))}
            />
          ))}
        </Group>

        <Group title={t("sectionPattern")}>
          <div className="flex flex-wrap gap-1.5">
            {PATTERNS.map((p) => (
              <Chip key={p} active={def.pattern.type === p} onClick={() => update((d) => ({ ...d, pattern: { ...d.pattern, type: p } }))}>
                {t(`pat_${p}` as Parameters<TFunction>[0])}
              </Chip>
            ))}
          </div>
          {def.pattern.type !== "none" && (
            <>
              {def.pattern.type !== "snes" && (
                <ColorField
                  label={t("patternColor")}
                  value={def.pattern.color}
                  open={openColor === "pattern"}
                  onToggle={() => setOpenColor(openColor === "pattern" ? null : "pattern")}
                  onChange={(v) => update((d) => ({ ...d, pattern: { ...d.pattern, color: v } }))}
                />
              )}
              <Slider label={t("opacity")} min={0} max={100} value={Math.round(def.pattern.opacity * 100)} suffix="%" onChange={(v) => update((d) => ({ ...d, pattern: { ...d.pattern, opacity: v / 100 } }))} />
              <Slider label={t("size")} min={6} max={96} value={def.pattern.size} suffix="px" onChange={(v) => update((d) => ({ ...d, pattern: { ...d.pattern, size: v } }))} />
            </>
          )}
        </Group>

        <Group title={t("sectionShape")}>
          <Slider label={t("tileRadius")} min={0} max={40} value={def.shape.tileRadius} suffix="px" onChange={(v) => update((d) => ({ ...d, shape: { ...d.shape, tileRadius: v } }))} />
          <Slider label={t("panelRadius")} min={0} max={48} value={def.shape.panelRadius} suffix="px" onChange={(v) => update((d) => ({ ...d, shape: { ...d.shape, panelRadius: v } }))} />
          <div className="flex items-center gap-2">
            <span className="w-32 shrink-0 text-sm font-extrabold">{t("panelStyle")}</span>
            <div className="flex flex-wrap gap-1.5">
              {PANEL_STYLES.map((style) => (
                <Chip key={style} active={def.shape.panelStyle === style} onClick={() => update((d) => ({ ...d, shape: { ...d.shape, panelStyle: style } }))}>
                  {t(`panel_${style}` as Parameters<TFunction>[0])}
                </Chip>
              ))}
            </div>
          </div>
        </Group>

        <Group title={t("sectionImage")}>
          <div className="flex flex-wrap items-center gap-2">
            {def.image && <img src={def.image} alt="" className="h-12 w-20 rounded-lg object-cover" />}
            <Chip onClick={() => fileRef.current?.click()}>{t("chooseImage")}</Chip>
            {def.image && <Chip onClick={() => update((d) => ({ ...d, image: undefined }))}>{t("removeImage")}</Chip>}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              data-nav-skip
              tabIndex={-1}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void pickImage(file);
                e.target.value = "";
              }}
            />
          </div>
          <p className="text-xs font-bold text-muted">{t("imageHint")}</p>
        </Group>

        {issues.length > 0 && (
          <div className="space-y-1 rounded-2xl bg-[#f59e0b]/15 p-3 text-sm font-bold text-ink">
            {issues.includes("text") && <p>⚠ {t("warnText")}</p>}
            {issues.includes("accent") && <p>⚠ {t("warnAccent")}</p>}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-muted/15 p-4">
        <button type="button" onClick={onCancel} className="rounded-full px-5 py-2.5 font-extrabold text-muted hover:bg-surface-2">
          {t("cancel")}
        </button>
        <button type="button" data-nav-primary onClick={submit} className="rounded-full bg-accent px-6 py-2.5 font-extrabold text-on-accent shadow-soft">
          {t("saveTheme")}
        </button>
      </div>
    </motion.div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h3 className="text-xs font-black uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </section>
  );
}

function Chip({ children, active, onClick }: { children: ReactNode; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        sound.move();
        onClick();
      }}
      className={`rounded-full px-3 py-1.5 text-sm font-extrabold transition-colors ${
        active ? "bg-accent text-on-accent" : "bg-surface-2 text-ink hover:bg-accent-soft"
      }`}
    >
      {children}
    </button>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onChange} className="flex w-full items-center justify-between rounded-2xl bg-surface-2 px-4 py-3">
      <span className="text-sm font-extrabold">{label}</span>
      <span className={`relative h-7 w-12 rounded-full transition-colors ${on ? "bg-accent" : "bg-muted/30"}`}>
        <motion.span className="absolute top-1 h-5 w-5 rounded-full bg-white shadow" animate={{ left: on ? 24 : 4 }} />
      </span>
    </button>
  );
}

function Slider({
  label,
  min,
  max,
  value,
  suffix = "",
  onChange,
  background,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  suffix?: string;
  onChange: (v: number) => void;
  background?: string;
}) {
  return (
    <label className="flex items-center gap-3">
      <span className="w-32 shrink-0 text-sm font-extrabold">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`h-2.5 min-w-0 flex-1 cursor-pointer rounded-full ${background ? "appearance-none" : "accent-(--accent)"}`}
        style={background ? { background } : undefined}
      />
      <span className="w-12 text-right text-xs font-bold tabular-nums text-muted">
        {value}
        {suffix}
      </span>
    </label>
  );
}

/** Couleur : pastille (sélecteur natif à la souris) + curseurs teinte / saturation / luminosité. */
function ColorField({
  label,
  value,
  open,
  onToggle,
  onChange,
}: {
  label: string;
  value: string;
  open: boolean;
  onToggle: () => void;
  onChange: (v: string) => void;
}) {
  const { t } = useI18n();
  const [h, s, l] = hexToHsl(value);
  return (
    <div className="rounded-2xl bg-surface-2">
      <div className="flex items-center gap-3 px-3 py-2">
        <label className="relative h-8 w-8 shrink-0 cursor-pointer rounded-full shadow-soft ring-2 ring-surface" style={{ background: value }}>
          <input type="color" value={value} data-nav-skip tabIndex={-1} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
        </label>
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-center justify-between text-left">
          <span className="text-sm font-extrabold">{label}</span>
          <span className="font-mono text-xs font-bold uppercase text-muted">
            {value} {open ? "▴" : "▾"}
          </span>
        </button>
      </div>
      {open && (
        <div className="space-y-2 px-3 pb-3">
          <Slider label={t("hue")} min={0} max={360} value={h} onChange={(v) => onChange(hslToHex(v, s, l))}
            background={`linear-gradient(90deg, ${[0, 60, 120, 180, 240, 300, 360].map((x) => hslToHex(x, Math.max(s, 40), 55)).join(", ")})`} />
          <Slider label={t("saturation")} min={0} max={100} value={s} suffix="%" onChange={(v) => onChange(hslToHex(h, v, l))}
            background={`linear-gradient(90deg, ${hslToHex(h, 0, l)}, ${hslToHex(h, 100, l)})`} />
          <Slider label={t("lightness")} min={0} max={100} value={l} suffix="%" onChange={(v) => onChange(hslToHex(h, s, v))}
            background={`linear-gradient(90deg, #000000, ${hslToHex(h, s, 50)}, #ffffff)`} />
        </div>
      )}
    </div>
  );
}
