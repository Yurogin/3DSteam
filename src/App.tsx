import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { TopBar } from "./components/TopBar";
import { TopScreen } from "./components/TopScreen";
import { BoardGrid, type ViewItem } from "./components/BoardGrid";
import { FolderEditor } from "./components/FolderEditor";
import { mascotReact, suggestName } from "./lib/mascot";
import { SettingsModal, type Tab as SettingsTab } from "./components/SettingsModal";
import { ThemeEditor } from "./components/ThemeEditor";
import { themeName, type ThemeDef } from "./themes/format";
import { ZoomControls } from "./components/ZoomControls";
import { useLibrary } from "./hooks/useLibrary";
import { useGridMetrics } from "./hooks/useGridMetrics";
import { useGamepad } from "./hooks/useGamepad";
import { useDownloads } from "./hooks/useDownloads";
import { useArrivals } from "./hooks/useArrivals";
import { appName, builtinGames, loadOpened, markOpened } from "./apps/builtin";
import { AppWindow, type AppActionHandler } from "./apps/AppWindow";
import { ActivityLog } from "./apps/ActivityLog";
import { MusicPlayer } from "./apps/MusicPlayer";
import { PhotoAlbum } from "./apps/PhotoAlbum";
import { ProfilePage } from "./apps/Profile";
import { SvgiiPlaza } from "./apps/plaza/SvgiiPlaza";
import { player, usePlayer } from "./apps/player";
import { menuMusic } from "./lib/menuMusic";
import { recordSnapshot } from "./apps/activityHistory";
import { useDepartures } from "./hooks/useDepartures";
import { ActionMenu, type MenuEntry } from "./components/ActionMenu";
import { GameIcon } from "./components/GameIcon";
import { FolderArt } from "./components/FolderTile";
import { LaunchSplash, type SplashEnd } from "./components/LaunchSplash";
import { DownloadIcon, EditIcon, ExitIcon, FolderOpenIcon, MinimizeIcon, PauseIcon, PlayIcon, PlusIcon, PowerIcon, StopIcon, StoreIcon, TrashIcon } from "./components/Icons";
import { useRunning } from "./hooks/useRunning";
import { OnScreenKeyboard } from "./components/OnScreenKeyboard";
import { isDir, isRange, isTextInput, moveFocus, nudgeRange, setNavVisible, type Action, type Dir } from "./lib/nav";
import { keyAction, resetBindings } from "./lib/bindings";
import { useHorizontalWheel } from "./hooks/useHorizontalWheel";
import { DEFAULT_THEME, useTheme } from "./themes/themes";
import { defaultLang, useI18n } from "./lib/i18n";
import {
  bridgeFolders,
  bridgeInstall,
  bridgeUninstall,
  clearCache,
  downloadAction,
  installGame,
  launchGame,
  minimizeApp,
  steamPersona,
  stopGame,
  quitApp,
  openDownloads,
  openStore,
  revealGame,
  steamControlState,
  startupSettings,
  activityStats,
  uninstallGame,
  type DownloadAction,
  type InstallFolder,
} from "./lib/api";
import { formatSize } from "./lib/format";
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
import type { BuiltinId, Game } from "./types";

/** Zoom façon console portable : nombre de rangées affichées (moins de rangées = icônes plus grandes). */
const MIN_ROWS = 1;
const MAX_ROWS = 4;
const GAP = 18;
/** Hauteur réservée au nom sous l'icône, quand il y a 1 ou 2 rangées. */
const LABEL_HEIGHT = 26;
const LAUNCH_FEEDBACK_MS = 2500;
/** Un jeu qui ne s'est pas fermé au bout de ce délai se voit proposer l'arrêt forcé. */
const STOP_FORCE_MS = 6000;

type Editor = { mode: "new"; index: number; draft: Folder } | { mode: "edit"; id: string } | null;

