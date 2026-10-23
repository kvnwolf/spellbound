/**
 * The Potion Slots, bottom-left beside the local Duelist's bars: the same
 * compact face-button diamond as the Spell Slots (see `slot-diamond.ts`),
 * each slot to hold a Potion's glyph and its remaining charges as a number.
 * No Potions exist yet, so all four slots are drawn empty; the Potions, their
 * charges and the spread while L2 is held come with them, since neither the
 * Intent nor the snapshot carries L2 yet.
 */
import { spellSlots } from "./duel/spell-slots";
import { create, createSlotDiamond } from "./slot-diamond";
import { text } from "./text";

export const createPotionSlotsHud = (parent: HTMLElement) => {
  const diamond = createSlotDiamond(parent, "ps-diamond");
  diamond.element.setAttribute("aria-label", text.potions);

  for (const slot of spellSlots) {
    const { badge, item } = diamond.slots[slot];
    item.dataset.state = "empty";
    create("span", "sd-count", badge);
  }

  return diamond;
};
