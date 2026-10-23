/**
 * The sounds themselves, synthesised in WebAudio from oscillators, filtered
 * noise and envelopes: one recipe per sound, plus the held sounds (a
 * Charging Wand, a raised Shield, a Burn) that follow their state frame by
 * frame. No audio files. The numbers here are each sound's design (its
 * pitches and strike); how loud each plays is `tuning.audio.volumes`.
 */
import type { LoopSound, MenuSound, Sound } from "./cues";

/** The AudioContext and the shared source material every recipe draws on. */
export interface Synth {
  readonly ctx: AudioContext;
  /** Two seconds of white noise. */
  readonly noise: AudioBuffer;
  /** Two seconds of sparse random clicks and pops: fire, sparks and grinding stone. */
  readonly crackle: AudioBuffer;
}

const bufferSeconds = 2;

const createNoise = (ctx: AudioContext): AudioBuffer => {
  const buffer = ctx.createBuffer(
    1,
    ctx.sampleRate * bufferSeconds,
    ctx.sampleRate
  );

  const data = buffer.getChannelData(0);

  for (let index = 0; index < data.length; index += 1) {
    data[index] = Math.random() * 2 - 1;
  }

  return buffer;
};

/** Clicks per second in the crackle, and how many samples each one rings for. */
const crackleRate = 90;
const clickSamples = 48;

const createCrackle = (ctx: AudioContext): AudioBuffer => {
  const buffer = ctx.createBuffer(
    1,
    ctx.sampleRate * bufferSeconds,
    ctx.sampleRate
  );

  const data = buffer.getChannelData(0);
  const chance = crackleRate / ctx.sampleRate;

  for (let index = 0; index < data.length; index += 1) {
    if (Math.random() < chance) {
      // Mostly small ticks, now and then a pop.
      const size = Math.random() ** 3 * (Math.random() < 0.5 ? -1 : 1);
      const length = Math.min(clickSamples, data.length - index);

      for (let step = 0; step < length; step += 1) {
        const ring = Math.exp(-step / 6) * (Math.random() * 2 - 1);
        data[index + step] = (data[index + step] ?? 0) + size * ring;
      }
    }
  }

  return buffer;
};

export const createSynth = (ctx: AudioContext): Synth => ({
  crackle: createCrackle(ctx),
  ctx,
  noise: createNoise(ctx),
});

/** Where and when one sound plays. */
interface Shot {
  readonly synth: Synth;
  readonly out: AudioNode;
  readonly t: number;
}

/** Silence an exponential ramp can reach. */
const floor = 0.0001;

/** A quick linear rise to `peak`, then an exponential fall to silence. */
const envelope = (
  param: AudioParam,
  start: number,
  peak: number,
  attack: number,
  decay: number
) => {
  param.setValueAtTime(0, start);
  param.linearRampToValueAtTime(peak, start + attack);
  param.exponentialRampToValueAtTime(floor, start + attack + decay);
};

/** A frequency held at `from`, or swept to `to` over `glide` seconds. */
const sweep = (
  param: AudioParam,
  start: number,
  from: number,
  to: number | undefined,
  glide: number
) => {
  param.setValueAtTime(from, start);

  if (to !== undefined) {
    param.exponentialRampToValueAtTime(to, start + glide);
  }
};

interface Strike {
  /** Seconds after the shot's start. */
  readonly delay?: number;
  readonly attack?: number;
  readonly decay: number;
  readonly gain: number;
  /** Hz: where the pitch (or the filter) starts... */
  readonly from: number;
  /** ...and where it sweeps to, if anywhere... */
  readonly to?: number;
  /** ...over this long (the whole sound by default). */
  readonly glide?: number;
}

interface ToneStrike extends Strike {
  readonly type?: OscillatorType;
  /** Hz: a low-pass to soften bright waveforms. */
  readonly lowpass?: number;
}

interface NoiseStrike extends Strike {
  readonly filter: BiquadFilterType;
  readonly q?: number;
  /** The crackle instead of plain noise. */
  readonly crackle?: boolean;
}

const defaultAttack = 0.004;

