/**
 * Where a Duelist's aim comes from and where it lands. A human aims with the
 * camera, so the simulation models the camera's line of sight: a ray from the
 * aim pivot (a point over the Duelist's right shoulder, which the camera sits
 * straight behind) along the Duelist's Aim. The point that ray reaches first
 * is the point under the crosshair. Pure; the camera rig shares the pivot so
 * the crosshair at the screen centre sits exactly on that ray.
 */
import type { ArenaLayout, CoverColumn } from "./duel";
import {
  angleBetween,
  clamp,
  distanceBetween,
  forwardOf,
  rightOf,
  unit3,
  wrapAngle,
} from "./geometry";
import type { Aim, GroundPoint, Point3 } from "./geometry";

/** Where the aim pivot sits relative to the Duelist. */
export interface AimEye {
  /** Height above the floor, metres. */
  readonly height: number;
  /** Offset to the right of the Duelist, metres, when there is room for it. */
  readonly shoulder: number;
  /** The pivot never comes nearer than this to a wall or a column of Cover. */
  readonly margin: number;
}

/** A body the aim ray can land on: a standing cylinder. */
export interface AimBody {
  readonly position: GroundPoint;
  readonly radius: number;
  readonly height: number;
}

/**
 * How far from `origin` one can go along the unit ground vector `heading`
 * before coming within `margin` of a wall or a column of `cover`.
 */
export const reachAlong = (
  origin: GroundPoint,
  heading: GroundPoint,
  bounds: ArenaLayout["bounds"],
  cover: readonly CoverColumn[],
  margin: number
) => {
  let reach = Number.POSITIVE_INFINITY;
  const reachX = bounds.halfWidth - margin;
  const reachZ = bounds.halfDepth - margin;

  if (heading.x !== 0) {
    reach = Math.min(
      reach,
      ((heading.x > 0 ? reachX : -reachX) - origin.x) / heading.x
    );
  }

  if (heading.z !== 0) {
    reach = Math.min(
      reach,
      ((heading.z > 0 ? reachZ : -reachZ) - origin.z) / heading.z
    );
  }

  for (const column of cover) {
    const toX = column.center.x - origin.x;
    const toZ = column.center.z - origin.z;
    const along = toX * heading.x + toZ * heading.z;
    const radius = column.radius + margin;
    const depthSquared = radius ** 2 - (toX ** 2 + toZ ** 2 - along ** 2);

    if (along > 0 && depthSquared > 0) {
      reach = Math.min(reach, along - Math.sqrt(depthSquared));
    }
  }

  return Math.max(reach, 0);
};

/**
 * The aim pivot of a Duelist standing at `position` and looking along `yaw`:
 * over the right shoulder, pulled in toward the Duelist when a wall or a
 * column leaves no room for the full shoulder offset.
 */
export const aimPivot = (
  position: GroundPoint,
  yaw: number,
  arena: Pick<ArenaLayout, "bounds" | "cover">,
  eye: AimEye
): Point3 => {
  const right = rightOf(forwardOf(yaw));

  const shoulder = Math.min(
    eye.shoulder,
    reachAlong(position, right, arena.bounds, arena.cover, eye.margin)
  );

  return {
    x: position.x + right.x * shoulder,
    y: eye.height,
    z: position.z + right.z * shoulder,
  };
};

/**
 * The Aim that puts the crosshair of a Duelist standing at `position` on
 * `point`. The pivot moves with the yaw, so a few fixed-point steps settle it.
 */
export const aimAt = (
  position: GroundPoint,
  point: Point3,
  arena: Pick<ArenaLayout, "bounds" | "cover">,
  eye: AimEye
): Aim => {
  let aim: Aim = {
    pitch: 0,
    yaw: Math.atan2(point.x - position.x, -(point.z - position.z)),
  };

  for (let step = 0; step < 3; step += 1) {
    const pivot = aimPivot(position, aim.yaw, arena, eye);
    const dx = point.x - pivot.x;
    const dz = point.z - pivot.z;

    aim = {
      pitch: Math.atan2(point.y - pivot.y, Math.hypot(dx, dz)),
      yaw: Math.atan2(dx, -dz),
    };
  }

  return aim;
};

/** `aim` turned by `offset`, with the yaw kept in [-PI, PI]. */
export const addAim = (aim: Aim, offset: Aim): Aim => ({
  pitch: aim.pitch + offset.pitch,
  yaw: wrapAngle(aim.yaw + offset.yaw),
});

/**
 * Nearest root t >= 0 of the ray `origin + t * direction` (ground components
 * only) entering a circle, or undefined. A ray starting inside never hits it.
 */
