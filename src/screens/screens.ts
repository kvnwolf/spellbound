/**
 * The screen state machine: which screen the game is on, from the unsupported
 * browser, the title and the connect prompt through the main menu (the root once a
 * DualSense is there), the Difficulty select and the Practice rival picker,
 * to the Duel or Practice, its pause and the result. Pure: it is fed events
 * (the start click, the controller coming and going, menu inputs, the Duel
 * ending, time) and
 * lands on the next screen. It owns no three.js, no DOM and no clock; the
 * game loop decides what to draw and whether the Duel simulation may advance
 * from the screen it reports.
 */
import { difficulties } from "../duel/difficulty";
import type { Difficulty } from "../duel/difficulty";
import { practiceRivals } from "../duel/practice";
import type { PracticeRival } from "../duel/practice";

/** What is plugged in, as far as the screens care. */
export type PadKind = "dualsense" | "none" | "unsupported";

export const mainMenuOptions = [
  "duel",
  "practice",
  "training",
  "controls",
] as const;

export type MainMenuOption = (typeof mainMenuOptions)[number];

/** Main menu entries whose screens have not landed yet: listed, greyed out and never highlighted. */
export const unavailableMainMenuOptions: ReadonlySet<MainMenuOption> = new Set([
  "training",
]);

/** The pause of a Duel. */
export const pauseOptions = [
  "continue",
  "restart",
  "controls",
  "quit",
] as const;

/** The pause of a Practice: no restart, but a change of rival; Salir goes to the main menu. */
export const practicePauseOptions = [
  "continue",
  "changeRival",
  "controls",
  "quit",
] as const;

export type PauseOption =
  | (typeof pauseOptions)[number]
  | (typeof practicePauseOptions)[number];

export const resultOptions = ["rematch", "changeDifficulty"] as const;

export type ResultOption = (typeof resultOptions)[number];

/**
 * A Duel on screen, or a Practice (which runs the same Duel simulation under
 * the Practice rules). `run` numbers the Duels started, so the game knows
 * when to build a new one.
 */
export interface DuelScreen {
  readonly kind: "duel";
  /** The AI's Difficulty; a Practice against a Training Dummy carries the default. */
  readonly difficulty: Difficulty;
  /** Whom a Practice is against; null for a Duel. */
  readonly practice: PracticeRival | null;
  readonly run: number;
  /** Set once the Duel has a winner: how long its call-out still plays before the result. */
  readonly over: { readonly won: boolean; readonly secondsLeft: number } | null;
}

export interface MainScreen {
  readonly kind: "main";
  readonly selected: MainMenuOption;
}

/** The Controls' two tabs, switched with L1 and R1 (or the D-pad). */
export const controlsTabs = ["controls", "mechanics"] as const;

export type ControlsTab = (typeof controlsTabs)[number];

export interface PauseScreen {
  readonly kind: "pause";
  readonly duel: DuelScreen;
  readonly selected: PauseOption;
}

export type Screen =
  /** WebGPU is missing: nothing else can happen. */
  | { readonly kind: "unsupported" }
  /**
   * The title, first: one start button, whose click is also what lets the
   * sound and the DualSense's effects start. `pad` is whatever is plugged in
   * meanwhile.
   */
  | { readonly kind: "title"; readonly pad: PadKind }
  /**
   * Started without a DualSense the game can see (no WebHID grant): asks for
   * one and for ✕ on it. `pad` is what is plugged in: nothing, some other
   * pad, or a DualSense still waiting for its ✕.
   */
  | { readonly kind: "connect"; readonly pad: PadKind }
  /** The root: Duelo, Práctica, Entrenamiento and Controles. */
  | MainScreen
  /**
   * The Controls: what every button does, and what the less obvious
   * mechanics mean, on two tabs. `from` is where ○ goes back to: the main
   * menu, or the pause of a Duel, a Practice or a Training.
   */
  | {
      readonly kind: "controls";
      readonly tab: ControlsTab;
      readonly from: MainScreen | PauseScreen;
    }
  /** The Difficulty select, for a Duel or for a Practice against Rival real. */
  | {
      readonly kind: "difficulty";
      readonly selected: Difficulty;
      readonly practice: boolean;
    }
  /** The Practice rival picker: the Training Dummies and Rival real. */
  | { readonly kind: "rivals"; readonly selected: PracticeRival }
  | DuelScreen
  | PauseScreen
  /** The DualSense dropped out mid-Duel; `resume` is where to return to. */
  | {
      readonly kind: "disconnected";
      readonly resume: DuelScreen | PauseScreen;
      /** The DualSense is back; the next button press resumes. */
      readonly reconnected: boolean;
    }
  | {
      readonly kind: "result";
      readonly difficulty: Difficulty;
      readonly won: boolean;
      readonly selected: ResultOption;
    };

