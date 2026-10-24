import { writeWithIcons } from "./button-icons";
import { createControlsHelp } from "./controls-help";
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
  // The title's veil over everything: one click anywhere starts the game.
  const veil = document.createElement("button");
  const veilLine = document.createElement("span");
  veil.className = "overlay-veil";
  veil.append(veilLine);
  // The fan-game disclaimer, at the foot of the title (menu.css).
  const legal = document.createElement("p");
  legal.className = "overlay-legal";
  legal.textContent = text.legal;
  // The Controls' tab bar and open tab (controls-help.ts).
  const help = createControlsHelp();
  element.append(heading, help.tabs, body, items, help.panel, veil, legal);
  let shown: string | undefined;

  /**
   * Hands menu.css the height of what this screen lays out, so it can centre
   * it on the screen. The title lays out only its click line, which sits
   * under the logo instead. The click hint comes and goes on its own: it
   * hangs below, uncounted.
   */
  const measure = () => {
    const laidOut = [...element.children].filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement &&
        child.matches("h2, p:not([class]), ul, .overlay-tabs, .overlay-help") &&
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

  /**
   * A new screen's content enters (menu.css): fading up, its entries one
   * after another; off the title, only once the click line has faded and
   * the logo is on its way. A step within a screen redraws without it.
   */
  const enter = (screen: ScreenView["screen"]) => {
    const before = element.dataset.screen;

    if (before === screen) {
      element.classList.remove("entering");

      return;
    }

    element.style.setProperty(
      "--enter-delay",
      before === "title" ? "260ms" : "0ms"
    );
    element.classList.remove("entering");
    // Restarts the entrance even if the last one is still playing.
    void element.offsetWidth;
    element.classList.add("entering");
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
      enter(view.screen);
      element.dataset.screen = view.screen;
      heading.textContent = view.heading;
      heading.hidden = view.heading === text.title;
      writeWithIcons(body, view.body ?? "");
      body.hidden = view.body === undefined;
      // The veil keeps its words while it fades out.
      veilLine.textContent = view.action ?? veilLine.textContent;
      veil.classList.toggle("shown", view.action !== undefined);
      veil.disabled = view.action === undefined;
      items.replaceChildren(
        ...(view.items ?? []).map((item, index) => {
          const entry = document.createElement("li");
          entry.textContent = item.label;
          entry.className = item.selected ? "selected" : "";
          entry.classList.toggle("disabled", item.disabled === true);
          entry.ariaDisabled = item.disabled ? "true" : null;
          entry.style.setProperty("--entry", String(index));

          return entry;
        })
      );
      items.hidden = view.items === undefined;
      help.show(view);
      element.hidden = false;
      menu.hidden = false;
      measure();
    },
  };
};
