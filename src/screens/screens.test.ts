import { describe, expect, it } from "vitest";

import { lessons } from "../duel/training";
import { languageFor } from "../text";
import {
  defaultOptions,
  initialScreenState,
  noTraining,
  reduceScreens,
} from "./screens";
import type {
  MenuInput,
  ScreenEvent,
  ScreenState,
  TrainingRecord,
} from "./screens";

const settings = {
  lessonDoneSeconds: 2,
  resultDelaySeconds: 3,
  volumeSteps: 10,
};

/** A first visit's Options, in Spanish. */
const firstVisit = defaultOptions("es", settings.volumeSteps);

/** Every lesson completed and the Club de Duelo's welcome seen: Duelo and Práctica open. */
const graduated: TrainingRecord = { certified: true, completed: [...lessons] };

const play = (state: ScreenState, ...events: ScreenEvent[]): ScreenState => {
  let next = state;

  for (const event of events) {
    next = reduceScreens(next, event, settings);
  }

  return next;
};

const press = (input: MenuInput) => ({ input, type: "input" }) as const;

const padFound = { pad: "dualsense", type: "pad" } as const;
const padLost = { pad: "none", type: "pad" } as const;
const anyButton = { type: "press" } as const;
const tick = (seconds: number) => ({ seconds, type: "tick" }) as const;
const start = { type: "start" } as const;

const onTitle = () => initialScreenState(true, graduated, firstVisit);
const onConnect = () => play(onTitle(), start);
const onMain = () => play(onTitle(), padFound, start);

/** Duelo, from the main menu. */
const onSelect = () => play(onMain(), press("confirm"));

/** Práctica, from the main menu. */
const onRivals = () => play(onMain(), press("down"), press("confirm"));

/** Controles, from the main menu. */
const onControls = () =>
  play(onMain(), press("down"), press("down"), press("down"), press("confirm"));

const inDuel = (...moves: ScreenEvent[]) =>
  play(onSelect(), press("confirm"), ...moves);

/** A Practice against the Training Dummy `steps` down the rival picker. */
const inPractice = (steps: number, ...moves: ScreenEvent[]) =>
  play(
    onRivals(),
    ...Array.from({ length: steps }, () => press("down")),
    press("confirm"),
    ...moves
  );

const afterDuel = (won: boolean) =>
  inDuel({ type: "duel-ended", won }, tick(3));

const atMain = (...moves: ScreenEvent[]) => play(onMain(), ...moves).screen;
const atSelect = (...moves: ScreenEvent[]) => play(onSelect(), ...moves).screen;
const atRivals = (...moves: ScreenEvent[]) => play(onRivals(), ...moves).screen;
const paused = () => inDuel(press("options"));
const disconnected = () => inDuel(padLost);

const atControls = (...moves: ScreenEvent[]) =>
  play(onControls(), ...moves).screen;

/** The Controls opened from the pause of a Duel: Controles is third. */
const fromPause = () =>
  play(paused(), press("down"), press("down"), press("confirm"));

describe("title", () => {
  it("starts on the title, waiting for its start button", () => {
    expect(onTitle().screen).toStrictEqual({ kind: "title", pad: "none" });
  });

  it("stays on the title whatever the pad does until the start button is clicked", () => {
    expect(
      play(onTitle(), padFound, press("confirm"), anyButton, tick(5)).screen
    ).toStrictEqual({ kind: "title", pad: "dualsense" });
  });

  it("goes to the main menu on start if a DualSense is already there", () => {
    expect(play(onTitle(), padFound, start).screen).toStrictEqual({
      kind: "main",
      selected: "duel",
    });
  });

  it("asks for a DualSense on start if none is there yet", () => {
    expect(
      play(onTitle(), { pad: "unsupported", type: "pad" }, start).screen
    ).toStrictEqual({ kind: "connect", pad: "unsupported" });
  });

  it("ignores the start button anywhere else", () => {
    expect(play(onMain(), start)).toStrictEqual(onMain());
  });
});

describe("connect prompt", () => {
  it("asks for a controller once started without one", () => {
    expect(onConnect().screen).toStrictEqual({ kind: "connect", pad: "none" });
  });

  it("remembers a pad that is not a DualSense", () => {
    expect(
      play(onConnect(), { pad: "unsupported", type: "pad" }).screen
    ).toStrictEqual({ kind: "connect", pad: "unsupported" });

    expect(
      play(onConnect(), { pad: "unsupported", type: "pad" }, padLost).screen
    ).toStrictEqual({ kind: "connect", pad: "none" });
  });

  it("stays put without a DualSense, whatever is pressed", () => {
    expect(play(onConnect(), press("confirm"), anyButton).screen.kind).toBe(
      "connect"
    );

    expect(
      play(onConnect(), { pad: "unsupported", type: "pad" }, press("confirm"))
        .screen.kind
    ).toBe("connect");
  });

  it("waits for ✕ on the DualSense, not any button", () => {
    expect(play(onConnect(), padFound).screen).toStrictEqual({
      kind: "connect",
      pad: "dualsense",
    });

    expect(
      play(onConnect(), padFound, anyButton, press("back"), press("down"))
        .screen.kind
    ).toBe("connect");
  });

  it("goes to the main menu on ✕, the press that woke the pad picking nothing there", () => {
    expect(
      play(
        onConnect(),
        { pad: "unsupported", type: "pad" },
        padFound,
        press("confirm"),
        anyButton
      ).screen
    ).toStrictEqual({ kind: "main", selected: "duel" });
  });

  it("reports a browser without WebGPU, or a phone or tablet, and nothing else", () => {
    for (const reason of ["browser", "device"] as const) {
      const unsupported = initialScreenState(reason, graduated, firstVisit);

      expect(unsupported.screen).toStrictEqual({ kind: "unsupported", reason });
      expect(
        play(unsupported, start, padFound, press("confirm")).screen
      ).toStrictEqual({ kind: "unsupported", reason });
    }
  });
});

