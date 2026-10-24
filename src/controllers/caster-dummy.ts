import { idleIntent } from "../duel/intent";
import type { Controller } from "./controller";

/**
 * Maniquí que lanza hechizos, a Training Dummy for Practice: a stationary
 * Duelist that keeps itself Locked On to its opponent (pressing Lock-on
 * whenever it has no Target, as any Controller would) and taps the Light
 * Spell every `intervalTicks` ticks, so incoming Spells, mid-air cancels and
 * taking hits can be tried on a predictable beat.
 */
export const createCasterDummy = (intervalTicks: number): Controller => {
  let tick = 0;

  return {
    intent: ({ self, snapshot }) => {
      tick += 1;

      const unlocked =
        snapshot.duelists.find((each) => each.id === self)?.targetId === null;

      // Pressed for one tick, released for the rest: one cast per interval.
      return {
        ...idleIntent,
        lightSpell: tick % intervalTicks === 0,
        lockOn: unlocked,
      };
    },
  };
};