/** An oscillator under an envelope; returns when it has died away. */
const tone = ({ out, synth, t }: Shot, strike: ToneStrike): number => {
  const { ctx } = synth;
  const start = t + (strike.delay ?? 0);
  const attack = strike.attack ?? defaultAttack;
  const end = start + attack + strike.decay;
  const oscillator = ctx.createOscillator();
  oscillator.type = strike.type ?? "sine";
  sweep(
    oscillator.frequency,
    start,
    strike.from,
    strike.to,
    strike.glide ?? attack + strike.decay
  );

  const amp = ctx.createGain();
  envelope(amp.gain, start, strike.gain, attack, strike.decay);

  if (strike.lowpass === undefined) {
    oscillator.connect(amp);
  } else {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = strike.lowpass;
    oscillator.connect(filter).connect(amp);
  }

  amp.connect(out);
  oscillator.start(start);
  oscillator.stop(end + 0.02);

  return end;
};

/** Filtered noise (or crackle) under an envelope; returns when it has died away. */
const noise = ({ out, synth, t }: Shot, strike: NoiseStrike): number => {
  const { ctx } = synth;
  const start = t + (strike.delay ?? 0);
  const attack = strike.attack ?? defaultAttack;
  const end = start + attack + strike.decay;
  const source = ctx.createBufferSource();
  source.buffer = strike.crackle === true ? synth.crackle : synth.noise;
  source.loop = true;

  const filter = ctx.createBiquadFilter();
  filter.type = strike.filter;
  filter.Q.value = strike.q ?? 0.7;
  sweep(
    filter.frequency,
    start,
    strike.from,
    strike.to,
    strike.glide ?? attack + strike.decay
  );

  const amp = ctx.createGain();
  envelope(amp.gain, start, strike.gain, attack, strike.decay);
  source.connect(filter).connect(amp).connect(out);
  source.start(start, Math.random() * bufferSeconds);
  source.stop(end + 0.02);

  return end;
};

/** Struck partials ringing together: bells, chimes and stingers. */
const bell = (
  shot: Shot,
  partials: readonly number[],
  strike: Omit<ToneStrike, "from">
): number =>
  Math.max(...partials.map((from) => tone(shot, { ...strike, from })));

/** Notes one after another, `gap` seconds apart. */
const arpeggio = (
  shot: Shot,
  notes: readonly number[],
  gap: number,
  strike: Omit<ToneStrike, "from">
): number =>
  Math.max(
    ...notes.map((from, index) =>
      tone(shot, { ...strike, delay: (strike.delay ?? 0) + index * gap, from })
    )
  );

/** Each kind of Sound, by its kind. */
type SoundOf = {
  readonly [Kind in Sound["kind"]]: Extract<Sound, { kind: Kind }>;
};

/** A recipe per kind of Sound, taking that kind; returns when it has died away. */
type Recipes = {
  readonly [Kind in keyof SoundOf]: (
    shot: Shot,
    sound: SoundOf[Kind]
  ) => number;
};

/** Notes, in Hz. */
const note = {
  a3: 220,
  a4: 440,
  b6: 1975.5,
  c4: 261.63,
  c5: 523.25,
  c6: 1046.5,
  d3: 146.83,
  d4: 293.66,
  e5: 659.25,
  e6: 1318.5,
  e7: 2637,
  eb4: 311.13,
  f3: 174.61,
  f4: 349.23,
  g4: 392,
  g5: 783.99,
} as const;

