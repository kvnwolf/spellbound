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

  let connected = true;

  const controller = createHumanController(() =>
    connected ? readDualSense(pad, tuning.input) : undefined
  );

  const press = (index: number, down: boolean) => {
    pad.buttons[index] = { pressed: down, value: down ? 1 : 0 };
  };

  return {
    /** The pad drops out and comes back, as on the "Reconecta tu mando" prompt. */
    connect: (value: boolean) => {
      connected = value;
    },
    pad,
    press,
    /** The Duel stops asking for Intents, as behind a menu or the pause. */
    suspend: () => controller.suspend?.(),
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
    tick();
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

  describe("a press that closes a menu is not a gameplay input", () => {
    const circle = 1;
    const cross = 0;

    it("does not Dodge while ○ is still held across a resume, until it is let go and pressed again", () => {
      const { press, suspend, tick } = holding([0, 0, 0, 0]);
      tick();
      suspend();
      press(circle, true);

      const held = [tick(), tick()];
      press(circle, false);
      const released = tick();
      press(circle, true);
      const again = tick();

      expect(held.map((each) => each.dodge)).toStrictEqual([false, false]);
      expect(released.dodge).toBeFalsy();
      expect(again.dodge).toBeTruthy();
    });

    it.each([
      ["✕", cross, "jump"],
      ["□", square, "lightSpell"],
      ["△", triangle, "heavySpell"],
    ] as const)(
      "ignores %s held across a resume until it is released",
      (_name, button, action) => {
        const { press, suspend, tick } = holding([0, 0, 0, 0]);
        suspend();
        press(button, true);

        const held = tick();
        press(button, false);
        tick();
        press(button, true);

        expect(held[action]).toBeFalsy();
        expect(tick()[action]).toBeTruthy();
      }
    );

    it("ignores a button already held when the Controller is first asked, as a Duel started by that press", () => {
      const { press, tick } = holding([0, 0, 0, 0]);
      press(cross, true);

      expect(tick().jump).toBeFalsy();
    });

    it("ignores a button held while the DualSense comes back", () => {
      const { connect, press, tick } = holding([0, 0, 0, 0]);
      tick();
      connect(false);
      tick();
      press(circle, true);
      connect(true);

      expect(tick().dodge).toBeFalsy();
    });

    it("still moves, aims and Shields while a closing button is held", () => {
      const { press, suspend, tick } = holding([1, 0, 0, 0]);
      suspend();
      press(circle, true);
      press(4, true);

      expect(tick()).toMatchObject({ dodge: false, shield: true });
      expect(tick().move.x).toBeCloseTo(1);
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

      ticks(1);
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
      const { pad, press, ticks } = holding([0, 0, 0, 0]);

      ticks(1);
      pad.axes[2] = 1;
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
      clashPump: false,
      dodge: false,
      heavySpell: false,
      jump: false,
      lightSpell: false,
      lockOn: false,
      look: { pitch: 0, yaw: 0 },
      move: { x: 0, y: 0 },
      shield: false,
      spellSlots: { held: false, press: null },
      sprint: false,
      switchTarget: 0,
    });
  });

  describe("R2 and the Spell Slots", () => {
    const { hold, release } = tuning.input.spellSlots;
    const faces = { circle: 1, cross: 0, square: 2, triangle: 3 } as const;

    it("presses a face button's Spell Slot while R2 is held, for the tick of the press only", () => {
      const { pad, press, tick } = holding([0, 0, 0, 0]);

      pull(pad, 1);
      const armed = tick();
      press(faces.triangle, true);
      const pressed = tick();
      const stillDown = tick();

      expect(armed.spellSlots).toStrictEqual({ held: true, press: null });
      expect(pressed.spellSlots).toStrictEqual({
        held: true,
        press: "triangle",
      });
      expect(stillDown.spellSlots).toStrictEqual({ held: true, press: null });
    });

    it("withholds the face buttons' usual actions while they cast from their slots", () => {
      const { pad, press, tick } = holding([0, 0, 0, 0]);

      pull(pad, 1);
      tick();

      for (const index of Object.values(faces)) {
        press(index, true);
      }

      const intent = tick();
      // Still withheld after R2 is let go, until the buttons are.
      pull(pad, 0);
      const afterR2 = tick();

      expect(intent).toMatchObject({
        dodge: false,
        heavySpell: false,
        jump: false,
        lightSpell: false,
        spellSlots: { held: true, press: "triangle" },
      });
      expect(afterR2).toMatchObject({
        dodge: false,
        heavySpell: false,
        jump: false,
        lightSpell: false,
        spellSlots: { held: false, press: null },
      });
    });

    it("casts nothing from R2 alone, and the face buttons act as usual without it", () => {
      const { pad, press, tick } = holding([0, 0, 0, 0]);

      pull(pad, 1);
      const r2Alone = tick();
      pull(pad, 0);
      tick();
      press(faces.square, true);
      const squarePressed = tick();

      expect(r2Alone.spellSlots.press).toBeNull();
      expect(squarePressed).toMatchObject({
        lightSpell: true,
        spellSlots: { held: false, press: null },
      });
    });

    it("keeps a Charge going when R2 is pulled while △ is already held", () => {
      const { pad, press, tick } = holding([0, 0, 0, 0]);

      tick();
      press(faces.triangle, true);
      tick();
      pull(pad, 1);
      const intent = tick();

      expect(intent.heavySpell).toBeTruthy();
      expect(intent.spellSlots).toStrictEqual({ held: true, press: null });
    });

    it("holds R2 past a light pull and lets it go only once nearly released", () => {
      const { pad, tick } = holding([0, 0, 0, 0]);

      pull(pad, hold * 0.8);
      const light = tick();
      pull(pad, hold * 1.2);
      const held = tick();
      pull(pad, (hold + release) / 2);
      const easing = tick();
      pull(pad, release * 0.5);
      const letGo = tick();

      expect(
        [light, held, easing, letGo].map((each) => each.spellSlots.held)
      ).toStrictEqual([false, true, true, false]);
    });

    it("pumps the Clash with R2: down past the pull, up again once nearly released", () => {
      const { pad, tick } = holding([0, 0, 0, 0]);
      const pumps: boolean[] = [];

      for (const travel of [0, hold * 0.8, 1, (hold + release) / 2, 0, 1]) {
        pull(pad, travel);
        pumps.push(tick().clashPump);
      }

      expect(pumps).toStrictEqual([false, false, true, true, false, true]);
    });

    it("keeps turning the camera with the right stick while R2 is held", () => {
      const { pad, tick } = holding([0, 0, 1, 0]);

      pull(pad, 1);

      expect(settle(tick).look.yaw).toBeCloseTo(maxYawSpeed);
    });
  });
});
