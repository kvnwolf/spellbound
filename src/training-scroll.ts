/**
 * The Training scrolls, a sheet of parchment unrolled over the frozen
 * lesson: the lesson's own before it starts (its name, what it teaches,
 * when to use it and its buttons), its success once completed, and the Club
 * de Duelo's welcome once every lesson is. Drawn from a `ScrollView`; face
 * buttons and D-pad arrows are drawn as their icons. Only touches the DOM
 * when what it shows changes.
 */
import "./training-scroll.css";
import { writeWithIcons } from "./button-icons";
import type { ScrollView } from "./screens/view";
import { text } from "./text";

const create = (tag: string, className: string, parent?: HTMLElement) => {
  const created = document.createElement(tag);
  created.className = className;
  parent?.append(created);

  return created;
};

export const createTrainingScroll = (root: HTMLElement) => {
  const veil = create("div", "scroll-veil", root);
  const sheet = create("section", "scroll-sheet", veil);
  sheet.setAttribute("role", "dialog");
  create("div", "scroll-rod scroll-rod-top", sheet);
  const body = create("div", "scroll-body", sheet);
  const eyebrow = create("p", "scroll-eyebrow", body);
  const heading = create("h2", "scroll-heading", body);
  const rule = create("div", "scroll-rule", body);
  rule.setAttribute("aria-hidden", "true");
  const paragraphs = create("div", "scroll-paragraphs", body);
  const controls = create("p", "scroll-controls", body);
  const seal = create("div", "scroll-seal", body);
  seal.setAttribute("aria-hidden", "true");
  const items = create("ul", "scroll-items", body);
  create("div", "scroll-rod scroll-rod-bottom", sheet);
  veil.hidden = true;
  let shown: string | undefined;

  return {
    show: (view: ScrollView | undefined) => {
      const key = view === undefined ? "" : JSON.stringify(view);

      if (key === shown) {
        return;
      }

      // A new scroll unrolls; moving the highlight on one does not.
      const unrolls = view !== undefined && sheet.dataset.kind !== view.kind;
      shown = key;
      veil.hidden = view === undefined;

      if (!view) {
        delete sheet.dataset.kind;

        return;
      }

      sheet.dataset.kind = view.kind;
      sheet.setAttribute("aria-label", view.heading);
      eyebrow.textContent = view.eyebrow ?? "";
      eyebrow.hidden = view.eyebrow === undefined;
      heading.textContent = view.heading;
      paragraphs.replaceChildren(
        ...view.paragraphs.map((line) => {
          const paragraph = create("p", "scroll-paragraph");
          writeWithIcons(paragraph, line);

          return paragraph;
        })
      );
      writeWithIcons(controls, view.controls ?? "");
      controls.hidden = view.controls === undefined;
      seal.hidden = view.kind !== "certificate";
      seal.textContent =
        view.kind === "certificate" ? (text.title[0] ?? "") : "";
      items.replaceChildren(
        ...view.items.map((item) => {
          const entry = create("li", item.selected ? "selected" : "");
          entry.textContent = item.label;

          return entry;
        })
      );

      if (unrolls) {
        sheet.classList.remove("scroll-unroll");
        void sheet.offsetWidth;
        sheet.classList.add("scroll-unroll");
      }
    },
  };
};
