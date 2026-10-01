import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { animate, motion, useMotionValue } from "framer-motion";
import { GameTile } from "./GameTile";
import { FolderArt, FolderTile } from "./FolderTile";
import { GameIcon } from "./GameIcon";
import { sound } from "../lib/sound";
import type { Folder } from "../lib/board";
import type { Download, Game } from "../types";

/** Contenu résolu d'une case. */
export type ViewItem = { kind: "game"; game: Game } | { kind: "folder"; folder: Folder; games: Game[] } | null;

interface Props {
  /** Une entrée par case, remplies colonne par colonne. */
  items: ViewItem[];
  rows: number;
  tileSize: number;
  gap: number;
  labelHeight: number;
  /** Case sous le curseur (elle peut être vide). */
  cursor: number;
  /** Glisser-déposer autorisé (désactivé pendant une recherche). */
  editable: boolean;
  onCursor: (index: number) => void;
  /** Double-clic : lance le jeu ou ouvre le dossier. */
  onActivate: (index: number) => void;
  onMove: (from: number, to: number) => void;
  /** Dépôt sur l'élément `[data-drop="back"]` (bouton « Retour » d'un dossier). */
  onMoveOut: (from: number) => void;
  onBackHover: (hovering: boolean) => void;
  /** Case d'origine de l'icône « prise » au clavier / à la manette (elle suit le curseur). */
  held: number | null;
  /** Faux quand la navigation est dans les boutons : le halo du curseur s'efface. */
  showCursor: boolean;
  /** Téléchargements en cours, par appid. */
  downloads: Map<number, Download>;
  /** Jeux qui viennent de s'installer. */
  ready: Set<number>;
  /** Jeux qui viennent d'être désinstallés, le temps que leur tuile vole en éclats. */
  leaving: Set<number>;
  /** Jeux qui tournent en ce moment. */
  running: Set<number>;
  /** Clic droit sur une case (jeu, dossier ou case vide) : menu d'actions au pointeur. */
  onMenu: (index: number, x: number, y: number) => void;
}

interface Drag {
  from: number;
  item: NonNullable<ViewItem>;
  /** Position du pointeur dans l'icône au moment où on l'a attrapée. */
  offsetX: number;
  offsetY: number;
}

type Target = { kind: "slot"; index: number } | { kind: "back" } | null;

/** Distance (px) avant qu'un appui devienne un glisser (en dessous, c'est un clic). */
const DRAG_THRESHOLD = 6;
/** Zone (px) près des bords gauche / droit qui fait défiler pendant un glisser. */
const EDGE = 80;
const EDGE_SPEED = 16;
const settle = { type: "spring", stiffness: 700, damping: 42 } as const;

const itemKey = (item: NonNullable<ViewItem>) => (item.kind === "game" ? `g${item.game.appid}` : `f${item.folder.id}`);
/** Identifiant d'animation partagé entre une icône et sa version « tenue ». */
const layoutIdOf = (item: NonNullable<ViewItem>) => (item.kind === "game" ? `tile-${item.game.appid}` : `folder-${item.folder.id}`);

/** Visuel d'une icône soulevée (souris ou clavier). */
function LiftedVisual({ item, size }: { item: NonNullable<ViewItem>; size: number }) {
  return item.kind === "game" ? (
    <div className="relative h-full w-full overflow-hidden rounded-tile bg-surface shadow-pop ring-4 ring-accent">
      <GameIcon game={item.game} size={size} />
      <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-linear-to-b from-white/25 to-transparent" />
    </div>
  ) : (
    <div className="relative h-full w-full drop-shadow-[0_14px_20px_rgba(0,0,0,0.25)]">
      <FolderArt folder={item.folder} games={item.games} size={size} />
    </div>
  );
}

/**
 * « Écran du bas » : quadrillage qui s'étend vers la droite.
 *
 * Glisser-déposer fait main (événements pointeur) plutôt que le glisser natif du navigateur,
 * dont l'image fantôme était une capture approximative de la case : ici, l'icône elle-même suit
 * la souris à l'endroit exact où on l'a prise, puis se pose en douceur dans sa case d'arrivée.
 */
