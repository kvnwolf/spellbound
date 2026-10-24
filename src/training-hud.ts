/**
 * The Training lesson's part of the Duel HUD, top-centre: which lesson of
 * the ten, and under it the goal on show with its button (face buttons as
 * their icons) and its count, "Acierta Stupefy con □ (1/3)". Once the
 * lesson is completed the goal gives way to "¡Lección completada!", or
 * "¡Entrenamiento completado!" after the last. Only touches the DOM when
 * what it shows changes.
 */
import "./training-hud.css";
import { writeWithIcons } from "./button-icons";
import { goalOf, lessons } from "./duel/training";
import type { Lesson, LessonProgress } from "./duel/training";
import { text } from "./text";
import type { Tuning } from "./tuning";

/** What the Training HUD shows: the lesson's progress and whether its call-out is on. */
export interface TrainingHudState {
  readonly progress: LessonProgress;
  /** The lesson is completed and its call-out holds. */
  readonly done: boolean;
}

const create = (tag: string, className: string, parent: HTMLElement) => {
  const created = document.createElement(tag);
  created.className = className;
  parent.append(created);

  return created;
};

/** The counter's units, for the goals counted in metres or degrees. */
const units: Partial<Record<string, string>> = text.training.units;

/** "Lección 3 de 10 · Hechizo ligero". */
const titleOf = (lesson: Lesson) =>
  `${text.training.lessonCount(lessons.indexOf(lesson) + 1, lessons.length)} · ${text.training.lessons[lesson]}`;

export const createTrainingHud = (
  root: HTMLElement,
  settings: Pick<Tuning, "training">
) => {
  const panel = create("div", "training-hud", root);
  const lessonLine = create("div", "training-lesson", panel);
  const goalLine = create("div", "training-goal", panel);
  panel.hidden = true;
  let shown: string | undefined;

  const goalText = (progress: LessonProgress) => {
    const { count, goal, target } = goalOf(progress, settings);

    return `${text.training.goals[goal]} ${text.training.counter(Math.floor(count), target, units[goal])}`;
  };

  return {
    show: (state: TrainingHudState | undefined) => {
      const lesson = state?.progress.lesson;
      let line = "";

      if (state && lesson) {
        const finale = lesson === lessons.at(-1);

        if (state.done) {
          line = finale ? text.training.trainingDone : text.training.lessonDone;
        } else {
          line = goalText(state.progress);
        }
      }

      const key = `${lesson ?? ""}|${String(state?.progress.goal)}|${line}`;

      if (key === shown) {
        return;
      }

      const goalChanged =
        shown !== undefined &&
        state !== undefined &&
        !shown.startsWith(`${lesson ?? ""}|${String(state.progress.goal)}|`);

      shown = key;
      panel.hidden = !state;

      if (!state || !lesson) {
        return;
      }

      lessonLine.textContent = titleOf(lesson);
      writeWithIcons(goalLine, line);
      panel.classList.toggle("training-done", state.done);

      // A new goal (or the call-out) punches in; a count ticking up does not.
      if (goalChanged || state.done) {
        goalLine.classList.remove("training-enter");
        void goalLine.offsetWidth;
        goalLine.classList.add("training-enter");
      }
    },
  };
};
