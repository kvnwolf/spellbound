/**
 * The Potions and the Potion Slots: the one place their bindings and charges
 * are written down, shared by the Duel simulation (which lets a Duelist drink)
 * and the HUD (which shows charges and dims a spent slot). Pure: no three.js,
 * no DOM.
 *
 * Potions sit in four Potion Slots, one per D-pad arrow: while L2 is held,
 * pressing an arrow drinks the Potion bound to its slot
 * (`tuning.potionSlots`). A slot can be empty.
 */
import type { Tuning } from "../tuning";

/** The Potions a Duelist can drink. */
export type PotionKind = "felix" | "strength" | "swiftness" | "wiggenweld";

export const potionKinds: readonly PotionKind[] = [
  "wiggenweld",
  "strength",
  "swiftness",
  "felix",
];

/**
 * The Potions whose effect lasts a while, rather than landing at once as
 * Wiggenweld's Health and Felix Felicis's Focus do.
 */
export type LastingPotion = Exclude<PotionKind, "felix" | "wiggenweld">;

/** The four Potion Slots, one per D-pad arrow, in the order the Controls list them. */
export const potionSlots = ["up", "left", "right", "down"] as const;

export type PotionSlot = (typeof potionSlots)[number];

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
  felix: settings.potions.felix.charges,
  strength: settings.potions.strength.charges,
  swiftness: settings.potions.swiftness.charges,
  wiggenweld: settings.potions.wiggenweld.charges,
});
