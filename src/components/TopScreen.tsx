import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { GameArt } from "./GameArt";
import { DownloadCard, DownloadStats, PhaseIcon, phaseLabel } from "./DownloadProgress";
import { Confetti } from "./Celebration";
import { Cracks } from "./Shatter";
import { FolderArt } from "./FolderTile";
import { DownloadIcon, PauseIcon, PlayIcon, StopIcon } from "./Icons";
import type { DownloadAction } from "../lib/api";
import { AppIcon, appDescription, builtinApp } from "../apps/builtin";
import { Equalizer } from "../apps/MusicPlayer";
import { currentTrack, usePlayer } from "../apps/player";
import { artSources, gameHue } from "../lib/art";
import { formatLastPlayed, formatPlaytime, formatSize } from "../lib/format";
import { sound } from "../lib/sound";
import { useI18n, type TFunction } from "../lib/i18n";
import type { ViewItem } from "./BoardGrid";
import type { BuiltinId, Download, Game } from "../types";

interface Props {
  item: ViewItem;
  /** Identifiant stable de la case, pour animer les changements de sélection. */
  itemKey: string;
  /** Nom du dossier ouvert, si on est dans un dossier. */
  folderName: string | null;
  launching: boolean;
  /** Téléchargement en cours du jeu sélectionné, s'il y en a un. */
  download?: Download;
  /** Le jeu sélectionné vient de s'installer : c'est la fête. */
  ready: boolean;
  /** Le jeu sélectionné vient d'être désinstallé : sa bannière s'effondre. */
  leaving: boolean;
  /** Pause, reprise et annulation passent directement (port de débogage de Steam ouvert). */
  directControl: boolean;
  onDownload: (action: DownloadAction) => void;
  /** Le jeu sélectionné tourne : on l'arrête au lieu de le lancer. */
  running: boolean;
  /** Arrêt demandé : en cours de fermeture, ou il ne répond pas et l'arrêt forcé est proposé. */
  stopping: "closing" | "force" | null;
  onStop: (force: boolean) => void;
  canCreateFolder: boolean;
  onLaunch: () => void;
  onOpenFolder: () => void;
  onEditFolder: () => void;
  onDeleteFolder: () => void;
  onCreateFolder: () => void;
  onMoveOut: () => void;
}

const enter = { type: "spring", stiffness: 380, damping: 28 } as const;

/** « Écran du haut » : infos à gauche, visuel carré au centre, actions à droite. */
export function TopScreen(props: Props) {
  const { item, itemKey, launching } = props;
  return (
    <section className="panel-solid relative h-full overflow-hidden shadow-soft">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={itemKey}
          className="absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {item?.kind === "game" &&
            (item.game.builtin ? <AppScreen {...props} game={item.game} id={item.game.builtin} /> : <GameScreen {...props} game={item.game} />)}
          {item?.kind === "folder" && <FolderScreen {...props} folderItem={item} />}
          {item == null && <EmptyScreen {...props} />}

          <AnimatePresence>
            {launching && (
              <motion.div
                className="pointer-events-none absolute inset-0 bg-white"
                initial={{ opacity: 0.85 }}
                animate={{ opacity: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.7, ease: "easeOut" }}
              />
            )}
          </AnimatePresence>
        </motion.div>
      </AnimatePresence>
    </section>
  );
}

/** Disposition commune en trois zones. */
function Stage({
  backdrop,
  left,
  center,
  right,
  centerClassName = "relative aspect-square h-full",
}: {
  backdrop?: ReactNode;
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
  centerClassName?: string;
}) {
  return (
    <>
      {backdrop}
      <div className="relative grid h-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-6 p-5 sm:p-6">
        <motion.div
          className="flex min-w-0 flex-col gap-3"
          initial={{ x: -16, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ ...enter, delay: 0.04 }}
        >
          {left}
        </motion.div>
        <motion.div
          className={centerClassName}
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={enter}
        >
          {center}
        </motion.div>
        <motion.div
          className="flex flex-col items-end gap-2"
          initial={{ x: 16, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ ...enter, delay: 0.08 }}
        >
          {right}
        </motion.div>
      </div>
    </>
  );
}

