import { text } from "./text";

/**
 * The loading screen, in the menus' style: the title and a progress bar
 * from the real loading (the renderer, the wizard's bytes, the shaders),
 * shown from the first paint (its shell is in `index.html`, styled inline so
 * nothing else has to load first) until the game hands over to the menus.
 */
export const createLoadingScreen = (element: HTMLElement) => {
  const label = element.querySelector(".loading-label");
  const bar = element.querySelector<HTMLElement>(".loading-bar");

  if (label) {
    label.textContent = text.loading;
  }

  let shown = 0;

  return {
    /** The game is ready: the loading screen goes. */
    done: () => {
      element.hidden = true;
    },
    /** Never moves back: `share` of the loading done, 0 to 1. */
    progress: (share: number) => {
      shown = Math.max(shown, Math.min(Math.max(share, 0), 1));
      bar?.style.setProperty("--progress", String(shown));
      element.ariaValueNow = String(Math.round(shown * 100));
    },
  };
};
