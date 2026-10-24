/**
 * Entrenamiento's lesson menu, drawn from a `LessonsView` in the menu
 * frame: on the left a list of the lessons by section, each numbered and
 * ticked once completed, kept scrolled so the highlight and its neighbours
 * are always in it; on the right a large preview of the highlighted lesson,
 * its live demo playing in a canvas of its own (which the game renders
 * into: see `render/pipeline.ts`), with which lesson of how many, its
 * title, what it teaches in a line and its buttons, drawn as icons.
 */
import "./lesson-menu.css";
import { writeWithIcons } from "./button-icons";
import type { LessonsView } from "./screens/view";
import { text } from "./text";

const create = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  parent?: HTMLElement
) => {
  const created = document.createElement(tag);
  created.className = className;
  parent?.append(created);

  return created;
};

export interface LessonMenu {
  /** The canvas the preview's demo is rendered into. */
  readonly canvas: HTMLCanvasElement;
  /** Its laid-out size, CSS pixels: what the demo is rendered at. */
  readonly canvasSize: () => {
    readonly width: number;
    readonly height: number;
  };
  /** Draws `view`, or hides the menu. */
  readonly show: (view: LessonsView | undefined) => void;
  /** Dips the demo through black for a moment: its loop starts again, or the lesson changed. */
  readonly blink: () => void;
}

export const createLessonMenu = (parent: HTMLElement): LessonMenu => {
  const root = create("div", "lesson-menu", parent);
  const header = create("header", "lesson-menu-header", root);
  const title = create("h2", "lesson-menu-title", header);
  title.textContent = text.training.heading;
  const progress = create("p", "lesson-menu-progress", header);
  const list = create("div", "lesson-list", root);
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", text.training.heading);
  const preview = create("section", "lesson-preview", root);
  const stage = create("div", "lesson-preview-stage", preview);
  const canvas = create("canvas", "lesson-preview-canvas", stage);
  const shade = create("div", "lesson-preview-shade", stage);
  shade.setAttribute("aria-hidden", "true");
  const details = create("div", "lesson-preview-details", preview);
  const eyebrow = create("p", "lesson-preview-eyebrow", details);
  const which = create("span", "lesson-preview-which", eyebrow);
  const heading = create("h3", "lesson-preview-heading", details);
  const body = create("p", "lesson-preview-body", details);
  const controls = create("p", "lesson-preview-controls", details);
  const done = create("span", "lesson-preview-done", eyebrow);
  root.hidden = true;

  let size = { height: 0, width: 0 };

  new ResizeObserver(([entry]) => {
    if (entry) {
      size = {
        height: entry.contentRect.height,
        width: entry.contentRect.width,
      };
    }
  }).observe(canvas);

  /** The list built once, its entries by lesson; later views only mark them. */
  const entries = new Map<string, HTMLElement>();
  let built = false;

  const build = (view: LessonsView) => {
    let index = 0;

    for (const section of view.sections) {
      const group = create("div", "lesson-section", list);
      group.setAttribute("role", "group");
      const label = create("p", "lesson-section-heading", group);
      label.textContent = section.heading;
      group.setAttribute("aria-label", section.heading);

      for (const lesson of section.lessons) {
        const entry = create("div", "lesson-entry", group);
        entry.setAttribute("role", "option");
        entry.style.setProperty("--entry", String(index));
        index += 1;
        const number = create("span", "lesson-entry-number", entry);
        number.textContent = lesson.number;
        const name = create("span", "lesson-entry-label", entry);
        name.textContent = lesson.label;
        const tick = create("span", "lesson-entry-done", entry);
        tick.textContent = text.training.done;
        entries.set(lesson.lesson, entry);
      }
    }

    built = true;
  };

  /**
   * Keeps the highlighted entry in the list's view with a neighbour either
   * side (its section's heading above the first of a section), so the list
   * pages along as the highlight moves.
   */
  const reveal = (entry: HTMLElement) => {
    const group = entry.parentElement;
    const first = group?.querySelector(".lesson-entry") === entry;
    const above = first ? group : (entry.previousElementSibling ?? entry);

    const below =
      entry.nextElementSibling ?? group?.nextElementSibling ?? entry;

    if (!(above instanceof HTMLElement) || !(below instanceof HTMLElement)) {
      return;
    }

    // Where they sit in the list's scrolled content.
    const origin = list.getBoundingClientRect().top - list.scrollTop;
    const top = above.getBoundingClientRect().top - origin;

    const bottom =
      below.getBoundingClientRect().top -
      origin +
      Math.min(below.offsetHeight, entry.offsetHeight * 1.5);

    if (top < list.scrollTop) {
      list.scrollTop = top;
    } else if (bottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = bottom - list.clientHeight;
    }
  };

  let lastKey: string | undefined;

  // A resized window keeps the highlight in the list's view too.
  new ResizeObserver(() => {
    const selected = list.querySelector<HTMLElement>(".lesson-entry.selected");

    if (selected) {
      reveal(selected);
    }
  }).observe(list);

  return {
    blink: () => {
      shade.classList.remove("blink");
      void shade.offsetWidth;
      shade.classList.add("blink");
    },
    canvas,
    canvasSize: () => size,
    show: (view) => {
      root.hidden = view === undefined;

      if (!view) {
        lastKey = undefined;

        return;
      }

      const key = JSON.stringify(view);

      if (key === lastKey) {
        return;
      }

      lastKey = key;

      if (!built) {
        build(view);
      }

      progress.textContent = view.progress;

      for (const section of view.sections) {
        for (const lesson of section.lessons) {
          const entry = entries.get(lesson.lesson);
          entry?.classList.toggle("selected", lesson.selected);
          entry?.classList.toggle("done", lesson.done);
          entry?.setAttribute("aria-selected", String(lesson.selected));
        }
      }

      const { preview: shown } = view;
      which.textContent = shown.eyebrow;
      done.textContent = shown.done
        ? `${text.training.done} ${text.training.completed}`
        : "";
      done.hidden = !shown.done;
      heading.textContent = shown.heading;
      writeWithIcons(body, shown.body);
      writeWithIcons(controls, shown.controls);

      const selected = entries.get(shown.lesson);

      if (selected) {
        reveal(selected);
      }
    },
  };
};
