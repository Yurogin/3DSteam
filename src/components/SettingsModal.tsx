import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { ThemeApi, ThemeEntry } from "../themes/themes";
import { parseTheme, serializeTheme, slug, themeName, themeStyle, type ThemeDef } from "../themes/format";
import { openThemesDir, saveThemeFile } from "../lib/api";
import { LANGS, useI18n } from "../lib/i18n";
import { sound } from "../lib/sound";
import { placedGames } from "../lib/board";
import type { CursorStyle } from "../lib/cursorStyle";
import { useIconStyle } from "../lib/iconStyle";
import type { Preset } from "../lib/presets";
import { ControlsTab } from "./ControlsTab";

export type Tab = "theme" | "presets" | "controls" | "language" | "general" | "data";

interface Props {
  themes: ThemeApi;
  /** Ouvre l'éditeur de thème (la fenêtre des paramètres se ferme le temps de l'édition). */
  onEditTheme: (def: ThemeDef, isNew: boolean) => void;
  notify: (message: string) => void;
  initialTab?: Tab;
  soundOn: boolean;
  onToggleSound: () => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  cursorStyle: CursorStyle;
  onCursorStyle: (style: CursorStyle) => void;
  onResetLayout: () => void;
  onResetPrefs: () => void;
  onClearCache: () => void;
  onResetAll: () => void;
  presets: Preset[];
  onSavePreset: (name: string) => void;
  onLoadPreset: (id: string) => void;
  onOverwritePreset: (id: string) => void;
  onRenamePreset: (id: string, name: string) => void;
  onDeletePreset: (id: string) => void;
  onClose: () => void;
}

/** Fenêtre des paramètres : thème, sauvegardes, langue, sons / plein écran, réinitialisations. */
export function SettingsModal(props: Props) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>(props.initialTab ?? "theme");
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const tabs: { id: Tab; label: string }[] = [
    { id: "theme", label: t("tabTheme") },
    { id: "presets", label: t("tabPresets") },
    { id: "controls", label: t("tabControls") },
    { id: "language", label: t("tabLanguage") },
    { id: "general", label: t("tabGeneral") },
    { id: "data", label: t("tabData") },
  ];

  return (
    <motion.div
      className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4 backdrop-blur-[2px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}
    >
      <motion.div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-label={t("settings")}
        className="flex h-[min(620px,88vh)] w-full max-w-4xl overflow-hidden rounded-panel bg-surface shadow-pop outline-none"
        initial={{ scale: 0.92, y: 16 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.96, y: 8 }}
        transition={{ type: "spring", stiffness: 420, damping: 32 }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            props.onClose();
          }
        }}
      >
        {/* Onglets */}
        <nav data-nav-zone className="flex w-48 shrink-0 flex-col gap-1 bg-surface-2 p-4">
          <p className="mb-3 px-3 text-lg font-black">{t("settings")}</p>
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={tab === item.id ? "page" : undefined}
              onMouseEnter={() => sound.hover()}
              onClick={() => {
                if (item.id !== tab) sound.move();
                setTab(item.id);
              }}
              className={`relative rounded-full px-4 py-2 text-left text-sm font-extrabold transition-colors ${
                tab === item.id ? "text-on-accent" : "text-muted hover:text-ink"
              }`}
            >
              {tab === item.id && (
                <motion.span
                  layoutId="settings-tab"
                  className="absolute inset-0 rounded-full bg-accent"
                  transition={{ type: "spring", stiffness: 500, damping: 36 }}
                />
              )}
              <span className="relative">{item.label}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={props.onClose}
            className="mt-auto rounded-full px-4 py-2 text-left text-sm font-extrabold text-muted hover:text-ink"
          >
            {t("closeEsc")}
          </button>
        </nav>

        {/* Contenu */}
        <div data-nav-zone className="soft-scroll min-w-0 flex-1 overflow-y-auto p-6">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={tab}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.15 }}
            >
              {tab === "theme" && <ThemeTab {...props} />}
              {tab === "presets" && <PresetsTab {...props} />}
              {tab === "controls" && <ControlsTab />}
              {tab === "language" && <LanguageTab />}
              {tab === "general" && <GeneralTab {...props} />}
              {tab === "data" && <DataTab {...props} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="text-xl font-black">{title}</h2>
      {description && <p className="mb-4 mt-1 text-sm font-bold text-muted">{description}</p>}
      {children}
    </section>
  );
}

