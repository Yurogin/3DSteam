import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Mascot } from "../../components/Mascot";
import { encodeSvgii, useCollection, type Mood, type Svgii } from "../../lib/mascot";
import { careOf, feed, fullnessOf, heartsOf, setBackdrop, talk, usePlaza } from "../../lib/plaza";
import { Backdrop, FoodIcon, itemById, ITEMS } from "../../lib/svgiiItems";
import { sound } from "../../lib/sound";
import { useI18n, type TFunction } from "../../lib/i18n";
import { Bubble, cardBackground, Gauge, Hearts, itemName, PlazaButton, PlazaDialog, Stroller } from "./common";

const GENERIC_LINES = ["talkHello1", "talkHello2", "talkHello3", "talkHello4", "talkHello5", "talkHello6"] as const;

/** Ce que dit un Svgii : selon son appétit, votre amitié, ou le dernier jeu lancé. */
function lineFor(svgii: Svgii, t: TFunction, recentGame: string | null): string {
  const care = careOf(svgii.id);
  const fullness = fullnessOf(care);
  const options: string[] = [];
  if (fullness < 30) return t("talkHungry");
  if (fullness > 85) options.push(t("talkFull"));
  if (recentGame) options.push(t("talkGame", { game: recentGame }));
  if (heartsOf(care) >= 3) options.push(t("talkFriend"));
  if (svgii.received) options.push(t("talkReceived"));
  options.push(...GENERIC_LINES.map((k) => t(k)));
  return options[Math.floor(Math.random() * options.length)];
}

const moodOf = (id: string): Mood => (fullnessOf(careOf(id)) < 25 ? "sad" : "idle");

interface Props {
  /** Svgii dont le menu est ouvert (la page s'en sert pour que Ⓑ le referme d'abord). */
  menu: string | null;
  onMenu: (id: string | null) => void;
  onDress: (id: string) => void;
  onShop: () => void;
  notify: (message: string) => void;
  /** Dernier jeu lancé, pour la conversation. */
  recentGame: string | null;
}