const enterCircle = (
  origin: Point3,
  direction: Point3,
  center: GroundPoint,
  radius: number
): number | undefined => {
  const fromX = origin.x - center.x;
  const fromZ = origin.z - center.z;
  const a = direction.x ** 2 + direction.z ** 2;
  const b = 2 * (fromX * direction.x + fromZ * direction.z);
  const c = fromX ** 2 + fromZ ** 2 - radius ** 2;
  const discriminant = b * b - 4 * a * c;

  if (c <= 0 || a < 1e-12 || discriminant < 0) {
    return undefined;
  }

  const t = (-b - Math.sqrt(discriminant)) / (2 * a);

  return t >= 0 ? t : undefined;
};

/** Farther than any point in an Arena: where a ray ends that meets nothing. */
const farthest = 200;

/**
 * The first point the ray from `origin` along the unit `direction` reaches:
 * the floor, a wall, a column of Cover (taller than any Spell flies) or one of
 * `bodies`. Obstructions are low enough to look over, as Spells fly over them.
 */
export const castAimRay = (
  origin: Point3,
  direction: Point3,
  arena: Pick<ArenaLayout, "bounds" | "cover">,
  bodies: readonly AimBody[]
): Point3 => {
  let nearest = farthest;
  const { halfDepth, halfWidth } = arena.bounds;

  if (direction.y < 0) {
    nearest = Math.min(nearest, -origin.y / direction.y);
  }

  if (direction.x !== 0) {
    const wall =
      ((direction.x > 0 ? halfWidth : -halfWidth) - origin.x) / direction.x;

    if (wall >= 0) {
      nearest = Math.min(nearest, wall);
    }
  }

  if (direction.z !== 0) {
    const wall =
      ((direction.z > 0 ? halfDepth : -halfDepth) - origin.z) / direction.z;

    if (wall >= 0) {
      nearest = Math.min(nearest, wall);
    }
  }

  for (const column of arena.cover) {
    const t = enterCircle(origin, direction, column.center, column.radius);

    if (t !== undefined) {
      nearest = Math.min(nearest, t);
    }
  }

  for (const body of bodies) {
    const t = enterCircle(origin, direction, body.position, body.radius);
    const y = t === undefined ? -1 : origin.y + direction.y * t;

    // A ray passing over the head or under the floor misses the body.
    if (t !== undefined && y >= 0 && y <= body.height) {
      nearest = Math.min(nearest, t);
    }
  }

  return {
    x: origin.x + direction.x * nearest,
    y: origin.y + direction.y * nearest,
    z: origin.z + direction.z * nearest,
  };
};

/**
 * True when a column of Cover stands between `from` and `to`. Cover blocks
 * sight; Obstructions are low and never do.
 */
export const sightBlocked = (
  from: GroundPoint,
  to: GroundPoint,
  cover: readonly CoverColumn[]
) => {
  const length = distanceBetween(from, to);

  if (length === 0) {
    return false;
  }

  const dx = (to.x - from.x) / length;
  const dz = (to.z - from.z) / length;

  return cover.some((column) => {
    const along = clamp(
      (column.center.x - from.x) * dx + (column.center.z - from.z) * dz,
      0,
      length
    );

    return (
      distanceBetween(column.center, {
        x: from.x + dx * along,
        z: from.z + dz * along,
      }) < column.radius
    );
  });
};

/** The unit direction from `from` to `to`. */
export const towardPoint = (from: Point3, to: Point3): Point3 =>
  unit3({ x: to.x - from.x, y: to.y - from.y, z: to.z - from.z });

/**
 * The angle, seen from `pivot`, between the unit aim `ray` and the nearest
 * point of `body`: 0 when the ray passes through it. Measured to the body's
 * edge rather than its centre, so a body is as easy to pick out at any
 * distance. A body behind the pivot counts by its centre.
 */
export const angleToBody = (
  pivot: Point3,
  ray: Point3,
  body: AimBody
): number => {
  const toCentre = {
    x: body.position.x - pivot.x,
    y: body.height / 2 - pivot.y,
    z: body.position.z - pivot.z,
  };

  // How far along the ray the body's axis is closest to it.
  const along = toCentre.x * ray.x + toCentre.z * ray.z;
  const alongRay = along / Math.max(ray.x ** 2 + ray.z ** 2, 1e-12);

  if (alongRay <= 0) {
    return angleBetween(ray, unit3(toCentre));
  }

  const reached = {
    x: pivot.x + ray.x * alongRay,
    y: pivot.y + ray.y * alongRay,
    z: pivot.z + ray.z * alongRay,
  };

  // The point of the cylinder nearest the ray at that depth.
  const gapX = reached.x - body.position.x;
  const gapZ = reached.z - body.position.z;
  const gap = Math.hypot(gapX, gapZ);
  const pull = gap > body.radius ? body.radius / gap : 1;

  const nearest = {
    x: body.position.x + gapX * pull,
    y: clamp(reached.y, 0, body.height),
    z: body.position.z + gapZ * pull,
  };

  return angleBetween(
    ray,
    unit3({
      x: nearest.x - pivot.x,
      y: nearest.y - pivot.y,
      z: nearest.z - pivot.z,
    })
  );
};
