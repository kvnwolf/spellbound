/**
 * The Special Spells' part of the Duel HUD, a DOM overlay reading the
 * snapshot for the local Duelist:
 * - bottom-left, above Stamina, the Focus meter: three segments that fill
 *   and glow once whole;
 * - bottom-right, every Special Spell with its Focus cost and a radial
 *   Cooldown sweep, greyed out while it cannot be cast;
 * - in the centre, the Spell Wheel while R2 holds it open, the picked slice
 *   lit and the ones that cannot be cast greyed out.
 * Expelliarmus's slice is shown locked until it is in the game. Like the rest
 * of the HUD, it only touches the DOM when what it shows changes.
 */
import "./spell-wheel-hud.css";
import type { DuelistId, DuelistState, DuelSnapshot } from "./duel/duel";
import { focusCost, readiness, spellWheelSlices } from "./duel/spell-wheel";
import type { SpecialSpellKind } from "./duel/spell-wheel";
import { text } from "./text";
import type { Tuning } from "./tuning";

type SpellWheelHudSettings = Pick<Tuning, "focus" | "incendio" | "petrificus">;

export interface SpellWheelHud {
  readonly show: (snapshot: DuelSnapshot) => void;
}

const svgNs = "http://www.w3.org/2000/svg";

const create = (tag: string, className: string, parent?: Element) => {
  const element = document.createElement(tag);
  element.className = className;
  parent?.append(element);

  return element;
};

/** Small line glyphs for each slice: a flame, a frozen crystal, a wand flying off. */
const glyphs: Record<SpecialSpellKind | "locked", string> = {
  incendio:
    "M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-7 0 2 1 3 2 3 0-3-1-5 1-8Z",
  locked: "M5 19 17 7m-2-3 5 5M4 20l2-2",
  petrificus: "M12 2 20 7v10l-8 5-8-5V7l8-5Zm0 0v20M4 7l16 10M20 7 4 17",
};

const glyph = (kind: SpecialSpellKind | "locked", parent: Element) => {
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.classList.add("sw-glyph");
  const path = document.createElementNS(svgNs, "path");
  path.setAttribute("d", glyphs[kind]);
  svg.append(path);
  parent.append(svg);

  return svg;
};

/** Writes a class or a style only when it changes: the HUD runs every frame. */
const setData = (element: HTMLElement, key: string, value: string) => {
  if (element.dataset[key] !== value) {
    element.dataset[key] = value;
  }
};

const setVar = (element: HTMLElement, name: string, value: string) => {
  if (element.style.getPropertyValue(name) !== value) {
    element.style.setProperty(name, value);
  }
};

/** Three segments of Focus, each filling in turn. */
const createFocusMeter = (
  parent: HTMLElement,
  settings: SpellWheelHudSettings
) => {
  const root = create("div", "sw-focus", parent);
  create("span", "sw-focus-label", root).textContent = text.specials.focus;
  const bar = create("div", "sw-focus-segments", root);
  const count = Math.round(settings.focus.max / settings.focus.segment);

  const segments = Array.from({ length: count }, () =>
    create("div", "sw-focus-segment", bar)
  );

  return {
    show: (focus: number) => {
      for (const [index, segment] of segments.entries()) {
        const share = Math.min(
          Math.max(focus / settings.focus.segment - index, 0),
          1
        );

        setVar(segment, "--fill", share.toFixed(3));
        setData(segment, "full", String(share >= 1));
      }
    },
  };
};

/** The state a Special Spell is drawn in: ready, short of Focus, cooling down, or locked. */
const stateOf = (
  kind: SpecialSpellKind | null,
  self: DuelistState,
  settings: SpellWheelHudSettings
) => (kind === null ? "locked" : readiness(kind, self, settings));

