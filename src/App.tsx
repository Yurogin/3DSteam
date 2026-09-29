import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { TopBar } from "./components/TopBar";
import { TopScreen } from "./components/TopScreen";
import { BoardGrid, type ViewItem } from "./components/BoardGrid";
import { FolderEditor } from "./components/FolderEditor";
import { SettingsModal, type Tab as SettingsTab } from "./components/SettingsModal";
import { ThemeEditor } from "./components/ThemeEditor";
import { themeName, type ThemeDef } from "./themes/format";
import { ZoomControls } from "./components/ZoomControls";
import { useLibrary } from "./hooks/useLibrary";
import { useGridMetrics } from "./hooks/useGridMetrics";
import { useGamepad } from "./hooks/useGamepad";
import { useDownloads } from "./hooks/useDownloads";
import { OnScreenKeyboard } from "./components/OnScreenKeyboard";
import { isDir, isRange, isTextInput, moveFocus, nudgeRange, setNavVisible, type Action, type Dir } from "./lib/nav";
import { keyAction, resetBindings } from "./lib/bindings";
import { useHorizontalWheel } from "./hooks/useHorizontalWheel";
import { DEFAULT_THEME, useTheme } from "./themes/themes";
import { defaultLang, useI18n } from "./lib/i18n";
import { clearCache, installGame, launchGame } from "./lib/api";
import { isFullscreen, setFullscreen } from "./lib/fullscreen";
import { DEFAULT_CURSOR, useCursorStyle } from "./lib/cursorStyle";
import { DEFAULT_ICON_STYLE, useIconStyle } from "./lib/iconStyle";
import { sound } from "./lib/sound";
import { clearAll, load, save } from "./lib/storage";
import { usePresets } from "./lib/presets";
import {
  FOLDER_COLORS,
  BOARD_SLOTS,
  FOLDER_SLOTS,
  boardLength,
  createFolder,
  deleteFolder,
  emptyBoard,
  migrateBoard,
  moveCell,
  moveIntoFolder,
  moveOutOfFolder,
  placeNewGames,
  sortView,
  toColRow,
  toIndex,
  updateFolder,
  viewSlots,
  type Board,
  type Folder,
  type Slots,
  type ViewId,
} from "./lib/board";
import type { Game } from "./types";

/** Zoom façon 3DS : nombre de rangées affichées (moins de rangées = icônes plus grandes). */
const MIN_ROWS = 1;
const MAX_ROWS = 4;
const GAP = 18;
/** Hauteur réservée au nom sous l'icône, quand il y a 1 ou 2 rangées. */
const LABEL_HEIGHT = 26;
const LAUNCH_FEEDBACK_MS = 2500;

type Editor = { mode: "new"; index: number; draft: Folder } | { mode: "edit"; id: string } | null;