const normalize = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export default function App() {
  const { games: installedGames, catalog: knownGames, scannedAt, loaded, scanning, error, rescan } = useLibrary();
  const { t, tn, lang, locale, setLang } = useI18n();
  const themes = useTheme();
  const cursorStyle = useCursorStyle();
  const iconStyle = useIconStyle();
  /** Un téléchargement qui s'achève relance le scan : le jeu devient jouable de lui-même. */
  const liveDownloads = useDownloads(rescan);
  // Un jeu qu'on installe arrive sur le plateau dès le début de son téléchargement.
  const { arriving, downloads, ready } = useArrivals(
    installedGames,
    knownGames,
    liveDownloads,
    scannedAt,
    loaded,
    () => sound.arrive(),
    (game) => {
      sound.ready();
      mascotReact("happy");
      showToast(t("gameReady", { name: game.name }));
    },
  );
  // Les applis intégrées (journal, musique, album) se rangent sur le plateau comme des jeux.
  const [appsOpened, setAppsOpened] = useState(loadOpened);
  const appGames = useMemo(() => builtinGames(t, appsOpened), [t, appsOpened]);
  const boardGames = useMemo(() => [...installedGames, ...appGames, ...arriving], [installedGames, appGames, arriving]);
  /** Tous les jeux Steam connus, installés ou non : les applis y cherchent noms et icônes. */
  const steamById = useMemo(() => new Map([...knownGames, ...installedGames].map((g) => [g.appid, g])), [knownGames, installedGames]);
  /** Jeux dont on a demandé la désinstallation (ou l'annulation) : leur départ sera spectaculaire. */
  const watchedRef = useRef(new Set<number>());
  const { ghosts, leaving } = useDepartures(boardGames, watchedRef.current);
  // La mascotte est triste de voir partir un jeu.
  useEffect(() => {
    if (leaving.size) mascotReact("sad");
  }, [leaving]);
  const games = useMemo(() => (ghosts.length ? [...boardGames, ...ghosts] : boardGames), [boardGames, ghosts]);
  const catalog = useMemo(() => {
    const onBoard = new Set([...arriving, ...ghosts].map((g) => g.appid));
    return onBoard.size ? knownGames.filter((g) => !onBoard.has(g.appid)) : knownGames;
  }, [knownGames, arriving, ghosts]);
  const downloadList = useMemo(() => [...downloads.values()], [downloads]);
  const downloadsRef = useRef(downloads);
  downloadsRef.current = downloads;
  const [padMouse, setPadMouse] = useState(() => load("padMouse", true));
  useEffect(() => save("padMouse", padMouse), [padMouse]);
  const { theme, setTheme, cycle: cycleTheme } = themes;

  const [zoomRows, setZoomRows] = useState(() => Math.min(MAX_ROWS, Math.max(MIN_ROWS, load("rows", 2))));
  const [board, setBoard] = useState<Board>(() =>
    migrateBoard(load("board.v2", null), load("board", null), load("order", null)),
  );
  /** Plateau affiché : principal (`null`) ou dossier ouvert. */
  const [view, setView] = useState<ViewId>(null);
  const [cursor, setCursor] = useState(() => load("cursor", 0));
  const [editor, setEditor] = useState<Editor>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Premier lancement : le profil prend le pseudo Steam, tant qu'on ne l'a pas renommé.
  useEffect(() => {
    void steamPersona().then(suggestName).catch(() => {});
  }, []);
  /** Onglet à rouvrir (après l'éditeur de thème, on revient sur « Thème »). */
  const [settingsTab, setSettingsTab] = useState<SettingsTab | undefined>(undefined);
  const [themeEditor, setThemeEditor] = useState<{ def: ThemeDef; isNew: boolean } | null>(null);
  const presets = usePresets();
  /** Menu d'actions d'une case : au pointeur (clic droit) ou au coin de la tuile (clavier, manette). */
  const [menu, setMenu] = useState<{ index: number; x: number; y: number; flipX?: number } | null>(null);
  /** Menu du bouton marche/arrêt (barre du haut) : réduire ou quitter. */
  const [powerMenu, setPowerMenu] = useState<DOMRect | null>(null);
  /**
   * Le plugin Millennium à jour tourne-t-il en ce moment ? Demandé à chaque action et pas gardé :
   * Steam peut avoir redémarré (et chargé ou perdu le plugin) depuis l'ouverture de 3DSteam.
   */
  const bridgeReady = useCallback(
    () =>
      steamControlState().then(
        (s) => s.bridgeCurrent,
        () => false,
      ),
    [],
  );
  /** Petit menu de choix ouvert par une action : bibliothèque où installer, confirmation. */
  const [choice, setChoice] = useState<{ title: string; game: Game; entries: MenuEntry[]; x: number; y: number; flipX?: number } | null>(null);
  /** Séquence de lancement d'un jeu, en plein écran, et la case d'où part son icône. */
  const [splash, setSplash] = useState<{ game: Game; from: DOMRect | null } | null>(null);
  /** Fin de la séquence de lancement : le jeu s'est ouvert, s'est refermé, ou se fait attendre. */
  const endSplash = useCallback(
    (why: SplashEnd) => {
      const name = splashRef.current?.game.name ?? "";
      setSplash(null);
      if (why === "opened" && load("minimizeOnLaunch", false)) void minimizeApp().catch(() => {});
      if (why === "closed") showToast(t("launchClosed", { name }));
      if (why === "timeout") showToast(t("launchTimeout", { name }));
    },
    // `showToast`, déclaré plus bas, ne change jamais : le citer ici le lirait avant sa création.
    [t],
  );
  const splashRef = useRef(splash);
  splashRef.current = splash;
  /** Appli intégrée ouverte en plein écran. */
  const [openAppId, setOpenAppId] = useState<BuiltinId | null>(null);
  const modalOpen =
    editor != null || settingsOpen || themeEditor != null || menu != null || powerMenu != null || choice != null || openAppId != null;
  const [query, setQuery] = useState("");
  /** Vue « Tout » : les jeux installés et ceux que le client connaît, à plat. */
  const [showAll, setShowAll] = useState(false);
  const [soundOn, setSoundOn] = useState(sound.enabled);
  const [launchingId, setLaunchingId] = useState<number | null>(null);
  /** Jeux qui tournent : on ne les relance pas, on peut les arrêter. */
  const { running, refresh: refreshRunning } = useRunning();
  const runningRef = useRef(running);
  runningRef.current = running;
  /** Arrêts demandés : depuis quand, et si l'arrêt forcé est désormais proposé. */
  const [stopping, setStopping] = useState<Map<number, { name: string; force: boolean }>>(() => new Map());
  const [toast, setToast] = useState<string | null>(null);
  const [backHover, setBackHover] = useState(false);
  /** Case d'origine de l'icône « prise » au clavier / à la manette, qui suit le curseur. */
  const [held, setHeld] = useState<number | null>(null);
  const [fullscreen, setFullscreenState] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  // Rangées réellement affichées : un petit écran (Steam Deck) en retire, sans changer le zoom choisi.
  const [{ tile: tileSize, columns, rows, maxRows }, setGridMetricsEl] = useGridMetrics(zoomRows, MAX_ROWS, LABEL_HEIGHT, GAP);
  const labelHeight = rows <= 2 ? LABEL_HEIGHT : 0;
  const [gridArea, setGridArea] = useState<HTMLElement | null>(null);
  const gridAreaRef = useCallback(
    (el: HTMLElement | null) => {
      setGridMetricsEl(el);
      setGridArea(el);
    },
    [setGridMetricsEl],
  );
  useHorizontalWheel(gridArea);

  useEffect(() => save("rows", zoomRows), [zoomRows]);
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

  // Le curseur suit le jeu (ou le dossier) qu'il désigne, même quand celui-ci change de case :
  // tri, installation qui le pose sur le plateau, recherche qui filtre. Seul un déplacement voulu
  // du curseur change ce qu'il suit.
  const followed = useRef<{ key: string | null; index: number }>({ key: slotKey(current), index: cursorIndex });
  useEffect(() => {
    const was = followed.current;
    if (cursorIndex !== was.index) {
      followed.current = { key: slotKey(items[cursorIndex] ?? null), index: cursorIndex };
      return;
    }
    if (was.key == null || slotKey(items[cursorIndex] ?? null) === was.key) return;
    const moved = items.findIndex((item) => slotKey(item) === was.key);
    if (moved >= 0) {
      followed.current = { key: was.key, index: moved };
      setCursor(moved);
    }
  }, [items, cursorIndex]);

  // Le compteur parle de jeux : les applis n'y entrent pas.
  const realGames = (list: (Game | null | undefined)[]) => list.filter((g) => g && !g.builtin).length;
  const gameCount = browsing
    ? realGames(items.map((it) => (it?.kind === "game" ? it.game : null)))
    : realGames(view == null ? games : gamesOf(openFolder?.slots ?? []));

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

  /** L'action clavier/manette que l'appli ouverte intercepte (← → dans la visionneuse…). */
  const appHandler = useRef<AppActionHandler | null>(null);
  const registerApp = useCallback((handler: AppActionHandler | null) => {
    appHandler.current = handler;
  }, []);
  const openApp = useCallback((id: BuiltinId) => {
    sound.zoom(1);
    setOpenAppId(id);
    // Ouvrir une appli compte comme y jouer : le tri « Récents » la remonte.
    setAppsOpened(markOpened(id));
  }, []);
  const closeApp = useCallback(() => {
    sound.zoom(-1);
    appHandler.current = null;
    setOpenAppId(null);
  }, []);

  const launch = useCallback(
    async (game: Game) => {
      if (game.builtin) return openApp(game.builtin);
      if (launchingId != null) return;
      // Filet de sécurité : un jeu du catalogue passe par `install`, jamais par ici.
      if (!game.installed) return;
      // Déjà lancé : le relancer ouvrirait une seconde instance, ou rien du tout.
      if (runningRef.current.has(game.appid)) {
        sound.error();
        return showToast(t("alreadyRunning", { name: game.name }));
      }
      setLaunchingId(game.appid);
      // La grande séquence de lancement (⚙ → Général → Démarrage pour s'en passer) part de la
      // case du jeu, si elle est à l'écran.
      const withSplash = load("launchSplash", true);
      if (withSplash) {
        const rect = document.querySelector(`[data-appid="${game.appid}"]`)?.getBoundingClientRect() ?? null;
        const visible = rect && rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
        setSplash({ game, from: visible ? rect : null });
        sound.launchBig();
      } else {
        sound.launch();
      }
      mascotReact("excited");
      // La musique du lecteur s'efface devant le jeu.
      player.pause();
      try {
        await launchGame(game.appid);
        // Avec la séquence de lancement, 3DSteam s'efface quand le jeu est vraiment ouvert
        // (voir `endSplash`) ; sans elle, juste après la demande.
        if (!withSplash) {
          showToast(t("starting", { name: game.name }));
          if (load("minimizeOnLaunch", false)) window.setTimeout(() => void minimizeApp().catch(() => {}), 600);
        }
      } catch (e) {
        setSplash(null);
        sound.error();
        showToast(String(e));
      } finally {
        window.setTimeout(() => setLaunchingId(null), LAUNCH_FEEDBACK_MS);
      }
    },
    [launchingId, openApp, showToast, t],
  );

  /** Arrêter : d'abord poliment (ses fenêtres reçoivent l'ordre de se fermer), puis de force s'il ne répond pas. */
  const stopRunning = useCallback(
    async (game: Game, force: boolean) => {
      try {
        const outcome = await stopGame(game.appid, force);
        if (outcome === "closing") {
          sound.select();
          showToast(t("stopClosing", { name: game.name }));
          setStopping((m) => new Map(m).set(game.appid, { name: game.name, force: false }));
        } else if (outcome === "noWindow") {
          showToast(t("stopNoWindow", { name: game.name }));
          setStopping((m) => new Map(m).set(game.appid, { name: game.name, force: true }));
        } else if (outcome === "killed") {
          sound.crack();
          showToast(t("stopKilled", { name: game.name }));
        } else {
          showToast(t("stopNotRunning", { name: game.name }));
        }
      } catch (e) {
        sound.error();
        showToast(String(e));
      }
      refreshRunning();
      window.setTimeout(refreshRunning, 1200);
    },
    [refreshRunning, showToast, t],
  );

  // Il ne se ferme pas : passé le délai, l'arrêt forcé est proposé.
  useEffect(() => {
    const waiting = [...stopping].filter(([, s]) => !s.force);
    if (!waiting.length) return;
    const id = window.setTimeout(() => {
      const slow = waiting.filter(([appid]) => runningRef.current.has(appid));
      if (!slow.length) return;
      slow.forEach(([, s]) => showToast(t("stopSlow", { name: s.name })));
      setStopping((m) => {
        const next = new Map(m);
        for (const [appid, s] of slow) if (next.has(appid)) next.set(appid, { ...s, force: true });
        return next;
      });
    }, STOP_FORCE_MS);
    return () => window.clearTimeout(id);
  }, [stopping, showToast, t]);

  // Le jeu s'est fermé : la demande d'arrêt est oubliée.
  useEffect(() => {
    const done = [...stopping].filter(([appid]) => !running.has(appid));
    if (!done.length) return;
    done.forEach(([, s]) => showToast(t("stopDone", { name: s.name })));
    setStopping((m) => {
      const next = new Map(m);
      for (const [appid] of done) next.delete(appid);
      return next;
    });
  }, [running, stopping, showToast, t]);

  /**
   * Installation : Steam impose sa boîte de dialogue, qui ne répond pas au clavier et n'expose
   * rien à l'accessibilité. On ne la valide donc pas à la place de l'utilisateur — ce serait
   * accepter un contrat de licence pour lui —, on lui donne de quoi le faire à la manette ou au
   * clavier.
   */
  /** Où ouvrir un petit menu de choix : contre la tuile du curseur, comme le menu d'actions. */
  const choiceAnchor = useCallback(() => {
    const rect = gridArea?.querySelector(`[data-slot="${cursorRef.current}"] [data-square]`)?.getBoundingClientRect();
    return rect ? { x: rect.right + 10, y: rect.top, flipX: rect.left - 10 } : { x: window.innerWidth / 2 - 120, y: window.innerHeight / 3 };
  }, [gridArea]);

  /** Par la boîte d'installation de Steam, que l'utilisateur valide (pilotable à la manette). */
  const installInSteam = useCallback(
    async (game: Game) => {
      showToast(padMouse ? t("installPad", { name: game.name }) : t("installConfirm"));
      try {
        await installGame(game.appid, padMouse);
        // Un tout petit jeu peut être installé avant le premier sondage : la disparition du
        // téléchargement passerait alors inaperçue. Ce scan différé rattrape ce cas ; les
        // téléchargements plus longs restent couverts par `useDownloads`.
        window.setTimeout(() => void rescan(), 6000);
      } catch (e) {
        sound.error();
        showToast(String(e));
      }
    },
    [padMouse, rescan, showToast, t],
  );

  /**
   * Par le plugin Millennium : le téléchargement part sans la boîte de Steam. Un contrat de licence,
   * un manque de place ou une clé laissent la boîte de Steam à l'utilisateur.
   */
  const installByBridge = useCallback(
    async (game: Game, folder: number | null) => {
      showToast(t("installStarting", { name: game.name }));
      try {
        const outcome = await bridgeInstall(game.appid, folder, padMouse);
        if (outcome.started) {
          sound.arrive();
          showToast(t("installStarted", { name: game.name }));
          window.setTimeout(() => void rescan(), 6000);
          return;
        }
        const reason = outcome.reason ?? "failed";
        if (reason === "eula") showToast(t("installEula", { name: game.name }));
        else if (reason === "space") showToast(t("installSpace", { name: game.name }));
        else if (reason === "steam" || reason === "folder") showToast(t("installInSteamWindow", { name: game.name }));
        else {
          sound.error();
          showToast(t("installFailed", { name: game.name }));
        }
        window.setTimeout(() => void rescan(), 6000);
      } catch {
        // Plugin injoignable : la boîte de Steam, comme sans Millennium.
        void installInSteam(game);
      }
    },
    [padMouse, rescan, showToast, t, installInSteam],
  );

  const install = useCallback(
    async (game: Game) => {
      sound.select();
      if (!(await bridgeReady())) return installInSteam(game);
      let folders: InstallFolder[] = [];
      try {
        folders = await bridgeFolders();
      } catch {
        return installInSteam(game);
      }
      if (folders.length <= 1) return installByBridge(game, null);
      // Plusieurs bibliothèques : on choisit où, celle par défaut de Steam en tête.
      const sorted = [...folders].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
      setChoice({
        title: t("installWhere", { name: game.name }),
        game,
        ...choiceAnchor(),
        entries: sorted.map((folder) => ({
          id: `folder-${folder.index}`,
          label: t("installFolderEntry", {
            folder: folder.label || folder.path,
            free: formatSize(folder.free, t, locale),
          }),
          icon: <DownloadIcon width={18} height={18} />,
          onSelect: () => void installByBridge(game, folder.index),
        })),
      });
    },
    [bridgeReady, installInSteam, installByBridge, choiceAnchor, t, locale],
  );

  /**
   * Désinstallation : même boîte imposée par Steam, même pilotage. C'est l'utilisateur qui
   * confirme, dans Steam ; le jeu quitte ensuite la grille et laisse sa case vide.
   */
  const uninstallInSteam = useCallback(
    async (game: Game) => {
      showToast(padMouse ? t("uninstallPad", { name: game.name }) : t("uninstallConfirm", { name: game.name }));
      // Si Steam confirme, la tuile volera en éclats au scan qui constate son départ.
      watchedRef.current.add(game.appid);
      try {
        await uninstallGame(game.appid, padMouse);
        // Steam retire ses fichiers en quelques secondes après la confirmation.
        void rescan();
        window.setTimeout(() => void rescan(), 5000);
      } catch (e) {
        sound.error();
        showToast(String(e));
      }
    },
    [padMouse, rescan, showToast, t],
  );

  /** Demande confirmation dans 3DSteam, puis lance `action` : la boîte de Steam ne s'ouvrira pas. */
  const confirmInApp = useCallback(
    (game: Game, title: string, label: string, action: () => void) => {
      setChoice({
        title,
        game,
        ...choiceAnchor(),
        entries: [
          { id: "keep", label: t("cancel"), icon: <ExitIcon width={18} height={18} />, onSelect: () => {} },
          { id: "confirm", label, icon: <TrashIcon width={18} height={18} />, danger: true, onSelect: action },
        ],
      });
    },
    [choiceAnchor, t],
  );

  /** Avec le plugin Millennium, la confirmation se fait dans 3DSteam, sans la boîte de Steam. */
  const uninstall = useCallback(
    async (game: Game) => {
      if (!(await bridgeReady())) return void uninstallInSteam(game);
      confirmInApp(game, t("uninstallAsk", { name: game.name }), t("menuUninstall"), () => {
        watchedRef.current.add(game.appid);
        bridgeUninstall(game.appid).then(
          () => {
            showToast(t("uninstallStarted", { name: game.name }));
            void rescan();
            window.setTimeout(() => void rescan(), 5000);
          },
          // Plugin injoignable : la boîte de Steam, comme sans Millennium.
          () => void uninstallInSteam(game),
        );
      });
    },
    [bridgeReady, uninstallInSteam, confirmInApp, showToast, rescan, t],
  );

  // Journal d'activité : à chaque scan, le cumul du jour est noté, même si le journal reste fermé.
  useEffect(() => {
    if (scannedAt) void activityStats().then(recordSnapshot).catch(() => {});
  }, [scannedAt]);

  /** Le port de débogage de Steam répond : pause, reprise et annulation passent directement. */
  const [directControl, setDirectControl] = useState(false);
  useEffect(() => {
    if (settingsOpen) return;
    void steamControlState()
      .then((s) => {
        setDirectControl(s.connected);
      })
      .catch(() => {
        setDirectControl(false);
      });
  }, [settingsOpen]);

  /**
   * Pause, reprise, annulation. Annuler une installation passe par la boîte de désinstallation
   * de Steam (ce qui a été reçu est effacé) ; le reste passe directement si le port de débogage
   * est ouvert, sinon par la liste des téléchargements de Steam, qu'on pilote soi-même.
   */
  const controlDownload = useCallback(
    async (game: Game, action: DownloadAction, confirmed = false) => {
      sound.select();
      const dialog = action === "cancel" && !game.installed;
      // Avec le plugin Millennium, annuler une installation se fait sans la boîte de Steam :
      // c'est 3DSteam qui demande confirmation.
      const bridge = dialog && !confirmed && (await bridgeReady());
      if (bridge) {
        confirmInApp(game, t("cancelAsk", { name: game.name }), t("cancelDownload"), () => void controlDownload(game, action, true));
        return;
      }
      if (dialog) {
        watchedRef.current.add(game.appid);
        if (!confirmed) showToast(t("cancelConfirm", { name: game.name }));
      }
      try {
        const how = await downloadAction(game.appid, action, game.installed, padMouse, confirmed);
        if (how === "steam") showToast(padMouse ? t("downloadInSteamPad") : t("downloadInSteam"));
        else if (how === "direct") {
          const done =
            action === "pause" ? "pausedToast" : action === "resume" ? "resumedToast" : game.installed ? "cancelledToast" : "installCancelled";
          showToast(t(done, { name: game.name }));
        }
        if (action === "cancel") {
          void rescan();
          window.setTimeout(() => void rescan(), 5000);
        }
      } catch (e) {
        sound.error();
        showToast(String(e));
      }
    },
    [padMouse, rescan, showToast, t, bridgeReady, confirmInApp],
  );

  /** Appel à Steam sans retour attendu (magasin, dossier, téléchargements) : seule l'erreur compte. */
  const tryOpen = useCallback(
    (open: () => Promise<void>) =>
      void open().catch((e) => {
        sound.error();
        showToast(String(e));
      }),
    [showToast],
  );

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
  /**
   * Ouvre le menu d'une case : au pointeur pour un clic droit, sinon contre la tuile (à sa droite,
   * ou à sa gauche si la place manque).
   */
  const openMenu = useCallback(
    (index: number, at?: { x: number; y: number }) => {
      const item = itemsRef.current[index];
      // Une case vide n'a qu'une action, possible seulement sur le plateau principal.
      if (item == null && (view != null || browsing)) return;
      setCursor(index);
      if (at) return setMenu({ index, ...at });
      const rect = gridArea?.querySelector(`[data-slot="${index}"] [data-square]`)?.getBoundingClientRect();
      if (!rect) return;
      setNavVisible(true);
      setMenu({ index, x: rect.right + 10, y: rect.top, flipX: rect.left - 10 });
    },
    [view, browsing, gridArea],
  );
  const onGridMenu = useCallback((index: number, x: number, y: number) => openMenu(index, { x, y }), [openMenu]);

  /**
   * Valider une case. Un jeu installé démarre : c'est ce qu'on attend d'une icône. Tout le reste
   * ouvre le menu plutôt que d'agir — installer lance un téléchargement de plusieurs gigaoctets,
   * ce n'est pas à faire sur une touche pressée par mégarde. C'est aussi par là qu'on atteint
   * Pause et Annuler à la manette, sans avoir à remonter dans l'écran du haut.
   */
  const activate = useCallback(
    (index?: number) => {
      const at = index ?? cursorRef.current;
      const item = itemsRef.current[at];
      if (index != null) setCursor(index);
      if (item?.kind === "folder") return enterFolder(item.folder.id);
      if (item?.kind !== "game") return;
      if (item.game.installed && !downloadsRef.current.has(item.game.appid)) return void launch(item.game);
      openMenu(at);
    },
    [launch, enterFolder, openMenu],
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

  /** Actions proposées pour la case du menu. */
  const menuEntries = useCallback(
    (index: number): MenuEntry[] => {
      const item = items[index];
      if (item == null) {
        return [{ id: "folder", label: t("newFolderButton"), icon: <PlusIcon width={18} height={18} />, onSelect: startNewFolder }];
      }
      if (item.kind === "folder") {
        const { folder } = item;
        return [
          { id: "open", label: t("open"), icon: <FolderOpenIcon width={18} height={18} />, onSelect: () => enterFolder(folder.id) },
          { id: "edit", label: t("edit"), icon: <EditIcon width={18} height={18} />, onSelect: () => setEditor({ mode: "edit", id: folder.id }) },
          { id: "delete", label: t("delete"), icon: <TrashIcon width={18} height={18} />, onSelect: () => removeFolder(folder.id), danger: true },
        ];
      }
      const { game } = item;
      // Une appli intégrée n'a rien à voir avec Steam : l'ouvrir, et c'est tout.
      if (game.builtin) {
        const id = game.builtin;
        const open: MenuEntry = { id: "open", label: t("open"), icon: <PlayIcon width={18} height={18} />, onSelect: () => openApp(id) };
        return view != null
          ? [open, { id: "out", label: t("moveOut"), icon: <ExitIcon width={18} height={18} />, onSelect: () => moveOut(index) }]
          : [open];
      }
      const download = downloads.get(game.appid);
      const entries: MenuEntry[] = [];
      if (game.installed && running.has(game.appid)) {
        entries.push({ id: "stop", label: t("stopGame"), icon: <StopIcon width={18} height={18} />, onSelect: () => void stopRunning(game, false) });
        if (stopping.get(game.appid)?.force) {
          entries.push({ id: "kill", label: t("forceStop"), icon: <StopIcon width={18} height={18} />, onSelect: () => void stopRunning(game, true), danger: true });
        }
      } else if (game.installed) {
        entries.push({ id: "launch", label: t("launch"), icon: <PlayIcon width={18} height={18} />, onSelect: () => void launch(game) });
      } else if (!download) {
        entries.push({ id: "install", label: t("install"), icon: <DownloadIcon width={18} height={18} />, onSelect: () => void install(game) });
      }
      if (download && download.phase !== "verifying" && download.phase !== "installing") {
        const running = download.phase === "downloading" || download.phase === "preparing";
        entries.push(
          running
            ? { id: "pause", label: t("pause"), icon: <PauseIcon width={18} height={18} />, onSelect: () => void controlDownload(game, "pause") }
            : { id: "resume", label: t("resume"), icon: <PlayIcon width={18} height={18} />, onSelect: () => void controlDownload(game, "resume") },
        );
      }
      // L'ordre de la file, lui, se règle dans Steam.
      if (download) {
        entries.push({ id: "downloads", label: t("menuDownloads"), icon: <DownloadIcon width={18} height={18} />, onSelect: () => tryOpen(openDownloads) });
      }
      if (game.installed && game.installDir) {
        entries.push({ id: "files", label: t("menuFiles"), icon: <FolderOpenIcon width={18} height={18} />, onSelect: () => tryOpen(() => revealGame(game)) });
      }
      // Un jeu hors Steam n'a pas de page dans le magasin, et Steam ne sait pas le désinstaller.
      if (!game.shortcut) {
        entries.push({ id: "store", label: t("menuStore"), icon: <StoreIcon width={18} height={18} />, onSelect: () => tryOpen(() => openStore(game.appid)) });
      }
      if (view != null) {
        entries.push({ id: "out", label: t("moveOut"), icon: <ExitIcon width={18} height={18} />, onSelect: () => moveOut(index) });
      }
      if (download && download.phase !== "verifying" && download.phase !== "installing") {
        const label = game.installed ? t("cancelUpdate") : t("cancelDownload");
        entries.push({ id: "cancel", label, icon: <TrashIcon width={18} height={18} />, onSelect: () => void controlDownload(game, "cancel"), danger: true });
      }
      if (game.installed && !game.shortcut) {
        entries.push({ id: "uninstall", label: t("menuUninstall"), icon: <TrashIcon width={18} height={18} />, onSelect: () => void uninstall(game), danger: true });
      }
      return entries;
    },
    [items, downloads, view, t, startNewFolder, enterFolder, removeFolder, launch, install, uninstall, controlDownload, tryOpen, moveOut, openApp, running, stopping, stopRunning],
  );

  const rowsRef = useRef({ rows, maxRows });
  rowsRef.current = { rows, maxRows };
  const changeZoom = useCallback((direction: 1 | -1) => {
    // « + » agrandit les icônes, donc retire une rangée. On part des rangées affichées, et un petit
    // écran borne le dézoom.
    const { rows: shown, maxRows: max } = rowsRef.current;
    const next = Math.min(max, Math.max(MIN_ROWS, shown - direction));
    if (next === shown) return;
    sound.zoom(direction);
    setZoomRows(next);
  }, []);

  /** Curseur libre, case par case, vides comprises (comme sur une console portable). */
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

  // À l'ouverture, la fenêtre est déjà dans l'état choisi (⚙ → Général → Démarrage, appliqué
  // par Rust avant affichage). Seul « comme la dernière fois » reste à faire ici : rétablir le
  // plein écran mémorisé.
  useEffect(() => {
    const sync = () => void isFullscreen().then(setFullscreenState).catch(() => {});
    sync();
    void startupSettings()
      .then((s) => {
        if (s.mode !== "last" || !load("fullscreen", false)) return;
        return setFullscreen(true).then(() => setFullscreenState(true));
      })
      .catch(() => {});
    // Suit aussi les sorties de plein écran faites par le système (Échap du navigateur, etc.).
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
    setZoomRows(2);
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
    setPadMouse(true);
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
    // La musique du menu démarre tout de suite dans l'appli ; dans un navigateur, au premier geste.
    menuMusic.start();
    const unlock = () => {
      sound.unlock();
      menuMusic.start();
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // 3DSteam au premier plan ? Sinon (un jeu tourne, on est passé ailleurs), la musique du menu
  // et les bandes-annonces se taisent.
  const [focused, setFocused] = useState(() => document.hasFocus());
  useEffect(() => {
    const update = () => setFocused(document.hasFocus() && document.visibilityState === "visible");
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  // La musique du menu laisse la parole à tout ce qui compte plus qu'elle.
  const music = usePlayer();
  useEffect(() => menuMusic.duck("away", !focused), [focused]);
  useEffect(() => menuMusic.duck("player", music.playing), [music.playing]);
  useEffect(() => menuMusic.duck("launch", splash != null), [splash]);
  useEffect(() => menuMusic.duck("muted", !soundOn), [soundOn]);

  // Deux modes sans souris : le curseur de la grille, ou le focus des boutons (barres, écran du
  // haut, fenêtres) qu'on parcourt aux flèches comme sur une interface de télé.
  const [navMode, setNavMode] = useState<"grid" | "ui">("grid");
  const [oskInput, setOskInput] = useState<HTMLInputElement | null>(null);
  const oskHandler = useRef<((a: Action) => void) | null>(null);

  const leaveUi = useCallback(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    setNavMode("grid");
  }, []);

  /**
   * Pastille des téléchargements : amène le curseur sur le jeu, où qu'il soit — dans la vue
   * affichée, sur le plateau, ou dans un dossier qu'on ouvre alors.
   */
  const goToGame = useCallback(
    (appid: number): boolean => {
      const isIt = (c: { kind: string; appid?: number } | null) => c?.kind === "game" && c.appid === appid;
      const here = itemsRef.current.findIndex((item) => item?.kind === "game" && item.game.appid === appid);
      const onBoard = board.slots.findIndex(isIt);
      const folder = Object.values(board.folders).find((f) => f.slots.some(isIt));
      const target = onBoard >= 0 ? { view: null, index: onBoard } : folder ? { view: folder.id, index: folder.slots.findIndex(isIt) } : null;
      // Introuvable sur le plateau (un jeu désinstallé, vu depuis le journal) : on ne bouge pas.
      if (here < 0 && !target) {
        sound.error();
        return false;
      }
      sound.select();
      leaveUi();
      if (here >= 0) {
        setCursor(here);
        return true;
      }
      setQuery("");
      // Quitter la vue « Tout » recharge le curseur du plateau : on lui donne la bonne case avant.
      if (target!.view == null) save("cursor", target!.index);
      setShowAll(false);
      setView(target!.view);
      setCursor(target!.index);
      return true;
    },
    [board, leaveUi],
  );

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
      // Pendant la séquence de lancement, Ⓐ ou Ⓑ la passent ; le reste attend qu'elle finisse.
      if (splash) {
        if (a === "confirm" || a === "back") setSplash(null);
        return;
      }
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

      // Le bouton qui a ouvert le menu le referme.
      if (menu && (a === "menu" || a === "create")) return setMenu(null);
      // L'appli ouverte a la priorité : la visionneuse de l'album prend ← →, par exemple.
      if (openAppId && !menu && appHandler.current?.(a)) return;

      if (modalOpen || navMode === "ui") {
        setNavVisible(true);
        const active = document.activeElement;
        if (isDir(a)) {
          // Curseur (teinte, volume, position) : ← → le règlent, au clavier comme à la manette.
          // Le clavier ne peut pas compter sur le réglage natif du navigateur : les flèches sont
          // interceptées plus haut pour la navigation, le curseur ne les recevait jamais.
          if (isRange(active) && (a === "left" || a === "right")) {
            nudgeRange(active, a === "right" ? 1 : -1);
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
          if (choice) setChoice(null);
          else if (menu) setMenu(null);
          else if (powerMenu) setPowerMenu(null);
          else if (openAppId) closeApp();
          else if (settingsOpen) setSettingsOpen(false);
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
      // Ⓨ : nouveau dossier sur une case vide, menu d'actions sur un jeu ou un dossier.
      if (a === "create" || a === "menu") {
        if (held != null) return;
        const occupied = itemsRef.current[cursorRef.current] != null;
        return a === "create" && !occupied ? startNewFolder() : openMenu(cursorRef.current);
      }
    },
    [splash, oskInput, modalOpen, navMode, menu, powerMenu, choice, openAppId, closeApp, settingsOpen, editor, themeEditor, themes, held, rows, gridArea, toggleFullscreen, changeZoom, cycleTheme, toggleSound, leaveUi, move, dropHeld, activate, cancelHeld, back, grab, startNewFolder, openMenu],
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
        downloads={downloadList}
        onShowDownload={goToGame}
        onOpenMusic={() => openApp("music")}
        onPower={(rect) => {
          sound.select();
          setPowerMenu(rect);
        }}
        onOpenSettings={() => {
          sound.select();
          setSettingsOpen(true);
        }}
        onOpenProfile={() => openApp("profile")}
      />

      <main className="flex min-h-0 flex-1 flex-col gap-3 p-3 pt-3 md:p-5 md:pt-4 [@media(max-height:640px)]:gap-2 [@media(max-height:640px)]:p-3 [@media(max-height:640px)]:pt-2">
        {/* Écran du haut */}
        <div className="shrink-0" style={{ height: "clamp(150px, 33vh, 380px)" }}>
          <TopScreen
            item={games.length ? shown : null}
            itemKey={itemKey}
            folderName={openFolder?.name ?? null}
            launching={launchingId != null}
            canCreateFolder={view == null && !browsing && games.length > 0}
            download={current?.kind === "game" ? downloads.get(current.game.appid) : undefined}
            ready={current?.kind === "game" && ready.has(current.game.appid)}
            leaving={current?.kind === "game" && leaving.has(current.game.appid)}
            directControl={directControl}
            onDownload={(action) => current?.kind === "game" && void controlDownload(current.game, action)}
            running={current?.kind === "game" && running.has(current.game.appid)}
            stopping={current?.kind === "game" && stopping.has(current.game.appid) ? (stopping.get(current.game.appid)!.force ? "force" : "closing") : null}
            onStop={(force) => current?.kind === "game" && void stopRunning(current.game, force)}
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
        <div className="mx-auto h-1.5 w-24 shrink-0 rounded-full bg-muted/25 [@media(max-height:640px)]:hidden" aria-hidden />

        {/* Écran du bas */}
        <section
          className="panel flex min-h-0 flex-1 flex-col shadow-soft transition-colors"
          style={openFolder ? { backgroundColor: `color-mix(in srgb, ${openFolder.color} 14%, var(--surface))` } : undefined}
        >
          <div className="flex items-center gap-x-3 gap-y-2 px-4 pb-1 pt-3 md:px-5 [@media(max-height:640px)]:pt-2">
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
            <p className={`flex min-w-0 shrink-0 items-center gap-2 whitespace-nowrap text-sm font-extrabold ${held != null ? "hidden" : ""}`}>
              {openFolder && <span className="h-3 w-3 rounded-full" style={{ background: openFolder.color }} />}
              {openFolder && <span>{openFolder.name} ·</span>}
              {tn("games", gameCount)}
              {/* Écran étroit : l'heure du dernier scan cède la place aux boutons. */}
              <span className="hidden font-bold text-muted lg:inline">{status}</span>
            </p>
            <div className="ml-auto flex shrink-0 items-center gap-1 whitespace-nowrap text-sm font-bold text-muted">
              {view == null && !browsing && (
                <button
                  type="button"
                  onMouseEnter={() => sound.hover()}
                  onClick={startNewFolder}
                  disabled={current != null}
                  title={current != null ? t("addFolderDisabled") : t("addFolderTitle")}
                  aria-label={t("addFolderTitle")}
                  className="mr-1 rounded-full px-3 py-1 transition-colors hover:bg-accent-soft hover:text-accent-strong disabled:opacity-40 disabled:hover:bg-transparent md:mr-2"
                >
                  <span className="md:hidden">+</span>
                  <span className="hidden md:inline">{t("addFolder")}</span>
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
                  <span className="mr-1 hidden md:inline">{t("sort")}</span>
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
            <ZoomControls
              level={MAX_ROWS - rows}
              levels={MAX_ROWS - MIN_ROWS + 1}
              minLevel={MAX_ROWS - maxRows}
              onZoom={changeZoom}
            />
          </div>

          <div
            // La molette fait défiler le quadrillage vers la droite, comme Maj + molette (useHorizontalWheel).
            ref={gridAreaRef}
            data-nav-skip
            className="soft-scroll min-h-0 flex-1 overflow-x-auto overflow-y-hidden px-4 py-4 md:px-6 [@media(max-height:640px)]:py-2"
          >
            {/* Les applis sont toujours là : sans jeu Steam, la grille ne s'affiche qu'une fois le
                scan fini sans erreur, sinon l'écran d'attente ou d'erreur reste visible. */}
            {items.length > 0 && (installedGames.length > 0 || (loaded && !error) || browsing) ? (
              <BoardGrid
                items={items}
                rows={rows}
                tileSize={tileSize}
                gap={GAP}
                labelHeight={labelHeight}
                cursor={cursorIndex}
                editable={!browsing}
                downloads={downloads}
                ready={ready}
                leaving={leaving}
                running={running}
                onMenu={onGridMenu}
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
            padMouse={padMouse}
            onTogglePadMouse={() => setPadMouse((on) => !on)}
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

      <AnimatePresence>{splash && <LaunchSplash key={splash.game.appid} game={splash.game} from={splash.from} onEnd={endSplash} />}</AnimatePresence>

      <AnimatePresence>
        {openAppId && (
          <AppWindow key={openAppId} id={openAppId} title={appName(openAppId, t)} onClose={closeApp} onRegister={registerApp}>
            {openAppId === "activity" && (
              <ActivityLog
                games={steamById}
                onShowGame={(appid) => {
                  // On ne referme le journal que si le jeu est bien sur le plateau.
                  if (goToGame(appid)) setOpenAppId(null);
                }}
              />
            )}
            {openAppId === "music" && <MusicPlayer />}
            {openAppId === "album" && <PhotoAlbum games={steamById} />}
            {openAppId === "profile" && <ProfilePage games={steamById} installed={installedGames} notify={showToast} />}
            {openAppId === "plaza" && <SvgiiPlaza games={steamById} installed={installedGames} notify={showToast} />}
          </AppWindow>
        )}
      </AnimatePresence>

      {powerMenu && (
        <ActionMenu
          // Sous le bouton, aligné sur son bord droit (il est tout à droite de l'écran).
          x={powerMenu.right}
          y={powerMenu.bottom + 8}
          flipX={powerMenu.right}
          title="3DSteam"
          entries={[
            { id: "minimize", label: t("powerMinimize"), icon: <MinimizeIcon width={18} height={18} />, onSelect: () => tryOpen(minimizeApp) },
            {
              id: "quit",
              label: t("powerQuit"),
              icon: <PowerIcon width={18} height={18} />,
              danger: true,
              // Le temps d'un petit son d'au revoir, puis on quitte. Steam, lui, reste ouvert.
              onSelect: () => {
                sound.zoom(-1);
                window.setTimeout(() => tryOpen(quitApp), 220);
              },
            },
          ]}
          onClose={() => setPowerMenu(null)}
        />
      )}

      {menu && items[menu.index] !== undefined && (
        <ActionMenu
          x={menu.x}
          y={menu.y}
          flipX={menu.flipX}
          title={menuTitle(items[menu.index], t("freeSlot"))}
          thumb={menuThumb(items[menu.index])}
          entries={menuEntries(menu.index)}
          onClose={() => setMenu(null)}
        />
      )}

      {choice && (
        <ActionMenu
          x={choice.x}
          y={choice.y}
          flipX={choice.flipX}
          title={choice.title}
          thumb={<GameIcon game={choice.game} size={32} />}
          entries={choice.entries}
          onClose={() => setChoice(null)}
        />
      )}

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

/** Identité d'une case, indépendante de sa position. */
function slotKey(item: ViewItem): string | null {
  return item?.kind === "game" ? `g${item.game.appid}` : item?.kind === "folder" ? `f${item.folder.id}` : null;
}

/** Titre du menu d'actions : le jeu, le dossier, ou « case libre ». */
function menuTitle(item: ViewItem, empty: string): string {
  return item?.kind === "game" ? item.game.name : item?.kind === "folder" ? item.folder.name : empty;
}

/** Vignette du menu d'actions. */
function menuThumb(item: ViewItem) {
  if (item?.kind === "game") return <GameIcon game={item.game} size={32} />;
  if (item?.kind === "folder") return <FolderArt folder={item.folder} games={item.games} size={32} />;
  return undefined;
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
