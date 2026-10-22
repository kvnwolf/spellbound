import { describe, expect, it } from "vitest";

import { readDualSense, scanGamepads } from "./input";
import type { GamepadLike } from "./input";

const chromeDualSenseId =
  "DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)";

const chromeEdgeId =
  "DualSense Edge Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0df2)";

const firefoxDualSenseId = "054c-0ce6-DualSense Wireless Controller";

const xboxId =
  "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)";

const dualShock4Id =
  "Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)";

/** A standard-mapping gamepad at rest: 18 buttons, 4 axes. */
const fakePad = (
  id: string,
  overrides: {
    buttons?: Record<number, number>;
    axes?: readonly [number, number, number, number];
  } = {}
): GamepadLike => ({
  axes: overrides.axes ?? [0, 0, 0, 0],
  buttons: Array.from({ length: 18 }, (_, index) => {
    const value = overrides.buttons?.[index] ?? 0;

    return { pressed: value > 0.5, value };
  }),
  id,
});

describe(scanGamepads, () => {
  it("reports no gamepad when none is connected", () => {
    expect(scanGamepads([]).kind).toBe("none");
    expect(scanGamepads([null, null]).kind).toBe("none");
  });

  it.each([
    ["DualSense on Chrome", chromeDualSenseId, "DualSense"],
    ["DualSense on Firefox", firefoxDualSenseId, "DualSense"],
    ["DualSense Edge", chromeEdgeId, "DualSense Edge"],
  ])("accepts a %s", (_label, id, model) => {
    const pad = fakePad(id);

    expect(scanGamepads([pad])).toStrictEqual({
      gamepad: pad,
      kind: "dualsense",
      model,
    });
  });

  it.each([
    ["an Xbox controller", xboxId],
    ["a DualShock 4, another Sony pad", dualShock4Id],
  ])("rejects %s", (_label, id) => {
    expect(scanGamepads([fakePad(id)]).kind).toBe("unsupported");
  });

  it("picks the DualSense when other gamepads are connected too", () => {
    const dualSense = fakePad(chromeDualSenseId);

    const scan = scanGamepads([fakePad(xboxId), null, dualSense]);

    expect(scan).toStrictEqual({
      gamepad: dualSense,
      kind: "dualsense",
      model: "DualSense",
    });
  });
});

describe(readDualSense, () => {
  const deadZones = { stickDeadZone: 0.12, triggerDeadZone: 0.04 };

  it("names the face, shoulder, stick, D-pad and system buttons", () => {
    const pad = fakePad(chromeDualSenseId, {
      buttons: { 0: 1, 10: 1, 13: 1, 16: 1, 5: 1 },
    });

    const { buttons } = readDualSense(pad, deadZones);

    expect(buttons).toStrictEqual({
      circle: false,
      create: false,
      cross: true,
      down: true,
      l1: false,
      l2: false,
      l3: true,
      left: false,
      options: false,
      ps: true,
      r1: true,
      r2: false,
      r3: false,
      right: false,
      square: false,
      touchpad: false,
      triangle: false,
      up: false,
    });
  });

  it("reads stick up as positive y and right as positive x", () => {
    const pad = fakePad(chromeDualSenseId, { axes: [1, 0, 0, -1] });

    const { leftStick, rightStick } = readDualSense(pad, deadZones);

    expect(leftStick).toStrictEqual({ x: 1, y: 0 });
    expect(rightStick).toStrictEqual({ x: 0, y: 1 });
  });

  it("reads a stick resting inside the dead zone as centred", () => {
    const pad = fakePad(chromeDualSenseId, { axes: [0.08, -0.06, -0.1, 0.02] });

    const { leftStick, rightStick } = readDualSense(pad, deadZones);

    expect(leftStick).toStrictEqual({ x: 0, y: 0 });
    expect(rightStick).toStrictEqual({ x: 0, y: 0 });
  });

  it("rescales stick travel past the dead zone so it still starts from zero", () => {
    const pad = fakePad(chromeDualSenseId, { axes: [0.56, 0, 0, 0] });

    const { leftStick } = readDualSense(pad, deadZones);

    expect(leftStick.x).toBeCloseTo(0.5);
    expect(leftStick.y).toBeCloseTo(0);
  });

  it("reads analog trigger travel, ignoring the slack at the top", () => {
    const pad = fakePad(chromeDualSenseId, { buttons: { 6: 0.52, 7: 0.03 } });

    const { triggers } = readDualSense(pad, deadZones);

    expect(triggers.l2).toBeCloseTo(0.5);
    expect(triggers.r2).toBe(0);
  });
});