const castRecipes = {
  "confringo-cast": (shot, { charge, empowered }) => {
    const power = 0.5 + 0.5 * charge;

    return Math.max(
      noise(shot, {
        attack: 0.02,
        decay: 0.45,
        filter: "lowpass",
        from: 400,
        gain: 0.6 * power,
        glide: 0.25,
        to: 2600,
      }),
      tone(shot, {
        decay: 0.5,
        from: 130,
        gain: 0.35 * power,
        lowpass: 900,
        to: 48,
        type: "sawtooth",
      }),
      tone(shot, { decay: 0.4, from: 90, gain: 0.5 * power, to: 40 }),
      empowered
        ? tone(shot, {
            decay: 0.35,
            from: 660,
            gain: 0.15,
            to: 1320,
            type: "triangle",
          })
        : 0
    );
  },
  "incendio-cast": (shot) =>
    Math.max(
      noise(shot, {
        attack: 0.05,
        decay: 0.4,
        filter: "bandpass",
        from: 500,
        gain: 0.6,
        q: 0.9,
        to: 1600,
      }),
      noise(shot, {
        crackle: true,
        decay: 0.4,
        filter: "highpass",
        from: 2000,
        gain: 0.5,
      }),
      tone(shot, {
        decay: 0.35,
        from: 180,
        gain: 0.25,
        lowpass: 700,
        to: 90,
        type: "sawtooth",
      })
    ),
  "perfect-release": (shot) =>
    Math.max(
      bell(shot, [note.e6, note.b6, note.e7], { decay: 0.9, gain: 0.26 }),
      noise(shot, { decay: 0.15, filter: "highpass", from: 5000, gain: 0.25 })
    ),
  "petrificus-cast": (shot) =>
    Math.max(
      tone(shot, { decay: 0.32, from: 1250, gain: 0.35, to: 1700 }),
      tone(shot, {
        decay: 0.28,
        from: 1880,
        gain: 0.18,
        to: 2550,
        type: "triangle",
      }),
      noise(shot, { decay: 0.25, filter: "highpass", from: 6000, gain: 0.25 })
    ),
  "stupefy-cast": (shot, { strong }) =>
    Math.max(
      tone(shot, {
        decay: strong ? 0.2 : 0.11,
        from: strong ? 1100 : 1500,
        gain: 0.35,
        lowpass: 3500,
        to: strong ? 280 : 520,
        type: "square",
      }),
      noise(shot, { decay: 0.06, filter: "highpass", from: 4000, gain: 0.35 }),
      strong ? tone(shot, { decay: 0.25, from: 240, gain: 0.6, to: 90 }) : 0
    ),
} satisfies Partial<Recipes>;

const impactRecipes = {
  "confringo-blast": (shot, { charge, empowered }) => {
    const power = 0.45 + 0.55 * charge;
    const tail = 0.7 + 0.4 * charge + (empowered ? 0.3 : 0);

    return Math.max(
      noise(shot, {
        decay: tail,
        filter: "lowpass",
        from: 3000,
        gain: 0.8 * power,
        to: 180,
      }),
      tone(shot, { decay: 0.55, from: 95, gain: 0.9 * power, to: 32 }),
      noise(shot, {
        decay: 0.08,
        filter: "highpass",
        from: 1800,
        gain: 0.5 * power,
      }),
      noise(shot, {
        attack: 0.03,
        crackle: true,
        decay: tail * 0.8,
        delay: 0.05,
        filter: "bandpass",
        from: 2500,
        gain: 0.5 * power,
      })
    );
  },
  fizzle: (shot) =>
    Math.max(
      noise(shot, {
        decay: 0.12,
        filter: "bandpass",
        from: 1400,
        gain: 0.6,
        q: 1.5,
        to: 600,
      }),
      tone(shot, { decay: 0.1, from: 500, gain: 0.2, to: 200 })
    ),
  "incendio-explosion": (shot) =>
    Math.max(
      noise(shot, {
        decay: 1.4,
        filter: "lowpass",
        from: 4500,
        gain: 0.85,
        glide: 1.2,
        to: 140,
      }),
      tone(shot, { decay: 0.9, from: 75, gain: 1, to: 26 }),
      tone(shot, { attack: 0.01, decay: 0.6, from: 45, gain: 0.5 }),
      noise(shot, { decay: 0.1, filter: "highpass", from: 2000, gain: 0.6 }),
      noise(shot, {
        attack: 0.05,
        crackle: true,
        decay: 1.3,
        delay: 0.1,
        filter: "bandpass",
        from: 3000,
        gain: 0.6,
      })
    ),
  petrify: (shot) =>
    Math.max(
      noise(shot, {
        decay: 0.45,
        filter: "bandpass",
        from: 900,
        gain: 0.7,
        q: 2.5,
        to: 250,
      }),
      noise(shot, {
        crackle: true,
        decay: 0.4,
        filter: "bandpass",
        from: 1500,
        gain: 0.6,
      }),
      tone(shot, { decay: 0.3, from: 130, gain: 0.6, to: 60 }),
      bell(shot, [2400, 3610], { attack: 0.01, decay: 0.8, gain: 0.1 })
    ),
  "petrify-break": (shot) =>
    Math.max(
      noise(shot, {
        crackle: true,
        decay: 0.35,
        filter: "bandpass",
        from: 1200,
        gain: 0.8,
      }),
      noise(shot, {
        decay: 0.3,
        filter: "bandpass",
        from: 600,
        gain: 0.5,
        q: 1.5,
        to: 300,
      }),
      tone(shot, { decay: 0.15, from: 160, gain: 0.4, to: 80 })
    ),
  "spells-cancelled": (shot) =>
    Math.max(
      noise(shot, {
        decay: 0.2,
        filter: "bandpass",
        from: 2600,
        gain: 0.6,
        q: 1,
        to: 900,
      }),
      tone(shot, {
        decay: 0.18,
        from: 1100,
        gain: 0.3,
        to: 300,
        type: "triangle",
      }),
      tone(shot, { decay: 0.15, from: 160, gain: 0.4, to: 70 })
    ),
  "stupefy-hit": (shot, { strong }) =>
    Math.max(
      noise(shot, {
        decay: strong ? 0.25 : 0.12,
        filter: "bandpass",
        from: 1800,
        gain: 0.7,
        q: 1.2,
        to: 700,
      }),
      tone(shot, { decay: strong ? 0.3 : 0.14, from: 200, gain: 0.7, to: 55 }),
      strong
        ? noise(shot, {
            decay: 0.05,
            filter: "highpass",
            from: 2500,
            gain: 0.6,
          })
        : 0,
      strong
        ? tone(shot, {
            decay: 0.18,
            from: 900,
            gain: 0.25,
            to: 300,
            type: "triangle",
          })
        : 0
    ),
} satisfies Partial<Recipes>;