describe("main menu", () => {
  it("highlights Duelo first", () => {
    expect(onMain().screen).toStrictEqual({ kind: "main", selected: "duel" });
  });

  it("moves through Duelo, Práctica, Entrenamiento, Controles and Opciones", () => {
    expect(atMain(press("down"))).toMatchObject({ selected: "practice" });
    expect(atMain(press("down"), press("down"))).toMatchObject({
      selected: "training",
    });
    expect(atMain(press("down"), press("down"), press("down"))).toMatchObject({
      selected: "controls",
    });
    expect(
      atMain(press("down"), press("down"), press("down"), press("down"))
    ).toMatchObject({ selected: "options" });
    expect(atMain(press("up"))).toMatchObject({ selected: "duel" });
  });

  it("stops at Opciones, the last entry", () => {
    expect(
      atMain(...Array.from({ length: 5 }, () => press("down")))
    ).toMatchObject({ selected: "options" });
  });

  it("opens the Controls on Controles, on the Controles tab", () => {
    expect(onControls().screen).toStrictEqual({
      from: { kind: "main", selected: "controls" },
      kind: "controls",
      tab: "controls",
    });
  });

  it("opens the Difficulty select on Duelo", () => {
    expect(onSelect().screen).toStrictEqual({
      kind: "difficulty",
      practice: false,
      selected: "duelista",
    });
  });

  it("opens the rival picker on Práctica, with Maniquí quieto highlighted", () => {
    expect(onRivals().screen).toStrictEqual({
      kind: "rivals",
      selected: "idle",
    });
  });

  it("is the root: ○ does nothing", () => {
    expect(play(onMain(), press("back"))).toStrictEqual(onMain());
  });

  it("ignores time and Options", () => {
    expect(play(onMain(), tick(10), press("options"))).toStrictEqual(onMain());
  });

  it("shows the connect prompt if the controller goes away, and comes back once it returns", () => {
    const unplugged = play(onMain(), press("down"), padLost);

    expect(unplugged.screen).toStrictEqual({ kind: "connect", pad: "none" });
    expect(play(unplugged, padFound, press("confirm")).screen.kind).toBe(
      "main"
    );
  });
});

describe("Controls", () => {
  it("switches to Mecánicas on R1 or right, and back on L1 or left, stopping at the ends", () => {
    expect(atControls(press("right"))).toMatchObject({ tab: "mechanics" });
    expect(atControls(press("right"), press("right"))).toMatchObject({
      tab: "mechanics",
    });
    expect(atControls(press("right"), press("left"))).toMatchObject({
      tab: "controls",
    });
    expect(atControls(press("left"))).toMatchObject({ tab: "controls" });
  });

  it("ignores ✕, up, down and time", () => {
    expect(
      play(onControls(), press("confirm"), press("down"), press("up"), tick(5))
    ).toStrictEqual(onControls());
  });

  it("goes back to the main menu on ○ or Options, with Controles highlighted, from either tab", () => {
    const main = { kind: "main", selected: "controls" };

    expect(atControls(press("back"))).toStrictEqual(main);
    expect(atControls(press("options"))).toStrictEqual(main);
    expect(atControls(press("right"), press("back"))).toStrictEqual(main);
  });

  it("opens from the pause of a Duel, on Controles, and goes back to it", () => {
    const pause = play(paused(), press("down"), press("down"));

    expect(pause.screen).toMatchObject({ kind: "pause", selected: "controls" });
    expect(fromPause().screen).toStrictEqual({
      from: pause.screen,
      kind: "controls",
      tab: "controls",
    });
    expect(play(fromPause(), press("right"), press("back"))).toStrictEqual(
      pause
    );
  });

  it("leaves the paused Duel as it was: back to it, it is the same run", () => {
    const duel = inDuel().screen;

    expect(
      play(
        fromPause(),
        press("back"),
        press("up"),
        press("up"),
        press("confirm")
      ).screen
    ).toStrictEqual(duel);
  });

  it("opens from the pause of a Practice, on Controles, and goes back to it", () => {
    const pause = play(
      inPractice(1, press("options")),
      press("down"),
      press("down")
    );

    expect(pause.screen).toMatchObject({ kind: "pause", selected: "controls" });
    expect(play(pause, press("confirm"), press("back"))).toStrictEqual(pause);
  });

  it("asks for the controller back if it goes away over the pause, then returns to that pause", () => {
    const pause = play(paused(), press("down"), press("down")).screen;
    const lost = play(fromPause(), padLost);

    expect(lost.screen).toStrictEqual({
      kind: "disconnected",
      reconnected: false,
      resume: pause,
    });
    expect(play(lost, padFound, anyButton).screen).toStrictEqual(pause);
  });

  it("shows the connect prompt if the controller goes away over the main menu's Controls", () => {
    expect(atControls(press("right"), padLost)).toStrictEqual({
      kind: "connect",
      pad: "none",
    });
  });
});

