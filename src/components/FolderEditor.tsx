import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { FOLDER_COLORS, type Folder } from "../lib/board";
import { FolderArt } from "./FolderTile";
import { sound } from "../lib/sound";
import type { Game } from "../types";
import { useI18n } from "../lib/i18n";

interface Props {
  folder: Folder;
  games: Game[];
  /** Création : le dossier n'existe sur le plateau qu'après « Créer ». */
  isNew: boolean;
  onSave: (name: string, color: string) => void;
  onCancel: () => void;
}

/** Fenêtre de réglage d'un dossier : nom et couleur (palette ou couleur libre). */
export function FolderEditor({ folder, games, isNew, onSave, onCancel }: Props) {
  const { t } = useI18n();
  const [name, setName] = useState(folder.name);
  const [color, setColor] = useState(folder.color);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const submit = () => {
    sound.select();
    onSave(name.trim() || t("fallbackFolderName"), color);
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/25 p-4 backdrop-blur-[2px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <motion.form
        role="dialog"
        aria-label={isNew ? t("newFolder") : t("editFolder")}
        className="w-full max-w-md rounded-panel bg-surface p-6 shadow-pop"
        initial={{ scale: 0.9, y: 16 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 8 }}
        transition={{ type: "spring", stiffness: 420, damping: 30 }}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
        }}
      >
        <div className="flex items-center gap-5">
          <div className="relative h-24 w-24 shrink-0">
            <FolderArt folder={{ ...folder, color }} games={games} size={96} />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-extrabold text-muted">{isNew ? t("newFolder") : t("editFolder")}</p>
            <input
              ref={inputRef}
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("folderName")}
              className="w-full rounded-2xl bg-surface-2 px-4 py-2.5 text-lg font-extrabold text-ink outline-none focus:ring-3 focus:ring-accent"
            />
          </div>
        </div>

        <p className="mb-2 mt-5 text-sm font-extrabold text-muted">{t("color")}</p>
        <div className="flex flex-wrap items-center gap-2.5">
          {FOLDER_COLORS.map((c) => (
            <motion.button
              key={c}
              type="button"
              aria-label={`${t("color")} ${c}`}
              onClick={() => {
                sound.move();
                setColor(c);
              }}
              whileHover={{ scale: 1.15 }}
              whileTap={{ scale: 0.88 }}
              className={`h-9 w-9 rounded-full shadow-soft ${color === c ? "ring-3 ring-ink/60 ring-offset-2 ring-offset-surface" : ""}`}
              style={{ background: c }}
            />
          ))}
          {/* Couleur libre */}
          <label
            title={t("customColor")}
            className={`relative grid h-9 w-9 cursor-pointer place-items-center rounded-full shadow-soft ${
              FOLDER_COLORS.includes(color) ? "" : "ring-3 ring-ink/60 ring-offset-2 ring-offset-surface"
            }`}
            style={{ background: "conic-gradient(#ff6b6b, #ffc93c, #6bd48f, #4aa3ff, #a78bfa, #ff8fc7, #ff6b6b)" }}
          >
            <span className="h-4 w-4 rounded-full border-2 border-white" style={{ background: color }} />
            <input
              type="color"
              data-nav-skip
              tabIndex={-1}
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
        </div>

        {/* Teinte libre au curseur : réglable à la manette (← →), contrairement au sélecteur natif. */}
        <label className="mt-4 flex items-center gap-3">
          <span className="w-28 shrink-0 text-sm font-extrabold text-muted">{t("customColor")}</span>
          <input
            type="range"
            min={0}
            max={360}
            value={hueOf(color)}
            onChange={(e) => setColor(hslToHex(Number(e.target.value), 78, 62))}
            className="h-3 flex-1 cursor-pointer appearance-none rounded-full"
            style={{
              background: "linear-gradient(90deg, #ff5f5f, #ffc04d, #d8f05a, #5ee07a, #4dd6e8, #5f8dff, #b06bff, #ff5fc4, #ff5f5f)",
            }}
          />
        </label>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full px-5 py-2.5 font-extrabold text-muted hover:bg-surface-2"
          >
            {t("cancel")}
          </button>
          <button type="submit" data-nav-primary className="rounded-full bg-accent px-6 py-2.5 font-extrabold text-on-accent shadow-soft">
            {isNew ? t("create") : t("save")}
          </button>
        </div>
      </motion.form>
    </motion.div>
  );
}

function hslToHex(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Teinte (0-360) d'une couleur hexadécimale, pour placer le curseur. */
function hueOf(hex: string): number {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  if (!m) return 0;
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16) / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (!d) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round((h * 60 + 360) % 360);
}
