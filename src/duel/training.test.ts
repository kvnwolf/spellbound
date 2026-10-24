/**
 * Training through the Duel seam: a lesson's progress is fed what a Practice
 * Duel reports, tick by tick (its snapshots and events), and read back as
 * the goal on show and its count. Where a move is hard to script by hand
 * (a Parry's timing, a Clash), the tick carries the event the Duel reports.
 */
import { describe, expect, it } from "vitest";

import { tuning } from "../tuning";
import { createDuel } from "./duel";
import type { Duel, DuelEvent, DuelSnapshot, SpellState } from "./duel";
import { idleIntent } from "./intent";
import type { Intent } from "./intent";
import { practiceRulesFor } from "./practice";
import { boundTo, spellSlots } from "./spell-slots";
import {
  advanceLesson,
  goalOf as goalWith,
  lessonPlans,
  lessons,
  startLesson,
} from "./training";
import type { Lesson, LessonProgress } from "./training";

const { goals } = tuning.training;

const goalOf = (progress: LessonProgress) => goalWith(progress, tuning);

const ticksOf = (seconds: number) => Math.round(seconds * tuning.tickRate);

/** The Practice a lesson is played in: the learner ten metres from its Training Dummy. */
const practiceFor = (lesson: Lesson): Duel =>
  createDuel({
    arena: {
      bounds: { halfDepth: 15, halfWidth: 15 },
      cover: [],
      obstructions: [],
    },
    duelists: [
      { id: "learner", spawn: { x: 0, z: 5 }, team: "near" },
      { id: "rival", spawn: { x: 0, z: -5 }, team: "far" },
    ],
    practice: practiceRulesFor(lessonPlans[lesson].rival, "learner", {
      fullFocus: lessonPlans[lesson].fullFocus,
    }),
    tuning,
  });

const intent = (overrides: Partial<Intent>): Intent => ({
  ...idleIntent,
  ...overrides,
});

/**
 * Plays `ticks` ticks of `duel`, the learner doing `learner(tick)` and the
 * rival `rival(tick)`, feeding each tick to the lesson's progress.
 */
const play = (
  duel: Duel,
  start: LessonProgress,
  ticks: number,
  learner: (tick: number) => Intent,
  rival: (tick: number) => Intent = () => idleIntent
) => {
  let progress = start;

  for (let tick = 0; tick < ticks; tick += 1) {
    const before = duel.snapshot();

    const { events, snapshot } = duel.step({
      learner: learner(tick),
      rival: rival(tick),
    });

    progress = advanceLesson(
      progress,
      { after: snapshot, before, events },
      "learner",
      tuning
    );
  }

  return progress;
};

const shieldUp = intent({ shield: true });

/** Pressed on even ticks, let go on odd ones. */
const tapping =
  (pressed: Intent) =>
  (tick: number): Intent =>
    tick % 2 === 0 ? pressed : idleIntent;

/** A still Duel's snapshot, as the backdrop to a tick that carries `events`. */
const still = (): DuelSnapshot => practiceFor("move").snapshot();

/** One tick reporting `events`, the Duelists standing still. */
const withEvents = (
  progress: LessonProgress,
  ...events: DuelEvent[]
): LessonProgress => {
  const snapshot = still();

  return advanceLesson(
    progress,
    { after: snapshot, before: snapshot, events },
    "learner",
    tuning
  );
};

const spell = (overrides: Partial<SpellState> = {}): SpellState => ({
  casterId: "rival",
  charge: 0,
  empowered: false,
  homing: null,
  id: 1,
  kind: "stupefy",
  position: { x: 0, y: 1, z: 0 },
  strong: false,
  team: "far",
  velocity: { x: 0, y: 0, z: 1 },
  ...overrides,
});

/** A lesson's progress with every goal before `goal` already met. */
const atGoal = (lesson: Lesson, goal: number): LessonProgress => ({
  ...startLesson(lesson),
  goal,
});

const slotOf = (kind: string) =>
  spellSlots.find((slot) => boundTo(slot, tuning) === kind) ?? "circle";

describe("the lessons", () => {
  it("are the ten lessons, in order", () => {
    expect(lessons).toStrictEqual([
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
    ]);
  });

  it("are each played against the Training Dummy that fits", () => {
    expect(lessons.map((lesson) => lessonPlans[lesson].rival)).toStrictEqual([
      "idle",
      "idle",
      "idle",
      "idle",
      "casts",
      "casts",
      "idle",
      "idle",
      "clash",
      "disarms",
    ]);
  });

  it("start on their first goal, counted from zero", () => {
    expect(goalOf(startLesson("light"))).toStrictEqual({
      count: 0,
      goal: "stupefy",
      target: goals.stupefy,
    });
  });
});