const chargeRecipes = {
  backfire: (shot) =>
    Math.max(
      noise(shot, { decay: 0.06, filter: "highpass", from: 1200, gain: 0.9 }),
      noise(shot, {
        decay: 0.45,
        filter: "lowpass",
        from: 1800,
        gain: 0.7,
        to: 200,
      }),
      tone(shot, {
        decay: 0.45,
        from: 420,
        gain: 0.3,
        lowpass: 1500,
        to: 55,
        type: "sawtooth",
      }),
      tone(shot, { decay: 0.3, from: 140, gain: 0.7, to: 40 }),
      noise(shot, {
        crackle: true,
        decay: 0.5,
        filter: "bandpass",
        from: 2500,
        gain: 0.5,
      })
    ),
  "charge-ready": (shot) =>
    Math.max(
      tone(shot, { decay: 0.22, from: 1760, gain: 0.6 }),
      tone(shot, { decay: 0.15, from: 2640, gain: 0.25 })
    ),
  "overcharge-warning": (shot) =>
    Math.max(
      tone(shot, {
        decay: 0.07,
        from: 980,
        gain: 0.4,
        lowpass: 2500,
        type: "square",
      }),
      tone(shot, {
        decay: 0.07,
        delay: 0.1,
        from: 1170,
        gain: 0.4,
        lowpass: 2500,
        type: "square",
      })
    ),
} satisfies Partial<Recipes>;

const dodge = (shot: Shot) =>
  noise(shot, {
    attack: 0.04,
    decay: 0.22,
    filter: "bandpass",
    from: 350,
    gain: 0.8,
    glide: 0.18,
    q: 1.2,
    to: 1500,
  });

const defenceRecipes = {
  dodge,
  jump: (shot) =>
    Math.max(
      noise(shot, {
        attack: 0.03,
        decay: 0.15,
        filter: "bandpass",
        from: 300,
        gain: 0.6,
        q: 1,
        to: 900,
      }),
      tone(shot, { decay: 0.1, from: 180, gain: 0.2, to: 260 })
    ),
  land: (shot) =>
    Math.max(
      tone(shot, { decay: 0.12, from: 120, gain: 0.8, to: 45 }),
      noise(shot, { decay: 0.08, filter: "lowpass", from: 600, gain: 0.5 })
    ),
  parry: (shot) =>
    Math.max(
      tone(shot, { decay: 1.1, from: 1000, gain: 0.35 }),
      tone(shot, { decay: 0.7, from: 2756, gain: 0.2 }),
      tone(shot, { decay: 0.4, from: 5404, gain: 0.1 }),
      noise(shot, { decay: 0.05, filter: "highpass", from: 3000, gain: 0.6 }),
      tone(shot, { decay: 0.15, from: 2000, gain: 0.15, to: 4000 })
    ),
  "perfect-dodge": (shot) =>
    Math.max(
      dodge(shot),
      bell(shot, [2093, 3136], { decay: 0.6, delay: 0.05, gain: 0.18 })
    ),
  "shield-block": (shot, { heavy }) => {
    const ring = heavy ? 0.5 : 0.3;

    return Math.max(
      tone(shot, { decay: ring, from: 520, gain: 0.45 }),
      tone(shot, { decay: ring * 0.8, from: 784, gain: 0.3 }),
      tone(shot, { decay: 0.2, from: 1310, gain: 0.15 }),
      noise(shot, {
        decay: 0.08,
        filter: "bandpass",
        from: 1100,
        gain: 0.6,
        q: 1,
      }),
      heavy ? tone(shot, { decay: 0.3, from: 110, gain: 0.7, to: 55 }) : 0,
      heavy
        ? noise(shot, { decay: 0.25, filter: "lowpass", from: 900, gain: 0.4 })
        : 0
    );
  },
  "shield-raise": (shot) =>
    Math.max(
      tone(shot, {
        attack: 0.04,
        decay: 0.3,
        from: 280,
        gain: 0.35,
        glide: 0.2,
        to: 620,
        type: "triangle",
      }),
      tone(shot, {
        attack: 0.04,
        decay: 0.3,
        from: 560,
        gain: 0.15,
        glide: 0.2,
        to: 1240,
      }),
      noise(shot, {
        attack: 0.05,
        decay: 0.25,
        filter: "bandpass",
        from: 800,
        gain: 0.2,
        to: 3000,
      })
    ),
} satisfies Partial<Recipes>;

