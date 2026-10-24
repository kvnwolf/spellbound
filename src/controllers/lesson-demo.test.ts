/**
 * The lesson demos through the Duel seam: each lesson's demo, its scripted
 * learner against the lesson's own Training Dummy in the courtyard, is
 * played tick by tick and Training watches it as it watches a player. A
 * demo shows its lesson only if it meets every one of the lesson's goals
 * within one loop.
 */
import { describe, expect, it } from "vitest";

import { courtyard } from "../arena/courtyard";
import { createDuel } from "../duel/duel";
import type { DuelEvent, DuelSnapshot } from "../duel/duel";
import { idleIntent } from "../duel/intent";
import { advanceLesson, lessons, startLesson } from "../duel/training";
import type { Lesson } from "../duel/training";
import { tuning } from "../tuning";
import {
  createDemoControllers,
  demoDuelConfig,
  demoLearner,
} from "./lesson-demo";

/** Every Duelist's Intent for the next tick, from its Controller. */
const intentsOf = (
  controllers: ReturnType<typeof createDemoControllers>,
  snapshot: DuelSnapshot
) =>
  Object.fromEntries(
    snapshot.duelists.map((each) => [
      each.id,
      controllers.get(each.id)?.intent({ self: each.id, snapshot }) ??
        idleIntent,
    ])
  );

/** Plays one loop of `lesson`'s demo: Training's progress at its end, and every event. */
const playLoop = (lesson: Lesson) => {
  const duel = createDuel(demoDuelConfig(lesson, courtyard, tuning));
  const controllers = createDemoControllers(lesson, courtyard, tuning);

  const ticks = Math.round(
    tuning.lessonDemo.loopSeconds[lesson] * tuning.tickRate
  );

  let progress = startLesson(lesson);
  let doneAt: number | undefined;
  const events: DuelEvent[] = [];
  let snapshot = duel.snapshot();

  for (let tick = 0; tick < ticks; tick += 1) {
    const before = snapshot;
    const result = duel.step(intentsOf(controllers, before));
    ({ snapshot } = result);
    progress = advanceLesson(
      progress,
      { after: snapshot, before, events: result.events },
      demoLearner,
      tuning
    );
    doneAt ??= progress.done ? tick / tuning.tickRate : undefined;
    events.push(...result.events);
  }

  return { doneAt, events, progress };
};

describe("the lesson demos", () => {
  it.each(lessons)(
    "plays %s through to every goal within one loop",
    (lesson) => {
      const { doneAt, progress } = playLoop(lesson);

      expect({ lesson, progress }).toMatchObject({ progress: { done: true } });
      // Done with a moment to spare, so the loop does not cut it off.
      expect(doneAt).toBeLessThan(tuning.lessonDemo.loopSeconds[lesson] - 0.3);
    }
  );

  it("plays the same every loop", () => {
    for (const lesson of ["shield", "clash", "disarmed"] as const) {
      expect(playLoop(lesson).events).toStrictEqual(playLoop(lesson).events);
    }
  });

  it("never lets the learner Backfire or be Knocked Out", () => {
    for (const lesson of lessons) {
      const { events } = playLoop(lesson);

      expect(
        events.filter(
          (event) =>
            (event.type === "backfire" && event.duelistId === demoLearner) ||
            event.type === "knockout"
        )
      ).toStrictEqual([]);
    }
  });
});
