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
  // The title's veil over everything: one click anywhere starts the game.
  const veil = document.createElement("button");
  const veilLine = document.createElement("span");
  veil.className = "overlay-veil";
  veil.append(veilLine);
  // The fan-game disclaimer, at the foot of the title (menu.css).
  const legal = document.createElement("p");
  legal.className = "overlay-legal";
  legal.textContent = text.legal;
  element.append(heading, body, items, hint, veil, legal);
  let shown: string | undefined;

  /**
   * Hands menu.css the height of what this screen lays out under the logo,
   * so it can centre the logo and that together on the screen. The title
   * lays out only the veil's line, which menu.css already holds room for
   * (as loading does, so the logo never moves between them). The click hint
   * comes and goes on its own: it hangs below, uncounted.
   */
  const measure = () => {
    const laidOut = [...element.children].filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement &&
        child.matches("h2, p:not([class]), ul, .overlay-hint") &&
        child.offsetParent !== null
    );

    const top = Math.min(...laidOut.map((child) => child.offsetTop));

    const bottom = Math.max(
      ...laidOut.map((child) => child.offsetTop + child.offsetHeight)
    );

    if (veil.classList.contains("shown")) {
      menu.style.removeProperty("--content-height");
    } else {
      const flow = laidOut.length > 0 ? bottom - top : 0;
      menu.style.setProperty("--content-height", `${String(flow)}px`);
    }
  };

  return {
    hide: () => {
      menu.hidden = true;
      shown = undefined;
    },
    /** Calls `listener` when the screen's action (the title's veil) is clicked. */
    onAction: (listener: () => void) => {
      veil.addEventListener("click", listener);
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
      // The veil keeps its words while it fades out.
      veilLine.textContent = view.action ?? veilLine.textContent;
      veil.classList.toggle("shown", view.action !== undefined);
      veil.disabled = view.action === undefined;
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
      measure();
    },
  };
};
