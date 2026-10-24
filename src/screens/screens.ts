/**
 * The screen state machine: which screen the game is on, from the unsupported
 * browser, the title and the connect prompt through the main menu (the root once a
 * DualSense is there), the Difficulty select, the Practice rival picker and
 * Entrenamiento's lessons, to the Duel, Practice or Training lesson (with
 * its scrolls: the lesson's before it, its success after it, and the Club de
 * Duelo's welcome once Training is complete), its pause and the result, and
 * Opciones; it also keeps what Training remembers, which opens Duelo and
 * Práctica once every lesson is completed, and the player's Options. Pure: it is fed events
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
import { lessonPlans, lessonSections, lessons } from "../duel/training";
import type { Lesson } from "../duel/training";
import { languages } from "../text";
import type { Language } from "../text";

/** What is plugged in, as far as the screens care. */
export type PadKind = "dualsense" | "none" | "unsupported";

export const mainMenuOptions = [
  "duel",
  "practice",
  "training",
  "controls",
  "options",
] as const;

export type MainMenuOption = (typeof mainMenuOptions)[number];

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

/** The pause of a Training lesson; Salir del entrenamiento goes to the main menu. */
export const trainingPauseOptions = [
  "continue",
  "controls",
  "quitTraining",
] as const;

/** A completed lesson's success scroll: play it again, or go on (Terminar after the last). */
export const lessonDoneOptions = ["repeat", "next"] as const;

export type LessonDoneOption = (typeof lessonDoneOptions)[number];

export type PauseOption =
  | (typeof pauseOptions)[number]
  | (typeof practicePauseOptions)[number]
  | (typeof trainingPauseOptions)[number];

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
  /**
   * Set for a Training lesson, a Practice against the lesson's Training
   * Dummy: which lesson, and once it is completed, how long its call-out
   * still holds before its success scroll.
   */
  readonly training?: {
    readonly lesson: Lesson;
    readonly doneSecondsLeft: number | null;
  };
}

export interface MainScreen {
  readonly kind: "main";
  readonly selected: MainMenuOption;
}

/** Opciones' entries, each changed with left and right where it stands. */
export const optionsEntries = ["language", "music", "effects"] as const;

export type OptionsEntry = (typeof optionsEntries)[number];

/**
 * What the player chose in Opciones, remembered between visits: the language
 * played in, and the music's and the effects' volumes, each in whole steps
 * from 0 (silent) up to `ScreenSettings.volumeSteps` (as mixed).
 */
export interface PlayerOptions {
  readonly language: Language;
  readonly music: number;
  readonly effects: number;
}

/** Why the game cannot be played here: a phone or tablet, or a browser without WebGPU. */
export type CantPlay = "browser" | "device";

/** The Controls' two tabs, switched with L1 and R1 (or the D-pad). */
export const controlsTabs = ["controls", "mechanics"] as const;

export type ControlsTab = (typeof controlsTabs)[number];

export interface PauseScreen {
  readonly kind: "pause";
  readonly duel: DuelScreen;
  readonly selected: PauseOption;
}

/**
 * A parchment scroll over a Training lesson, the Duel frozen behind it: the
 * lesson's own before it starts (✕ starts it), its success once completed
 * (Repetir or Siguiente lección), or the Club de Duelo's welcome once every
 * lesson is completed (✕ goes on to the main menu).
 */
export type ScrollScreen =
  | { readonly kind: "briefing"; readonly duel: DuelScreen }
  | {
      readonly kind: "lessonDone";
      readonly duel: DuelScreen;
      readonly selected: LessonDoneOption;
    }
  | { readonly kind: "certificate"; readonly duel: DuelScreen };

/** The screens a Duel shows behind: running, paused, or under a Training scroll. */
export type DuelShowing = DuelScreen | PauseScreen | ScrollScreen;

export type Screen =
  /** The game cannot be played here, and says why: nothing else can happen. */
  | { readonly kind: "unsupported"; readonly reason: CantPlay }
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
  /** Entrenamiento's lessons, to start from any of them. */
  | { readonly kind: "lessons"; readonly selected: Lesson }
  /** Opciones: the language and the volumes, the highlighted one changed with left and right. */
  | { readonly kind: "options"; readonly selected: OptionsEntry }
  | DuelScreen
  | PauseScreen
  | ScrollScreen
  /** The DualSense dropped out mid-Duel; `resume` is where to return to. */
  | {
      readonly kind: "disconnected";
      readonly resume: DuelShowing;
      /** The DualSense is back; the next button press resumes. */
      readonly reconnected: boolean;
    }
  | {
      readonly kind: "result";
      readonly difficulty: Difficulty;
      readonly won: boolean;
      readonly selected: ResultOption;
    };

