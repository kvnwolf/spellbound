import type { DualSenseSnapshot } from "../dualsense/input";
import { idleIntent } from "../duel/intent";
import type { Controller } from "./controller";

/**
 * A human holding a DualSense. `readPad` returns this frame's DualSense
 * snapshot, or nothing while no DualSense is connected (the Duelist then idles).
 */
export const createHumanController = (
  readPad: () => DualSenseSnapshot | undefined
): Controller => ({
  intent: () => {
    const pad = readPad();

    if (!pad) {
      return idleIntent;
    }

    return {
      // Left stick walks relative to the camera, right stick nudges the aim.
      aim: pad.rightStick,
      // □ casts Stupefy; the simulation turns the held button into presses.
      lightSpell: pad.buttons.square,
      move: pad.leftStick,
    };
  },
});