describe("Difficulty select", () => {
  it("moves with up and down and stops at the ends", () => {
    expect(atSelect(press("up"))).toMatchObject({ selected: "novato" });
    expect(atSelect(press("up"), press("up"))).toMatchObject({
      selected: "novato",
    });
    expect(atSelect(press("down"))).toMatchObject({ selected: "maestro" });
    expect(atSelect(press("down"), press("down"))).toMatchObject({
      selected: "maestro",
    });
  });

  it("starts the Duel with the highlighted Difficulty", () => {
    const state = play(onSelect(), press("up"), press("confirm"));

    expect(state.screen).toStrictEqual({
      difficulty: "novato",
      kind: "duel",
      over: null,
      practice: null,
      run: 1,
    });
  });

  it("goes back to the main menu on ○, with Duelo highlighted", () => {
    expect(atSelect(press("down"), press("back"))).toStrictEqual({
      kind: "main",
      selected: "duel",
    });
  });

  it("shows the connect prompt if the controller goes away, and the main menu once it is back", () => {
    const unplugged = play(onSelect(), press("down"), padLost);

    expect(unplugged.screen).toStrictEqual({ kind: "connect", pad: "none" });

    expect(play(unplugged, press("confirm"), anyButton).screen.kind).toBe(
      "connect"
    );

    expect(play(unplugged, padFound, press("confirm")).screen.kind).toBe(
      "main"
    );
  });

  it("asks for a DualSense if what is left is another pad", () => {
    expect(
      play(onSelect(), { pad: "unsupported", type: "pad" }).screen
    ).toStrictEqual({ kind: "connect", pad: "unsupported" });
  });
});

describe("Practice rival picker", () => {
  it("lists the Training Dummies then Rival real, stopping at the ends", () => {
    expect(atRivals(press("up"))).toMatchObject({ selected: "idle" });
    expect(atRivals(press("down"))).toMatchObject({ selected: "casts" });
    expect(atRivals(press("down"), press("down"))).toMatchObject({
      selected: "clash",
    });
    expect(atRivals(press("down"), press("down"), press("down"))).toMatchObject(
      { selected: "disarms" }
    );
    expect(
      atRivals(...Array.from({ length: 6 }, () => press("down")))
    ).toMatchObject({ selected: "ai" });
  });

  it("starts a Practice at once against a Training Dummy", () => {
    expect(inPractice(0).screen).toStrictEqual({
      difficulty: "duelista",
      kind: "duel",
      over: null,
      practice: "idle",
      run: 1,
    });
    expect(inPractice(1).screen).toMatchObject({ practice: "casts" });
    expect(inPractice(2).screen).toMatchObject({ practice: "clash" });
    expect(inPractice(3).screen).toMatchObject({ practice: "disarms" });
  });

  it("asks for the Difficulty of Rival real, then starts a Practice against the AI", () => {
    const select = play(
      onRivals(),
      ...Array.from({ length: 4 }, () => press("down")),
      press("confirm")
    );

    expect(select.screen).toStrictEqual({
      kind: "difficulty",
      practice: true,
      selected: "duelista",
    });

    expect(play(select, press("down"), press("confirm")).screen).toStrictEqual({
      difficulty: "maestro",
      kind: "duel",
      over: null,
      practice: "ai",
      run: 1,
    });
  });

  it("goes back from the Difficulty of Rival real to the picker, on Rival real", () => {
    expect(
      play(
        onRivals(),
        ...Array.from({ length: 4 }, () => press("down")),
        press("confirm"),
        press("back")
      ).screen
    ).toStrictEqual({ kind: "rivals", selected: "ai" });
  });

  it("goes back to the main menu on ○, with Práctica highlighted", () => {
    expect(atRivals(press("down"), press("back"))).toStrictEqual({
      kind: "main",
      selected: "practice",
    });
  });

  it("shows the connect prompt if the controller goes away", () => {
    expect(play(onRivals(), padLost).screen).toStrictEqual({
      kind: "connect",
      pad: "none",
    });
  });
});