/** Une appli intégrée : sa grande icône, ce qu'elle fait, et de quoi l'ouvrir. */
function AppScreen({ game, id, folderName, onLaunch, onMoveOut }: Props & { game: Game; id: BuiltinId }) {
  const { t } = useI18n();
  const [from, to] = builtinApp(id).colors;
  const music = usePlayer();
  const track = id === "music" ? currentTrack(music) : null;
  return (
    <Stage
      backdrop={
        <div
          className="absolute inset-0 opacity-30"
          style={{ background: `radial-gradient(circle at 50% 60%, ${from}, transparent 65%), radial-gradient(circle at 80% 20%, ${to}, transparent 55%)` }}
        />
      }
      left={
        <>
          <p className="text-sm font-extrabold uppercase tracking-wide text-muted">{t("appKind")}</p>
          <h1 className="line-clamp-2 text-3xl font-black leading-tight text-ink">{game.name}</h1>
          <p className="max-w-sm text-sm font-bold text-muted">{appDescription(id, t)}</p>
          {track && (
            <span className="flex w-fit max-w-full items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-sm font-bold text-ink shadow-soft">
              <Equalizer active={music.playing} small />
              <span className="truncate">{track.title}</span>
            </span>
          )}
        </>
      }
      center={
        <motion.div
          className="absolute inset-0 overflow-hidden rounded-[28px] shadow-pop ring-4 ring-surface"
          // L'icône flotte doucement, comme sur un menu de console.
          animate={{ y: [0, -6, 0] }}
          transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
        >
          <AppIcon id={id} />
          <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-linear-to-b from-white/25 to-transparent" />
        </motion.div>
      }
      centerClassName="relative aspect-square h-[82%] max-h-[260px]"
      right={
        <>
          <PrimaryButton onClick={onLaunch}>
            <PlayIcon width={22} height={22} />
            {t("open")}
          </PrimaryButton>
          <span className="pr-2 text-xs font-bold text-muted">{t("launchHint")}</span>
          {folderName && <SecondaryButton onClick={onMoveOut}>{t("moveOut")}</SecondaryButton>}
        </>
      }
    />
  );
}

