import type { ScreenView } from "./screens/view";

/**
 * The full-screen panel over the scene: the title, the menus, the pause and
 * the unsupported-browser message, drawn from a `ScreenView`.
 */
export const createOverlay = (element: HTMLElement) => {
  const heading = document.createElement("h1");
  const body = document.createElement("p");
  const items = document.createElement("ul");
  const hint = document.createElement("p");
  hint.className = "overlay-hint";
  element.append(heading, body, items, hint);
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
      heading.textContent = view.heading;
      body.textContent = view.body ?? "";
      body.hidden = view.body === undefined;
      hint.textContent = view.hint ?? "";
      hint.hidden = view.hint === undefined;
      items.replaceChildren(
        ...(view.items ?? []).map((item) => {
          const entry = document.createElement("li");
          entry.textContent = item.label;
          entry.className = item.selected ? "selected" : "";

          return entry;
        })
      );
      items.hidden = view.items === undefined;
      element.hidden = false;
    },
  };
};
