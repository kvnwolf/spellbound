import type { DualSenseSnapshot } from "../dualsense/input";
import { idleIntent } from "../duel/intent";
import { tuning } from "../tuning";
import type { Tuning } from "../tuning";
import { createAimResponse } from "./aim-response";
import type { Controller } from "./controller";

/**
 * A human holding a DualSense. `readPad` returns this frame's DualSense
 * snapshot, or nothing while no DualSense is connected (the Duelist then idles).
 * The right stick passes through the aim response (curve, acceleration and
 * smoothing), advanced once per Intent, which the Duel asks for every tick.
 */
export const createHumanController = (
  readPad: () => DualSenseSnapshot | undefined,
  settings: Pick<Tuning, "input" | "tickRate"> = tuning
): Controller => {
  const aimResponse = createAimResponse(settings.input.aimResponse);
  const tickSeconds = 1 / settings.tickRate;

  return {
    intent: () => {
      const pad = readPad();

      if (!pad) {
        aimResponse.reset();

        return idleIntent;
      }

      return {
        // Left stick walks relative to the camera, right stick nudges the aim.
        aim: aimResponse.step(pad.rightStick, tickSeconds),
        // □ casts Stupefy; the simulation turns the held button into presses.
        lightSpell: pad.buttons.square,
        move: pad.leftStick,
      };
    },
  };
};
