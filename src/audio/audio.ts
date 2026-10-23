/**
 * The Duel's sound: a WebAudio engine that plays what `cues.ts` decides for
 * each frame (one-shot sounds for events, held sounds for Charge, Shield and
 * Burn), placed by `spatial.ts` relative to the camera, plus the menus'
 * sounds. Everything is synthesised (`synth.ts`).
 *
 * The mix: the Duel's sounds go through the `sfx` bus, with a synthesised
 * stone-courtyard reverb; countdown, stingers, Lock-on ticks and menus
 * through the dry `ui` bus. Both meet in the master volume, then a
 * compressor and a soft clip under a fixed ceiling, so peaks stay under
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
import type { Screen, ScreenEvent } from "../screens/screens";
import type { Tuning } from "../tuning";
import { cuesFor, loopsFor, menuSoundFor } from "./cues";
import type { Cue, Loop, Sound } from "./cues";
import { placement } from "./spatial";
import type { Listener } from "./spatial";
import { createSynth, hold, play, playMenu } from "./synth";
import type { HeldSound, Synth } from "./synth";

type AudioSettings = Tuning["audio"];

/** One frame of the game, as far as the sound cares. */
export interface AudioFrame {
  /** The Duel's events since the last frame. */
  readonly events: readonly DuelEvent[];
  readonly snapshot: DuelSnapshot;
  /** The Duel is being played: not behind a menu, the pause or the title. Held sounds fall silent otherwise. */
  readonly live: boolean;
}

export interface DuelAudio {
  readonly frame: (frame: AudioFrame) => void;
  /** A menu event took the screens from `before` to `after`. */
  readonly menu: (before: Screen, after: Screen, event: ScreenEvent) => void;
}

/** Sounds that are the HUD's rather than the courtyard's: dry, on the `ui` bus. */
const uiSounds: ReadonlySet<Sound["kind"]> = new Set([
  "countdown",
  "duel-end",
  "duel-start",
  "lock-off",
  "lock-on",
  "round-end",
  "stamina-short",
]);

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

/** The buses, the reverb and the master chain down to the speakers. */
const createMixer = (ctx: AudioContext, settings: AudioSettings) => {
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

  const sfx = gainNode(ctx, settings.buses.sfx);
  const ui = gainNode(ctx, settings.buses.ui);
  const reverb = ctx.createConvolver();
  reverb.buffer = impulseOf(ctx, settings.reverb);
  sfx.connect(master);
  sfx
    .connect(gainNode(ctx, settings.reverb.send))
    .connect(reverb)
    .connect(master);
  ui.connect(master);

  return { sfx, ui };
};

interface HeldVoice {
  readonly sound: HeldSound;
  readonly panner: StereoPannerNode;
}

/** The running engine, once a gesture has let the AudioContext start. */
const createEngine = (ctx: AudioContext, settings: AudioSettings) => {
  const synth: Synth = createSynth(ctx);
  const mixer = createMixer(ctx, settings);
  const held = new Map<string, HeldVoice>();
  let voices = 0;

  /** A one-shot voice's own volume and pan, into `bus`; freed once its sound has died away. */
  const voiceInto = (bus: AudioNode, gain: number, pan: number) => {
    const level = gainNode(ctx, gain);
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    level.connect(panner).connect(bus);
    voices += 1;

    return {
      input: level,
      releaseAfter: (end: number) => {
        const seconds = Math.max(end - ctx.currentTime, 0) + 0.1;

        setTimeout(() => {
          panner.disconnect();
          voices -= 1;
        }, seconds * 1000);
      },
    };
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

        if (!voice) {
          const panner = ctx.createStereoPanner();
          panner.connect(mixer.sfx);
          voice = { panner, sound: hold(synth, panner, loop.sound.kind) };
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
          gain * settings.volumes[loop.sound.kind],
          settings.loopGlide
        );
      }
    },
    play: (cue: Cue, listener: Listener) => {
      if (voices >= settings.maxVoices) {
        return;
      }

      const { gain, pan } = placement(
        cue.at,
        cue.opponent,
        listener,
        settings.spatial
      );

      const bus = uiSounds.has(cue.sound.kind) ? mixer.ui : mixer.sfx;

      const voice = voiceInto(
        bus,
        gain * settings.volumes[cue.sound.kind],
        pan
      );

      voice.releaseAfter(play(synth, voice.input, cue.sound));
    },
    playMenu: (sound: Parameters<typeof playMenu>[2]) => {
      if (voices >= settings.maxVoices) {
        return;
      }

      const voice = voiceInto(mixer.ui, settings.volumes[sound.kind], 0);
      voice.releaseAfter(playMenu(synth, voice.input, sound));
    },
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
  /** The snapshot the last live frame ended on; null while the Duel is not being played. */
  let before: DuelSnapshot | null = null;

  const running = () => engine?.ctx.state === "running";

  hint.report("sound", true);

  const unlock = () => {
    if (!engine) {
      const ctx = new AudioContext({ latencyHint: "interactive" });
      engine = createEngine(ctx, settings.audio);
      ctx.addEventListener("statechange", () => {
        hint.report("sound", !running());
      });
    }

    void engine.ctx.resume();
  };

  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);

  return {
    frame: ({ events, live, snapshot }) => {
      const prior = live ? before : null;
      before = live ? snapshot : null;

      if (!engine || !running()) {
        return;
      }

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
        engine.play(cue, listener);
      }

      engine.hold(loopsFor(snapshot, localId, settings), listener);
    },
    menu: (from, to, event) => {
      const sound = menuSoundFor(from, to, event);

      if (sound && engine && running()) {
        engine.playMenu(sound);
      }
    },
  };
};
