/**
 * Camera shake on impacts, as "trauma": each hit adds trauma in [0, 1], which
 * decays steadily, and the shake felt is trauma squared, so small hits are a
 * tremor and big ones a jolt. Motion comes from summed sines at unrelated
 * frequencies: smooth and non-repeating, without a noise texture. It applies
 * a small offset and roll on top of the rig's framing each frame.
 */
import type { PerspectiveCamera } from "three/webgpu";

import type { Tuning } from "../tuning";

export interface CameraShake {
  /** Adds trauma, capped at 1. */
  readonly add: (trauma: number) => void;
  /** Shakes `camera` after the rig has placed it, `seconds` after the last frame. */
  readonly apply: (camera: PerspectiveCamera, seconds: number) => void;
}

/** Smooth pseudo-noise in [-1, 1] from three sines at unrelated rates. */
const wobble = (time: number, seed: number) =>
  (Math.sin(time * 1 + seed) +
    Math.sin(time * 2.31 + seed * 1.7) * 0.6 +
    Math.sin(time * 4.17 + seed * 2.9) * 0.3) /
  1.9;

export const createCameraShake = (
  settings: Tuning["cameraShake"]
): CameraShake => {
  let trauma = 0;
  let time = 0;

  return {
    add: (amount) => {
      trauma = Math.min(trauma + amount, 1);
    },
    apply: (camera, seconds) => {
      trauma = Math.max(trauma - settings.decay * seconds, 0);

      if (trauma === 0) {
        return;
      }

      time += seconds * settings.frequency;
      const shake = trauma * trauma;

      camera.translateX(wobble(time, 1) * settings.maxOffset * shake);
      camera.translateY(wobble(time, 7) * settings.maxOffset * shake);
      camera.rotateZ(wobble(time, 13) * settings.maxRoll * shake);
    },
  };
};