export interface ScreenState {
  readonly screen: Screen;
  /** Duels started so far. */
  readonly runs: number;
}

export type MenuInput =
  | "back"
  | "confirm"
  | "down"
  | "left"
  | "options"
  | "right"
  | "up";

export type ScreenEvent =
  /** The title's start button was clicked. */
  | { readonly type: "start" }
  /** What is plugged in changed. */
  | { readonly type: "pad"; readonly pad: PadKind }
  /** A menu input: a D-pad or left stick step, L1 or R1 (left, right), ✕, ○ or Options. */
  | { readonly type: "input"; readonly input: MenuInput }
  /** Some button went down, whichever it is. */
  | { readonly type: "press" }
  | { readonly type: "duel-ended"; readonly won: boolean }
  | { readonly type: "tick"; readonly seconds: number };

export interface ScreenSettings {
  /** How long a finished Duel's call-out plays before the result screen. */
  readonly resultDelaySeconds: number;
}

/** The Difficulty highlighted the first time the select opens. */
const defaultDifficulty: Difficulty = "duelista";

export const initialScreenState = (supported: boolean): ScreenState => ({
  runs: 0,
  screen: supported ? { kind: "title", pad: "none" } : { kind: "unsupported" },
});

/** The pause options for this Duel or Practice. */
export const pauseOptionsFor = (duel: DuelScreen): readonly PauseOption[] =>
  duel.practice === null ? pauseOptions : practicePauseOptions;

/**
 * Moves a highlight one step through `options`, over any `unavailable` ones,
 * stopping at both ends: up and down, or along `axis` (back, then forward).
 */
const step = <T>(
  options: readonly T[],
  selected: T,
  input: MenuInput,
  unavailable: ReadonlySet<T> = new Set(),
  axis: readonly [MenuInput, MenuInput] = ["up", "down"]
): T => {
  if (!axis.includes(input)) {
    return selected;
  }

  const by = input === axis[1] ? 1 : -1;

  for (
    let index = options.indexOf(selected) + by;
    index >= 0 && index < options.length;
    index += by
  ) {
    const option = options[index];

    if (option !== undefined && !unavailable.has(option)) {
      return option;
    }
  }

  return selected;
};

const toMain = (state: ScreenState, selected: MainMenuOption): ScreenState => ({
  ...state,
  screen: { kind: "main", selected },
});

/** The Controls on their first tab, going back to `from`. */
const toControls = (
  state: ScreenState,
  from: MainScreen | PauseScreen
): ScreenState => ({
  ...state,
  screen: { from, kind: "controls", tab: controlsTabs[0] },
});

/** The Difficulty select highlighting `selected`, for a Duel or a Practice. */
const toSelect = (
  state: ScreenState,
  selected: Difficulty,
  practice = false
): ScreenState => ({
  ...state,
  screen: { kind: "difficulty", practice, selected },
});

const toRivals = (
  state: ScreenState,
  selected: PracticeRival
): ScreenState => ({
  ...state,
  screen: { kind: "rivals", selected },
});

/** Starts a Duel, or a Practice against `practice`: the next run, no winner yet. */
const startDuel = (
  state: ScreenState,
  difficulty: Difficulty,
  practice: PracticeRival | null = null
): ScreenState => ({
  runs: state.runs + 1,
  screen: {
    difficulty,
    kind: "duel",
    over: null,
    practice,
    run: state.runs + 1,
  },
});

/** Off the title: to the main menu if a DualSense is already there, else to ask for one. */
const onStart = (state: ScreenState, pad: PadKind): ScreenState =>
  pad === "dualsense"
    ? toMain(state, "duel")
    : { ...state, screen: { kind: "connect", pad } };

