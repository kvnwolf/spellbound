/**
 * Practice: a Duel with nothing at stake, for learning the game against a
 * Training Dummy or the AI. Its rules are fixed, never toggled: no Knockout
 * and no Round end, the practising Duelist's Health, Stamina and Focus come
 * back full, and the rival's Health comes back a moment after it reaches
 * zero, the rival down meanwhile (falling, lying, then getting back up),
 * unable to act or be hit. Cooldowns and Spell costs still apply. The Duel simulation applies
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
  /** How the learner starts, as a Training lesson sets them up. */
  readonly setup: LearnerSetup;
}

/** The meters Practice keeps up, as every Duelist carries them. */
type Meter = "focus" | "health" | "stamina";

/**
 * How a Training lesson sets the learner up: the share of their Focus and
 * Health they start with (0 empty, 1 full), and the meters Practice leaves
 * where they are instead of refilling them, for a lesson that teaches
 * earning Focus or restoring Health. Health at zero still comes back full.
 */
export interface LearnerSetup {
  readonly focusShare: number;
  readonly healthShare: number;
  readonly kept: readonly Exclude<Meter, "stamina">[];
}

/** A plain Practice: no Focus, full Health, every meter refilled. */
export const plainSetup: LearnerSetup = {
  focusShare: 0,
  healthShare: 1,
  kept: [],
};

/**
 * The rules for a Practice against `rival`: only Maniquí desarmador casts
 * free, and the learner starts as `setup` says (plainly, unless a Training
 * lesson asks otherwise).
 */
export const practiceRulesFor = (
  rival: PracticeRival,
  learner: string,
  setup: LearnerSetup = plainSetup
): PracticeRules => ({
  learner,
  rivalsCastFree: rival === "disarms",
  setup,
});

/** The meters Practice keeps up, as every Duelist carries them. */
interface Meters {
  readonly id: string;
  readonly health: number;
  readonly stamina: number;
  readonly focus: number;
  /** Seconds left down after reaching zero Health (see `DuelistState`). */
  readonly downSeconds: number;
}

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
  const getUpTicks = ticksOf(tuning.practice.getUpSeconds);

  const full: Readonly<Record<Meter, number>> = {
    focus: tuning.focus.max,
    health: tuning.duelist.health,
    stamina: tuning.defence.stamina.max,
  };

  // Ticks left before a meter comes back full, by Duelist and meter.
  const waits = new Map<string, number>();

  const kept: ReadonlySet<Meter> = new Set(rules.setup.kept);

  /**
   * The learner's meters: each back full once it has not dropped for a
   * while, or at once from empty; a kept one only from empty.
   */
  const refill = <T extends Meters>(before: T, after: T): T => {
    const topped: Partial<Record<Meter, number>> = {};

    for (const meter of meters) {
      const key = `${after.id}:${meter}`;
      const value = after[meter];
      const fromEmpty = value <= 0 && neverEmpty.has(meter);

      if (kept.has(meter) && !fromEmpty) {
        continue;
      }

      if (value >= full[meter]) {
        waits.delete(key);
        continue;
      }

      const left =
        value < before[meter]
          ? refillTicks
          : (waits.get(key) ?? refillTicks) - 1;

      if (left <= 0 || fromEmpty) {
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

  /**
   * A rival down from the tick its Health reaches zero until it has got
   * back up, `getUpSeconds` after its Health came back.
   */
  const fall = <T extends Meters>(before: T, after: T): T => {
    const key = `${after.id}:down`;
    const fell = before.health > 0 && after.health <= 0;

    // The tick it falls counts as the first of its wait for Health, as in `recover`.
    const left = fell
      ? recoveryTicks + getUpTicks - 1
      : (waits.get(key) ?? 1) - 1;

    if (left > 0) {
      waits.set(key, left);
    } else {
      waits.delete(key);
    }

    return { ...after, downSeconds: Math.max(left, 0) / tuning.tickRate };
  };

  return {
    tend: <T extends Meters>(
      before: readonly T[],
      after: readonly T[]
    ): readonly T[] =>
      after.map((self) => {
        const was = before.find((each) => each.id === self.id) ?? self;

        if (self.id !== rules.learner) {
          return recover(fall(was, self));
        }

        return refill(was, self);
      }),
  };
};
