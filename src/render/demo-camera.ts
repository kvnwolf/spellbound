/**
 * The camera of the lesson preview's live demo: a framed shot, the only
 * writer of its own PerspectiveCamera (the Duel's camera rig never touches
 * it, nor it the rig's). Each frame it is handed what it must keep in view
 * (the support points: each framed Duelist's feet, head and width, a loose
 * Wand) and the yaw it looks along, and solves the shot:
 *
 * - the distance that puts every point inside the safe frame at the base
 *   field of view: for each point, in the camera's basis, |right| <= safe *
 *   tan(half horizontal FOV) * depth, and the same vertically;
 * - the clearance: the camera backs off the subject only as far as the
 *   Arena lets it, short of the walls and of any column (or torch stand)
 *   between it and the subject, so nothing of the scenery cuts across the
 *   shot;
 * - the field of view, recomputed for the distance it actually stands at,
 *   widening past the base only when the clearance (or the easing) holds it
 *   closer than the fit wants, so every point stays in the safe frame.
 *
 * Centre, yaw and distance follow with a frame-rate independent halflife;
 * `cut` makes the next frame land exactly (a new loop or a new lesson), so
 * nothing swings across from the last shot.
 */
import { Matrix4, PerspectiveCamera, Vector3 } from "three/webgpu";

import type { ArenaLayout } from "../duel/duel";
import type { Point3 } from "../duel/geometry";
import type { Tuning } from "../tuning";

type DemoCameraSettings = Tuning["lessonDemo"]["camera"];

export interface DemoCamera {
  readonly camera: PerspectiveCamera;
  /** The panel's aspect, width over height. */
  readonly resize: (aspect: number) => void;
  /** The next frame lands exactly where it frames, instead of easing there. */
  readonly cut: () => void;
  /** Frames `support` looking along `yaw` (the Duel's yaw: 0 down -z, growing to the right), easing over `seconds`. */
  readonly frame: (
    support: readonly Point3[],
    yaw: number,
    seconds: number
  ) => void;
}

/** The scenery the camera keeps clear of: the Arena's walls, and columns as circles on the floor. */
export type DemoObstacles = Pick<ArenaLayout, "bounds" | "cover">;

const up = new Vector3(0, 1, 0);
const degrees = 180 / Math.PI;

/** `angle` wrapped into [-PI, PI]. */
const wrap = (angle: number) =>
  angle - Math.PI * 2 * Math.round(angle / (Math.PI * 2));

/**
 * How far along the floor from `from`, heading (dx, dz) (a unit vector),
 * before coming within `margin` of a wall or a column; Infinity if never.
 */
const clearRun = (
  from: { readonly x: number; readonly z: number },
  dx: number,
  dz: number,
  obstacles: DemoObstacles,
  margin: number
) => {
  const { halfDepth, halfWidth } = obstacles.bounds;
  let run = Number.POSITIVE_INFINITY;

  // The walls: where the run leaves the bounds, less the margin.
  if (dx !== 0) {
    run = Math.min(run, (Math.sign(dx) * halfWidth - from.x) / dx - margin);
  }

  if (dz !== 0) {
    run = Math.min(run, (Math.sign(dz) * halfDepth - from.z) / dz - margin);
  }

  // The columns: the first one the run passes within reach of.
  for (const { center, radius } of obstacles.cover) {
    const ox = center.x - from.x;
    const oz = center.z - from.z;
    const along = ox * dx + oz * dz;
    const reach = radius + margin;
    const aside2 = ox * ox + oz * oz - along * along;

    if (along > 0 && aside2 < reach * reach) {
      run = Math.min(run, along - Math.sqrt(reach * reach - aside2));
    }
  }

  return Math.max(run, 0);
};