export function BoardGrid(props: Props) {
  const { items, rows, tileSize, gap, labelHeight, cursor, editable, onCursor, onActivate, held, showCursor, downloads, ready, leaving, running, onMenu } = props;
  const [drag, setDrag] = useState<Drag | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  /** Icône qui vient d'être posée : on coupe son animation de trajet (elle est déjà sur place). */
  const [justDropped, setJustDropped] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const ghostX = useMotionValue(0);
  const ghostY = useMotionValue(0);
  const ghostScale = useMotionValue(1);
  const ghostOpacity = useMotionValue(1);

  // Les écouteurs globaux sont posés une fois : ils lisent l'état courant via ces refs.
  const latest = useRef(props);
  latest.current = props;
  const dragRef = useRef<Drag | null>(null);
  const press = useRef<{ index: number; x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const target = useRef<Target>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const suppressClick = useRef(false);
  const finishing = useRef(false);

  // Garde le curseur visible quand on navigue au clavier / à la manette.
  useEffect(() => {
    gridRef.current
      ?.querySelector(`[data-slot="${cursor}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [cursor, tileSize, rows]);

  useEffect(() => {
    if (!justDropped) return;
    const frame = requestAnimationFrame(() => setJustDropped(null));
    return () => cancelAnimationFrame(frame);
  }, [justDropped]);

  useEffect(() => {
    const squareOf = (index: number) =>
      gridRef.current?.querySelector<HTMLElement>(`[data-slot="${index}"] [data-square]`)?.getBoundingClientRect() ?? null;

    const setTarget = (next: Target) => {
      const prev = target.current;
      const same = prev?.kind === next?.kind && (prev?.kind !== "slot" || (next?.kind === "slot" && prev.index === next.index));
      if (same) return;
      target.current = next;
      const slot = next?.kind === "slot" ? next.index : null;
      setDropTarget(slot);
      latest.current.onBackHover(next?.kind === "back");
      if (next) sound.hover();
    };

    const hitTest = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y);
      if (el?.closest('[data-drop="back"]')) return setTarget({ kind: "back" });
      const slot = el?.closest<HTMLElement>("[data-slot]");
      setTarget(slot && gridRef.current?.contains(slot) ? { kind: "slot", index: Number(slot.dataset.slot) } : null);
    };

    const end = () => {
      dragRef.current = null;
      target.current = null;
      finishing.current = false;
      setDrag(null);
      setDropTarget(null);
      latest.current.onBackHover(false);
      document.body.style.cursor = "";
    };

    /** Ramène l'icône dans sa case d'origine (dépôt hors grille, Échap). */
    const cancel = async (d: Drag) => {
      finishing.current = true;
      const rect = squareOf(d.from);
      if (rect) {
        await Promise.all([animate(ghostX, rect.left, settle), animate(ghostY, rect.top, settle), animate(ghostScale, 1, settle)]);
      }
      end();
    };

    const drop = async (d: Drag) => {
      const t = target.current;
      if (t?.kind === "back") {
        latest.current.onMoveOut(d.from);
        return end();
      }
      if (t?.kind !== "slot" || t.index === d.from) return cancel(d);
      finishing.current = true;
      const rect = squareOf(t.index);
      const into = latest.current.items[t.index]?.kind === "folder" && d.item.kind === "game";
      if (rect) {
        // Vers un dossier, l'icône « rentre » dedans ; sinon elle se pose dans la case.
        await Promise.all(
          into
            ? [
                animate(ghostX, rect.left, settle),
                animate(ghostY, rect.top, settle),
                animate(ghostScale, 0.3, settle),
                animate(ghostOpacity, 0, { duration: 0.18 }),
              ]
            : [animate(ghostX, rect.left, settle), animate(ghostY, rect.top, settle), animate(ghostScale, 1, settle)],
        );
      }
      setJustDropped(itemKey(d.item));
      latest.current.onMove(d.from, t.index);
      sound.select();
      end();
    };

    const onMove = (e: PointerEvent) => {
      const p = press.current;
      if (!p || finishing.current) return;
      pointer.current = { x: e.clientX, y: e.clientY };
      if (!dragRef.current) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_THRESHOLD) return;
        const item = latest.current.items[p.index];
        if (!item) return;
        const d: Drag = { from: p.index, item, offsetX: p.offsetX, offsetY: p.offsetY };
        dragRef.current = d;
        ghostScale.set(1);
        ghostOpacity.set(1);
        setDrag(d);
        latest.current.onCursor(p.index);
        document.body.style.cursor = "grabbing";
        sound.move();
      }
      ghostX.set(e.clientX - dragRef.current.offsetX);
      ghostY.set(e.clientY - dragRef.current.offsetY);
      hitTest(e.clientX, e.clientY);
    };

    const onUp = () => {
      press.current = null;
      const d = dragRef.current;
      if (!d || finishing.current) return;
      // Le « click » qui suit le relâchement ne doit pas sélectionner / ouvrir quoi que ce soit.
      suppressClick.current = true;
      window.setTimeout(() => (suppressClick.current = false), 0);
      void drop(d);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !dragRef.current || finishing.current) return;
      e.stopPropagation(); // sinon Échap fermerait aussi le dossier ouvert
      press.current = null;
      void cancel(dragRef.current);
    };

    // Près des bords, la grille défile pour pouvoir poser l'icône loin.
    let frame = 0;
    const autoScroll = () => {
      frame = requestAnimationFrame(autoScroll);
      const scroller = gridRef.current?.parentElement;
      if (!dragRef.current || finishing.current || !scroller) return;
      const rect = scroller.getBoundingClientRect();
      const { x, y } = pointer.current;
      const left = x - rect.left;
      const right = rect.right - x;
      const speed = left < EDGE ? -EDGE_SPEED * (1 - left / EDGE) : right < EDGE ? EDGE_SPEED * (1 - right / EDGE) : 0;
      if (speed) {
        scroller.scrollLeft += speed;
        hitTest(x, y);
      }
    };
    frame = requestAnimationFrame(autoScroll);

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKey, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [ghostX, ghostY, ghostScale, ghostOpacity]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>, index: number) => {
    if (!editable || e.button !== 0 || !items[index] || dragRef.current || held != null) return;
    const square = e.currentTarget.querySelector<HTMLElement>("[data-square]")?.getBoundingClientRect();
    if (!square) return;
    press.current = { index, x: e.clientX, y: e.clientY, offsetX: e.clientX - square.left, offsetY: e.clientY - square.top };
  };

  // Icône tenue au clavier / à la manette : elle flotte au-dessus de la case du curseur.
  const heldItem = held != null ? (items[held] ?? null) : null;
  const heldKey = heldItem ? itemKey(heldItem) : null;
  const moving = drag != null || heldItem != null;
  const targetIndex = drag ? dropTarget : heldItem ? cursor : null;
  const draggedIsGame = (drag?.item ?? heldItem)?.kind === "game";

  return (
    <>
      <div
        ref={gridRef}
        className="grid h-full w-max content-center"
        style={{
          gridAutoFlow: "column",
          gridTemplateRows: `repeat(${rows}, ${tileSize + labelHeight}px)`,
          gridAutoColumns: tileSize,
          gap,
        }}
        onClickCapture={(e) => {
          if (suppressClick.current) {
            e.stopPropagation();
            e.preventDefault();
          }
        }}
      >
        {items.map((item, index) => {
          const lifted = drag?.from === index || (heldItem != null && held === index);
          const isTarget = targetIndex === index && !lifted;
          const underCursor = cursor === index && !moving && showCursor;
          const label = item?.kind === "game" ? item.game.name : item?.kind === "folder" ? item.folder.name : "";
          const key = item ? itemKey(item) : null;
          return (
            <div
              key={index}
              data-slot={index}
              onPointerDown={(e) => onPointerDown(e, index)}
              onContextMenu={(e) => {
                e.preventDefault();
                if (!moving) onMenu(index, e.clientX, e.clientY);
              }}
            >
              <div data-square className="relative aspect-square">
                {/* Emplacement : discret au repos, visible pendant un déplacement ou sous le curseur. */}
                <div
                  onClick={() => item == null && onCursor(index)}
                  onMouseEnter={() => item == null && !moving && sound.hover()}
                  className={`absolute inset-0 rounded-tile border-2 border-dashed transition-colors duration-150 ${
                    isTarget && item?.kind !== "folder"
                      ? "border-accent bg-accent-soft"
                      : lifted
                        ? "border-accent/50 bg-accent-soft/40"
                        : cursor === index && !item && showCursor
                          ? "tile-selected border-transparent bg-accent-soft/60"
                          : moving
                            ? "border-muted/35 bg-surface-2/60"
                            : item
                              ? "border-transparent"
                              : "border-muted/15 bg-surface-2/35 hover:border-muted/35"
                  }`}
                />
                {item?.kind === "game" && (
                  // Clé = jeu : au tri, l'icône est recréée dans sa nouvelle case au lieu de changer
                  // d'identité sur place (Framer Motion pouvait alors la laisser invisible).
                  <GameTile
                    key={key}
                    game={item.game}
                    index={index}
                    size={tileSize}
                    selected={underCursor}
                    lifted={lifted}
                    animateLayout={justDropped !== key && heldKey !== key}
                    download={downloads.get(item.game.appid)}
                    ready={ready.has(item.game.appid)}
                    leaving={leaving.has(item.game.appid)}
                    running={running.has(item.game.appid)}
                    onSelect={onCursor}
                    onLaunch={onActivate}
                  />
                )}
                {/* Case occupée visée : contour pour annoncer l'échange. */}
                {isTarget && item?.kind === "game" && (
                  <div className="pointer-events-none absolute -inset-1 z-20 rounded-tile ring-4 ring-accent/80" />
                )}
                {item?.kind === "folder" && (
                  <FolderTile
                    key={key}
                    folder={item.folder}
                    games={item.games}
                    index={index}
                    size={tileSize}
                    selected={underCursor}
                    lifted={lifted}
                    animateLayout={justDropped !== key && heldKey !== key}
                    dropHighlight={isTarget && draggedIsGame}
                    onSelect={onCursor}
                    onOpen={onActivate}
                  />
                )}
                {/* Icône tenue : elle glisse de case en case avec le curseur, puis se pose (même
                    identifiant d'animation que l'icône, qui prend le relais en douceur). */}
                {heldItem && cursor === index && (
                  <motion.div
                    layoutId={layoutIdOf(heldItem)}
                    className="pointer-events-none absolute inset-0 z-30"
                    initial={false}
                    animate={{ y: -6, scale: 1.08, rotate: -3 }}
                    transition={{ type: "spring", stiffness: 520, damping: 32 }}
                  >
                    <LiftedVisual item={heldItem} size={tileSize} />
                  </motion.div>
                )}
              </div>
              {labelHeight > 0 && (
                <p
                  className={`truncate px-1 pt-2 text-center text-xs font-bold ${cursor === index ? "text-accent-strong" : "text-muted"}`}
                  style={{ height: labelHeight }}
                >
                  {lifted ? "" : label}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* L'icône en cours de déplacement, qui suit le pointeur. Rendue à la racine de la page : sous
          un panneau à `backdrop-filter`, `position: fixed` ne serait plus relatif à la fenêtre. */}
      {drag &&
        createPortal(
        <motion.div
          className="pointer-events-none fixed left-0 top-0 z-50"
          style={{ x: ghostX, y: ghostY, width: tileSize, height: tileSize, scale: ghostScale, opacity: ghostOpacity }}
        >
          <motion.div
            className="relative h-full w-full"
            initial={{ scale: 1, rotate: 0 }}
            animate={{ scale: 1.1, rotate: -3 }}
            transition={{ type: "spring", stiffness: 500, damping: 26 }}
          >
            <LiftedVisual item={drag.item} size={tileSize} />
          </motion.div>
        </motion.div>,
          document.body,
        )}
    </>
  );
}
