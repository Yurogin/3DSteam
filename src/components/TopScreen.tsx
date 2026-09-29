import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { GameArt } from "./GameArt";
import { FolderArt } from "./FolderTile";
import { PlayIcon } from "./Icons";
import { artSources, gameHue } from "../lib/art";
import { formatLastPlayed, formatSize } from "../lib/format";
import { sound } from "../lib/sound";
import { useI18n, type TFunction } from "../lib/i18n";
import type { ViewItem } from "./BoardGrid";
import type { Game } from "../types";

interface Props {
  item: ViewItem;
  /** Identifiant stable de la case, pour animer les changements de sélection. */
  itemKey: string;
  /** Nom du dossier ouvert, si on est dans un dossier. */
  folderName: string | null;
  launching: boolean;
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
          {item?.kind === "game" && <GameScreen {...props} game={item.game} />}
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

function GameScreen({ game, folderName, launching, onLaunch, onMoveOut }: Props & { game: Game }) {
  const { t, locale } = useI18n();
  const hue = gameHue(game.appid);
  return (
    <Stage
      backdrop={
        <>
          <GameArt
            sources={artSources(game, "hero", "header")}
            alt=""
            className="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl saturate-150"
          />
          <div className="absolute inset-0 bg-linear-to-r from-surface/85 via-surface/55 to-surface/85" />
        </>
      }
      left={
        <>
          <h1 className="line-clamp-2 text-3xl font-black leading-tight text-ink">{game.name}</h1>
          <div className="flex flex-wrap gap-2">
            <Chip>{formatLastPlayed(game.lastPlayed, t, locale)}</Chip>
            {game.sizeOnDisk > 0 && <Chip>{formatSize(game.sizeOnDisk, t, locale)}</Chip>}
            <Chip title={game.libraryPath}>{driveOf(game.libraryPath, t)}</Chip>
            {folderName && <Chip>{t("folderChip", { name: folderName })}</Chip>}
          </div>
        </>
      }
      // La bannière Steam (en-tête 460×215), à sa taille naturelle environ : jamais recadrée.
      centerClassName="relative aspect-[460/215] h-[92%] max-h-[320px]"
      center={
        <div className="absolute inset-0 overflow-hidden rounded-[18px] bg-surface-2 shadow-pop ring-4 ring-surface">
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
        </div>
      }
      right={
        <>
          <PrimaryButton onClick={onLaunch} disabled={launching} pulse={launching}>
            <PlayIcon width={22} height={22} />
            {launching ? t("launching") : t("launch")}
          </PrimaryButton>
          <span className="pr-2 text-xs font-bold text-muted">{t("launchHint")}</span>
          {folderName && <SecondaryButton onClick={onMoveOut}>{t("moveOut")}</SecondaryButton>}
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

function SecondaryButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      onMouseEnter={() => sound.hover()}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.94 }}
      className="rounded-full bg-surface px-4 py-2 text-sm font-extrabold text-muted shadow-soft hover:text-accent-strong"
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