function GameScreen(props: Props & { game: Game }) {
  const { game, folderName, launching, download, ready, leaving, running, stopping, onLaunch, onStop, onMoveOut } = props;
  const { t, locale } = useI18n();
  const hue = gameHue(game.appid);
  const backdrop = (
    <>
      <GameArt
        sources={artSources(game, "hero", "header")}
        alt=""
        className="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl saturate-150"
      />
      <div className="absolute inset-0 bg-linear-to-r from-surface/85 via-surface/55 to-surface/85" />
    </>
  );
  // Un jeu qui télécharge a son propre écran : la bannière se remplit, les commandes sont à droite.
  if (download && !leaving) return <DownloadScreen {...props} game={game} download={download} backdrop={backdrop} />;

  return (
    <Stage
      backdrop={backdrop}
      left={
        <motion.div
          className="flex min-w-0 flex-col gap-3"
          animate={leaving ? { opacity: 0.35, filter: "grayscale(1)" } : { opacity: 1, filter: "grayscale(0)" }}
          transition={{ duration: 0.5 }}
        >
          <h1 className="line-clamp-2 text-3xl font-black leading-tight text-ink">{game.name}</h1>
          <div className="flex flex-wrap gap-2">
            {leaving ? (
              <Chip>{t("uninstalled")}</Chip>
            ) : (
              <>
                {running ? (
                  <span className="flex items-center gap-1.5 rounded-full bg-[#22c55e] px-3 py-1.5 text-sm font-black text-white shadow-soft">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
                    {t("runningChip")}
                  </span>
                ) : (
                  <Chip>{formatLastPlayed(game.lastPlayed, t, locale)}</Chip>
                )}
                {game.playtime > 0 && <Chip>{formatPlaytime(game.playtime, t, locale)}</Chip>}
                {game.sizeOnDisk > 0 && <Chip>{formatSize(game.sizeOnDisk, t, locale)}</Chip>}
                {game.shortcut ? (
                  <Chip title={game.installDir}>{t("nonSteam")}</Chip>
                ) : game.installed ? (
                  <Chip title={game.libraryPath}>{driveOf(game.libraryPath, t)}</Chip>
                ) : (
                  <Chip>{t("notInstalled")}</Chip>
                )}
                {folderName && <Chip>{t("folderChip", { name: folderName })}</Chip>}
              </>
            )}
          </div>
        </motion.div>
      }
      // La bannière Steam (en-tête 460×215), à sa taille naturelle environ : jamais recadrée.
      centerClassName="relative aspect-[460/215] h-[92%] max-h-[320px]"
      center={
        <>
          <motion.div
            className="absolute inset-0 overflow-hidden rounded-[18px] bg-surface-2 shadow-pop ring-4 ring-surface"
            initial={false}
            // Prêt : la bannière bondit. Désinstallé : elle tremble, se ternit, puis s'effondre.
            animate={
              leaving
                ? { x: [0, -6, 6, -5, 5, 0, 0], y: [0, 0, 0, 0, 0, -10, 420], rotate: [0, -1, 1, -1, 1, -2, 14], opacity: [1, 1, 1, 1, 1, 1, 0], filter: "grayscale(1)" }
                : ready
                  ? { scale: [1, 0.94, 1.08, 1], x: 0, y: 0, rotate: 0, opacity: 1, filter: "grayscale(0)" }
                  : { scale: 1, x: 0, y: 0, rotate: 0, opacity: 1, filter: "grayscale(0)" }
            }
            transition={leaving ? { duration: 1.5, times: [0, 0.07, 0.14, 0.21, 0.28, 0.4, 1], ease: "easeIn" } : { duration: 0.7 }}
          >
            <GameArt
              sources={artSources(game, "header")}
              alt={game.name}
              className="absolute inset-0 h-full w-full object-cover"
              fallback={
                <div
                  className="absolute inset-0 grid place-items-center px-4 text-center text-2xl font-black text-white"
                  style={{ background: `linear-gradient(145deg, hsl(${hue} 75% 66%), hsl(${(hue + 40) % 360} 70% 52%))` }}
                >
                  {game.name}
                </div>
              }
            />
            <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-linear-to-b from-white/20 to-transparent" />
            {leaving && <Cracks />}
          </motion.div>
          {/* Prêt à jouer : une gerbe de confettis et une étiquette qui saute sur la bannière. */}
          {ready && (
            <>
              <Confetti seed={game.appid} size={340} count={40} delay={0.1} />
              <motion.span
                className="absolute -top-4 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-accent px-4 py-1.5 text-sm font-black text-on-accent shadow-pop"
                initial={{ scale: 0, y: 10, rotate: -8 }}
                animate={{ scale: 1, y: 0, rotate: -3 }}
                transition={{ type: "spring", stiffness: 500, damping: 14, delay: 0.25 }}
              >
                {t("readyBadge")}
              </motion.span>
            </>
          )}
        </>
      }
      right={
        !leaving && (
          <>
            {game.installed && running ? (
              <PrimaryButton onClick={() => onStop(false)} pulse={stopping === "closing"}>
                <StopIcon width={20} height={20} />
                {stopping === "closing" ? t("stopping") : t("stopGame")}
              </PrimaryButton>
            ) : game.installed ? (
              <PrimaryButton onClick={onLaunch} disabled={launching} pulse={launching || ready}>
                <PlayIcon width={22} height={22} />
                {launching ? t("launching") : t("launch")}
              </PrimaryButton>
            ) : (
              <PrimaryButton onClick={onLaunch}>
                <DownloadIcon width={22} height={22} />
                {t("install")}
              </PrimaryButton>
            )}
            {running && stopping === "force" && (
              <SecondaryButton danger onClick={() => onStop(true)}>
                {t("forceStop")}
              </SecondaryButton>
            )}
            <span className="max-w-56 pr-2 text-right text-xs font-bold text-muted">
              {running ? (stopping === "force" ? t("forceHint") : t("runningHint")) : game.installed ? t("launchHint") : t("notInstalledHint")}
            </span>
            {folderName && <SecondaryButton onClick={onMoveOut}>{t("moveOut")}</SecondaryButton>}
          </>
        )
      }
    />
  );
}

/** Pendant un téléchargement : où il en est à gauche, la bannière qui se remplit, les commandes. */
function DownloadScreen({ game, download, backdrop, directControl, onDownload }: Props & { game: Game; download: Download; backdrop: ReactNode }) {
  const { t } = useI18n();
  const { phase } = download;
  const running = phase === "downloading" || phase === "preparing";
  const finishing = phase === "verifying" || phase === "installing";
  return (
    <Stage
      backdrop={backdrop}
      left={
        <>
          <h1 className="line-clamp-2 text-2xl font-black leading-tight text-ink">{game.name}</h1>
          <DownloadStats download={download} installed={game.installed} />
        </>
      }
      centerClassName="relative aspect-[460/215] h-[92%] max-h-[320px]"
      center={<DownloadCard game={game} download={download} />}
      right={
        <>
          {finishing ? (
            <PrimaryButton onClick={() => {}} disabled pulse>
              <PhaseIcon phase={phase} size={22} />
              {phaseLabel(phase, game.installed, t)}
            </PrimaryButton>
          ) : running ? (
            <PrimaryButton onClick={() => onDownload("pause")}>
              <PauseIcon width={22} height={22} />
              {t("pause")}
            </PrimaryButton>
          ) : (
            <PrimaryButton onClick={() => onDownload("resume")}>
              <PlayIcon width={22} height={22} />
              {t("resume")}
            </PrimaryButton>
          )}
          {!finishing && (
            <SecondaryButton onClick={() => onDownload("cancel")} danger>
              {game.installed ? t("cancelUpdate") : t("cancelDownload")}
            </SecondaryButton>
          )}
          <span className="max-w-52 pr-2 text-right text-xs font-bold text-muted">
            {directControl ? t("downloadHintDirect") : t("downloadHintSteam")}
          </span>
        </>
      }
    />
  );
}

