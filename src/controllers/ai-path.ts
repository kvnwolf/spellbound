/**
 * Finding the way across the Arena floor for the AI: which way to walk now
 * to reach a spot by a short path around round obstacles (Cover, Obstructions,
 * other Duelists). Pure geometry: no three.js, no DOM.
 */
import { direction, distanceBetween, rightOf } from "../duel/geometry";
import type { GroundPoint } from "../duel/geometry";

/** Something round standing on the floor that a walking Duelist must go round. */
export interface RoundObstacle {
  readonly center: GroundPoint;
  readonly radius: number;
}

/** Which way to walk, and which side it goes round what is in the way (undefined with nothing in the way). */
export interface Way {
  readonly heading: GroundPoint;
  readonly side: -1 | 1 | undefined;
}

/** Where along the walk from `from` to `to` (metres) the line first comes within `radius` of `center`; null if it never does. */
const crossing = (
  from: GroundPoint,
  to: GroundPoint,
  { center, radius }: RoundObstacle
): number | null => {
  const length = distanceBetween(from, to);

  if (length === 0) {
    return null;
  }

  const dx = (to.x - from.x) / length;
  const dz = (to.z - from.z) / length;
  const along = (center.x - from.x) * dx + (center.z - from.z) * dz;

  const miss = Math.hypot(
    from.x + dx * along - center.x,
    from.z + dz * along - center.z
  );

  if (miss >= radius) {
    return null;
  }

  const entry = along - Math.sqrt(radius ** 2 - miss ** 2);

  // Behind the walker, or past the goal: not in the way.
  if (along < 0 || entry > length) {
    return null;
  }

  return Math.max(entry, 0);
};

/**
 * The unit direction to walk from `from` toward `to`, going round the
 * obstacles (each widened by `clearance`, the walker's own radius and some
 * room) on the shorter side of the first one in the way: aimed past its
 * edge, so the walker skirts it and heads straight on once clear.
 * `preferSide` (1 or -1, right or left of the straight line) overrides
 * which side, for a walker that got stuck going the other way or that keeps
 * to the side it chose.
 */
export const wayToward = (
  from: GroundPoint,
  to: GroundPoint,
  obstacles: readonly RoundObstacle[],
  clearance: number,
  preferSide?: -1 | 1
): Way => {
  const widened = obstacles.map((each) => ({
    center: each.center,
    radius: each.radius + clearance,
  }));

  let first: RoundObstacle | undefined;
  let firstAt = Number.POSITIVE_INFINITY;

  for (const each of widened) {
    const at = crossing(from, to, each);

    if (at !== null && at < firstAt) {
      first = each;
      firstAt = at;
    }
  }

  if (!first) {
    return { heading: direction(from, to), side: undefined };
  }

  const straight = direction(from, to);
  const across = rightOf(straight);

  // The side the straight line already passes the centre on is the short way round.
  const offset =
    (from.x - first.center.x) * across.x + (from.z - first.center.z) * across.z;

  const side = preferSide ?? (offset >= 0 ? 1 : -1);

  // Aim at the point on the obstacle's edge square to the line, a little out.
  const edge = first.radius * 1.05;

  const past = {
    x: first.center.x + across.x * side * edge,
    z: first.center.z + across.z * side * edge,
  };

  // Hugging the obstacle already: walk along its edge, the chosen way round.
  if (distanceBetween(from, first.center) <= first.radius) {
    const out = direction(first.center, from);
    const along = rightOf(out);

    // Of the two ways along the edge, the one heading on and round the chosen side.
    const wanted = {
      x: straight.x + across.x * side,
      z: straight.z + across.z * side,
    };

    const way = along.x * wanted.x + along.z * wanted.z >= 0 ? 1 : -1;

    const heading = direction(from, {
      x: from.x + along.x * way + out.x * 0.3,
      z: from.z + along.z * way + out.z * 0.3,
    });

    return { heading, side };
  }

  return { heading: direction(from, past), side };
};