/** What the player has done in Training, remembered between visits. */
export interface TrainingRecord {
  /** The lessons completed at least once, in lesson order. */
  readonly completed: readonly Lesson[];
  /** The player has been welcomed to the Club de Duelo: Training's certificate is seen. */
  readonly certified: boolean;
}

export const noTraining: TrainingRecord = { certified: false, completed: [] };

/** Every lesson completed once: Duelo and Práctica are open. */
export const trainingComplete = (record: TrainingRecord): boolean =>
  lessons.every((lesson) => record.completed.includes(lesson));

/**
 * The main menu entries closed until Training is complete. A player already
 * welcomed to the Club de Duelo keeps them open when a lesson is added
 * later: the new lesson waits for them on Entrenamiento, not completed.
 */
export const lockedOptions = (
  record: TrainingRecord
): ReadonlySet<MainMenuOption> =>
  new Set<MainMenuOption>(
    trainingComplete(record) || record.certified ? [] : ["duel", "practice"]
  );

export interface ScreenState {
  readonly screen: Screen;
  /** Duels started so far. */
  readonly runs: number;
  readonly training: TrainingRecord;
  readonly options: PlayerOptions;
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
  /** The Training lesson on screen saw its last goal met. */
  | { readonly type: "lesson-done" }
  | { readonly type: "tick"; readonly seconds: number };

export interface ScreenSettings {
  /** How long a finished Duel's call-out plays before the result screen. */
  readonly resultDelaySeconds: number;
  /** How long a completed lesson's call-out holds before its success scroll. */
  readonly lessonDoneSeconds: number;
  /** A volume's steps from silent to as mixed. */
  readonly volumeSteps: number;
}

/** The Difficulty highlighted the first time the select opens. */
const defaultDifficulty: Difficulty = "duelista";

/** The Options of a first visit, in `language`: every volume as mixed. */
export const defaultOptions = (
  language: Language,
  volumeSteps: number
): PlayerOptions => ({ effects: volumeSteps, language, music: volumeSteps });

/**
 * The first screen, with what is remembered of Training and the Options: the
 * title, or why the game cannot be played here.
 */
export const initialScreenState = (
  playable: true | CantPlay,
  training: TrainingRecord,
  options: PlayerOptions
): ScreenState => ({
  options,
  runs: 0,
  screen:
    playable === true
      ? { kind: "title", pad: "none" }
      : { kind: "unsupported", reason: playable },
  training,
});

/** The pause options for this Duel, Practice or Training lesson. */
export const pauseOptionsFor = (duel: DuelScreen): readonly PauseOption[] => {
  if (duel.training) {
    return trainingPauseOptions;
  }

  return duel.practice === null ? pauseOptions : practicePauseOptions;
};

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

/** The main menu on `selected`, or on Entrenamiento while `selected` is closed. */
const toMain = (state: ScreenState, selected: MainMenuOption): ScreenState => ({
  ...state,
  screen: {
    kind: "main",
    selected: lockedOptions(state.training).has(selected)
      ? "training"
      : selected,
  },
});

/** The Controls on their first tab, going back to `from`. */
const toControls = (
  state: ScreenState,
  from: MainScreen | PauseScreen
): ScreenState => ({
  ...state,
  screen: { from, kind: "controls", tab: controlsTabs[0] },
});

/** The lesson after `lesson`, or null after the last. */
const lessonAfter = (lesson: Lesson): Lesson | null =>
  lessons[lessons.indexOf(lesson) + 1] ?? null;

/**
 * Starts a Training lesson: a Practice against its Training Dummy, as a new
 * run, under its scroll (or straight away, played again).
 */
const startLesson = (
  state: ScreenState,
  lesson: Lesson,
  briefed = true
): ScreenState => {
  const duel: DuelScreen = {
    difficulty: defaultDifficulty,
    kind: "duel",
    over: null,
    practice: lessonPlans[lesson].rival,
    run: state.runs + 1,
    training: { doneSecondsLeft: null, lesson },
  };

  return {
    ...state,
    runs: state.runs + 1,
    screen: briefed ? { duel, kind: "briefing" } : duel,
  };
};

/** Entrenamiento's lessons, on the first not completed yet (or the first, all done). */
const toLessons = (state: ScreenState): ScreenState => ({
  ...state,
  screen: {
    kind: "lessons",
    selected:
      lessons.find((lesson) => !state.training.completed.includes(lesson)) ??
      lessons[0],
  },
});

/**
 * On from a completed lesson: to the Club de Duelo's welcome if Training is
 * now complete and the player has not been welcomed yet, else to the next
 * lesson, or out to the main menu after the last.
 */
const nextLesson = (
  state: ScreenState,
  screen: Extract<ScrollScreen, { kind: "lessonDone" }>
): ScreenState => {
  const lesson = screen.duel.training?.lesson ?? lessons[0];

  if (trainingComplete(state.training) && !state.training.certified) {
    return { ...state, screen: { duel: screen.duel, kind: "certificate" } };
  }

  const next = lessonAfter(lesson);

  return next === null ? toMain(state, "training") : startLesson(state, next);
};

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
  ...state,
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

/** Whether `screen` shows a Duel directly: running, paused or under a Training scroll. */
const isDuelShowing = (screen: Screen): screen is DuelShowing =>
  screen.kind === "duel" ||
  screen.kind === "pause" ||
  screen.kind === "briefing" ||
  screen.kind === "lessonDone" ||
  screen.kind === "certificate";

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

