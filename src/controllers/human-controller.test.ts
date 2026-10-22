import { describe, expect, it } from "vitest";

import { readDualSense } from "../dualsense/input";
import type { GamepadLike } from "../dualsense/input";
import { createDuel } from "../duel/duel";
import { tuning } from "../tuning";
import { createHumanController } from "./human-controller";

const duel = createDuel({
  arena: { bounds: { halfDepth: 10, halfWidth: 10 }, cover: [] },
  duelists: [
    { id: "hero", spawn: { x: 0, z: 5 }, team: "gryffindor" },
    { id: "rival", spawn: { x: 0, z: -5 }, team: "slytherin" },
  ],
  tuning,
});

const dualSense = (
  axes: readonly [number, number, number, number]
): GamepadLike => ({
  axes,
  buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })),
  id: "DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)",
});

describe(createHumanController, () => {
  it("walks with the left stick and nudges the aim with the right stick", () => {
    const pad = dualSense([1, -1, -1, 1]);

    const controller = createHumanController(() =>
      readDualSense(pad, tuning.input)
    );

    const intent = controller.intent({
      self: "hero",
      snapshot: duel.snapshot(),
    });

    expect(intent.move.x).toBeCloseTo(Math.SQRT1_2);
    expect(intent.move.y).toBeCloseTo(Math.SQRT1_2);
    expect(intent.aim.x).toBeCloseTo(-Math.SQRT1_2);
    expect(intent.aim.y).toBeCloseTo(-Math.SQRT1_2);
  });

  it("stands still while no DualSense is connected", () => {
    const controller = createHumanController(() => {});

    const intent = controller.intent({
      self: "hero",
      snapshot: duel.snapshot(),
    });

    expect(intent).toStrictEqual({ aim: { x: 0, y: 0 }, move: { x: 0, y: 0 } });
  });
});
