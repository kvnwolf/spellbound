/**
 * The Duel HUD: a DOM overlay that reads the simulation snapshot. Along the
 * top, both Duelists' Health bars with the Round and score between them; in
 * the middle, the call-outs (the "3, 2, 1, ¡Duelo!" countdown, the Knockout
 * and each Round's result). It only writes to the DOM when what it shows
 * changes, since it runs every frame.
 */
import type { DuelEvent, DuelistId, DuelSnapshot, TeamId } from "./duel/duel";
import { text } from "./text";

export interface HudSettings {
  readonly maxHealth: number;
  readonly roundsToWin: number;
  /** How long "¡Duelo!" stays up once control is given, in seconds. */
  readonly duelCalloutSeconds: number;
  /** How long the pale "damage taken" part of a Health bar lingers before draining. */
  readonly healthLagDelay: number;
  /** How fast the lingering part drains, in Health per second. */
  readonly healthLagRate: number;
}

export interface Hud {
  readonly show: (
    snapshot: DuelSnapshot,
    events: readonly DuelEvent[],
    seconds: number
  ) => void;
}

const create = (tag: string, className: string, parent?: HTMLElement) => {
  const element = document.createElement(tag);
  element.className = className;
  parent?.append(element);

  return element;
};

/** One Duelist's name and Health bar, with a pale trailing segment for damage just taken. */
const createHealthBar = (
  parent: HTMLElement,
  side: "local" | "rival",
  name: string,
  settings: HudSettings
) => {
  const root = create("div", `hud-duelist hud-${side}`, parent);
  create("span", "hud-name", root).textContent = name;
  const bar = create("div", "hud-bar", root);
  const lag = create("div", "hud-bar-lag", bar);
  const fill = create("div", "hud-bar-fill", bar);
  let shown = settings.maxHealth;
  let lagging = settings.maxHealth;
  let holdLag = 0;

  return {
    show: (health: number, seconds: number) => {
      if (health < shown) {
        holdLag = settings.healthLagDelay;
        bar.animate(
          [
            { filter: "brightness(2.2)", transform: "translateX(-3px)" },
            { filter: "brightness(1)", transform: "translateX(0)" },
          ],
          { duration: 220, easing: "ease-out" }
        );
      }

      if (health > lagging) {
        // Health refilled (a new Round): no trailing damage to show.
        lagging = health;
      } else if (holdLag > 0) {
        holdLag -= seconds;
      } else {
        lagging = Math.max(lagging - settings.healthLagRate * seconds, health);
      }

      if (health !== shown) {
        shown = health;
        fill.style.width = `${(health / settings.maxHealth) * 100}%`;
      }

      lag.style.width = `${(lagging / settings.maxHealth) * 100}%`;
    },
  };
};

/** Round pips for one Team: lit for every Round won. */
const createPips = (parent: HTMLElement, settings: HudSettings) => {
  const root = create("div", "hud-pips", parent);

  const pips = Array.from({ length: settings.roundsToWin }, () =>
    create("span", "hud-pip", root)
  );

  return {
    show: (won: number) => {
      for (const [index, pip] of pips.entries()) {
        pip.classList.toggle("hud-pip-won", index < won);
      }
    },
  };
};

/** What the centre of the screen says: a big heading over an optional small line. */
interface Callout {
  readonly heading: string;
  readonly detail?: string;
}

/** The big centred message, popping in whenever it changes. */
const createCallout = (parent: HTMLElement) => {
  const root = create("div", "hud-callout", parent);
  const small = create("span", "hud-callout-small", root);
  const big = create("span", "hud-callout-big", root);
  let shown = "";

  return {
    show: (heading: string, detail = "") => {
      const key = `${detail}\n${heading}`;

      if (key === shown) {
        return;
      }

      shown = key;
      small.textContent = detail;
      big.textContent = heading;
      root.hidden = heading === "";

      if (heading !== "") {
        big.animate(
          [
            { opacity: 0, transform: "scale(1.6)" },
            { opacity: 1, transform: "scale(1)" },
          ],
          { duration: 260, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }
        );
      }
    },
  };
};

export const createHud = (
  root: HTMLElement,
  localId: DuelistId,
  settings: HudSettings
): Hud => {
  const top = create("header", "hud-top", root);
  const local = createHealthBar(top, "local", text.hud.local, settings);
  const centre = create("div", "hud-round", top);
  const roundLabel = create("span", "hud-round-label", centre);
  const score = create("div", "hud-score", centre);
  const localPips = createPips(score, settings);
  const rivalPips = createPips(score, settings);
  const rival = createHealthBar(top, "rival", text.hud.rival, settings);
  const callout = createCallout(root);
  let duelCallout = 0;

  /** The message for the Round's phase, from the local Duelist's point of view. */
  const message = (
    snapshot: DuelSnapshot,
    localTeam: TeamId | undefined
  ): Callout => {
    const { round } = snapshot;

    if (round.phase === "intro") {
      // "3", "2", "1" over the intro's three seconds.
      return {
        detail: text.hud.round(round.number),
        heading: `${Math.max(Math.ceil(round.phaseSecondsLeft), 1)}`,
      };
    }

    if (round.phase === "fighting") {
      return { heading: duelCallout > 0 ? text.hud.duel : "" };
    }

    if (round.phase === "knockout") {
      return { heading: text.hud.knockout };
    }

    if (round.phase === "result" && round.winner === null) {
      return { heading: text.hud.draw };
    }

    if (round.phase === "result") {
      return {
        heading:
          round.winner === localTeam ? text.hud.roundWon : text.hud.roundLost,
      };
    }

    return {
      heading:
        snapshot.winner === localTeam ? text.hud.victory : text.hud.defeat,
    };
  };

  return {
    show: (snapshot, events, seconds) => {
      const self = snapshot.duelists.find((each) => each.id === localId);
      const opponent = snapshot.duelists.find((each) => each.id !== localId);

      if (events.some((event) => event.type === "round-start")) {
        duelCallout = settings.duelCalloutSeconds;
      }

      duelCallout = Math.max(duelCallout - seconds, 0);

      local.show(self?.health ?? 0, seconds);
      rival.show(opponent?.health ?? 0, seconds);
      localPips.show(self ? (snapshot.score[self.team] ?? 0) : 0);
      rivalPips.show(opponent ? (snapshot.score[opponent.team] ?? 0) : 0);

      const label = text.hud.round(snapshot.round.number);

      if (roundLabel.textContent !== label) {
        roundLabel.textContent = label;
      }

      const { heading, detail } = message(snapshot, self?.team);
      callout.show(heading, detail);
    },
  };
};
