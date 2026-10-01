import { motion } from "framer-motion";
import { Mascot } from "../../components/Mascot";
import { useCollection } from "../../lib/mascot";
import { careOf, equipItem, usePlaza } from "../../lib/plaza";
import { ITEMS, SLOTS, type Slot } from "../../lib/svgiiItems";
import { sound } from "../../lib/sound";
import { useI18n } from "../../lib/i18n";
import { cardBackground, itemName, PlazaButton } from "./common";

const SLOT_LABELS: Record<Slot, "shopHats" | "shopEyewear" | "shopAuras"> = { hat: "shopHats", eyewear: "shopEyewear", aura: "shopAuras" };

/** Le Dressing : on choisit un Svgii, puis un accessoire par emplacement (ou aucun). */
export function DressingTab({ selected, onSelect, onShop }: { selected: string | null; onSelect: (id: string) => void; onShop: () => void }) {
  const { t } = useI18n();
  const { list, favorite } = useCollection();
  const plaza = usePlaza();
  const current = list.find((s) => s.id === selected) ?? list.find((s) => s.id === favorite) ?? list[0];
  const care = careOf(current.id, plaza);
  const ownedWear = ITEMS.filter((i) => i.kind === "wear" && plaza.owned.includes(i.id));

  const tile = (slot: Slot, id: string | null) => {
    const on = (care.equip[slot] ?? null) === id;
    return (
      <motion.button
        key={id ?? "none"}
        type="button"
        aria-pressed={on}
        onClick={() => {
          sound.move();
          equipItem(current.id, slot, id);
        }}
        onMouseEnter={() => sound.hover()}
        whileHover={{ y: -2 }}
        whileTap={{ scale: 0.94 }}
        className={`flex w-24 shrink-0 flex-col items-center gap-1 rounded-2xl bg-surface-2 p-2 outline-none focus-visible:ring-3 focus-visible:ring-accent ${on ? "ring-3 ring-accent" : ""}`}
      >
        <Mascot look={current.look} equip={id ? { [slot]: id } : {}} size={64} animated={false} crop={slot === "aura" ? "bust" : "head"} />
        <span className={`w-full truncate text-center text-[11px] font-extrabold ${on ? "text-accent" : "text-muted"}`}>{id ? itemName(t, id) : t("dressNone")}</span>
      </motion.button>
    );
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
      <div className="flex flex-col gap-3">
        <div className="grid aspect-square place-items-center rounded-[28px] shadow-soft" style={{ background: cardBackground(current.look) }}>
          <Mascot look={current.look} equip={care.equip} size={220} />
        </div>
        <div data-nav-zone className="flex flex-wrap gap-2">
          {list.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-label={s.name || t("profileNoName")}
              aria-current={s.id === current.id ? "true" : undefined}
              onClick={() => {
                sound.move();
                onSelect(s.id);
              }}
              className={`grid h-14 w-14 place-items-center rounded-2xl outline-none focus-visible:ring-3 focus-visible:ring-accent ${s.id === current.id ? "ring-3 ring-accent" : ""}`}
              style={{ background: cardBackground(s.look) }}
            >
              <Mascot look={s.look} equip={careOf(s.id, plaza).equip} size={48} animated={false} crop="head" />
            </button>
          ))}
        </div>
      </div>

      <div data-nav-zone className="flex min-w-0 flex-col gap-4">
        <h2 className="text-xl font-black text-ink">{t("dressTitle", { name: current.name || t("profileNoName") })}</h2>
        {SLOTS.map((slot) => {
          const owned = ownedWear.filter((i) => i.kind === "wear" && i.slot === slot);
          return (
            <section key={slot}>
              <p className="mb-2 text-sm font-extrabold text-muted">{t(SLOT_LABELS[slot])}</p>
              <div className="flex flex-wrap gap-2">
                {tile(slot, null)}
                {owned.map((i) => tile(slot, i.id))}
              </div>
            </section>
          );
        })}
        {!ownedWear.length && (
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-surface-2 p-4">
            <p className="text-sm font-bold text-muted">{t("dressEmpty")}</p>
            <PlazaButton primary onClick={onShop}>
              {t("plazaGoShop")}
            </PlazaButton>
          </div>
        )}
      </div>
    </div>
  );
}
