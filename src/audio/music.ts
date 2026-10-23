/**
 * The music and the ambience: a theme looping (its end overlapped with its
 * start, since the files are not cut as loops), crossfading when the screens
 * call for another, held back while a Duel's fanfare plays; the courtyard at
 * night looping under the Duel; the music dipping under the big stingers;
 * both dimmed and muffled behind the pause menu. What to play comes from
 * `musicFor` (`samples.ts`); this only plays it.
 */
import type { Tuning } from "../tuning";
import type { Sample, SampleBank } from "./bank";
import { ambienceSample } from "./samples";
import type { MusicState, SampleId, Theme } from "./samples";

type MusicSettings = Pick<
  Tuning["audio"],
  "ambienceFade" | "dim" | "duck" | "music" | "volumes"
>;

/** A sample's own volume. */
const volumeOf = (settings: MusicSettings, id: SampleId) =>
  new Map(Object.entries(settings.volumes)).get(id) ?? 1;

export interface MusicBuses {
  /** Themes and fanfares, under the duck. */
  readonly music: AudioNode;
  readonly ambience: AudioNode;
  /** The dim stage both pass through on the way to the master. */
  readonly dim: { readonly gain: GainNode; readonly lowpass: BiquadFilterNode };
  readonly duck: GainNode;
}

/** A sample playing (or due to play) once into `out`, faded in and out by its own gain. */
const scheduled = (
  ctx: AudioContext,
  sample: Sample,
  out: AudioNode,
  at: number
) => {
  const source = ctx.createBufferSource();
  source.buffer = sample.buffer;
  const fade = ctx.createGain();
  source.connect(fade).connect(out);
  source.start(at, sample.start);
  source.addEventListener("ended", () => {
    fade.disconnect();
  });

  return { fade, source };
};

/** A theme looping into its own fader from `startAt`, each repeat overlapping the last's end. */
const themePlayer = (
  ctx: AudioContext,
  theme: Theme,
  sample: Sample,
  out: AudioNode,
  startAt: number,
  settings: MusicSettings
) => {
  const fader = ctx.createGain();
  fader.connect(out);
  const volume = volumeOf(settings, theme);
  const { crossfade, loopOverlap, scheduleAhead } = settings.music;
  fader.gain.setValueAtTime(0, ctx.currentTime);
  fader.gain.setValueAtTime(0, startAt);
  fader.gain.linearRampToValueAtTime(volume, startAt + crossfade);

  const length = sample.end - sample.start;
  const overlap = Math.min(loopOverlap, length / 2);
  const sources: AudioBufferSourceNode[] = [];
  let nextStart = startAt;
  let first = true;

  /** Schedules the next repeat once it is near. */
  const tick = () => {
    if (ctx.currentTime < nextStart - scheduleAhead) {
      return;
    }

    const at = nextStart;
    const end = at + length;
    const { fade, source } = scheduled(ctx, sample, fader, at);

    // The first play rides the fader's fade-in; repeats rise over the overlap.
    fade.gain.setValueAtTime(first ? 1 : 0, at);
    fade.gain.linearRampToValueAtTime(1, at + overlap);
    fade.gain.setValueAtTime(1, end - overlap);
    fade.gain.linearRampToValueAtTime(0, end);
    source.stop(end);
    sources.push(source);
    source.addEventListener("ended", () => {
      sources.splice(sources.indexOf(source), 1);
    });

    first = false;
    nextStart = end - overlap;
  };

  return {
    stop: (seconds: number) => {
      const t = ctx.currentTime;
      fader.gain.cancelScheduledValues(t);
      fader.gain.setValueAtTime(fader.gain.value, t);
      fader.gain.linearRampToValueAtTime(0, t + seconds);

      for (const source of sources) {
        source.stop(t + seconds);
      }

      nextStart = Number.POSITIVE_INFINITY;
      setTimeout(
        () => {
          fader.disconnect();
        },
        (seconds + 0.1) * 1000
      );
    },
    theme,
    tick,
  };
};

type ThemePlayer = ReturnType<typeof themePlayer>;

/** The courtyard at night, looping seamlessly while wanted. */
const ambiencePlayer = (
  ctx: AudioContext,
  sample: Sample,
  out: AudioNode,
  settings: MusicSettings
) => {
  const source = ctx.createBufferSource();
  source.buffer = sample.buffer;
  source.loop = true;
  source.loopStart = sample.start;
  source.loopEnd = sample.end;
  const fader = ctx.createGain();
  source.connect(fader).connect(out);
  const t = ctx.currentTime;
  fader.gain.setValueAtTime(0, t);
  fader.gain.linearRampToValueAtTime(
    volumeOf(settings, ambienceSample),
    t + settings.ambienceFade
  );
  source.start(t, sample.start);
  source.addEventListener("ended", () => {
    fader.disconnect();
  });

  return {
    stop: () => {
      const now = ctx.currentTime;
      fader.gain.cancelScheduledValues(now);
      fader.gain.setValueAtTime(fader.gain.value, now);
      fader.gain.linearRampToValueAtTime(0, now + settings.ambienceFade);
      source.stop(now + settings.ambienceFade);
    },
  };
};

export const createMusic = (
  ctx: AudioContext,
  bank: SampleBank,
  buses: MusicBuses,
  settings: MusicSettings
) => {
  let playing: ThemePlayer | null = null;
  let ambience: ReturnType<typeof ambiencePlayer> | null = null;
  let dimmed = false;
  /** When the fanfare playing ends: a new theme waits for it. */
  let fanfareEnd = 0;

  const setDimmed = (dim: boolean) => {
    if (dim === dimmed) {
      return;
    }

    dimmed = dim;
    const t = ctx.currentTime;
    const ease = settings.dim.seconds / 3;
    buses.dim.gain.gain.setTargetAtTime(dim ? settings.dim.gain : 1, t, ease);
    buses.dim.lowpass.frequency.setTargetAtTime(
      dim ? settings.dim.lowpass : ctx.sampleRate / 2,
      t,
      ease
    );
  };

  const setTheme = (theme: Theme | null) => {
    if (playing?.theme === theme) {
      playing.tick();

      return;
    }

    const sample = theme === null ? undefined : bank.get(theme);

    // A theme still loading starts once it has.
    if (theme !== null && !sample) {
      return;
    }

    playing?.stop(settings.music.crossfade);
    playing =
      theme !== null && sample
        ? themePlayer(
            ctx,
            theme,
            sample,
            buses.music,
            Math.max(ctx.currentTime, fanfareEnd - settings.music.crossfade),
            settings
          )
        : null;
    playing?.tick();
  };

  const setAmbience = (wanted: boolean) => {
    if (wanted && !ambience) {
      const sample = bank.get(ambienceSample);
      ambience = sample
        ? ambiencePlayer(ctx, sample, buses.ambience, settings)
        : null;
    } else if (!wanted && ambience) {
      ambience.stop();
      ambience = null;
    }
  };

  return {
    /** The music dips under a big stinger, then comes back. */
    duck: () => {
      const { attack, gain, hold, release } = settings.duck;
      const t = ctx.currentTime;
      const param = buses.duck.gain;
      param.cancelScheduledValues(t);
      param.setTargetAtTime(gain, t, attack / 3);
      param.setTargetAtTime(1, t + attack + hold, release / 3);
    },
    /** A Duel's fanfare is playing until `end` (context time). */
    fanfare: (end: number) => {
      fanfareEnd = end;
    },
    /** Follows what the screens call for; call every frame. */
    update: (state: MusicState) => {
      setDimmed(state.dimmed);
      setTheme(state.theme);
      setAmbience(state.ambience);
    },
  };
};