describe("Practice", () => {
  it("ignores menu input while it runs", () => {
    const before = inPractice(1);

    expect(
      play(before, press("down"), press("confirm"), press("back"))
    ).toStrictEqual(before);
  });

  it("never ends: a Duel ending is not heard, and time changes nothing", () => {
    const before = inPractice(1);

    expect(
      play(before, { type: "duel-ended", won: true }, tick(10))
    ).toStrictEqual(before);
  });

  it("pauses on Options with Continuar, Cambiar rival, Controles and Salir al menú", () => {
    const pause = inPractice(1, press("options"));

    expect(pause.screen).toMatchObject({ kind: "pause", selected: "continue" });
    expect(play(pause, press("down")).screen).toMatchObject({
      selected: "changeRival",
    });
    expect(play(pause, press("down"), press("down")).screen).toMatchObject({
      selected: "controls",
    });
    expect(
      play(pause, press("down"), press("down"), press("down"), press("down"))
        .screen
    ).toMatchObject({ selected: "quit" });
    expect(
      play(pause, press("down"), press("down"), press("down")).screen
    ).toMatchObject({ selected: "quit" });
  });

  it("continues on Continuar, Options or ○", () => {
    const practice = inPractice(1).screen;
    const pause = inPractice(1, press("options"));

    expect(play(pause, press("confirm")).screen).toStrictEqual(practice);
    expect(play(pause, press("options")).screen).toStrictEqual(practice);
    expect(play(pause, press("back")).screen).toStrictEqual(practice);
  });

  it("goes to the rival picker on Cambiar rival, on the current rival, and the next pick is a new run", () => {
    const picker = play(
      inPractice(2, press("options")),
      press("down"),
      press("confirm")
    );

    expect(picker.screen).toStrictEqual({ kind: "rivals", selected: "clash" });
    expect(play(picker, press("down"), press("confirm")).screen).toMatchObject({
      kind: "duel",
      practice: "disarms",
      run: 2,
    });
  });

  it("leaves for the main menu on Salir al menú, with Práctica highlighted", () => {
    expect(
      play(
        inPractice(1, press("options")),
        press("down"),
        press("down"),
        press("down"),
        press("confirm")
      ).screen
    ).toStrictEqual({ kind: "main", selected: "practice" });
  });

  it("pauses for a disconnect and resumes the same Practice after reconnecting", () => {
    const practice = inPractice(3).screen;

    expect(
      play(inPractice(3), padLost, padFound, anyButton).screen
    ).toStrictEqual(practice);
  });
});

describe("Duel", () => {
  it("numbers every Duel it starts, so the game knows when to build a new one", () => {
    const second = play(
      inDuel(),
      press("options"),
      press("down"),
      press("confirm")
    );

    expect(inDuel().screen).toMatchObject({ run: 1 });
    expect(second.screen).toMatchObject({ kind: "duel", run: 2 });
  });

  it("ignores menu input while it runs", () => {
    const before = inDuel();

    expect(
      play(before, press("down"), press("confirm"), press("back"))
    ).toStrictEqual(before);
  });

  it("holds a won Duel on screen for a moment, then shows the result", () => {
    const ended = inDuel({ type: "duel-ended", won: true });

    expect(ended.screen).toMatchObject({
      kind: "duel",
      over: { secondsLeft: 3, won: true },
    });

    expect(play(ended, tick(2)).screen.kind).toBe("duel");

    expect(play(ended, tick(2), tick(1)).screen).toStrictEqual({
      difficulty: "duelista",
      kind: "result",
      selected: "rematch",
      won: true,
    });
  });

  it("ignores time while no Duel is running", () => {
    expect(play(onSelect(), tick(10))).toStrictEqual(onSelect());
  });
});

describe("pause", () => {
  it("opens on Options with Continuar highlighted", () => {
    expect(paused().screen).toMatchObject({
      kind: "pause",
      selected: "continue",
    });
  });

  it("continues on Options again, ○, or ✕ on Continuar", () => {
    const duel = inDuel().screen;

    expect(play(paused(), press("options")).screen).toStrictEqual(duel);
    expect(play(paused(), press("back")).screen).toStrictEqual(duel);
    expect(play(paused(), press("confirm")).screen).toStrictEqual(duel);
  });

  it("keeps the end-of-Duel countdown where it was", () => {
    const state = play(
      inDuel({ type: "duel-ended", won: false }, tick(1)),
      press("options"),
      tick(5),
      press("options")
    );

    expect(state.screen).toMatchObject({
      kind: "duel",
      over: { secondsLeft: 2, won: false },
    });
  });

  it("restarts the Duel with the same Difficulty", () => {
    const state = play(
      onSelect(),
      press("down"),
      press("confirm"),
      press("options"),
      press("down"),
      press("confirm")
    );

    expect(state.screen).toMatchObject({
      difficulty: "maestro",
      kind: "duel",
      over: null,
      practice: null,
      run: 2,
    });
  });

  it("leaves for the Difficulty select with Salir, keeping the current choice", () => {
    expect(
      play(
        paused(),
        press("down"),
        press("down"),
        press("down"),
        press("confirm")
      ).screen
    ).toStrictEqual({
      kind: "difficulty",
      practice: false,
      selected: "duelista",
    });
  });

  it("stops at the ends of the list", () => {
    expect(play(paused(), press("up")).screen).toMatchObject({
      selected: "continue",
    });

    expect(
      play(paused(), press("down"), press("down"), press("down"), press("down"))
        .screen
    ).toMatchObject({ selected: "quit" });
  });
});

