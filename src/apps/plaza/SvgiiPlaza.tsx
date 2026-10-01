import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useAppAction } from "../AppWindow";
import { activityStats } from "../../lib/api";
import { useCollection } from "../../lib/mascot";
import { earnFromPlaytime, forget, usePlaza, welcome } from "../../lib/plaza";
import { sound } from "../../lib/sound";
import { useI18n } from "../../lib/i18n";
import type { Activity, Game } from "../../types";
import { ActivitiesTab, type ActivityView } from "./Activities";
import { Golds } from "./common";
import { DressingTab } from "./Dressing";
import { PlaceTab } from "./Place";
import { ShopTab } from "./Shop";

type Tab = "place" | "shop" | "dressing" | "activities";
const TABS: { id: Tab; label: "plazaTabPlace" | "plazaTabShop" | "plazaTabDressing" | "plazaTabActivities" }[] = [
  { id: "place", label: "plazaTabPlace" },
  { id: "shop", label: "plazaTabShop" },
  { id: "dressing", label: "plazaTabDressing" },
  { id: "activities", label: "plazaTabActivities" },
];

interface Props {
  /** Jeux connus (installés et catalogue) : noms pour la conversation et le quiz. */
  games: Map<number, Game>;
  installed: Game[];
  notify: (message: string) => void;
}

/**
 * La Svgii Plaza : la Place où se promènent tes Svgii, la Svgii Shop où dépenser les Golds gagnés
 * en jouant, le Dressing pour les accessoires, et les activités (expéditions, quiz, combats).
 */
export function SvgiiPlaza({ games, installed, notify }: Props) {
  const { t } = useI18n();
  const { list } = useCollection();
  const plaza = usePlaza();
  const [tab, setTab] = useState<Tab>("place");
  const [menu, setMenu] = useState<string | null>(null);
  const [dressFor, setDressFor] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityView | null>(null);
  const [stats, setStats] = useState<Activity[]>([]);

  // Chaque Svgii de la collection a sa place ; ceux qui en sont partis sont oubliés.
  useEffect(() => {
    const ids = list.map((s) => s.id);
    welcome(ids);
    forget(new Set(ids));
  }, [list]);

  // Le temps joué depuis la dernière visite devient des Golds.
  useEffect(() => {
    let alive = true;
    void activityStats()
      .then((s) => {
        if (!alive) return;
        setStats(s);
        const first = plaza.playedMinutes == null;
        const earned = earnFromPlaytime(s.reduce((sum, a) => sum + a.playtime, 0));
        if (earned) {
          sound.ready();
          notify(first ? t("plazaWelcomeGift", { n: earned }) : t("plazaEarned", { n: earned }));
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // Une seule fois, à l'ouverture.
  }, []);

  const recentGame = useMemo(() => {
    const last = [...stats].filter((a) => a.lastPlayed > 0).sort((a, b) => b.lastPlayed - a.lastPlayed)[0];
    return last ? (games.get(last.appid)?.name ?? null) : null;
  }, [stats, games]);

  // Ⓑ referme d'abord le menu d'un Svgii, puis revient au choix des activités, avant de fermer.
  useAppAction((action) => {
    if (action !== "back") return false;
    if (menu) {
      setMenu(null);
      return true;
    }
    if (tab === "activities" && activity) {
      setActivity(null);
      return true;
    }
    return false;
  });

  const go = (next: Tab) => {
    if (next !== tab) sound.move();
    setMenu(null);
    setTab(next);
  };

  return (
    <div className="flex flex-col gap-5 p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <nav data-nav-zone className="flex flex-wrap gap-1.5 rounded-full bg-surface-2 p-1.5">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={tab === item.id ? "page" : undefined}
              onMouseEnter={() => sound.hover()}
              onClick={() => go(item.id)}
              className={`relative rounded-full px-4 py-2 text-sm font-extrabold outline-none focus-visible:ring-3 focus-visible:ring-accent ${
                tab === item.id ? "text-on-accent" : "text-muted hover:text-ink"
              }`}
            >
              {tab === item.id && (
                <motion.span layoutId="plaza-tab" className="absolute inset-0 rounded-full bg-accent" transition={{ type: "spring", stiffness: 500, damping: 36 }} />
              )}
              <span className="relative">{t(item.label)}</span>
            </button>
          ))}
        </nav>
        <span title={t("plazaGoldsTitle")} className="ml-auto rounded-full bg-surface-2 px-4 py-2 text-ink shadow-soft">
          <Golds value={plaza.golds} big />
        </span>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }}>
          {tab === "place" && (
            <PlaceTab
              menu={menu}
              onMenu={setMenu}
              onDress={(id) => {
                setDressFor(id);
                go("dressing");
              }}
              onShop={() => go("shop")}
              notify={notify}
              recentGame={recentGame}
            />
          )}
          {tab === "shop" && <ShopTab notify={notify} />}
          {tab === "dressing" && <DressingTab selected={dressFor} onSelect={setDressFor} onShop={() => go("shop")} />}
          {tab === "activities" && <ActivitiesTab view={activity} onView={setActivity} games={games} installed={installed} stats={stats} notify={notify} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
