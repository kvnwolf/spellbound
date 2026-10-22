import { describe, expect, it } from "vitest";

import { readDualSense } from "../dualsense/input";
import type { GamepadLike } from "../dualsense/input";
import { createDuel } from "../duel/duel";
import type { Intent } from "../duel/intent";
import { tuning } from "../tuning";
import { createHumanController } from "./human-controller";

const duel = createDuel({
  arena: {
    bounds: { halfDepth: 10, halfWidth: 10 },
    cover: [],
    obstructions: [],
  },
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

const ticksToSettle = 120;

/** A human Controller whose DualSense axes the test can move between ticks. */
const holding = (axes: readonly [number, number, number, number]) => {
  const pad = { ...dualSense(axes), axes: [...axes] };

  const controller = createHumanController(() =>
    readDualSense(pad, tuning.input)
  );

  return {
    pad,
    tick: () => controller.intent({ self: "hero", snapshot: duel.snapshot() }),
  };
};

const settle = (tick: () => Intent) => {
  let intent = tick();

  for (let index = 0; index < ticksToSettle; index += 1) {
    intent = tick();
  }

  return intent;
};

describe(createHumanController, () => {
  it("walks with the left stick and nudges the aim with the right stick", () => {
    const { tick } = holding([1, -1, -1, 1]);

    const intent = settle(tick);

    expect(intent.move.x).toBeCloseTo(Math.SQRT1_2);
    expect(intent.move.y).toBeCloseTo(Math.SQRT1_2);
    expect(intent.aim.x).toBeCloseTo(-Math.SQRT1_2);
    expect(intent.aim.y).toBeCloseTo(-Math.SQRT1_2);
  });

  it("casts the Light Spell while □ is down", () => {
    const pad = dualSense([0, 0, 0, 0]);
    const square = 2;

    const controller = createHumanController(() =>
      readDualSense(
        {
          ...pad,
          buttons: pad.buttons.map((button, index) =>
            index === square ? { pressed: true, value: 1 } : button
          ),
        },
        tuning.input
      )
    );

    const view = { self: "hero", snapshot: duel.snapshot() };

    expect(controller.intent(view).lightSpell).toBeTruthy();
  });

  describe("the right stick's response", () => {
    it("eases the aim in instead of snapping it to the stick", () => {
      const { tick } = holding([0, 0, 1, 0]);

      const first = tick();
      const second = tick();

      expect(first.aim.x).toBeGreaterThan(0);
      expect(first.aim.x).toBeLessThan(0.3);
      expect(second.aim.x).toBeGreaterThan(first.aim.x);
    });

    it("reaches full aim at full tilt, never beyond it", () => {
      const { tick } = holding([0, 0, 1, 0]);

      let peak = 0;

      for (let index = 0; index < ticksToSettle; index += 1) {
        peak = Math.max(peak, tick().aim.x);
      }

      expect(peak).toBeLessThanOrEqual(1);
      expect(settle(tick).aim.x).toBeCloseTo(1);
    });

    it("is fine near the centre and fast at full tilt", () => {
      // Half tilt, rescaled past the dead zone, lands well under half the aim.
      const halfTilt = 0.12 + (1 - 0.12) / 2;
      const { tick } = holding([0, 0, halfTilt, 0]);

      expect(settle(tick).aim.x).toBeLessThan(0.35);
      expect(settle(tick).aim.x).toBeGreaterThan(0.1);
    });

    it("keeps the direction of a diagonal push", () => {
      const { tick } = holding([0, 0, 0.6, -0.3]);

      const { aim } = settle(tick);

      expect(aim.y / aim.x).toBeCloseTo(0.3 / 0.6);
    });

    it("eases back to the centre once the stick is released", () => {
      const { pad, tick } = holding([0, 0, 1, 0]);

      settle(tick);
      pad.axes = [0, 0, 0, 0];

      const released = tick();

      expect(released.aim.x).toBeGreaterThan(0.5);
      expect(settle(tick).aim.x).toBeCloseTo(0);
    });
  });

  it("stands still while no DualSense is connected", () => {
    const controller = createHumanController(() => {});

    const intent = controller.intent({
      self: "hero",
      snapshot: duel.snapshot(),
    });

    expect(intent).toStrictEqual({
      aim: { x: 0, y: 0 },
      lightSpell: false,
      move: { x: 0, y: 0 },
    });
  });
});
