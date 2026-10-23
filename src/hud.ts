/**
 * The Duel HUD: a DOM overlay that reads the simulation snapshot and events,
 * keeping the centre clear. Bottom-left, the local Duelist's bars with no
 * labels (a thick Health bar over a thinner blue Stamina bar) beside the Potion
 * Slots; top-centre, only small diamonds for the Rounds each side has won; in
 * the middle, the call-outs (the "3, 2, 1, ¡Duelo!" countdown, "¡Parry!", "¡Desarmado!", the
 * Knockout and each Round's result); and just under the reticle, the name of
 * a Special Spell the local Duelist casts, or "¡Confringo!" on a Perfect
 * Release. It only writes to the DOM when what it shows changes, since it
 * runs every frame. Opponents' bars and damage numbers float in the world
 * (see `render/world-hud.ts`).
 */
import type { DuelEvent, DuelistId, DuelSnapshot, TeamId } from "./duel/duel";
import { createHealthBar } from "./health-bar";
import { createPotionSlotsHud } from "./potion-slots-hud";
import { text } from "./text";
import type { Tuning } from "./tuning";

export interface HudSettings {
  readonly maxHealth: number;
  readonly roundsToWin: number;
  /** How long "¡Duelo!" stays up once control is given, in seconds. */
  readonly duelCalloutSeconds: number;
  /** How long the pale "damage taken" part of a Health bar lingers before draining. */
  readonly healthLagDelay: number;
  /** How fast the lingering part drains, in Health per second. */
  readonly healthLagRate: number;
  readonly maxStamina: number;
  /** How long "¡Parry!" stays up after the local Duelist Parries. */
  readonly parryCalloutSeconds: number;
  /** How long "¡Desarmado!" stays up after a Disarm the local Duelist was part of. */
  readonly disarmCalloutSeconds: number;
  /** How long the Stamina bar flashes when a defence is refused for want of Stamina. */
  readonly staminaShortSeconds: number;
  /** How long the Spell Slot and Potion Slot diamonds take to spread or tighten. */
  readonly slotsSpreadSeconds: number;
  /** How long a Spell's name stays up under the reticle. */
  readonly spellCalloutSeconds: number;
  /** The Potions and their slots, for the Potion Slots and the active effects. */
  readonly potions: Tuning["potions"];
  readonly potionSlots: Tuning["potionSlots"];
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

/**
 * The local Duelist's Stamina, under their Health: a blue bar of the pool,
 * dimmed while full, which flashes red when an action is refused for want
 * of Stamina.
 */
const createStaminaBar = (parent: HTMLElement, settings: HudSettings) => {
  const root = create("div", "hud-stamina", parent);
  const fill = create("div", "hud-stamina-fill", root);
  let shown = -1;
  let shortFor = 0;

  return {
    show: (stamina: number, short: boolean, seconds: number) => {
      shortFor = short
        ? settings.staminaShortSeconds
        : Math.max(shortFor - seconds, 0);
      root.classList.toggle("hud-stamina-short", shortFor > 0);

      // Whole-percent steps: no DOM write for changes nobody could see.
      const percent = Math.round((stamina / settings.maxStamina) * 100);

      if (percent !== shown) {
        shown = percent;
        fill.style.width = `${percent}%`;
        root.classList.toggle("hud-stamina-full", percent >= 100);
      }
    },
  };
};

/** Round pips for one Team: small diamonds, lit for every Round won. */
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

/** The Spells whose names punch in under the reticle. */
type CalledSpell = keyof typeof text.spellCallouts;

const isCalledSpell = (kind: string): kind is CalledSpell =>
  kind in text.spellCallouts;

/** What punches in under the reticle: a Spell's name, or a Potion's (or its loss). */
type CalledPotion = keyof typeof text.potionCallouts;

type Called = CalledPotion | CalledSpell;

const isCalledPotion = (called: Called): called is CalledPotion =>
  called in text.potionCallouts;

const calloutText = (called: Called): string =>
  isCalledPotion(called)
    ? text.potionCallouts[called]
    : text.spellCallouts[called];

/**
 * The name of the Spell the local Duelist just cast, just under the
 * reticle: big serif in the Spell's colour, a quick punch-in and fade.
 */
const createSpellCallout = (parent: HTMLElement, settings: HudSettings) => {
  const root = create("div", "hud-spell-callout", parent);

  return {
    show: (called: Called) => {
      for (const animation of root.getAnimations()) {
        animation.cancel();
      }

      root.dataset.spell = called;
      root.textContent = calloutText(called);
      root.animate(
        [
          { opacity: 0, transform: "scale(1.45)" },
          { offset: 0.18, opacity: 1, transform: "scale(1)" },
          { offset: 0.7, opacity: 1, transform: "scale(1)" },
          { opacity: 0, transform: "scale(1.04)" },
        ],
        {
          duration: settings.spellCalloutSeconds * 1000,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
        }
      );
    },
  };
};

/**
 * What the local Duelist did this frame that earns a call-out: a Special
 * Spell, Confringo released in the Perfect Release window (a plain
 * Confringo or a Stupefy earns none), a Potion down, or one lost to a hit.
 */
const calledOut = (
  events: readonly DuelEvent[],
  localId: DuelistId
): Called | undefined => {
  let called: Called | undefined;

  for (const event of events) {
    if (event.type === "potion-drunk" && event.duelistId === localId) {
      called = event.kind;
    } else if (
      event.type === "potion-interrupted" &&
      event.duelistId === localId
    ) {
      called = "interrupted";
    } else if (
      event.type === "perfect-release" &&
      event.duelistId === localId
    ) {
      called = "confringo";
    } else if (
      event.type === "spell-cast" &&
      event.spell.casterId === localId &&
      event.spell.kind !== "confringo" &&
      isCalledSpell(event.spell.kind)
    ) {
      called = event.spell.kind;
    }
  }

  return called;
};

export const createHud = (
  root: HTMLElement,
  localId: DuelistId,
  settings: HudSettings
): Hud => {
  root.style.setProperty(
    "--slots-spread-seconds",
    `${settings.slotsSpreadSeconds}s`
  );

  const score = create("header", "hud-score", root);
  const localPips = createPips(score, settings);
  const rivalPips = createPips(score, settings);
  const vitals = create("div", "hud-vitals", root);
  const bars = create("div", "hud-bars", vitals);
  const potionSlots = createPotionSlotsHud(vitals, bars, localId, settings);
  const health = createHealthBar(bars, "hud-health", settings);
  const stamina = createStaminaBar(bars, settings);
  const callout = createCallout(root);
  const spellCallout = createSpellCallout(root, settings);
  let duelCallout = 0;
  let parryCallout = 0;
  // "¡Desarmado!": how long it stays up, and whether the local Duelist is the one Disarmed.
  let disarmCallout = 0;
  let disarmedSelf = false;

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

    if (round.phase === "fighting" && disarmCallout > 0) {
      return {
        detail: disarmedSelf ? text.hud.disarmedHint : "",
        heading: text.hud.disarmed,
      };
    }

    if (round.phase === "fighting" && parryCallout > 0) {
      return { heading: text.hud.parry };
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

      const mine = (type: DuelEvent["type"]) =>
        events.some(
          (event) =>
            event.type === type &&
            "duelistId" in event &&
            event.duelistId === localId
        );

      parryCallout = mine("parry")
        ? settings.parryCalloutSeconds
        : Math.max(parryCallout - seconds, 0);

      disarmCallout = Math.max(disarmCallout - seconds, 0);

      for (const event of events) {
        if (
          event.type === "disarm" &&
          (event.duelistId === localId || event.casterId === localId)
        ) {
          disarmCallout = settings.disarmCalloutSeconds;
          disarmedSelf = event.duelistId === localId;
        }
      }

      stamina.show(self?.stamina ?? 0, mine("stamina-short"), seconds);
      health.show(self?.health ?? 0, seconds);
      potionSlots.show(snapshot);
      localPips.show(self ? (snapshot.score[self.team] ?? 0) : 0);
      rivalPips.show(opponent ? (snapshot.score[opponent.team] ?? 0) : 0);

      const { heading, detail } = message(snapshot, self?.team);
      callout.show(heading, detail);

      const called = calledOut(events, localId);

      if (called) {
        spellCallout.show(called);
      }
    },
  };
};
