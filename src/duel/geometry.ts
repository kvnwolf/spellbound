/**
 * Small ground-plane math shared by the simulation and the views. World axes
 * are three.js's: x right, y up, z toward the viewer, so "down the Arena" is -z.
 */

/** A point or direction on the Arena floor. */
export interface GroundPoint {
  readonly x: number;
  readonly z: number;
}

export interface Point3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** The facing of a Duelist with nowhere in particular to look: down the Arena. */
export const defaultForward: GroundPoint = { x: 0, z: -1 };

export const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export const distanceBetween = (a: GroundPoint, b: GroundPoint) =>
  Math.hypot(b.x - a.x, b.z - a.z);

/** Unit vector from `from` to `to`, or the default facing when they coincide. */
export const direction = (from: GroundPoint, to: GroundPoint): GroundPoint => {
  const length = distanceBetween(from, to);

  return length === 0
    ? defaultForward
    : { x: (to.x - from.x) / length, z: (to.z - from.z) / length };
};

/** The direction to the right of someone facing `forward`, with y up. */
export const rightOf = (forward: GroundPoint): GroundPoint => ({
  x: -forward.z,
  z: forward.x,
});
