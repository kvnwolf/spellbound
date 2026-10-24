/**
 * The Controls screen's own content, drawn from its `ScreenView`: the tab
 * bar (L1 and R1 at its ends) and the open tab. Controles is a DualSense
 * drawn here as hairline gold on ink (our own drawing, not Sony's artwork)
 * with every control's label on a leader line, between the Potion Slots
 * (L2) and the Spell Slots (R2) laid out as the HUD's slot diamonds, held
 * open. Mecánicas is a grid of short cards.
 */
import "./controls-help.css";
import { buttonIcon, writeWithIcons } from "./button-icons";
import type { FaceButton } from "./button-icons";
import { potionVial } from "./potion-slots-hud";
import type {
  ControlLabel,
  ControlsHelp,
  PadControl,
  ScreenView,
  SlotsLabel,
} from "./screens/view";
import { create, createSlotDiamond } from "./slot-diamond";
import { specialGlyph } from "./spell-slots-hud";
import { text } from "./text";

const svgNs = "http://www.w3.org/2000/svg";

/** The drawing's coordinate space: the pad in the middle, a label column each side. */
const width = 1100;
const height = 440;

const svg = <K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, number | string>,
  parent?: Element
): SVGElementTagNameMap[K] => {
  const element = document.createElementNS(svgNs, tag);

  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, String(value));
  }

  parent?.append(element);

  return element;
};

/** The body: a top bar round the touchpad and two grips. */
const bodyPath =
  "M395 92C450 84 650 84 705 92C750 98 772 120 782 160L822 318C834 368 798 398 762 384C740 376 726 356 712 336C690 304 662 292 630 292H470C438 292 410 304 388 336C374 356 360 376 338 384C302 398 266 368 278 318L318 160C328 120 350 98 395 92Z";

const touchpadPath = "M462 93H638L633 176Q631 188 619 188H481Q469 188 467 176Z";

/** The face buttons' centres, as on the pad: △ top, □ left, ○ right, ✕ bottom. */
const faceButtons: Record<FaceButton, readonly [number, number]> = {
  circle: [756, 172],
  cross: [720, 208],
  square: [684, 172],
  triangle: [720, 136],
};

const faceOrder: readonly FaceButton[] = [
  "triangle",
  "square",
  "circle",
  "cross",
];

const sticks = [
  [460, 250],
  [640, 250],
] as const;

/** The shoulder buttons: L2 and R2 behind, L1 and R1 in front. */
const shoulders = [
  ["l2", { h: 18, w: 72, x: 358, y: 50 }],
  ["r2", { h: 18, w: 72, x: 670, y: 50 }],
  ["l1", { h: 14, w: 92, x: 348, y: 72 }],
  ["r1", { h: 14, w: 92, x: 660, y: 72 }],
] as const;

/** The shoulder buttons' and R3's printed names, by control. */
const triggerNames: ReadonlyMap<string, string> = new Map(
  Object.entries(text.controls.triggers)
);

/** Where each control's leader line runs from the pad, and where its label hangs. */
interface Callout {
  readonly line: readonly (readonly [number, number])[];
  readonly at: readonly [number, number];
  /** right: ends at `at`; left: starts at it; below / above: centred under or over it. */
  readonly align: "above" | "below" | "left" | "right";
}

const callouts: Partial<Record<PadControl, Callout>> = {
  circle: {
    align: "left",
    at: [850, 212],
    line: [
      [772, 172],
      [806, 212],
      [842, 212],
    ],
  },
  cross: {
    align: "left",
    at: [850, 252],
    line: [
      [736, 208],
      [806, 252],
      [842, 252],
    ],
  },
  l1: {
    align: "right",
    at: [250, 110],
    line: [
      [348, 79],
      [318, 110],
      [258, 110],
    ],
  },
  l2: {
    align: "right",
    at: [250, 59],
    line: [
      [358, 59],
      [258, 59],
    ],
  },
  leftStick: {
    align: "below",
    at: [460, 318],
    line: [
      [460, 280],
      [460, 312],
    ],
  },
  options: {
    align: "above",
    at: [654, 24],
    line: [
      [654, 96],
      [654, 30],
    ],
  },
  r1: {
    align: "left",
    at: [850, 110],
    line: [
      [752, 79],
      [782, 110],
      [842, 110],
    ],
  },
  r2: {
    align: "left",
    at: [850, 59],
    line: [
      [742, 59],
      [842, 59],
    ],
  },
  rightStick: {
    align: "below",
    at: [640, 318],
    line: [
      [640, 280],
      [640, 312],
    ],
  },
  square: {
    align: "left",
    at: [850, 292],
    line: [
      [684, 188],
      [684, 292],
      [842, 292],
    ],
  },
  triangle: {
    align: "left",
    at: [850, 140],
    line: [
      [736, 136],
      [806, 140],
      [842, 140],
    ],
  },
};