describe("controller disconnect", () => {
  it("pauses a running Duel", () => {
    expect(disconnected().screen).toMatchObject({
      kind: "disconnected",
      reconnected: false,
    });
  });

  it("does not resume until the controller is back and a button is pressed", () => {
    expect(play(disconnected(), anyButton).screen.kind).toBe("disconnected");

    const back = play(disconnected(), padFound);

    expect(back.screen).toMatchObject({
      kind: "disconnected",
      reconnected: true,
    });
    expect(play(back, press("confirm")).screen.kind).toBe("disconnected");
  });

  it("resumes the same Duel on a button press after reconnecting", () => {
    const duel = inDuel().screen;

    expect(play(disconnected(), padFound, anyButton).screen).toStrictEqual(
      duel
    );
  });

  it("needs another reconnect if it drops out again before a button press", () => {
    expect(
      play(disconnected(), padFound, padLost, anyButton).screen
    ).toMatchObject({ kind: "disconnected", reconnected: false });
  });

  it("returns to the pause menu if it was open", () => {
    const menu = inDuel(press("options")).screen;

    expect(
      play(inDuel(press("options")), padLost, padFound, anyButton).screen
    ).toStrictEqual(menu);
  });

  it("keeps the end-of-Duel countdown frozen while disconnected", () => {
    const state = play(
      inDuel({ type: "duel-ended", won: true }),
      padLost,
      tick(10),
      padFound,
      anyButton
    );

    expect(state.screen).toMatchObject({
      kind: "duel",
      over: { secondsLeft: 3, won: true },
    });
  });

  it("does not resume on an unsupported pad", () => {
    expect(
      play(disconnected(), { pad: "unsupported", type: "pad" }, anyButton)
        .screen
    ).toMatchObject({ kind: "disconnected", reconnected: false });
  });
});

describe("result", () => {
  it("shows the outcome with Revancha highlighted", () => {
    expect(afterDuel(false).screen).toStrictEqual({
      difficulty: "duelista",
      kind: "result",
      selected: "rematch",
      won: false,
    });
  });

  it("restarts the Duel with the same Difficulty on Revancha", () => {
    const state = play(afterDuel(true), press("confirm"));

    expect(state.screen).toMatchObject({
      difficulty: "duelista",
      kind: "duel",
      over: null,
      practice: null,
      run: 2,
    });
  });

  it("goes to the Difficulty select on Cambiar dificultad, keeping the current choice", () => {
    expect(
      play(afterDuel(true), press("down"), press("confirm")).screen
    ).toStrictEqual({
      kind: "difficulty",
      practice: false,
      selected: "duelista",
    });
  });

  it("starts the next Duel after a change of Difficulty with the new Difficulty", () => {
    const state = play(
      afterDuel(true),
      press("down"),
      press("confirm"),
      press("up"),
      press("confirm")
    );

    expect(state.screen).toMatchObject({
      difficulty: "novato",
      kind: "duel",
      run: 2,
    });
  });

  it("goes to the Difficulty select on ○", () => {
    expect(play(afterDuel(true), press("back")).screen).toStrictEqual({
      kind: "difficulty",
      practice: false,
      selected: "duelista",
    });
  });

  it("shows the connect prompt if the controller goes away, and returns to the main menu once it is back", () => {
    const unplugged = play(afterDuel(true), padLost);

    expect(unplugged.screen).toStrictEqual({ kind: "connect", pad: "none" });
    expect(play(unplugged, padFound, press("confirm")).screen.kind).toBe(
      "main"
    );
  });
});

describe("a whole session", () => {
  it("connect, Duelo, select, Duel, result, Revancha, result, then back to the select", () => {
    const state = play(
      onConnect(),
      padFound,
      press("confirm"),
      press("confirm"),
      press("down"),
      press("confirm"),
      { type: "duel-ended", won: false },
      tick(3),
      press("confirm"),
      { type: "duel-ended", won: true },
      tick(3),
      press("back")
    );

    expect(state.screen).toStrictEqual({
      kind: "difficulty",
      practice: false,
      selected: "maestro",
    });
  });

  it("connect, Práctica, a Training Dummy, a change of rival, then out to the main menu and into a Duel", () => {
    const state = play(
      onConnect(),
      padFound,
      press("confirm"),
      press("down"),
      press("confirm"),
      press("down"),
      press("confirm"),
      press("options"),
      press("down"),
      press("confirm"),
      press("up"),
      press("confirm"),
      press("options"),
      press("down"),
      press("down"),
      press("down"),
      press("confirm"),
      press("up"),
      press("confirm"),
      press("confirm")
    );

    expect(state).toStrictEqual({
      options: firstVisit,
      runs: 3,
      screen: {
        difficulty: "duelista",
        kind: "duel",
        over: null,
        practice: null,
        run: 3,
      },
      training: graduated,
    });
  });
});

/** Opciones, from the bottom of the main menu. */
const onOptions = () =>
  play(
    onMain(),
    ...Array.from({ length: 4 }, () => press("down")),
    press("confirm")
  );

const atOptions = (...moves: ScreenEvent[]) => play(onOptions(), ...moves);