export const createDemoCamera = (
  settings: DemoCameraSettings,
  obstacles: DemoObstacles
): DemoCamera => {
  const camera = new PerspectiveCamera(settings.fov, 16 / 9, 0.1, 200);
  const forward = new Vector3();
  const right = new Vector3();
  const upward = new Vector3();
  const back = new Vector3();
  const basis = new Matrix4();
  const offset = new Vector3();
  const mean = new Vector3();
  const wantedCentre = new Vector3();
  const centre = new Vector3();
  let distance = settings.minDistance;
  let yaw = 0;
  let cut = true;

  /** The camera's basis looking along `along` and pitched down. */
  const orient = (along: number) => {
    const { pitch } = settings;

    forward.set(
      Math.sin(along) * Math.cos(pitch),
      -Math.sin(pitch),
      -Math.cos(along) * Math.cos(pitch)
    );
    right.crossVectors(forward, up).normalize();
    upward.crossVectors(right, forward);
  };

  /** The distance from `from` that puts every point in the safe frame at the half-angle tangents given. */
  const fitDistance = (
    support: readonly Point3[],
    from: Vector3,
    tanH: number,
    tanV: number
  ) => {
    let fit = settings.minDistance;

    for (const point of support) {
      offset.set(point.x, point.y, point.z).sub(from);
      const depth = offset.dot(forward);

      fit = Math.max(
        fit,
        Math.abs(offset.dot(right)) / tanH - depth,
        Math.abs(offset.dot(upward)) / tanV - depth,
        camera.near * 4 - depth
      );
    }

    return fit;
  };

  /** Whether, from `away` back of `from`, a column stands between the camera and any point of `support`, on the floor plan. */
  const hidden = (support: readonly Point3[], from: Vector3, away: number) => {
    const cx = from.x - forward.x * away;
    const cz = from.z - forward.z * away;

    return support.some((point) => {
      const sx = point.x - cx;
      const sz = point.z - cz;
      const length = Math.hypot(sx, sz);

      return obstacles.cover.some(({ center, radius }) => {
        const ox = center.x - cx;
        const oz = center.z - cz;
        const along = (ox * sx + oz * sz) / length;
        const aside = Math.abs(ox * sz - oz * sx) / length;

        return (
          along > 0 && along < length && aside < radius + settings.clearance
        );
      });
    });
  };

  /** The vertical field of view, degrees, that fits every point in the safe frame from `away` back. */
  const fitFov = (support: readonly Point3[], away: number) => {
    let tanV = Math.tan(settings.fov / 2 / degrees);

    for (const point of support) {
      offset.set(point.x, point.y, point.z).sub(centre);
      const depth = Math.max(away + offset.dot(forward), camera.near * 4);

      tanV = Math.max(
        tanV,
        Math.abs(offset.dot(upward)) / depth / settings.safe,
        Math.abs(offset.dot(right)) / depth / settings.safe / camera.aspect
      );
    }

    return Math.min(2 * Math.atan(tanV) * degrees, settings.maxFov);
  };

  return {
    camera,
    cut: () => {
      cut = true;
    },
    frame: (support, wantedYaw, seconds) => {
      if (support.length === 0) {
        return;
      }

      // Ease toward the wanted shot by the halflife; a cut lands at once.
      const ease = cut ? 1 : 1 - 2 ** (-seconds / settings.halflife);
      yaw = cut ? wantedYaw : yaw + wrap(wantedYaw - yaw) * ease;
      orient(yaw);

      // The support's box across the frame, centred.
      let minA = Number.POSITIVE_INFINITY;
      let maxA = Number.NEGATIVE_INFINITY;
      let minB = Number.POSITIVE_INFINITY;
      let maxB = Number.NEGATIVE_INFINITY;
      mean.set(0, 0, 0);

      for (const point of support) {
        mean.add(offset.set(point.x, point.y, point.z));
      }

      mean.divideScalar(support.length);

      for (const point of support) {
        offset.set(point.x, point.y, point.z).sub(mean);
        const a = offset.dot(right);
        const b = offset.dot(upward);
        minA = Math.min(minA, a);
        maxA = Math.max(maxA, a);
        minB = Math.min(minB, b);
        maxB = Math.max(maxB, b);
      }

      wantedCentre
        .copy(mean)
        .addScaledVector(right, (minA + maxA) / 2)
        .addScaledVector(upward, (minB + maxB) / 2 + settings.lift);

      // The distance the base lens wants, held short of the scenery behind.
      const tanV = Math.tan(settings.fov / 2 / degrees) * settings.safe;

      const fit = fitDistance(
        support,
        wantedCentre,
        tanV * camera.aspect,
        tanV
      );

      const flat = Math.hypot(forward.x, forward.z);

      const clear =
        clearRun(
          wantedCentre,
          -forward.x / flat,
          -forward.z / flat,
          obstacles,
          settings.clearance
        ) / flat;

      // Closer still while a column stands between it and any point it frames.
      let wanted = Math.max(Math.min(fit, clear), camera.near * 4);

      while (
        wanted > settings.minDistance &&
        hidden(support, wantedCentre, wanted)
      ) {
        wanted -= settings.clearanceStep;
      }

      if (cut) {
        centre.copy(wantedCentre);
        distance = wanted;
      } else {
        centre.lerp(wantedCentre, ease);
        distance += (wanted - distance) * ease;
      }

      cut = false;

      // The lens for where it actually stands: the base, or wider if held close.
      const fov = fitFov(support, distance);

      if (fov !== camera.fov) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }

      camera.position.copy(centre).addScaledVector(forward, -distance);
      basis.makeBasis(right, upward, back.copy(forward).negate());
      camera.quaternion.setFromRotationMatrix(basis);
      camera.updateMatrixWorld();
    },
    resize: (aspect) => {
      if (Number.isFinite(aspect) && aspect > 0 && aspect !== camera.aspect) {
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
      }
    },
  };
};
