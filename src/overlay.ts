import type { ScreenView } from "./screens/view";
import { text } from "./text";

/**
 * The full-screen panel over the scene: the title, the menus, the pause and
 * the unsupported-browser message, drawn from a `ScreenView`.
 */
export const createOverlay = (element: HTMLElement) => {
  const heading = document.createElement("h1");
  // The logo from the loading screen's markup (index.html) stands in for the
  // plain title, its beams drawn in full (no loading `--progress` carried over).
  const logo = document.querySelector("#loading .logo")?.cloneNode(true);

  if (logo instanceof SVGElement) {
    logo.style.removeProperty("--progress");
  }

  const body = document.createElement("p");
  const items = document.createElement("ul");
  const hint = document.createElement("p");
  hint.className = "overlay-hint";
  // The fan-game disclaimer, at the foot of every menu.
  const legal = document.createElement("p");
  legal.className = "overlay-legal";
  legal.textContent = text.legal;
  element.append(heading, body, items, hint, legal);
  let shown: string | undefined;

  return {
    hide: () => {
      element.hidden = true;
      shown = undefined;
    },
    show: (view: ScreenView) => {
      const key = JSON.stringify(view);

      // Called every frame: only touch the DOM when the view changes.
      if (shown === key) {
        return;
      }

      shown = key;
      element.dataset.screen = view.screen;
      heading.replaceChildren(
        view.heading === text.title && logo ? logo : view.heading
      );
      body.textContent = view.body ?? "";
      body.hidden = view.body === undefined;
      hint.textContent = view.hint ?? "";
      hint.hidden = view.hint === undefined;
      items.replaceChildren(
        ...(view.items ?? []).map((item) => {
          const entry = document.createElement("li");
          entry.textContent = item.label;
          entry.className = item.selected ? "selected" : "";
          entry.classList.toggle("disabled", item.disabled === true);
          entry.ariaDisabled = item.disabled ? "true" : null;

          return entry;
        })
      );
      items.hidden = view.items === undefined;
      element.hidden = false;
    },
  };
};
