/**
 * The game's sound: a WebAudio engine that plays what `cues.ts` decides for
 * each frame (one-shot sounds for events, held sounds for Charge, Shield and
 * Burn), placed by `spatial.ts` relative to the camera, plus the menus'
 * sounds, the music and the ambience (`music.ts`). Every sound is one of the
 * approved samples (`public/audio`), chosen by `samples.ts`, preloaded and
 * decoded once the AudioContext starts.
 *
 * The mix: the Duel's sounds go through the `sfx` bus, with a synthesised
 * stone-courtyard reverb; countdown, stingers, Lock-on ticks and menus
 * through the dry `ui` bus; themes and fanfares through `music`, the
 * courtyard at night through `ambience`. The player's Options set two more
 * volumes over them: the music's, and the effects' (every other bus). All
 * meet in the master volume, then
 * a compressor and a soft clip under a fixed ceiling, so peaks stay under
 * 0 dBFS however much plays at once.
 *
 * Browsers only let a page start sound after a mouse click or keypress
 * (gamepad presses do not count), so the AudioContext is created on the
 * first one, the same moment the DualSense effects ask for WebHID. Until
 * then the game is silent, and the menus say a click turns the sound on.
 */
import { Vector3 } from "three/webgpu";
import type { Object3D } from "three/webgpu";

import type { ActivationHint } from "../activation-hint";
import type { DuelEvent, DuelistId, DuelSnapshot } from "../duel/duel";
import type { Screen } from "../screens/screens";
import type { Tuning } from "../tuning";
import { loadSamples } from "./bank";
import type { Sample, SampleBank } from "./bank";
import { cuesFor, loopsFor } from "./cues";
import type { Loop, LoopSound, MenuSound } from "./cues";
import { createMusic } from "./music";
import {
  loopSampleOf,
  menuSampleFor,
  musicFor,
  sampleFor,
  samplesUsed,
} from "./samples";
import type { SamplePlay } from "./samples";
import { placement } from "./spatial";
import type { Listener } from "./spatial";

type AudioSettings = Tuning["audio"];

/** One frame of the game, as far as the sound cares. */
export interface AudioFrame {
  /** The Duel's events since the last frame. */
  readonly events: readonly DuelEvent[];
  readonly snapshot: DuelSnapshot;
  /** The Duel is being played: not behind a menu, the pause or the title. Held sounds fall silent otherwise. */
  readonly live: boolean;
  /** The screen the frame ends on: it picks the music. */
  readonly screen: Screen;
}

/** The player's two volumes, each a gain from 0 (silent) to 1 (as mixed). */
export interface Volumes {
  readonly music: number;
  readonly effects: number;
}

export interface DuelAudio {
  readonly frame: (frame: AudioFrame) => void;
  /** Plays a menu's sound. */
  readonly menu: (sound: MenuSound) => void;
  /** Sets the player's music and effects volumes, now and for when the sound starts. */
  readonly volumes: (volumes: Volumes) => void;
}

/** Transparent below `knee`, rounding smoothly toward 1 above it; inputs past ±1 hold at the curve's ends. */
const softClipCurve = (knee: number) => {
  const curve = new Float32Array(4097);

  for (const [index] of curve.entries()) {
    const x = (index / (curve.length - 1)) * 2 - 1;
    const size = Math.abs(x);

    const rounded =
      size <= knee
        ? size
        : knee + (1 - knee) * Math.tanh((size - knee) / (1 - knee));

    curve[index] = Math.sign(x) * rounded;
  }

  return curve;
};

/** A stereo tail of decaying noise: a stone courtyard at night, give or take. */
const impulseOf = (ctx: AudioContext, settings: AudioSettings["reverb"]) => {
  const length = Math.round(ctx.sampleRate * settings.seconds);
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);

  for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
    const data = impulse.getChannelData(channel);

    for (let index = 0; index < length; index += 1) {
      data[index] =
        (Math.random() * 2 - 1) * (1 - index / length) ** settings.decay;
    }
  }

  return impulse;
};

const gainNode = (ctx: AudioContext, value: number) => {
  const node = ctx.createGain();
  node.gain.value = value;

  return node;
};