const normalize = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export default function App() {
  const { games, catalog, scannedAt, loaded, scanning, error, rescan } = useLibrary();
  const themes = useTheme();
  const cursorStyle = useCursorStyle();
  const iconStyle = useIconStyle();
  /** Un téléchargement qui s'achève relance le scan : le jeu devient jouable de lui-même. */
  const downloads = useDownloads(rescan);
  const [autoConfirm, setAutoConfirm] = useState(() => load("autoConfirmInstall", false));
  useEffect(() => save("autoConfirmInstall", autoConfirm), [autoConfirm]);
  /**
   * Titre de la boîte d'installation de Steam, appris à la première installation. Tant qu'il est
   * inconnu, rien n'est cliqué : la fenêtre pourrait être un contrat de licence.
   */
  const [dialogTitle, setDialogTitle] = useState<string | null>(() => load("installDialogTitle", null));
  useEffect(() => save("installDialogTitle", dialogTitle), [dialogTitle]);
  /** Titre observé, pas encore acquis : il ne vaut que si le téléchargement part vraiment. */
  const learning = useRef<{ title: string; appid: number } | null>(null);
  const { theme, setTheme, cycle: cycleTheme } = themes;
  const { t, tn, lang, locale, setLang } = useI18n();

  const [rows, setRows] = useState(() => Math.min(MAX_ROWS, Math.max(MIN_ROWS, load("rows", 2))));
  const [board, setBoard] = useState<Board>(() =>
    migrateBoard(load("board.v2", null), load("board", null), load("order", null)),
  );
  /** Plateau affiché : principal (`null`) ou dossier ouvert. */
  const [view, setView] = useState<ViewId>(null);
  const [cursor, setCursor] = useState(() => load("cursor", 0));
  const [editor, setEditor] = useState<Editor>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Onglet à rouvrir (après l'éditeur de thème, on revient sur « Thème »). */
  const [settingsTab, setSettingsTab] = useState<SettingsTab | undefined>(undefined);
  const [themeEditor, setThemeEditor] = useState<{ def: ThemeDef; isNew: boolean } | null>(null);
  const presets = usePresets();
  const modalOpen = editor != null || settingsOpen || themeEditor != null;
  const [query, setQuery] = useState("");
  /** Vue « Tout » : les jeux installés et ceux que le client connaît, à plat. */
  const [showAll, setShowAll] = useState(false);
  const [soundOn, setSoundOn] = useState(sound.enabled);
  const [launchingId, setLaunchingId] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [backHover, setBackHover] = useState(false);
  /** Case d'origine de l'icône « prise » au clavier / à la manette, qui suit le curseur. */
  const [held, setHeld] = useState<number | null>(null);
  const [fullscreen, setFullscreenState] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const labelHeight = rows <= 2 ? LABEL_HEIGHT : 0;
  const [{ tile: tileSize, columns }, setGridMetricsEl] = useGridMetrics(rows, labelHeight, GAP);
  const [gridArea, setGridArea] = useState<HTMLElement | null>(null);
  const gridAreaRef = useCallback(
    (el: HTMLElement | null) => {
      setGridMetricsEl(el);
      setGridArea(el);
    },
    [setGridMetricsEl],
  );
  useHorizontalWheel(gridArea);

  useEffect(() => save("rows", rows), [rows]);
  useEffect(() => save("board.v2", board), [board]);
  // La vue « Tout » a son propre curseur : il ne doit pas écraser celui du plateau.
  useEffect(() => {
    if (view == null && !showAll) save("cursor", cursor);
  }, [cursor, view, showAll]);
  useEffect(() => setCursor(showAll ? 0 : load("cursor", 0)), [showAll]);

  // Les jeux nouvellement installés prennent place après le dernier élément du plateau.
  useEffect(() => {
    if (games.length) setBoard((b) => placeNewGames(b, games.map((g) => g.appid)));
  }, [games]);

  // Un dossier supprimé pendant qu'il est ouvert : retour au plateau principal.
  const openFolder = view != null ? (board.folders[view] ?? null) : null;
  useEffect(() => {
    if (view != null && !openFolder) setView(null);
  }, [view, openFolder]);

  const searching = query.trim() !== "";
  /** Vue à plat : ni plateau, ni glisser-déposer, ni dossiers. */
  const browsing = searching || showAll;
  useEffect(() => setHeld(null), [view, browsing]);
  const byId = useMemo(() => new Map(games.map((g) => [g.appid, g])), [games]);

  /** Vue « Tout » : installés et catalogue mêlés, du plus récemment joué au plus ancien. */
  const allGames = useMemo(
    () => [...games, ...catalog].sort((a, b) => b.lastPlayed - a.lastPlayed || a.name.localeCompare(b.name)),
    [games, catalog],
  );

  const gamesOf = useCallback(
    (slots: Slots) =>
      slots.flatMap((c) => {
        const game = c?.kind === "game" ? byId.get(c.appid) : undefined;
        return game ? [game] : [];
      }),
    [byId],
  );

  /** Contenu des cases affichées : le plateau (avec ses trous) ou les résultats de recherche. */
  const items = useMemo<ViewItem[]>(() => {
    const pool = showAll ? allGames : games;
    if (searching) {
      const q = normalize(query.trim());
      return pool.filter((g) => normalize(g.name).includes(q)).map((game) => ({ kind: "game", game }));
    }
    if (showAll) return pool.map((game) => ({ kind: "game", game }));
    // Un jeu désinstallé laisse une case vide (et la retrouve s'il est réinstallé).
    const resolved = viewSlots(board, view).map((c): ViewItem => {
      if (c?.kind === "game") {
        const game = byId.get(c.appid);
        return game ? { kind: "game", game } : null;
      }
      if (c?.kind === "folder") {
        const folder = board.folders[c.id];
        return folder ? { kind: "folder", folder, games: gamesOf(folder.slots) } : null;
      }
      return null;
    });
    const itemCount = resolved.filter((c) => c != null).length;
    const length = boardLength(resolved.length, itemCount, rows, columns, view == null ? BOARD_SLOTS : FOLDER_SLOTS);
    return Array.from({ length }, (_, i) => resolved[i] ?? null);
  }, [games, allGames, showAll, byId, board, view, query, searching, rows, columns, gamesOf]);

  const cursorIndex = Math.min(Math.max(0, cursor), Math.max(0, items.length - 1));
  const current = items[cursorIndex] ?? null;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const cursorRef = useRef(cursorIndex);
  cursorRef.current = cursorIndex;

  const gameCount = browsing ? items.length : view == null ? games.length : gamesOf(openFolder?.slots ?? []).length;

  // ─── Actions ─────────────────────────────────────────────────────────────────────────

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((t) => (t === message ? null : t)), 3200);
  }, []);

  const heldRef = useRef(held);
  heldRef.current = held;
  const pointAt = useCallback((index: number) => {
    if (heldRef.current != null) {
      setCursor(index);
      cursorRef.current = index;
      dropHeldRef.current();
      return;
    }
    if (index !== cursorRef.current) sound.select();
    setCursor(index);
  }, []);

  const launch = useCallback(
    async (game: Game) => {
      if (launchingId != null) return;
      // Filet de sécurité : un jeu du catalogue passe par `install`, jamais par ici.
      if (!game.installed) return;
      setLaunchingId(game.appid);
      sound.launch();
      try {
        await launchGame(game.appid);
        showToast(t("starting", { name: game.name }));
      } catch (e) {
        sound.error();
        showToast(String(e));
      } finally {
        window.setTimeout(() => setLaunchingId(null), LAUNCH_FEEDBACK_MS);
      }
    },
    [launchingId, showToast, t],
  );

  /**
   * Installation : Steam impose sa boîte de dialogue, elle ne répond pas au clavier et son
   * interface n'expose rien à l'accessibilité. Avec le réglage, elle est validée par un clic
   * synthétique côté Rust ; sinon on demande à l'utilisateur de le faire.
   */
  const install = useCallback(
    async (game: Game) => {
      sound.select();
      showToast(t("installStarting", { name: game.name }));
      try {
        const outcome = await installGame(game.appid, autoConfirm, dialogTitle);
        if (outcome.kind === "unknown") {
          // On n'a pas touché à cette fenêtre. Si le téléchargement part quand même, c'est que
          // c'était bien la boîte d'installation : on retiendra son titre pour la prochaine fois.
          learning.current = { title: outcome.title, appid: game.appid };
          showToast(t("installNeedsYou"));
        } else if (outcome.kind !== "confirmed") {
          showToast(t("installConfirm"));
        }
        // Un tout petit jeu peut être installé avant le premier sondage : la disparition du
        // téléchargement passerait alors inaperçue. Ce scan différé rattrape ce cas ; les
        // téléchargements plus longs restent couverts par `useDownloads`.
        window.setTimeout(() => void rescan(), 6000);
      } catch (e) {
        sound.error();
        showToast(String(e));
      }
    },
    [autoConfirm, dialogTitle, rescan, showToast, t],
  );

  // Le téléchargement a démarré, ou le jeu est apparu installé : la fenêtre observée était bien
  // la boîte d'installation.
  useEffect(() => {
    const seen = learning.current;
    if (!seen) return;
    if (downloads.has(seen.appid) || byId.has(seen.appid)) {
      learning.current = null;
      setDialogTitle(seen.title);
    }
  }, [downloads, byId]);

  const enterFolder = useCallback((id: string) => {
    sound.zoom(1);
    setQuery("");
    setView(id);
    setCursor(0);
  }, []);

  const leaveFolder = useCallback(() => {
    if (view == null) return;
    sound.zoom(-1);
    const index = board.slots.findIndex((c) => c?.kind === "folder" && c.id === view);
    setView(null);
    setCursor(Math.max(0, index));
  }, [view, board.slots]);

  /** Entrée / Ⓐ / double-clic : lance le jeu ou ouvre le dossier sous le curseur. */
  const activate = useCallback(
    (index?: number) => {
      const item = itemsRef.current[index ?? cursorRef.current];
      if (index != null) setCursor(index);
      if (item?.kind === "game") void (item.game.installed ? launch(item.game) : install(item.game));
      else if (item?.kind === "folder") enterFolder(item.folder.id);
    },
    [launch, install, enterFolder],
  );
  const activateRef = useRef(activate);
  activateRef.current = activate;
  const activateTile = useCallback((index: number) => activateRef.current(index), []);

  const moveItem = useCallback(
    (from: number, to: number) => {
      const source = items[from];
      const target = items[to];
      if (view == null && source?.kind === "game" && target?.kind === "folder") {
        setBoard((b) => moveIntoFolder(b, from, target.folder.id));
        setCursor(to);
        showToast(t("filedInto", { game: source.game.name, folder: target.folder.name }));
        return;
      }
      setBoard((b) => moveCell(b, view, from, to));
      setCursor(to);
    },
    [items, view, showToast, t],
  );

  /** Espace / Ⓧ : prend l'icône sous le curseur, ou la pose si on en tient déjà une. */
  const dropHeld = useCallback(() => {
    const from = heldRef.current;
    if (from == null) return;
    const to = cursorRef.current;
    setHeld(null);
    if (to !== from) moveItem(from, to);
    sound.select();
  }, [moveItem]);
  const dropHeldRef = useRef(dropHeld);
  dropHeldRef.current = dropHeld;

  const cancelHeld = useCallback(() => {
    const from = heldRef.current;
    if (from == null) return;
    setHeld(null);
    setCursor(from);
    sound.zoom(-1);
  }, []);

  const grab = useCallback(() => {
    if (heldRef.current != null) return dropHeld();
    if (browsing || itemsRef.current[cursorRef.current] == null) return;
    sound.zoom(1);
    setHeld(cursorRef.current);
  }, [browsing, dropHeld]);

  const moveOut = useCallback(
    (index: number) => {
      if (view == null) return;
      const result = moveOutOfFolder(board, view, index);
      if (!result) return;
      setBoard(result.board);
      sound.select();
      showToast(t("movedOut"));
    },
    [board, view, showToast, t],
  );

  const startNewFolder = useCallback(() => {
    if (view != null || browsing || itemsRef.current[cursorRef.current] != null) return;
    sound.select();
    const used = Object.keys(board.folders).length;
    setEditor({
      mode: "new",
      index: cursorRef.current,
      draft: { id: "draft", name: t("defaultFolderName"), color: FOLDER_COLORS[used % FOLDER_COLORS.length], slots: [] },
    });
  }, [view, browsing, board.folders, t]);

  const saveEditor = useCallback(
    (name: string, color: string) => {
      if (!editor) return;
      if (editor.mode === "new") {
        setBoard((b) => createFolder(b, editor.index, name, color).board);
        showToast(t("folderCreated", { name }));
      } else {
        setBoard((b) => updateFolder(b, editor.id, { name, color }));
      }
      setEditor(null);
    },
    [editor, showToast, t],
  );

  const removeFolder = useCallback(
    (id: string) => {
      const folder = board.folders[id];
      if (!folder) return;
      sound.select();
      setBoard((b) => deleteFolder(b, id));
      showToast(t("folderDeleted", { name: folder.name }));
    },
    [board.folders, showToast, t],
  );

  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const changeZoom = useCallback((direction: 1 | -1) => {
    // « + » agrandit les icônes, donc retire une rangée.
    const next = Math.min(MAX_ROWS, Math.max(MIN_ROWS, rowsRef.current - direction));
    if (next === rowsRef.current) return;
    sound.zoom(direction);
    setRows(next);
  }, []);

  /** Curseur libre, case par case, vides comprises (comme sur 3DS). */
  const move = useCallback(
    (dx: number, dy: number) => {
      const { col, row } = toColRow(cursorRef.current, rows);
      const r = row + dy;
      const c = col + dx;
      if (r < 0 || r >= rows || c < 0) return;
      const next = toIndex(c, r, rows);
      if (next >= itemsRef.current.length) return;
      sound.move();
      setCursor(next);
    },
    [rows],
  );

  const sortBy = useCallback(
    (mode: "recent" | "alpha") => {
      const compare =
        mode === "recent"
          ? (a: number, b: number) => (byId.get(b)?.lastPlayed ?? 0) - (byId.get(a)?.lastPlayed ?? 0)
          : (a: number, b: number) =>
              (byId.get(a)?.name ?? "").localeCompare(byId.get(b)?.name ?? "", "fr", { sensitivity: "base" });
      sound.select();
      setBoard((b) => sortView(b, view, compare));
    },
    [byId, view],
  );

  const toggleSound = useCallback(() => {
    sound.setEnabled(!sound.enabled);
    setSoundOn(sound.enabled);
  }, []);

  const handleRescan = useCallback(() => {
    sound.select();
    void rescan();
  }, [rescan]);

  const toggleFullscreen = useCallback(async () => {
    const next = !(await isFullscreen().catch(() => false));
    try {
      await setFullscreen(next);
      setFullscreenState(next);
      save("fullscreen", next);
      sound.toggle();
    } catch (e) {
      sound.error();
      showToast(t("fullscreenError", { e: String(e) }));
    }
  }, [showToast, t]);

  // Le plein écran est mémorisé : on le rétablit au démarrage.
  useEffect(() => {
    if (load("fullscreen", false)) {
      setFullscreen(true)
        .then(() => setFullscreenState(true))
        .catch(() => {});
    }
    // Suit aussi les sorties de plein écran faites par le système (Échap du navigateur, etc.).
    const sync = () => void isFullscreen().then(setFullscreenState).catch(() => {});
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  // ─── Paramètres : réinitialisations ──────────────────────────────────────────────────

  const resetLayout = useCallback(() => {
    const recent = [...games].sort((a, b) => b.lastPlayed - a.lastPlayed).map((g) => g.appid);
    setBoard(placeNewGames(emptyBoard(), recent));
    setView(null);
    setCursor(0);
    sound.select();
    showToast(t("layoutReset"));
  }, [games, showToast, t]);

  const resetPrefs = useCallback(() => {
    setTheme(DEFAULT_THEME);
    setRows(2);
    sound.setVolume(0.7);
    if (!sound.enabled) {
      sound.setEnabled(true);
      setSoundOn(true);
    }
    setLang(defaultLang());
    resetBindings();
    if (fullscreen) void toggleFullscreen();
    cursorStyle.setStyle(DEFAULT_CURSOR);
    iconStyle.setStyle(DEFAULT_ICON_STYLE);
    setAutoConfirm(false);
    setDialogTitle(null);
    sound.select();
    showToast(t("prefsReset"));
  }, [setTheme, setLang, fullscreen, toggleFullscreen, cursorStyle, iconStyle, showToast, t]);

  const clearGameCache = useCallback(async () => {
    await clearCache().catch(() => {});
    sound.select();
    showToast(t("cacheCleared"));
    void rescan();
  }, [rescan, showToast, t]);

  const resetAll = useCallback(async () => {
    await clearCache().catch(() => {});
    if (fullscreen) await setFullscreen(false).catch(() => {});
    clearAll();
    window.location.reload();
  }, [fullscreen]);

  // ─── Paramètres : sauvegardes (presets) ──────────────────────────────────────────────

  const savePreset = useCallback(
    (name: string) => {
      presets.add(name, theme, board);
      showToast(t("presetSaved", { name }));
    },
    [presets, theme, board, showToast, t],
  );

  const loadPreset = useCallback(
    (id: string) => {
      const preset = presets.presets.find((p) => p.id === id);
      if (!preset) return;
      // Les jeux installés depuis la sauvegarde se rangent après le dernier élément.
      setBoard(placeNewGames(preset.board, games.map((g) => g.appid)));
      setTheme(preset.theme);
      setView(null);
      setCursor(0);
      sound.theme();
      showToast(t("presetLoaded", { name: preset.name }));
    },
    [presets.presets, games, setTheme, showToast, t],
  );

  const overwritePreset = useCallback(
    (id: string) => {
      const preset = presets.presets.find((p) => p.id === id);
      if (!preset) return;
      presets.overwrite(id, theme, board);
      sound.select();
      showToast(t("presetOverwritten", { name: preset.name }));
    },
    [presets, theme, board, showToast, t],
  );

  const deletePreset = useCallback(
    (id: string) => {
      const preset = presets.presets.find((p) => p.id === id);
      if (!preset) return;
      presets.remove(id);
      sound.select();
      showToast(t("presetDeleted", { name: preset.name }));
    },
    [presets, showToast, t],
  );

  const back = useCallback(() => {
    if (searching) setQuery("");
    else if (showAll) setShowAll(false);
    else leaveFolder();
  }, [searching, showAll, leaveFolder]);

  // ─── Clavier & manette ───────────────────────────────────────────────────────────────

  useEffect(() => {
    const unlock = () => sound.unlock();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // Deux modes sans souris : le curseur de la grille, ou le focus des boutons (barres, écran du
  // haut, fenêtres) qu'on parcourt aux flèches comme sur une interface de télé.
  const [navMode, setNavMode] = useState<"grid" | "ui">("grid");
  const [oskInput, setOskInput] = useState<HTMLInputElement | null>(null);
  const oskHandler = useRef<((a: Action) => void) | null>(null);

  const leaveUi = useCallback(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    setNavMode("grid");
  }, []);

  // Une fenêtre qui s'ouvre prend la navigation ; à sa fermeture, on revient à la grille.
  useEffect(() => {
    if (modalOpen) setNavMode("ui");
    else leaveUi();
  }, [modalOpen, leaveUi]);

  // Les contours de focus ne s'affichent que sans souris.
  useEffect(() => {
    const onMouse = () => setNavVisible(false);
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element).closest('[role="dialog"]')) setNavMode("grid");
    };
    window.addEventListener("mousemove", onMouse);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("mousemove", onMouse);
      window.removeEventListener("pointerdown", onDown);
    };
  }, []);

  /** Aiguillage commun clavier / manette. */
  const handleAction = useCallback(
    (a: Action, fromGamepad: boolean) => {
      if (oskInput) {
        if (!oskInput.isConnected) return setOskInput(null);
        return oskHandler.current?.(a);
      }
      // Raccourcis valables partout.
      if (a === "settings") {
        sound.select();
        return setSettingsOpen((open) => !open);
      }
      if (a === "fullscreen") return void toggleFullscreen();
      if (a === "theme") {
        if (modalOpen) return;
        sound.theme();
        return cycleTheme();
      }
      if (a === "sound") return modalOpen ? undefined : toggleSound();
      if (a === "search") {
        const input = searchRef.current;
        if (modalOpen || !input) return;
        setNavMode("ui");
        setNavVisible(true);
        input.focus();
        // À la manette, on ouvre directement le clavier virtuel.
        if (fromGamepad) setOskInput(input);
        return;
      }
      if (a === "zoomIn" || a === "zoomOut") return modalOpen ? undefined : changeZoom(a === "zoomIn" ? 1 : -1);

      if (modalOpen || navMode === "ui") {
        setNavVisible(true);
        const active = document.activeElement;
        if (isDir(a)) {
          if (isRange(active) && (a === "left" || a === "right")) {
            if (fromGamepad) nudgeRange(active, a === "right" ? 1 : -1);
            return;
          }
          if (moveFocus(a)) return sound.move();
          // Sous la barre d'outils, on redescend dans la grille.
          if (!modalOpen && a === "down") {
            leaveUi();
            sound.move();
          }
          return;
        }
        if (a === "confirm") {
          // Champ de texte à la manette : clavier virtuel.
          if (isTextInput(active)) return fromGamepad ? setOskInput(active) : undefined;
          return (active as HTMLElement | null)?.click?.();
        }
        if (a === "back") {
          if (settingsOpen) setSettingsOpen(false);
          else if (themeEditor) {
            themes.setPreview(null);
            setThemeEditor(null);
          } else if (editor) setEditor(null);
          else leaveUi();
        }
        return;
      }

      // Mode grille.
      if (isDir(a)) {
        // ↑ depuis la première rangée : on monte dans les boutons (barre d'outils, écran du haut…).
        if (a === "up" && held == null && toColRow(cursorRef.current, rows).row === 0) {
          const rect = gridArea?.querySelector(`[data-slot="${cursorRef.current}"]`)?.getBoundingClientRect();
          if (moveFocus("up", rect)) {
            setNavMode("ui");
            setNavVisible(true);
            sound.move();
          }
          return;
        }
        return move(a === "left" ? -1 : a === "right" ? 1 : 0, a === "up" ? -1 : a === "down" ? 1 : 0);
      }
      if (a === "confirm") return held != null ? dropHeld() : activate();
      if (a === "back") return held != null ? cancelHeld() : back();
      if (a === "grab") return grab();
      if (a === "create") return startNewFolder();
    },
    [oskInput, modalOpen, navMode, settingsOpen, editor, themeEditor, themes, held, rows, gridArea, toggleFullscreen, changeZoom, cycleTheme, toggleSound, leaveUi, move, dropHeld, activate, cancelHeld, back, grab, startNewFolder],
  );

  useEffect(() => {
    const arrows: Record<string, Dir> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
    // Raccourcis sans effet dans une fenêtre (on y tape, on y navigue).
    const mainOnly = new Set<Action>(["create", "zoomIn", "zoomOut", "search", "theme", "sound"]);
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      // Touches configurées (paramètres → Touches) ; les flèches restent actives dans les champs.
      const action = keyAction(e.key);
      const dir = (action && isDir(action) ? action : null) ?? arrows[e.key] ?? null;

      // Clavier virtuel ouvert : les directions le pilotent, la frappe physique va dans le champ.
      if (oskInput) {
        if (dir) {
          e.preventDefault();
          handleAction(dir, false);
        } else if (e.key === "Escape" || e.key === "Enter") {
          e.preventDefault();
          handleAction("back", false);
        }
        return;
      }

      // Dans un champ de texte : ↑ / ↓ en sortent, Entrée dans la recherche lance le premier résultat.
      if (isTextInput(e.target as Element)) {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          setNavMode("ui");
          setNavVisible(true);
          if (!moveFocus(arrows[e.key]) && !modalOpen && e.key === "ArrowDown") leaveUi();
        } else if (e.key === "Enter" && !modalOpen) {
          e.preventDefault();
          leaveUi();
          activate();
        }
        return;
      }

      // Dans les menus, Entrée / Espace activent le bouton sélectionné, comme d'habitude.
      if ((modalOpen || navMode === "ui") && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        return handleAction("confirm", false);
      }
      const resolved = dir ?? action;
      if (!resolved || (modalOpen && mainOnly.has(resolved))) return;
      e.preventDefault();
      handleAction(resolved, false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [oskInput, modalOpen, navMode, handleAction, leaveUi, activate]);

  useGamepad((a) => handleAction(a, true));

  // ─── Rendu ───────────────────────────────────────────────────────────────────────────

  const status = scanning
    ? t("scanning")
    : scannedAt
      ? t("updatedAt", { time: new Date(scannedAt * 1000).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) })
      : "";

  // Pendant une prise au clavier / à la manette, l'écran du haut montre l'icône tenue.
  const shown = held != null ? (items[held] ?? current) : current;
  const itemKey = shown?.kind === "game" ? `g${shown.game.appid}` : shown?.kind === "folder" ? `f${shown.folder.id}` : "empty";
  const editedFolder = editor?.mode === "new" ? editor.draft : editor ? board.folders[editor.id] : null;

  return (
    <div className="flex h-full flex-col">
      <TopBar
        ref={searchRef}
        query={query}
        onQuery={setQuery}
        soundOn={soundOn}
        onToggleSound={toggleSound}
        scanning={scanning}
        onRescan={handleRescan}
        fullscreen={fullscreen}
        onToggleFullscreen={() => void toggleFullscreen()}
        onOpenSettings={() => {
          sound.select();
          setSettingsOpen(true);
        }}
      />

      <main className="flex min-h-0 flex-1 flex-col gap-3 p-5 pt-4">
        {/* Écran du haut */}
        <div className="shrink-0" style={{ height: "clamp(180px, 34vh, 380px)" }}>
          <TopScreen
            item={games.length ? shown : null}
            itemKey={itemKey}
            folderName={openFolder?.name ?? null}
            launching={launchingId != null}
            canCreateFolder={view == null && !browsing && games.length > 0}
            download={current?.kind === "game" ? downloads.get(current.game.appid) : undefined}
            onLaunch={() =>
              current?.kind === "game" &&
              void (current.game.installed ? launch(current.game) : install(current.game))
            }
            onOpenFolder={() => current?.kind === "folder" && enterFolder(current.folder.id)}
            onEditFolder={() => current?.kind === "folder" && setEditor({ mode: "edit", id: current.folder.id })}
            onDeleteFolder={() => current?.kind === "folder" && removeFolder(current.folder.id)}
            onCreateFolder={startNewFolder}
            onMoveOut={() => moveOut(cursorIndex)}
          />
        </div>

        {/* Charnière entre les deux écrans */}
        <div className="mx-auto h-1.5 w-24 shrink-0 rounded-full bg-muted/25" aria-hidden />

        {/* Écran du bas */}
        <section
          className="panel flex min-h-0 flex-1 flex-col shadow-soft transition-colors"
          style={openFolder ? { backgroundColor: `color-mix(in srgb, ${openFolder.color} 14%, var(--surface))` } : undefined}
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 pb-1 pt-3">
            {openFolder && (
              // « Retour » sert aussi de zone de dépôt pour sortir un jeu du dossier (voir BoardGrid).
              <motion.button
                type="button"
                data-drop="back"
                onClick={leaveFolder}
                onMouseEnter={() => sound.hover()}
                animate={{ scale: backHover ? 1.1 : 1 }}
                whileTap={{ scale: 0.92 }}
                className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-extrabold shadow-soft ${
                  backHover ? "bg-accent text-on-accent" : "bg-surface text-ink"
                }`}
                title={t("backTitle")}
              >
                {t("back")}
              </motion.button>
            )}
            {held != null && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-full bg-accent px-4 py-1.5 text-sm font-extrabold text-on-accent shadow-soft"
              >
                {t("holdingHint")}
              </motion.p>
            )}
            <p className={`flex items-center gap-2 text-sm font-extrabold ${held != null ? "hidden" : ""}`}>
              {openFolder && <span className="h-3 w-3 rounded-full" style={{ background: openFolder.color }} />}
              {openFolder && <span>{openFolder.name} ·</span>}
              {tn("games", gameCount)}
              <span className="font-bold text-muted">{status}</span>
            </p>
            <div className="ml-auto flex items-center gap-1 text-sm font-bold text-muted">
              {view == null && !browsing && (
                <button
                  type="button"
                  onMouseEnter={() => sound.hover()}
                  onClick={startNewFolder}
                  disabled={current != null}
                  title={current != null ? t("addFolderDisabled") : t("addFolderTitle")}
                  className="mr-2 rounded-full px-3 py-1 transition-colors hover:bg-accent-soft hover:text-accent-strong disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  {t("addFolder")}
                </button>
              )}
              {view == null && (
                <div className="mr-2 flex items-center gap-1 rounded-full bg-surface-2 p-1">
                  {([[false, t("viewInstalled")], [true, t("viewAll")]] as const).map(([mode, label]) => (
                    <button
                      key={label}
                      type="button"
                      aria-pressed={showAll === mode}
                      onMouseEnter={() => sound.hover()}
                      onClick={() => {
                        if (showAll === mode) return;
                        sound.select();
                        setShowAll(mode);
                      }}
                      className={`rounded-full px-3 py-1 transition-colors ${
                        showAll === mode ? "bg-accent text-on-accent" : "hover:text-accent-strong"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              {/* Le tri réécrit le plateau : il n'a pas de sens dans une vue à plat. */}
              {!browsing && (
                <>
                  <span className="mr-1">{t("sort")}</span>
                  {(
                    [
                      ["recent", t("sortRecent")],
                      ["alpha", t("sortAlpha")],
                    ] as const
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onMouseEnter={() => sound.hover()}
                      onClick={() => sortBy(mode)}
                      className="rounded-full px-3 py-1 transition-colors hover:bg-accent-soft hover:text-accent-strong"
                    >
                      {label}
                    </button>
                  ))}
                </>
              )}
            </div>
            <ZoomControls level={MAX_ROWS - rows} levels={MAX_ROWS - MIN_ROWS + 1} onZoom={changeZoom} />
          </div>

          <div
            // La molette fait défiler le quadrillage vers la droite, comme Maj + molette (useHorizontalWheel).
            ref={gridAreaRef}
            data-nav-skip
            className="soft-scroll min-h-0 flex-1 overflow-x-auto overflow-y-hidden px-6 py-4"
          >
            {games.length > 0 && items.length > 0 ? (
              <BoardGrid
                items={items}
                rows={rows}
                tileSize={tileSize}
                gap={GAP}
                labelHeight={labelHeight}
                cursor={cursorIndex}
                editable={!browsing}
                downloads={downloads}
                onCursor={pointAt}
                onActivate={activateTile}
                onMove={moveItem}
                onMoveOut={moveOut}
                onBackHover={setBackHover}
                held={held}
                showCursor={navMode === "grid" && !modalOpen}
              />
            ) : (
              <EmptyState loaded={loaded} error={error} query={query} tileSize={tileSize} onRetry={handleRescan} />
            )}
          </div>
        </section>
      </main>

      <AnimatePresence>
        {oskInput && (
          <OnScreenKeyboard key="osk" input={oskInput} handlerRef={oskHandler} onClose={() => setOskInput(null)} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {settingsOpen && (
          <SettingsModal
            key="settings"
            themes={themes}
            initialTab={settingsTab}
            notify={showToast}
            onEditTheme={(def, isNew) => {
              setSettingsOpen(false);
              setThemeEditor({ def, isNew });
            }}
            soundOn={soundOn}
            onToggleSound={toggleSound}
            fullscreen={fullscreen}
            onToggleFullscreen={() => void toggleFullscreen()}
            cursorStyle={cursorStyle.style}
            onCursorStyle={cursorStyle.setStyle}
            autoConfirm={autoConfirm}
            onToggleAutoConfirm={() => setAutoConfirm((on) => !on)}
            onResetLayout={resetLayout}
            onResetPrefs={resetPrefs}
            onClearCache={() => void clearGameCache()}
            onResetAll={() => void resetAll()}
            presets={presets.presets}
            onSavePreset={savePreset}
            onLoadPreset={loadPreset}
            onOverwritePreset={overwritePreset}
            onRenamePreset={presets.rename}
            onDeletePreset={deletePreset}
            onClose={() => setSettingsOpen(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {themeEditor && (
          <ThemeEditor
            key="theme-editor"
            initial={themeEditor.def}
            isNew={themeEditor.isNew}
            onChange={themes.setPreview}
            onSave={(def) => {
              themes.setPreview(null);
              themes.saveUserTheme(def);
              setThemeEditor(null);
              showToast(t("themeSaved", { name: themeName(def, lang) }));
              setSettingsTab("theme");
              setSettingsOpen(true);
            }}
            onCancel={() => {
              themes.setPreview(null);
              setThemeEditor(null);
              setSettingsTab("theme");
              setSettingsOpen(true);
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editor && editedFolder && (
          <FolderEditor
            key="editor"
            folder={editedFolder}
            games={gamesOf(editedFolder.slots)}
            isNew={editor.mode === "new"}
            onSave={saveEditor}
            onCancel={() => setEditor(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast}
            role="status"
            initial={{ opacity: 0, y: 24, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 420, damping: 28 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-ink px-5 py-2.5 text-sm font-bold text-bg shadow-pop"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function EmptyState({
  loaded,
  error,
  query,
  tileSize,
  onRetry,
}: {
  loaded: boolean;
  error: string | null;
  query: string;
  tileSize: number;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  if (!loaded) {
    // Squelette pendant le tout premier scan (aucun cache encore).
    return (
      <div className="flex h-full items-center gap-[18px]">
        {Array.from({ length: 8 }, (_, i) => (
          <motion.div
            key={i}
            className="aspect-square shrink-0 rounded-tile bg-surface-2"
            style={{ width: tileSize }}
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ repeat: Infinity, duration: 1.4, delay: i * 0.06 }}
          />
        ))}
      </div>
    );
  }
  return (
    <div className="grid h-full place-items-center text-center">
      <div className="space-y-3">
        <p className="text-lg font-extrabold">
          {query ? t("noMatch", { q: query }) : error ? t("steamNotFound") : t("noGames")}
        </p>
        {error && <p className="max-w-md text-sm font-bold text-muted">{error}</p>}
        {!query && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-full bg-accent px-5 py-2 font-extrabold text-on-accent shadow-soft"
          >
            {t("rescan")}
          </button>
        )}
      </div>
    </div>
  );
}
