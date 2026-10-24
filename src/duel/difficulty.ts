/**
 * The Difficulty of the AI Controller, chosen before the Duel. Easiest first.
 * The AI Controller plays by its profile in `tuning.ai.profiles`.
 */
export const difficulties = ["novato", "duelista", "maestro"] as const;

export type Difficulty = (typeof difficulties)[number];