const feedbackRecipes = {
  "lock-off": (shot) =>
    Math.max(
      tone(shot, { decay: 0.04, from: 2150, gain: 0.6 }),
      tone(shot, { decay: 0.06, delay: 0.06, from: 1450, gain: 0.6 })
    ),
  "lock-on": (shot) =>
    Math.max(
      tone(shot, { decay: 0.04, from: 1600, gain: 0.6 }),
      tone(shot, { decay: 0.06, delay: 0.06, from: 2150, gain: 0.6 })
    ),
  "stamina-short": (shot) =>
    Math.max(
      tone(shot, {
        decay: 0.07,
        from: 180,
        gain: 0.5,
        lowpass: 600,
        type: "square",
      }),
      tone(shot, {
        decay: 0.09,
        delay: 0.1,
        from: 140,
        gain: 0.5,
        lowpass: 600,
        type: "square",
      })
    ),
} satisfies Partial<Recipes>;

const roundRecipes = {
  countdown: (shot) =>
    Math.max(
      tone(shot, { decay: 0.4, from: 660, gain: 0.5, type: "triangle" }),
      tone(shot, { decay: 0.25, from: 1320, gain: 0.2 }),
      tone(shot, { decay: 0.2, from: 165, gain: 0.4 })
    ),
  "duel-end": (shot, { won }) => {
    if (won) {
      const chord = [note.c5, note.e5, note.g5, note.c6];

      return Math.max(
        arpeggio(shot, chord, 0.11, {
          decay: 0.4,
          gain: 0.3,
          type: "triangle",
        }),
        bell(shot, chord, {
          decay: 1.8,
          delay: 0.5,
          gain: 0.2,
          type: "triangle",
        }),
        tone(shot, { decay: 1.6, delay: 0.5, from: note.c5 / 4, gain: 0.4 })
      );
    }

    return Math.max(
      arpeggio(shot, [note.a4, note.f4, note.d4], 0.28, {
        decay: 0.9,
        gain: 0.25,
        lowpass: 1200,
        type: "sawtooth",
      }),
      bell(shot, [note.d3, note.f3, note.a3], {
        decay: 2,
        delay: 0.9,
        gain: 0.2,
        lowpass: 800,
        type: "sawtooth",
      })
    );
  },
  "duel-start": (shot) =>
    Math.max(
      noise(shot, {
        attack: 0.02,
        decay: 0.5,
        filter: "bandpass",
        from: 400,
        gain: 0.4,
        q: 0.7,
        to: 2000,
      }),
      bell(shot, [note.a3, note.a3 * 1.5, note.a4], {
        decay: 1.2,
        gain: 0.18,
        lowpass: 2000,
        type: "sawtooth",
      }),
      bell(shot, [880, 1320], { decay: 1, gain: 0.25 }),
      tone(shot, { decay: 0.5, from: 110, gain: 0.6, to: 55 })
    ),
  knockout: (shot) =>
    Math.max(
      tone(shot, { decay: 1.3, from: 70, gain: 1, to: 24 }),
      noise(shot, {
        decay: 1.5,
        filter: "lowpass",
        from: 1200,
        gain: 0.7,
        to: 80,
      }),
      tone(shot, {
        decay: 1,
        from: 380,
        gain: 0.3,
        lowpass: 900,
        to: 60,
        type: "sawtooth",
      }),
      noise(shot, { decay: 0.08, filter: "highpass", from: 2500, gain: 0.5 })
    ),
  "round-end": (shot, { outcome }) => {
    const notes = {
      draw: [note.a4, note.a4],
      lost: [note.g4, note.eb4, note.c4],
      won: [note.c5, note.e5, note.g5],
    }[outcome];

    return arpeggio(shot, notes, 0.1, {
      decay: 0.5,
      gain: 0.35,
      type: "triangle",
    });
  },
} satisfies Partial<Recipes>;