function FolderScreen({ folderItem, onOpenFolder, onEditFolder, onDeleteFolder }: Props & { folderItem: Extract<ViewItem, { kind: "folder" }> }) {
  const { t, tn } = useI18n();
  const { folder, games } = folderItem;
  const count = games.length;
  return (
    <Stage
      backdrop={
        <div
          className="absolute inset-0 opacity-30"
          style={{ background: `radial-gradient(circle at 50% 60%, ${folder.color}, transparent 70%)` }}
        />
      }
      left={
        <>
          <p className="text-sm font-extrabold uppercase tracking-wide text-muted">{t("folder")}</p>
          <h1 className="line-clamp-2 text-3xl font-black leading-tight text-ink">{folder.name}</h1>
          <div className="flex flex-wrap gap-2">
            <Chip>{count === 0 ? t("emptyFolder") : tn("games", count)}</Chip>
          </div>
        </>
      }
      center={<FolderArt folder={folder} games={games} size={240} />}
      right={
        <>
          <PrimaryButton onClick={onOpenFolder}>{t("open")}</PrimaryButton>
          <span className="pr-2 text-xs font-bold text-muted">{t("folderDropHint")}</span>
          <div className="flex gap-2">
            <SecondaryButton onClick={onEditFolder}>{t("edit")}</SecondaryButton>
            <SecondaryButton onClick={onDeleteFolder}>{t("delete")}</SecondaryButton>
          </div>
        </>
      }
    />
  );
}

function EmptyScreen({ folderName, canCreateFolder, onCreateFolder }: Props) {
  const { t } = useI18n();
  return (
    <Stage
      left={
        <>
          <p className="text-sm font-extrabold uppercase tracking-wide text-muted">
            {folderName ? t("folderChip", { name: folderName }) : t("freeSlot")}
          </p>
          <h1 className="text-2xl font-black leading-tight text-ink">{t("emptySlot")}</h1>
          <p className="max-w-xs text-sm font-bold text-muted">{t("emptySlotHint")}</p>
        </>
      }
      center={<div className="absolute inset-0 rounded-[22px] border-4 border-dashed border-muted/25 bg-surface-2/50" />}
      right={canCreateFolder && <PrimaryButton onClick={onCreateFolder}>{t("newFolderButton")}</PrimaryButton>}
    />
  );
}

function PrimaryButton({ children, onClick, disabled, pulse }: { children: ReactNode; onClick: () => void; disabled?: boolean; pulse?: boolean }) {
  return (
    <motion.button
      type="button"
      // En remontant de la grille, c'est ce bouton-là qu'on vise (Démarrer, Installer, Pause…).
      data-nav-primary
      onClick={onClick}
      onMouseEnter={() => sound.hover()}
      disabled={disabled}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.94 }}
      animate={pulse ? { scale: [1, 1.12, 1] } : { scale: 1 }}
      transition={{ type: "spring", stiffness: 500, damping: 18 }}
      className="flex items-center gap-2.5 rounded-full bg-accent px-6 py-3 text-lg font-extrabold text-on-accent shadow-pop disabled:cursor-wait"
    >
      {children}
    </motion.button>
  );
}

function SecondaryButton({ children, onClick, danger }: { children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      onMouseEnter={() => sound.hover()}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.94 }}
      className={`rounded-full bg-surface px-4 py-2 text-sm font-extrabold shadow-soft ${
        danger ? "text-[#e5484d] hover:bg-[#e5484d]/10" : "text-muted hover:text-accent-strong"
      }`}
    >
      {children}
    </motion.button>
  );
}

function Chip({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span title={title} className="rounded-full bg-surface px-3 py-1.5 text-sm font-bold text-muted shadow-soft">
      {children}
    </span>
  );
}

/** « Disque C: » à partir du chemin de la bibliothèque Steam. */
function driveOf(path: string, t: TFunction): string {
  const drive = /^([a-z]):/i.exec(path)?.[1];
  return drive ? t("drive", { d: drive.toUpperCase() }) : t("steamLibrary");
}
