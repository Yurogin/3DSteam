/**
 * Plateau façon menu de console : des cases numérotées, remplies colonne par colonne (de haut en bas,
 * puis vers la droite). Une case peut être vide, contenir un jeu ou un dossier ; un dossier a son
 * propre plateau (de jeux uniquement). Toutes les fonctions sont pures : elles renvoient un nouveau
 * plateau, ou le même objet si rien ne change.
 */

export type Cell = { kind: "game"; appid: number } | { kind: "folder"; id: string };
export type Slots = (Cell | null)[];

export interface Folder {
  id: string;
  name: string;
  /** Couleur CSS (hex). */
  color: string;
  slots: Slots;
}

export interface Board {
  slots: Slots;
  folders: Record<string, Folder>;
}

/** `null` = plateau principal, sinon l'id du dossier ouvert. */
export type ViewId = string | null;

export const FOLDER_COLORS = ["#4aa3ff", "#ff6b6b", "#ffc93c", "#ff8fc7", "#6bd48f", "#a78bfa", "#ff9f43", "#8d99ae"];

export const gameCell = (appid: number): Cell => ({ kind: "game", appid });

export const emptyBoard = (): Board => ({ slots: [], folders: {} });

/** Remplit les cases dans l'ordre donné, sans trou. */
export function compact(cells: Cell[]): Slots {
  return cells.slice();
}

/** Supprime les cases vides en fin de plateau (pas besoin de les stocker). */
export function trimEnd(slots: Slots): Slots {
  let end = slots.length;
  while (end > 0 && slots[end - 1] == null) end--;
  return end === slots.length ? slots : slots.slice(0, end);
}

export function viewSlots(board: Board, view: ViewId): Slots {
  return view == null ? board.slots : (board.folders[view]?.slots ?? []);
}

function withViewSlots(board: Board, view: ViewId, slots: Slots): Board {
  slots = trimEnd(slots);
  if (view == null) return { ...board, slots };
  const folder = board.folders[view];
  return folder ? { ...board, folders: { ...board.folders, [view]: { ...folder, slots } } } : board;
}

/** Première case vide à partir de `start` (le plateau s'agrandit si besoin). */
function firstFree(slots: Slots, start: number): number {
  let i = Math.max(0, start);
  while (i < slots.length && slots[i] != null) i++;
  return i;
}

function put(slots: Slots, index: number, cell: Cell | null): Slots {
  const next = slots.slice();
  while (next.length <= index) next.push(null);
  next[index] = cell;
  return next;
}

/** Tous les jeux déjà rangés quelque part (plateau principal ou dossier). */
export function placedGames(board: Board): Set<number> {
  const ids = new Set<number>();
  const collect = (slots: Slots) => slots.forEach((c) => c?.kind === "game" && ids.add(c.appid));
  collect(board.slots);
  Object.values(board.folders).forEach((f) => collect(f.slots));
  return ids;
}

/**
 * Place les jeux jamais vus (nouvellement installés) après le dernier élément du plateau
 * principal, pour ne jamais combler les trous laissés volontairement.
 */
export function placeNewGames(board: Board, appids: number[]): Board {
  const placed = placedGames(board);
  const missing = appids.filter((id) => !placed.has(id));
  return missing.length ? { ...board, slots: [...trimEnd(board.slots), ...missing.map(gameCell)] } : board;
}

/** Déplace le contenu de `from` vers `to` dans une même vue : vers une case vide, ou en échangeant. */
export function moveCell(board: Board, view: ViewId, from: number, to: number): Board {
  if (from === to) return board;
  const slots = viewSlots(board, view).slice();
  while (slots.length <= Math.max(from, to)) slots.push(null);
  [slots[from], slots[to]] = [slots[to], slots[from]];
  return withViewSlots(board, view, slots);
}

/** Range le jeu de la case `from` (plateau principal) dans un dossier, après son dernier jeu. */
export function moveIntoFolder(board: Board, from: number, folderId: string): Board {
  const cell = board.slots[from];
  const folder = board.folders[folderId];
  if (cell?.kind !== "game" || !folder) return board;
  const folderSlots = trimEnd(folder.slots);
  const next = withViewSlots(board, null, put(board.slots, from, null));
  return withViewSlots(next, folderId, [...folderSlots, cell]);
}

