/**
 * What the player has done in Training, remembered in this browser's
 * localStorage: the lessons completed, as their names, and whether the
 * player has been welcomed to the Club de Duelo. Storage can be missing,
 * blocked or full (a private window, cleared site data): then nothing is
 * remembered and Training still plays (and must be played again to open
 * Duelo and Práctica).
 */
import { lessons } from "./duel/training";
import { noTraining } from "./screens/screens";
import type { TrainingRecord } from "./screens/screens";

const completedKey = "spellbound.training.completed";
const certifiedKey = "spellbound.training.certified";
const certifiedValue = "yes";

/** What was remembered, or nothing; a name that is no lesson is ignored. */
export const loadTraining = (): TrainingRecord => {
  try {
    const names = (localStorage.getItem(completedKey) ?? "").split(" ");

    return {
      certified: localStorage.getItem(certifiedKey) === certifiedValue,
      completed: lessons.filter((lesson) => names.includes(lesson)),
    };
  } catch {
    return noTraining;
  }
};

/** Remembers `record`, if storage lets it. */
export const saveTraining = (record: TrainingRecord) => {
  try {
    localStorage.setItem(completedKey, record.completed.join(" "));

    if (record.certified) {
      localStorage.setItem(certifiedKey, certifiedValue);
    } else {
      localStorage.removeItem(certifiedKey);
    }
  } catch {
    // Not remembered this time; Training plays on regardless.
  }
};