const onPad = (state: ScreenState, pad: PadKind): ScreenState => {
  const { screen } = state;
  const connected = pad === "dualsense";

  if (screen.kind === "title") {
    return { ...state, screen: { ...screen, pad } };
  }

  // Only ✕ on the DualSense leaves the connect prompt (onInput).
  if (screen.kind === "connect") {
    return { ...state, screen: { ...screen, pad } };
  }

  if (screen.kind === "duel" || screen.kind === "pause") {
    return connected
      ? state
      : {
          ...state,
          screen: { kind: "disconnected", reconnected: false, resume: screen },
        };
  }

  if (screen.kind === "disconnected") {
    return { ...state, screen: { ...screen, reconnected: connected } };
  }

  // The Controls over a pause: the Duel waits behind them, so wait for the
  // pad as that pause would, then return to it.
  if (screen.kind === "controls" && screen.from.kind === "pause") {
    return connected ? state : onPad({ ...state, screen: screen.from }, pad);
  }

  if (screen.kind === "unsupported") {
    return state;
  }

  // Any menu: without a DualSense, back to asking for one.
  return connected ? state : { ...state, screen: { kind: "connect", pad } };
};

const onMainInput = (
  state: ScreenState,
  screen: Extract<Screen, { kind: "main" }>,
  input: MenuInput
): ScreenState => {
  if (input === "confirm" && screen.selected === "duel") {
    return toSelect(state, defaultDifficulty);
  }

  if (input === "confirm" && screen.selected === "practice") {
    return toRivals(state, practiceRivals[0]);
  }

  if (input === "confirm" && screen.selected === "controls") {
    return toControls(state, screen);
  }

  const selected = step(
    mainMenuOptions,
    screen.selected,
    input,
    unavailableMainMenuOptions
  );

  return { ...state, screen: { ...screen, selected } };
};

const onDifficultyInput = (
  state: ScreenState,
  screen: Extract<Screen, { kind: "difficulty" }>,
  input: MenuInput
): ScreenState => {
  if (input === "confirm") {
    return startDuel(state, screen.selected, screen.practice ? "ai" : null);
  }

  if (input === "back") {
    return screen.practice ? toRivals(state, "ai") : toMain(state, "duel");
  }

  const selected = step(difficulties, screen.selected, input);

  return { ...state, screen: { ...screen, selected } };
};

const onRivalsInput = (
  state: ScreenState,
  screen: Extract<Screen, { kind: "rivals" }>,
  input: MenuInput
): ScreenState => {
  if (input === "back") {
    return toMain(state, "practice");
  }

  // Rival real asks for its Difficulty first; a Training Dummy starts at once.
  if (input === "confirm") {
    return screen.selected === "ai"
      ? toSelect(state, defaultDifficulty, true)
      : startDuel(state, defaultDifficulty, screen.selected);
  }

  const selected = step(practiceRivals, screen.selected, input);

  return { ...state, screen: { ...screen, selected } };
};

const onPauseInput = (
  state: ScreenState,
  screen: PauseScreen,
  input: MenuInput
): ScreenState => {
  const { duel } = screen;

  if (input === "options" || input === "back") {
    return { ...state, screen: duel };
  }

  if (input !== "confirm") {
    const selected = step(pauseOptionsFor(duel), screen.selected, input);

    return { ...state, screen: { ...screen, selected } };
  }

  if (screen.selected === "restart") {
    return startDuel(state, duel.difficulty, duel.practice);
  }

  if (screen.selected === "changeRival") {
    return toRivals(state, duel.practice ?? "ai");
  }

  if (screen.selected === "controls") {
    return toControls(state, screen);
  }

  if (screen.selected === "quit") {
    // A Practice leaves for the main menu; a Duel for the Difficulty select.
    return duel.practice === null
      ? toSelect(state, duel.difficulty)
      : toMain(state, "practice");
  }

  return { ...state, screen: duel };
};

