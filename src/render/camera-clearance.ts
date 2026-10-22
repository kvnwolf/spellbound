/**
 * Keeps the camera out of Arena geometry. Pure ground-plane math with no
 * three.js. The rig asks `chooseSwing` how far to swing round the Duelist (0
 * when the way is open), eases that angle itself so the swing never pops, and
 * places the camera with `swingCameraOffset`, which always lands inside the
 * walls with no column between the camera and the Duelist.
 */
import type { ArenaLayout } from "../duel/duel";
import type { GroundPoint } from "../duel/geometry";
import type { Tuning } from "../tuning";

type Clearance = Tuning["camera"]["clearance"];

/**
 * How far from `origin` the camera can go along the unit vector `heading`
 * before it would leave the walls or touch a column, each kept `margin` away.
 * `origin` is a Duelist, whose body is wider than `margin`, so it always
 * starts in the clear.
 */
const clearDistance = (
  origin: GroundPoint,
  heading: GroundPoint,
  arena: ArenaLayout,
  margin: number,
  feather: number
) => {
  let clear = Number.POSITIVE_INFINITY;

  // Longer than any ray inside the Arena can be.
  const farthest = 2 * (arena.bounds.halfWidth + arena.bounds.halfDepth);

  // Walls: the first of the four inner edges the ray reaches.
  const reachX = arena.bounds.halfWidth - margin;
  const reachZ = arena.bounds.halfDepth - margin;

  if (heading.x !== 0) {
    clear = Math.min(
      clear,
      ((heading.x > 0 ? reachX : -reachX) - origin.x) / heading.x
    );
  }

  if (heading.z !== 0) {
    clear = Math.min(
      clear,
      ((heading.z > 0 ? reachZ : -reachZ) - origin.z) / heading.z
    );
  }

  // Columns: the near intersection of the ray with each column's inflated disc.
  for (const column of arena.cover) {
    const toColumnX = column.center.x - origin.x;
    const toColumnZ = column.center.z - origin.z;
    const along = toColumnX * heading.x + toColumnZ * heading.z;
    const radius = column.radius + margin;
    const missSquared = toColumnX ** 2 + toColumnZ ** 2 - along ** 2;
    const depthSquared = radius ** 2 - missSquared;

    if (along > 0 && depthSquared > 0) {
      clear = Math.min(clear, along - Math.sqrt(depthSquared));
    } else if (along > 0) {
      // A near miss: the ray passes just outside the column. Rather than the
      // limit dropping away at once, it recovers over `feather` metres, so a
      // view sweeping across a column's edge changes gradually.
      const miss = Math.sqrt(missSquared) - radius;

      if (miss < feather) {
        clear = Math.min(clear, along + (miss / feather) * farthest);
      }
    }
  }

  return Math.max(clear, 0);
};

const unit = (vector: GroundPoint): GroundPoint => {
  const length = Math.hypot(vector.x, vector.z);

  return length === 0
    ? { x: 0, z: 1 }
    : { x: vector.x / length, z: vector.z / length };
};

const rotate = (vector: GroundPoint, angle: number): GroundPoint => ({
  x: vector.x * Math.cos(angle) + vector.z * Math.sin(angle),
  z: vector.z * Math.cos(angle) - vector.x * Math.sin(angle),
});

/**
 * How far to swing the camera round the Duelist (radians, signed) away from
 * the `wanted` offset (behind and over the shoulder), to find open ground when
 * Arena geometry is in the way. Each angle pays for the swing itself and for
 * the view it still loses (pulled in, or closer than `minDistance`), and the
 * cheapest wins: pinned against a wall it swings to the side instead of
 * squeezing in at the Duelist's back, while a column that only clips the view
 * costs a small swing.
 *
 * `previousSwing` is where the camera already is: once it has swung to one
 * side it stays on that side (it can come back to 0, but not jump across),
 * so a Duelist circling the Target never makes the camera flip sides.
 */
export const chooseSwing = (
  origin: GroundPoint,
  wanted: GroundPoint,
  arena: ArenaLayout,
  settings: Clearance,
  previousSwing: number
): number => {
  const length = Math.hypot(wanted.x, wanted.z);
  const locked = Math.abs(previousSwing) > settings.sideLock;
  const swings = Math.round(settings.maxSwing / settings.swingStep);
  let best = 0;
  let bestCost = Number.POSITIVE_INFINITY;

  for (let step = 0; step <= swings; step += 1) {
    for (const sign of step === 0 ? [1] : [1, -1]) {
      if (locked && sign !== Math.sign(previousSwing)) {
        continue;
      }

      const angle = sign * step * settings.swingStep;

      const arm = Math.min(
        length,
        clearDistance(
          origin,
          unit(rotate(wanted, angle)),
          arena,
          settings.margin,
          settings.columnFeather
        )
      );

      const cost =
        settings.swingCost * step * settings.swingStep +
        (length - arm) +
        settings.tooCloseCost * Math.max(settings.minDistance - arm, 0);

      if (cost < bestCost) {
        bestCost = cost;
        best = angle;
      }
    }
  }

  return best;
};

/**
 * The camera's offset from the Duelist: the `wanted` offset swung by `swing`
 * radians, pulled in as far as needed to stay clear of the Arena. Continuous
 * in `swing`, so an eased swing pulls the camera in and out smoothly.
 */
export const swingCameraOffset = (
  origin: GroundPoint,
  wanted: GroundPoint,
  swing: number,
  arena: ArenaLayout,
  settings: Clearance
): GroundPoint => {
  const heading = unit(rotate(wanted, swing));

  const arm = Math.min(
    Math.hypot(wanted.x, wanted.z),
    clearDistance(
      origin,
      heading,
      arena,
      settings.margin,
      settings.columnFeather
    )
  );

  return { x: heading.x * arm, z: heading.z * arm };
};
