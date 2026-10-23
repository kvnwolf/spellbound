/**
 * The screen state machine: which screen the game is on, from the unsupported
 * browser and the connect prompt through the main menu (the root once a
 * DualSense is there), the Difficulty select and the Practice rival picker,
 * to the Duel or Practice, its pause and the result. Pure: it is fed events
 * (the controller coming and going, menu inputs, the Duel ending, time) and
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
  "controls",
]);

/** The pause of a Duel. */
export const pauseOptions = ["continue", "restart", "quit"] as const;

/** The pause of a Practice: no restart, but a change of rival; Salir goes to the main menu. */
export const practicePauseOptions = [
  "continue",
  "changeRival",
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

export interface PauseScreen {
  readonly kind: "pause";
  readonly duel: DuelScreen;
  readonly selected: PauseOption;
}

export type Screen =
  /** WebGPU is missing: nothing else can happen. */
  | { readonly kind: "unsupported" }
  /** No DualSense yet: asks for one. `pad` says whether nothing or some other pad is plugged in. */
  | { readonly kind: "connect"; readonly pad: Exclude<PadKind, "dualsense"> }
  /** The root: Duelo, Práctica, Entrenamiento and Controles. */
  | { readonly kind: "main"; readonly selected: MainMenuOption }
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

export type MenuInput = "back" | "confirm" | "down" | "options" | "up";

export type ScreenEvent =
  /** What is plugged in changed. */
  | { readonly type: "pad"; readonly pad: PadKind }
  /** A menu input: a D-pad or left stick step, ✕, ○ or Options. */
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
  screen: supported
    ? { kind: "connect", pad: "none" }
    : { kind: "unsupported" },
});

/** The pause options for this Duel or Practice. */
export const pauseOptionsFor = (duel: DuelScreen): readonly PauseOption[] =>
  duel.practice === null ? pauseOptions : practicePauseOptions;

/**
 * Moves a highlight one step through `options`, over any `unavailable` ones,
 * stopping at both ends.
 */
const step = <T>(
  options: readonly T[],
  selected: T,
  input: MenuInput,
  unavailable: ReadonlySet<T> = new Set()
): T => {
  if (input !== "down" && input !== "up") {
    return selected;
  }

  const by = input === "down" ? 1 : -1;

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

const onPad = (state: ScreenState, pad: PadKind): ScreenState => {
  const { screen } = state;
  const connected = pad === "dualsense";

  // A DualSense showing up is all it takes to reach the main menu: the press
  // that woke it is not read as a menu input (the menu input reader skips
  // whatever a pad that has just appeared is holding).
  if (screen.kind === "connect") {
    return connected
      ? toMain(state, "duel")
      : { ...state, screen: { ...screen, pad } };
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

  if (screen.selected === "quit") {
    // A Practice leaves for the main menu; a Duel for the Difficulty select.
    return duel.practice === null
      ? toSelect(state, duel.difficulty)
      : toMain(state, "practice");
  }

  return { ...state, screen: duel };
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

  if (screen.kind === "main") {
    return onMainInput(state, screen, input);
  }

  if (screen.kind === "difficulty") {
    return onDifficultyInput(state, screen, input);
  }

  if (screen.kind === "rivals") {
    return onRivalsInput(state, screen, input);
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
