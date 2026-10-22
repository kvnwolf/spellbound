/**
 * The Difficulty of the AI Controller, chosen before the Duel. Easiest first.
 * The Duel carries it in its configuration; the AI will read it later.
 */
export const difficulties = ["novato", "duelista", "maestro"] as const;

export type Difficulty = (typeof difficulties)[number];
