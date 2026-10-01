import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { ThemeApi, ThemeEntry } from "../themes/themes";
import { parseTheme, serializeTheme, slug, themeName, themeStyle, type ThemeDef } from "../themes/format";
import {
  openThemesDir,
  restartSteam,
  saveThemeFile,
  setAutostart,
  setStartupMode,
  setSteamControl,
  startupSettings,
  steamControlState,
  type StartupMode,
  type StartupSettings,
  type SteamControl,
} from "../lib/api";
import { LANGS, useI18n, type TFunction } from "../lib/i18n";
import { load, save } from "../lib/storage";
import { menuMusic } from "../lib/menuMusic";
import { sound } from "../lib/sound";
import { placedGames } from "../lib/board";
import type { CursorStyle } from "../lib/cursorStyle";
import { useIconStyle } from "../lib/iconStyle";
import type { Preset } from "../lib/presets";
import { ControlsTab } from "./ControlsTab";

export type Tab = "theme" | "appearance" | "sound" | "language" | "startup" | "steam" | "controls" | "presets" | "data";

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
  padMouse: boolean;
  onTogglePadMouse: () => void;
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

/** Onglets, rangés en trois groupes : ce qui se voit et s'entend, le système, les données. */
const GROUPS: { label: Parameters<TFunction>[0]; tabs: { id: Tab; label: Parameters<TFunction>[0] }[] }[] = [
  {
    label: "settingsGroupPersonal",
    tabs: [
      { id: "theme", label: "tabTheme" },
      { id: "appearance", label: "tabAppearance" },
      { id: "sound", label: "tabSound" },
      { id: "language", label: "tabLanguage" },
    ],
  },
  {
    label: "settingsGroupSystem",
    tabs: [
      { id: "startup", label: "tabStartup" },
      { id: "steam", label: "tabSteam" },
      { id: "controls", label: "tabControls" },
    ],
  },
  {
    label: "settingsGroupData",
    tabs: [
      { id: "presets", label: "tabPresets" },
      { id: "data", label: "tabData" },
    ],
  },
];

/** Pictogramme d'un onglet, au trait, dans la couleur du texte. */
function TabIcon({ id }: { id: Tab }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden {...common}>
      {id === "appearance" && (
        <>
          <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
          <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
          <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
          <circle cx="17" cy="17" r="3.6" />
        </>
      )}
      {id === "theme" && (
        <>
          <path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-.5-.2-.8-.4-1.1-.3-.3-.4-.6-.4-1 0-.9.7-1.5 1.6-1.5H16a5 5 0 0 0 5-5c0-4.2-4-7.8-9-7.8Z" />
          <circle cx="7.5" cy="11" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="10.5" cy="7.2" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="15" cy="7.8" r="1.2" fill="currentColor" stroke="none" />
        </>
      )}
      {id === "sound" && (
        <>
          <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z" />
          <path d="M15.5 9a4 4 0 0 1 0 6" />
          <path d="M18 6.5a7.5 7.5 0 0 1 0 11" />
        </>
      )}
      {id === "language" && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18" />
          <path d="M12 3c2.4 2.6 3.6 5.6 3.6 9s-1.2 6.4-3.6 9c-2.4-2.6-3.6-5.6-3.6-9S9.6 5.6 12 3Z" />
        </>
      )}
      {id === "startup" && (
        <>
          <path d="M12 3.5v8" />
          <path d="M6.6 6.8a7.5 7.5 0 1 0 10.8 0" />
        </>
      )}
      {id === "steam" && (
        <>
          <path d="M12 4v11" />
          <path d="m7 10.5 5 4.5 5-4.5" />
          <path d="M5 19.5h14" />
        </>
      )}
      {id === "controls" && (
        <>
          <rect x="2.5" y="7" width="19" height="11" rx="5.5" />
          <path d="M8 10.5v4M6 12.5h4" />
          <circle cx="15.5" cy="11.2" r="1" fill="currentColor" stroke="none" />
          <circle cx="17.8" cy="13.8" r="1" fill="currentColor" stroke="none" />
        </>
      )}
      {id === "presets" && <path d="M7 3.5h10v17l-5-3.6-5 3.6v-17Z" />}
      {id === "data" && (
        <>
          <path d="M4 12a8 8 0 1 0 2.4-5.7" />
          <path d="M4 4.5v4h4" />
        </>
      )}
    </svg>
  );
}

