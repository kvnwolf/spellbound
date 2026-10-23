import { describe, expect, it } from "vitest";

import { text } from "../text";
import type { DuelScreen, Screen } from "./screens";
import { viewOf } from "./view";

const result = (won: boolean): Screen => ({
  difficulty: "maestro",
  kind: "result",
  selected: "changeDifficulty",
  won,
});

const duel: DuelScreen = {
  difficulty: "novato",
  kind: "duel",
  over: null,
  practice: null,
  run: 1,
};

const practice: DuelScreen = { ...duel, practice: "casts" };

const labels = (screen: Screen) =>
  viewOf(screen)?.items?.map((item) => item.label);

describe("what each screen shows", () => {
  it("shows nothing over the Duel itself, nor over a Practice", () => {
    expect(viewOf(duel)).toBeUndefined();
    expect(viewOf(practice)).toBeUndefined();
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

  it("names the game over the main menu and lists Duelo, Práctica, Entrenamiento and Controles, the last two greyed out", () => {
    const view = viewOf({ kind: "main", selected: "practice" });

    expect(view?.heading).toBe(text.title);
    expect(view?.items).toStrictEqual([
      { label: "Duelo", selected: false },
      { label: "Práctica", selected: true },
      { disabled: true, label: "Entrenamiento", selected: false },
      { disabled: true, label: "Controles", selected: false },
    ]);
  });

  it("names the game over the Difficulty select of a Duel, and Práctica over that of a Practice", () => {
    expect(
      viewOf({ kind: "difficulty", practice: false, selected: "novato" })
    ).toMatchObject({
      body: text.difficulty.heading,
      heading: text.title,
    });

    expect(
      viewOf({ kind: "difficulty", practice: true, selected: "novato" })
    ).toMatchObject({
      body: text.difficulty.heading,
      heading: "Práctica",
    });
  });

  it("lists the three Difficulties with the highlighted one marked", () => {
    expect(
      viewOf({ kind: "difficulty", practice: false, selected: "duelista" })
        ?.items
    ).toStrictEqual([
      { label: "Novato", selected: false },
      { label: "Duelista", selected: true },
      { label: "Maestro", selected: false },
    ]);
  });

  it("lists the four Training Dummies and Rival real in the rival picker", () => {
    const view = viewOf({ kind: "rivals", selected: "clash" });

    expect(view).toMatchObject({
      body: text.practice.rivals,
      heading: "Práctica",
    });
    expect(view?.items).toStrictEqual([
      { label: "Maniquí quieto", selected: false },
      { label: "Maniquí que lanza hechizos", selected: false },
      { label: "Maniquí de Clash", selected: true },
      { label: "Maniquí desarmador", selected: false },
      { label: "Rival real", selected: false },
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

  it("offers Continuar, Reiniciar and Salir when a Duel is paused", () => {
    expect(labels({ duel, kind: "pause", selected: "continue" })).toStrictEqual(
      ["Continuar", "Reiniciar", "Salir"]
    );
  });

  it("offers Continuar, Cambiar rival and Salir al menú when a Practice is paused", () => {
    expect(
      labels({ duel: practice, kind: "pause", selected: "continue" })
    ).toStrictEqual(["Continuar", "Cambiar rival", "Salir al menú"]);
  });

  it("asks to reconnect, then for a button press", () => {
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
