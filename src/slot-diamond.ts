/**
 * Four slots laid out in a diamond, like the DualSense face buttons (△ top,
 * □ left, ○ right, ✕ bottom) or its D-pad (↑ ← → ↓), shared by the Spell
 * Slots (bottom-right, R2 and the face buttons) and the Potion Slots
 * (bottom-left, L2 and the D-pad). At rest the diamond sits tight and small;
 * while its trigger is held it spreads its slots apart, grows a little and
 * shows their names, tightening back on release (eased in CSS, over
 * `--slots-spread-seconds`). Each slot is a round badge with its button
 * tucked under it and its name, for the owner to fill.
 */
import "./slot-diamond.css";
import { buttonIcon } from "./button-icons";
import type { IconButton } from "./button-icons";

/** Which button sits at each point of a diamond. */
export interface DiamondLayout<Button extends IconButton> {
  readonly top: Button;
  readonly left: Button;
  readonly right: Button;
  readonly bottom: Button;
}

/** The face buttons' diamond, the Spell Slots'. */
export const faceDiamond = {
  bottom: "cross",
  left: "square",
  right: "circle",
  top: "triangle",
} as const satisfies DiamondLayout<IconButton>;

/** The D-pad's diamond, the Potion Slots'. */
export const dpadDiamond = {
  bottom: "down",
  left: "left",
  right: "right",
  top: "up",
} as const satisfies DiamondLayout<IconButton>;

export interface DiamondSlot {
  readonly item: HTMLElement;
  readonly badge: HTMLElement;
  readonly name: HTMLElement;
}

export interface SlotDiamond<Button extends IconButton> {
  readonly element: HTMLElement;
  /** The slot under `button`. */
  readonly slot: (button: Button) => DiamondSlot;
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

export const createSlotDiamond = <Button extends IconButton>(
  parent: HTMLElement,
  className: string,
  layout: DiamondLayout<Button>
): SlotDiamond<Button> => {
  const element = create("div", `sd-diamond ${className}`, parent);

  const at = (point: keyof DiamondLayout<Button>): DiamondSlot => {
    const item = create("div", `sd-slot sd-at-${point}`, element);
    const badge = create("div", "sd-badge", item);
    create("span", "sd-face", item).append(buttonIcon(layout[point]));
    const name = create("span", "sd-name", item);

    return { badge, item, name };
  };

  const slots = {
    bottom: at("bottom"),
    left: at("left"),
    right: at("right"),
    top: at("top"),
  };

  const points = ["top", "left", "right", "bottom"] as const;

  return {
    element,
    held: (held) => {
      setData(element, "held", String(held));
    },
    slot: (button) =>
      slots[points.find((point) => layout[point] === button) ?? "top"],
  };
};
