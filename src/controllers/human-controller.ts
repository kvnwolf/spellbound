import type { DualSenseSnapshot } from "../dualsense/input";
import { idleIntent } from "../duel/intent";
import type { TargetSwitch, Vec2 } from "../duel/intent";
import { tuning } from "../tuning";
import type { Tuning } from "../tuning";
import { createAimResponse } from "./aim-response";
import type { Controller } from "./controller";

/**
 * Recognises a right-stick flick, the gesture that switches Lock-on Target:
 * the stick leaves the centre and reaches near full tilt within a short
 * window. One flick per gesture: the stick must come back to the centre
 * before the next, and never sooner than the cooldown. Slow pushes and small
 * nudges are not flicks.
 */
const createFlickDetector = (
  settings: Tuning["input"]["flick"],
  tickSeconds: number
) => {
  // Ticks since the stick last rested at the centre.
  let ticksOut = 0;
  let armed = true;
  let cooldownTicks = 0;

  return {
    /** Ignores the stick until it next rests at the centre. */
    disarm: () => {
      armed = false;
    },
    /** Reads this tick's stick; the switch it asks for, if this tick completes a flick. */
    read: (stick: Vec2): TargetSwitch => {
      cooldownTicks = Math.max(cooldownTicks - 1, 0);
      const deflection = Math.hypot(stick.x, stick.y);

      if (deflection < settings.rest) {
        ticksOut = 0;
        armed = true;

        return 0;
      }

      ticksOut += 1;

      if (!armed || deflection < settings.threshold) {
        return 0;
      }

      armed = false;

      const quick = ticksOut * tickSeconds <= settings.windowSeconds;
      // Only sideways flicks switch; an up or down flick is just a look.
      const sideways = Math.abs(stick.x) >= Math.abs(stick.y);

      if (!quick || !sideways || cooldownTicks > 0) {
        return 0;
      }

      cooldownTicks = Math.round(settings.cooldownSeconds / tickSeconds);

      return stick.x > 0 ? 1 : -1;
    },
  };
};

/**
 * A human holding a DualSense. `readPad` returns this frame's DualSense
 * snapshot, or nothing while no DualSense is connected (the Duelist then idles).
 *
 * - Left stick: moves, relative to the camera.
 * - Right stick: turns the camera, through the response (curve, acceleration
 *   and smoothing), as yaw and pitch rates; up looks up. A flick also asks to
 *   switch Lock-on Target, which the Duel only acts on while Locked On.
 * - R3: toggles Lock-on, once per press. The right stick is ignored for a
 *   moment after the click, which tends to knock it.
 * - □: the Light Spell.
 *
 * Everything advances once per Intent, which the Duel asks for every tick.
 */
export const createHumanController = (
  readPad: () => DualSenseSnapshot | undefined,
  settings: Pick<Tuning, "input" | "tickRate"> = tuning
): Controller => {
  const { flick, lockOnSettleSeconds, look } = settings.input;
  const tickSeconds = 1 / settings.tickRate;
  const aimResponse = createAimResponse(look);
  const flicks = createFlickDetector(flick, tickSeconds);
  let r3WasDown = false;
  let settleTicks = 0;

  return {
    intent: () => {
      const pad = readPad();

      if (!pad) {
        aimResponse.reset();
        r3WasDown = false;

        return idleIntent;
      }

      const lockOn = pad.buttons.r3 && !r3WasDown;
      r3WasDown = pad.buttons.r3;

      if (lockOn) {
        settleTicks = Math.round(lockOnSettleSeconds / tickSeconds);
      }

      const settling = settleTicks > 0;
      settleTicks = Math.max(settleTicks - 1, 0);

      if (settling) {
        flicks.disarm();
      }

      const stick = settling ? { x: 0, y: 0 } : pad.rightStick;
      const turn = aimResponse.step(stick, tickSeconds);

      return {
        // □ casts Stupefy; the simulation turns the held button into presses.
        lightSpell: pad.buttons.square,
        lockOn,
        look: {
          pitch: turn.y * look.maxPitchSpeed,
          yaw: turn.x * look.maxYawSpeed,
        },
        move: pad.leftStick,
        switchTarget: settling ? 0 : flicks.read(stick),
      };
    },
  };
};