/** A control whose label stacks under another's, as R3's under the right stick's. */
const stacksUnder: Partial<Record<PadControl, PadControl>> = {
  r3: "rightStick",
};

const isFace = (control: PadControl): control is FaceButton =>
  control in faceButtons;

/** The pad itself, every control drawn, and its leader lines. */
const drawPad = (parent: Element, labelled: ReadonlySet<PadControl>) => {
  const root = svg(
    "svg",
    { class: "ch-drawing", viewBox: `0 0 ${width} ${height}` },
    parent
  );

  root.setAttribute("aria-hidden", "true");

  for (const [name, { h, w, x, y }] of shoulders) {
    svg(
      "rect",
      { class: "ch-part", height: h, rx: h / 2, width: w, x, y },
      root
    );

    const tag = svg(
      "text",
      { class: "ch-tag", x: x + w / 2, y: y + h / 2 },
      root
    );

    tag.textContent = text.controls.triggers[name];
  }

  svg("path", { class: "ch-body", d: bodyPath }, root);
  svg("path", { class: "ch-part ch-touchpad", d: touchpadPath }, root);

  // The D-pad: drawn, but it only moves through menus.
  const dpad = svg("g", { class: "ch-part ch-quiet" }, root);

  for (const [x, y, w, h] of [
    [371, 140, 18, 24],
    [371, 180, 18, 24],
    [344, 163, 24, 18],
    [392, 163, 24, 18],
  ] as const) {
    svg("rect", { height: h, rx: 4, width: w, x, y }, dpad);
  }

  // Create (unbound) and Options, either side of the touchpad.
  svg(
    "rect",
    { class: "ch-part ch-quiet", height: 20, rx: 4, width: 10, x: 441, y: 96 },
    root
  );
  svg(
    "rect",
    { class: "ch-part", height: 20, rx: 4, width: 10, x: 649, y: 96 },
    root
  );
  // The PS button and the mute button.
  svg("circle", { class: "ch-part ch-quiet", cx: 550, cy: 256, r: 9 }, root);
  svg(
    "rect",
    { class: "ch-part ch-quiet", height: 6, rx: 3, width: 24, x: 538, y: 276 },
    root
  );

  for (const [x, y] of sticks) {
    svg("circle", { class: "ch-part", cx: x, cy: y, r: 30 }, root);
    svg("circle", { class: "ch-part ch-cap", cx: x, cy: y, r: 21 }, root);
  }

  for (const button of faceOrder) {
    const [x, y] = faceButtons[button];
    svg("circle", { class: "ch-part ch-face", cx: x, cy: y, r: 16 }, root);
    const icon = buttonIcon(button);

    for (const [name, value] of Object.entries({
      height: 20,
      width: 20,
      x: x - 10,
      y: y - 10,
    })) {
      icon.setAttribute(name, String(value));
    }

    icon.removeAttribute("style");
    icon.classList.add("ch-face-icon");
    root.append(icon);
  }

  for (const control of labelled) {
    const callout = callouts[control];

    if (!callout) {
      continue;
    }

    const [start] = callout.line;
    svg(
      "polyline",
      { class: "ch-leader", points: callout.line.join(" ") },
      root
    );

    if (start) {
      svg(
        "circle",
        { class: "ch-anchor", cx: start[0], cy: start[1], r: 3 },
        root
      );
    }
  }
};

/** A label's first line: its button's mark, then what it does. */
const writeLabel = (parent: Element, { control, label }: ControlLabel) => {
  const line = create("span", "ch-label-line", parent);
  const name = triggerNames.get(control);

  if (isFace(control)) {
    create("span", "ch-key", line).append(buttonIcon(control));
  } else if (name !== undefined) {
    create("span", "ch-key", line).textContent = name;
  }

  line.append(label);
};

