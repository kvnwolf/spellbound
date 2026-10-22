import { describe, expect, it } from "vitest";

import { initialScreenState, reduceScreens } from "./screens";
import type { ScreenEvent, ScreenState } from "./screens";

const settings = { resultDelaySeconds: 3 };

const play = (state: ScreenState, ...events: ScreenEvent[]): ScreenState => {
  let next = state;

  for (const event of events) {
    next = reduceScreens(next, event, settings);
  }

  return next;
};

const press = (input: "back" | "confirm" | "down" | "options" | "up") =>
  ({ input, type: "input" }) as const;

const padFound = { pad: "dualsense", type: "pad" } as const;
const padLost = { pad: "none", type: "pad" } as const;
const anyButton = { type: "press" } as const;
const tick = (seconds: number) => ({ seconds, type: "tick" }) as const;

const onConnect = () => initialScreenState(true);
const onSelect = () => play(onConnect(), padFound);

const inDuel = (...moves: ScreenEvent[]) =>
  play(onSelect(), press("confirm"), ...moves);

const afterDuel = (won: boolean) =>
  inDuel({ type: "duel-ended", won }, tick(3));

const atSelect = (...moves: ScreenEvent[]) => play(onSelect(), ...moves).screen;
const paused = () => inDuel(press("options"));
const disconnected = () => inDuel(padLost);

describe("connect prompt", () => {
  it("starts on the connect prompt waiting for a controller", () => {
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

  it("goes straight to the Difficulty select once a DualSense is detected", () => {
    expect(onSelect().screen.kind).toBe("difficulty");

    expect(
      play(onConnect(), { pad: "unsupported", type: "pad" }, padFound).screen
        .kind
    ).toBe("difficulty");
  });

  it("does not pick a Difficulty with the press that woke the pad", () => {
    expect(play(onConnect(), padFound, anyButton).screen).toStrictEqual({
      kind: "difficulty",
      selected: "duelista",
    });
  });

  it("reports an unsupported browser and nothing else", () => {
    const unsupported = initialScreenState(false);

    expect(unsupported.screen).toStrictEqual({ kind: "unsupported" });
    expect(play(unsupported, padFound, press("confirm")).screen).toStrictEqual({
      kind: "unsupported",
    });
  });
});

describe("Difficulty select", () => {
  it("highlights Duelista first", () => {
    expect(onSelect().screen).toStrictEqual({
      kind: "difficulty",
      selected: "duelista",
    });
  });

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

    expect(state.screen).toMatchObject({
      difficulty: "novato",
      kind: "duel",
      over: null,
    });
  });

  it("is the root: ○ does nothing", () => {
    expect(play(onSelect(), press("back"))).toStrictEqual(onSelect());
  });

  it("shows the connect prompt if the controller goes away, and comes back once it returns", () => {
    const unplugged = play(onSelect(), press("down"), padLost);

    expect(unplugged.screen).toStrictEqual({ kind: "connect", pad: "none" });

    expect(play(unplugged, press("confirm"), anyButton).screen.kind).toBe(
      "connect"
    );

    expect(play(unplugged, padFound, anyButton).screen.kind).toBe("difficulty");
  });

  it("asks for a DualSense if what is left is another pad", () => {
    expect(
      play(onSelect(), { pad: "unsupported", type: "pad" }).screen
    ).toStrictEqual({ kind: "connect", pad: "unsupported" });
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
      run: 2,
    });
  });

  it("leaves for the Difficulty select with Salir, keeping the current choice", () => {
    expect(
      play(paused(), press("down"), press("down"), press("confirm")).screen
    ).toStrictEqual({ kind: "difficulty", selected: "duelista" });
  });

  it("stops at the ends of the list", () => {
    expect(play(paused(), press("up")).screen).toMatchObject({
      selected: "continue",
    });

    expect(
      play(paused(), press("down"), press("down"), press("down")).screen
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
      run: 2,
    });
  });

  it("goes to the Difficulty select on Cambiar dificultad, keeping the current choice", () => {
    expect(
      play(afterDuel(true), press("down"), press("confirm")).screen
    ).toStrictEqual({ kind: "difficulty", selected: "duelista" });
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
      selected: "duelista",
    });
  });

  it("shows the connect prompt if the controller goes away, and returns to the select once it is back", () => {
    const unplugged = play(afterDuel(true), padLost);

    expect(unplugged.screen).toStrictEqual({ kind: "connect", pad: "none" });
    expect(play(unplugged, padFound, anyButton).screen.kind).toBe("difficulty");
  });
});

describe("a whole session", () => {
  it("connect, select, Duel, result, Revancha, result, then back to the select", () => {
    const state = play(
      onConnect(),
      padFound,
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
      selected: "maestro",
    });
  });
});