function ThemeTab({ themes, onEditTheme, notify }: Props) {
  const { t, lang } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const { current } = themes;
  const editable = current.source === "user";

  /** Ajoute un thème lu (fichier ou code collé) aux thèmes perso, puis l'applique. */
  const importText = (text: string) => {
    const def = parseTheme(text);
    if (!def) return notify(t("themeInvalid"));
    const exists = themes.entries.some((e) => e.def?.id === def.id);
    const saved = exists ? { ...def, id: themes.freeId(def.id) } : def;
    themes.saveUserTheme(saved);
    sound.theme();
    notify(t("themeImported", { name: themeName(saved, lang) }));
  };

  const exportCurrent = async () => {
    const def = current.def ?? { ...current.seed, id: themes.freeId(current.seed.id) };
    try {
      const path = await saveThemeFile(def.id, serializeTheme(def));
      sound.select();
      notify(t("themeExported", { path }));
      void themes.reloadFolder();
    } catch (e) {
      notify(String(e));
    }
  };

  const copyCurrent = async () => {
    const def = current.def ?? current.seed;
    try {
      await navigator.clipboard.writeText(serializeTheme(def));
      sound.select();
      notify(t("themeCopied"));
    } catch {
      notify(t("clipboardError"));
    }
  };

  const pasteTheme = async () => {
    try {
      importText(await navigator.clipboard.readText());
    } catch {
      notify(t("clipboardError"));
    }
  };

  const badge = (source: ThemeEntry["source"], isDef: boolean) =>
    source === "user" ? t("badgeUser") : source === "folder" ? t("badgeFolder") : isDef ? t("badgeFormat") : null;

  return (
    <Section title={t("tabTheme")} description={t("themeDesc")}>
      {/* Création / partage */}
      <div className="mb-4 flex flex-wrap gap-2">
        <ActionButton
          primary
          title={t("createThemeHint")}
          onClick={() => onEditTheme({ ...current.seed, id: themes.freeId(slug(`${current.label(lang)}-perso`)), name: `${current.label(lang)} perso` }, true)}
        >
          {t("createTheme")}
        </ActionButton>
        {editable && current.def && <ActionButton onClick={() => onEditTheme(current.def!, false)}>{t("editTheme")}</ActionButton>}
        <ActionButton onClick={() => void exportCurrent()}>{t("exportTheme")}</ActionButton>
        <ActionButton onClick={() => void copyCurrent()}>{t("copyTheme")}</ActionButton>
        <ActionButton onClick={() => fileRef.current?.click()}>{t("importTheme")}</ActionButton>
        <ActionButton onClick={() => void pasteTheme()}>{t("pasteTheme")}</ActionButton>
        <ActionButton onClick={() => void openThemesDir()}>{t("themesFolder")}</ActionButton>
        {editable && (
          <ConfirmButton
            label={t("deleteTheme")}
            strong
            onConfirm={() => {
              themes.deleteUserTheme(current.id);
              notify(t("themeDeleted", { name: current.label(lang) }));
            }}
          />
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".3dstheme,.json,application/json"
          data-nav-skip
          tabIndex={-1}
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) importText(await file.text());
          }}
        />
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4">
        {themes.entries.map((item) => {
          const active = item.id === current.id;
          const tag = badge(item.source, item.def != null);
          return (
            <motion.button
              key={item.id}
              type="button"
              aria-current={active ? "true" : undefined}
              onMouseEnter={() => sound.hover()}
              onClick={() => {
                if (!active) {
                  sound.theme();
                  themes.setTheme(item.id);
                }
              }}
              whileHover={{ y: -3 }}
              whileTap={{ scale: 0.96 }}
              className={`group rounded-[20px] p-1 text-left transition-shadow ${active ? "ring-4 ring-accent" : "ring-1 ring-muted/20 hover:ring-muted/50"}`}
            >
              <ThemePreview entry={item} />
              <div className="flex items-center justify-between gap-1 px-2 pb-1 pt-2">
                <span className="truncate text-sm font-extrabold">{item.label(lang)}</span>
                <span className="shrink-0 text-[11px] font-bold text-muted">{tag ?? (item.dark ? t("themeDark") : t("themeLight"))}</span>
              </div>
            </motion.button>
          );
        })}
      </div>
    </Section>
  );
}

