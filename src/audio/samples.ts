/**
 * Which approved sample (`public/audio/<id>.mp3`, listed in
 * `public/audio/catalog.json`) each sound plays, how, and through which bus;
 * and which music the screens call for. Pure: no WebAudio, no DOM.
 *
 * A new sound is one line in `sampleOfSound` (plus its kind in `cues.ts`).
 */
import type { DuelScreen, PauseScreen, Screen } from "../screens/screens";
import type { Tuning } from "../tuning";
import type { LoopSound, MenuSound, RoundOutcome, Sound } from "./cues";

/** A catalog id: the file is `/audio/<id>.mp3`. */
export type SampleId = string;

/** Where a sample is mixed: the courtyard's `sfx` (with reverb), the dry `ui`, or the `music`. */
export type Bus = "music" | "sfx" | "ui";

/** One play of a sample. */
export interface SamplePlay {
  readonly sample: SampleId;
  readonly bus: Bus;
  /** On top of the sample's own volume. */
  readonly gain: number;
  /** Playback rate: above 1 is higher and shorter. */
  readonly rate: number;
  /** The music dips under it. */
  readonly ducks: boolean;
}

type AudioSettings = Pick<Tuning["audio"], "emphasis">;

/** Each kind of Sound, by its kind. */
type SoundOf = {
  readonly [Kind in Sound["kind"]]: Extract<Sound, { kind: Kind }>;
};

/** The samples a kind of Sound can play, and how it picks and shapes one from what happened. */
interface SampleChoice<Kind extends keyof SoundOf> {
  readonly samples: readonly SampleId[];
  readonly pick: (
    sound: SoundOf[Kind],
    settings: AudioSettings
  ) => Pick<SamplePlay, "sample"> & Partial<SamplePlay>;
}

/** What every kind of Sound plays: a new kind fails to compile until it has an entry. */
type SampleTable = {
  readonly [Kind in keyof SoundOf]: SampleChoice<Kind>;
};

/** Always the same sample, as it is. */
const just = (sample: SampleId) => ({
  pick: () => ({ sample }),
  samples: [sample],
});

/** One sample or another, by what happened. */
const either = <Kind extends keyof SoundOf>(
  samples: { readonly yes: SampleId; readonly no: SampleId },
  test: (sound: SoundOf[Kind]) => boolean
): SampleChoice<Kind> => ({
  pick: (sound) => ({ sample: test(sound) ? samples.yes : samples.no }),
  samples: [samples.yes, samples.no],
});

const roundEnd: Readonly<Record<RoundOutcome, SampleId>> = {
  draw: "round-lost",
  lost: "round-lost",
  won: "round-won",
};

/** Every third Stupefy, and a heavy Spell on a Shield: louder and lower. */
const heavy = (is: boolean, { emphasis }: AudioSettings) =>
  is ? { gain: emphasis.heavy.gain, rate: emphasis.heavy.rate } : {};

/** Confringo, as big as its Charge, and bigger again empowered. */
const charged = (
  sample: SampleId
): SampleChoice<"confringo-blast" | "confringo-cast"> => ({
  pick: ({ charge, empowered }, { emphasis }) => ({
    gain:
      (emphasis.unchargedGain + (1 - emphasis.unchargedGain) * charge) *
      (empowered ? emphasis.empoweredGain : 1),
    sample,
  }),
  samples: [sample],
});

const sampleOfSound: SampleTable = {
  backfire: just("backfire"),
  "charge-ready": just("confringo-ready"),
  "confringo-blast": charged("confringo-blast"),
  "confringo-cast": charged("confringo-cast"),
  countdown: just("countdown-beat"),
  "depulso-cast": just("depulso-blast"),
  disarm: just("disarm"),
  dodge: just("dodge-roll"),
  "duel-end": either({ no: "defeat", yes: "victory" }, ({ won }) => won),
  "duel-start": just("duel-start"),
  "expelliarmus-cast": just("expelliarmus-cast"),
  fizzle: just("spell-fizzle"),
  "incendio-cast": just("incendio-cast"),
  "incendio-explosion": just("incendio-explosion"),
  jump: just("jump"),
  knockout: just("knockout"),
  land: just("land"),
  "lock-off": just("lock-off"),
  "lock-on": just("lock-on"),
  "overcharge-warning": just("overcharge-warning"),
  parry: just("parry"),
  "perfect-dodge": just("perfect-dodge"),
  "perfect-release": just("confringo-perfect"),
  "petrificus-cast": just("petrificus-cast"),
  petrify: just("petrify"),
  "petrify-break": just("petrify-break"),
  "round-end": {
    pick: ({ outcome }) => ({ sample: roundEnd[outcome] }),
    samples: Object.values(roundEnd),
  },
  "shield-block": {
    pick: ({ heavy: big }, settings) => ({
      sample: "shield-block",
      ...heavy(big, settings),
    }),
    samples: ["shield-block"],
  },
  "shield-raise": just("shield-raise"),
  "spells-cancelled": just("spells-cancel"),
  "stamina-short": just("stamina-short"),
  "stupefy-cast": {
    pick: ({ strong }, settings) => ({
      sample: "stupefy-cast",
      ...heavy(strong, settings),
    }),
    samples: ["stupefy-cast"],
  },
  "stupefy-hit": either(
    { no: "stupefy-hit", yes: "stupefy-hit-strong" },
    ({ strong }) => strong
  ),
  "wand-land": just("wand-land"),
  "wand-pickup": just("wand-pickup"),
  "wand-return": just("wand-return"),
};

