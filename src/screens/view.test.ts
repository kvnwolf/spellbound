import { describe, expect, it } from "vitest";

import { lessons, startLesson } from "../duel/training";
import type { Lesson } from "../duel/training";
import { text } from "../text";
import type { DuelScreen, Screen } from "./screens";
import { goalLineOf, scrollOf, viewOf } from "./view";

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

/** Entrenamiento's preview with `selected` highlighted, Ganar un Clash completed. */
const preview = (selected: Lesson) =>
  viewOf(
    { kind: "lessons", selected },
    { certified: false, completed: ["clash"] }
  )?.lessons?.preview;

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

  it("names the game over the main menu and lists Duelo, Práctica, Entrenamiento and Controles, Training ticked once complete", () => {
    const view = viewOf(
      { kind: "main", selected: "practice" },
      { certified: true, completed: [...lessons] }
    );

    expect(view?.heading).toBe(text.title);
    expect(view?.items).toStrictEqual([
      { label: "Duelo", selected: false },
      { label: "Práctica", selected: true },
      { done: true, label: "Entrenamiento", selected: false },
      { label: "Controles", selected: false },
    ]);
  });

  it("greys out Duelo and Práctica until Training is complete, and says so under Entrenamiento", () => {
    const view = viewOf(
      { kind: "main", selected: "training" },
      { certified: false, completed: ["move", "lockOn"] }
    );

    expect(view?.items).toStrictEqual([
      { disabled: true, label: "Duelo", selected: false },
      { disabled: true, label: "Práctica", selected: false },
      {
        hint: "Completa el entrenamiento para desbloquear Duelo y Práctica",
        label: "Entrenamiento",
        selected: true,
      },
      { label: "Controles", selected: false },
    ]);
  });

  it("lists the seventeen lessons on Entrenamiento in their sections, numbered, the completed ones ticked", () => {
    const view = viewOf(
      { kind: "lessons", selected: "light" },
      { certified: false, completed: ["move", "heavy"] }
    );

    expect(view).toMatchObject({ heading: "Entrenamiento" });
    expect(
      view?.lessons?.sections.map((section) => [
        section.heading,
        section.lessons.map((entry) => `${entry.number}. ${entry.label}`),
      ])
    ).toStrictEqual([
      ["Movimiento", ["1. Moverse y mirar", "2. Fijar objetivo"]],
      ["Hechizos", ["3. Stupefy", "4. Confringo con carga"]],
      ["Defensa", ["5. Escudo y Parry", "6. Esquiva"]],
      [
        "Determinación y especiales",
        [
          "7. La Determinación",
          "8. Expelliarmus",
          "9. Incendio",
          "10. Petrificus Totalus",
          "11. Depulso",
        ],
      ],
      [
        "Pociones",
        [
          "12. Wiggenweld",
          "13. Poción Máxima",
          "14. Poción Vigorizante",
          "15. Felix Felicis",
        ],
      ],
      ["Combate", ["16. Ganar un Clash", "17. Desarme y recoger la varita"]],
    ]);
    expect(
      view?.lessons?.sections.flatMap((section) => section.lessons).slice(0, 4)
    ).toStrictEqual([
      {
        done: true,
        label: "Moverse y mirar",
        lesson: "move",
        number: "1",
        selected: false,
      },
      {
        done: false,
        label: "Fijar objetivo",
        lesson: "lockOn",
        number: "2",
        selected: false,
      },
      {
        done: false,
        label: "Stupefy",
        lesson: "light",
        number: "3",
        selected: true,
      },
      {
        done: true,
        label: "Confringo con carga",
        lesson: "heavy",
        number: "4",
        selected: false,
      },
    ]);
  });

  it("says how many lessons are completed over Entrenamiento's list", () => {
    expect(
      viewOf(
        { kind: "lessons", selected: "light" },
        { certified: false, completed: ["move", "heavy"] }
      )?.lessons?.progress
    ).toBe("2 de 17 completadas");
  });

  it("previews the highlighted lesson beside the list: its title, what it teaches and its buttons", () => {
    expect(preview("light")).toStrictEqual({
      body: "Un hechizo rápido que puedes encadenar: el tercero seguido aturde.",
      controls: "□: Stupefy",
      done: false,
      eyebrow: "Lección 3 de 17",
      heading: "Stupefy",
      lesson: "light",
    });
    expect(preview("clash")).toMatchObject({
      done: true,
      eyebrow: "Lección 16 de 17",
      heading: "Ganar un Clash",
      lesson: "clash",
    });
    // A Special Spell's or a Potion's button is its slot's.
    expect(preview("expelliarmus")?.controls).toBe("Mantén R2 y pulsa ○");
    expect(preview("felix")?.controls).toBe(
      "Mantén L2 y pulsa ↓, luego R2 y ✕"
    );
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

  it("offers Continuar, Controles and Salir del entrenamiento when a lesson is paused", () => {
    const lesson: DuelScreen = {
      ...duel,
      practice: "idle",
      training: { doneSecondsLeft: null, lesson: "move" },
    };

    expect(
      viewOf({ duel: lesson, kind: "pause", selected: "continue" })?.items
    ).toStrictEqual([
      { label: "Continuar", selected: true },
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
      { control: "l2", detail: "Mantén y pulsa ↑ ← → ↓", label: "Pociones" },
      { control: "options", label: "Pausa" },
    ]);
  });

  it("lists the Potions under L2 by their D-pad arrows and the Special Spells under R2 by their face buttons", () => {
    const help = viewOf(controls("controls"))?.help;

    expect(help?.tab === "controls" && help.potionSlots).toStrictEqual({
      heading: "Mantén L2",
      slots: [
        { button: "up", kind: "strength", label: "Poción Máxima" },
        { button: "left", kind: "wiggenweld", label: "Wiggenweld" },
        { button: "right", kind: "swiftness", label: "Poción Vigorizante" },
        { button: "down", kind: "felix", label: "Felix Felicis" },
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
      "Determinación",
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

/** The lesson `lesson` on screen, as a Practice against its Training Dummy. */
const inLesson = (lesson: Lesson): DuelScreen => ({
  ...duel,
  practice: "idle",
  training: { doneSecondsLeft: null, lesson },
});

describe("the Training scrolls", () => {
  it("leave the menu frame off, so the frozen lesson shows behind them", () => {
    expect(
      viewOf({ duel: inLesson("move"), kind: "briefing" })
    ).toBeUndefined();
    expect(
      viewOf({ duel: inLesson("move"), kind: "lessonDone", selected: "next" })
    ).toBeUndefined();
    expect(
      viewOf({ duel: inLesson("disarmed"), kind: "certificate" })
    ).toBeUndefined();
    expect(scrollOf(inLesson("move"))).toBeUndefined();
  });

  it("open a lesson with its name, what it teaches, when to use it and its buttons, the slot drawn as its button", () => {
    const scroll = scrollOf({
      duel: inLesson("expelliarmus"),
      kind: "briefing",
    });

    expect(scroll).toMatchObject({
      controls: "Mantén R2 y pulsa ○",
      eyebrow: "Lección 8 de 17",
      heading: "Expelliarmus",
      items: [{ label: "Empezar", selected: true }],
      kind: "briefing",
    });
    expect(scroll?.paragraphs).toHaveLength(2);
  });

  it("draw a Potion's slot as its D-pad arrow", () => {
    expect(
      scrollOf({ duel: inLesson("wiggenweld"), kind: "briefing" })?.controls
    ).toBe("Mantén L2 y pulsa ←");
    expect(
      scrollOf({ duel: inLesson("felix"), kind: "briefing" })?.controls
    ).toBe("Mantén L2 y pulsa ↓, luego R2 y ✕");
  });

  it("give every lesson its own scroll, saying when it pays off", () => {
    for (const lesson of lessons) {
      const scroll = scrollOf({ duel: inLesson(lesson), kind: "briefing" });

      expect(scroll?.heading).toBe(text.training.lessons[lesson]);
      expect(scroll?.paragraphs.every((line) => line.length > 20)).toBeTruthy();
      expect(scroll?.paragraphs.join(" ")).not.toMatch(/\{/u);
      expect(scroll?.controls).not.toMatch(/\{/u);
    }
  });

  it("celebrate a completed lesson and offer Repetir or Siguiente lección", () => {
    expect(
      scrollOf({
        duel: inLesson("light"),
        kind: "lessonDone",
        selected: "next",
      })
    ).toMatchObject({
      eyebrow: "Lección 3 de 17",
      heading: "¡Lección completada!",
      items: [
        { label: "Repetir", selected: false },
        { label: "Siguiente lección", selected: true },
      ],
      kind: "lessonDone",
    });
  });

  it("offer Terminar instead after the last lesson", () => {
    expect(
      scrollOf({
        duel: inLesson("disarmed"),
        kind: "lessonDone",
        selected: "repeat",
      })?.items
    ).toStrictEqual([
      { label: "Repetir", selected: true },
      { label: "Terminar", selected: false },
    ]);
  });

  it("welcome the player to the Club de Duelo once Training is complete", () => {
    expect(
      scrollOf({ duel: inLesson("disarmed"), kind: "certificate" })
    ).toMatchObject({
      heading: "Club de Duelo",
      items: [{ label: "Continuar", selected: true }],
      kind: "certificate",
    });
  });
});

describe("a lesson's goal line", () => {
  it("names the goal with its button and counts it", () => {
    expect(goalLineOf(startLesson("light"))).toBe(
      "Acierta Stupefy con □ (0/3)"
    );
    expect(goalLineOf({ ...startLesson("move"), count: 2.6 })).toBe(
      "Camina con el stick izquierdo (2/5 m)"
    );
  });

  it("draws a Special Spell's or a Potion's slot as its button", () => {
    expect(goalLineOf(startLesson("petrificus"))).toBe(
      "Petrifica al maniquí: mantén R2 y pulsa □ (0/1)"
    );
    expect(goalLineOf(startLesson("swiftness"))).toBe(
      "Bebe la Poción Vigorizante: mantén L2 y pulsa → (0/1)"
    );
    expect(goalLineOf({ ...startLesson("felix"), goal: 1 })).toBe(
      "Gasta esa Determinación en Depulso: mantén R2 y pulsa ✕ cerca del maniquí (0/1)"
    );
  });

  it("calls the lesson completed once it is", () => {
    expect(goalLineOf({ ...startLesson("light"), done: true, goal: 1 })).toBe(
      "¡Lección completada!"
    );
  });
});
