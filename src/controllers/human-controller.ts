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
 * - △: the Heavy Spell, held to Charge and released to cast.
 * - ○: Dodge. ✕: jump. L1 (held): the Shield. R1 (held): sprint. L3 is unbound.
 * - R2 (held): the Spell Wheel. While it is open the right stick picks a
 *   slice instead of turning the camera (or nudging the Lock-on framing, or
 *   flicking), and letting go of R2 casts what it picks. The game never slows.
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
  const wheel = settings.input.spellWheel;
  let r3WasDown = false;
  let settleTicks = 0;
  // The Spell Wheel is open (R2 held), and the right stick is the wheel's
  // until it comes back to the centre after the wheel closes.
  let wheelOpen = false;
  let stickPicking = false;

  return {
    intent: () => {
      const pad = readPad();

      if (!pad) {
        aimResponse.reset();
        r3WasDown = false;
        wheelOpen = false;
        stickPicking = false;

        return idleIntent;
      }

      const lockOn = pad.buttons.r3 && !r3WasDown;
      r3WasDown = pad.buttons.r3;

      if (lockOn) {
        settleTicks = Math.round(lockOnSettleSeconds / tickSeconds);
      }

      const settling = settleTicks > 0;
      settleTicks = Math.max(settleTicks - 1, 0);

      // R2 holds the Spell Wheel open, with some hysteresis on the trigger.
      wheelOpen = pad.triggers.r2 > (wheelOpen ? wheel.close : wheel.open);

      // While the wheel is open the right stick picks a slice instead of
      // looking, and once it closes it only looks again after coming back
      // to the centre, so letting go of R2 never flings the camera.
      if (wheelOpen) {
        stickPicking = true;
      } else if (
        Math.hypot(pad.rightStick.x, pad.rightStick.y) < wheel.stickRest
      ) {
        stickPicking = false;
      }

      if (settling || stickPicking) {
        flicks.disarm();
      }

      if (stickPicking) {
        aimResponse.reset();
      }

      const stick = settling || stickPicking ? { x: 0, y: 0 } : pad.rightStick;

      const turn = aimResponse.step(stick, tickSeconds);

      return {
        // Buttons are passed on as held; the simulation finds the presses
        // (and reads △'s hold over time to Charge Confringo).
        dodge: pad.buttons.circle,
        heavySpell: pad.buttons.triangle,
        jump: pad.buttons.cross,
        lightSpell: pad.buttons.square,
        lockOn,
        look: {
          pitch: turn.y * look.maxPitchSpeed,
          yaw: turn.x * look.maxYawSpeed,
        },
        move: pad.leftStick,
        shield: pad.buttons.l1,
        spellWheel: {
          held: wheelOpen,
          pick: wheelOpen ? pad.rightStick : { x: 0, y: 0 },
        },
        sprint: pad.buttons.r1,
        switchTarget: settling || stickPicking ? 0 : flicks.read(stick),
      };
    },
  };
};
