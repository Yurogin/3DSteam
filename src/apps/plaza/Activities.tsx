import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Mascot } from "../../components/Mascot";
import { randomMascot, useCollection, type MascotLook, type Svgii } from "../../lib/mascot";
import {
  battlesLeft,
  careOf,
  claimTrip,
  DAILY_BATTLES,
  fullnessOf,
  heartsOf,
  quizRewardedToday,
  rewardBattle,
  rewardQuiz,
  startTrip,
  tripDone,
  TRIPS,
  usePlaza,
} from "../../lib/plaza";
import { sound } from "../../lib/sound";
import { useI18n, type TFunction } from "../../lib/i18n";
import type { Activity, Game } from "../../types";
import { cardBackground, Gauge, GoldIcon, itemName, PlazaButton } from "./common";

export type ActivityView = "trips" | "quiz" | "battle";

/** Un Svgii affamé ne part ni en expédition ni au combat. */
const TOO_HUNGRY = 20;

interface Props {
  view: ActivityView | null;
  onView: (view: ActivityView | null) => void;
  games: Map<number, Game>;
  installed: Game[];
  stats: Activity[];
  notify: (message: string) => void;
}

/** Point d'entrée des activités : expéditions, quiz et combats. */
export function ActivitiesTab({ view, onView, games, installed, stats, notify }: Props) {
  const { t } = useI18n();
  if (view === "trips") return <Expeditions notify={notify} onBack={() => onView(null)} />;
  if (view === "quiz") return <Quiz games={games} installed={installed} stats={stats} notify={notify} onBack={() => onView(null)} />;
  if (view === "battle") return <Battle notify={notify} onBack={() => onView(null)} />;

  const card = (id: ActivityView, title: string, text: string, icon: ReactNode, aside: ReactNode) => (
    <motion.button
      key={id}
      type="button"
      onClick={() => {
        sound.select();
        onView(id);
      }}
      onMouseEnter={() => sound.hover()}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.97 }}
      className="flex flex-col items-start gap-3 rounded-[24px] bg-surface-2 p-5 text-left outline-none focus-visible:ring-4 focus-visible:ring-accent"
    >
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-surface shadow-soft">{icon}</span>
      <span className="text-lg font-black text-ink">{title}</span>
      <span className="text-sm font-bold text-muted">{text}</span>
      <span className="mt-auto text-xs font-extrabold text-accent">{aside}</span>
    </motion.button>
  );

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {card("trips", t("tripsTitle"), t("tripsDesc"), <CompassIcon />, t("tripsAside"))}
      {card("quiz", t("quizTitle"), t("quizDesc"), <QuizIcon />, quizRewardedToday() ? t("quizDoneToday") : t("quizAside"))}
      {card("battle", t("battleTitle"), t("battleDesc"), <ShieldIcon />, t("battleLeft", { n: battlesLeft(), max: DAILY_BATTLES }))}
    </div>
  );
}

function Header({ title, onBack, aside }: { title: string; onBack: () => void; aside?: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="mb-4 flex items-center gap-3">
      <PlazaButton onClick={onBack}>← {t("activitiesBack")}</PlazaButton>
      <h2 className="flex-1 text-xl font-black text-ink">{title}</h2>
      {aside && <span className="text-xs font-bold text-muted">{aside}</span>}
    </div>
  );
}

/* ─── Expéditions ─────────────────────────────────────────────────────────────────────── */

const duration = (minutes: number, t: TFunction) => (minutes < 60 ? t("durationMinutes", { n: minutes }) : t("durationHours", { n: Math.round(minutes / 60) }));

