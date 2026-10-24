/**
 * Training: seventeen short lessons that teach the Duel one thing at a time,
 * each a Practice against the Training Dummy that fits it, set up as the
 * lesson needs, with one goal after another on screen. A goal is met from
 * what the Duel simulation reports (its snapshots and events), never from
 * the buttons pressed, so it is the move actually working that counts: a
 * Stupefy that lands, a Shield that blocks, an Incendio that sets the dummy
 * Burning, a Potion that is down. Pure: no three.js, no DOM.
 */
import type { Tuning } from "../tuning";
import type {
  DuelEvent,
  DuelistId,
  DuelistState,
  DuelSnapshot,
  PotionKind,
  SpellKind,
} from "./duel";
import { wrapAngle } from "./geometry";
import { plainSetup, practiceRulesFor } from "./practice";
import type { LearnerSetup, PracticeRules, TrainingDummy } from "./practice";
import { specialSpellKinds } from "./spell-slots";

/** The lessons, in the order Training plays them. */
export const lessons = [
  "move",
  "lockOn",
  "light",
  "heavy",
  "shield",
  "dodge",
  "focus",
  "expelliarmus",
  "incendio",
  "petrificus",
  "depulso",
  "wiggenweld",
  "strength",
  "swiftness",
  "felix",
  "clash",
  "disarmed",
] as const;

export type Lesson = (typeof lessons)[number];

/** The parts Training's lesson list is grouped into. */
export type LessonSection =
  | "combat"
  | "defence"
  | "movement"
  | "potions"
  | "specials"
  | "spells";

/** The lessons in each part of the list, in lesson order, every lesson once. */
export const lessonSections: readonly {
  readonly section: LessonSection;
  readonly lessons: readonly Lesson[];
}[] = [
  { lessons: ["move", "lockOn"], section: "movement" },
  { lessons: ["light", "heavy"], section: "spells" },
  { lessons: ["shield", "dodge"], section: "defence" },
  {
    lessons: ["focus", "expelliarmus", "incendio", "petrificus", "depulso"],
    section: "specials",
  },
  {
    lessons: ["wiggenweld", "strength", "swiftness", "felix"],
    section: "potions",
  },
  { lessons: ["clash", "disarmed"], section: "combat" },
];

/** What a lesson asks for, one at a time; each counted up to `tuning.training.goals`. */
export type Goal = keyof Tuning["training"]["goals"];

/**
 * How a lesson sets the learner up: with full Focus to cast Special Spells;
 * with none, kept from refilling, to earn it or have Felix Felicis grant
 * it; hurt, the Health kept, to have Wiggenweld restore it; or plainly.
 */
export type LessonSetup = "earnFocus" | "fullFocus" | "hurt" | "plain";

export interface LessonPlan {
  /** The Training Dummy the lesson is played against. */
  readonly rival: TrainingDummy;
  /** Its goals, in order. */
  readonly goals: readonly Goal[];
  readonly setup: LessonSetup;
}

const plan = (
  rival: TrainingDummy,
  goals: readonly Goal[],
  setup: LessonSetup = "plain"
): LessonPlan => ({ goals, rival, setup });

export const lessonPlans: Readonly<Record<Lesson, LessonPlan>> = {
  clash: plan("clash", ["clash"]),
  depulso: plan("idle", ["depulso"], "fullFocus"),
  disarmed: plan("disarms", ["disarmed", "pickup"]),
  dodge: plan("casts", ["dodge", "perfectDodge"]),
  expelliarmus: plan("idle", ["expelliarmus"], "fullFocus"),
  felix: plan("idle", ["felix", "special"], "earnFocus"),
  focus: plan("casts", ["focusSegment"], "earnFocus"),
  heavy: plan("idle", ["confringo", "perfectRelease"]),
  incendio: plan("idle", ["incendio"], "fullFocus"),
  light: plan("idle", ["stupefy"]),
  lockOn: plan("idle", ["lockOn", "lockOff"]),
  move: plan("idle", ["walk", "look", "run"]),
  petrificus: plan("idle", ["petrificus"], "fullFocus"),
  shield: plan("casts", ["block", "parry"]),
  strength: plan("idle", ["strength", "strongHit"]),
  swiftness: plan("idle", ["swiftness", "swiftRun"]),
  wiggenweld: plan("idle", ["wiggenweld"], "hurt"),
};

