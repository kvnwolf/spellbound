import type { ScreenView } from "./screens/view";
import { text } from "./text";

/**
 * A screen's content in the menu frame (`#menu`, menu.css), under the logo:
 * the menus, the pause, the result and the unsupported-browser message,
 * drawn from a `ScreenView`. The frame is opaque, so while it shows nothing
 * of the scene does; hiding it leaves the Duel and its HUD.
 */
export const createOverlay = (element: HTMLElement) => {
  const menu = element.closest<HTMLElement>("#menu") ?? element;
  // The title screens' heading is the logo itself; the others get their own.
  const heading = document.createElement("h2");
  const body = document.createElement("p");
  const items = document.createElement("ul");
  const hint = document.createElement("p");
  hint.className = "overlay-hint";
  const action = document.createElement("button");
  action.className = "overlay-action";
  // The fan-game disclaimer, at the foot of the title (menu.css).
  const legal = document.createElement("p");
  legal.className = "overlay-legal";
  legal.textContent = text.legal;
  element.append(heading, body, items, action, hint, legal);
  let shown: string | undefined;

  return {
    hide: () => {
      menu.hidden = true;
      shown = undefined;
    },
    /** Calls `listener` when the screen's action button is clicked. */
    onAction: (listener: () => void) => {
      action.addEventListener("click", listener);
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
      heading.hidden = view.heading === text.title;
      body.textContent = view.body ?? "";
      body.hidden = view.body === undefined;
      hint.textContent = view.hint ?? "";
      hint.hidden = view.hint === undefined;
      action.textContent = view.action ?? "";
      action.hidden = view.action === undefined;
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
      menu.hidden = false;
    },
  };
};