/** The buses, the reverb, the music's duck and dim, and the master chain down to the speakers. */
const createMixer = (
  ctx: AudioContext,
  settings: AudioSettings,
  volumes: Volumes
) => {
  const master = gainNode(ctx, settings.muted ? 0 : settings.master);
  const compressor = ctx.createDynamicsCompressor();
  const { attack, knee, ratio, release, threshold } = settings.compressor;
  compressor.attack.value = attack;
  compressor.knee.value = knee;
  compressor.ratio.value = ratio;
  compressor.release.value = release;
  compressor.threshold.value = threshold;

  const clip = ctx.createWaveShaper();
  clip.curve = softClipCurve(settings.softClipKnee);
  // No oversampling: its filters could ring a hair past the curve's ceiling.
  clip.oversample = "none";
  const output = gainNode(ctx, settings.ceiling);
  master
    .connect(compressor)
    .connect(clip)
    .connect(output)
    .connect(ctx.destination);

  // The player's volumes: the music's, and the effects' over every other bus.
  const musicVolume = gainNode(ctx, volumes.music);
  const effectsVolume = gainNode(ctx, volumes.effects);
  const ambienceVolume = gainNode(ctx, volumes.effects);
  effectsVolume.connect(master);

  const sfx = gainNode(ctx, settings.buses.sfx);
  const ui = gainNode(ctx, settings.buses.ui);
  const reverb = ctx.createConvolver();
  reverb.buffer = impulseOf(ctx, settings.reverb);
  sfx.connect(effectsVolume);
  sfx
    .connect(gainNode(ctx, settings.reverb.send))
    .connect(reverb)
    .connect(effectsVolume);
  ui.connect(effectsVolume);

  // Music and ambience share the dim stage behind the pause menu; only the music ducks.
  const dimGain = gainNode(ctx, 1);
  const dimLowpass = ctx.createBiquadFilter();
  dimLowpass.type = "lowpass";
  dimLowpass.frequency.value = ctx.sampleRate / 2;
  dimLowpass.connect(dimGain).connect(master);
  const duck = gainNode(ctx, 1);
  const music = gainNode(ctx, settings.buses.music);
  music.connect(musicVolume).connect(duck).connect(dimLowpass);
  const ambience = gainNode(ctx, settings.buses.ambience);
  ambience.connect(ambienceVolume).connect(dimLowpass);

  return {
    ambience,
    dim: { gain: dimGain, lowpass: dimLowpass },
    duck,
    music,
    output,
    sfx,
    ui,
    /** Sets the player's volumes, eased over `glide` seconds. */
    volumes: (next: Volumes, glide: number) => {
      const t = ctx.currentTime;
      musicVolume.gain.setTargetAtTime(next.music, t, glide);
      effectsVolume.gain.setTargetAtTime(next.effects, t, glide);
      ambienceVolume.gain.setTargetAtTime(next.effects, t, glide);
    },
  };
};

type Mixer = ReturnType<typeof createMixer>;

/** A random factor within ±`share`... */
const jitter = (share: number) => 1 + (Math.random() * 2 - 1) * share;

/** ...and a random pitch within ±`cents`, as a playback rate. */
const detune = (cents: number) =>
  2 ** (((Math.random() * 2 - 1) * cents) / 1200);

