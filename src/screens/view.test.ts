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

  it("asks for a DualSense on the title until one is connected", () => {
    expect(viewOf({ kind: "title", pad: "none" })?.body).toBe(
      text.connectDualSense
    );

    expect(viewOf({ kind: "title", pad: "unsupported" })?.body).toBe(
      text.requiresDualSense
    );

    expect(viewOf({ kind: "title", pad: "dualsense" })?.body).toBe(
      text.pressToStart
    );
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
