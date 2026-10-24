/**
 * What each screen shows, as plain data: the heading, an optional line, the
 * menu items with the highlighted one marked (and any not available yet
 * greyed out). The overlay draws it; the Duel
 * screen itself shows nothing here, since the Duel and its HUD are the picture.
 * Every string comes from `text` as it is when the view is taken, so a view
 * taken after a change of language is in the new one.
 */
import { humanBindings } from "../controllers/human-controller";
import type { HumanAction } from "../controllers/human-controller";
import type { DualSenseButton } from "../dualsense/input";
import { pauseButton } from "../dualsense/menu-input";
import { difficulties } from "../duel/difficulty";
import { potionIn, potionSlots } from "../duel/potions";
import type { PotionKind, PotionSlot } from "../duel/potions";
import { practiceRivals } from "../duel/practice";
import { boundTo, spellSlots } from "../duel/spell-slots";
import type { SpecialSpellKind, SpellSlot } from "../duel/spell-slots";
import { goalOf, lessonSections, lessons } from "../duel/training";
import type { Lesson, LessonProgress } from "../duel/training";
import { language, text } from "../text";
import { tuning } from "../tuning";
import {
  controlsTabs,
  defaultOptions,
  lessonDoneOptions,
  lockedOptions,
  mainMenuOptions,
  noTraining,
  optionsEntries,
  pauseOptionsFor,
  resultOptions,
  trainingComplete,
} from "./screens";
import type {
  ControlsTab,
  OptionsEntry,
  PadKind,
  PlayerOptions,
  Screen,
  ScrollScreen,
  TrainingRecord,
} from "./screens";

export interface ScreenView {
  readonly screen: Screen["kind"];
  readonly heading: string;
  readonly body?: string;
  readonly items?: readonly {
    readonly label: string;
    readonly selected: boolean;
    /** Listed but not available yet: greyed out, never highlighted. */
    readonly disabled?: true;
    /** Completed: ticked. */
    readonly done?: true;
    /** A short line under the label, drawing the eye to it. */
    readonly hint?: string;
    /** What it is set to, changed with left and right (Opciones). */
    readonly value?: string;
    /** A volume's share of its range, 0 to 1, drawn as a bar beside its value. */
    readonly level?: number;
  }[];
  /** What it takes to play, each a short line (the can't-play notice). */
  readonly needs?: readonly string[];
  /** A click anywhere does this (the title's start), said over a veil. */
  readonly action?: string;
  /** Tabs over the content, switched with L1 and R1; the open one marked. */
  readonly tabs?: readonly {
    readonly label: string;
    readonly selected: boolean;
  }[];
  /** The Controls screen's content: its open tab's. */
  readonly help?: ControlsHelp;
  /** Entrenamiento's lessons: the list by section, and the highlighted one's preview. */
  readonly lessons?: LessonsView;
}

/** One lesson in Entrenamiento's list. */
export interface LessonEntry {
  readonly lesson: Lesson;
  /** Its place in Training, from 1. */
  readonly number: string;
  readonly label: string;
  readonly selected: boolean;
  /** Completed at least once: ticked. */
  readonly done: boolean;
}

export interface LessonsView {
  /** How many lessons are completed, over the list. */
  readonly progress: string;
  /** The list, in its sections, in lesson order. */
  readonly sections: readonly {
    readonly heading: string;
    readonly lessons: readonly LessonEntry[];
  }[];
  /**
   * The highlighted lesson, large beside the list: which of how many, its
   * title, what it teaches in a line and its buttons (drawn as icons). The
   * game plays it there, too.
   */
  readonly preview: {
    readonly lesson: Lesson;
    readonly eyebrow: string;
    readonly heading: string;
    readonly body: string;
    readonly controls: string;
    readonly done: boolean;
  };
}

/** A part of the DualSense the Controls draw: a button, or a stick. */
export type PadControl = DualSenseButton | "leftStick" | "rightStick";

export interface ControlLabel {
  readonly control: PadControl;
  readonly label: string;
  /** A second, smaller line. */
  readonly detail?: string;
}

/** A trigger's four slots, laid out like the HUD's diamond: on the face buttons, or on the D-pad. */
export interface SlotsLabel<Kind extends string, Button extends string> {
  readonly heading: string;
  /** △ □ ○ ✕ (or ↑ ← → ↓), each with what it holds; null for an empty slot. */
  readonly slots: readonly {
    readonly button: Button;
    readonly kind: Kind | null;
    readonly label: string | null;
  }[];
}