describe("Opciones", () => {
  it("plays a first visit in Spanish for a Spanish browser, else in English, every volume as mixed", () => {
    expect(defaultOptions(languageFor("es-CR"), 10)).toStrictEqual({
      effects: 10,
      language: "es",
      music: 10,
    });
    expect(["ES", "en-US", "pt-BR"].map(languageFor)).toStrictEqual([
      "es",
      "en",
      "en",
    ]);
    expect(languageFor()).toBe("en");
  });

  it("opens from the main menu on Idioma", () => {
    expect(onOptions().screen).toStrictEqual({
      kind: "options",
      selected: "language",
    });
  });

  it("moves through Idioma, Música and Efectos, stopping at both ends", () => {
    expect(atOptions(press("down")).screen).toMatchObject({
      selected: "music",
    });
    expect(atOptions(press("down"), press("down")).screen).toMatchObject({
      selected: "effects",
    });
    expect(
      atOptions(press("down"), press("down"), press("down")).screen
    ).toMatchObject({ selected: "effects" });
    expect(atOptions(press("up")).screen).toMatchObject({
      selected: "language",
    });
  });

  it("switches the language with left, right or ✕, round and round", () => {
    expect(atOptions(press("right")).options.language).toBe("en");
    expect(atOptions(press("left")).options.language).toBe("en");
    expect(atOptions(press("confirm")).options.language).toBe("en");
    expect(atOptions(press("right"), press("right")).options.language).toBe(
      "es"
    );
  });

  it("changes only what is highlighted, and stays on Opciones", () => {
    const state = atOptions(press("right"));

    expect(state.screen).toStrictEqual({
      kind: "options",
      selected: "language",
    });
    expect(state.options).toStrictEqual({ ...firstVisit, language: "en" });
  });

  it("turns the music and the effects down a step at a time, to silent and no further", () => {
    const quieter = atOptions(press("down"), press("left"), press("left"));

    expect(quieter.options).toStrictEqual({ ...firstVisit, music: 8 });

    const silent = atOptions(
      press("down"),
      press("down"),
      ...Array.from({ length: 12 }, () => press("left"))
    );

    expect(silent.options).toStrictEqual({ ...firstVisit, effects: 0 });
  });

  it("turns a volume up again, never past as mixed", () => {
    const state = atOptions(
      press("down"),
      press("left"),
      press("left"),
      press("left"),
      press("right"),
      press("right"),
      press("right"),
      press("right")
    );

    expect(state.options.music).toBe(settings.volumeSteps);
  });

  it("leaves a volume as it is on ✕", () => {
    expect(atOptions(press("down"), press("confirm")).options).toBe(
      onOptions().options
    );
  });

  it("goes back to the main menu on Opciones with ○ or Options, keeping what was changed", () => {
    for (const input of ["back", "options"] as const) {
      const state = atOptions(press("right"), press(input));

      expect(state.screen).toStrictEqual({ kind: "main", selected: "options" });
      expect(state.options.language).toBe("en");
    }
  });

  it("starts from the Options it is given, as remembered", () => {
    const remembered = { effects: 3, language: "en", music: 0 } as const;

    expect(
      play(
        initialScreenState(true, graduated, remembered),
        padFound,
        start,
        ...Array.from({ length: 4 }, () => press("down")),
        press("confirm"),
        press("down"),
        press("right")
      ).options
    ).toStrictEqual({ ...remembered, music: 1 });
  });

  it("opens with Training still to do, past the closed Duelo and Práctica", () => {
    const state = play(
      initialScreenState(true, noTraining, firstVisit),
      padFound,
      start,
      press("down"),
      press("down"),
      press("confirm")
    );

    expect(state.screen).toStrictEqual({
      kind: "options",
      selected: "language",
    });
  });
});

/** The main menu, with `training` remembered. */
const onMainWith = (training: TrainingRecord): ScreenState =>
  play(initialScreenState(true, training, firstVisit), padFound, start);

/** Entrenamiento, from the main menu, with `training` remembered. */
const onLessons = (training: TrainingRecord = noTraining): ScreenState => {
  let state = onMainWith(training);

  while (state.screen.kind === "main" && state.screen.selected !== "training") {
    state = play(state, press("down"));
  }

  return play(state, press("confirm"));
};

/** The lesson `steps` down the list, past its scroll, with `training` remembered. */
const inLesson = (
  steps: number,
  training: TrainingRecord = noTraining,
  ...moves: ScreenEvent[]
) =>
  play(
    onLessons(training),
    ...Array.from({ length: steps }, () => press("down")),
    press("confirm"),
    press("confirm"),
    ...moves
  );

/** The first lesson, from Entrenamiento, past its scroll. */
const inTraining = (...moves: ScreenEvent[]) =>
  inLesson(0, noTraining, ...moves);

/** Entrenamiento's list after `moves`. */
const lessonsOn = (...moves: MenuInput[]) =>
  play(onLessons(), ...moves.map(press)).screen;

const lastLesson = lessons.length - 1;

/** Every lesson but the last completed: the last one is all that is left. */
const allButLast: TrainingRecord = {
  certified: false,
  completed: lessons.slice(0, -1),
};

describe("Training is required", () => {
  it("highlights Entrenamiento on the main menu until every lesson is completed", () => {
    expect(onMainWith(noTraining).screen).toStrictEqual({
      kind: "main",
      selected: "training",
    });
    expect(onMainWith(allButLast).screen).toMatchObject({
      selected: "training",
    });
  });

  it("skips Duelo and Práctica until then", () => {
    const main = onMainWith(noTraining);

    expect(play(main, press("up")).screen).toMatchObject({
      selected: "training",
    });
    expect(play(main, press("down"), press("up")).screen).toMatchObject({
      selected: "training",
    });
  });

  it("goes to the main menu on Entrenamiento from the connect prompt too", () => {
    expect(
      play(
        initialScreenState(true, noTraining, firstVisit),
        start,
        padFound,
        press("confirm")
      ).screen
    ).toStrictEqual({ kind: "main", selected: "training" });
  });

  it("keeps Duelo and Práctica open for a player welcomed to the Club de Duelo before a lesson was added", () => {
    const main = onMainWith({
      certified: true,
      completed: allButLast.completed,
    });

    expect(main.screen).toMatchObject({ selected: "duel" });
    expect(play(main, press("down")).screen).toMatchObject({
      selected: "practice",
    });
  });

  it("does not welcome such a player to the Club de Duelo again once the new lesson is done", () => {
    const after = play(
      inLesson(lastLesson, {
        certified: true,
        completed: allButLast.completed,
      }),
      { type: "lesson-done" },
      tick(2),
      press("confirm")
    );

    expect(after.screen).toStrictEqual({ kind: "main", selected: "training" });
    expect(after.training).toStrictEqual({
      certified: true,
      completed: [...lessons],
    });
  });

  it("opens Duelo and Práctica once every lesson is completed", () => {
    const main = onMainWith({ certified: false, completed: [...lessons] });

    expect(main.screen).toMatchObject({ selected: "duel" });
    expect(play(main, press("down")).screen).toMatchObject({
      selected: "practice",
    });
  });
});