/** L1 and R1 (or left and right) switch tabs; ○ or Options goes back to where they opened. */
const onControlsInput = (
  state: ScreenState,
  screen: Extract<Screen, { kind: "controls" }>,
  input: MenuInput
): ScreenState => {
  if (input === "back" || input === "options") {
    return { ...state, screen: screen.from };
  }

  const tab = step(controlsTabs, screen.tab, input, new Set(), [
    "left",
    "right",
  ]);

  return { ...state, screen: { ...screen, tab } };
};

const onResultInput = (
  state: ScreenState,
  screen: Extract<Screen, { kind: "result" }>,
  input: MenuInput
): ScreenState => {
  if (input === "back") {
    return toSelect(state, screen.difficulty);
  }

  if (input !== "confirm") {
    const selected = step(resultOptions, screen.selected, input);

    return { ...state, screen: { ...screen, selected } };
  }

  return screen.selected === "rematch"
    ? startDuel(state, screen.difficulty)
    : toSelect(state, screen.difficulty);
};

const onInput = (state: ScreenState, input: MenuInput): ScreenState => {
  const { screen } = state;

  if (screen.kind === "connect") {
    return input === "confirm" && screen.pad === "dualsense"
      ? toMain(state, "duel")
      : state;
  }

  if (screen.kind === "main") {
    return onMainInput(state, screen, input);
  }

  if (screen.kind === "difficulty") {
    return onDifficultyInput(state, screen, input);
  }

  if (screen.kind === "rivals") {
    return onRivalsInput(state, screen, input);
  }

  if (screen.kind === "controls") {
    return onControlsInput(state, screen, input);
  }

  if (screen.kind === "duel") {
    return input === "options"
      ? {
          ...state,
          screen: { duel: screen, kind: "pause", selected: "continue" },
        }
      : state;
  }

  if (screen.kind === "pause") {
    return onPauseInput(state, screen, input);
  }

  return screen.kind === "result" ? onResultInput(state, screen, input) : state;
};

/** Counts the finished Duel's call-out down, then shows the result. */
const onTick = (state: ScreenState, seconds: number): ScreenState => {
  const { screen } = state;

  if (screen.kind !== "duel" || !screen.over) {
    return state;
  }

  const secondsLeft = screen.over.secondsLeft - seconds;

  if (secondsLeft > 0) {
    return {
      ...state,
      screen: { ...screen, over: { ...screen.over, secondsLeft } },
    };
  }

  return {
    ...state,
    screen: {
      difficulty: screen.difficulty,
      kind: "result",
      selected: "rematch",
      won: screen.over.won,
    },
  };
};

/** Advances the machine by one event. */
export const reduceScreens = (
  state: ScreenState,
  event: ScreenEvent,
  settings: ScreenSettings
): ScreenState => {
  const { screen } = state;

  if (event.type === "start") {
    return screen.kind === "title" ? onStart(state, screen.pad) : state;
  }

  if (event.type === "pad") {
    return onPad(state, event.pad);
  }

  if (event.type === "input") {
    return onInput(state, event.input);
  }

  if (event.type === "tick") {
    return onTick(state, event.seconds);
  }

  if (event.type === "press") {
    // Only the pause for a disconnect listens for any button: it is how a
    // player says they are ready again after plugging the pad back in.
    return screen.kind === "disconnected" && screen.reconnected
      ? { ...state, screen: screen.resume }
      : state;
  }

  // The simulation only runs on the Duel screen, so that is where it ends. A
  // Practice never ends.
  return screen.kind === "duel" && screen.practice === null && !screen.over
    ? {
        ...state,
        screen: {
          ...screen,
          over: { secondsLeft: settings.resultDelaySeconds, won: event.won },
        },
      }
    : state;
};

/** Whether the Duel and its HUD are on show: running, paused or waiting for the controller. */
export const showsDuel = (screen: Screen): boolean =>
  screen.kind === "duel" ||
  screen.kind === "pause" ||
  screen.kind === "disconnected";

/** Whether the Duel on show is a Practice. */
export const practiceOf = (screen: Screen): PracticeRival | null => {
  if (screen.kind === "duel") {
    return screen.practice;
  }

  if (screen.kind === "pause") {
    return screen.duel.practice;
  }

  return screen.kind === "disconnected" ? practiceOf(screen.resume) : null;
};