/** A held sound looping one sample, following its state: `set` every frame, `stop` once to fade it out. */
const heldVoice = (
  ctx: AudioContext,
  sample: Sample,
  out: AudioNode,
  settings: AudioSettings
) => {
  const source = ctx.createBufferSource();
  source.buffer = sample.buffer;
  source.loop = true;
  source.loopStart = sample.start;
  source.loopEnd = sample.end;
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = ctx.sampleRate / 2;
  // `amp` follows the state (tremolo included); `fader` only fades it out.
  const amp = gainNode(ctx, 0);
  const fader = gainNode(ctx, 1);
  source.connect(lowpass).connect(amp).connect(fader).connect(out);
  source.start(ctx.currentTime, sample.start);

  /** The Charge's tremolo, started on its first Charge frame. */
  let tremolo: { lfo: OscillatorNode; depth: GainNode } | undefined;

  const followCharge = (
    sound: Extract<LoopSound, { kind: "charge" }>,
    body: number,
    glide: number
  ) => {
    const {
      emptyGain,
      lowpass: cut,
      rate,
      tremolo: shake,
    } = settings.chargeLoop;

    const { level, overcharge } = sound;
    const t = ctx.currentTime;

    if (!tremolo) {
      const lfo = ctx.createOscillator();
      const depth = gainNode(ctx, 0);
      lfo.connect(depth).connect(amp.gain);
      lfo.start();
      tremolo = { depth, lfo };
    }

    source.playbackRate.setTargetAtTime(
      rate.empty + (rate.full - rate.empty) * level,
      t,
      glide
    );
    lowpass.frequency.setTargetAtTime(
      cut.empty +
        (cut.full - cut.empty) * level ** 2 +
        (cut.overcharge - cut.full) * overcharge,
      t,
      glide
    );
    tremolo.lfo.frequency.setTargetAtTime(
      shake.calmRate + (shake.franticRate - shake.calmRate) * overcharge,
      t,
      glide
    );

    const level0 = body * (emptyGain + (1 - emptyGain) * level);
    amp.gain.setTargetAtTime(level0, t, glide);
    tremolo.depth.gain.setTargetAtTime(
      level0 *
        (shake.calmDepth + (shake.franticDepth - shake.calmDepth) * overcharge),
      t,
      glide
    );
  };

  return {
    /** `gain` is the sound's overall volume this frame (its level times its placement). */
    set: (sound: LoopSound, gain: number, glide: number) => {
      if (sound.kind === "charge") {
        followCharge(sound, gain, glide);
      } else {
        amp.gain.setTargetAtTime(gain, ctx.currentTime, glide);
      }
    },
    stop: (release: number) => {
      const t = ctx.currentTime;
      fader.gain.setTargetAtTime(0, t, release / 4);
      source.stop(t + release);
      tremolo?.lfo.stop(t + release);
      // Disconnect once silent, so nothing lingers in the graph.
      source.addEventListener("ended", () => {
        fader.disconnect();
      });
    },
  };
};

interface HeldVoice {
  readonly sound: ReturnType<typeof heldVoice>;
  readonly panner: StereoPannerNode;
}

/** The running engine, once a gesture has let the AudioContext start. */
const createEngine = (
  ctx: AudioContext,
  settings: AudioSettings,
  playerVolumes: Volumes
) => {
  const mixer: Mixer = createMixer(ctx, settings, playerVolumes);
  const bank: SampleBank = loadSamples(ctx, samplesUsed, settings.silenceFloor);
  const music = createMusic(ctx, bank, mixer, settings);
  const held = new Map<string, HeldVoice>();
  const volumes = new Map(Object.entries(settings.volumes));
  const trims = new Map(Object.entries(settings.trims));
  let voices = 0;

  /** Plays a sample once, at `gain` and `pan` on top of its own volume. */
  const play = (spec: SamplePlay, gain: number, pan: number) => {
    const sample = bank.get(spec.sample);

    if (!sample || voices >= settings.maxVoices) {
      return;
    }

    // Sound effects vary a touch each time; music plays as written.
    const varies = spec.bus !== "music";
    const { cents, gain: spread } = settings.variation;
    const rate = spec.rate * (varies ? detune(cents) : 1);

    const volume =
      (volumes.get(spec.sample) ?? 1) *
      spec.gain *
      gain *
      (varies ? jitter(spread) : 1);

    const source = ctx.createBufferSource();
    source.buffer = sample.buffer;
    source.playbackRate.value = rate;
    const level = gainNode(ctx, volume);
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    source.connect(level).connect(panner).connect(mixer[spec.bus]);

    const t = ctx.currentTime;
    const trim = trims.get(spec.sample);
    const length = Math.min(trim ?? Infinity, sample.end - sample.start);
    const end = t + length / rate;

    if (trim !== undefined) {
      level.gain.setValueAtTime(volume, end - settings.trimFade);
      level.gain.linearRampToValueAtTime(0, end);
    }

    source.start(t, sample.start);
    source.stop(end);
    voices += 1;
    source.addEventListener("ended", () => {
      panner.disconnect();
      voices -= 1;
    });

    if (spec.ducks) {
      music.duck();
    }

    if (spec.bus === "music") {
      music.fanfare(end);
    }
  };

  const stopHeld = (key: string, voice: HeldVoice) => {
    voice.sound.stop(settings.loopRelease);
    held.delete(key);
    setTimeout(
      () => {
        voice.panner.disconnect();
      },
      (settings.loopRelease + 0.1) * 1000
    );
  };

  return {
    bank,
    ctx,
    /** Starts, follows and stops the held sounds so exactly `loops` are playing. */
    hold: (loops: readonly Loop[], listener: Listener) => {
      const wanted = new Set(loops.map((loop) => loop.key));

      for (const [key, voice] of held) {
        if (!wanted.has(key)) {
          stopHeld(key, voice);
        }
      }

      for (const loop of loops) {
        let voice = held.get(loop.key);
        const id = loopSampleOf[loop.sound.kind];

        if (!voice) {
          const sample = bank.get(id);

          if (!sample) {
            continue;
          }

          const panner = ctx.createStereoPanner();
          panner.connect(mixer.sfx);
          voice = {
            panner,
            sound: heldVoice(ctx, sample, panner, settings),
          };
          held.set(loop.key, voice);
        }

        const { gain, pan } = placement(
          loop.at,
          loop.opponent,
          listener,
          settings.spatial
        );

        voice.panner.pan.setTargetAtTime(
          pan,
          ctx.currentTime,
          settings.loopGlide
        );
        voice.sound.set(
          loop.sound,
          gain * (volumes.get(id) ?? 1),
          settings.loopGlide
        );
      }
    },
    mixer,
    music,
    play,
  };
};