function ActionButton({ children, onClick, primary, title }: { children: ReactNode; onClick: () => void; primary?: boolean; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      onMouseEnter={() => sound.hover()}
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-sm font-extrabold transition-colors ${
        primary ? "bg-accent text-on-accent shadow-soft" : "bg-surface-2 text-ink hover:bg-accent-soft"
      }`}
    >
      {children}
    </button>
  );
}

/** Mini maquette de l'interface dans les couleurs, le fond et les formes du thème. */
function ThemePreview({ entry }: { entry?: ThemeEntry }) {
  // Thème CSS : attribut data-theme ; thème au format : ses variables en ligne.
  const attrs = entry?.def ? { "data-theme": "custom", style: themeStyle(entry.def) } : { "data-theme": entry?.css ?? "blue3ds" };
  return (
    <div {...attrs} className="theme-bg relative h-28 overflow-hidden rounded-[16px] p-2">
      <div className="mx-auto mb-1.5 h-2 w-12 rounded-full bg-surface" />
      <div className="panel-solid flex h-9 items-center justify-between px-2 shadow-soft" style={{ borderRadius: "calc(var(--panel-radius) / 2.5)" }}>
        <div className="space-y-1">
          <div className="h-1.5 w-10 rounded-full bg-ink/70" />
          <div className="h-1.5 w-6 rounded-full bg-muted/60" />
        </div>
        <div className="h-3.5 w-9 rounded-full bg-accent" />
      </div>
      <div className="panel mt-1.5 flex h-[42px] items-center gap-1.5 px-2" style={{ borderRadius: "calc(var(--panel-radius) / 2.5)" }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={`h-6 w-6 shrink-0 ${i === 1 ? "bg-accent" : i === 3 ? "border border-dashed border-muted/40" : "bg-surface"}`}
            style={{ borderRadius: "calc(var(--tile-radius) / 3)" }}
          />
        ))}
      </div>
    </div>
  );
}

function LanguageTab() {
  const { t, lang, setLang } = useI18n();
  return (
    <Section title={t("tabLanguage")} description={t("languageDesc")}>
      <div className="flex flex-col gap-2">
        {LANGS.map((item) => (
          <button
            key={item.id}
            type="button"
            onMouseEnter={() => sound.hover()}
            onClick={() => {
              if (item.id !== lang) sound.select();
              setLang(item.id);
            }}
            className={`flex items-center justify-between rounded-2xl px-5 py-3.5 text-left font-extrabold transition-colors ${
              item.id === lang ? "bg-accent text-on-accent" : "bg-surface-2 hover:bg-accent-soft"
            }`}
          >
            {item.label}
            {item.id === lang && <span aria-hidden>✓</span>}
          </button>
        ))}
      </div>
    </Section>
  );
}

/** Traitements proposés pour les icônes trop petites (le rendu vit dans `GameIcon`). */
const ICON_OPTIONS = [
  { id: "plate", label: "iconPlate", hint: "iconPlateHint" },
  { id: "fill", label: "iconFill", hint: "iconFillHint" },
  { id: "smooth", label: "iconSmooth", hint: "iconSmoothHint" },
  { id: "scale2x", label: "iconScale2x", hint: "iconScale2xHint" },
  { id: "xbr", label: "iconXbr", hint: "iconXbrHint" },
  { id: "hqx", label: "iconHqx", hint: "iconHqxHint" },
  { id: "capsule", label: "iconCapsule", hint: "iconCapsuleHint" },
] as const;

/** Réglage des icônes : il lit le contexte, rien ne descend par les propriétés. */
function IconStyleSection() {
  const { t } = useI18n();
  const { style, setStyle } = useIconStyle();
  return (
    <Section title={t("iconStyle")} description={t("iconStyleDesc")}>
      <div className="flex flex-col gap-2">
        {ICON_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={option.id === style}
            onMouseEnter={() => sound.hover()}
            onClick={() => {
              if (option.id !== style) sound.select();
              setStyle(option.id);
            }}
            className={`flex items-center justify-between gap-4 rounded-2xl px-5 py-3 text-left transition-colors ${
              option.id === style ? "bg-accent text-on-accent" : "bg-surface-2 hover:bg-accent-soft"
            }`}
          >
            <span className="flex min-w-0 flex-col">
              <span className="font-extrabold">{t(option.label)}</span>
              <span className="text-xs font-bold opacity-75">{t(option.hint)}</span>
            </span>
            {option.id === style && <span aria-hidden>✓</span>}
          </button>
        ))}
      </div>
    </Section>
  );
}

/** Styles de curseur proposés, avec leur libellé traduit (le rendu vit dans `index.css`). */
const CURSOR_OPTIONS = [
  { id: "soft", label: "cursorSoft" },
  { id: "glow", label: "cursorGlow" },
  { id: "ring", label: "cursorRing" },
  { id: "lift", label: "cursorLift" },
  { id: "none", label: "cursorNone" },
] as const;

function GeneralTab({ soundOn, onToggleSound, fullscreen, onToggleFullscreen, cursorStyle, onCursorStyle }: Props) {
  const { t } = useI18n();
  const [volume, setVolume] = useState(sound.volume);
  return (
    <>
      <Section title={t("sounds")} description={t("soundsDesc")}>
        <div className="space-y-3 rounded-2xl bg-surface-2 p-4">
          <Toggle label={t("sounds")} on={soundOn} onChange={onToggleSound} />
          <label className={`flex items-center gap-4 ${soundOn ? "" : "opacity-40"}`}>
            <span className="w-24 text-sm font-extrabold">{t("volume")}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(volume * 100)}
              disabled={!soundOn}
              onChange={(e) => {
                const v = Number(e.target.value) / 100;
                setVolume(v);
                sound.setVolume(v);
              }}
              onPointerUp={() => sound.select()}
              className="flex-1 accent-(--accent)"
            />
            <span className="w-10 text-right text-sm font-bold tabular-nums text-muted">{Math.round(volume * 100)}</span>
          </label>
        </div>
      </Section>
      <Section title={t("fullscreen")} description={t("fullscreenDesc")}>
        <div className="rounded-2xl bg-surface-2 p-4">
          <Toggle label={t("fullscreen")} on={fullscreen} onChange={onToggleFullscreen} />
        </div>
      </Section>
      <IconStyleSection />
      <Section title={t("cursorStyle")} description={t("cursorStyleDesc")}>
        <div className="grid grid-cols-5 gap-2 rounded-2xl bg-surface-2 p-4">
          {CURSOR_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={option.id === cursorStyle}
              onMouseEnter={() => sound.hover()}
              onClick={() => {
                if (option.id !== cursorStyle) sound.select();
                onCursorStyle(option.id);
              }}
              className={`flex flex-col items-center gap-3 rounded-2xl px-1 py-4 text-xs font-extrabold transition-colors ${
                option.id === cursorStyle ? "bg-surface text-accent-strong ring-2 ring-accent" : "text-muted hover:bg-accent-soft/60"
              }`}
            >
              {/* Aperçu : un `data-cursor` local suffit, les variables de style héritent. */}
              <span data-cursor={option.id} className="grid h-12 w-12 place-items-center">
                <span className="cursor-demo h-9 w-9 rounded-tile border border-black/10 bg-linear-to-br from-accent-soft to-surface" />
              </span>
              {t(option.label)}
            </button>
          ))}
        </div>
      </Section>
    </>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: () => void }) {
  const { t } = useI18n();
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onChange} className="flex w-full items-center justify-between">
      <span className="text-sm font-extrabold">{label}</span>
      <span className="flex items-center gap-3">
        <span className="text-xs font-bold text-muted">{on ? t("on") : t("off")}</span>
        <span className={`relative h-7 w-12 rounded-full transition-colors ${on ? "bg-accent" : "bg-muted/30"}`}>
          <motion.span
            className="absolute top-1 h-5 w-5 rounded-full bg-white shadow"
            animate={{ left: on ? 24 : 4 }}
            transition={{ type: "spring", stiffness: 600, damping: 32 }}
          />
        </span>
      </span>
    </button>
  );
}

function DataTab({ onResetLayout, onResetPrefs, onClearCache, onResetAll }: Props) {
  const { t } = useI18n();
  return (
    <Section title={t("tabData")}>
      <div className="flex flex-col gap-3">
        <DangerRow title={t("resetLayout")} description={t("resetLayoutDesc")} action={t("actionReset")} onConfirm={onResetLayout} />
        <DangerRow title={t("resetPrefs")} description={t("resetPrefsDesc")} action={t("actionReset")} onConfirm={onResetPrefs} />
        <DangerRow title={t("clearCache")} description={t("clearCacheDesc")} action={t("actionClear")} onConfirm={onClearCache} />
        <DangerRow title={t("resetAll")} description={t("resetAllDesc")} action={t("actionReset")} onConfirm={onResetAll} strong />
      </div>
    </Section>
  );
}

/** Action destructive en deux clics : le bouton demande confirmation pendant 3 s. */
function DangerRow({
  title,
  description,
  action,
  onConfirm,
  strong,
}: {
  title: string;
  description: string;
  action: string;
  onConfirm: () => void;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center gap-4 rounded-2xl bg-surface-2 p-4">
      <div className="min-w-0 flex-1">
        <p className="font-extrabold">{title}</p>
        <p className="text-sm font-bold text-muted">{description}</p>
      </div>
      <ConfirmButton label={action} onConfirm={onConfirm} strong={strong} />
    </div>
  );
}

/** Bouton en deux clics : le premier demande confirmation pendant 3 s, le second agit. */
function ConfirmButton({ label, onConfirm, strong, title }: { label: string; onConfirm: () => void; strong?: boolean; title?: string }) {
  const { t } = useI18n();
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [armed]);
  return (
    <motion.button
      type="button"
      title={title}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          sound.move();
          setArmed(true);
        }
      }}
      animate={armed ? { scale: [1, 1.08, 1] } : { scale: 1 }}
      className={`shrink-0 rounded-full px-4 py-2 text-sm font-extrabold transition-colors ${
        armed ? "bg-[#e53935] text-white" : strong ? "bg-[#e53935]/15 text-[#e53935]" : "bg-surface text-ink shadow-soft"
      }`}
    >
      {armed ? t("confirm") : label}
    </motion.button>
  );
}

function PresetsTab({ presets, themes, onSavePreset, onLoadPreset, onOverwritePreset, onRenamePreset, onDeletePreset }: Props) {
  const { t, tn, lang, locale } = useI18n();
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const suggested = t("presetDefaultName", { n: presets.length + 1 });

  const submit = () => {
    sound.select();
    onSavePreset(name.trim() || suggested);
    setName("");
  };

  return (
    <Section title={t("tabPresets")} description={t("presetsDesc")}>
      <form
        className="mb-5 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          placeholder={suggested}
          aria-label={t("presetName")}
          className="min-w-0 flex-1 rounded-full bg-surface-2 px-5 py-2.5 font-extrabold text-ink outline-none placeholder:text-muted/70 focus:ring-3 focus:ring-accent"
        />
        <button type="submit" className="shrink-0 rounded-full bg-accent px-6 py-2.5 font-extrabold text-on-accent shadow-soft">
          {t("presetSave")}
        </button>
      </form>

      {presets.length === 0 ? (
        <p className="rounded-2xl bg-surface-2 p-5 text-sm font-bold text-muted">{t("presetEmpty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          <AnimatePresence initial={false}>
            {presets.map((preset) => {
              const theme = themes.entries.find((th) => th.id === preset.theme);
              const games = placedGames(preset.board).size;
              const folders = Object.keys(preset.board.folders).length;
              const date = new Date(preset.updatedAt).toLocaleDateString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
              const isRenaming = renaming?.id === preset.id;
              return (
                <motion.li
                  key={preset.id}
                  layout
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 24 }}
                  className="flex items-center gap-4 rounded-2xl bg-surface-2 p-3"
                >
                  <div className="w-36 shrink-0">
                    <ThemePreview entry={theme} />
                  </div>
                  <div className="min-w-0 flex-1">
                    {isRenaming ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          onRenamePreset(preset.id, renaming.name.trim() || preset.name);
                          setRenaming(null);
                        }}
                      >
                        <input
                          autoFocus
                          value={renaming.name}
                          maxLength={40}
                          onChange={(e) => setRenaming({ id: preset.id, name: e.target.value })}
                          onBlur={() => {
                            onRenamePreset(preset.id, renaming.name.trim() || preset.name);
                            setRenaming(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") {
                              e.stopPropagation();
                              setRenaming(null);
                            }
                          }}
                          className="w-full rounded-xl bg-surface px-3 py-1.5 font-extrabold text-ink outline-none ring-3 ring-accent"
                        />
                      </form>
                    ) : (
                      <p className="truncate text-lg font-black">{preset.name}</p>
                    )}
                    <p className="mt-0.5 truncate text-sm font-bold text-muted">
                      {tn("games", games)} · {tn("folders", folders)} · {theme?.label(lang) ?? preset.theme} · {t("savedOn", { date })}
                    </p>
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      <ConfirmButton label={t("presetLoad")} title={t("presetLoadTitle")} onConfirm={() => onLoadPreset(preset.id)} />
                      <ConfirmButton
                        label={t("presetOverwrite")}
                        title={t("presetOverwriteTitle")}
                        onConfirm={() => onOverwritePreset(preset.id)}
                      />
                      <button
                        type="button"
                        onClick={() => setRenaming({ id: preset.id, name: preset.name })}
                        className="rounded-full px-3 py-2 text-sm font-extrabold text-muted hover:text-ink"
                      >
                        {t("rename")}
                      </button>
                      <ConfirmButton label={t("delete")} onConfirm={() => onDeletePreset(preset.id)} strong />
                    </div>
                  </div>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </Section>
  );
}
