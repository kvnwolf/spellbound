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

const { maxPitchSpeed, maxYawSpeed } = tuning.input.look;
const square = 2;
const triangle = 3;
const r3 = 11;

const ticksToSettle = 120;
const ticksOf = (seconds: number) => Math.round(seconds * tuning.tickRate);

/**
 * A human Controller holding a DualSense whose sticks and buttons the test
 * can move between ticks. Axes are the Gamepad API's: LX, LY, RX, RY, with
 * up negative.
 */
const holding = (axes: readonly [number, number, number, number]) => {
  const pad = {
    axes: [...axes],
    buttons: Array.from({ length: 18 }, (): GamepadLike["buttons"][number] => ({
      pressed: false,
      value: 0,
    })),
    id: "DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)",
  } satisfies GamepadLike;

  const controller = createHumanController(() =>
    readDualSense(pad, tuning.input)
  );

  const press = (index: number, down: boolean) => {
    pad.buttons[index] = { pressed: down, value: down ? 1 : 0 };
  };

  return {
    pad,
    press,
    tick: () => controller.intent({ self: "hero", snapshot: duel.snapshot() }),
    /** Ticks `count` times and returns every Intent. */
    ticks: (count: number) =>
      Array.from({ length: count }, () =>
        controller.intent({ self: "hero", snapshot: duel.snapshot() })
      ),
  };
};

/** Pulls R2 (button 7) to `travel`, as the Gamepad API reports an analog trigger. */
const pull = (
  pad: { buttons: GamepadLike["buttons"][number][] },
  travel: number
) => {
  pad.buttons[7] = { pressed: travel > 0, value: travel };
};

const settle = (tick: () => Intent) => {
  let intent = tick();

  for (let index = 0; index < ticksToSettle; index += 1) {
    intent = tick();
  }

  return intent;
};

