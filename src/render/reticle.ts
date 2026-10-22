/**
 * The aiming mark: one circle, as DOM over the canvas, always at the screen
 * centre where free-aimed Spells go, with a tiny dot at its heart. Its radius
 * marks exactly the Aim Assist boundary: a cast bends toward a rival only
 * when their body reaches into the circle. That radius follows from the Aim
 * Assist angle, the camera's field of view and the canvas height, so it is
 * recomputed on resize. Locking On fades it out over its own short, eased
 * fade, independent of the camera's transition (the Target's gold rim glow
 * takes over as the mark), and unlocking or a broken lock fades it back in.
 */
import type { PerspectiveCamera } from "three/webgpu";

import { offAxisPixels } from "./crosshair-size";

export interface ReticleView {
  /** Shows the reticle at all (a Duel is on and no Knockout shot). */
  readonly visible: boolean;
  /** The local Duelist is Locked On: the reticle fades out, otherwise back in. */
  readonly locked: boolean;
}

const smoothstep = (x: number) => x * x * (3 - 2 * x);

export const createReticle = (
  ring: HTMLElement,
  /** The Aim Assist angle (radians) whose circle the reticle draws. */
  assistAngle: number,
  /** How long the reticle takes to fade fully out or back in. */
  fadeSeconds: number
) => {
  const dot = document.createElement("span");
  dot.className = "reticle-dot";
  ring.append(dot);

  /** Fade progress, linear in time: 1 fully shown, 0 gone. Eased only on its way to the screen. */
  let shown = 1;

  return {
    show: (
      view: ReticleView,
      camera: PerspectiveCamera,
      /** Frame time, so the fade does not depend on the frame rate. */
      seconds: number
    ) => {
      ring.hidden = !view.visible;

      if (!view.visible) {
        return;
      }

      const size =
        2 * offAxisPixels(assistAngle, camera.fov, window.innerHeight);

      ring.style.setProperty("--size", `${size.toFixed(2)}px`);

      const step = seconds / fadeSeconds;

      shown = view.locked
        ? Math.max(0, shown - step)
        : Math.min(1, shown + step);
      ring.style.opacity = smoothstep(shown).toFixed(3);
    },
  };
};
