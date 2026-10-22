/**
 * What each screen shows, as plain data: the heading, an optional line, the
 * menu items with the highlighted one marked and a hint of the controls.
 * The overlay draws it; the Duel screen itself shows nothing here, since the
 * Duel and its HUD are the picture.
 */
import { difficulties } from "../duel/difficulty";
import { text } from "../text";
import { pauseOptions, resultOptions } from "./screens";
import type { Screen } from "./screens";

export interface ScreenView {
  readonly screen: Screen["kind"];
  readonly heading: string;
  readonly body?: string;
  readonly items?: readonly {
    readonly label: string;
    readonly selected: boolean;
  }[];
  readonly hint?: string;
}

const menu = <T extends string>(
  options: readonly T[],
  selected: T,
  label: (option: T) => string
) =>
  options.map((option) => ({
    label: label(option),
    selected: option === selected,
  }));

const padBodies = {
  dualsense: text.pressToStart,
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

  if (screen.kind === "title") {
    return {
      body: padBodies[screen.pad],
      heading: text.title,
      screen: screen.kind,
    };
  }

  if (screen.kind === "difficulty") {
    return {
      heading: text.difficulty.heading,
      hint: text.menu.hint,
      items: menu(
        difficulties,
        screen.selected,
        (option) => text.difficulty[option]
      ),
      screen: screen.kind,
    };
  }

  if (screen.kind === "pause") {
    return {
      heading: text.pause.heading,
      hint: text.menu.hint,
      items: menu(
        pauseOptions,
        screen.selected,
        (option) => text.pause[option]
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
