/**
 * Training: ten short lessons that teach the Duel, each a Practice against
 * the Training Dummy that fits it, with one goal after another on screen.
 * A goal is met from what the Duel simulation reports (its snapshots and
 * events), never from the buttons pressed, so it is the move actually
 * working that counts: a Stupefy that lands, a Shield that blocks, a Wand
 * picked up. Pure: no three.js, no DOM.
 */
import type { Tuning } from "../tuning";
import type { DuelEvent, DuelistId, DuelistState, DuelSnapshot } from "./duel";
import { wrapAngle } from "./geometry";
import type { TrainingDummy } from "./practice";
import { specialSpellKinds } from "./spell-slots";

/** The lessons, in the order Training plays them. */
export const lessons = [
  "move",
  "lockOn",
  "light",
  "heavy",
  "shield",
  "dodge",
  "specials",
  "potions",
  "clash",
  "disarmed",
] as const;

export type Lesson = (typeof lessons)[number];

/** What a lesson asks for, one at a time; each counted up to `tuning.training.goals`. */
export type Goal = keyof Tuning["training"]["goals"];

export interface LessonPlan {
  /** The Training Dummy the lesson is played against. */
  readonly rival: TrainingDummy;
  /** Its goals, in order. */
  readonly goals: readonly Goal[];
  /** The learner starts with full Focus, to have Special Spells to cast. */
  readonly fullFocus: boolean;
}

const plan = (
  rival: TrainingDummy,
  goals: readonly Goal[],
  fullFocus = false
): LessonPlan => ({ fullFocus, goals, rival });

export const lessonPlans: Readonly<Record<Lesson, LessonPlan>> = {
  clash: plan("clash", ["clash"]),
  disarmed: plan("disarms", ["disarmed", "pickup"]),
  dodge: plan("casts", ["dodge", "perfectDodge"]),
  heavy: plan("idle", ["confringo", "perfectRelease"]),
  light: plan("idle", ["stupefy"]),
  lockOn: plan("idle", ["lockOn", "lockOff"]),
  move: plan("idle", ["walk", "look", "run"]),
  potions: plan("idle", ["potion"]),
  shield: plan("casts", ["block", "parry"]),
  specials: plan("idle", ["special"], true),
};

/** Where a lesson stands: which of its goals is on show, and how far it is counted. */
export interface LessonProgress {
  readonly lesson: Lesson;
  /** Index of the goal on show in the lesson's plan. */
  readonly goal: number;
  /** How much of it is done: times, or metres or degrees. */
  readonly count: number;
  /** Every goal met. */
  readonly done: boolean;
}

/** One tick of the Duel, as Training watches it. */
export interface LessonTick {
  readonly before: DuelSnapshot;
  readonly after: DuelSnapshot;
  readonly events: readonly DuelEvent[];
}

export const startLesson = (lesson: Lesson): LessonProgress => ({
  count: 0,
  done: false,
  goal: 0,
  lesson,
});

/** The goal on show, its count and what it is counted up to; the last goal once done. */
export const goalOf = (
  progress: LessonProgress,
  settings: Pick<Tuning, "training">
) => {
  const { goals } = lessonPlans[progress.lesson];
  const goal = goals[Math.min(progress.goal, goals.length - 1)] ?? "walk";
  const target = settings.training.goals[goal];

  return {
    count: progress.done ? target : progress.count,
    goal,
    target,
  };
};

const radiansToDegrees = 180 / Math.PI;

type Counter = (
  tick: LessonTick,
  learner: DuelistId,
  self: { readonly before: DuelistState; readonly after: DuelistState }
) => number;

/** How many of the tick's events `test` picks out, for the learner `me`. */
const counting =
  (test: (event: DuelEvent, me: DuelistId) => boolean): Counter =>
  ({ events }, learner) =>
    events.filter((event) => test(event, learner)).length;

/** Metres moved over the tick, on foot (not mid-Dodge), running or not as `running` says. */
const metres =
  (running: boolean): Counter =>
  (_tick, _learner, { after, before }) =>
    after.sprinting === running && after.dodgeSeconds === 0
      ? Math.hypot(
          after.position.x - before.position.x,
          after.position.z - before.position.z
        )
      : 0;

const isSpecial = (kind: string) =>
  specialSpellKinds.some((special) => special === kind);

/** A Spell of `kind` cast by `me` landing on someone else. */
const landed = (kind: "confringo" | "stupefy") =>
  counting(
    (event, me) =>
      event.type === "spell-hit" &&
      event.spell.kind === kind &&
      event.spell.casterId === me &&
      event.targetId !== me
  );

const counters: Readonly<Record<Goal, Counter>> = {
  block: counting(
    (event, me) => event.type === "spell-blocked" && event.duelistId === me
  ),
  clash: counting(
    (event, me) =>
      event.type === "clash-end" &&
      event.outcome === "won" &&
      event.winnerId === me
  ),
  confringo: landed("confringo"),
  disarmed: counting(
    (event, me) => event.type === "disarm" && event.duelistId === me
  ),
  dodge: counting(
    (event, me) => event.type === "dodge" && event.duelistId === me
  ),
  lockOff: counting(
    (event, me) =>
      event.type === "lock-off" &&
      event.duelistId === me &&
      event.reason === "toggle"
  ),
  lockOn: counting(
    (event, me) => event.type === "lock-on" && event.duelistId === me
  ),
  look: (_tick, _learner, { after, before }) =>
    after.targetId === null
      ? Math.abs(wrapAngle(after.aim.yaw - before.aim.yaw)) * radiansToDegrees
      : 0,
  parry: counting(
    (event, me) => event.type === "parry" && event.duelistId === me
  ),
  perfectDodge: counting(
    (event, me) => event.type === "perfect-dodge" && event.duelistId === me
  ),
  perfectRelease: counting(
    (event, me) => event.type === "perfect-release" && event.duelistId === me
  ),
  pickup: counting(
    (event, me) =>
      event.type === "wand-recovered" &&
      event.duelistId === me &&
      event.how === "pickup"
  ),
  potion: counting(
    (event, me) => event.type === "potion-drunk" && event.duelistId === me
  ),
  run: metres(true),
  special: counting(
    (event, me) =>
      event.type === "spell-cast" &&
      event.spell.casterId === me &&
      isSpecial(event.spell.kind)
  ),
  stupefy: landed("stupefy"),
  walk: metres(false),
};

/**
 * Counts one tick toward the goal on show. A goal met gives way to the next,
 * counted from zero (whatever was over spills nowhere); the last one met
 * finishes the lesson, which then stays as it is.
 */
export const advanceLesson = (
  progress: LessonProgress,
  tick: LessonTick,
  learner: DuelistId,
  settings: Pick<Tuning, "training">
): LessonProgress => {
  if (progress.done) {
    return progress;
  }

  const before = tick.before.duelists.find((each) => each.id === learner);
  const after = tick.after.duelists.find((each) => each.id === learner);
  const { goals } = lessonPlans[progress.lesson];
  const goal = goals[progress.goal];

  if (!before || !after || goal === undefined) {
    return progress;
  }

  const count =
    progress.count + counters[goal](tick, learner, { after, before });

  if (count < settings.training.goals[goal]) {
    return count === progress.count ? progress : { ...progress, count };
  }

  const next = progress.goal + 1;

  return { ...progress, count: 0, done: next >= goals.length, goal: next };
};
