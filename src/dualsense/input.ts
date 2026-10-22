/**
 * DualSense input through the standard Gamepad API (ADR-0001: input never
 * goes through WebHID). Finds the DualSense among connected gamepads and maps
 * its raw standard-mapping buttons and axes to a semantic snapshot.
 * Pure: it takes gamepad-shaped data, so tests feed it fakes.
 */
import type { Vec2 } from "../duel/intent";

/** The parts of the Gamepad API's `Gamepad` the adapter reads. */
export interface GamepadLike {
  readonly id: string;
  readonly buttons: readonly {
    readonly pressed: boolean;
    readonly value: number;
  }[];
  readonly axes: readonly number[];
}

export type DualSenseModel = "DualSense" | "DualSense Edge";

/** What is plugged in, as far as Spellbound cares. */
export type PadScan<G extends GamepadLike = GamepadLike> =
  | { readonly kind: "none" }
  /** Gamepads are connected, but none is a DualSense. */
  | { readonly kind: "unsupported" }
  | {
      readonly kind: "dualsense";
      readonly model: DualSenseModel;
      readonly gamepad: G;
    };

/**
 * The DualSense product ids under Sony's USB vendor id (054c), as they
 * appear in `Gamepad.id`.
 */
const modelByProductId = new Map<string, DualSenseModel>([
  ["0ce6", "DualSense"],
  ["0df2", "DualSense Edge"],
]);

/**
 * Identifies a DualSense from a `Gamepad.id`. Browsers format the id
 * differently ("… Vendor: 054c Product: 0ce6)" in Chrome, "054c-0ce6-…" in
 * Firefox), so this looks for Sony's vendor id followed by a product id.
 * Chrome on macOS gives no ids at all ("DualSense Wireless Controller
 * (STANDARD GAMEPAD)"), so without them it falls back to the name.
 */
const modelOf = (id: string): DualSenseModel | undefined => {
  const product = /054c\D{1,10}(?<product>[0-9a-f]{4})/iu.exec(id)?.groups
    ?.product;

  if (product !== undefined) {
    return modelByProductId.get(product.toLowerCase());
  }

  if (/dualsense edge/iu.test(id)) {
    return "DualSense Edge";
  }

  return /dualsense/iu.test(id) ? "DualSense" : undefined;
};

/** Picks the first DualSense (or DualSense Edge) among `navigator.getGamepads()`. */
export const scanGamepads = <G extends GamepadLike>(
  gamepads: readonly (G | null)[]
): PadScan<G> => {
  const connected = gamepads.filter((pad): pad is G => pad !== null);

  for (const gamepad of connected) {
    const model = modelOf(gamepad.id);

    if (model) {
      return { gamepad, kind: "dualsense", model };
    }
  }

  return connected.length > 0 ? { kind: "unsupported" } : { kind: "none" };
};

export type DualSenseButton =
  | "circle"
  | "create"
  | "cross"
  | "down"
  | "l1"
  | "l2"
  | "l3"
  | "left"
  | "options"
  | "ps"
  | "r1"
  | "r2"
  | "r3"
  | "right"
  | "square"
  | "touchpad"
  | "triangle"
  | "up";

/** One frame of the DualSense, in its own vocabulary. */
export interface DualSenseSnapshot {
  readonly buttons: Readonly<Record<DualSenseButton, boolean>>;
  /** x right, y up, length at most 1, zero inside the dead zone. */
  readonly leftStick: Vec2;
  readonly rightStick: Vec2;
  /** Analog trigger travel in [0, 1], zero inside the dead zone. */
  readonly triggers: { readonly l2: number; readonly r2: number };
}

export interface DeadZones {
  readonly stickDeadZone: number;
  readonly triggerDeadZone: number;
}

/**
 * A radial dead zone with the remaining travel rescaled to [0, 1], so the
 * stick starts moving smoothly from zero right at the edge of the dead zone
 * and diagonals never exceed full deflection.
 */
const radialDeadZone = (x: number, y: number, deadZone: number): Vec2 => {
  const length = Math.hypot(x, y);

  if (length <= deadZone) {
    return { x: 0, y: 0 };
  }

  const scaled = Math.min((length - deadZone) / (1 - deadZone), 1);

  return { x: (x / length) * scaled, y: (y / length) * scaled };
};

const linearDeadZone = (value: number, deadZone: number): number =>
  value <= deadZone ? 0 : Math.min((value - deadZone) / (1 - deadZone), 1);

/** Maps a DualSense's standard-mapping buttons and axes to a semantic snapshot. */
export const readDualSense = (
  gamepad: GamepadLike,
  deadZones: DeadZones
): DualSenseSnapshot => {
  const pressed = (index: number) => gamepad.buttons[index]?.pressed ?? false;

  const travel = (index: number) =>
    linearDeadZone(
      gamepad.buttons[index]?.value ?? 0,
      deadZones.triggerDeadZone
    );

  const axis = (index: number) => gamepad.axes[index] ?? 0;

  return {
    // Standard-mapping indices, as Chrome reports them for a DualSense.
    buttons: {
      circle: pressed(1),
      create: pressed(8),
      cross: pressed(0),
      down: pressed(13),
      l1: pressed(4),
      l2: pressed(6),
      l3: pressed(10),
      left: pressed(14),
      options: pressed(9),
      ps: pressed(16),
      r1: pressed(5),
      r2: pressed(7),
      r3: pressed(11),
      right: pressed(15),
      square: pressed(2),
      touchpad: pressed(17),
      triangle: pressed(3),
      up: pressed(12),
    },
    // The Gamepad API reports stick up as negative; flip it so up is positive
    // (`0 - y` rather than `-y`, so a centred stick reads +0, not -0).
    leftStick: radialDeadZone(axis(0), 0 - axis(1), deadZones.stickDeadZone),
    rightStick: radialDeadZone(axis(2), 0 - axis(3), deadZones.stickDeadZone),
    triggers: { l2: travel(6), r2: travel(7) },
  };
};
