import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Mascot } from "./Mascot";
import {
  ACCESSORIES,
  EARS,
  EYES,
  FAVORITES,
  HAIRS,
  HAIR_COLORS,
  HEADS,
  MOUTHS,
  SKINS,
  randomMascot,
  shade,
  type MascotLook,
  type Mood,
} from "../lib/mascot";
import { sound } from "../lib/sound";
import { useI18n } from "../lib/i18n";

type Tab = "head" | "ears" | "eyes" | "mouth" | "hair" | "accessory" | "color";
const TABS: { id: Tab; label: "mascotTabHead" | "mascotTabEars" | "mascotTabEyes" | "mascotTabMouth" | "mascotTabHair" | "mascotTabAccessory" | "mascotTabColor" }[] = [
  { id: "head", label: "mascotTabHead" },
  { id: "ears", label: "mascotTabEars" },
  { id: "eyes", label: "mascotTabEyes" },
  { id: "mouth", label: "mascotTabMouth" },
  { id: "hair", label: "mascotTabHair" },
  { id: "accessory", label: "mascotTabAccessory" },
  { id: "color", label: "mascotTabColor" },
];

interface Props {
  initialName: string;
  initialLook: MascotLook;
  /** Création d'un nouveau Svgii, ou retouche d'un des siens. */
  isNew: boolean;
  onSave: (name: string, look: MascotLook) => void;
  onClose: () => void;
}

/**
 * Éditeur de mascotte, à la manière d'un éditeur d'avatars : la mascotte en grand à gauche, et pour
 * chaque pièce des vignettes qui la montrent déjà avec ce choix. Tout se fait aussi à la manette.
 */