describe("Moverse y mirar", () => {
  it("counts the metres walked with the left stick, then moves on to looking round", () => {
    const duel = practiceFor("move");
    const walk = intent({ move: { x: 0, y: 1 } });

    const partWay = play(duel, startLesson("move"), ticksOf(1), () => walk);

    expect(goalOf(partWay).goal).toBe("walk");
    expect(goalOf(partWay).count).toBeGreaterThan(0.5);
    expect(goalOf(partWay).count).toBeLessThan(goals.walk);

    const walked = play(duel, partWay, ticksOf(6), () => walk);

    expect(goalOf(walked)).toStrictEqual({
      count: 0,
      goal: "look",
      target: goals.look,
    });
  });

  it("does not count standing still", () => {
    const progress = play(
      practiceFor("move"),
      startLesson("move"),
      ticksOf(2),
      () => idleIntent
    );

    expect(goalOf(progress).count).toBe(0);
  });

  it("counts the degrees the right stick turns the camera, either way", () => {
    const duel = practiceFor("move");
    const left = intent({ look: { pitch: 0, yaw: -2 } });
    const right = intent({ look: { pitch: 0, yaw: 2 } });

    const looking = play(duel, atGoal("move", 1), ticksOf(0.5), () => left);
    const turned = goalOf(looking).count;

    expect(turned).toBeGreaterThan(30);
    // Turning back counts too: the count only grows.
    expect(
      goalOf(play(duel, looking, ticksOf(0.5), () => right)).count
    ).toBeGreaterThan(turned * 1.8);
  });

  it("counts only the metres run holding R1 for the run, and ends once run", () => {
    const duel = practiceFor("move");
    const walk = intent({ move: { x: 0, y: 1 } });
    const sprint = intent({ move: { x: 0, y: -1 }, sprint: true });

    const walking = play(duel, atGoal("move", 2), ticksOf(1), () => walk);

    expect(goalOf(walking)).toStrictEqual({
      count: 0,
      goal: "run",
      target: goals.run,
    });

    const ran = play(duel, walking, ticksOf(4), () => sprint);

    expect(ran.done).toBeTruthy();
  });
});

describe("Fijar objetivo", () => {
  it("counts a Lock-on with R3, then its release with R3", () => {
    const duel = practiceFor("lockOn");
    const press = tapping(intent({ lockOn: true }));

    const locked = play(duel, startLesson("lockOn"), 1, press);

    expect(goalOf(locked)).toStrictEqual({
      count: 0,
      goal: "lockOff",
      target: goals.lockOff,
    });
    expect(play(duel, locked, 3, press).done).toBeTruthy();
  });
});

describe("Hechizo ligero", () => {
  it("counts only the Stupefys that land", () => {
    const duel = practiceFor("light");
    const cast = tapping(intent({ lightSpell: true }));

    // Cast with the aim on the floor, well short of the dummy: nothing lands.
    const missed = play(duel, startLesson("light"), ticksOf(0.3), (tick) =>
      intent({ ...cast(tick), look: { pitch: -3, yaw: 0 } })
    );

    expect(goalOf(missed).count).toBe(0);
  });

  it("ends once enough Stupefys hit the dummy", () => {
    const duel = practiceFor("light");
    const cast = tapping(intent({ lightSpell: true }));

    expect(
      play(duel, startLesson("light"), ticksOf(4), cast).done
    ).toBeTruthy();
  });
});

describe("Hechizo pesado", () => {
  it("counts a Confringo that lands, then a Perfect Release", () => {
    const landed = withEvents(startLesson("heavy"), {
      damage: 30,
      position: { x: 0, y: 1, z: -5 },
      spell: spell({ casterId: "learner", kind: "confringo", team: "near" }),
      staggered: false,
      targetId: "rival",
      type: "spell-hit",
    });

    expect(goalOf(landed).goal).toBe("perfectRelease");

    const perfect = withEvents(landed, {
      duelistId: "learner",
      spell: spell({ casterId: "learner", empowered: true, kind: "confringo" }),
      type: "perfect-release",
    });

    expect(perfect.done).toBeTruthy();
  });

  it("does not count the rival's Perfect Release", () => {
    const progress = withEvents(atGoal("heavy", 1), {
      duelistId: "rival",
      spell: spell({ empowered: true, kind: "confringo" }),
      type: "perfect-release",
    });

    expect(progress.done).toBeFalsy();
  });
});

describe("Escudo y Parry", () => {
  it("counts Spells blocked on the learner's Shield against the casting dummy", () => {
    const duel = practiceFor("shield");

    const castOnBeat = (tick: number) =>
      intent({ lightSpell: tick % ticksOf(0.6) === 0, lockOn: tick === 0 });

    const progress = play(
      duel,
      startLesson("shield"),
      ticksOf(3),
      () => shieldUp,
      castOnBeat
    );

    expect(goalOf(progress)).toStrictEqual({
      count: 0,
      goal: "parry",
      target: goals.parry,
    });
  });

  it("ends on a Parry", () => {
    const progress = withEvents(atGoal("shield", 1), {
      duelistId: "learner",
      position: { x: 0, y: 1, z: 5 },
      reflected: spell({ casterId: "learner" }),
      spell: spell(),
      type: "parry",
    });

    expect(progress.done).toBeTruthy();
  });
});

