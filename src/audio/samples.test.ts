import { describe, expect, it } from "vitest";

import catalog from "../../public/audio/catalog.json";
import type { DuelScreen, Screen } from "../screens/screens";
import { tuning } from "../tuning";
import type { LoopSound, MenuSound, Sound } from "./cues";
import {
  ambienceSample,
  loopSampleOf,
  menuSampleFor,
  musicFor,
  sampleFor,
  samplesUsed,
} from "./samples";

const settings = tuning.audio;
const volumes = new Map(Object.entries(settings.volumes));

/** The sample files on disk, by id. */
const files = new Set(
  Object.keys(import.meta.glob("../../public/audio/*.mp3")).map((path) =>
    path.replace(/^.*\/(?<id>.+)\.mp3$/u, "$<id>")
  )
);

const catalogIds = new Set(catalog.map((entry) => entry.id));

type SoundOf = {
  readonly [Kind in Sound["kind"]]: Extract<Sound, { kind: Kind }>;
};

/** Every sound the cues can emit, with each variant of its fields: a new kind fails to compile until it is listed. */
type EverySound = {
  readonly [Kind in keyof SoundOf]: SoundOf[Kind][];
};

const blastAt = (charge: number) =>
  sampleFor({ charge, empowered: false, kind: "confringo-blast" }, settings)
    .gain;

const everySound: EverySound = {
  backfire: [{ kind: "backfire" }],
  "charge-ready": [{ kind: "charge-ready" }],
  "clash-explode": [{ kind: "clash-explode" }],
  "clash-pump": [{ kind: "clash-pump" }],
  "clash-start": [{ kind: "clash-start" }],
  "clash-win": [{ kind: "clash-win" }],
  "confringo-blast": [
    { charge: 0, empowered: false, kind: "confringo-blast" },
    { charge: 1, empowered: true, kind: "confringo-blast" },
  ],
  "confringo-cast": [
    { charge: 0, empowered: false, kind: "confringo-cast" },
    { charge: 1, empowered: true, kind: "confringo-cast" },
  ],
  countdown: [1, 2, 3].map((beat) => ({ beat, kind: "countdown" as const })),
  "depulso-cast": [{ kind: "depulso-cast" }],
  disarm: [{ kind: "disarm" }],
  dodge: [{ kind: "dodge" }],
  "duel-end": [
    { kind: "duel-end", won: true },
    { kind: "duel-end", won: false },
  ],
  "duel-start": [{ kind: "duel-start" }],
  "expelliarmus-cast": [{ kind: "expelliarmus-cast" }],
  fizzle: [{ kind: "fizzle" }],
  "incendio-cast": [{ kind: "incendio-cast" }],
  "incendio-explosion": [{ kind: "incendio-explosion" }],
  jump: [{ kind: "jump" }],
  knockout: [{ kind: "knockout" }],
  land: [{ kind: "land" }],
  "lock-off": [{ kind: "lock-off" }],
  "lock-on": [{ kind: "lock-on" }],
  "overcharge-warning": [{ kind: "overcharge-warning" }],
  parry: [{ kind: "parry" }],
  "perfect-dodge": [{ kind: "perfect-dodge" }],
  "perfect-release": [{ kind: "perfect-release" }],
  "petrificus-cast": [{ kind: "petrificus-cast" }],
  petrify: [{ kind: "petrify" }],
  "petrify-break": [{ kind: "petrify-break" }],
  "potion-drink": [{ kind: "potion-drink" }],
  "potion-effect": (["strength", "swiftness", "wiggenweld"] as const).map(
    (potion) => ({ kind: "potion-effect" as const, potion })
  ),
  "potion-interrupted": [{ kind: "potion-interrupted" }],
  "round-end": (["draw", "lost", "won"] as const).map((outcome) => ({
    kind: "round-end" as const,
    outcome,
  })),
  "shield-block": [
    { heavy: false, kind: "shield-block" },
    { heavy: true, kind: "shield-block" },
  ],
  "shield-raise": [{ kind: "shield-raise" }],
  "spells-cancelled": [{ kind: "spells-cancelled" }],
  "stamina-short": [{ kind: "stamina-short" }],
  "stupefy-cast": [
    { kind: "stupefy-cast", strong: false },
    { kind: "stupefy-cast", strong: true },
  ],
  "stupefy-hit": [
    { kind: "stupefy-hit", strong: false },
    { kind: "stupefy-hit", strong: true },
  ],
  "wand-land": [{ kind: "wand-land" }],
  "wand-pickup": [{ kind: "wand-pickup" }],
  "wand-return": [{ kind: "wand-return" }],
};

const menuSounds: MenuSound[] = [
  { kind: "menu-back" },
  { kind: "menu-confirm" },
  { kind: "menu-move" },
  { kind: "lesson-complete" },
  { kind: "training-complete" },
];

const loopKinds: LoopSound["kind"][] = [
  "burn",
  "charge",
  "clash-beam",
  "shield",
];

