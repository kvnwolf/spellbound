/**
 * The reticle: a DOM mark placed where the local Duelist's aim point lands on
 * screen, so the right stick's nudge around the Target is visible.
 */
import { Vector3 } from "three/webgpu";
import type { Camera } from "three/webgpu";

import type { Point3 } from "../duel/geometry";

export const createReticle = (element: HTMLElement) => {
  const projected = new Vector3();

  return {
    show: (aimPoint: Point3, camera: Camera) => {
      projected.set(aimPoint.x, aimPoint.y, aimPoint.z).project(camera);

      // Behind the camera, or outside the view: hide rather than mirror it.
      const visible =
        projected.z < 1 &&
        Math.abs(projected.x) <= 1 &&
        Math.abs(projected.y) <= 1;

      element.hidden = !visible;
      element.style.left = `${((projected.x + 1) / 2) * 100}%`;
      element.style.top = `${((1 - projected.y) / 2) * 100}%`;
    },
  };
};
