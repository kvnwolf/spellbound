/**
 * The aiming mark: one circle, as DOM over the canvas, always at the screen
 * centre where free-aimed Spells go, with a tiny dot at its heart. Its radius
 * marks exactly the Aim Assist boundary: a cast bends toward a rival only
 * when their body reaches into the circle. That radius follows from the Aim
 * Assist angle, the camera's field of view and the canvas height, so it is
 * recomputed on resize. Locking On fades it out on the camera's own
 * transition progress (the Target's gold rim glow takes over as the mark),
 * and unlocking fades it back in.
 */
import type { PerspectiveCamera } from "three/webgpu";

import { offAxisPixels } from "./crosshair-size";

export interface ReticleView {
  /** Shows the reticle at all (a Duel is on and no Knockout shot). */
  readonly visible: boolean;
  /** The camera's transition progress: 0 free, 1 Locked On (smoothstep). */
  readonly lockShare: number;
}

export const createReticle = (
  ring: HTMLElement,
  /** The Aim Assist angle (radians) whose circle the reticle draws. */
  assistAngle: number
) => {
  const dot = document.createElement("span");
  dot.className = "reticle-dot";
  ring.append(dot);

  return {
    show: (view: ReticleView, camera: PerspectiveCamera) => {
      ring.hidden = !view.visible;

      if (!view.visible) {
        return;
      }

      const size =
        2 * offAxisPixels(assistAngle, camera.fov, window.innerHeight);

      ring.style.setProperty("--size", `${size.toFixed(2)}px`);
      ring.style.opacity = (1 - view.lockShare).toFixed(3);
    },
  };
};
