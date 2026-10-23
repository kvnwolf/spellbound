import { describe, expect, it } from "vitest";

import type { DualSenseButton, DualSenseSnapshot } from "./input";
import { createMenuInput } from "./menu-input";

const settings = {
  repeatDelay: 0.4,
  repeatInterval: 0.1,
  stickPress: 0.6,
  stickRelease: 0.35,
};

/** A DualSense at rest with the given buttons held and the left stick tilted. */
const pad = (
  held: readonly DualSenseButton[] = [],
  leftStickY = 0
): DualSenseSnapshot => ({
  buttons: {
    circle: held.includes("circle"),
    create: held.includes("create"),
    cross: held.includes("cross"),
    down: held.includes("down"),
    l1: held.includes("l1"),
    l2: held.includes("l2"),
    l3: held.includes("l3"),
    left: held.includes("left"),
    options: held.includes("options"),
    ps: held.includes("ps"),
    r1: held.includes("r1"),
    r2: held.includes("r2"),
    r3: held.includes("r3"),
    right: held.includes("right"),
    square: held.includes("square"),
    touchpad: held.includes("touchpad"),
    triangle: held.includes("triangle"),
    up: held.includes("up"),
  },
  leftStick: { x: 0, y: leftStickY },
  rightStick: { x: 0, y: 0 },
  triggers: { l2: 0, r2: 0 },
});

const frame = 1 / 60;

const input = (name: "back" | "confirm" | "down" | "options" | "up") =>
  ({ input: name, type: "input" }) as const;

const press = { type: "press" } as const;

/** A menu input that has already seen the pad at rest. */
const settled = () => {
  const menu = createMenuInput(settings);
  menu.read(pad(), frame);

  return menu;
};

describe("buttons", () => {
  it("reports nothing for a pad at rest", () => {
    expect(settled().read(pad(), frame)).toStrictEqual([]);
  });

  it("maps ✕ and ○ on the press, not the hold", () => {
    const menu = settled();

    expect(menu.read(pad(["cross"]), frame)).toStrictEqual([
      input("confirm"),
      press,
    ]);
    expect(menu.read(pad(["cross"]), frame)).toStrictEqual([]);
    expect(menu.read(pad(), frame)).toStrictEqual([]);
    expect(menu.read(pad(["circle"]), frame)).toStrictEqual([
      input("back"),
      press,
    ]);
  });

  it("maps Options on the press", () => {
    expect(settled().read(pad(["options"]), frame)).toStrictEqual([
      input("options"),
      press,
    ]);
  });

  it("reports any other button as a plain press", () => {
    expect(settled().read(pad(["square"]), frame)).toStrictEqual([press]);
  });

  it("maps the D-pad to up and down", () => {
    const menu = settled();

    expect(menu.read(pad(["up"]), frame)).toStrictEqual([input("up"), press]);
    expect(menu.read(pad(), frame)).toStrictEqual([]);
    expect(menu.read(pad(["down"]), frame)).toStrictEqual([
      input("down"),
      press,
    ]);
  });

  it("ignores the D-pad's sideways presses as navigation", () => {
    expect(settled().read(pad(["left"]), frame)).toStrictEqual([press]);
  });

  it("treats opposite D-pad presses held together as no direction", () => {
    expect(settled().read(pad(["up", "down"]), frame)).toStrictEqual([press]);
  });
});

describe("the left stick", () => {
  it("steps once per tilt", () => {
    const menu = settled();

    expect(menu.read(pad([], 1), frame)).toStrictEqual([input("up")]);
    expect(menu.read(pad([], 1), frame)).toStrictEqual([]);
    expect(menu.read(pad([], 0), frame)).toStrictEqual([]);
    expect(menu.read(pad([], -1), frame)).toStrictEqual([input("down")]);
  });

  it("is not a button press", () => {
    expect(settled().read(pad([], 1), frame)).not.toContainEqual(press);
  });

  it("ignores a gentle tilt", () => {
    expect(settled().read(pad([], 0.5), frame)).toStrictEqual([]);
  });

  it("must come back toward the centre before it steps again", () => {
    const menu = settled();

    expect(menu.read(pad([], 1), frame)).toStrictEqual([input("up")]);
    // Wobbling between press and release never re-triggers.
    expect(menu.read(pad([], 0.5), frame)).toStrictEqual([]);
    expect(menu.read(pad([], 0.7), frame)).toStrictEqual([]);
    expect(menu.read(pad([], 0.2), frame)).toStrictEqual([]);
    expect(menu.read(pad([], 0.7), frame)).toStrictEqual([input("up")]);
  });
});

