/**
 * The aiming marks, as DOM over the canvas. The crosshair is a cross with a
 * dot at its heart, fixed at the screen centre (by CSS), where free-aimed
 * Spells go. Its four arm tips sit exactly on the Aim Assist boundary: a cast
 * bends toward a rival only when their body reaches into the cross. The tip
 * distance follows from the Aim Assist angle, the camera's field of view and
 * the canvas height, so it is recomputed when the window resizes. The Lock-on ring
 * sits on the Target's chest, the same size on screen at any distance, and
 * fades while the Target is out of sight behind Cover.
 */
import { Vector3 } from "three/webgpu";
import type { PerspectiveCamera } from "three/webgpu";

import type { Point3 } from "../duel/geometry";
import { offAxisPixels } from "./crosshair-size";

export interface ReticleView {
  /** Shows the crosshair. */
  readonly crosshair: boolean;
  /** The Lock-on Target's chest and whether it is out of sight, while Locked On. */
  readonly lockRing?: { readonly at: Point3; readonly hidden: boolean };
}

/** The four arms of the cross, as a CSS class each. */
const arms = ["up", "right", "down", "left"] as const;

export const createReticle = (
  crosshair: HTMLElement,
  /** The Aim Assist angle (radians) the arm tips mark. */
  armAngle: number
) => {
  const projected = new Vector3();

  for (const arm of arms) {
    const element = document.createElement("span");
    element.className = `arm arm-${arm}`;
    crosshair.append(element);
  }

  let tipPixels = Number.NaN;

  const ring = document.createElement("div");
  ring.className = "lock-ring";
  ring.hidden = true;
  crosshair.after(ring);

  return {
    show: (view: ReticleView, camera: PerspectiveCamera) => {
      crosshair.hidden = !view.crosshair;

      const tip = offAxisPixels(armAngle, camera.fov, window.innerHeight);

      if (tip !== tipPixels) {
        tipPixels = tip;
        crosshair.style.setProperty("--tip", `${tip.toFixed(2)}px`);
      }

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
