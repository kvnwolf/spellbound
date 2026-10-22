/**
 * The screen state machine: which screen the game is on, from the unsupported
 * browser and the connect prompt through the Difficulty select (the root once
 * a DualSense is there), the Duel, its pause and result. Pure: it is fed events (the controller coming and going, menu
 * inputs, the Duel ending, time) and lands on the next screen. It owns no
 * three.js, no DOM and no clock; the game loop decides what to draw and
 * whether the Duel simulation may advance from the screen it reports.
 */
import { difficulties } from "../duel/difficulty";
import type { Difficulty } from "../duel/difficulty";

/** What is plugged in, as far as the screens care. */
export type PadKind = "dualsense" | "none" | "unsupported";

export const pauseOptions = ["continue", "restart", "quit"] as const;

export type PauseOption = (typeof pauseOptions)[number];

export const resultOptions = ["rematch", "changeDifficulty"] as const;

export type ResultOption = (typeof resultOptions)[number];

/** A Duel on screen. `run` numbers the Duels started, so the game knows when to build a new one. */
export interface DuelScreen {
  readonly kind: "duel";
  readonly difficulty: Difficulty;
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
  | { readonly kind: "difficulty"; readonly selected: Difficulty }
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

/** Moves a highlight one step through `options`, stopping at both ends. */
const step = <T>(options: readonly T[], selected: T, input: MenuInput): T => {
  if (input !== "down" && input !== "up") {
    return selected;
  }

  const index = options.indexOf(selected) + (input === "down" ? 1 : -1);

  return options[Math.min(Math.max(index, 0), options.length - 1)] ?? selected;
};

/** The Difficulty select, the root of the menus, highlighting `selected`. */
const toSelect = (state: ScreenState, selected: Difficulty): ScreenState => ({
  ...state,
  screen: { kind: "difficulty", selected },
});

/** Starts a Duel: the next run, no winner yet. */
const startDuel = (
  state: ScreenState,
  difficulty: Difficulty
): ScreenState => ({
  runs: state.runs + 1,
  screen: {
    difficulty,
    kind: "duel",
    over: null,
    run: state.runs + 1,
  },
});

const onPad = (state: ScreenState, pad: PadKind): ScreenState => {
  const { screen } = state;
  const connected = pad === "dualsense";

  // A DualSense showing up is all it takes to reach the select: the press
  // that woke it is not read as a menu input (the menu input reader skips
  // whatever a pad that has just appeared is holding).
  if (screen.kind === "connect") {
    return connected
      ? toSelect(state, defaultDifficulty)
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

  if (screen.kind === "difficulty" || screen.kind === "result") {
    return connected ? state : { ...state, screen: { kind: "connect", pad } };
  }

  return state;
};

const onDifficultyInput = (
  state: ScreenState,
  screen: Extract<Screen, { kind: "difficulty" }>,
  input: MenuInput
): ScreenState => {
  if (input === "confirm") {
    return startDuel(state, screen.selected);
  }

  const selected = step(difficulties, screen.selected, input);

  return { ...state, screen: { ...screen, selected } };
};

const onPauseInput = (
  state: ScreenState,
  screen: PauseScreen,
  input: MenuInput
): ScreenState => {
  if (input === "options" || input === "back") {
    return { ...state, screen: screen.duel };
  }

  if (input !== "confirm") {
    const selected = step(pauseOptions, screen.selected, input);

    return { ...state, screen: { ...screen, selected } };
  }

  if (screen.selected === "restart") {
    return startDuel(state, screen.duel.difficulty);
  }

  return screen.selected === "quit"
    ? toSelect(state, screen.duel.difficulty)
    : { ...state, screen: screen.duel };
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

  if (screen.kind === "difficulty") {
    return onDifficultyInput(state, screen, input);
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

  // The simulation only runs on the Duel screen, so that is where it ends.
  return screen.kind === "duel" && !screen.over
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
