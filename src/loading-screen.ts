import { text } from "./text";

/**
 * The loading screen: the menu frame's logo, whose two Spells grow toward
 * their Clash with the real loading (the renderer, the wizard's bytes, the
 * shaders), shown from the first paint (its markup is in `index.html`, its
 * look in the linked `menu.css` and `logo.css`, so nothing else has to load
 * first). When the game is ready the beams meet, the Clash bursts and its
 * light reveals the first screen under the logo, which never moves.
 */
export const createLoadingScreen = (menu: HTMLElement) => {
  const logo = menu.querySelector<SVGElement>(".logo");
  const bar = menu.querySelector<HTMLElement>("#loading");

  // No visible label (the user's call): the bar's name is for screen readers.
  if (bar) {
    bar.ariaLabel = text.loading;
  }

  let shown = 0;

  /** Never moves back: `share` of the loading done, 0 to 1. */
  const progress = (share: number) => {
    shown = Math.max(shown, Math.min(Math.max(share, 0), 1));
    logo?.style.setProperty("--progress", String(shown));

    if (bar) {
      bar.ariaValueNow = String(Math.round(shown * 100));
    }
  };

  return {
    /**
     * The game is ready: the beams meet and the Clash bursts, revealing the
     * screen under the logo. The intro ends when the last of it has faded in
     * (menu.css), so showing or hiding the menu later never replays it.
     */
    done: () => {
      progress(1);
      bar?.remove();
      menu.dataset.intro = "clash";

      const end = (event: AnimationEvent) => {
        if (event.animationName === "menu-reveal-last") {
          menu.removeEventListener("animationend", end);
          menu.removeEventListener("animationcancel", end);
          delete menu.dataset.intro;
        }
      };

      // Cancelled too: a Duel can start (hiding the menu) before it ends.
      menu.addEventListener("animationend", end);
      menu.addEventListener("animationcancel", end);
    },
    progress,
  };
};