/** La Place : tous tes Svgii s'y promènent, sauf ceux partis en expédition. */
export function PlaceTab({ menu, onMenu, onDress, onShop, notify, recentGame }: Props) {
  const { t } = useI18n();
  const { list } = useCollection();
  const plaza = usePlaza();
  const [speech, setSpeech] = useState<{ id: string; text: string } | null>(null);
  const away = new Set(plaza.trips.map((trip) => trip.svgii));
  const here = list.filter((s) => !away.has(s.id));
  const opened = menu ? list.find((s) => s.id === menu) : undefined;
  const backdrops = ITEMS.filter((i) => i.kind === "backdrop" && plaza.owned.includes(i.id));

  useEffect(() => {
    if (!speech) return;
    const id = window.setTimeout(() => setSpeech(null), 3200);
    return () => window.clearTimeout(id);
  }, [speech]);

  const say = (svgii: Svgii) => {
    talk(svgii.id);
    setSpeech({ id: svgii.id, text: lineFor(svgii, t, recentGame) });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* `isolate` : la profondeur des Svgii (z-index) reste dans la scène, sous les fenêtres. */}
      <div className="relative isolate aspect-[16/7] min-h-[300px] w-full overflow-hidden rounded-[24px] shadow-soft ring-4 ring-surface-2">
        <Backdrop id={plaza.backdrop} />
        {here.map((s) => (
          <Stroller
            key={s.id}
            look={s.look}
            equip={careOf(s.id).equip}
            name={s.name || t("profileNoName")}
            mood={speech?.id === s.id ? "happy" : moodOf(s.id)}
            bubble={speech?.id === s.id ? <Bubble key="speech" text={speech.text} /> : null}
            onPick={() => {
              sound.select();
              onMenu(s.id);
            }}
          />
        ))}
        {!here.length && (
          <p className="absolute inset-x-0 bottom-4 mx-auto w-max rounded-full bg-surface/90 px-4 py-2 text-sm font-bold text-muted shadow-soft">{t("plazaEmpty")}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-sm font-extrabold text-muted">{t("plazaBackdrop")}</span>
        {backdrops.map((b) => (
          <motion.button
            key={b.id}
            type="button"
            aria-pressed={plaza.backdrop === b.id}
            title={itemName(t, b.id)}
            onClick={() => {
              sound.move();
              setBackdrop(b.id);
            }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className={`relative h-12 w-24 overflow-hidden rounded-xl shadow-soft outline-none focus-visible:ring-3 focus-visible:ring-accent ${plaza.backdrop === b.id ? "ring-3 ring-accent" : ""}`}
          >
            <Backdrop id={b.id} />
          </motion.button>
        ))}
        {plaza.trips.length > 0 && (
          <span className="ml-auto text-xs font-bold text-muted">{t("plazaAwayCount", { n: plaza.trips.length })}</span>
        )}
      </div>

      <AnimatePresence>
        {opened && (
          <SvgiiMenu
            key={opened.id}
            svgii={opened}
            onClose={() => onMenu(null)}
            onTalk={() => {
              say(opened);
              onMenu(null);
            }}
            onDress={() => onDress(opened.id)}
            onShop={onShop}
            notify={notify}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/** Le menu d'un Svgii : le nourrir, lui parler, l'habiller, ou feuilleter son passeport. */
function SvgiiMenu({
  svgii,
  onClose,
  onTalk,
  onDress,
  onShop,
  notify,
}: {
  svgii: Svgii;
  onClose: () => void;
  onTalk: () => void;
  onDress: () => void;
  onShop: () => void;
  notify: (message: string) => void;
}) {
  const { t, locale } = useI18n();
  const plaza = usePlaza();
  const [mode, setMode] = useState<"main" | "feed" | "passport">("main");
  const [hop, setHop] = useState(0);
  const care = careOf(svgii.id, plaza);
  const fullness = fullnessOf(care);
  const name = svgii.name || t("profileNoName");
  const foods = Object.entries(plaza.pantry).filter(([, n]) => n > 0);

  return (
    <PlazaDialog label={name} onClose={onClose}>
      <div className="flex items-center gap-4">
        <div className="grid h-32 w-32 shrink-0 place-items-center rounded-[24px]" style={{ background: cardBackground(svgii.look) }}>
          <Mascot look={svgii.look} equip={care.equip} size={112} mood={hop ? "happy" : fullness < 25 ? "sad" : "idle"} bounce={hop} />
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <h2 className="truncate text-2xl font-black text-ink">{name}</h2>
          <div>
            <p className="mb-1 flex justify-between text-xs font-extrabold text-muted">
              <span>{t("plazaHunger")}</span>
              <span>{Math.round(fullness)} %</span>
            </p>
            <Gauge value={fullness} color={fullness < 25 ? "#ef4444" : fullness < 55 ? "#f59e0b" : "#22c55e"} />
          </div>
          <p className="flex items-center justify-between text-xs font-extrabold text-muted">
            <span>{t("plazaFriendship")}</span>
            <Hearts n={heartsOf(care)} />
          </p>
        </div>
      </div>

      {mode === "main" && (
        <div className="grid grid-cols-2 gap-2">
          <PlazaButton primary autoFocus onClick={() => setMode("feed")}>
            {t("plazaFeed")}
          </PlazaButton>
          <PlazaButton onClick={onTalk}>{t("plazaTalk")}</PlazaButton>
          <PlazaButton onClick={onDress}>{t("plazaDress")}</PlazaButton>
          <PlazaButton onClick={() => setMode("passport")}>{t("plazaPassport")}</PlazaButton>
        </div>
      )}

      {mode === "feed" && (
        <div className="flex flex-col gap-3">
          {foods.length ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
              {foods.map(([id, n]) => {
                const item = itemById(id);
                return (
                  <motion.button
                    key={id}
                    type="button"
                    onClick={() => {
                      if (!feed(svgii.id, id)) return;
                      sound.ready();
                      setHop((h) => h + 1);
                      notify(t("plazaFed", { name, food: itemName(t, id) }));
                    }}
                    onMouseEnter={() => sound.hover()}
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.94 }}
                    className="flex flex-col items-center gap-0.5 rounded-2xl bg-surface-2 p-2 outline-none focus-visible:ring-3 focus-visible:ring-accent"
                  >
                    <FoodIcon id={id} size={44} />
                    <span className="text-xs font-black text-ink">{itemName(t, id)}</span>
                    <span className="text-[11px] font-bold text-muted">
                      ×{n} · +{item?.kind === "food" ? item.fullness : 0}
                    </span>
                  </motion.button>
                );
              })}
            </div>
          ) : (
            <p className="rounded-2xl bg-surface-2 p-4 text-center text-sm font-bold text-muted">{t("plazaNoFood")}</p>
          )}
          <div className="flex justify-between gap-2">
            <PlazaButton onClick={() => setMode("main")}>{t("plazaBackShort")}</PlazaButton>
            <PlazaButton onClick={onShop}>{t("plazaGoShop")}</PlazaButton>
          </div>
        </div>
      )}

      {mode === "passport" && (
        <div className="flex flex-col gap-3">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-2xl bg-surface-2 p-4 text-sm">
            <dt className="font-extrabold text-muted">{t("passportOrigin")}</dt>
            <dd className="font-bold text-ink">{svgii.received ? t("passportReceived") : t("passportMade")}</dd>
            <dt className="font-extrabold text-muted">{t("passportArrived")}</dt>
            <dd className="font-bold text-ink">{new Date(care.arrivedAt).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" })}</dd>
            <dt className="font-extrabold text-muted">{t("passportMeals")}</dt>
            <dd className="font-bold text-ink">{care.meals}</dd>
            <dt className="font-extrabold text-muted">{t("passportTrips")}</dt>
            <dd className="font-bold text-ink">{care.trips}</dd>
            <dt className="font-extrabold text-muted">{t("passportCode")}</dt>
            <dd className="break-all font-mono text-xs font-bold text-ink">{encodeSvgii(svgii.name, svgii.look)}</dd>
          </dl>
          <PlazaButton onClick={() => setMode("main")}>{t("plazaBackShort")}</PlazaButton>
        </div>
      )}

      <button type="button" onClick={onClose} className="self-end rounded-full px-4 py-2 text-sm font-extrabold text-muted hover:bg-surface-2">
        {t("closeEsc")}
      </button>
    </PlazaDialog>
  );
}
