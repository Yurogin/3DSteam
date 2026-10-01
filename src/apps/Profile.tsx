import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Mascot } from "../components/Mascot";
import { ProfileEditor } from "../components/ProfileEditor";
import { SectionTitle, useAppAction } from "./AppWindow";
import { StatTile, formatHours } from "./ActivityLog";
import { activityStats, avatarUrl, mediaSrc, openSvgiiDir, saveSvgiiFile, steamProfile } from "../lib/api";
import { initials } from "../lib/art";
import {
  createSvgii,
  deleteSvgii,
  encodeSvgii,
  importSvgii,
  randomMascot,
  setFavorite,
  shade,
  updateSvgii,
  useCollection,
  useMascotMood,
  type Mood,
  type Svgii,
} from "../lib/mascot";
import { sound } from "../lib/sound";
import { useI18n } from "../lib/i18n";
import type { Activity, Game, SteamProfile } from "../types";

interface Props {
  /** Jeux connus (installés et catalogue), pour les noms et les icônes. */
  games: Map<number, Game>;
  /** Jeux installés (applis comprises), pour le décompte. */
  installed: Game[];
  notify: (message: string) => void;
}

/** Couleur du badge de niveau, par dizaine, comme sur Steam. */
const LEVEL_COLORS = ["#9b9b9b", "#c02942", "#d95b43", "#fecc23", "#467a3c", "#4e8ddb", "#7652c9", "#c252c9", "#542437", "#997c52"];

function LevelBadge({ level }: { level: number }) {
  const { t } = useI18n();
  const color = LEVEL_COLORS[Math.floor(level / 10) % 10];
  return (
    <span
      title={t("profileLevel", { n: level })}
      className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface text-sm font-black tabular-nums text-ink shadow-soft"
      style={{ border: `3px solid ${color}` }}
    >
      {level}
    </span>
  );
}

