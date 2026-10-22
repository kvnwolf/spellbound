/**
 * The aiming marks, as DOM over the canvas. The crosshair is a dot fixed at
 * the screen centre (by CSS), where free-aimed Spells go. The Lock-on ring
 * sits on the Target's chest, the same size on screen at any distance, and
 * fades while the Target is out of sight behind Cover.
 */
import { Vector3 } from "three/webgpu";
import type { Camera } from "three/webgpu";

import type { Point3 } from "../duel/geometry";

export interface ReticleView {
  /** Shows the crosshair. */
  readonly crosshair: boolean;
  /** The Lock-on Target's chest and whether it is out of sight, while Locked On. */
  readonly lockRing?: { readonly at: Point3; readonly hidden: boolean };
}

export const createReticle = (crosshair: HTMLElement) => {
  const projected = new Vector3();
  const ring = document.createElement("div");
  ring.className = "lock-ring";
  ring.hidden = true;
  crosshair.after(ring);

  return {
    show: (view: ReticleView, camera: Camera) => {
      crosshair.hidden = !view.crosshair;

      if (!view.lockRing) {
        ring.hidden = true;

        return;
      }

      const { at, hidden } = view.lockRing;
      projected.set(at.x, at.y, at.z).project(camera);

      // Behind the camera, or outside the view: hide rather than mirror it.
      ring.hidden =
        projected.z >= 1 ||
        Math.abs(projected.x) > 1 ||
        Math.abs(projected.y) > 1;
      ring.classList.toggle("lock-ring-hidden", hidden);
      ring.style.left = `${((projected.x + 1) / 2) * 100}%`;
      ring.style.top = `${((1 - projected.y) / 2) * 100}%`;
    },
  };
};
