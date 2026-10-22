/**
 * The fixed-timestep accumulator between the display's frame rate and the
 * Duel simulation's tick rate. Each frame feeds in the real time that passed
 * and gets back how many ticks to run and how far the clock sits into the
 * next one, which rendering uses to interpolate between snapshots.
 */
export interface FixedStepClock {
  readonly advance: (frameSeconds: number) => {
    readonly ticks: number;
    readonly alpha: number;
  };
}

/** Never catch up more than this much time in one frame (after a stall or a background tab). */
const maxCatchUpSeconds = 0.25;

export const createFixedStepClock = (tickRate: number): FixedStepClock => {
  const tickSeconds = 1 / tickRate;
  let accumulated = 0;

  return {
    advance: (frameSeconds) => {
      accumulated += Math.min(Math.max(frameSeconds, 0), maxCatchUpSeconds);
      const ticks = Math.floor(accumulated / tickSeconds);
      accumulated -= ticks * tickSeconds;

      return { alpha: accumulated / tickSeconds, ticks };
    },
  };
};