describe("Training", () => {
  const lessonDone = { type: "lesson-done" } as const;

  it("lists the lessons on Entrenamiento, highlighting the first", () => {
    expect(onLessons().screen).toStrictEqual({
      kind: "lessons",
      selected: "move",
    });
  });

  it("walks the highlight down through every lesson, Ganar un Clash included, and opens the one picked", () => {
    for (const [index, lesson] of lessons.entries()) {
      const highlighted = play(
        onLessons(),
        ...Array.from({ length: index }, () => press("down"))
      );

      expect(highlighted.screen).toStrictEqual({
        kind: "lessons",
        selected: lesson,
      });
      expect(play(highlighted, press("confirm")).screen).toMatchObject({
        duel: { training: { lesson } },
        kind: "briefing",
      });
    }

    expect(lessons).toContain("clash");
  });

  it("stops at the last lesson, and comes back up to the first", () => {
    const bottom = play(
      onLessons(),
      ...Array.from({ length: lessons.length + 3 }, () => press("down"))
    );

    expect(bottom.screen).toMatchObject({ selected: "disarmed" });
    expect(
      play(
        bottom,
        ...Array.from({ length: lessons.length + 3 }, () => press("up"))
      ).screen
    ).toMatchObject({ selected: "move" });
  });

  it("jumps to the next section's first lesson with right (R1)", () => {
    expect(lessonsOn("right")).toMatchObject({ selected: "light" });
    expect(lessonsOn("right", "right", "right")).toMatchObject({
      selected: "focus",
    });
    expect(
      lessonsOn("right", "right", "right", "right", "right", "right")
    ).toMatchObject({ selected: "clash" });
    expect(lessonsOn("right", "right", "right", "down", "down")).toMatchObject({
      selected: "incendio",
    });
  });

  it("jumps back with left (L1): to the first lesson of its own section, then of the one before", () => {
    expect(
      lessonsOn("right", "right", "right", "down", "down", "left")
    ).toMatchObject({ selected: "focus" });
    expect(
      lessonsOn("right", "right", "right", "down", "down", "left", "left")
    ).toMatchObject({ selected: "shield" });
    expect(lessonsOn("left")).toMatchObject({ selected: "move" });
  });

  it("highlights the first lesson not completed yet", () => {
    expect(
      onLessons({ certified: false, completed: ["move", "lockOn"] }).screen
    ).toMatchObject({ selected: "light" });
  });

  it("highlights the first lesson again once every lesson is completed", () => {
    expect(onLessons(graduated).screen).toMatchObject({ selected: "move" });
  });

  it("goes back to the main menu on ○, with Entrenamiento highlighted", () => {
    expect(
      play(onLessons(), press("down"), press("back")).screen
    ).toStrictEqual({ kind: "main", selected: "training" });
  });

  it("opens a lesson on its scroll, the lesson waiting behind it", () => {
    expect(play(onLessons(), press("confirm")).screen).toStrictEqual({
      duel: {
        difficulty: "duelista",
        kind: "duel",
        over: null,
        practice: "idle",
        run: 1,
        training: { doneSecondsLeft: null, lesson: "move" },
      },
      kind: "briefing",
    });
  });

  it("starts the lesson as a Practice against its Training Dummy once ✕ closes the scroll", () => {
    const briefing = play(onLessons(), press("confirm"));

    expect(
      play(briefing, press("up"), press("back"), press("options"), tick(5))
    ).toStrictEqual(briefing);
    expect(inTraining().screen).toStrictEqual({
      difficulty: "duelista",
      kind: "duel",
      over: null,
      practice: "idle",
      run: 1,
      training: { doneSecondsLeft: null, lesson: "move" },
    });
    expect(inLesson(4).screen).toMatchObject({
      practice: "casts",
      training: { lesson: "shield" },
    });
  });

  it("holds a completed lesson for its call-out, then shows its success scroll on Siguiente lección", () => {
    const done = inTraining(lessonDone, tick(1));

    expect(done.screen).toMatchObject({
      kind: "duel",
      run: 1,
      training: { doneSecondsLeft: 1, lesson: "move" },
    });

    const scroll = play(done, tick(1));

    expect(scroll.screen).toMatchObject({
      duel: { run: 1, training: { lesson: "move" } },
      kind: "lessonDone",
      selected: "next",
    });
    // No auto-advance: it waits for the player.
    expect(play(scroll, tick(30))).toStrictEqual(scroll);
  });

  it("moves between Repetir and Siguiente lección, stopping at the ends", () => {
    const scroll = inTraining(lessonDone, tick(2));

    expect(play(scroll, press("up")).screen).toMatchObject({
      selected: "repeat",
    });
    expect(play(scroll, press("up"), press("up")).screen).toMatchObject({
      selected: "repeat",
    });
    expect(play(scroll, press("down")).screen).toMatchObject({
      selected: "next",
    });
  });

  it("plays the lesson again on Repetir, as a new run, straight away", () => {
    const again = inTraining(
      lessonDone,
      tick(2),
      press("up"),
      press("confirm")
    );

    expect(again.screen).toStrictEqual({
      difficulty: "duelista",
      kind: "duel",
      over: null,
      practice: "idle",
      run: 2,
      training: { doneSecondsLeft: null, lesson: "move" },
    });
  });

  it("opens the next lesson's scroll on Siguiente lección, as a new run", () => {
    const next = inTraining(lessonDone, tick(2), press("confirm"));

    expect(next.screen).toMatchObject({
      duel: { run: 2, training: { doneSecondsLeft: null, lesson: "lockOn" } },
      kind: "briefing",
    });
  });

  it("remembers every lesson completed, once each", () => {
    const state = inTraining(
      lessonDone,
      tick(2),
      press("up"),
      press("confirm"),
      lessonDone,
      tick(2),
      press("confirm"),
      press("confirm"),
      lessonDone
    );

    expect(state.training).toStrictEqual({
      certified: false,
      completed: ["move", "lockOn"],
    });
  });

  it("never ends on a Duel ending", () => {
    const before = inTraining();

    expect(play(before, { type: "duel-ended", won: false })).toStrictEqual(
      before
    );
  });

  it("welcomes the player to the Club de Duelo after the last lesson, then opens the main menu on Duelo", () => {
    const finished = inLesson(lastLesson, allButLast, lessonDone, tick(2));

    expect(finished.screen).toMatchObject({
      kind: "lessonDone",
      selected: "next",
    });

    const certificate = play(finished, press("confirm"));

    expect(certificate.screen).toMatchObject({ kind: "certificate" });
    expect(play(certificate, press("up"), tick(9))).toStrictEqual(certificate);

    const welcomed = play(certificate, press("confirm"));

    expect(welcomed.screen).toStrictEqual({ kind: "main", selected: "duel" });
    expect(welcomed.training).toStrictEqual({
      certified: true,
      completed: [...lessons],
    });
  });

  it("welcomes the player as soon as the lesson that completes Training is left, whichever it is", () => {
    const record: TrainingRecord = {
      certified: false,
      completed: lessons.filter((lesson) => lesson !== "heavy"),
    };

    expect(play(onLessons(record), press("confirm")).screen).toMatchObject({
      duel: { training: { lesson: "heavy" } },
    });
    expect(
      play(
        onLessons(record),
        press("confirm"),
        press("confirm"),
        lessonDone,
        tick(2),
        press("confirm")
      ).screen
    ).toMatchObject({ kind: "certificate" });
  });

  it("finishes a replayed last lesson on Terminar back on the main menu, once welcomed", () => {
    expect(
      inLesson(lastLesson, graduated, lessonDone, tick(2), press("confirm"))
        .screen
    ).toStrictEqual({ kind: "main", selected: "training" });
  });

  it("pauses on Options with Continuar, Controles and Salir del entrenamiento", () => {
    const pause = inTraining(press("options"));

    expect(pause.screen).toMatchObject({ kind: "pause", selected: "continue" });
    expect(play(pause, press("down")).screen).toMatchObject({
      selected: "controls",
    });
    expect(play(pause, press("down"), press("down")).screen).toMatchObject({
      selected: "quitTraining",
    });
    expect(
      play(pause, press("down"), press("down"), press("down")).screen
    ).toMatchObject({ selected: "quitTraining" });
  });

  it("opens the Controls from the lesson pause and comes back to that pause", () => {
    const pause = play(inTraining(press("options")), press("down"));

    const controls = play(pause, press("confirm"));

    expect(controls.screen).toMatchObject({
      from: pause.screen,
      kind: "controls",
    });
    expect(play(controls, press("back")).screen).toStrictEqual(pause.screen);
  });

  it("continues the same lesson on Continuar", () => {
    expect(
      play(inTraining(press("options")), press("confirm")).screen
    ).toStrictEqual(inTraining().screen);
  });

  it("leaves for the main menu on Salir del entrenamiento, with Entrenamiento highlighted", () => {
    expect(
      play(
        inTraining(press("options")),
        press("down"),
        press("down"),
        press("confirm")
      ).screen
    ).toStrictEqual({ kind: "main", selected: "training" });
  });

  it("does not complete a lesson twice while its call-out holds, nor while paused", () => {
    const holding = inTraining(lessonDone, tick(1), lessonDone);

    expect(holding.screen).toMatchObject({
      training: { doneSecondsLeft: 1 },
    });

    const whilePaused = inTraining(press("options"), lessonDone);

    expect(whilePaused.training.completed).toStrictEqual([]);
  });

  it("waits for the controller over a scroll, then returns to it", () => {
    const scroll = play(onLessons(), press("confirm"));
    const lost = play(scroll, padLost);

    expect(lost.screen).toMatchObject({
      kind: "disconnected",
      reconnected: false,
    });
    expect(play(lost, padFound, anyButton).screen).toStrictEqual(scroll.screen);
  });
});