  if (isDuelShowing(screen)) {
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

  if (input === "confirm" && screen.selected === "training") {
    return toLessons(state);
  }

  if (input === "confirm" && screen.selected === "options") {
    return { ...state, screen: { kind: "options", selected: "language" } };
  }

  const selected = step(
    mainMenuOptions,
    screen.selected,
    input,
    lockedOptions(state.training)
  );

  return { ...state, screen: { ...screen, selected } };
};

/**
 * A Training scroll: ✕ starts the lesson under its own; on the success
 * scroll, up and down choose and ✕ plays it again or goes on; ✕ on the Club
 * de Duelo's welcome remembers it and opens the main menu on Duelo.
 */
const onScrollInput = (
  state: ScreenState,
  screen: ScrollScreen,
  input: MenuInput
): ScreenState => {
  if (screen.kind === "briefing") {
    return input === "confirm" ? { ...state, screen: screen.duel } : state;
  }

  if (screen.kind === "certificate") {
    return input === "confirm"
      ? toMain(
          { ...state, training: { ...state.training, certified: true } },
          "duel"
        )
      : state;
  }

  if (input !== "confirm") {
    const selected = step(lessonDoneOptions, screen.selected, input);

    return { ...state, screen: { ...screen, selected } };
  }

  const lesson = screen.duel.training?.lesson ?? lessons[0];

  return screen.selected === "repeat"
    ? startLesson(state, lesson, false)
    : nextLesson(state, screen);
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

/**
 * A section at a time through the lesson list: right to the next section's
 * first lesson; left to the first of its own section, or from there the
 * section before's. Stops at both ends.
 */
const sectionJump = (from: Lesson, input: "left" | "right"): Lesson => {
  const firsts = lessonSections.flatMap((section) =>
    section.lessons.slice(0, 1)
  );

  const index = lessons.indexOf(from);

  const target =
    input === "right"
      ? firsts.find((first) => lessons.indexOf(first) > index)
      : firsts.findLast((first) => lessons.indexOf(first) < index);

  return target ?? from;
};

const onLessonsInput = (
  state: ScreenState,
  screen: Extract<Screen, { kind: "lessons" }>,
  input: MenuInput
): ScreenState => {
  if (input === "back") {
    return toMain(state, "training");
  }

  if (input === "confirm") {
    return startLesson(state, screen.selected);
  }

  const selected =
    input === "left" || input === "right"
      ? sectionJump(screen.selected, input)
      : step(lessons, screen.selected, input);

  return { ...state, screen: { ...screen, selected } };
};

/** The language after `current`, going round, either way. */
const otherLanguage = (current: Language, by: 1 | -1): Language =>
  languages[
    (languages.indexOf(current) + by + languages.length) % languages.length
  ] ?? current;

/** `options` with `entry` stepped once by `by`: the language round, a volume within its range. */
const adjust = (
  options: PlayerOptions,
  entry: OptionsEntry,
  by: 1 | -1,
  volumeSteps: number
): PlayerOptions => {
  if (entry === "language") {
    return { ...options, language: otherLanguage(options.language, by) };
  }

  return {
    ...options,
    [entry]: Math.min(Math.max(options[entry] + by, 0), volumeSteps),
  };
};

/**
 * Opciones: up and down move the highlight; left and right change what it
 * is on (✕ too, on the language); ○ or Options goes back to the main menu.
 */
const onOptionsInput = (
  state: ScreenState,
  screen: Extract<Screen, { kind: "options" }>,
  input: MenuInput,
  settings: ScreenSettings
): ScreenState => {
  if (input === "back" || input === "options") {
    return toMain(state, "options");
  }

  const toggles = input === "confirm" && screen.selected === "language";

  if (input === "left" || input === "right" || toggles) {
    const by = input === "left" ? -1 : 1;

    return {
      ...state,
      options: adjust(state.options, screen.selected, by, settings.volumeSteps),
    };
  }

  const selected = step(optionsEntries, screen.selected, input);

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

  if (screen.selected === "quitTraining") {
    return toMain(state, "training");
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

const onInput = (
  state: ScreenState,
  input: MenuInput,
  settings: ScreenSettings
): ScreenState => {
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

  if (screen.kind === "lessons") {
    return onLessonsInput(state, screen, input);
  }

  if (screen.kind === "options") {
    return onOptionsInput(state, screen, input, settings);
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

  if (
    screen.kind === "briefing" ||
    screen.kind === "lessonDone" ||
    screen.kind === "certificate"
  ) {
    return onScrollInput(state, screen, input);
  }

  return screen.kind === "result" ? onResultInput(state, screen, input) : state;
};

/** Counts a completed lesson's call-out down, then shows its success scroll. */
const onTrainingTick = (
  state: ScreenState,
  screen: DuelScreen,
  seconds: number
): ScreenState => {
  const { training } = screen;

  if (!training || training.doneSecondsLeft === null) {
    return state;
  }

  const doneSecondsLeft = training.doneSecondsLeft - seconds;

  return doneSecondsLeft > 0
    ? {
        ...state,
        screen: { ...screen, training: { ...training, doneSecondsLeft } },
      }
    : {
        ...state,
        screen: { duel: screen, kind: "lessonDone", selected: "next" },
      };
};

/** A Training lesson completed: remembered, and its call-out held. */
const onLessonDone = (
  state: ScreenState,
  settings: ScreenSettings
): ScreenState => {
  const { screen } = state;

  if (
    screen.kind !== "duel" ||
    !screen.training ||
    screen.training.doneSecondsLeft !== null
  ) {
    return state;
  }

  const { lesson } = screen.training;

  return {
    ...state,
    screen: {
      ...screen,
      training: { doneSecondsLeft: settings.lessonDoneSeconds, lesson },
    },
    training: {
      ...state.training,
      completed: lessons.filter(
        (each) => each === lesson || state.training.completed.includes(each)
      ),
    },
  };
};

/** Counts the finished Duel's call-out down, then shows the result. */
const onTick = (state: ScreenState, seconds: number): ScreenState => {
  const { screen } = state;

  if (screen.kind === "duel" && screen.training) {
    return onTrainingTick(state, screen, seconds);
  }

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
    return onInput(state, event.input, settings);
  }

  if (event.type === "tick") {
    return onTick(state, event.seconds);
  }

  if (event.type === "lesson-done") {
    return onLessonDone(state, settings);
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

/** The Duel on show behind `screen`: running, paused, under a scroll or waiting for the controller. */
export const duelOf = (screen: Screen): DuelScreen | undefined => {
  if (screen.kind === "duel") {
    return screen;
  }

  if (isDuelShowing(screen)) {
    return screen.duel;
  }

  return screen.kind === "disconnected" ? duelOf(screen.resume) : undefined;
};

/** Whether the Duel and its HUD are on show. */
export const showsDuel = (screen: Screen): boolean =>
  duelOf(screen) !== undefined;

/** Whether the Duel on show is a Practice. */
export const practiceOf = (screen: Screen): PracticeRival | null =>
  duelOf(screen)?.practice ?? null;
