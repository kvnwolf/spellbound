/**
 * Practice: a Duel with nothing at stake, for learning the game against a
 * Training Dummy or the AI. Its rules are fixed, never toggled: no Knockout
 * and no Round end, the practising Duelist's Health, Stamina and Focus come
 * back full, and the rival's Health comes back a moment after it reaches
 * zero. Cooldowns and Spell costs still apply. The Duel simulation applies
 * these rules when its config carries them. Pure: no three.js, no DOM.
 */
import type { Tuning } from "../tuning";

/** The Training Dummies, each a scripted Controller for practising one thing. */
export const trainingDummies = ["idle", "casts", "clash", "disarms"] as const;

export type TrainingDummy = (typeof trainingDummies)[number];

/** Whom a Practice is against: a Training Dummy, or the AI at a Difficulty. */
export const practiceRivals = [...trainingDummies, "ai"] as const;

export type PracticeRival = (typeof practiceRivals)[number];

/** The Practice rules a Duel is created with. */
export interface PracticeRules {
  /** The Duelist practising: Health, Stamina and Focus are refilled. */
  readonly learner: string;
  /**
   * The other Duelists cast Special Spells free of Focus and Cooldown, so a
   * Training Dummy can cast one on its beat without earning Focus.
   */
  readonly rivalsCastFree: boolean;
  /**
   * The learner starts with full Focus instead of none, as a Training lesson
   * on Special Spells sets them up.
   */
  readonly fullFocus: boolean;
}

/**
 * The rules for a Practice against `rival`: only Maniquí desarmador casts
 * free, and the learner starts with no Focus unless `fullFocus` is asked for.
 */
export const practiceRulesFor = (
  rival: PracticeRival,
  learner: string,
  { fullFocus = false }: { readonly fullFocus?: boolean } = {}
): PracticeRules => ({
  fullFocus,
  learner,
  rivalsCastFree: rival === "disarms",
});

/** The meters Practice keeps up, as every Duelist carries them. */
interface Meters {
  readonly id: string;
  readonly health: number;
  readonly stamina: number;
  readonly focus: number;
}

type Meter = "focus" | "health" | "stamina";

const meters: readonly Meter[] = ["health", "stamina", "focus"];

/** Meters that never sit empty: back full the tick they reach zero. */
const neverEmpty: ReadonlySet<Meter> = new Set(["health", "stamina"]);

/**
 * Keeps a Practice's meters up, tick by tick: called with the Duelists as
 * the last tick ended and as this one is about to, it returns this tick's
 * Duelists with whatever is owed refilled.
 */
export const createPracticeKeeper = (
  rules: PracticeRules,
  tuning: Pick<
    Tuning,
    "defence" | "duelist" | "focus" | "practice" | "tickRate"
  >
) => {
  const ticksOf = (seconds: number) => Math.round(seconds * tuning.tickRate);
  const refillTicks = ticksOf(tuning.practice.refillSeconds);
  const recoveryTicks = ticksOf(tuning.practice.recoverySeconds);

  const full: Readonly<Record<Meter, number>> = {
    focus: tuning.focus.max,
    health: tuning.duelist.health,
    stamina: tuning.defence.stamina.max,
  };

  // Ticks left before a meter comes back full, by Duelist and meter.
  const waits = new Map<string, number>();

  /** The learner's meters: each back full once it has not dropped for a while, or at once from empty. */
  const refill = <T extends Meters>(before: T, after: T): T => {
    const topped: Partial<Record<Meter, number>> = {};

    for (const meter of meters) {
      const key = `${after.id}:${meter}`;
      const value = after[meter];

      if (value >= full[meter]) {
        waits.delete(key);
        continue;
      }

      const left =
        value < before[meter]
          ? refillTicks
          : (waits.get(key) ?? refillTicks) - 1;

      if (left <= 0 || (value <= 0 && neverEmpty.has(meter))) {
        waits.delete(key);
        topped[meter] = full[meter];
      } else {
        waits.set(key, left);
      }
    }

    return { ...after, ...topped };
  };

  /** A rival's Health: back full a while after it reached zero. */
  const recover = <T extends Meters>(after: T): T => {
    const key = `${after.id}:recovery`;

    if (after.health > 0) {
      waits.delete(key);

      return after;
    }

    const left = (waits.get(key) ?? recoveryTicks) - 1;

    if (left > 0) {
      waits.set(key, left);

      return after;
    }

    waits.delete(key);

    return { ...after, health: full.health };
  };

  return {
    tend: <T extends Meters>(
      before: readonly T[],
      after: readonly T[]
    ): readonly T[] =>
      after.map((self) => {
        if (self.id !== rules.learner) {
          return recover(self);
        }

        return refill(before.find((each) => each.id === self.id) ?? self, self);
      }),
  };
};
