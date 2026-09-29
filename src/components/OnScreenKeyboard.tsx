import { useEffect, useState, type MutableRefObject } from "react";
import { motion } from "framer-motion";
import { isDir, setInputValue, type Action } from "../lib/nav";
import { useI18n } from "../lib/i18n";
import { sound } from "../lib/sound";

/** Touche spéciale (les autres sont des caractères). */
type Special = "shift" | "space" | "backspace" | "clear" | "done";
type Key = string | Special;

const LAYOUTS: Record<"fr" | "en", string[]> = {
  fr: ["1234567890", "azertyuiop", "qsdfghjklm", "wxcvbn,.'-", "éèàçù&_!?:"],
  en: ["1234567890", "qwertyuiop", "asdfghjkl'", "zxcvbnm,.-", "&_!?:@#()+"],
};
const CONTROLS: Special[] = ["shift", "space", "backspace", "clear", "done"];
const SPECIAL = new Set<Key>(CONTROLS);

interface Props {
  input: HTMLInputElement;
  /** Reçoit les actions manette / clavier pendant que le clavier est ouvert. */
  handlerRef: MutableRefObject<((a: Action) => void) | null>;
  onClose: () => void;
}

/**
 * Clavier virtuel pour saisir du texte à la manette : il écrit directement dans le champ visé.
 * Ⓐ : touche · Ⓧ : effacer · Ⓨ : espace · Ⓑ : valider et fermer.
 */
export function OnScreenKeyboard({ input, handlerRef, onClose }: Props) {
  const { t, lang } = useI18n();
  const [value, setValue] = useState(input.value);
  const [shift, setShift] = useState(false);
  const [pos, setPos] = useState({ row: 1, col: 0 });

  const rows: Key[][] = [...LAYOUTS[lang].map((r) => [...r]), CONTROLS];

  const write = (next: string) => {
    const max = input.maxLength > 0 ? input.maxLength : Infinity;
    next = next.slice(0, max);
    setInputValue(input, next);
    setValue(next);
  };

  const press = (key: Key) => {
    sound.move();
    if (key === "shift") return setShift((s) => !s);
    if (key === "space") return write(value + " ");
    if (key === "backspace") return write(value.slice(0, -1));
    if (key === "clear") return write("");
    if (key === "done") return close();
    write(value + (shift ? key.toUpperCase() : key));
    if (shift) setShift(false);
  };

  const close = () => {
    sound.select();
    onClose();
  };

  const move = (dx: number, dy: number) => {
    setPos(({ row, col }) => {
      if (dy) {
        const nextRow = Math.min(rows.length - 1, Math.max(0, row + dy));
        // Même position relative dans la rangée d'arrivée (elles n'ont pas toutes la même longueur).
        const ratio = (col + 0.5) / rows[row].length;
        return { row: nextRow, col: Math.min(rows[nextRow].length - 1, Math.floor(ratio * rows[nextRow].length)) };
      }
      return { row, col: (col + dx + rows[row].length) % rows[row].length };
    });
    sound.move();
  };

  useEffect(() => {
    const sync = () => setValue(input.value);
    input.addEventListener("input", sync);
    return () => input.removeEventListener("input", sync);
  }, [input]);

  // Actions routées par l'application (manette ou flèches du clavier).
  useEffect(() => {
    handlerRef.current = (a: Action) => {
      if (isDir(a)) return move(a === "left" ? -1 : a === "right" ? 1 : 0, a === "up" ? -1 : a === "down" ? 1 : 0);
      if (a === "confirm") return press(rows[pos.row][pos.col]);
      if (a === "grab") return press("backspace");
      if (a === "create") return press("space");
      if (a === "back") return close();
    };
    return () => {
      handlerRef.current = null;
    };
  });

  const label = (key: Key) =>
    key === "shift" ? "⇧" : key === "space" ? t("oskSpace") : key === "backspace" ? "⌫" : key === "clear" ? t("oskClear") : key === "done" ? t("oskDone") : shift ? key.toUpperCase() : key;

  return (
    <motion.div
      className="fixed inset-x-0 bottom-0 z-[60] flex justify-center p-4"
      initial={{ y: 40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 40, opacity: 0 }}
      transition={{ type: "spring", stiffness: 420, damping: 34 }}
      // La souris peut aussi taper : on garde le focus dans le champ édité.
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="w-full max-w-3xl rounded-panel bg-surface p-4 shadow-pop ring-1 ring-muted/20">
        <div className="mb-3 flex items-center gap-3 rounded-2xl bg-surface-2 px-4 py-2.5">
          <span className="min-w-0 flex-1 truncate text-lg font-extrabold">
            {value || <span className="text-muted">{input.placeholder}</span>}
            <span className="ml-0.5 inline-block h-5 w-0.5 translate-y-0.5 animate-pulse bg-accent" />
          </span>
          <span className="shrink-0 text-xs font-bold text-muted">{t("oskHint")}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          {rows.map((row, r) => (
            <div key={r} className="flex gap-1.5">
              {row.map((key, c) => {
                const active = pos.row === r && pos.col === c;
                const wide = key === "space" ? "flex-[3]" : SPECIAL.has(key) ? "flex-[1.5]" : "flex-1";
                return (
                  <button
                    key={`${r}-${c}`}
                    type="button"
                    tabIndex={-1}
                    onClick={() => {
                      setPos({ row: r, col: c });
                      press(key);
                    }}
                    className={`${wide} h-11 rounded-xl text-base font-extrabold transition-colors ${
                      active
                        ? "bg-accent text-on-accent shadow-soft"
                        : key === "done"
                          ? "bg-accent-soft text-accent-strong"
                          : key === "shift" && shift
                            ? "bg-accent-soft text-accent-strong"
                            : "bg-surface-2 text-ink hover:bg-accent-soft"
                    }`}
                  >
                    {label(key)}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