const placeLabels = (
  parent: HTMLElement,
  controls: readonly ControlLabel[]
) => {
  const blocks = new Map<PadControl, HTMLElement>();

  for (const entry of controls) {
    const owner = stacksUnder[entry.control] ?? entry.control;
    const callout = callouts[owner];

    if (!callout) {
      continue;
    }

    let block = blocks.get(owner);

    if (!block) {
      block = create("div", "ch-label", parent);
      block.dataset.align = callout.align;
      block.style.setProperty("--x", `${(callout.at[0] / width) * 100}%`);
      block.style.setProperty("--y", `${(callout.at[1] / height) * 100}%`);
      blocks.set(owner, block);
    }

    writeLabel(block, entry);

    if (entry.detail !== undefined) {
      writeWithIcons(create("span", "ch-detail", block), entry.detail);
    }
  }
};

/** A trigger's slots as the HUD's diamond, held open, each with its glyph and name. */
const drawSlots = <Kind extends string>(
  parent: HTMLElement,
  slots: SlotsLabel<Kind>,
  className: string,
  glyph: (kind: Kind, badge: HTMLElement) => void,
  data: "potion" | "spell"
) => {
  const group = create("div", "ch-slots", parent);
  create("span", "ch-slots-heading", group).textContent = slots.heading;
  const frame = create("div", "ch-slots-frame", group);
  const diamond = createSlotDiamond(frame, className);
  diamond.held(true);

  for (const { button, kind, label } of slots.slots) {
    const slot = diamond.slots[button];

    if (kind === null) {
      slot.item.dataset.state = "empty";
      continue;
    }

    glyph(kind, slot.badge);
    slot.item.dataset[data] = kind;
    slot.item.dataset.state = "shown";
    slot.name.textContent = label;
  }
};

const drawControls = (
  parent: HTMLElement,
  help: Extract<ControlsHelp, { tab: "controls" }>
) => {
  const layout = create("div", "ch-controls", parent);

  drawSlots(
    layout,
    help.potionSlots,
    "ps-diamond",
    (kind, badge) => {
      potionVial(kind, badge, "ps-glyph");
    },
    "potion"
  );

  const pad = create("div", "ch-pad", layout);

  drawPad(
    pad,
    new Set(help.controls.map(({ control }) => stacksUnder[control] ?? control))
  );

  placeLabels(pad, help.controls);
  drawSlots(layout, help.spellSlots, "ss-diamond", specialGlyph, "spell");
};

const drawMechanics = (
  parent: HTMLElement,
  help: Extract<ControlsHelp, { tab: "mechanics" }>
) => {
  const grid = create("div", "ch-cards", parent);

  for (const [index, card] of help.cards.entries()) {
    const entry = create("article", "ch-card", grid);
    entry.style.setProperty("--entry", String(index));
    create("h3", "ch-card-title", entry).textContent = card.title;
    writeWithIcons(create("p", "ch-card-body", entry), card.body);
  }
};

/** L1 or R1 at an end of the tab bar, the button that moves to that side. */
const bumper = (name: "l1" | "r1") => {
  const element = create("span", "ch-bumper");
  element.textContent = text.controls.triggers[name];

  return element;
};

export const createControlsHelp = () => {
  const tabs = create("div", "overlay-tabs");
  const panel = create("div", "overlay-help");
  tabs.hidden = true;
  panel.hidden = true;

  return {
    /** The open tab's content, under the tab bar. */
    panel,
    show: (view: ScreenView) => {
      tabs.hidden = view.tabs === undefined;
      panel.hidden = view.help === undefined;

      tabs.replaceChildren(
        bumper("l1"),
        ...(view.tabs ?? []).map((tab) => {
          const element = create("span", "ch-tab");
          element.textContent = tab.label;
          element.classList.toggle("selected", tab.selected);

          return element;
        }),
        bumper("r1")
      );

      const before = panel.dataset.tab;
      panel.replaceChildren();
      panel.dataset.tab = view.help?.tab ?? "";
      // A tab switched: its content fades in.
      panel.classList.toggle(
        "switched",
        before !== undefined && before !== "" && before !== panel.dataset.tab
      );

      if (view.help?.tab === "controls") {
        drawControls(panel, view.help);
      } else if (view.help?.tab === "mechanics") {
        drawMechanics(panel, view.help);
      }
    },
    /** The tab bar, under the heading. */
    tabs,
  };
};
