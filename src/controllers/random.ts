/**
 * A seeded source of randomness for Controllers that need one (the AI), so a
 * Duel replayed with the same seed plays out exactly the same. Pure.
 */

/** Returns numbers in [0, 1), like `Math.random`, from a fixed sequence per seed. */
export type Random = () => number;

/** The Park–Miller generator's modulus (a prime, 2^31 - 1) and multiplier. */
const modulus = 2_147_483_647;
const multiplier = 48_271;

/** Draws thrown away at the start, so neighbouring seeds part ways at once. */
const warmUp = 8;

/**
 * Park–Miller "minimal standard" generator. Every product stays below 2^53,
 * so plain float arithmetic is exact.
 */
export const createRandom = (seed: number): Random => {
  let state = (Math.abs(Math.floor(seed)) % (modulus - 1)) + 1;

  const next = () => {
    state = (state * multiplier) % modulus;

    return (state - 1) / (modulus - 1);
  };

  for (let draw = 0; draw < warmUp; draw += 1) {
    state = (state * multiplier) % modulus;
  }

  return next;
};

/** A number between `min` and `max`, uniformly. */
export const between = (
  random: Random,
  { max, min }: { readonly max: number; readonly min: number }
) => min + (max - min) * random();

/** A normally distributed number around `mean` with standard deviation `spread` (Box–Muller). */
export const gaussian = (random: Random, mean: number, spread: number) => {
  const u = Math.max(random(), Number.EPSILON);
  const v = random();

  return (
    mean + spread * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  );
};

/**
 * One of the `options`, picked with probability proportional to its weight;
 * undefined when every weight is zero.
 */
export const pick = <Choice>(
  random: Random,
  options: readonly (readonly [Choice, number])[]
): Choice | undefined => {
  const total = options.reduce((sum, [, weight]) => sum + weight, 0);

  if (total <= 0) {
    return undefined;
  }

  let roll = random() * total;

  for (const [choice, weight] of options) {
    roll -= weight;

    if (roll < 0) {
      return choice;
    }
  }

  return options.findLast(([, weight]) => weight > 0)?.[0];
};
