/**
 * Presentation samples between two fixed simulation ticks. Rendering runs at
 * display rate, so each frame blends the previous and current snapshots by
 * how far the clock is into the next tick (`alpha` in [0, 1]).
 */
import type { DuelistState } from "../duel/duel";
import type { GroundPoint, Point3 } from "../duel/geometry";

/** Where a Duelist should be drawn this frame. */
export interface DuelistSample {
  readonly position: GroundPoint;
  readonly facing: GroundPoint;
  readonly aimPoint: Point3;
}

const lerp = (from: number, to: number, alpha: number) =>
  from + (to - from) * alpha;

/** Blends facings and renormalises, which stays well-behaved for a tick's worth of turn. */
const blendDirection = (
  from: GroundPoint,
  to: GroundPoint,
  alpha: number
): GroundPoint => {
  const x = lerp(from.x, to.x, alpha);
  const z = lerp(from.z, to.z, alpha);
  const length = Math.hypot(x, z);

  return length < 1e-6 ? to : { x: x / length, z: z / length };
};

export const sampleDuelist = (
  previous: DuelistState,
  current: DuelistState,
  alpha: number
): DuelistSample => ({
  aimPoint: {
    x: lerp(previous.aimPoint.x, current.aimPoint.x, alpha),
    y: lerp(previous.aimPoint.y, current.aimPoint.y, alpha),
    z: lerp(previous.aimPoint.z, current.aimPoint.z, alpha),
  },
  facing: blendDirection(previous.facing, current.facing, alpha),
  position: {
    x: lerp(previous.position.x, current.position.x, alpha),
    z: lerp(previous.position.z, current.position.z, alpha),
  },
});
