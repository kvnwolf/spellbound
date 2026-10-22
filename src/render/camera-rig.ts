/**
 * The over-the-shoulder camera: it sits behind the local Duelist, on the far
 * side from their Target, offset over the right shoulder, and looks at a point
 * between the two so both stay framed. It is the only writer of the camera.
 * It follows interpolated presentation samples, with frame-rate-independent
 * exponential smoothing so swings around the Target stay soft.
 */
import { PerspectiveCamera, Vector3 } from "three/webgpu";

import { direction, rightOf } from "../duel/geometry";
import type { GroundPoint } from "../duel/geometry";
import type { Tuning } from "../tuning";

export interface CameraRig {
  readonly camera: PerspectiveCamera;
  /** Moves the camera toward framing `self` and `target`, `seconds` after the last frame. */
  readonly follow: (
    self: { readonly position: GroundPoint; readonly facing: GroundPoint },
    target: GroundPoint | undefined,
    seconds: number
  ) => void;
  readonly resize: (aspect: number) => void;
}

export const createCameraRig = (
  settings: Tuning["camera"],
  chestHeight: number
): CameraRig => {
  const camera = new PerspectiveCamera(settings.fov, 1, 0.1, 200);
  const position = new Vector3();
  const focus = new Vector3();
  const wantedPosition = new Vector3();
  const wantedFocus = new Vector3();
  let placed = false;

  return {
    camera,
    follow: (self, target, seconds) => {
      const forward = target ? direction(self.position, target) : self.facing;
      const right = rightOf(forward);
      // Behind the Duelist, away from the Target, and over the right shoulder.
      wantedPosition.set(
        self.position.x -
          forward.x * settings.distance +
          right.x * settings.shoulder,
        settings.height,
        self.position.z -
          forward.z * settings.distance +
          right.z * settings.shoulder
      );

      // Look between the Duelist and the Target (or straight ahead without one).
      const ahead = target ?? {
        x: self.position.x + forward.x * settings.distance,
        z: self.position.z + forward.z * settings.distance,
      };

      wantedFocus.set(
        self.position.x + (ahead.x - self.position.x) * settings.focusBias,
        chestHeight,
        self.position.z + (ahead.z - self.position.z) * settings.focusBias
      );

      if (placed) {
        const blend = 1 - Math.exp(-settings.followSharpness * seconds);
        position.lerp(wantedPosition, blend);
        focus.lerp(wantedFocus, blend);
      } else {
        // First frame: cut straight to the framing instead of sweeping in.
        position.copy(wantedPosition);
        focus.copy(wantedFocus);
        placed = true;
      }

      camera.position.copy(position);
      camera.lookAt(focus);
    },
    resize: (aspect) => {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    },
  };
};
