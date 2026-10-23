/**
 * Turns DualSense snapshots into menu events: one step per D-pad press or
 * left stick tilt (repeating while held), and edge-detected ✕ confirm, ○ back
 * and Options. Pure and stateful across frames; the caller feeds it one
 * snapshot per frame.
 */
import type { MenuInput, ScreenEvent } from "../screens/screens";
import type { DualSenseButton, DualSenseSnapshot } from "./input";

export interface MenuSettings {
  /** Seconds a direction must be held before it starts repeating. */
  readonly repeatDelay: number;
  /** Seconds between repeats once a held direction is repeating. */
  readonly repeatInterval: number;
  /** The left stick must tilt past this to step. */
  readonly stickPress: number;
  /** It must come back inside this before it can step again. */
  readonly stickRelease: number;
}

export type MenuEvent = Extract<ScreenEvent, { type: "input" | "press" }>;

export interface MenuInputReader {
  /**
   * This frame's menu events: inputs first, then one `press` if any button
   * went down. A DualSense that has just appeared counts the press that woke
   * it (the browser only shows a pad once a button goes down), but not a
   * stick it finds already tilted.
   */
  readonly read: (
    pad: DualSenseSnapshot | undefined,
    seconds: number
  ) => MenuEvent[];
}

type Direction = "down" | "up";

const buttonInputs: readonly (readonly [DualSenseButton, MenuInput])[] = [
  ["cross", "confirm"],
  ["circle", "back"],
  ["options", "options"],
];

const allButtons: readonly DualSenseButton[] = [
  "circle",
  "create",
  "cross",
  "down",
  "l1",
  "l2",
  "l3",
  "left",
  "options",
  "ps",
  "r1",
  "r2",
  "r3",
  "right",
  "square",
  "touchpad",
  "triangle",
  "up",
];

const heldButtons = (pad: DualSenseSnapshot): ReadonlySet<DualSenseButton> =>
  new Set(allButtons.filter((name) => pad.buttons[name]));

export const createMenuInput = (settings: MenuSettings): MenuInputReader => {
  /** What was held last frame; undefined while the pad is absent. */
  let before: ReadonlySet<DualSenseButton> | undefined;
  let stick: Direction | undefined;
  let direction: Direction | undefined;
  let untilRepeat = 0;

  /** The stick's direction with hysteresis, so wobble around the threshold is one tilt. */
  const stickDirection = (y: number): Direction | undefined => {
    if (stick === "up" && y > settings.stickRelease) {
      return "up";
    }

    if (stick === "down" && y < -settings.stickRelease) {
      return "down";
    }

    if (y >= settings.stickPress) {
      return "up";
    }

    return y <= -settings.stickPress ? "down" : undefined;
  };

  const directionOf = (
    held: ReadonlySet<DualSenseButton>
  ): Direction | undefined => {
    const up = held.has("up");
    const down = held.has("down");

    if (up !== down) {
      return up ? "up" : "down";
    }

    return up ? undefined : stick;
  };

  return {
    read: (pad, seconds) => {
      if (!pad) {
        before = undefined;
        stick = undefined;
        direction = undefined;

        return [];
      }

      const held = heldButtons(pad);
      stick = stickDirection(pad.leftStick.y);
      const heading = directionOf(held);

      if (!before) {
        before = new Set();

        // A stick already tilted was tilted before we looked: no step.
        if (!held.has("up") && !held.has("down")) {
          direction = heading;
          untilRepeat = Number.POSITIVE_INFINITY;
        }
      }

      const last = before;
      const events: MenuEvent[] = [];

      if (heading !== direction) {
        direction = heading;
        untilRepeat = settings.repeatDelay;

        if (heading) {
          events.push({ input: heading, type: "input" });
        }
      } else if (heading) {
        untilRepeat -= seconds;

        if (untilRepeat <= 0) {
          untilRepeat = settings.repeatInterval;
          events.push({ input: heading, type: "input" });
        }
      }

      for (const [button, input] of buttonInputs) {
        if (held.has(button) && !last.has(button)) {
          events.push({ input, type: "input" });
        }
      }

      const pressed = [...held].some((button) => !last.has(button));
      before = held;

      if (pressed) {
        events.push({ type: "press" });
      }

      return events;
    },
  };
};
