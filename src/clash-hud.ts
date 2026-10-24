/**
 * The Clash's part of the Duel HUD, only while the local Duelist is locked
 * in one: "¡Clash!" punched onto the centre as it starts, and under the
 * reticle the pump prompt, a △ button that pulses (and kicks on every
 * pump) over "¡Pulsa △!", with a thin tug-of-war bar showing where the
 * meeting point stands between the two Wands. Reads the snapshot and events
 * and only touches the DOM when what it shows changes.
 */
import "./clash-hud.css";
import { writeWithIcons } from "./button-icons";
import { clashOpponentOf } from "./duel/duel";
import type { DuelEvent, DuelistId, DuelSnapshot } from "./duel/duel";
import { create } from "./slot-diamond";
import { keepTranslated, text } from "./text";
import type { Tuning } from "./tuning";

export interface ClashHud {
  readonly show: (snapshot: DuelSnapshot, events: readonly DuelEvent[]) => void;
}

/** How far the local Duelist has pushed the meeting point from their own Wand toward the opponent's, 0 to 1. */
const pushedShare = (snapshot: DuelSnapshot, localId: DuelistId) => {
  const { clash } = snapshot;

  if (!clash) {
    return 0.5;
  }

  const along = Math.min(Math.max(clash.along, 0), 1);

  return clash.sides[0].duelistId === localId ? along : 1 - along;
};

export const createClashHud = (
  root: HTMLElement,
  localId: DuelistId,
  settings: Tuning["hud"]["clash"]
): ClashHud => {
  const callout = create("div", "clash-callout", root);
  const prompt = create("div", "clash-prompt", root);
  const trigger = create("div", "clash-trigger", prompt);
  const pump = create("div", "clash-pump", prompt);

  keepTranslated(() => {
    callout.textContent = text.clash.callout;
    writeWithIcons(trigger, text.clash.trigger);
    writeWithIcons(pump, text.clash.pump);
  });

  const bar = create("div", "clash-bar", prompt);
  const fill = create("div", "clash-bar-fill", bar);
  const marker = create("div", "clash-bar-marker", bar);
  prompt.hidden = true;

  let shownPercent = -1;

  return {
    show: (snapshot, events) => {
      const inClash =
        snapshot.round.phase === "fighting" &&
        clashOpponentOf(snapshot.clash, localId) !== undefined;

      for (const event of events) {
        if (
          event.type === "clash-start" &&
          clashOpponentOf(event.clash, localId) !== undefined
        ) {
          for (const animation of callout.getAnimations()) {
            animation.cancel();
          }

          callout.animate(
            [
              { opacity: 0, transform: "scale(1.8)" },
              { offset: 0.16, opacity: 1, transform: "scale(1)" },
              { offset: 0.75, opacity: 1, transform: "scale(1)" },
              { opacity: 0, transform: "scale(0.92) translateY(-0.6em)" },
            ],
            {
              duration: settings.calloutSeconds * 1000,
              easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
            }
          );
        }

        if (event.type === "clash-pump" && event.duelistId === localId) {
          trigger.animate(
            [
              { transform: "translateY(0.35em) scale(0.86)" },
              { transform: "translateY(0) scale(1)" },
            ],
            { duration: settings.pumpKickSeconds * 1000, easing: "ease-out" }
          );
        }
      }

      if (prompt.hidden === inClash) {
        prompt.hidden = !inClash;
      }

      // Whole-percent steps: no DOM write for changes nobody could see.
      const percent = Math.round(pushedShare(snapshot, localId) * 100);

      if (inClash && percent !== shownPercent) {
        shownPercent = percent;
        fill.style.width = `${percent}%`;
        marker.style.left = `${percent}%`;
      }
    },
  };
};