/** Sort un jeu d'un dossier : il prend la première case libre après le dossier. */
export function moveOutOfFolder(board: Board, folderId: string, from: number): { board: Board; index: number } | null {
  const folder = board.folders[folderId];
  const cell = folder?.slots[from];
  if (!folder || cell?.kind !== "game") return null;
  const folderIndex = board.slots.findIndex((c) => c?.kind === "folder" && c.id === folderId);
  const index = firstFree(board.slots, folderIndex + 1);
  const next = withViewSlots(board, folderId, put(folder.slots, from, null));
  return { board: withViewSlots(next, null, put(next.slots, index, cell)), index };
}

export function createFolder(board: Board, index: number, name: string, color: string): { board: Board; id: string } {
  const id = `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const slot = board.slots[index] == null ? index : firstFree(board.slots, index);
  const next: Board = { ...board, folders: { ...board.folders, [id]: { id, name, color, slots: [] } } };
  return { board: withViewSlots(next, null, put(next.slots, slot, { kind: "folder", id })), id };
}

export function updateFolder(board: Board, id: string, patch: Partial<Pick<Folder, "name" | "color">>): Board {
  const folder = board.folders[id];
  return folder ? { ...board, folders: { ...board.folders, [id]: { ...folder, ...patch } } } : board;
}

/** Supprime un dossier : ses jeux reprennent les cases libres à partir de celle du dossier. */
export function deleteFolder(board: Board, id: string): Board {
  const folder = board.folders[id];
  if (!folder) return board;
  const { [id]: _removed, ...folders } = board.folders;
  const folderIndex = board.slots.findIndex((c) => c?.kind === "folder" && c.id === id);
  let slots = folderIndex >= 0 ? put(board.slots, folderIndex, null) : board.slots.slice();
  let cursor = Math.max(0, folderIndex);
  for (const cell of folder.slots) {
    if (!cell) continue;
    cursor = firstFree(slots, cursor);
    slots = put(slots, cursor, cell);
  }
  return { slots: trimEnd(slots), folders };
}

/** Réécrit une vue dans l'ordre donné, sans trou (tris). Les dossiers restent en tête. */
export function sortView(board: Board, view: ViewId, compare: (a: number, b: number) => number): Board {
  const slots = viewSlots(board, view).filter((c): c is Cell => c != null);
  const folders = slots.filter((c) => c.kind === "folder");
  const games = slots
    .filter((c): c is Extract<Cell, { kind: "game" }> => c.kind === "game")
    .sort((a, b) => compare(a.appid, b.appid));
  return withViewSlots(board, view, [...folders, ...games]);
}

/** Taille fixe du plateau (en cases), indépendante de la position des icônes. */
export const BOARD_SLOTS = 100;
export const FOLDER_SLOTS = 60;

/**
 * Nombre de cases à afficher : une taille fixe (`baseSlots`), doublée du nombre d'éléments si la
 * bibliothèque est grande, et arrondie à des colonnes complètes. Elle ne dépend pas de l'endroit
 * où se trouve le dernier jeu : on peut en poser un très loin sans que le plateau ne grandisse.
 */
export function boardLength(
  usedLength: number,
  itemCount: number,
  rows: number,
  visibleColumns: number,
  baseSlots: number,
): number {
  const cells = Math.max(baseSlots, itemCount * 2, usedLength);
  return Math.max(Math.ceil(cells / rows), visibleColumns) * rows;
}

/** Position (colonne, rangée) d'une case, et l'inverse. */
export const toColRow = (index: number, rows: number) => ({ col: Math.floor(index / rows), row: index % rows });
export const toIndex = (col: number, row: number, rows: number) => col * rows + row;

/** Lit le plateau sauvegardé, en migrant les anciens formats (liste d'ordre, puis cases sans dossiers). */
export function migrateBoard(stored: unknown, legacySlots: unknown, legacyOrder: unknown): Board {
  if (stored && typeof stored === "object" && Array.isArray((stored as Board).slots)) {
    const b = stored as Board;
    return { slots: b.slots, folders: b.folders ?? {} };
  }
  if (Array.isArray(legacySlots)) return { slots: legacySlots as Slots, folders: {} };
  if (Array.isArray(legacyOrder)) return { slots: (legacyOrder as number[]).map(gameCell), folders: {} };
  return emptyBoard();
}