const recipes: Recipes = {
  ...castRecipes,
  ...chargeRecipes,
  ...defenceRecipes,
  ...feedbackRecipes,
  ...impactRecipes,
  ...roundRecipes,
};

/** The recipe for `kind`, given a Sound of that kind. */
const playKind = <Kind extends keyof SoundOf>(
  shot: Shot,
  kind: Kind,
  sound: SoundOf[Kind]
): number => recipes[kind](shot, sound);

/** Plays `sound` into `out` now; returns the context time it has died away by. */
export const play = (synth: Synth, out: AudioNode, sound: Sound): number =>
  playKind({ out, synth, t: synth.ctx.currentTime }, sound.kind, sound);

const menuRecipes: Readonly<Record<MenuSound["kind"], (shot: Shot) => number>> =
  {
    "menu-back": (shot) =>
      Math.max(
        tone(shot, { decay: 0.08, from: 880, gain: 0.45, type: "triangle" }),
        tone(shot, {
          decay: 0.15,
          delay: 0.06,
          from: 587.3,
          gain: 0.45,
          type: "triangle",
        })
      ),
    "menu-confirm": (shot) =>
      Math.max(
        tone(shot, { decay: 0.09, from: 880, gain: 0.45, type: "triangle" }),
        tone(shot, {
          decay: 0.18,
          delay: 0.07,
          from: note.e6,
          gain: 0.45,
          type: "triangle",
        })
      ),
    "menu-move": (shot) =>
      Math.max(
        tone(shot, { decay: 0.035, from: 1250, gain: 0.5 }),
        tone(shot, { decay: 0.02, from: 2500, gain: 0.1, type: "triangle" })
      ),
  };

/** Plays a menu's sound into `out` now; returns when it has died away. */
export const playMenu = (synth: Synth, out: AudioNode, sound: MenuSound) =>
  menuRecipes[sound.kind]({ out, synth, t: synth.ctx.currentTime });

/** A held sound following its state: `set` every frame, `stop` once to fade it out. */
export interface HeldSound {
  /** `gain` is the sound's overall volume this frame (its level times its placement). */
  readonly set: (sound: LoopSound, gain: number, glide: number) => void;
  readonly stop: (release: number) => void;
}

const looped = (synth: Synth, buffer: AudioBuffer): AudioBufferSourceNode => {
  const source = synth.ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;

  return source;
};

const filtered = (
  ctx: AudioContext,
  type: BiquadFilterType,
  frequency: number,
  q = 0.7
) => {
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = q;

  return filter;
};

const gainOf = (ctx: AudioContext, value: number) => {
  const node = ctx.createGain();
  node.gain.value = value;

  return node;
};

const oscillatorOf = (
  ctx: AudioContext,
  type: OscillatorType,
  frequency: number
) => {
  const oscillator = ctx.createOscillator();
  oscillator.type = type;
  oscillator.frequency.value = frequency;

  return oscillator;
};

/**
 * A Charging Wand: a resonant, rising drone (two detuned saws over a sine
 * sub) with sparks crackling over it, both climbing with the Charge, and a
 * tremolo that quickens and deepens as Overcharge nears.
 */
