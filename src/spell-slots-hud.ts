/**
 * The Special Spells' part of the Duel HUD, bottom-right: the four Spell
 * Slots as a compact diamond laid out like the face buttons (see
 * `slot-diamond.ts`), each with its Special Spell's glyph in the Spell's
 * colour and a dark radial Cooldown that uncovers as it recovers, and to its
 * right the three Focus orbs. While R2 is held the diamond spreads apart and
 * shows the names. A slot dims while its Special Spell cannot be cast (short
 * of Focus, or cooling down); ○ is shown locked, kept for Expelliarmus, and
 * an empty slot is a dashed ring. Reads the local Duelist's snapshot and only
 * touches the DOM when what it shows changes.
 */
import "./spell-slots-hud.css";
import type { DuelistId, DuelistState, DuelSnapshot } from "./duel/duel";
import { boundTo, readiness, spellSlots } from "./duel/spell-slots";
import type { SpecialSpellKind, SpellSlot } from "./duel/spell-slots";
import { create, createSlotDiamond, setData } from "./slot-diamond";
import type { DiamondSlot } from "./slot-diamond";
import { text } from "./text";
import type { Tuning } from "./tuning";

type SpellSlotsHudSettings = Pick<
  Tuning,
  "depulso" | "focus" | "incendio" | "petrificus" | "spellSlots"
>;

export interface SpellSlotsHud {
  readonly show: (snapshot: DuelSnapshot) => void;
}

const svgNs = "http://www.w3.org/2000/svg";

/** ○ is kept for Expelliarmus, which is not in the game yet: shown locked. */
const reservedSlot: SpellSlot = "circle";

/** Small line glyphs: a gust fanning out, a flame, a frozen crystal, a wand flying off (locked). */
const glyphs: Record<SpecialSpellKind | "locked", string> = {
  depulso: "M3 12h5m-5 0 3-3m-3 3 3 3M11 7c3 1 3 9 0 10m4-13c5 2 5 14 0 16",
  incendio:
    "M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-7 0 2 1 3 2 3 0-3-1-5 1-8Z",
  locked: "M5 19 17 7m-2-3 5 5M4 20l2-2",
  petrificus: "M12 2 20 7v10l-8 5-8-5V7l8-5Zm0 0v20M4 7l16 10M20 7 4 17",
};

const glyph = (kind: SpecialSpellKind | "locked", parent: Element) => {
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.classList.add("ss-glyph");
  const path = document.createElementNS(svgNs, "path");
  path.setAttribute("d", glyphs[kind]);
  svg.append(path);
  parent.append(svg);
};

const setVar = (element: HTMLElement, name: string, value: string) => {
  if (element.style.getPropertyValue(name) !== value) {
    element.style.setProperty(name, value);
  }
};

/** Three orbs of Focus, each filling in turn and glowing once whole. */
const createFocusOrbs = (
  parent: HTMLElement,
  settings: SpellSlotsHudSettings
) => {
  const root = create("div", "ss-focus", parent);
  root.setAttribute("aria-label", text.specials.focus);
  const count = Math.round(settings.focus.max / settings.focus.segment);

  // Bottom to top, so the meter fills upward.
  const orbs = Array.from({ length: count }, () =>
    create("div", "ss-orb", root)
  );

  return {
    show: (focus: number) => {
      for (const [index, orb] of orbs.entries()) {
        const share = Math.min(
          Math.max(focus / settings.focus.segment - index, 0),
          1
        );

        setVar(orb, "--fill", share.toFixed(3));
        setData(orb, "full", String(share >= 1));
      }
    },
  };
};

/** One Spell Slot: its Special Spell (or none) and its Cooldown sweep. */
const createSlot = (
  { badge, item, name }: DiamondSlot,
  slot: SpellSlot,
  settings: SpellSlotsHudSettings
) => {
  const kind = boundTo(slot, settings);
  const reserved = kind === null && slot === reservedSlot;

  if (kind) {
    glyph(kind, badge);
    item.dataset.spell = kind;
    name.textContent = text.specials[kind];
  } else if (reserved) {
    glyph("locked", badge);
    name.textContent = text.specials.expelliarmus;
    item.title = text.specials.locked;
  }

  const timer = create("span", "ss-timer", badge);
  const empty = reserved ? "locked" : "empty";

  return {
    show: (self: DuelistState) => {
      setData(item, "state", kind ? readiness(kind, self, settings) : empty);

      const left = kind ? self.cooldowns[kind] : 0;
      const share = kind ? left / settings[kind].cooldownSeconds : 0;
      setVar(item, "--cooldown", share.toFixed(3));

      const seconds = left > 0 ? String(Math.ceil(left)) : "";

      if (timer.textContent !== seconds) {
        timer.textContent = seconds;
      }
    },
  };
};

export const createSpellSlotsHud = (
  root: HTMLElement,
  localId: DuelistId,
  settings: SpellSlotsHudSettings
): SpellSlotsHud => {
  const panel = create("div", "ss-panel", root);
  const diamond = createSlotDiamond(panel, "ss-diamond");
  const focus = createFocusOrbs(panel, settings);

  const slots = spellSlots.map((slot) =>
    createSlot(diamond.slots[slot], slot, settings)
  );

  return {
    show: (snapshot) => {
      const self = snapshot.duelists.find((each) => each.id === localId);

      if (!self) {
        return;
      }

      diamond.held(self.spellSlotsHeld);
      focus.show(self.focus);

      for (const slot of slots) {
        slot.show(self);
      }
    },
  };
};
