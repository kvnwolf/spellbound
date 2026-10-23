import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
/**
 * The rigged wizard (`public/models/wizard.glb`, built by
 * `scripts/build-models.ts` from the CC0 Quaternius packs), loaded once and
 * prepared for every Duelist that wears it:
 *
 * - each clip split into an upper-body half (the spine up: arms, head) and
 *   a lower-body half (the pelvis and legs), so the view can walk with one
 *   clip while casting with another;
 * - each locomotion clip measured on this very skeleton: how far the body
 *   travels over one cycle (from the planted foot sliding back under it),
 *   so the view advances it by the ground actually covered and the feet do
 *   not slide, where in the cycle the left foot is furthest ahead, so
 *   cycles of different clips blend in step, and the pelvis's mean height,
 *   about which the view damps the clip's bounce;
 * - the right hand's fist (`Grip`), as local rotations per finger joint.
 *
 * Geometry and animation are Meshopt-compressed; the decoder runs on the
 * CPU at load, so it works with any renderer.
 */
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import {
  AnimationClip,
  AnimationMixer,
  Quaternion,
  Vector3,
} from "three/webgpu";
import type { Object3D } from "three/webgpu";

/** The joints the lower-body half of a clip drives; every other joint is upper body. */
const lowerJoints = new Set([
  "pelvis",
  "thigh_l",
  "calf_l",
  "foot_l",
  "ball_l",
  "thigh_r",
  "calf_r",
  "foot_r",
  "ball_r",
]);

/** The locomotion clips, from standing to sprinting. */
export const locomotionClips = [
  "Walk_Loop",
  "Jog_Fwd_Loop",
  "Sprint_Loop",
] as const;

export type LocomotionClip = (typeof locomotionClips)[number];

export interface ClipHalves {
  readonly duration: number;
  readonly upper: AnimationClip;
  readonly lower: AnimationClip;
}

/** One locomotion cycle as measured on the skeleton. */
export interface Stride {
  /** Metres the body travels over one cycle. */
  readonly cycle: number;
  /** The cycle's share (0 to 1) at which the left foot is furthest ahead. */
  readonly offset: number;
  /** The pelvis's mean height over the cycle, metres above the feet's floor. */
  readonly pelvis: number;
}

export interface WizardAssets {
  /** The rigged model as loaded; each Duelist wears a `SkeletonUtils.clone` of it. */
  readonly template: Object3D;
  readonly clips: ReadonlyMap<string, ClipHalves>;
  readonly strides: Readonly<Record<LocomotionClip, Stride>>;
  /** The fist round the Wand: local rotations by finger joint name. */
  readonly grip: ReadonlyMap<string, Quaternion>;
}

const jointOf = (trackName: string) =>
  trackName.slice(0, trackName.lastIndexOf("."));

const split = (clip: AnimationClip): ClipHalves => {
  const half = (lower: boolean) =>
    new AnimationClip(
      `${clip.name}.${lower ? "lower" : "upper"}`,
      clip.duration,
      clip.tracks.filter(
        (track) => lowerJoints.has(jointOf(track.name)) === lower
      )
    );

  return { duration: clip.duration, lower: half(true), upper: half(false) };
};

/**
 * Plays `clip` on a copy of the model and measures one cycle: the planted
 * foot (the lowest, within a few centimetres of the floor) slides back
 * under the body at the speed the body travels.
 */
const measure = (template: Object3D, clip: AnimationClip): Stride => {
  const body = clone(template);
  const mixer = new AnimationMixer(body);
  mixer.clipAction(clip).play();

  const feet = ["ball_l", "ball_r"].map((name) => body.getObjectByName(name));
  const hips = body.getObjectByName("pelvis");
  let pelvis = 0;
  const samples = 60;
  const step = clip.duration / samples;
  const at = new Vector3();
  const track: { y: number; z: number }[][] = [[], []];

  for (let index = 0; index < samples; index += 1) {
    mixer.setTime(index * step);
    body.updateMatrixWorld(true);

    for (const [side, foot] of feet.entries()) {
      foot?.getWorldPosition(at);
      track[side]?.push({ y: at.y, z: at.z });
    }

    hips?.getWorldPosition(at);
    pelvis += at.y / samples;
  }

  let distance = 0;
  let time = 0;

  for (const foot of track) {
    const lowest = Math.min(...foot.map((sample) => sample.y));

    for (let index = 0; index + 1 < foot.length; index += 1) {
      const sample = foot[index];
      const next = foot[index + 1];

      if (
        sample &&
        next &&
        sample.y < lowest + 0.03 &&
        next.y < lowest + 0.03
      ) {
        distance += sample.z - next.z;
        time += step;
      }
    }
  }

  const speed = time > 0 ? distance / time : 1;
  const left = track[0] ?? [];
  let ahead = 0;

  for (const [index, sample] of left.entries()) {
    if ((left[ahead]?.z ?? 0) < sample.z) {
      ahead = index;
    }
  }

  return { cycle: speed * clip.duration, offset: ahead / samples, pelvis };
};

/** Loads the wizard from `url`, telling `onProgress` the share (0 to 1) of its bytes downloaded so far. */
export const loadWizardAssets = async (
  url: string,
  onProgress?: (share: number) => void
): Promise<WizardAssets> => {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

  const gltf = await loader.loadAsync(url, (event) => {
    if (event.lengthComputable && event.total > 0) {
      onProgress?.(event.loaded / event.total);
    }
  });

  onProgress?.(1);
  const template = gltf.scene;
  const clips = new Map<string, ClipHalves>();
  const grip = new Map<string, Quaternion>();

  for (const clip of gltf.animations) {
    if (clip.name === "Grip") {
      for (const track of clip.tracks) {
        const [x = 0, y = 0, z = 0, w = 1] = track.values;
        grip.set(jointOf(track.name), new Quaternion(x, y, z, w));
      }
    } else {
      clips.set(clip.name, split(clip));
    }
  }

  const strideOf = (name: LocomotionClip) => {
    const clip = gltf.animations.find((each) => each.name === name);

    if (!clip) {
      throw new Error(`The wizard has no ${name} clip`);
    }

    return measure(template, clip);
  };

  return {
    clips,
    grip,
    strides: {
      Jog_Fwd_Loop: strideOf("Jog_Fwd_Loop"),
      Sprint_Loop: strideOf("Sprint_Loop"),
      Walk_Loop: strideOf("Walk_Loop"),
    },
    template,
  };
};