const chargeVoice = (synth: Synth, amp: GainNode) => {
  const { ctx } = synth;
  const saw = oscillatorOf(ctx, "sawtooth", 70);
  const saw2 = oscillatorOf(ctx, "sawtooth", 70);
  const sub = oscillatorOf(ctx, "sine", 35);
  const filter = filtered(ctx, "lowpass", 300, 6);
  const drone = gainOf(ctx, 0.3);
  const sparks = looped(synth, synth.crackle);
  const sparkLevel = gainOf(ctx, 0);
  const lfo = oscillatorOf(ctx, "sine", 3);
  const lfoDepth = gainOf(ctx, 0);
  const subLevel = gainOf(ctx, 0.5);

  saw.connect(filter);
  saw2.connect(filter);
  filter.connect(drone).connect(amp);
  sub.connect(subLevel).connect(amp);
  sparks
    .connect(filtered(ctx, "bandpass", 3200))
    .connect(sparkLevel)
    .connect(amp);
  lfo.connect(lfoDepth).connect(amp.gain);

  return {
    runners: [saw, saw2, sub, sparks, lfo],
    set: (sound: LoopSound, gain: number, glide: number) => {
      if (sound.kind !== "charge") {
        return;
      }

      const { level, overcharge } = sound;
      const t = ctx.currentTime;
      const pitch = 70 * 2 ** (level * 1.6);
      saw.frequency.setTargetAtTime(pitch, t, glide);
      saw2.frequency.setTargetAtTime(pitch * 1.008, t, glide);
      sub.frequency.setTargetAtTime(pitch / 2, t, glide);
      filter.frequency.setTargetAtTime(
        250 + 3200 * level ** 2 + 1500 * overcharge,
        t,
        glide
      );
      sparkLevel.gain.setTargetAtTime(
        0.15 + 0.6 * level ** 2 + 0.5 * overcharge,
        t,
        glide
      );
      lfo.frequency.setTargetAtTime(3 + 20 * overcharge, t, glide);

      const body = gain * (0.25 + 0.75 * level);
      amp.gain.setTargetAtTime(body, t, glide);
      lfoDepth.gain.setTargetAtTime(body * (0.1 + 0.5 * overcharge), t, glide);
    },
  };
};

/** A raised Shield: a soft, warbling hum of three low partials. */
const shieldVoice = (synth: Synth, amp: GainNode) => {
  const { ctx } = synth;
  const filter = filtered(ctx, "lowpass", 1200);

  const partials = [98, 147.6, 196.5].map((frequency) =>
    oscillatorOf(ctx, "sine", frequency)
  );

  const lfo = oscillatorOf(ctx, "sine", 5);
  const lfoDepth = gainOf(ctx, 0);

  for (const partial of partials) {
    partial.connect(filter);
  }

  filter.connect(gainOf(ctx, 0.4)).connect(amp);
  lfo.connect(lfoDepth).connect(amp.gain);

  return {
    runners: [...partials, lfo],
    set: (_sound: LoopSound, gain: number, glide: number) => {
      const t = ctx.currentTime;
      amp.gain.setTargetAtTime(gain, t, glide);
      lfoDepth.gain.setTargetAtTime(gain * 0.25, t, glide);
    },
  };
};

/** A Burn: crackling fire over a low roar. */
const burnVoice = (synth: Synth, amp: GainNode) => {
  const { ctx } = synth;
  const crackle = looped(synth, synth.crackle);
  const roar = looped(synth, synth.noise);

  crackle
    .connect(filtered(ctx, "highpass", 1800))
    .connect(gainOf(ctx, 0.9))
    .connect(amp);
  roar
    .connect(filtered(ctx, "lowpass", 400))
    .connect(gainOf(ctx, 0.35))
    .connect(amp);

  return {
    runners: [crackle, roar],
    set: (_sound: LoopSound, gain: number, glide: number) => {
      amp.gain.setTargetAtTime(gain, ctx.currentTime, glide);
    },
  };
};

const heldVoices = {
  burn: burnVoice,
  charge: chargeVoice,
  shield: shieldVoice,
} as const;

/** Starts the held sound for `kind`, silent until its first `set`, playing into `out`. */
export const hold = (
  synth: Synth,
  out: AudioNode,
  kind: LoopSound["kind"]
): HeldSound => {
  // The voice shapes `amp` (tremolo included); `fader` only fades it out.
  const amp = gainOf(synth.ctx, 0);
  const fader = gainOf(synth.ctx, 1);
  amp.connect(fader).connect(out);
  const voice = heldVoices[kind](synth, amp);

  for (const runner of voice.runners) {
    runner.start();
  }

  return {
    set: voice.set,
    stop: (release) => {
      const t = synth.ctx.currentTime;
      fader.gain.setTargetAtTime(0, t, release / 4);

      for (const runner of voice.runners) {
        runner.stop(t + release);
      }

      // Disconnect once silent, so nothing lingers in the graph.
      voice.runners[0]?.addEventListener("ended", () => {
        fader.disconnect();
      });
    },
  };
};