/** Sounds that are the HUD's rather than the courtyard's: dry, on the `ui` bus. */
const uiSounds: ReadonlySet<Sound["kind"]> = new Set([
  "countdown",
  "duel-start",
  "lock-off",
  "lock-on",
  "round-end",
  "stamina-short",
]);

/** The Duel's fanfares, played as music. */
const musicSounds: ReadonlySet<Sound["kind"]> = new Set(["duel-end"]);

/** The music dips under these. */
const duckingSounds: ReadonlySet<Sound["kind"]> = new Set([
  "duel-start",
  "knockout",
  "round-end",
]);

const busOf = (kind: Sound["kind"]): Bus => {
  if (musicSounds.has(kind)) {
    return "music";
  }

  return uiSounds.has(kind) ? "ui" : "sfx";
};

const pick = <Kind extends keyof SoundOf>(
  kind: Kind,
  sound: SoundOf[Kind],
  settings: AudioSettings
) => sampleOfSound[kind].pick(sound, settings);

/** The sample a sound of the Duel plays, and how: its catalog id, bus, extra gain and rate, and whether the music ducks under it. */
export const sampleFor = (
  sound: Sound,
  settings: AudioSettings
): SamplePlay => ({
  bus: busOf(sound.kind),
  ducks: duckingSounds.has(sound.kind),
  gain: 1,
  rate: 1,
  ...pick(sound.kind, sound, settings),
});

/** A menu's sound: its own sample, dry. */
export const menuSampleFor = (sound: MenuSound): SamplePlay => ({
  bus: "ui",
  ducks: false,
  gain: 1,
  rate: 1,
  sample: sound.kind,
});

const menuSamples: readonly MenuSound["kind"][] = [
  "menu-back",
  "menu-confirm",
  "menu-move",
];

/** The sample each held sound loops. */
export const loopSampleOf: Readonly<Record<LoopSound["kind"], SampleId>> = {
  burn: "burn-loop",
  charge: "confringo-charge",
  shield: "shield-hum",
};

/** The ambience under the Duel. */
export const ambienceSample: SampleId = "courtyard-night";

export type Theme = "duel-theme" | "menu-theme";

const themes: readonly Theme[] = ["duel-theme", "menu-theme"];

/** What the music should be doing. */
export interface MusicState {
  /** The theme looping; null for none. */
  readonly theme: Theme | null;
  /** The courtyard at night under it. */
  readonly ambience: boolean;
  /** Behind the pause menu: quieter and muffled. */
  readonly dimmed: boolean;
}

/** The Duel a Duel-showing screen shows. */
const duelOf = (screen: DuelScreen | PauseScreen): DuelScreen =>
  screen.kind === "pause" ? screen.duel : screen;

/** The music the screens call for. */
export const musicFor = (screen: Screen): MusicState => {
  if (screen.kind === "unsupported") {
    return { ambience: false, dimmed: false, theme: null };
  }

  if (
    screen.kind === "connect" ||
    screen.kind === "difficulty" ||
    screen.kind === "result"
  ) {
    return { ambience: false, dimmed: false, theme: "menu-theme" };
  }

  const duel = duelOf(screen.kind === "disconnected" ? screen.resume : screen);

  return {
    ambience: true,
    dimmed: screen.kind !== "duel",
    // Once the Duel is decided its fanfare plays instead.
    theme: duel.over === null ? "duel-theme" : null,
  };
};

/** Every sample the engine can play, to preload. */
export const samplesUsed: readonly SampleId[] = [
  ...new Set([
    ...Object.values(sampleOfSound).flatMap((choice) => choice.samples),
    ...menuSamples,
    ...Object.values(loopSampleOf),
    ambienceSample,
    ...themes,
  ]),
];
