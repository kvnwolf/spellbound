import { describe, expect, it } from "vitest";

import { text } from "../text";
import type { Screen } from "./screens";
import { viewOf } from "./view";

const result = (won: boolean): Screen => ({
  difficulty: "maestro",
  kind: "result",
  selected: "changeDifficulty",
  won,
});

describe("what each screen shows", () => {
  it("shows nothing over the Duel itself", () => {
    expect(
      viewOf({ difficulty: "novato", kind: "duel", over: null, run: 1 })
    ).toBeUndefined();
  });

  it("asks to connect a DualSense, or says one is required, under the game's name", () => {
    expect(viewOf({ kind: "connect", pad: "none" })).toMatchObject({
      body: text.connectDualSense,
      heading: text.title,
    });

    expect(viewOf({ kind: "connect", pad: "unsupported" })?.body).toBe(
      text.requiresDualSense
    );
  });

  it("names the game over the Difficulty select", () => {
    expect(viewOf({ kind: "difficulty", selected: "novato" })).toMatchObject({
      body: text.difficulty.heading,
      heading: text.title,
    });
  });

  it("lists the three Difficulties with the highlighted one marked", () => {
    expect(
      viewOf({ kind: "difficulty", selected: "duelista" })?.items
    ).toStrictEqual([
      { label: "Novato", selected: false },
      { label: "Duelista", selected: true },
      { label: "Maestro", selected: false },
    ]);
  });

  it("names the outcome on the result screen and offers Revancha and Cambiar dificultad", () => {
    expect(viewOf(result(true))?.heading).toBe("¡Victoria!");
    expect(viewOf(result(false))?.heading).toBe("Derrota");
    expect(viewOf(result(false))?.items).toStrictEqual([
      { label: "Revancha", selected: false },
      { label: "Cambiar dificultad", selected: true },
    ]);
  });

  it("offers Continuar, Reiniciar and Salir when paused", () => {
    const duel = {
      difficulty: "novato",
      kind: "duel",
      over: null,
      run: 1,
    } as const;

    expect(
      viewOf({ duel, kind: "pause", selected: "continue" })?.items?.map(
        (item) => item.label
      )
    ).toStrictEqual(["Continuar", "Reiniciar", "Salir"]);
  });

  it("asks to reconnect, then for a button press", () => {
    const duel = {
      difficulty: "novato",
      kind: "duel",
      over: null,
      run: 1,
    } as const;

    const lost = viewOf({
      kind: "disconnected",
      reconnected: false,
      resume: duel,
    });

    const back = viewOf({
      kind: "disconnected",
      reconnected: true,
      resume: duel,
    });

    expect(lost?.heading).toBe("Reconecta tu mando");
    expect(lost?.body).toBe(text.disconnected.waiting);
    expect(back?.body).toBe(text.disconnected.reconnected);
  });
});
