/**
 * What the player has done in Training, remembered in this browser's
 * localStorage: the lessons completed, as their names, and whether Training
 * has been played through. Storage can be missing, blocked or full (a
 * private window, cleared site data): then nothing is remembered and
 * Training still plays.
 */
import { lessons } from "./duel/training";
import { noTraining } from "./screens/screens";
import type { TrainingRecord } from "./screens/screens";

const completedKey = "spellbound.training.completed";
const finishedKey = "spellbound.training.finished";
const finishedValue = "yes";

/** What was remembered, or nothing; a name that is no lesson is ignored. */
export const loadTraining = (): TrainingRecord => {
  try {
    const names = (localStorage.getItem(completedKey) ?? "").split(" ");

    return {
      completed: lessons.filter((lesson) => names.includes(lesson)),
      finished: localStorage.getItem(finishedKey) === finishedValue,
    };
  } catch {
    return noTraining;
  }
};

/** Remembers `record`, if storage lets it. */
export const saveTraining = (record: TrainingRecord) => {
  try {
    localStorage.setItem(completedKey, record.completed.join(" "));

    if (record.finished) {
      localStorage.setItem(finishedKey, finishedValue);
    } else {
      localStorage.removeItem(finishedKey);
    }
  } catch {
    // Not remembered this time; Training plays on regardless.
  }
};