function remaining(ms: number, t: TFunction): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes < 60) return t("durationMinutes", { n: minutes });
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`;
}

/** Expéditions : un Svgii part explorer, puis revient avec des Golds (et parfois une friandise). */
function Expeditions({ notify, onBack }: { notify: (message: string) => void; onBack: () => void }) {
  const { t } = useI18n();
  const { list } = useCollection();
  const plaza = usePlaza();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div>
      <Header title={t("tripsTitle")} onBack={onBack} aside={t("tripsHint")} />
      <div className="flex flex-col gap-2.5">
        {list.map((s) => {
          const trip = plaza.trips.find((x) => x.svgii === s.id);
          const care = careOf(s.id, plaza);
          const name = s.name || t("profileNoName");
          const hungry = fullnessOf(care, now) < TOO_HUNGRY;
          return (
            <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-surface-2 p-3">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl" style={{ background: cardBackground(s.look) }}>
                <Mascot look={s.look} equip={care.equip} size={50} animated={false} crop="head" />
              </span>
              <span className="min-w-28 flex-1">
                <span className="block font-black text-ink">{name}</span>
                <span className="block text-xs font-bold text-muted">
                  {trip ? (tripDone(trip, now) ? t("tripReady") : t("tripAway", { time: remaining(trip.start + trip.minutes * 60_000 - now, t) })) : hungry ? t("tripHungry") : t("tripIdle")}
                </span>
                {trip && !tripDone(trip, now) && (
                  <span className="mt-1.5 block max-w-64">
                    <Gauge value={((now - trip.start) / (trip.minutes * 60_000)) * 100} color="var(--accent)" />
                  </span>
                )}
              </span>
              {trip ? (
                tripDone(trip, now) && (
                  <PlazaButton
                    primary
                    onClick={() => {
                      const back = claimTrip(s.id);
                      if (!back) return;
                      sound.ready();
                      notify(back.food ? t("tripBackFood", { name, n: back.golds, food: itemName(t, back.food) }) : t("tripBack", { name, n: back.golds }));
                    }}
                  >
                    {t("tripClaim")}
                  </PlazaButton>
                )
              ) : (
                <span className="flex flex-wrap gap-1.5">
                  {TRIPS.map((kind) => (
                    <PlazaButton
                      key={kind.minutes}
                      disabled={hungry}
                      onClick={() => {
                        sound.launch();
                        startTrip(s.id, kind.minutes);
                        notify(t("tripStart", { name, time: duration(kind.minutes, t) }));
                      }}
                    >
                      {duration(kind.minutes, t)}
                      <span className="inline-flex items-center gap-0.5 text-xs text-muted">
                        <GoldIcon size={13} />
                        {kind.golds[0]}–{kind.golds[1]}
                      </span>
                    </PlazaButton>
                  ))}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Quiz ────────────────────────────────────────────────────────────────────────────── */

interface Question {
  text: string;
  options: string[];
  answer: number;
}

const shuffle = <T,>(list: T[]): T[] => {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

/** Une question : la bonne réponse et trois autres, mélangées. */
function ask(text: string, right: string, wrong: string[]): Question | null {
  const others = shuffle([...new Set(wrong.filter((w) => w !== right))]).slice(0, 3);
  if (others.length < 3) return null;
  const options = shuffle([right, ...others]);
  return { text, options, answer: options.indexOf(right) };
}

/** Le quiz se fabrique à partir de ta bibliothèque : temps de jeu, jeux installés, dernières parties. */
function makeQuiz(t: TFunction, games: Map<number, Game>, installed: Game[], stats: Activity[]): Question[] {
  const named = stats
    .map((a) => ({ ...a, name: games.get(a.appid)?.name }))
    .filter((a): a is Activity & { name: string } => !!a.name && a.playtime > 0);
  const out: (Question | null)[] = [];
  if (named.length >= 4) {
    const top = [...named].sort((a, b) => b.playtime - a.playtime);
    out.push(ask(t("quizMostPlayed"), top[0].name, top.slice(1).map((a) => a.name)));
    const recent = named.filter((a) => a.lastPlayed > 0).sort((a, b) => b.lastPlayed - a.lastPlayed);
    if (recent.length >= 4) out.push(ask(t("quizRecent"), recent[0].name, recent.slice(1).map((a) => a.name)));
    const pick = shuffle(top.filter((a) => a.playtime >= 30))[0];
    if (pick) {
      const buckets = [t("quizUnder5"), t("quiz5to20"), t("quiz20to100"), t("quizOver100")];
      const h = pick.playtime / 60;
      const answer = h < 5 ? 0 : h < 20 ? 1 : h < 100 ? 2 : 3;
      out.push({ text: t("quizHours", { game: pick.name }), options: buckets, answer });
    }
  }
  const real = installed.filter((g) => !g.builtin);
  const notInstalled = [...games.values()].filter((g) => !g.installed && !g.builtin).map((g) => g.name);
  if (real.length && notInstalled.length >= 3) {
    out.push(ask(t("quizInstalled"), shuffle(real)[0].name, notInstalled));
  }
  const sized = shuffle(real.filter((g) => g.sizeOnDisk > 0)).slice(0, 4);
  if (sized.length === 4) {
    const biggest = [...sized].sort((a, b) => b.sizeOnDisk - a.sizeOnDisk)[0];
    out.push(ask(t("quizBiggest"), biggest.name, sized.map((g) => g.name)));
  }
  return shuffle(out.filter((q): q is Question => q != null)).slice(0, 5);
}

function Quiz({ games, installed, stats, notify, onBack }: { games: Map<number, Game>; installed: Game[]; stats: Activity[]; notify: (m: string) => void; onBack: () => void }) {
  const { t } = useI18n();
  const [questions, setQuestions] = useState(() => makeQuiz(t, games, installed, stats));
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [reward, setReward] = useState<number | null>(null);
  const done = index >= questions.length;
  const q = questions[index];

  const choose = (i: number) => {
    if (picked != null) return;
    setPicked(i);
    const right = i === q.answer;
    if (right) {
      sound.ready();
      setScore((s) => s + 1);
    } else sound.error();
    window.setTimeout(() => {
      setPicked(null);
      setIndex((n) => n + 1);
    }, 1100);
  };

  useEffect(() => {
    if (!done || reward != null || !questions.length) return;
    const golds = rewardQuiz(score);
    setReward(golds);
    if (golds) notify(t("quizReward", { n: golds }));
  }, [done, reward, questions.length, score, notify, t]);

  if (questions.length < 3) {
    return (
      <div>
        <Header title={t("quizTitle")} onBack={onBack} />
        <p className="rounded-2xl bg-surface-2 p-6 text-center text-sm font-bold text-muted">{t("quizTooFew")}</p>
      </div>
    );
  }

  return (
    <div>
      <Header title={t("quizTitle")} onBack={onBack} aside={done ? undefined : t("quizProgress", { n: index + 1, total: questions.length })} />
      {done ? (
        <div className="flex flex-col items-center gap-3 rounded-[24px] bg-surface-2 p-8 text-center">
          <p className="text-3xl font-black text-ink">{t("quizScore", { n: score, total: questions.length })}</p>
          <p className="text-sm font-bold text-muted">{reward ? t("quizReward", { n: reward }) : t("quizNoReward")}</p>
          <PlazaButton
            primary
            autoFocus
            onClick={() => {
              setQuestions(makeQuiz(t, games, installed, stats));
              setIndex(0);
              setScore(0);
              setReward(null);
            }}
          >
            {t("quizAgain")}
          </PlazaButton>
        </div>
      ) : (
        <AnimatePresence mode="wait">
          <motion.div key={index} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="flex flex-col gap-4">
            <p className="rounded-[24px] bg-surface-2 p-5 text-xl font-black text-ink">{q.text}</p>
            <div data-nav-zone className="grid gap-2 sm:grid-cols-2">
              {q.options.map((option, i) => {
                const state = picked == null ? "" : i === q.answer ? "bg-[#22c55e] text-white" : i === picked ? "bg-[#ef4444] text-white" : "opacity-60";
                return (
                  <motion.button
                    key={option}
                    type="button"
                    onClick={() => choose(i)}
                    onMouseEnter={() => sound.hover()}
                    whileTap={{ scale: 0.97 }}
                    className={`rounded-2xl bg-surface-2 px-4 py-3 text-left font-extrabold text-ink outline-none transition-colors focus-visible:ring-3 focus-visible:ring-accent ${state}`}
                  >
                    {option}
                  </motion.button>
                );
              })}
            </div>
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}

/* ─── Combats ─────────────────────────────────────────────────────────────────────────── */

/** Adversaires sauvages : des Svgii de passage, au nom tiré au hasard. */
const RIVALS = ["Pépin", "Nougat", "Biscotte", "Praline", "Cachou", "Myrtille", "Chamallow", "Réglisse", "Brioche", "Caramel"];

interface Fight {
  me: Svgii;
  rival: { name: string; look: MascotLook; power: number };
  hp: [number, number];
  /** Qui frappe ce tour-ci (0 : ton Svgii, 1 : l'adversaire), et ce qu'il a infligé. */
  turn: 0 | 1;
  hit: number | null;
  over: "won" | "lost" | null;
  round: number;
}

/** Combats automatiques : ton Svgii et un rival se renvoient la balle, le plus solide l'emporte. */
function Battle({ notify, onBack }: { notify: (m: string) => void; onBack: () => void }) {
  const { t } = useI18n();
  const { list } = useCollection();
  const plaza = usePlaza();
  const [fight, setFight] = useState<Fight | null>(null);
  const rewarded = useRef(false);
  const busy = new Set(plaza.trips.map((x) => x.svgii));

  /** Force de ton Svgii : l'amitié, les accessoires et l'appétit comptent. */
  const powerOf = (s: Svgii) => {
    const care = careOf(s.id, plaza);
    return 9 + heartsOf(care) * 2 + Object.values(care.equip).filter(Boolean).length * 2 + Math.round(fullnessOf(care) / 25);
  };

  const start = (me: Svgii) => {
    sound.launch();
    rewarded.current = false;
    const rival = { name: RIVALS[Math.floor(Math.random() * RIVALS.length)], look: randomMascot(), power: 9 + Math.floor(Math.random() * 8) };
    setFight({ me, rival, hp: [100, 100], turn: Math.random() < 0.5 ? 0 : 1, hit: null, over: null, round: 0 });
  };

  // Un échange toutes les 750 ms, jusqu'à ce que l'un des deux n'ait plus de points de vie.
  useEffect(() => {
    if (!fight || fight.over) return;
    const id = window.setTimeout(() => {
      setFight((f) => {
        if (!f || f.over) return f;
        const attack = f.turn === 0 ? powerOf(f.me) : f.rival.power;
        const damage = attack + Math.floor(Math.random() * 7);
        const hp: [number, number] = [...f.hp];
        hp[f.turn === 0 ? 1 : 0] = Math.max(0, hp[f.turn === 0 ? 1 : 0] - damage);
        const over = hp[1] === 0 ? "won" : hp[0] === 0 ? "lost" : null;
        return { ...f, hp, hit: damage, over, turn: f.turn === 0 ? 1 : 0, round: f.round + 1 };
      });
      sound.move();
    }, fight.round === 0 ? 900 : 750);
    return () => window.clearTimeout(id);
    // `powerOf` lit l'état courant de la Plaza : inutile de relancer le minuteur pour lui.
  }, [fight]);

  useEffect(() => {
    if (!fight?.over || rewarded.current) return;
    rewarded.current = true;
    const won = fight.over === "won";
    if (won) sound.ready();
    else sound.error();
    const golds = rewardBattle(fight.me.id, won);
    notify(won ? t("battleWon", { name: fight.me.name || t("profileNoName"), n: golds }) : t("battleLost", { name: fight.rival.name, n: golds }));
  }, [fight, notify, t]);

  if (!fight) {
    return (
      <div>
        <Header title={t("battleTitle")} onBack={onBack} aside={t("battleLeft", { n: battlesLeft(), max: DAILY_BATTLES })} />
        <p className="mb-3 text-sm font-bold text-muted">{t("battlePick")}</p>
        <div data-nav-zone className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-3">
          {list.map((s) => {
            const away = busy.has(s.id);
            const hungry = fullnessOf(careOf(s.id, plaza)) < TOO_HUNGRY;
            return (
              <motion.button
                key={s.id}
                type="button"
                disabled={away || hungry}
                onClick={() => start(s)}
                onMouseEnter={() => sound.hover()}
                whileHover={away || hungry ? undefined : { y: -3 }}
                className="flex flex-col items-center gap-1 rounded-[22px] px-2 pb-3 pt-4 outline-none focus-visible:ring-4 focus-visible:ring-accent disabled:opacity-45"
                style={{ background: cardBackground(s.look) }}
              >
                <Mascot look={s.look} equip={careOf(s.id, plaza).equip} size={88} animated={false} />
                <span className="w-full truncate text-center text-sm font-black text-[#2d2a33]">{s.name || t("profileNoName")}</span>
                <span className="text-[11px] font-extrabold text-[#2d2a33]/70">
                  {away ? t("battleAway") : hungry ? t("tripHungry") : t("battlePower", { n: powerOf(s) })}
                </span>
              </motion.button>
            );
          })}
        </div>
      </div>
    );
  }

  const fighter = (side: 0 | 1) => {
    const look = side === 0 ? fight.me.look : fight.rival.look;
    const name = side === 0 ? fight.me.name || t("profileNoName") : fight.rival.name;
    const attacking = !fight.over && fight.round > 0 && fight.turn !== side;
    const hurt = fight.round > 0 && fight.turn === side && !fight.over;
    const lost = fight.over === (side === 0 ? "lost" : "won");
    return (
      <div className="flex flex-1 flex-col items-center gap-2">
        <p className="font-black text-ink">{name}</p>
        <div className="w-40">
          <Gauge value={fight.hp[side]} color={fight.hp[side] < 30 ? "#ef4444" : "#22c55e"} />
        </div>
        <motion.div
          key={fight.round}
          className="relative"
          animate={attacking ? { x: side === 0 ? [0, 26, 0] : [0, -26, 0] } : hurt ? { x: [0, -5, 5, -3, 0] } : { x: 0 }}
          transition={{ duration: 0.4 }}
        >
          <Mascot
            look={look}
            equip={side === 0 ? careOf(fight.me.id, plaza).equip : undefined}
            size={150}
            mood={fight.over ? (lost ? "sad" : "excited") : hurt ? "sad" : "idle"}
          />
          <AnimatePresence>
            {hurt && fight.hit != null && (
              <motion.span
                className="absolute left-1/2 top-2 -translate-x-1/2 text-2xl font-black text-[#ef4444] drop-shadow"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: -16 }}
                exit={{ opacity: 0 }}
              >
                −{fight.hit}
              </motion.span>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    );
  };

  return (
    <div>
      <Header title={t("battleTitle")} onBack={() => (fight.over ? setFight(null) : onBack())} />
      <div className="flex items-end justify-around gap-4 rounded-[24px] bg-surface-2 p-6">
        {fighter(0)}
        <span className="pb-16 text-2xl font-black text-muted">VS</span>
        {fighter(1)}
      </div>
      {fight.over && (
        <div className="mt-4 flex flex-col items-center gap-3">
          <p className="text-2xl font-black text-ink">{fight.over === "won" ? t("battleVictory") : t("battleDefeat")}</p>
          <div className="flex gap-2">
            <PlazaButton onClick={() => setFight(null)}>{t("battleOther")}</PlazaButton>
            <PlazaButton primary autoFocus onClick={() => start(fight.me)}>
              {t("battleAgain")}
            </PlazaButton>
          </div>
          <p className="text-xs font-bold text-muted">{t("battleLeft", { n: battlesLeft(), max: DAILY_BATTLES })}</p>
        </div>
      )}
    </div>
  );
}

/* ─── Pictogrammes ────────────────────────────────────────────────────────────────────── */

function CompassIcon() {
  return (
    <svg viewBox="0 0 48 48" width={34} height={34} aria-hidden>
      <circle cx="24" cy="24" r="18" fill="#e0f2ff" stroke="#4aa3ff" strokeWidth="3" />
      <path d="M24 10 L29 24 L24 38 L19 24 Z" fill="#ff6b6b" />
      <path d="M24 24 L29 24 L24 38 L19 24 Z" fill="#c9d6e3" />
      <circle cx="24" cy="24" r="2.6" fill="#2d2a33" />
    </svg>
  );
}

function QuizIcon() {
  return (
    <svg viewBox="0 0 48 48" width={34} height={34} aria-hidden>
      <path d="M8 10 h32 a4 4 0 0 1 4 4 v16 a4 4 0 0 1 -4 4 H22 l-8 7 v-7 H8 a4 4 0 0 1 -4 -4 V14 a4 4 0 0 1 4 -4 Z" fill="#fff3c4" stroke="#e0a81e" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M19.5 18.5 a4.5 4.5 0 1 1 6.5 4 c-1.6 .8 -2 1.6 -2 3" fill="none" stroke="#e0a81e" strokeWidth="3" strokeLinecap="round" />
      <circle cx="24" cy="30" r="1.8" fill="#e0a81e" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 48 48" width={34} height={34} aria-hidden>
      <path d="M24 5 L39 11 V23 C39 32 32 39 24 43 C16 39 9 32 9 23 V11 Z" fill="#ffe0e6" stroke="#ff6b9a" strokeWidth="3" strokeLinejoin="round" />
      <path d="M24 15 l2.8 5.7 6.2 .9 -4.5 4.4 1.1 6.2 -5.6 -3 -5.6 3 1.1 -6.2 -4.5 -4.4 6.2 -.9 Z" fill="#ff6b9a" />
    </svg>
  );
}