describe("the music the screens call for", () => {
  const duel: DuelScreen = {
    difficulty: "duelista",
    kind: "duel",
    over: null,
    practice: null,
    run: 1,
  };

  const decided: DuelScreen = {
    ...duel,
    over: { secondsLeft: 2, won: true },
  };

  const paused: Screen = { duel, kind: "pause", selected: "continue" };

  it("loops the menu theme on the title, the connect prompt, the menus and the result screen, without the courtyard", () => {
    const menus: Screen[] = [
      { kind: "title", pad: "none" },
      { kind: "connect", pad: "none" },
      { kind: "main", selected: "duel" },
      { kind: "difficulty", practice: false, selected: "novato" },
      { kind: "rivals", selected: "idle" },
      { kind: "lessons", selected: "move" },
      { kind: "options", selected: "music" },
      {
        difficulty: "maestro",
        kind: "result",
        selected: "rematch",
        won: false,
      },
    ];

    for (const screen of menus) {
      expect(musicFor(screen)).toStrictEqual({
        ambience: false,
        dimmed: false,
        theme: "menu-theme",
      });
    }
  });

  it("loops the duel theme over the courtyard at night during a Duel", () => {
    expect(musicFor(duel)).toStrictEqual({
      ambience: true,
      dimmed: false,
      theme: "duel-theme",
    });
  });

  it("dims the duel theme and the courtyard behind the pause menu and the reconnect prompt", () => {
    expect(musicFor(paused)).toStrictEqual({
      ambience: true,
      dimmed: true,
      theme: "duel-theme",
    });
    expect(
      musicFor({ kind: "disconnected", reconnected: false, resume: duel })
    ).toMatchObject({ dimmed: true, theme: "duel-theme" });
  });

  it("keeps what plays where the Controls opened: the menu theme, or the dimmed Duel behind its pause", () => {
    expect(
      musicFor({
        from: { kind: "main", selected: "controls" },
        kind: "controls",
        tab: "mechanics",
      })
    ).toStrictEqual(musicFor({ kind: "main", selected: "duel" }));
    expect(
      musicFor({
        from: { duel, kind: "pause", selected: "controls" },
        kind: "controls",
        tab: "controls",
      })
    ).toStrictEqual(musicFor(paused));
  });

  it("lets the duel theme go once the Duel is decided, for its fanfare", () => {
    expect(musicFor(decided)).toStrictEqual({
      ambience: true,
      dimmed: false,
      theme: null,
    });
    expect(
      musicFor({ duel: decided, kind: "pause", selected: "continue" }).theme
    ).toBeNull();
  });

  it("is silent when the browser cannot run the game", () => {
    expect(musicFor({ kind: "unsupported", reason: "browser" })).toStrictEqual({
      ambience: false,
      dimmed: false,
      theme: null,
    });
  });
});

describe("the catalog covers every sound", () => {
  const emitted = [
    ...Object.values(everySound)
      .flat()
      .map((sound) => sampleFor(sound, settings).sample),
    ...menuSounds.map((sound) => menuSampleFor(sound).sample),
    ...loopKinds.map((kind) => loopSampleOf[kind]),
    ambienceSample,
    "menu-theme",
    "duel-theme",
  ];

  it.each([...new Set(emitted)])(
    "%s has a catalog entry, a file, a volume and is preloaded",
    (id) => {
      expect(catalogIds).toContain(id);
      expect(files).toContain(id);
      expect(volumes.get(id)).toBeGreaterThan(0);
      expect(samplesUsed).toContain(id);
    }
  );

  it("preloads only samples it can play", () => {
    expect(new Set(samplesUsed)).toStrictEqual(new Set(emitted));
  });
});

/** The sample a Potion's effect plays. */
const effect = (potion: "strength" | "swiftness" | "wiggenweld") =>
  sampleFor({ kind: "potion-effect", potion }, settings).sample;

describe("the sample a sound plays", () => {
  it("plays the strong impact for every third Stupefy and the plain one otherwise", () => {
    expect(
      sampleFor({ kind: "stupefy-hit", strong: true }, settings).sample
    ).toBe("stupefy-hit-strong");
    expect(
      sampleFor({ kind: "stupefy-hit", strong: false }, settings).sample
    ).toBe("stupefy-hit");
  });

  it("plays the victory or defeat fanfare as music when the Duel ends", () => {
    expect(sampleFor({ kind: "duel-end", won: true }, settings)).toMatchObject({
      bus: "music",
      sample: "victory",
    });
    expect(sampleFor({ kind: "duel-end", won: false }, settings)).toMatchObject(
      { bus: "music", sample: "defeat" }
    );
  });

  it("ducks the music under the Knockout and the Round stingers, not under a cast", () => {
    expect(sampleFor({ kind: "knockout" }, settings).ducks).toBeTruthy();
    expect(
      sampleFor({ kind: "round-end", outcome: "won" }, settings)
    ).toMatchObject({ bus: "ui", ducks: true, sample: "round-won" });
    expect(sampleFor({ kind: "duel-start" }, settings).ducks).toBeTruthy();
    expect(
      sampleFor({ kind: "stupefy-cast", strong: false }, settings).ducks
    ).toBeFalsy();
  });

  it("plays each Potion's own effect as it is down", () => {
    expect([
      effect("wiggenweld"),
      effect("strength"),
      effect("swiftness"),
    ]).toStrictEqual(["potion-heal", "potion-strength", "potion-swiftness"]);
  });

  it("plays a fuller Confringo louder", () => {
    expect(blastAt(0)).toBeLessThan(blastAt(1));
    expect(blastAt(1)).toBe(1);
  });

  it("plays menu sounds dry, on the ui bus", () => {
    expect(menuSampleFor({ kind: "menu-move" })).toMatchObject({
      bus: "ui",
      sample: "menu-move",
    });
  });

  it("plays a completed lesson's Round-won stinger, and Training's victory fanfare, dry", () => {
    expect(menuSampleFor({ kind: "lesson-complete" })).toMatchObject({
      bus: "ui",
      sample: "round-won",
    });
    expect(menuSampleFor({ kind: "training-complete" })).toMatchObject({
      bus: "ui",
      sample: "victory",
    });
  });

  it("plays a Duel's sounds in the courtyard, through the sfx bus", () => {
    expect(sampleFor({ kind: "spells-cancelled" }, settings)).toMatchObject({
      bus: "sfx",
      sample: "spells-cancel",
    });
  });
});