/** Bottom-right: each Special Spell, its cost in segments and its Cooldown sweep. */
const createSpecialsPanel = (
  parent: HTMLElement,
  settings: SpellWheelHudSettings
) => {
  const root = create("div", "sw-specials", parent);

  const entries = spellWheelSlices.map((kind) => {
    const item = create("div", "sw-special", root);
    const badge = create("div", "sw-special-badge", item);
    glyph(kind ?? "locked", badge);
    const timer = create("span", "sw-special-timer", badge);
    const name = create("span", "sw-special-name", item);
    name.textContent = kind ? text.specials[kind] : text.specials.expelliarmus;
    const cost = create("span", "sw-special-cost", item);

    cost.textContent = kind
      ? "◆".repeat(focusCost(kind, settings) / settings.focus.segment)
      : text.specials.locked;

    return { item, kind, timer };
  });

  return {
    show: (self: DuelistState) => {
      for (const { item, kind, timer } of entries) {
        setData(item, "state", stateOf(kind, self, settings));

        const left = kind ? self.cooldowns[kind] : 0;
        const share = kind ? left / settings[kind].cooldownSeconds : 0;
        setVar(item, "--cooldown", share.toFixed(3));

        const seconds = left > 0 ? String(Math.ceil(left)) : "";

        if (timer.textContent !== seconds) {
          timer.textContent = seconds;
        }
      }
    },
  };
};

/** A point on the wheel's SVG, `radius` out at `angle` (radians clockwise from the top). */
const point = (angle: number, radius: number) =>
  `${(Math.sin(angle) * radius).toFixed(2)} ${(-Math.cos(angle) * radius).toFixed(2)}`;

/** An annulus sector on the wheel, from `from` to `to` (radians clockwise from the top). */
const sectorPath = (from: number, to: number, inner: number, outer: number) =>
  [
    `M ${point(from, outer)}`,
    `A ${outer} ${outer} 0 0 1 ${point(to, outer)}`,
    `L ${point(to, inner)}`,
    `A ${inner} ${inner} 0 0 0 ${point(from, inner)}`,
    "Z",
  ].join(" ");

/** The Spell Wheel itself: one slice per entry of `spellWheelSlices`, clockwise from the top. */
const createWheel = (parent: HTMLElement, settings: SpellWheelHudSettings) => {
  const root = create("div", "sw-wheel", parent);
  root.hidden = true;
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("viewBox", "-100 -100 200 200");
  svg.classList.add("sw-wheel-ring");
  root.append(svg);

  const count = spellWheelSlices.length;
  const width = (Math.PI * 2) / count;
  // A hairline gap between slices.
  const gap = 0.025;

  const slices = spellWheelSlices.map((kind, index) => {
    const centre = index * width;
    const path = document.createElementNS(svgNs, "path");
    path.setAttribute(
      "d",
      sectorPath(centre - width / 2 + gap, centre + width / 2 - gap, 46, 96)
    );
    path.classList.add("sw-slice");
    svg.append(path);

    // The label sits in the middle of its slice.
    const label = create("div", "sw-slice-label", root);
    setVar(label, "--x", `${(Math.sin(centre) * 71) / 2}%`);
    setVar(label, "--y", `${(-Math.cos(centre) * 71) / 2}%`);
    glyph(kind ?? "locked", label);
    create("span", "sw-slice-name", label).textContent = kind
      ? text.specials[kind]
      : text.specials.expelliarmus;
    create("span", "sw-slice-note", label).textContent = kind
      ? "◆".repeat(focusCost(kind, settings) / settings.focus.segment)
      : text.specials.locked;

    return { kind, label, path };
  });

  create("span", "sw-wheel-hint", root).textContent = text.specials.wheelHint;

  return {
    show: (self: DuelistState) => {
      const { open, selected } = self.spellWheel;

      if (root.hidden === open) {
        root.hidden = !open;
      }

      if (!open) {
        return;
      }

      for (const { kind, label, path } of slices) {
        const state = stateOf(kind, self, settings);
        const picked = String(kind !== null && kind === selected);
        setData(label, "state", state);
        setData(label, "picked", picked);

        if (path.dataset.state !== state || path.dataset.picked !== picked) {
          path.dataset.state = state;
          path.dataset.picked = picked;
        }
      }
    },
  };
};

export const createSpellWheelHud = (
  root: HTMLElement,
  localId: DuelistId,
  settings: SpellWheelHudSettings
): SpellWheelHud => {
  const focus = createFocusMeter(root, settings);
  const specials = createSpecialsPanel(root, settings);
  const wheel = createWheel(root, settings);

  return {
    show: (snapshot) => {
      const self = snapshot.duelists.find((each) => each.id === localId);

      if (!self) {
        return;
      }

      focus.show(self.focus);
      specials.show(self);
      wheel.show(self);
    },
  };
};