export type ControlsHelp =
  | {
      readonly tab: "controls";
      /** What each control of the drawn DualSense does. */
      readonly controls: readonly ControlLabel[];
      /** The Potion Slots, under L2, on the D-pad. */
      readonly potionSlots: SlotsLabel<PotionKind, PotionSlot>;
      /** The Spell Slots, under R2, on the face buttons. */
      readonly spellSlots: SlotsLabel<SpecialSpellKind, SpellSlot>;
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
  "crouch",
  "spellSlots",
  "potionSlots",
];

const controlLabels = (): ControlLabel[] => [
  ...labelledActions.map((action): ControlLabel => {
    const label = {
      control: humanBindings[action],
      label: text.controls.actions[action],
    };

    const details: Partial<Record<HumanAction, string>> = text.controls.details;

    const detail = details[action];

    return detail === undefined ? label : { ...label, detail };
  }),
  { control: pauseButton, label: text.controls.actions.pause },
];

/** The slots under `trigger`: what each of `buttons` holds there, and its name. */
const slotsUnder = <Kind extends string, Button extends string>(
  trigger: keyof typeof text.controls.triggers,
  buttons: readonly Button[],
  kindIn: (button: Button) => Kind | null,
  name: (kind: Kind) => string
): SlotsLabel<Kind, Button> => ({
  heading: text.controls.hold(text.controls.triggers[trigger]),
  slots: buttons.map((button) => {
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
          potionSlots,
          (button) => potionIn(button, tuning),
          (kind) => text.potions[kind]
        ),
        spellSlots: slotsUnder(
          humanBindings.spellSlots,
          spellSlots,
          (button) => boundTo(button, tuning),
          (kind) => text.specials[kind]
        ),
        tab,
      }
    : { cards: text.controls.mechanics, tab };

/** What the connect prompt asks for, given what is plugged in. */
const padBody = (pad: PadKind) =>
  pad === "unsupported" ? text.requiresDualSense : text.connectDualSense;

/**
 * Entrenamiento on the main menu: ticked once every lesson is completed,
 * and until then saying it is what opens Duelo and Práctica.
 */
const markTraining = (
  items: readonly MenuItem[],
  training: TrainingRecord
): MenuItem[] =>
  items.map((item) => {
    if (item.label !== text.mainMenu.training) {
      return item;
    }

    if (trainingComplete(training)) {
      return { ...item, done: true };
    }

    // Welcomed before a lesson was added: nothing is closed, nothing to say.
    return training.certified ? item : { ...item, hint: text.training.locked };
  });

/** The glyph each face button and D-pad arrow is written as, drawn as its icon. */
const glyphs: Readonly<Record<PotionSlot | SpellSlot, string>> = {
  circle: "○",
  cross: "✕",
  down: "↓",
  left: "←",
  right: "→",
  square: "□",
  triangle: "△",
  up: "↑",
};

/** The button of the slot `kind` (a Special Spell or a Potion) is bound to, as its glyph. */
const slotGlyph = (kind: string): string => {
  const spell = spellSlots.find((slot) => boundTo(slot, tuning) === kind);
  const potion = potionSlots.find((slot) => potionIn(slot, tuning) === kind);
  const slot = spell ?? potion;

  return slot === undefined ? "" : glyphs[slot];
};

/** `line` with each `{kind}` written as the button of that kind's slot. */
const withSlots = (line: string) =>
  line.replaceAll(/\{(?<kind>\w+)\}/gu, (_match, kind: string) =>
    slotGlyph(kind)
  );

/** Which lesson of how many, over a scroll or a preview. */
const lessonCount = (lesson: Lesson) =>
  text.training.lessonCount(lessons.indexOf(lesson) + 1, lessons.length);

/** Entrenamiento's list by section, ticked as `training` remembers, and the highlighted lesson's preview. */
const lessonsView = (
  selected: Lesson,
  training: TrainingRecord
): LessonsView => {
  const done = (lesson: Lesson) => training.completed.includes(lesson);

  return {
    preview: {
      body: text.training.previews[selected],
      controls: withSlots(text.training.scrolls[selected].controls),
      done: done(selected),
      eyebrow: lessonCount(selected),
      heading: text.training.lessons[selected],
      lesson: selected,
    },
    progress: text.training.progress(
      lessons.filter(done).length,
      lessons.length
    ),
    sections: lessonSections.map((section) => ({
      heading: text.training.sections[section.section],
      lessons: section.lessons.map((lesson) => ({
        done: done(lesson),
        label: text.training.lessons[lesson],
        lesson,
        number: String(lessons.indexOf(lesson) + 1),
        selected: lesson === selected,
      })),
    })),
  };
};

/** Opciones' entries: the language by its own name, each volume as a share. */
const optionsItems = (
  selected: OptionsEntry,
  options: PlayerOptions
): MenuItem[] =>
  optionsEntries.map((entry): MenuItem => {
    const item = { label: text.options[entry], selected: entry === selected };

    if (entry === "language") {
      return { ...item, value: text.options.languages[options.language] };
    }

    const level = options[entry] / tuning.screens.volumeSteps;

    return {
      ...item,
      level,
      value: text.options.volume(Math.round(level * 100)),
    };
  });

/**
 * What `screen` shows; the menus that name Training read what is remembered
 * of it, and Opciones the player's Options.
 */
export const viewOf = (
  screen: Screen,
  training: TrainingRecord = noTraining,
  options: PlayerOptions = defaultOptions(
    language(),
    tuning.screens.volumeSteps
  )
): ScreenView | undefined => {
  if (screen.kind === "unsupported") {
    const notice = text.unsupported[screen.reason];

    return {
      body: notice.body,
      heading: notice.heading,
      needs: text.unsupported.needs,
      screen: screen.kind,
    };
  }

  if (screen.kind === "title") {
    return { action: text.start, heading: text.title, screen: screen.kind };
  }

  if (screen.kind === "connect") {
    return {
      body: padBody(screen.pad),
      heading: text.title,
      screen: screen.kind,
    };
  }

  if (screen.kind === "main") {
    return {
      heading: text.title,
      items: markTraining(
        menu(
          mainMenuOptions,
          screen.selected,
          (option) => text.mainMenu[option],
          lockedOptions(training)
        ),
        training
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

  if (screen.kind === "options") {
    return {
      heading: text.options.heading,
      items: optionsItems(screen.selected, options),
      screen: screen.kind,
    };
  }

  if (screen.kind === "lessons") {
    return {
      heading: text.training.heading,
      lessons: lessonsView(screen.selected, training),
      screen: screen.kind,
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

  // The Duel itself is the picture, and the Training scrolls lie over it.
  return undefined;
};

/**
 * A lesson's line top-centre: the goal on show with its buttons and its
 * count, "Acierta Stupefy con □ (1/3)", or "¡Lección completada!" once done.
 */
export const goalLineOf = (progress: LessonProgress): string => {
  if (progress.done) {
    return text.training.lessonDone;
  }

  const { count, goal, target } = goalOf(progress, tuning);
  // The counter's units, for the goals counted in metres or degrees.
  const units: Partial<Record<string, string>> = text.training.units;

  return `${withSlots(text.training.goals[goal])} ${text.training.counter(Math.floor(count), target, units[goal])}`;
};

/** A Training scroll as plain data: the overlay over the frozen lesson draws it. */
export interface ScrollView {
  readonly kind: ScrollScreen["kind"];
  /** A small line over the title: which lesson of how many. */
  readonly eyebrow?: string;
  readonly heading: string;
  readonly paragraphs: readonly string[];
  /** The buttons involved, drawn as their icons. */
  readonly controls?: string;
  /** Its choices, the highlighted one marked. */
  readonly items: readonly MenuItem[];
}

/** The Training scroll `screen` shows, if it is one. */
export const scrollOf = (screen: Screen): ScrollView | undefined => {
  if (
    screen.kind !== "briefing" &&
    screen.kind !== "lessonDone" &&
    screen.kind !== "certificate"
  ) {
    return undefined;
  }

  const lesson = screen.duel.training?.lesson ?? lessons[0];

  if (screen.kind === "certificate") {
    const { certificate } = text.training;

    return {
      heading: certificate.heading,
      items: [{ label: certificate.continue, selected: true }],
      kind: screen.kind,
      paragraphs: certificate.lines,
    };
  }

  if (screen.kind === "lessonDone") {
    const last = lesson === lessons.at(-1);

    return {
      eyebrow: lessonCount(lesson),
      heading: text.training.lessonDone,
      items: menu(lessonDoneOptions, screen.selected, (option) => {
        if (option === "repeat") {
          return text.training.scrollOptions.repeat;
        }

        return last
          ? text.training.scrollOptions.finish
          : text.training.scrollOptions.next;
      }),
      kind: screen.kind,
      paragraphs: [text.training.lessons[lesson]],
    };
  }

  const scroll = text.training.scrolls[lesson];

  return {
    controls: withSlots(scroll.controls),
    eyebrow: lessonCount(lesson),
    heading: text.training.lessons[lesson],
    items: [{ label: text.training.scrollOptions.start, selected: true }],
    kind: screen.kind,
    paragraphs: [withSlots(scroll.what), withSlots(scroll.when)],
  };
};
