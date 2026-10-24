/**
 * What each screen shows, as plain data: the heading, an optional line, the
 * menu items with the highlighted one marked (and any not available yet
 * greyed out). The overlay draws it; the Duel
 * screen itself shows nothing here, since the Duel and its HUD are the picture.
 */
import { humanBindings } from "../controllers/human-controller";
import type { HumanAction } from "../controllers/human-controller";
import type { DualSenseButton } from "../dualsense/input";
import { pauseButton } from "../dualsense/menu-input";
import { difficulties } from "../duel/difficulty";
import { potionIn } from "../duel/potions";
import type { PotionKind } from "../duel/potions";
import { practiceRivals } from "../duel/practice";
import { boundTo, spellSlots } from "../duel/spell-slots";
import type { SpecialSpellKind, SpellSlot } from "../duel/spell-slots";
import { text } from "../text";
import { tuning } from "../tuning";
import {
  controlsTabs,
  mainMenuOptions,
  pauseOptionsFor,
  resultOptions,
  unavailableMainMenuOptions,
} from "./screens";
import type { ControlsTab, Screen } from "./screens";

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
  /** A click anywhere does this (the title's start), said over a veil. */
  readonly action?: string;
  /** Tabs over the content, switched with L1 and R1; the open one marked. */
  readonly tabs?: readonly {
    readonly label: string;
    readonly selected: boolean;
  }[];
  /** The Controls screen's content: its open tab's. */
  readonly help?: ControlsHelp;
}

/** A part of the DualSense the Controls draw: a button, or a stick. */
export type PadControl = DualSenseButton | "leftStick" | "rightStick";

export interface ControlLabel {
  readonly control: PadControl;
  readonly label: string;
  /** A second, smaller line. */
  readonly detail?: string;
}

/** A trigger's four face-button slots, laid out like the HUD's diamond. */
export interface SlotsLabel<Kind extends string> {
  readonly heading: string;
  /** △ □ ○ ✕, each with what it holds; null for an empty slot. */
  readonly slots: readonly {
    readonly button: SpellSlot;
    readonly kind: Kind | null;
    readonly label: string | null;
  }[];
}

export type ControlsHelp =
  | {
      readonly tab: "controls";
      /** What each control of the drawn DualSense does. */
      readonly controls: readonly ControlLabel[];
      /** The Potion Slots, under L2. */
      readonly potionSlots: SlotsLabel<PotionKind>;
      /** The Spell Slots, under R2. */
      readonly spellSlots: SlotsLabel<SpecialSpellKind>;
    }
  | {
      readonly tab: "mechanics";
      readonly cards: readonly {
        readonly title: string;
        readonly body: string;
      }[];
    };

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

/** The order the Controls label the human Controller's actions in, the pause last. */
const labelledActions: readonly HumanAction[] = [
  "move",
  "look",
  "lockOn",
  "lightSpell",
  "heavySpell",
  "dodge",
  "jump",
  "shield",
  "sprint",
  "spellSlots",
  "potionSlots",
];

const details: Partial<Record<HumanAction, string>> = text.controls.details;

const controlLabels = (): ControlLabel[] => [
  ...labelledActions.map((action): ControlLabel => {
    const label = {
      control: humanBindings[action],
      label: text.controls.actions[action],
    };

    const detail = details[action];

    return detail === undefined ? label : { ...label, detail };
  }),
  { control: pauseButton, label: text.controls.actions.pause },
];

/** The slots under `trigger`: what each face button holds there, and its name. */
const slotsUnder = <Kind extends string>(
  trigger: keyof typeof text.controls.triggers,
  kindIn: (button: SpellSlot) => Kind | null,
  name: (kind: Kind) => string
): SlotsLabel<Kind> => ({
  heading: text.controls.hold(text.controls.triggers[trigger]),
  slots: spellSlots.map((button) => {
    const kind = kindIn(button);

    return { button, kind, label: kind === null ? null : name(kind) };
  }),
});

const helpFor = (tab: ControlsTab): ControlsHelp =>
  tab === "controls"
    ? {
        controls: controlLabels(),
        potionSlots: slotsUnder(
          humanBindings.potionSlots,
          (button) => potionIn(button, tuning),
          (kind) => text.potions[kind]
        ),
        spellSlots: slotsUnder(
          humanBindings.spellSlots,
          (button) => boundTo(button, tuning),
          (kind) => text.specials[kind]
        ),
        tab,
      }
    : { cards: text.controls.mechanics, tab };

const padBodies = {
  dualsense: text.connectDualSense,
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
    return { action: text.start, heading: text.title, screen: screen.kind };
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
      items: menu(
        mainMenuOptions,
        screen.selected,
        (option) => text.mainMenu[option],
        unavailableMainMenuOptions
      ),
      screen: screen.kind,
    };
  }

  if (screen.kind === "controls") {
    return {
      heading: text.controls.heading,
      help: helpFor(screen.tab),
      screen: screen.kind,
      tabs: controlsTabs.map((tab) => ({
        label: text.controls.tabs[tab],
        selected: tab === screen.tab,
      })),
    };
  }

  if (screen.kind === "difficulty") {
    return {
      body: text.difficulty.heading,
      heading: screen.practice ? text.practice.heading : text.mainMenu.duel,
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
