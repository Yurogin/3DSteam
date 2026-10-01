import { useState } from "react";
import { motion } from "framer-motion";
import { Mascot } from "../../components/Mascot";
import { useProfile } from "../../lib/mascot";
import { buy, usePlaza } from "../../lib/plaza";
import { Backdrop, FoodIcon, ITEMS, type Item, type Slot } from "../../lib/svgiiItems";
import { sound } from "../../lib/sound";
import { useI18n } from "../../lib/i18n";
import { cardBackground, Golds, itemName, PlazaButton } from "./common";

type Category = Slot | "food" | "backdrop";
const CATEGORIES: { id: Category; label: "shopHats" | "shopEyewear" | "shopAuras" | "shopFood" | "shopBackdrops" }[] = [
  { id: "hat", label: "shopHats" },
  { id: "eyewear", label: "shopEyewear" },
  { id: "aura", label: "shopAuras" },
  { id: "food", label: "shopFood" },
  { id: "backdrop", label: "shopBackdrops" },
];

const inCategory = (item: Item, category: Category) =>
  item.kind === "wear" ? item.slot === category : item.kind === category;

/** La Svgii Shop : on y dépense les Golds gagnés en jouant. Chaque accessoire s'essaie sur ton favori. */
export function ShopTab({ notify }: { notify: (message: string) => void }) {
  const { t } = useI18n();
  const plaza = usePlaza();
  const me = useProfile();
  const [category, setCategory] = useState<Category>("hat");
  const items = ITEMS.filter((i) => inCategory(i, category) && i.price > 0);

  const purchase = (item: Item) => {
    const result = buy(item.id);
    if (result === "bought") {
      sound.ready();
      notify(t("shopBought", { item: itemName(t, item.id) }));
    } else if (result === "poor") {
      sound.error();
      notify(t("shopPoor", { n: item.price - plaza.golds }));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div data-nav-zone className="flex flex-wrap gap-1.5 rounded-full bg-surface-2 p-1.5 self-start">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-current={category === c.id ? "true" : undefined}
            onClick={() => {
              if (category !== c.id) sound.move();
              setCategory(c.id);
            }}
            className={`rounded-full px-3.5 py-1.5 text-sm font-extrabold outline-none focus-visible:ring-3 focus-visible:ring-accent ${
              category === c.id ? "bg-surface text-accent shadow-soft" : "text-muted hover:text-ink"
            }`}
          >
            {t(c.label)}
          </button>
        ))}
      </div>

      <div data-nav-zone className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
        {items.map((item) => {
          const owned = item.kind !== "food" && plaza.owned.includes(item.id);
          const stock = item.kind === "food" ? (plaza.pantry[item.id] ?? 0) : 0;
          return (
            <motion.div key={item.id} layout className="flex flex-col items-center gap-2 rounded-[22px] bg-surface-2 p-3">
              <div
                // Les chapeaux dépassent par le haut : le Svgii est posé en bas de la vignette.
                className={`relative grid h-32 w-full overflow-hidden rounded-2xl ${item.kind === "wear" ? "items-end justify-items-center" : "place-items-center"}`}
                style={item.kind === "wear" ? { background: cardBackground(me.mascot) } : undefined}
              >
                {item.kind === "wear" && <Mascot look={me.mascot} equip={{ [item.slot]: item.id }} size={item.slot === "aura" ? 112 : 96} animated={false} crop={item.slot === "aura" ? "bust" : "head"} />}
                {item.kind === "food" && <FoodIcon id={item.id} size={72} />}
                {item.kind === "backdrop" && <Backdrop id={item.id} />}
              </div>
              <p className="w-full truncate text-center text-sm font-black text-ink">{itemName(t, item.id)}</p>
              {item.kind === "food" && (
                <p className="text-[11px] font-bold text-muted">{t("shopFoodInfo", { n: item.fullness, stock })}</p>
              )}
              {owned ? (
                <span className="rounded-full bg-surface px-4 py-2 text-sm font-extrabold text-muted">{t("shopOwned")}</span>
              ) : (
                <PlazaButton primary disabled={plaza.golds < item.price} onClick={() => purchase(item)}>
                  <Golds value={item.price} />
                </PlazaButton>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