/** Fenêtre des paramètres, en onglets rangés par groupes (voir `GROUPS`). */
export function SettingsModal(props: Props) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>(props.initialTab ?? "theme");
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

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
        <nav data-nav-zone className="soft-scroll flex w-52 shrink-0 flex-col gap-0.5 overflow-y-auto bg-surface-2 p-4">
          <p className="mb-1 px-3 text-lg font-black">{t("settings")}</p>
          {GROUPS.map((group) => (
            <div key={group.label} className="flex flex-col gap-0.5">
              <p className="mt-3 px-4 pb-1 text-[11px] font-black uppercase tracking-wider text-muted/80">{t(group.label)}</p>
              {group.tabs.map((item) => (
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
                  <span className="relative flex items-center gap-2.5">
                    <TabIcon id={item.id} />
                    {t(item.label)}
                  </span>
                </button>
              ))}
            </div>
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
              {tab === "appearance" && <AppearanceTab {...props} />}
              {tab === "sound" && <SoundTab {...props} />}
              {tab === "language" && <LanguageTab />}
              {tab === "startup" && <StartupTab {...props} />}
              {tab === "steam" && <SteamTab {...props} />}
              {tab === "controls" && <ControlsTab />}
              {tab === "presets" && <PresetsTab {...props} />}
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
  const attrs = entry?.def ? { "data-theme": "custom", style: themeStyle(entry.def) } : { "data-theme": entry?.css ?? "sky" };
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

/** Apparence : comment les icônes et le curseur s'affichent dans la grille. */
function AppearanceTab({ cursorStyle, onCursorStyle }: Props) {
  const { t } = useI18n();
  return (
    <>
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

/** Son : les bruitages de l'interface et la musique du menu. */
function SoundTab({ soundOn, onToggleSound }: Props) {
  const { t } = useI18n();
  const [volume, setVolume] = useState(sound.volume);
  return (
    <>
      <Section title={t("soundEffects")} description={t("soundsDesc")}>
        <div className="space-y-3 rounded-2xl bg-surface-2 p-4">
          <Toggle label={t("soundEffects")} on={soundOn} onChange={onToggleSound} />
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
      <MusicSection />
    </>
  );
}

/** Démarrage : comment s'ouvre 3DSteam, le plein écran, et ce qu'il fait quand un jeu démarre. */
function StartupTab({ fullscreen, onToggleFullscreen }: Props) {
  const { t } = useI18n();
  return (
    <>
      <StartupSection />
      <Section title={t("fullscreen")} description={t("fullscreenDesc")}>
        <div className="rounded-2xl bg-surface-2 p-4">
          <Toggle label={t("fullscreen")} on={fullscreen} onChange={onToggleFullscreen} />
        </div>
      </Section>
      <LaunchSection />
    </>
  );
}

/** Steam : installer à la manette, et piloter les téléchargements depuis 3DSteam. */
function SteamTab({ padMouse, onTogglePadMouse }: Props) {
  const { t } = useI18n();
  return (
    <>
      <Section title={t("padMouseTitle")} description={t("padMouseDesc")}>
        <div className="rounded-2xl bg-surface-2 p-4">
          <Toggle label={t("padMouse")} on={padMouse} onChange={onTogglePadMouse} />
        </div>
      </Section>
      <SteamControlSection />
    </>
  );
}

/** Musique du menu. À doser : elle est discrète par défaut. */
function MusicSection() {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState(menuMusic.enabled);
  const [volume, setVolume] = useState(Math.round(menuMusic.volume * 100));
  return (
    <Section title={t("musicSettings")} description={t("musicSettingsDesc")}>
      <div className="flex flex-col gap-4 rounded-2xl bg-surface-2 p-4">
        <Toggle
          label={t("menuMusic")}
          on={enabled}
          onChange={() => {
            sound.toggle();
            menuMusic.setEnabled(!enabled);
            setEnabled(!enabled);
          }}
        />
        <label className="flex items-center gap-4">
          <span className="w-40 shrink-0 text-sm font-extrabold">{t("menuMusicVolume")}</span>
          <input
            type="range"
            min={0}
            max={100}
            value={volume}
            onChange={(e) => {
              const v = Number(e.target.value);
              setVolume(v);
              menuMusic.setVolume(v / 100);
            }}
            className="flex-1 accent-(--accent)"
          />
          <span className="w-10 text-right text-sm font-bold tabular-nums text-muted">{volume}</span>
        </label>
      </div>
    </Section>
  );
}

const STARTUP_MODES: { id: StartupMode; label: Parameters<TFunction>[0] }[] = [
  { id: "last", label: "startupLast" },
  { id: "window", label: "startupWindow" },
  { id: "maximized", label: "startupMaximized" },
  { id: "fullscreen", label: "startupFullscreen" },
  { id: "minimized", label: "startupMinimized" },
];

/**
 * Ouverture de 3DSteam : avec Windows ou non, et l'état de la fenêtre à l'ouverture (appliqué par
 * Rust avant qu'elle ne s'affiche).
 */
function StartupSection() {
  const { t } = useI18n();
  const [state, setState] = useState<StartupSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void startupSettings().then(setState, (e) => setError(String(e)));
  }, []);

  const update = (next: Promise<StartupSettings>) => {
    setError(null);
    next.then(setState, (e) => setError(String(e)));
  };

  return (
    <Section title={t("startupApp")} description={t("startupDesc")}>
      <div className="flex flex-col gap-4 rounded-2xl bg-surface-2 p-4">
        <Toggle
          label={t("startupWithWindows")}
          on={state?.autostart ?? false}
          onChange={() => {
            if (!state) return;
            sound.toggle();
            update(setAutostart(!state.autostart));
          }}
        />
        {/* Ne vaut que si Windows lance 3DSteam : sans démarrage automatique, il est en retrait. */}
        <div className={state?.autostart ? "" : "pointer-events-none opacity-45"} aria-disabled={!state?.autostart}>
          <Toggle
            label={t("startupWithWindowsMinimized")}
            on={state?.autostartMinimized ?? false}
            onChange={() => {
              if (!state) return;
              sound.toggle();
              update(setStartupMode(state.mode, !state.autostartMinimized));
            }}
          />
        </div>
        <div>
          <p className="mb-2 text-sm font-extrabold">{t("startupOpen")}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {STARTUP_MODES.map((mode) => {
              const current = state?.mode === mode.id;
              return (
                <button
                  key={mode.id}
                  type="button"
                  aria-pressed={current}
                  onMouseEnter={() => sound.hover()}
                  onClick={() => {
                    if (!state || current) return;
                    sound.select();
                    update(setStartupMode(mode.id, state.autostartMinimized));
                  }}
                  className={`rounded-2xl px-2 py-2.5 text-xs font-extrabold transition-colors ${
                    current ? "bg-surface text-accent-strong ring-2 ring-accent" : "text-muted hover:bg-accent-soft/60"
                  }`}
                >
                  {t(mode.label)}
                </button>
              );
            })}
          </div>
        </div>
        {error && <p className="text-xs font-bold text-[#e5484d]">{error}</p>}
      </div>
    </Section>
  );
}

/** Lancement d'un jeu : la grande animation, et 3DSteam qui s'efface une fois le jeu ouvert. */
function LaunchSection() {
  const { t } = useI18n();
  const [minimizeOnLaunch, setMinimizeOnLaunch] = useState(() => load("minimizeOnLaunch", false));
  const [launchSplash, setLaunchSplash] = useState(() => load("launchSplash", true));
  return (
    <Section title={t("launchSettings")} description={t("launchSettingsDesc")}>
      <div className="flex flex-col gap-4 rounded-2xl bg-surface-2 p-4">
        <Toggle
          label={t("launchSplashToggle")}
          on={launchSplash}
          onChange={() => {
            sound.toggle();
            setLaunchSplash((on) => {
              save("launchSplash", !on);
              return !on;
            });
          }}
        />
        <Toggle
          label={t("minimizeOnLaunch")}
          on={minimizeOnLaunch}
          onChange={() => {
            sound.toggle();
            setMinimizeOnLaunch((on) => {
              save("minimizeOnLaunch", !on);
              return !on;
            });
          }}
        />
      </div>
    </Section>
  );
}

/**
 * Pause, reprise et annulation directes : il faut ouvrir le port de débogage de Steam, ce que
 * l'utilisateur choisit en connaissance de cause (voir `steamctl.rs`). Sans lui, ces actions
 * ouvrent la liste des téléchargements de Steam.
 */
function SteamControlSection() {
  const { t } = useI18n();
  const [state, setState] = useState<SteamControl | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const refresh = () => void steamControlState().then((s) => alive && setState(s)).catch(() => {});
    refresh();
    // Steam met quelques secondes à rouvrir son port après un redémarrage.
    const timer = window.setInterval(refresh, 2500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const toggle = () => {
    if (!state) return;
    sound.toggle();
    setError(null);
    setSteamControl(!state.enabled).then(setState, (e) => setError(String(e)));
  };
  const restart = () => {
    sound.select();
    setRestarting(true);
    setError(null);
    restartSteam()
      .catch((e) => setError(String(e)))
      .finally(() => setRestarting(false));
  };

  const status = !state
    ? ""
    : state.connected
      ? t("steamControlOn")
      : state.enabled
        ? t("steamControlRestart")
        : t("steamControlOff");
  return (
    <Section title={t("steamControl")} description={t("steamControlDesc")}>
      <div className="flex flex-col gap-3 rounded-2xl bg-surface-2 p-4">
        <Toggle label={t("steamControlToggle")} on={state?.enabled ?? false} onChange={toggle} />
        <div className="flex items-center justify-between gap-3">
          <span className={`text-xs font-bold ${state?.connected ? "text-accent-strong" : "text-muted"}`}>{error ?? status}</span>
          {/* Retirer le fichier aussi demande un redémarrage pour refermer le port. */}
          {state && state.enabled !== state.connected && (
            <ActionButton primary onClick={restart}>
              {restarting ? t("steamRestarting") : t("steamRestart")}
            </ActionButton>
          )}
        </div>
      </div>
    </Section>
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
