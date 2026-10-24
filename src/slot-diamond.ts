/**
 * Four slots laid out like the DualSense face buttons (△ top, □ left, ○
 * right, ✕ bottom), shared by the Spell Slots (bottom-right, R2) and the
 * Potion Slots (bottom-left, L2). At rest the diamond sits tight and small;
 * while its trigger is held it spreads its slots apart, grows a little and
 * shows their names, tightening back on release (eased in CSS, over
 * `--slots-spread-seconds`). Each slot is a round badge with its face button
 * tucked under it and its name, for the owner to fill.
 */
import "./slot-diamond.css";
import { buttonIcon } from "./button-icons";
import type { SpellSlot } from "./duel/spell-slots";

export interface DiamondSlot {
  readonly item: HTMLElement;
  readonly badge: HTMLElement;
  readonly name: HTMLElement;
}

export interface SlotDiamond {
  readonly element: HTMLElement;
  readonly slots: Readonly<Record<SpellSlot, DiamondSlot>>;
  /** Spreads the diamond while its trigger is held. */
  readonly held: (held: boolean) => void;
}

export const create = (tag: string, className: string, parent?: Element) => {
  const element = document.createElement(tag);
  element.className = className;
  parent?.append(element);

  return element;
};

/** Writes a data attribute only when it changes: the HUD runs every frame. */
export const setData = (element: HTMLElement, key: string, value: string) => {
  if (element.dataset[key] !== value) {
    element.dataset[key] = value;
  }
};

export const createSlotDiamond = (
  parent: HTMLElement,
  className: string
): SlotDiamond => {
  const element = create("div", `sd-diamond ${className}`, parent);

  const slot = (which: SpellSlot): DiamondSlot => {
    const item = create("div", `sd-slot sd-slot-${which}`, element);
    const badge = create("div", "sd-badge", item);
    create("span", "sd-face", item).append(buttonIcon(which));
    const name = create("span", "sd-name", item);

    return { badge, item, name };
  };

  const slots: Record<SpellSlot, DiamondSlot> = {
    circle: slot("circle"),
    cross: slot("cross"),
    square: slot("square"),
    triangle: slot("triangle"),
  };

  return {
    element,
    held: (held) => {
      setData(element, "held", String(held));
    },
    slots,
  };
};