describe("Esquiva", () => {
  it("counts Dodges with ○, then a Perfect Dodge", () => {
    const duel = practiceFor("dodge");

    const dodges = play(
      duel,
      startLesson("dodge"),
      ticksOf(3),
      tapping(intent({ dodge: true }))
    );

    expect(goalOf(dodges).goal).toBe("perfectDodge");

    const perfect = withEvents(dodges, {
      duelistId: "learner",
      spell: spell(),
      type: "perfect-dodge",
    });

    expect(perfect.done).toBeTruthy();
  });
});

describe("Hechizos especiales", () => {
  it("starts the learner with full Focus", () => {
    const learner = practiceFor("specials")
      .snapshot()
      .duelists.find((each) => each.id === "learner");

    expect(learner?.focus).toBe(tuning.focus.max);
  });

  it("starts the other lessons' learners with no Focus", () => {
    const learner = practiceFor("light")
      .snapshot()
      .duelists.find((each) => each.id === "learner");

    expect(learner?.focus).toBe(0);
  });

  it("counts Special Spells cast with R2 and a face button", () => {
    const duel = practiceFor("specials");
    const slot = slotOf("depulso");
    const cast = tapping(intent({ spellSlots: { held: true, press: slot } }));
    const once = play(duel, startLesson("specials"), 2, cast);

    expect(goalOf(once).count).toBe(1);
  });
});

describe("Pociones", () => {
  it("counts the Potions drunk with L2 and a face button, once down", () => {
    const duel = practiceFor("potions");
    const slot = slotOf("wiggenweld");
    const press = intent({ potionSlots: { held: true, press: slot } });
    const hold = intent({ potionSlots: { held: true, press: null } });

    const drinking = play(duel, startLesson("potions"), 2, (tick) =>
      tick === 0 ? press : hold
    );

    expect(goalOf(drinking).count).toBe(0);

    const drunk = play(duel, drinking, ticksOf(1.2), () => idleIntent);

    expect(goalOf(drunk).count).toBe(1);
  });
});

describe("Clash", () => {
  it("ends on a Clash the learner wins, not on one that explodes", () => {
    const clash = {
      along: 0.5,
      point: { x: 0, y: 1, z: 0 },
      secondsLeft: 0,
      sides: [
        {
          duelistId: "learner",
          spell: spell({ casterId: "learner" }),
          wand: { x: 0, y: 1, z: 5 },
        },
        { duelistId: "rival", spell: spell(), wand: { x: 0, y: 1, z: -5 } },
      ],
    } as const;

    const exploded = withEvents(startLesson("clash"), {
      clash,
      outcome: "exploded",
      position: clash.point,
      type: "clash-end",
      winnerId: null,
    });

    expect(exploded.done).toBeFalsy();

    const won = withEvents(exploded, {
      clash,
      outcome: "won",
      position: clash.point,
      type: "clash-end",
      winnerId: "learner",
    });

    expect(won.done).toBeTruthy();
  });
});

describe("Desarmado", () => {
  const disarm: DuelEvent = {
    casterId: "rival",
    duelistId: "learner",
    landing: { x: 2, z: 5 },
    position: { x: 0, y: 1, z: 5 },
    type: "disarm",
  };

  it("counts being Disarmed, then picking the Wand back up", () => {
    const disarmed = withEvents(startLesson("disarmed"), disarm);

    expect(goalOf(disarmed).goal).toBe("pickup");

    const pickedUp = withEvents(disarmed, {
      duelistId: "learner",
      how: "pickup",
      position: { x: 2, y: 0, z: 5 },
      type: "wand-recovered",
    });

    expect(pickedUp.done).toBeTruthy();
  });

  it("does not count a Wand that flew home on its own", () => {
    const progress = withEvents(atGoal("disarmed", 1), {
      duelistId: "learner",
      how: "return",
      position: { x: 2, y: 1, z: 5 },
      type: "wand-recovered",
    });

    expect(progress.done).toBeFalsy();
  });
});

describe("a finished lesson", () => {
  it("stays finished whatever happens next", () => {
    const done = withEvents(atGoal("disarmed", 1), {
      duelistId: "learner",
      how: "pickup",
      position: { x: 2, y: 0, z: 5 },
      type: "wand-recovered",
    });

    expect(withEvents(done, { duelistId: "learner", type: "jump" })).toBe(done);
  });
});
