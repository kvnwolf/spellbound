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

  it("offers one start button under the game's name on the title", () => {
    expect(viewOf({ kind: "title", pad: "none" })).toStrictEqual({
      action: text.start,
      heading: text.title,
      screen: "title",
    });
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

  it("names the game over the main menu and lists Duelo, Práctica, Entrenamiento and Controles", () => {
    const view = viewOf(
      { kind: "main", selected: "practice" },
      { completed: [], finished: true }
    );

    expect(view?.heading).toBe(text.title);
    expect(view?.items).toStrictEqual([
      { label: "Duelo", selected: false },
      { label: "Práctica", selected: true },
      { done: true, label: "Entrenamiento", selected: false },
      { label: "Controles", selected: false },
    ]);
  });

  it("points a first-timer at Entrenamiento until Training has been played through", () => {
    const training = viewOf(
      { kind: "main", selected: "duel" },
      { completed: ["move", "lockOn"], finished: false }
    )?.items?.[2];

    expect(training).toStrictEqual({
      hint: "¿Primera vez? Empieza aquí",
      label: "Entrenamiento",
      selected: false,
    });
  });

  it("lists the ten lessons on Entrenamiento, the completed ones ticked", () => {
    const view = viewOf(
      { kind: "lessons", selected: "light" },
      { completed: ["move", "heavy"], finished: false }
    );

    expect(view).toMatchObject({
      body: text.training.pick,
      heading: "Entrenamiento",
    });
    expect(view?.items?.slice(0, 4)).toStrictEqual([
      { done: true, label: "1. Moverse y mirar", selected: false },
      { label: "2. Fijar objetivo", selected: false },
      { label: "3. Hechizo ligero", selected: true },
      { done: true, label: "4. Hechizo pesado", selected: false },
    ]);
    expect(view?.items).toHaveLength(10);
  });

  it("heads the Difficulty select of a Duel with Duelo, and that of a Practice with Práctica", () => {
    expect(
      viewOf({ kind: "difficulty", practice: false, selected: "novato" })
    ).toMatchObject({
      body: text.difficulty.heading,
      heading: "Duelo",
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

  it("offers Continuar, Reiniciar, Controles and Salir when a Duel is paused", () => {
    expect(labels({ duel, kind: "pause", selected: "continue" })).toStrictEqual(
      ["Continuar", "Reiniciar", "Controles", "Salir"]
    );
  });

  it("offers Continuar, Cambiar rival, Controles and Salir al menú when a Practice is paused", () => {
    expect(
      labels({ duel: practice, kind: "pause", selected: "continue" })
    ).toStrictEqual([
      "Continuar",
      "Cambiar rival",
      "Controles",
      "Salir al menú",
    ]);
  });

  it("offers Continuar, Saltar lección, Controles and Salir del entrenamiento when a lesson is paused", () => {
    const lesson: DuelScreen = {
      ...duel,
      practice: "idle",
      training: { doneSecondsLeft: null, lesson: "move" },
    };

    expect(
      viewOf({ duel: lesson, kind: "pause", selected: "continue" })?.items
    ).toStrictEqual([
      { label: "Continuar", selected: true },
      { label: "Saltar lección", selected: false },
      { label: "Controles", selected: false },
      { label: "Salir del entrenamiento", selected: false },
    ]);
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

describe("what the Controls show", () => {
  const fromMain = { kind: "main", selected: "controls" } as const;

  const controls = (tab: "controls" | "mechanics"): Screen => ({
    from: fromMain,
    kind: "controls",
    tab,
  });

  it("heads the Controls with Controles and offers the Controles and Mecánicas tabs, the open one marked", () => {
    expect(viewOf(controls("mechanics"))).toMatchObject({
      heading: "Controles",
      screen: "controls",
      tabs: [
        { label: "Controles", selected: false },
        { label: "Mecánicas", selected: true },
      ],
    });
  });

  it("labels every control of the drawn DualSense in Spanish, from the human Controller's bindings", () => {
    const help = viewOf(controls("controls"))?.help;

    expect(help?.tab === "controls" && help.controls).toStrictEqual([
      { control: "leftStick", label: "Moverse" },
      {
        control: "rightStick",
        detail: "Muévelo rápido a un lado: cambiar de objetivo",
        label: "Cámara",
      },
      { control: "r3", label: "Fijar objetivo" },
      { control: "square", label: "Hechizo ligero" },
      {
        control: "triangle",
        detail: "Mantén para cargar\u00A0· Pulsa en un Clash",
        label: "Hechizo pesado",
      },
      { control: "circle", label: "Esquivar" },
      { control: "cross", label: "Saltar" },
      {
        control: "l1",
        detail: "Justo antes del impacto: Parry",
        label: "Escudo",
      },
      { control: "r1", label: "Correr" },
      {
        control: "r2",
        detail: "Mantén y pulsa △ □ ○ ✕",
        label: "Hechizos especiales",
      },
      { control: "l2", detail: "Mantén y pulsa △ □ ○ ✕", label: "Pociones" },
      { control: "options", label: "Pausa" },
    ]);
  });

  it("lists the Potions under L2 and the Special Spells under R2 by their face buttons, an empty slot without a name", () => {
    const help = viewOf(controls("controls"))?.help;

    expect(help?.tab === "controls" && help.potionSlots).toStrictEqual({
      heading: "Mantén L2",
      slots: [
        { button: "triangle", kind: "strength", label: "Fuerza" },
        { button: "square", kind: "wiggenweld", label: "Wiggenweld" },
        { button: "circle", kind: "swiftness", label: "Celeridad" },
        { button: "cross", kind: null, label: null },
      ],
    });
    expect(help?.tab === "controls" && help.spellSlots).toStrictEqual({
      heading: "Mantén R2",
      slots: [
        { button: "triangle", kind: "incendio", label: "Incendio" },
        { button: "square", kind: "petrificus", label: "Petrificus Totalus" },
        { button: "circle", kind: "expelliarmus", label: "Expelliarmus" },
        { button: "cross", kind: "depulso", label: "Depulso" },
      ],
    });
  });

  it("shows a short card for each less obvious mechanic on Mecánicas", () => {
    const help = viewOf(controls("mechanics"))?.help;
    const cards = help?.tab === "mechanics" ? help.cards : [];

    expect(cards.map((card) => card.title)).toStrictEqual([
      "Fijar objetivo",
      "Carga y Lanzamiento perfecto",
      "Sobrecarga y Fallo",
      "Escudo y Parry",
      "Esquiva perfecta",
      "Clash",
      "Concentración",
      "Quemadura",
      "Petrificado",
      "Desarme y varita",
      "Pociones",
    ]);

    for (const card of cards) {
      expect(card.body.length).toBeGreaterThan(0);
    }
  });

  it("shows the same Controls over a pause as over the main menu", () => {
    const overPause = viewOf({
      from: { duel, kind: "pause", selected: "controls" },
      kind: "controls",
      tab: "controls",
    });

    expect(overPause).toStrictEqual(viewOf(controls("controls")));
  });
});