export function ProfileEditor({ initialName, initialLook, isNew, onSave, onClose }: Props) {
  const { t } = useI18n();
  const [name, setName] = useState(initialName);
  const [look, setLook] = useState<MascotLook>(initialLook);
  const [tab, setTab] = useState<Tab>("head");
  // Chaque retouche fait sautiller la mascotte, puis elle revient au calme.
  const [bounce, setBounce] = useState(0);
  const [mood, setMood] = useState<Mood>("idle");
  const moodTimer = useRef(0);
  const firstTab = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstTab.current?.focus({ preventScroll: true });
    return () => window.clearTimeout(moodTimer.current);
  }, []);

  const react = (next: Mood = "happy") => {
    setBounce((b) => b + 1);
    setMood(next);
    window.clearTimeout(moodTimer.current);
    moodTimer.current = window.setTimeout(() => setMood("idle"), 950);
  };

  const change = (patch: Partial<MascotLook>) => {
    sound.move();
    setLook((l) => ({ ...l, ...patch }));
    react();
  };

  const submit = () => {
    sound.select();
    onSave(name, look);
  };

  /** Vignette d'un choix : la mascotte actuelle, avec ce choix appliqué. */
  const tile = (key: string, label: string, patch: Partial<MascotLook>, selected: boolean, crop: "head" | "bust" = "head") => (
    <motion.button
      key={key}
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={selected}
      onClick={() => change(patch)}
      onMouseEnter={() => sound.hover()}
      whileHover={{ scale: 1.06 }}
      whileTap={{ scale: 0.92 }}
      className={`flex flex-col items-center gap-1 rounded-2xl bg-surface-2 px-1.5 pb-1.5 pt-2 outline-none focus-visible:ring-3 focus-visible:ring-accent ${
        selected ? "ring-3 ring-accent" : ""
      }`}
    >
      <Mascot look={{ ...look, ...patch }} size={76} animated={false} crop={crop} />
      <span className={`w-full truncate text-center text-[11px] font-extrabold ${selected ? "text-accent" : "text-muted"}`}>{label}</span>
    </motion.button>
  );

  const swatches = (title: string, colors: string[], value: string, apply: (c: string) => Partial<MascotLook>, big = false) => (
    <div>
      <p className="mb-2 text-sm font-extrabold text-muted">{title}</p>
      <div className="flex flex-wrap gap-2.5">
        {colors.map((c) => (
          <motion.button
            key={c}
            type="button"
            aria-label={`${title} ${c}`}
            aria-pressed={value === c}
            onClick={() => change(apply(c))}
            onMouseEnter={() => sound.hover()}
            whileHover={{ scale: 1.15 }}
            whileTap={{ scale: 0.88 }}
            className={`${big ? "h-11 w-11" : "h-9 w-9"} rounded-full shadow-soft outline-none focus-visible:ring-3 focus-visible:ring-accent ${
              value === c ? "ring-3 ring-ink/60 ring-offset-2 ring-offset-surface" : ""
            }`}
            style={{ background: c, border: `2px solid ${shade(c, -0.15)}` }}
          />
        ))}
      </div>
    </div>
  );

  const grid = (children: ReactNode) => <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2.5">{children}</div>;

  const content = (() => {
    switch (tab) {
      case "head":
        return (
          <>
            {grid(HEADS.map((h) => tile(h, t(`mascot_head_${h}`), { head: h }, look.head === h)))}
            {swatches(t("mascotSkin"), SKINS, look.skin, (c) => ({ skin: c }))}
            <div className="flex gap-2.5">
              {[true, false].map((on) => (
                <button
                  key={String(on)}
                  type="button"
                  aria-pressed={look.cheeks === on}
                  onClick={() => change({ cheeks: on })}
                  className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-extrabold outline-none focus-visible:ring-3 focus-visible:ring-accent ${
                    look.cheeks === on ? "bg-accent text-on-accent" : "bg-surface-2 text-muted"
                  }`}
                >
                  {on && <span className="h-2.5 w-4 rounded-full bg-[#ff8fab]" />}
                  {on ? t("profileCheeks") : t("profileNoCheeks")}
                </button>
              ))}
            </div>
          </>
        );
      case "ears":
        return grid(EARS.map((e) => tile(e, t(`mascot_ears_${e}`), { ears: e }, look.ears === e)));
      case "eyes":
        return grid(EYES.map((e) => tile(e, t(`mascot_eyes_${e}`), { eyes: e }, look.eyes === e)));
      case "mouth":
        return grid(MOUTHS.map((m) => tile(m, t(`mascot_mouth_${m}`), { mouth: m }, look.mouth === m)));
      case "hair":
        return (
          <>
            {grid(HAIRS.map((h) => tile(h, t(`mascot_hair_${h}`), { hair: h }, look.hair === h)))}
            {swatches(t("mascotHairColor"), HAIR_COLORS, look.hairColor, (c) => ({ hairColor: c }))}
          </>
        );
      case "accessory":
        return grid(ACCESSORIES.map((a) => tile(a, t(`mascot_accessory_${a}`), { accessory: a }, look.accessory === a)));
      case "color":
        return (
          <>
            {swatches(t("mascotFavorite"), FAVORITES, look.favorite, (c) => ({ favorite: c }), true)}
            <p className="text-sm font-bold text-muted">{t("mascotFavoriteHint")}</p>
          </>
        );
    }
  })();

  return (
    <motion.div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/25 p-4 backdrop-blur-[2px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.form
        role="dialog"
        aria-label={isNew ? t("svgiiNewTitle") : t("svgiiEditTitle")}
        // Jamais plus haute que la fenêtre : au-delà, elle défile, boutons compris.
        className="soft-scroll max-h-[calc(100vh-24px)] w-full max-w-5xl overflow-y-auto rounded-panel bg-surface p-5 shadow-pop"
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
            onClose();
          }
        }}
      >
        <div className="grid gap-5 md:grid-cols-[260px_minmax(0,1fr)]">
          {/* La mascotte en grand, sur un fond à sa couleur préférée. */}
          <div className="flex flex-col gap-3">
            <p className="px-1 text-lg font-black text-ink">{isNew ? t("svgiiNewTitle") : t("svgiiEditTitle")}</p>
            <div
              className="relative grid aspect-square place-items-center overflow-hidden rounded-[28px] shadow-soft"
              style={{ background: `radial-gradient(circle at 50% 38%, ${shade(look.favorite, 0.82)}, ${shade(look.favorite, 0.5)})` }}
            >
              <span className="pointer-events-none absolute inset-x-6 bottom-5 h-4 rounded-[50%] bg-ink/10 blur-[2px]" />
              <Mascot look={look} size={210} mood={mood} bounce={bounce} />
            </div>
            <input
              value={name}
              maxLength={20}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("profileName")}
              aria-label={t("profileName")}
              spellCheck={false}
              className="w-full rounded-2xl bg-surface-2 px-4 py-2.5 text-center text-lg font-black text-ink outline-none focus:ring-3 focus:ring-accent"
            />
            <motion.button
              type="button"
              onClick={() => {
                sound.theme();
                setLook(randomMascot());
                react("excited");
              }}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.94 }}
              className="flex items-center justify-center gap-2 rounded-full bg-surface-2 px-4 py-2.5 font-extrabold text-ink outline-none focus-visible:ring-3 focus-visible:ring-accent"
            >
              <DiceIcon />
              {t("profileRandom")}
            </motion.button>
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <div data-nav-zone className="flex flex-wrap gap-1.5 rounded-full bg-surface-2 p-1.5">
              {TABS.map((item, i) => (
                <button
                  key={item.id}
                  ref={i === 0 ? firstTab : undefined}
                  type="button"
                  aria-current={tab === item.id ? "true" : undefined}
                  onClick={() => {
                    if (tab === item.id) return;
                    sound.move();
                    setTab(item.id);
                  }}
                  className={`rounded-full px-3 py-1.5 text-sm font-extrabold outline-none focus-visible:ring-3 focus-visible:ring-accent ${
                    tab === item.id ? "bg-surface text-accent shadow-soft" : "text-muted hover:text-ink"
                  }`}
                >
                  {t(item.label)}
                </button>
              ))}
            </div>
            <div data-nav-zone className="flex min-h-[260px] flex-col gap-4">
              {content}
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-full px-5 py-2.5 font-extrabold text-muted hover:bg-surface-2">
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

function DiceIcon() {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinejoin="round" aria-hidden>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
      <g fill="currentColor" stroke="none">
        <circle cx="8.5" cy="8.5" r="1.5" />
        <circle cx="15.5" cy="15.5" r="1.5" />
        <circle cx="12" cy="12" r="1.5" />
        <circle cx="15.5" cy="8.5" r="1.5" />
        <circle cx="8.5" cy="15.5" r="1.5" />
      </g>
    </svg>
  );
}