describe("holding a direction", () => {
  it("steps at once, waits, then repeats", () => {
    const menu = settled();

    expect(menu.read(pad(["down"]), 0.1)).toStrictEqual([input("down"), press]);
    expect(menu.read(pad(["down"]), 0.2)).toStrictEqual([]);
    expect(menu.read(pad(["down"]), 0.15)).toStrictEqual([]);
    // 0.45s held: past the 0.4s delay.
    expect(menu.read(pad(["down"]), 0.1)).toStrictEqual([input("down")]);
  });

  it("keeps repeating at the repeat interval", () => {
    const menu = settled();
    menu.read(pad(["down"]), 0.5);
    menu.read(pad(["down"]), 0.5);

    expect(menu.read(pad(["down"]), 0.04)).toStrictEqual([]);
    expect(menu.read(pad(["down"]), 0.07)).toStrictEqual([input("down")]);
  });

  it("repeats a held stick the same way", () => {
    const menu = settled();

    expect(menu.read(pad([], -1), 0.1)).toStrictEqual([input("down")]);
    expect(menu.read(pad([], -1), 0.45)).toStrictEqual([input("down")]);
  });

  it("steps at most once per frame after a long stall", () => {
    const menu = settled();
    menu.read(pad(["up"]), frame);

    expect(menu.read(pad(["up"]), 2)).toStrictEqual([input("up")]);
  });

  it("starts over when the direction changes or lets go", () => {
    const menu = settled();
    menu.read(pad(["up"]), frame);
    menu.read(pad(["up"]), 0.3);

    expect(menu.read(pad(["down"]), frame)).toStrictEqual([
      input("down"),
      press,
    ]);
    expect(menu.read(pad(), frame)).toStrictEqual([]);
    expect(menu.read(pad(["down"]), frame)).toStrictEqual([
      input("down"),
      press,
    ]);
    expect(menu.read(pad(["down"]), 0.3)).toStrictEqual([]);
  });
});

describe("a controller coming and going", () => {
  it("reports nothing while there is no DualSense", () => {
    const menu = createMenuInput(settings);

    expect(menu.read(undefined, frame)).toStrictEqual([]);
  });

  it("counts the press that wakes the pad, once", () => {
    const menu = createMenuInput(settings);

    expect(menu.read(pad(["cross"]), frame)).toStrictEqual([
      input("confirm"),
      press,
    ]);
    expect(menu.read(pad(["cross"]), frame)).toStrictEqual([]);
    expect(menu.read(pad(), frame)).toStrictEqual([]);
  });

  it("steps for a D-pad press that wakes the pad", () => {
    const menu = createMenuInput(settings);

    expect(menu.read(pad(["down"]), frame)).toStrictEqual([
      input("down"),
      press,
    ]);
  });

  it("does not count a stick already tilted when the pad shows up", () => {
    const menu = createMenuInput(settings);

    expect(menu.read(pad([], 1), frame)).toStrictEqual([]);
    // Still tilted a long while later: it never starts repeating by itself.
    expect(menu.read(pad([], 1), 5)).toStrictEqual([]);
    expect(menu.read(pad(), frame)).toStrictEqual([]);
    expect(menu.read(pad([], 1), frame)).toStrictEqual([input("up")]);
  });

  it("forgets what it saw while the pad was away", () => {
    const menu = settled();
    menu.read(pad(["cross"]), frame);
    menu.read(undefined, frame);

    expect(menu.read(pad(["cross"]), frame)).toStrictEqual([
      input("confirm"),
      press,
    ]);
  });
});