type Engine = ReturnType<typeof createEngine>;

const position = new Vector3();
const forward = new Vector3();

const listenerOf = (camera: Object3D): Listener => {
  camera.getWorldPosition(position);
  camera.getWorldDirection(forward);

  return {
    forward: { x: forward.x, y: forward.y, z: forward.z },
    position: { x: position.x, y: position.y, z: position.z },
  };
};

export interface DuelAudioOptions {
  /** The ears: sounds are placed relative to it. */
  readonly camera: Object3D;
  readonly localId: DuelistId;
  /** Told whether a click is still needed to turn the sound on. */
  readonly hint: ActivationHint;
  readonly settings: Tuning;
}

export const createDuelAudio = ({
  camera,
  hint,
  localId,
  settings,
}: DuelAudioOptions): DuelAudio => {
  let engine: Engine | undefined;
  let volumes: Volumes = { effects: 1, music: 1 };
  /** The snapshot the last live frame ended on; null while the Duel is not being played. */
  let before: DuelSnapshot | null = null;

  const running = () => engine?.ctx.state === "running";

  hint.report("sound", true);

  const unlock = () => {
    if (!engine) {
      const ctx = new AudioContext({ latencyHint: "interactive" });
      engine = createEngine(ctx, settings.audio, volumes);
      ctx.addEventListener("statechange", () => {
        hint.report("sound", !running());
      });
    }

    void engine.ctx.resume();
  };

  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);

  return {
    frame: ({ events, live, screen, snapshot }) => {
      const prior = live ? before : null;
      before = live ? snapshot : null;

      if (!engine || !running()) {
        return;
      }

      engine.music.update(musicFor(screen));
      const listener = listenerOf(camera);

      if (!live) {
        engine.hold([], listener);

        return;
      }

      for (const cue of cuesFor({
        after: snapshot,
        before: prior,
        events,
        localId,
        settings,
      })) {
        const { gain, pan } = placement(
          cue.at,
          cue.opponent,
          listener,
          settings.audio.spatial
        );

        engine.play(sampleFor(cue.sound, settings.audio), gain, pan);
      }

      engine.hold(loopsFor(snapshot, localId, settings), listener);
    },
    menu: (sound) => {
      if (engine && running()) {
        engine.play(menuSampleFor(sound), 1, 0);
      }
    },
    volumes: (next) => {
      volumes = next;
      engine?.mixer.volumes(next, settings.audio.volumeGlide);
    },
  };
};
