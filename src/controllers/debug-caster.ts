import { idleIntent } from "../duel/intent";
import type { Controller } from "./controller";

/**
 * A development stand-in for the AI: a stationary Duelist that taps the
 * Light Spell every `intervalTicks` ticks, so incoming Spells, mid-air
 * cancels and taking hits can be tried before the AI exists.
 */
export const createDebugCasterController = (
  intervalTicks: number
): Controller => {
  let tick = 0;

  return {
    intent: () => {
      tick += 1;

      // Pressed for one tick, released for the rest: one cast per interval.
      return { ...idleIntent, lightSpell: tick % intervalTicks === 0 };
    },
  };
};
