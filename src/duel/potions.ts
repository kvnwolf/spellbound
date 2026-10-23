/**
 * The Potions and the Potion Slots: the one place their bindings and charges
 * are written down, shared by the Duel simulation (which lets a Duelist drink)
 * and the HUD (which shows charges and dims a spent slot). Pure: no three.js,
 * no DOM.
 *
 * Potions sit in four Potion Slots, one per face button: while L2 is held,
 * pressing a face button drinks the Potion bound to its slot
 * (`tuning.potionSlots`). A slot can be empty.
 */
import type { Tuning } from "../tuning";
import type { SpellSlot } from "./spell-slots";

/** The Potions a Duelist can drink. */
export type PotionKind = "strength" | "swiftness" | "wiggenweld";

export const potionKinds: readonly PotionKind[] = [
  "wiggenweld",
  "strength",
  "swiftness",
];

/** The Potions whose effect lasts a while, rather than landing at once. */
export type LastingPotion = Exclude<PotionKind, "wiggenweld">;

/** The four Potion Slots sit on the same face buttons as the Spell Slots. */
export type PotionSlot = SpellSlot;

/** The Potion bound to `slot` in the tuning, or null for an empty slot. */
export const potionIn = (
  slot: PotionSlot,
  settings: Pick<Tuning, "potionSlots">
): PotionKind | null => {
  const binding: string | null = settings.potionSlots[slot];

  return potionKinds.find((kind) => kind === binding) ?? null;
};

/** Every Potion's charges as a Round starts. */
export const fullCharges = (
  settings: Pick<Tuning, "potions">
): Record<PotionKind, number> => ({
  strength: settings.potions.strength.charges,
  swiftness: settings.potions.swiftness.charges,
  wiggenweld: settings.potions.wiggenweld.charges,
});
