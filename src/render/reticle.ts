/**
 * The aiming mark: one circle, as DOM over the canvas, always the same ring.
 * Unlocked it sits at the screen centre, where free-aimed Spells go, with a
 * tiny dot at its heart, and its radius marks exactly the Aim Assist
 * boundary: a cast bends toward a rival only when their body reaches into
 * the circle. That radius follows from the Aim Assist angle, the camera's
 * field of view and the canvas height, so it is recomputed on resize. Locked
 * On, the same circle rides onto the Target's chest at the size of the old
 * lock ring (the same on screen at any distance) and fades while the Target
 * is out of sight behind Cover. Locking and unlocking slide it between the
 * two on the camera's own transition progress, so it never jumps, and the
 * ring blends from a neutral light to gold on that same progress.
 */
import { Vector3 } from "three/webgpu";
import type { PerspectiveCamera } from "three/webgpu";

import type { Point3 } from "../duel/geometry";
import { offAxisPixels } from "./crosshair-size";

export interface ReticleView {
  /** Shows the reticle at all (a Duel is on and no Knockout shot). */
  readonly visible: boolean;
  /**
   * The Target's chest and whether it is out of sight: while Locked On, and
   * while the circle is still easing back to the centre after the lock ends.
   */
  readonly target?: { readonly at: Point3; readonly hidden: boolean };
  /** The camera's transition progress: 0 free, 1 Locked On (smoothstep). */
  readonly lockShare: number;
}

/** Diameter of the circle on a Target, in pixels. */
const lockedSize = 46;

const mix = (from: number, to: number, share: number) =>
  from + (to - from) * share;

export const createReticle = (
  ring: HTMLElement,
  /** The Aim Assist angle (radians) whose circle the free reticle draws. */
  assistAngle: number
) => {
  const projected = new Vector3();

  const dot = document.createElement("span");
  dot.className = "reticle-dot";
  ring.append(dot);

  return {
    show: (view: ReticleView, camera: PerspectiveCamera) => {
      ring.hidden = !view.visible;

      if (!view.visible) {
        return;
      }

      const { lockShare, target } = view;

      const freeSize =
        2 * offAxisPixels(assistAngle, camera.fov, window.innerHeight);

      let x = window.innerWidth / 2;
      let y = window.innerHeight / 2;
      let offscreen = false;

      if (target && lockShare > 0) {
        projected.set(target.at.x, target.at.y, target.at.z).project(camera);

        // Behind the camera, or outside the view: hide once fully locked
        // rather than mirror it, and pin to the edge while still easing.
        offscreen =
          projected.z >= 1 ||
          Math.abs(projected.x) > 1 ||
          Math.abs(projected.y) > 1;

        const ndcX = Math.max(-1, Math.min(1, projected.x));
        const ndcY = Math.max(-1, Math.min(1, projected.y));

        x = mix(x, ((ndcX + 1) / 2) * window.innerWidth, lockShare);
        y = mix(y, ((1 - ndcY) / 2) * window.innerHeight, lockShare);
      }

      ring.hidden = offscreen && lockShare >= 1;
      ring.classList.toggle("reticle-hidden", target?.hidden === true);
      ring.style.setProperty(
        "--size",
        `${mix(freeSize, lockedSize, lockShare).toFixed(2)}px`
      );
      ring.style.setProperty("--dot", (1 - lockShare).toFixed(3));
      ring.style.setProperty("--lock", lockShare.toFixed(3));
      ring.style.left = `${x.toFixed(2)}px`;
      ring.style.top = `${y.toFixed(2)}px`;
    },
  };
};
