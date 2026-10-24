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

/** The number `share` of the way from `from` to `to` (0 is `from`, 1 is `to`). */
export const lerp = (from: number, to: number, share: number) =>
  from + (to - from) * share;

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

/**
 * A look direction as two angles, in radians. Yaw 0 looks down the Arena
 * (-z) and grows turning right (toward +x); pitch 0 is level and grows
 * looking up. Also used for turn rates (radians per second).
 */
export interface Aim {
  readonly yaw: number;
  readonly pitch: number;
}

/** `angle` wrapped into [-PI, PI]. */
export const wrapAngle = (angle: number) =>
  angle - Math.PI * 2 * Math.round(angle / (Math.PI * 2));

/** The ground direction a yaw looks along. */
export const forwardOf = (yaw: number): GroundPoint => ({
  x: Math.sin(yaw),
  z: -Math.cos(yaw),
});

/** The yaw that looks along a ground direction. */
export const yawOf = (heading: GroundPoint) =>
  Math.atan2(heading.x, -heading.z);

/** The unit 3D direction an Aim looks along. */
export const directionOf = (aim: Aim): Point3 => ({
  x: Math.cos(aim.pitch) * Math.sin(aim.yaw),
  y: Math.sin(aim.pitch),
  z: -Math.cos(aim.pitch) * Math.cos(aim.yaw),
});

export const unit3 = (vector: Point3): Point3 => {
  const length = Math.hypot(vector.x, vector.y, vector.z);

  return length === 0
    ? { x: 0, y: 0, z: -1 }
    : { x: vector.x / length, y: vector.y / length, z: vector.z / length };
};

const dot3 = (a: Point3, b: Point3) => a.x * b.x + a.y * b.y + a.z * b.z;

/** The angle between two unit vectors, in radians. */
export const angleBetween = (a: Point3, b: Point3) =>
  Math.acos(clamp(dot3(a, b), -1, 1));

/**
 * Turns the unit vector `from` toward the unit vector `to` by at most
 * `maxAngle` radians, along the great circle between them.
 */
export const rotateToward = (
  from: Point3,
  to: Point3,
  maxAngle: number
): Point3 => {
  const angle = angleBetween(from, to);

  if (angle <= maxAngle || angle < 1e-9) {
    return angle <= maxAngle ? to : from;
  }

  // Spherical interpolation by the fraction of the angle allowed.
  const share = maxAngle / angle;
  const sine = Math.sin(angle);
  const keep = Math.sin((1 - share) * angle) / sine;
  const take = Math.sin(share * angle) / sine;

  return unit3({
    x: from.x * keep + to.x * take,
    y: from.y * keep + to.y * take,
    z: from.z * keep + to.z * take,
  });
};

/**
 * One step of a critically damped spring (Holden's, exact for any `step`)
 * drawing `value`, moving at `rate`, toward `goal` with half its gap closed
 * every `halflife` seconds: no overshoot, and no jolt in `rate` when the
 * goal jumps. Returns the new value and rate.
 */
export const springStep = (
  value: number,
  rate: number,
  goal: number,
  halflife: number,
  step: number
) => {
  const damping = (2 * Math.LN2) / halflife;
  const gap = value - goal;
  const drift = rate + gap * damping;
  const decay = Math.exp(-damping * step);

  return {
    rate: decay * (rate - drift * damping * step),
    value: decay * (gap + drift * step) + goal,
  };
};
