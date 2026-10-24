/**
 * The Training lesson's part of the Duel HUD, top-centre: which lesson of
 * the eighteen, and under it the goal on show with its buttons (face
 * buttons and D-pad arrows as their icons) and its count, "Acierta Stupefy
 * con □ (1/3)". Once the lesson is completed the goal gives way to
 * "¡Lección completada!" for a moment, before its success scroll. Only
 * touches the DOM when what it shows changes.
 */
import "./training-hud.css";
import { writeWithIcons } from "./button-icons";
import { lessons } from "./duel/training";
import type { Lesson, LessonProgress } from "./duel/training";
import { goalLineOf } from "./screens/view";
import { text } from "./text";

const create = (tag: string, className: string, parent: HTMLElement) => {
  const created = document.createElement(tag);
  created.className = className;
  parent.append(created);

  return created;
};

/** "Lección 3 de 17 · Stupefy". */
const titleOf = (lesson: Lesson) =>
  `${text.training.lessonCount(lessons.indexOf(lesson) + 1, lessons.length)} · ${text.training.lessons[lesson]}`;

export const createTrainingHud = (root: HTMLElement) => {
  const panel = create("div", "training-hud", root);
  const lessonLine = create("div", "training-lesson", panel);
  const goalLine = create("div", "training-goal", panel);
  panel.hidden = true;
  let shown: string | undefined;

  return {
    /** The lesson's progress, or nothing outside Training. */
    show: (progress: LessonProgress | undefined) => {
      const line = progress ? goalLineOf(progress) : "";
      const key = `${progress?.lesson ?? ""}|${String(progress?.goal)}|${line}`;

      if (key === shown) {
        return;
      }

      const goalChanged =
        shown !== undefined &&
        progress !== undefined &&
        !shown.startsWith(`${progress.lesson}|${String(progress.goal)}|`);

      shown = key;
      panel.hidden = !progress;

      if (!progress) {
        return;
      }

      lessonLine.textContent = titleOf(progress.lesson);
      writeWithIcons(goalLine, line);
      panel.classList.toggle("training-done", progress.done);

      // A new goal (or the call-out) punches in; a count ticking up does not.
      if (goalChanged || progress.done) {
        goalLine.classList.remove("training-enter");
        void goalLine.offsetWidth;
        goalLine.classList.add("training-enter");
      }
    },
  };
};
