/**
 * What each screen shows, as plain data: the heading, an optional line, the
 * menu items with the highlighted one marked (and any not available yet
 * greyed out) and a hint of the controls. The overlay draws it; the Duel
 * screen itself shows nothing here, since the Duel and its HUD are the picture.
 */
import { difficulties } from "../duel/difficulty";
import { practiceRivals } from "../duel/practice";
import { text } from "../text";
import {
  mainMenuOptions,
  pauseOptionsFor,
  resultOptions,
  unavailableMainMenuOptions,
} from "./screens";
import type { Screen } from "./screens";

export interface ScreenView {
  readonly screen: Screen["kind"];
  readonly heading: string;
  readonly body?: string;
  readonly items?: readonly {
    readonly label: string;
    readonly selected: boolean;
    /** Listed but not available yet: greyed out, never highlighted. */
    readonly disabled?: true;
  }[];
  readonly hint?: string;
}

type MenuItem = NonNullable<ScreenView["items"]>[number];

const menu = <T extends string>(
  options: readonly T[],
  selected: T,
  label: (option: T) => string,
  unavailable: ReadonlySet<T> = new Set()
) =>
  options.map((option): MenuItem => {
    const item = { label: label(option), selected: option === selected };

    return unavailable.has(option) ? { ...item, disabled: true } : item;
  });

const padBodies = {
  none: text.connectDualSense,
  unsupported: text.requiresDualSense,
};

export const viewOf = (screen: Screen): ScreenView | undefined => {
  if (screen.kind === "unsupported") {
    return {
      body: text.unsupportedBrowser.body,
      heading: text.unsupportedBrowser.heading,
      screen: screen.kind,
    };
  }

  if (screen.kind === "connect") {
    return {
      body: padBodies[screen.pad],
      heading: text.title,
      screen: screen.kind,
    };
  }

  if (screen.kind === "main") {
    return {
      heading: text.title,
      hint: text.menu.hint,
      items: menu(
        mainMenuOptions,
        screen.selected,
        (option) => text.mainMenu[option],
        unavailableMainMenuOptions
      ),
      screen: screen.kind,
    };
  }

  if (screen.kind === "difficulty") {
    return {
      body: text.difficulty.heading,
      heading: screen.practice ? text.practice.heading : text.title,
      hint: text.menu.hint,
      items: menu(
        difficulties,
        screen.selected,
        (option) => text.difficulty[option]
      ),
      screen: screen.kind,
    };
  }

  if (screen.kind === "rivals") {
    return {
      body: text.practice.rivals,
      heading: text.practice.heading,
      hint: text.menu.hint,
      items: menu(
        practiceRivals,
        screen.selected,
        (option) => text.practice[option]
      ),
      screen: screen.kind,
    };
  }

  if (screen.kind === "pause") {
    const practice = screen.duel.practice !== null;

    return {
      heading: text.pause.heading,
      hint: text.menu.hint,
      items: menu(pauseOptionsFor(screen.duel), screen.selected, (option) =>
        option === "quit" && practice
          ? text.pause.quitToMenu
          : text.pause[option]
      ),
      screen: screen.kind,
    };
  }

  if (screen.kind === "disconnected") {
    return {
      body: screen.reconnected
        ? text.disconnected.reconnected
        : text.disconnected.waiting,
      heading: text.disconnected.heading,
      screen: screen.kind,
    };
  }

  if (screen.kind === "result") {
    return {
      heading: screen.won ? text.hud.victory : text.hud.defeat,
      hint: text.menu.hint,
      items: menu(
        resultOptions,
        screen.selected,
        (option) => text.result[option]
      ),
      screen: screen.kind,
    };
  }

  // The Duel itself is the picture.
  return undefined;
};
