/**
 * The Potions' part of the Duel HUD, bottom-left beside the local Duelist's
 * bars: the four Potion Slots as the same compact face-button diamond as the
 * Spell Slots (see `slot-diamond.ts`), each with its Potion's vial in the
 * Potion's colour and its charges left as a number. While L2 is held the
 * diamond spreads apart, shows the names and lights up the slots that can be
 * drunk, inside a frame sized for the spread so the bars beside it never
 * move. A spent slot dims; the empty ✕ slot is a dashed ring; the Potion
 * being drunk fills its slot as it goes down. Over the bars, a small icon
 * per active effect (Strength, Swiftness) counts its seconds down. Reads the
 * local Duelist's snapshot and only touches the DOM when what it shows changes.
 */
import "./potion-slots-hud.css";
import type { DuelistId, DuelistState, DuelSnapshot } from "./duel/duel";
import { potionIn } from "./duel/potions";
import type { LastingPotion, PotionKind, PotionSlot } from "./duel/potions";
import { spellSlots } from "./duel/spell-slots";
import { create, createSlotDiamond, setData } from "./slot-diamond";
import type { DiamondSlot } from "./slot-diamond";
import { text } from "./text";
import type { Tuning } from "./tuning";

type PotionHudSettings = Pick<Tuning, "potionSlots" | "potions">;

export interface PotionSlotsHud {
  readonly show: (snapshot: DuelSnapshot) => void;
}

const svgNs = "http://www.w3.org/2000/svg";

/** A round-bottomed flask, the same for every Potion... */
const flask =
  "M10 3h4M10.5 3v5.2L6 15.5a4.2 4.2 0 0 0 3.6 6.3h4.8a4.2 4.2 0 0 0 3.6-6.3l-4.5-7.3V3";

/** ...with its own mark on the liquid: a cross that heals, a bolt of strength, a rush of speed. */
const marks: Record<PotionKind, string> = {
  strength: "M12.8 12.5 10.9 16h2.4l-1.9 3.4",
  swiftness: "M9.6 14.6 11.4 16.4 9.6 18.2M12.6 14.6l1.8 1.8-1.8 1.8",
  wiggenweld: "M12 14.2v4.4M9.8 16.4h4.4",
};

const vial = (kind: PotionKind, parent: Element, className: string) => {
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.classList.add(className);

  for (const d of [flask, marks[kind]]) {
    const path = document.createElementNS(svgNs, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }

  parent.append(svg);
};

const setVar = (element: HTMLElement, name: string, value: string) => {
  if (element.style.getPropertyValue(name) !== value) {
    element.style.setProperty(name, value);
  }
};

const setText = (element: HTMLElement, value: string) => {
  if (element.textContent !== value) {
    element.textContent = value;
  }
};

/** What a Potion Slot shows: drinking from it, ready, spent, or empty. */
const stateOf = (kind: PotionKind | null, self: DuelistState) => {
  if (kind === null) {
    return "empty";
  }

  if (self.drinking?.kind === kind) {
    return "drinking";
  }

  return self.potions[kind] > 0 ? "ready" : "spent";
};

/** One Potion Slot: its Potion (or none), its charges and how far it is drunk. */
const createSlot = (
  { badge, item, name }: DiamondSlot,
  slot: PotionSlot,
  settings: PotionHudSettings
) => {
  const kind = potionIn(slot, settings);
  const count = create("span", "sd-count", badge);

  if (kind) {
    vial(kind, badge, "ps-glyph");
    item.dataset.potion = kind;
    name.textContent = text.potions[kind];
  }

  return {
    show: (self: DuelistState) => {
      setData(item, "state", stateOf(kind, self));
      setText(count, kind ? String(self.potions[kind]) : "");

      const drunk =
        kind && self.drinking?.kind === kind
          ? 1 - self.drinking.secondsLeft / settings.potions.drink.seconds
          : 0;

      setVar(item, "--drunk", drunk.toFixed(3));
    },
  };
};

const lasting: readonly LastingPotion[] = ["strength", "swiftness"];

/** The active effects over the bars: an icon per lasting Potion, counting its seconds down. */
const createEffects = (parent: HTMLElement, settings: PotionHudSettings) => {
  const root = create("div", "ps-effects", parent);

  const effects = lasting.map((kind) => {
    const item = create("div", "ps-effect", root);
    item.dataset.potion = kind;
    item.setAttribute("aria-label", text.potions[kind]);
    vial(kind, item, "ps-effect-glyph");
    const seconds = create("span", "ps-effect-seconds", item);

    return { item, kind, seconds };
  });

  return {
    show: (self: DuelistState) => {
      for (const { item, kind, seconds } of effects) {
        const left = self.potionEffects[kind];
        item.hidden = left <= 0;
        setText(seconds, left > 0 ? String(Math.ceil(left)) : "");
        setVar(
          item,
          "--left",
          (left / settings.potions[kind].seconds).toFixed(3)
        );
      }
    },
  };
};

export const createPotionSlotsHud = (
  vitals: HTMLElement,
  bars: HTMLElement,
  localId: DuelistId,
  settings: PotionHudSettings
): PotionSlotsHud => {
  // A frame as big as the spread diamond, so spreading never moves the bars.
  const frame = create("div", "ps-frame");
  vitals.prepend(frame);
  const diamond = createSlotDiamond(frame, "ps-diamond");
  diamond.element.setAttribute("aria-label", text.potions.label);

  const slots = spellSlots.map((slot) =>
    createSlot(diamond.slots[slot], slot, settings)
  );

  const effects = createEffects(bars, settings);

  return {
    show: (snapshot) => {
      const self = snapshot.duelists.find((each) => each.id === localId);

      if (!self) {
        return;
      }

      diamond.held(self.potionSlotsHeld);
      effects.show(self);

      for (const slot of slots) {
        slot.show(self);
      }
    },
  };
};