describe(createHumanController, () => {
  it("walks with the left stick and casts the Light Spell while □ is down", () => {
    const { press, tick } = holding([1, -1, 0, 0]);
    press(square, true);

    const intent = tick();

    expect(intent.move.x).toBeCloseTo(Math.SQRT1_2);
    expect(intent.move.y).toBeCloseTo(Math.SQRT1_2);
    expect(intent.lightSpell).toBeTruthy();
  });

  it("holds the Heavy Spell for as long as △ is down", () => {
    const { press, tick } = holding([0, 0, 0, 0]);

    const before = tick();
    press(triangle, true);
    const held = [tick(), tick()];
    press(triangle, false);
    const released = tick();

    expect(before.heavySpell).toBeFalsy();
    expect(held.map((each) => each.heavySpell)).toStrictEqual([true, true]);
    expect(released.heavySpell).toBeFalsy();
  });

  it("Dodges with ○, jumps with ✕, Shields with L1 and sprints with R1, while each is down", () => {
    const { press, tick } = holding([0, 0, 0, 0]);
    const idle = tick();
    const buttons = { circle: 1, cross: 0, l1: 4, r1: 5 } as const;

    for (const index of Object.values(buttons)) {
      press(index, true);
    }

    const held = tick();

    expect(idle).toMatchObject({
      dodge: false,
      jump: false,
      shield: false,
      sprint: false,
    });
    expect(held).toMatchObject({
      dodge: true,
      jump: true,
      shield: true,
      sprint: true,
    });
  });

  it("leaves L3 unbound", () => {
    const { press, tick } = holding([0, 0, 0, 0]);
    const before = tick();
    press(10, true);

    expect(tick()).toStrictEqual(before);
  });

  describe("the right stick turns the camera", () => {
    it("turns right with the stick right and looks up with the stick up", () => {
      const { tick } = holding([0, 0, 1, -1]);

      const { look } = settle(tick);

      expect(look.yaw).toBeCloseTo(Math.SQRT1_2 * maxYawSpeed);
      expect(look.pitch).toBeCloseTo(Math.SQRT1_2 * maxPitchSpeed);
    });

    it("eases the turn in instead of snapping to full speed", () => {
      const { tick } = holding([0, 0, 1, 0]);

      const first = tick();
      const second = tick();

      expect(first.look.yaw).toBeGreaterThan(0);
      expect(first.look.yaw).toBeLessThan(0.3 * maxYawSpeed);
      expect(second.look.yaw).toBeGreaterThan(first.look.yaw);
    });

    it("reaches full turn speed at full tilt, never beyond it", () => {
      const { tick } = holding([0, 0, 1, 0]);

      let peak = 0;

      for (let index = 0; index < ticksToSettle; index += 1) {
        peak = Math.max(peak, tick().look.yaw);
      }

      expect(peak).toBeLessThanOrEqual(maxYawSpeed);
      expect(settle(tick).look.yaw).toBeCloseTo(maxYawSpeed);
    });

    it("is fine near the centre and fast at full tilt", () => {
      // Half tilt, rescaled past the dead zone, turns well under half speed.
      const halfTilt = 0.12 + (1 - 0.12) / 2;
      const { tick } = holding([0, 0, halfTilt, 0]);

      const { look } = settle(tick);

      expect(look.yaw).toBeLessThan(0.35 * maxYawSpeed);
      expect(look.yaw).toBeGreaterThan(0.1 * maxYawSpeed);
    });

    it("keeps the direction of a diagonal push", () => {
      const { tick } = holding([0, 0, 0.6, 0.3]);

      const { look } = settle(tick);

      expect(look.pitch / maxPitchSpeed / (look.yaw / maxYawSpeed)).toBeCloseTo(
        -0.3 / 0.6
      );
    });

    it("eases back to rest once the stick is released", () => {
      const { pad, tick } = holding([0, 0, 1, 0]);

      settle(tick);
      pad.axes = [0, 0, 0, 0];

      expect(tick().look.yaw).toBeGreaterThan(0.5 * maxYawSpeed);
      expect(settle(tick).look.yaw).toBeCloseTo(0);
    });
  });

  describe("R3", () => {
    it("toggles Lock-on once per press, however long it is held", () => {
      const { press, ticks } = holding([0, 0, 0, 0]);

      press(r3, true);
      const held = ticks(4);
      press(r3, false);
      const released = ticks(2);
      press(r3, true);
      const again = ticks(1);

      expect(
        [...held, ...released, ...again].map((intent) => intent.lockOn)
      ).toStrictEqual([true, false, false, false, false, false, true]);
    });

    it("ignores a right stick knocked by the R3 click for a moment", () => {
      const { press, ticks } = holding([0, 0, 1, 0]);

      press(r3, true);
      const settling = ticks(ticksOf(tuning.input.lockOnSettleSeconds));
      const after = ticks(3);

      expect(settling.every((intent) => intent.look.yaw === 0)).toBeTruthy();
      expect(
        settling.every((intent) => intent.switchTarget === 0)
      ).toBeTruthy();
      expect(after.at(-1)?.look.yaw).toBeGreaterThan(0);
    });
  });

  describe("flicking the right stick", () => {
    it("switches Target once toward the flick, then not again until the stick recentres", () => {
      const { pad, ticks } = holding([0, 0, 0, 0]);

      const resting = ticks(2);
      pad.axes = [0, 0, 1, 0];
      const right = ticks(5);
      pad.axes = [0, 0, 0, 0];
      const recentred = ticks(ticksOf(tuning.input.flick.cooldownSeconds));
      pad.axes = [0, 0, -1, 0];
      const left = ticks(1);

      expect(
        [...resting, ...right, ...recentred, ...left].map(
          (intent) => intent.switchTarget
        )
      ).toStrictEqual([0, 0, 1, 0, 0, 0, 0, ...recentred.map(() => 0), -1]);
    });

    it("does not switch on a slow push to full tilt", () => {
      const { pad, ticks } = holding([0, 0, 0, 0]);
      const switches: number[] = [];
      const steps = ticksOf(0.5);

      for (let step = 1; step <= steps; step += 1) {
        pad.axes = [0, 0, step / steps, 0];
        switches.push(...ticks(1).map((intent) => intent.switchTarget));
      }

      expect(switches.every((each) => each === 0)).toBeTruthy();
    });

    it("does not switch on a small nudge", () => {
      const { pad, ticks } = holding([0, 0, 0, 0]);

      ticks(2);
      pad.axes = [0, 0, 0.6, 0];

      expect(
        ticks(10).every((intent) => intent.switchTarget === 0)
      ).toBeTruthy();
    });

    it("ignores a second flick within the cooldown", () => {
      const { pad, ticks } = holding([0, 0, 0, 0]);

      ticks(1);
      pad.axes = [0, 0, 1, 0];
      const first = ticks(1);
      pad.axes = [0, 0, 0, 0];
      ticks(1);
      pad.axes = [0, 0, 1, 0];
      const tooSoon = ticks(1);

      expect(first[0]?.switchTarget).toBe(1);
      expect(tooSoon[0]?.switchTarget).toBe(0);
    });
  });

  it("stands still while no DualSense is connected", () => {
    const controller = createHumanController(() => {});

    const intent = controller.intent({
      self: "hero",
      snapshot: duel.snapshot(),
    });

    expect(intent).toStrictEqual({
      dodge: false,
      heavySpell: false,
      jump: false,
      lightSpell: false,
      lockOn: false,
      look: { pitch: 0, yaw: 0 },
      move: { x: 0, y: 0 },
      shield: false,
      spellWheel: { held: false, pick: { x: 0, y: 0 } },
      sprint: false,
      switchTarget: 0,
    });
  });

  describe("R2 and the Spell Wheel", () => {
    const { close, open } = tuning.input.spellWheel;

    it("holds the wheel open while R2 is pulled, picking with the right stick", () => {
      const { pad, tick } = holding([0, 0, 0, 0]);

      const before = tick();
      pull(pad, 1);
      pad.axes = [0, 0, -1, 0];
      const picking = tick();
      pull(pad, 0);
      const released = tick();

      expect(before.spellWheel.held).toBeFalsy();
      expect(picking.spellWheel.held).toBeTruthy();
      expect(picking.spellWheel.pick.x).toBeCloseTo(-1);
      expect(picking.spellWheel.pick.y).toBeCloseTo(0);
      expect(released.spellWheel.held).toBeFalsy();
    });

    it("opens past a light pull and only closes once R2 is nearly let go", () => {
      const { pad, tick } = holding([0, 0, 0, 0]);

      pull(pad, open * 0.8);
      const light = tick();
      pull(pad, open * 1.2);
      const opened = tick();
      pull(pad, (open + close) / 2);
      const easing = tick();
      pull(pad, close * 0.5);
      const closed = tick();

      expect(
        [light, opened, easing, closed].map((each) => each.spellWheel.held)
      ).toStrictEqual([false, true, true, false]);
    });

    it("never turns the camera or switches Target while the wheel is open", () => {
      const { pad, ticks } = holding([0, 0, 0, 0]);

      ticks(2);
      pull(pad, 1);
      pad.axes = [0, 0, 1, 0];
      const wheelOpen = ticks(ticksOf(0.5));

      expect(wheelOpen.every((each) => each.look.yaw === 0)).toBeTruthy();
      expect(wheelOpen.every((each) => each.look.pitch === 0)).toBeTruthy();
      expect(wheelOpen.every((each) => each.switchTarget === 0)).toBeTruthy();
    });

    it("leaves the camera still after the wheel closes until the stick comes back to the centre", () => {
      const { pad, ticks } = holding([0, 0, 0, 0]);

      pull(pad, 1);
      pad.axes = [0, 0, 1, 0];
      ticks(10);
      pull(pad, 0);
      const stillPushed = ticks(10);
      pad.axes = [0, 0, 0, 0];
      ticks(2);
      pad.axes = [0, 0, 1, 0];
      const pushedAgain = ticks(5);

      expect(stillPushed.every((each) => each.look.yaw === 0)).toBeTruthy();
      expect(pushedAgain.at(-1)?.look.yaw).toBeGreaterThan(0);
    });
  });
});