/** The Practice rules a lesson is played under, the learner set up as it asks. */
export const lessonRules = (
  lesson: Lesson,
  learner: DuelistId,
  settings: Pick<Tuning, "training">
): PracticeRules => {
  const { rival, setup } = lessonPlans[lesson];

  const setups: Readonly<Record<LessonSetup, LearnerSetup>> = {
    earnFocus: { ...plainSetup, kept: ["focus"] },
    fullFocus: { ...plainSetup, focusShare: 1 },
    hurt: {
      ...plainSetup,
      healthShare: settings.training.setup.hurtHealthShare,
      kept: ["health"],
    },
    plain: plainSetup,
  };

  return practiceRulesFor(rival, learner, setups[setup]);
};

/**
 * What a lesson is about, for the lessons on one Special Spell or one
 * Potion: the slot's button is what its scroll and goals show.
 */
export const subjectOf = (
  lesson: Lesson
): PotionKind | SpellKind | undefined => {
  const subjects: Partial<Record<Lesson, PotionKind | SpellKind>> = {
    depulso: "depulso",
    expelliarmus: "expelliarmus",
    felix: "felix",
    incendio: "incendio",
    petrificus: "petrificus",
    strength: "strength",
    swiftness: "swiftness",
    wiggenweld: "wiggenweld",
  };

  return subjects[lesson];
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
  self: { readonly before: DuelistState; readonly after: DuelistState },
  settings: Pick<Tuning, "focus">
) => number;

/** How many of the tick's events `test` picks out, for the learner `me`. */
const counting =
  (test: (event: DuelEvent, me: DuelistId) => boolean): Counter =>
  ({ events }, learner) =>
    events.filter((event) => test(event, learner)).length;

/** Metres moved over the tick on foot (not mid-Dodge), when `counts` says the tick counts. */
const metresWhen =
  (counts: (after: DuelistState) => boolean): Counter =>
  (_tick, _learner, { after, before }) =>
    counts(after) && after.dodgeSeconds === 0
      ? Math.hypot(
          after.position.x - before.position.x,
          after.position.z - before.position.z
        )
      : 0;

const isSpecial = (kind: string) =>
  specialSpellKinds.some((special) => special === kind);

/** A Spell of `kind` cast by `me` landing on someone else. */
const landed = (kind: SpellKind) =>
  counting(
    (event, me) =>
      event.type === "spell-hit" &&
      event.spell.kind === kind &&
      event.spell.casterId === me &&
      event.targetId !== me
  );

/** The Potion `kind` down for `me`, taking effect. */
const drunk = (kind: PotionKind) =>
  counting(
    (event, me) =>
      event.type === "potion-drunk" &&
      event.duelistId === me &&
      event.kind === kind
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
  depulso: landed("depulso"),
  disarmed: counting(
    (event, me) => event.type === "disarm" && event.duelistId === me
  ),
  dodge: counting(
    (event, me) => event.type === "dodge" && event.duelistId === me
  ),
  expelliarmus: counting(
    (event, me) =>
      event.type === "disarm" && event.casterId === me && event.duelistId !== me
  ),
  felix: drunk("felix"),
  // Whole segments of Focus gained over the tick.
  focusSegment: (_tick, _learner, { after, before }, { focus }) =>
    Math.max(
      Math.floor(after.focus / focus.segment) -
        Math.floor(before.focus / focus.segment),
      0
    ),
  incendio: counting(
    (event, me) =>
      event.type === "explosion" &&
      event.spell.casterId === me &&
      event.burned.some((id) => id !== me)
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
  petrificus: landed("petrificus"),
  pickup: counting(
    (event, me) =>
      event.type === "wand-recovered" &&
      event.duelistId === me &&
      event.how === "pickup"
  ),
  run: metresWhen((after) => after.sprinting),
  special: counting(
    (event, me) =>
      event.type === "spell-cast" &&
      event.spell.casterId === me &&
      isSpecial(event.spell.kind)
  ),
  strength: drunk("strength"),
  // A Spell landing while the Strength Potion works.
  strongHit: (tick, learner, self, settings) =>
    self.before.potionEffects.strength > 0
      ? counting(
          (event, me) =>
            event.type === "spell-hit" &&
            event.spell.casterId === me &&
            event.targetId !== me
        )(tick, learner, self, settings)
      : 0,
  stupefy: landed("stupefy"),
  swiftRun: metresWhen((after) => after.potionEffects.swiftness > 0),
  swiftness: drunk("swiftness"),
  walk: metresWhen((after) => !after.sprinting),
  wiggenweld: drunk("wiggenweld"),
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
  settings: Pick<Tuning, "focus" | "training">
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
    progress.count + counters[goal](tick, learner, { after, before }, settings);

  if (count < settings.training.goals[goal]) {
    return count === progress.count ? progress : { ...progress, count };
  }

  const next = progress.goal + 1;

  return { ...progress, count: 0, done: next >= goals.length, goal: next };
};