const Star = ({ size = 14 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
    <path d="m12 2.8 2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.7l-5.4 2.9 1.1-6.1-4.5-4.3 6.1-.8L12 2.8Z" />
  </svg>
);

const ActionButton = ({ children, onClick, primary }: { children: ReactNode; onClick: () => void; primary?: boolean }) => (
  <motion.button
    type="button"
    onClick={onClick}
    onMouseEnter={() => sound.hover()}
    whileHover={{ scale: 1.04 }}
    whileTap={{ scale: 0.95 }}
    className={`rounded-full px-4 py-2 text-sm font-extrabold shadow-soft ${primary ? "bg-accent text-on-accent" : "bg-surface-2 text-ink"}`}
  >
    {children}
  </motion.button>
);

/** Nom du fichier `.svgii` : le nom du Svgii, sans accent ni caractère spécial. */
const fileName = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "svgii";

/**
 * Page Profil : ton Svgii favori, ta carte Steam (lue en local : pseudo, anciens pseudos, avatar,
 * niveau), quelques chiffres, et ta collection de Svgii — les tiens, et ceux que des amis t'ont
 * partagés par un code ou un fichier.
 */
export function ProfilePage({ games, installed, notify }: Props) {
  const { t, locale } = useI18n();
  const { list, favorite } = useCollection();
  const ambient = useMascotMood();
  const [steam, setSteam] = useState<SteamProfile | null | undefined>(undefined);
  const [stats, setStats] = useState<Activity[]>([]);
  /** Éditeur ouvert : un nouveau Svgii (`id` nul), ou la retouche de l'un des siens. */
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  /** Fiche ouverte d'un Svgii de la collection. */
  const [sheet, setSheet] = useState<string | null>(null);
  const [poke, setPoke] = useState<Mood | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    void steamProfile()
      .then((p) => alive && setSteam(p))
      .catch(() => alive && setSteam(null));
    void activityStats()
      .then((s) => alive && setStats(s))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!poke) return;
    const id = window.setTimeout(() => setPoke(null), 1000);
    return () => window.clearTimeout(id);
  }, [poke]);

  // Ⓑ referme d'abord l'éditeur, puis la fiche, avant de fermer la page.
  useAppAction((action) => {
    if (action !== "back") return false;
    if (editing) {
      setEditing(null);
      return true;
    }
    if (sheet) {
      setSheet(null);
      return true;
    }
    return false;
  });

  const me = list.find((s) => s.id === favorite)!;
  const opened = sheet ? list.find((s) => s.id === sheet) : undefined;
  const edited = editing?.id ? list.find((s) => s.id === editing.id) : undefined;
  const total = stats.reduce((s, a) => s + a.playtime, 0);
  const top = useMemo(() => [...stats].sort((a, b) => b.playtime - a.playtime)[0], [stats]);
  const favoriteGame = top ? games.get(top.appid) : undefined;
  const steamGames = installed.filter((g) => !g.builtin);
  const shortcuts = steamGames.filter((g) => g.shortcut).length;
  const avatar = steam?.avatarFile ? mediaSrc(steam.avatarFile) : steam?.avatar ? avatarUrl(steam.avatar, "full") : null;
  const fav = me.look.favorite;
  const nameOf = (s: Svgii) => s.name || t("profileNoName");

  const importText = (text: string) => {
    const result = importSvgii(text);
    if (result.status === "invalid") {
      sound.error();
      return notify(t("svgiiInvalid"));
    }
    if (result.status === "duplicate") return notify(t("svgiiDuplicate", { name: nameOf(result.svgii) }));
    sound.ready();
    notify(t("svgiiAdded", { name: nameOf(result.svgii) }));
    setSheet(result.svgii.id);
  };

  const pasteCode = async () => {
    try {
      importText(await navigator.clipboard.readText());
    } catch {
      notify(t("clipboardError"));
    }
  };

  return (
    <div className="flex flex-col gap-7 p-5 sm:p-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Ma carte : le Svgii favori, à sa couleur préférée. */}
        <section
          className="relative flex items-center gap-5 overflow-hidden rounded-[24px] p-5 shadow-soft"
          style={{ background: `radial-gradient(circle at 22% 40%, ${shade(fav, 0.85)}, ${shade(fav, 0.45)})` }}
        >
          <span className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/20" />
          <button
            type="button"
            aria-label={nameOf(me)}
            onClick={() => {
              sound.select();
              setPoke("happy");
            }}
            className="relative shrink-0 rounded-full outline-none focus-visible:ring-4 focus-visible:ring-accent"
          >
            <Mascot look={me.look} size={150} mood={poke ?? ambient} />
          </button>
          <div className="relative min-w-0">
            {/* Fond pastel clair quel que soit le thème : texte foncé fixe, lisible aussi en thème sombre. */}
            <p className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-[#2d2a33]/60">
              <Star size={12} />
              {t("profileCard")}
            </p>
            <h2 className="truncate text-3xl font-black text-[#2d2a33]">{nameOf(me)}</h2>
            <motion.button
              type="button"
              data-nav-primary
              onClick={() => {
                sound.select();
                setEditing({ id: me.id });
              }}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.95 }}
              className="mt-3 rounded-full bg-white px-4 py-2 text-sm font-black text-[#2d2a33] shadow-soft"
            >
              {t("profileEdit")}
            </motion.button>
          </div>
        </section>

        {/* Carte Steam. */}
        <section className="flex min-w-0 flex-col gap-3 rounded-[24px] bg-surface-2 p-5">
          {steam === undefined ? (
            <p className="text-sm font-bold text-muted">{t("loading")}</p>
          ) : steam === null ? (
            <p className="text-sm font-bold text-muted">{t("profileNoSteam")}</p>
          ) : (
            <>
              <div className="flex items-center gap-4">
                {avatar ? (
                  <img src={avatar} alt="" className="h-16 w-16 shrink-0 rounded-2xl shadow-soft" />
                ) : (
                  <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-accent text-xl font-black text-on-accent">
                    {initials(steam.persona || "?")}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-extrabold uppercase tracking-wide text-muted">{t("profileSteam")}</p>
                  <p className="truncate text-2xl font-black text-ink">{steam.persona}</p>
                </div>
                {steam.level != null && <LevelBadge level={steam.level} />}
              </div>
              {steam.nameHistory.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-extrabold text-muted">{t("profileOldNames")}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {steam.nameHistory.map((name) => (
                      <span key={name} className="rounded-full bg-surface px-3 py-1 text-xs font-bold text-ink shadow-soft">
                        {name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <p className="mt-auto text-xs font-bold text-muted">{t("profileLocal")}</p>
            </>
          )}
        </section>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={t("activityTotal")} value={formatHours(total, t, locale)} />
        <StatTile
          label={shortcuts ? t("profileInstalledWith", { n: shortcuts }) : t("profileInstalled")}
          value={steamGames.length.toLocaleString(locale)}
        />
        {favoriteGame ? (
          <StatTile label={t("activityFavorite")} value={favoriteGame.name} game={favoriteGame} />
        ) : (
          <StatTile label={t("activityFavorite")} value="—" />
        )}
        <StatTile label={t("svgiiMine")} value={list.length.toLocaleString(locale)} />
      </div>

      <section>
        <SectionTitle aside={t("svgiiAside")}>{t("svgiiMine")}</SectionTitle>
        <div className="mb-4 flex flex-wrap gap-2">
          <ActionButton
            primary
            onClick={() => {
              sound.select();
              setEditing({ id: null });
            }}
          >
            {t("svgiiNew")}
          </ActionButton>
          <ActionButton onClick={() => void pasteCode()}>{t("svgiiPaste")}</ActionButton>
          <ActionButton onClick={() => fileRef.current?.click()}>{t("svgiiImportFile")}</ActionButton>
          <ActionButton onClick={() => void openSvgiiDir().catch((e) => notify(String(e)))}>{t("svgiiFolder")}</ActionButton>
          <input
            ref={fileRef}
            type="file"
            accept=".svgii,.txt,text/plain"
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
        <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-3">
          {list.map((s) => (
            <motion.button
              key={s.id}
              type="button"
              layout
              aria-label={nameOf(s)}
              onClick={() => {
                sound.select();
                setSheet(s.id);
              }}
              onMouseEnter={() => sound.hover()}
              whileHover={{ y: -3 }}
              whileTap={{ scale: 0.95 }}
              className={`relative flex flex-col items-center gap-1 rounded-[22px] px-2 pb-3 pt-4 outline-none focus-visible:ring-4 focus-visible:ring-accent ${
                s.id === favorite ? "ring-3 ring-accent" : ""
              }`}
              style={{ background: `linear-gradient(180deg, ${shade(s.look.favorite, 0.82)}, ${shade(s.look.favorite, 0.6)})` }}
            >
              <Mascot look={s.look} size={96} animated={s.id === favorite} mood={s.id === favorite ? ambient : "idle"} />
              <span className="w-full truncate text-center text-sm font-black text-[#2d2a33]">{nameOf(s)}</span>
              {s.id === favorite && (
                <span className="absolute left-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-accent text-on-accent shadow-soft" title={t("svgiiFavorite")}>
                  <Star />
                </span>
              )}
              {s.received && (
                <span className="absolute right-2 top-2 rounded-full bg-white/85 px-2 py-0.5 text-[10px] font-black uppercase text-[#2d2a33]">
                  {t("svgiiReceived")}
                </span>
              )}
            </motion.button>
          ))}
        </div>
      </section>

      <AnimatePresence>
        {opened && !editing && (
          <SvgiiSheet
            key="sheet"
            svgii={opened}
            isFavorite={opened.id === favorite}
            notify={notify}
            onEdit={() => setEditing({ id: opened.id })}
            onClose={() => setSheet(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editing && (
          <ProfileEditor
            key="editor"
            isNew={editing.id == null}
            initialName={edited?.name ?? ""}
            initialLook={edited?.look ?? randomMascot()}
            onSave={(name, look) => {
              if (edited) {
                updateSvgii(edited.id, name, look);
              } else {
                const created = createSvgii(name || t("svgiiDefaultName", { n: list.length + 1 }), look);
                setSheet(created.id);
              }
              setEditing(null);
            }}
            onClose={() => setEditing(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/** Fiche d'un Svgii : le mettre en favori, le retoucher, le partager, ou lui dire au revoir. */
function SvgiiSheet({
  svgii,
  isFavorite,
  notify,
  onEdit,
  onClose,
}: {
  svgii: Svgii;
  isFavorite: boolean;
  notify: (message: string) => void;
  onEdit: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [sharing, setSharing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [hop, setHop] = useState(0);
  const code = useMemo(() => encodeSvgii(svgii.name, svgii.look), [svgii]);
  const name = svgii.name || t("profileNoName");
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      sound.select();
      notify(t("svgiiCodeCopied"));
    } catch {
      notify(t("clipboardError"));
    }
  };

  const exportFile = async () => {
    try {
      const path = await saveSvgiiFile(fileName(name), `${t("svgiiFileTitle", { name })}\n${code}\n\n${t("svgiiFileHint")}\n`);
      sound.select();
      notify(t("svgiiExported", { path }));
    } catch (e) {
      notify(String(e));
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/25 p-4 backdrop-blur-[2px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        role="dialog"
        aria-label={name}
        className="soft-scroll flex max-h-[calc(100vh-24px)] w-full max-w-lg flex-col items-center gap-3 overflow-y-auto rounded-panel bg-surface p-6 shadow-pop"
        initial={{ scale: 0.9, y: 16 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 8 }}
        transition={{ type: "spring", stiffness: 420, damping: 30 }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <button
          type="button"
          aria-label={name}
          onClick={() => {
            sound.select();
            setHop((h) => h + 1);
          }}
          className="grid h-44 w-44 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-4 focus-visible:ring-accent"
          style={{ background: `radial-gradient(circle at 50% 38%, ${shade(svgii.look.favorite, 0.82)}, ${shade(svgii.look.favorite, 0.5)})` }}
        >
          <Mascot look={svgii.look} size={150} mood={hop ? "happy" : "idle"} bounce={hop} />
        </button>
        <h2 className="max-w-full truncate text-2xl font-black text-ink">{name}</h2>
        <div className="flex flex-wrap justify-center gap-1.5">
          {isFavorite && (
            <span className="flex items-center gap-1 rounded-full bg-accent px-3 py-1 text-xs font-black text-on-accent">
              <Star size={12} />
              {t("svgiiFavorite")}
            </span>
          )}
          {svgii.received && <span className="rounded-full bg-surface-2 px-3 py-1 text-xs font-black text-muted">{t("svgiiReceivedHint")}</span>}
        </div>

        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {!svgii.received && !isFavorite && (
            <ActionButton
              primary
              onClick={() => {
                sound.ready();
                setFavorite(svgii.id);
                setHop((h) => h + 1);
              }}
            >
              <span className="flex items-center gap-1.5">
                <Star />
                {t("svgiiSetFavorite")}
              </span>
            </ActionButton>
          )}
          {!svgii.received && (
            <ActionButton
              onClick={() => {
                sound.select();
                onEdit();
              }}
            >
              {t("svgiiEdit")}
            </ActionButton>
          )}
          <ActionButton
            onClick={() => {
              sound.move();
              setSharing((s) => !s);
            }}
          >
            {t("svgiiShare")}
          </ActionButton>
        </div>

        <AnimatePresence initial={false}>
          {sharing && (
            <motion.div
              className="w-full shrink-0 overflow-hidden"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
            >
              <div className="mt-1 flex flex-col gap-3 rounded-2xl bg-surface-2 p-4">
                <p className="text-xs font-bold text-muted">{t("svgiiShareHint")}</p>
                <code className="select-all break-all rounded-xl bg-surface px-3 py-2.5 text-center font-mono text-sm font-bold tracking-wide text-ink">
                  {code}
                </code>
                <div className="flex flex-wrap justify-center gap-2">
                  <ActionButton primary onClick={() => void copy()}>
                    {t("svgiiCopyCode")}
                  </ActionButton>
                  <ActionButton onClick={() => void exportFile()}>{t("svgiiExport")}</ActionButton>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-2 flex w-full items-center justify-between gap-2">
          {isFavorite ? (
            <span className="text-xs font-bold text-muted">{t("svgiiDeleteFavorite")}</span>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (!confirmDelete) {
                  sound.move();
                  return setConfirmDelete(true);
                }
                sound.crack();
                notify(t("svgiiDeleted", { name }));
                deleteSvgii(svgii.id);
                onClose();
              }}
              onBlur={() => setConfirmDelete(false)}
              className={`rounded-full px-4 py-2 text-sm font-extrabold ${confirmDelete ? "bg-[#e5484d] text-white" : "text-[#e5484d] hover:bg-[#e5484d]/10"}`}
            >
              {confirmDelete ? t("svgiiDeleteConfirm") : t("svgiiDelete")}
            </button>
          )}
          <button ref={closeRef} type="button" onClick={onClose} className="rounded-full px-5 py-2 text-sm font-extrabold text-muted hover:bg-surface-2">
            {t("closeEsc")}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
