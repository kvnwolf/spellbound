/**
 * Where the camera stands to keep its subject in view, as pure geometry with
 * no three.js: the free camera behind the aim pivot, lifted when a wall or a
 * column pulls it in close to the local Duelist. The rig owns the easing and
 * hands its eased values back in, so it stays the only writer of the camera.
 */
import type { ArenaLayout } from "../duel/duel";
import { clamp, directionOf, yawOf } from "../duel/geometry";
import type { GroundPoint, Point3 } from "../duel/geometry";
import type { Tuning } from "../tuning";
import { clearDistance } from "./camera-clearance";

type CameraSettings = Tuning["camera"];

/** The free camera's subject: the local Duelist, their aim pivot and where they look. */
export interface FreeSubject {
  /** The aim pivot (see duel/aim): the camera sits straight behind it. */
  readonly pivot: Point3;
  /** The unit direction the Duelist aims along. */
  readonly look: Point3;
  readonly position: GroundPoint;
  readonly facing: GroundPoint;
}

/** A camera pose: where it is and the unit direction it looks. */
export interface Pose {
  readonly eye: Point3;
  readonly look: Point3;
}

/** How far into the lift the camera wants to be: by choice, and forced. */
export interface LiftWanted {
  /** Lifting because the Duelist faces the camera from close by (eased by the rig). */
  readonly soft: number;
  /** Lifting because the camera would otherwise be right up against them (never eased in). */
  readonly forced: number;
}

const smooth01 = (value: number) => {
  const x = clamp(value, 0, 1);

  return x * x * (3 - 2 * x);
};

const groundUnit = (vector: Point3 | GroundPoint): GroundPoint => {
  const length = Math.hypot(vector.x, vector.z);

  return length === 0
    ? { x: 0, z: -1 }
    : { x: vector.x / length, z: vector.z / length };
};

/**
 * The share of the free distance the camera can sit back along the aim line
 * from the pivot before a wall, a column or the floor is in the way.
 */
export const freeReach = (
  subject: FreeSubject,
  arena: ArenaLayout,
  settings: CameraSettings
): number => {
  const { look, pivot } = subject;
  const { distance, minHeight } = settings.free;
  const backLength = Math.hypot(look.x, look.z) * distance;
  let reach = 1;

  if (backLength > 1e-6) {
    const clear = clearDistance(
      { x: pivot.x, z: pivot.z },
      groundUnit({ x: -look.x, z: -look.z }),
      arena,
      settings.clearance.margin,
      settings.clearance.columnFeather
    );

    reach = Math.min(1, clear / backLength);
  }

  // Looking up lowers the camera: it never sinks below the floor margin.
  if (look.y > 0) {
    reach = Math.min(reach, (pivot.y - minHeight) / (look.y * distance));
  }

  return Math.max(reach, 0);
};

/** The camera on the aim line, `reach` of the free distance behind the pivot. */
const onAimLine = (
  subject: FreeSubject,
  reach: number,
  settings: CameraSettings
): Point3 => {
  const out = settings.free.distance * reach;

  return {
    x: subject.pivot.x - subject.look.x * out,
    y: subject.pivot.y - subject.look.y * out,
    z: subject.pivot.z - subject.look.z * out,
  };
};

/**
 * How far the camera at `reach` wants to lift off the aim line: by choice
 * while the Duelist faces it from close by, and forced when it would come
 * right up against them whichever way they face.
 */
export const liftWanted = (
  subject: FreeSubject,
  reach: number,
  settings: CameraSettings,
  chestHeight: number
): LiftWanted => {
  const { lift } = settings.free;
  const eye = onAimLine(subject, reach, settings);

  const gap = Math.hypot(
    eye.x - subject.position.x,
    eye.y - chestHeight,
    eye.z - subject.position.z
  );

  const ahead = groundUnit(subject.look);

  const towardCamera = -(
    subject.facing.x * ahead.x +
    subject.facing.z * ahead.z
  );

  const facingShare = smooth01(
    (towardCamera - lift.facingFrom) / (lift.facingFull - lift.facingFrom)
  );

  return {
    forced: smooth01(
      (lift.forcedFrom - gap) / (lift.forcedFrom - lift.forcedFull)
    ),
    soft:
      facingShare * smooth01((lift.from - gap) / (lift.from - lift.nearest)),
  };
};

/**
 * The free camera: on the aim line behind the pivot, `reach` of the way out,
 * then lifted by `lift` (0 to 1): it rises until it is at least
 * `lift.nearest` from the Duelist's chest and tilts down toward them, never
 * turning in yaw, so the stick still moves the Duelist the way the screen
 * shows. At no lift the screen centre looks exactly down the aim ray. Without
 * `eased`, the reach and lift the geometry wants are used directly.
 */
export const freeCameraPose = (
  subject: FreeSubject,
  arena: ArenaLayout,
  settings: CameraSettings,
  chestHeight: number,
  eased?: { readonly reach: number; readonly lift: number }
): Pose => {
  const reach = eased?.reach ?? freeReach(subject, arena, settings);

  const share =
    eased?.lift ??
    (() => {
      const wanted = liftWanted(subject, reach, settings, chestHeight);

      return Math.max(wanted.soft, wanted.forced);
    })();

  const { lift } = settings.free;
  const line = onAimLine(subject, reach, settings);
  const { position } = subject;
  const across = Math.hypot(line.x - position.x, line.z - position.z);
  const above = line.y - chestHeight;

  const needed = Math.max(
    0,
    Math.sqrt(Math.max(lift.nearest ** 2 - across ** 2, 0)) - above
  );

  const eye = { x: line.x, y: line.y + needed * share, z: line.z };

  // Tilt down toward the chest, in the aim's own vertical plane.
  const ahead = groundUnit(subject.look);

  const forward = Math.max(
    (position.x - eye.x) * ahead.x + (position.z - eye.z) * ahead.z,
    1e-3
  );

  const aimPitch = Math.asin(clamp(subject.look.y, -1, 1));
  const towardChest = Math.atan2(chestHeight - eye.y, forward);
  const tilted = Math.max(Math.min(aimPitch, towardChest), -lift.maxTilt);

  return {
    eye,
    look: directionOf({
      pitch: aimPitch + (tilted - aimPitch) * share,
      yaw: yawOf(ahead),
    }),
  };
};

type ShotSettings = Pick<Tuning, "camera" | "knockoutCamera">;

/**
 * The side (a unit ground direction from the fallen Duelist) the Knockout
 * shot frames them from: as near the side of `preferred` (the winner) as
 * the Arena allows, swinging round to open ground when walls or Cover leave
 * too little room there. Each candidate pays for the room it lacks and for
 * how far it turns from the winner's side; the cheapest wins.
 */
export const knockoutSide = (
  fallen: GroundPoint,
  preferred: GroundPoint,
  arena: ArenaLayout,
  settings: ShotSettings
): GroundPoint => {
  const { clearance } = settings.camera;
  const { room, sideCost } = settings.knockoutCamera;
  const wanted = Math.atan2(preferred.x - fallen.x, preferred.z - fallen.z);
  const steps = Math.round(Math.PI / clearance.swingStep);
  let best = { x: Math.sin(wanted), z: Math.cos(wanted) };
  let bestCost = Number.POSITIVE_INFINITY;

  for (let step = -steps; step <= steps; step += 1) {
    const turn = step * clearance.swingStep;
    const side = { x: Math.sin(wanted + turn), z: Math.cos(wanted + turn) };

    const open = Math.min(
      room,
      clearDistance(
        fallen,
        side,
        arena,
        clearance.margin,
        clearance.columnFeather
      )
    );

    const cost = room - open + sideCost * Math.abs(turn);

    if (cost < bestCost) {
      bestCost = cost;
      best = side;
    }
  }

  return best;
};

/**
 * Where the Knockout shot is framed from: `standOff` metres from the fallen
 * Duelist along `side`, or nearer when a wall or a column comes first, so
 * it is always in the clear with nothing between it and them.
 */
export const knockoutViewpoint = (
  fallen: GroundPoint,
  side: GroundPoint,
  arena: ArenaLayout,
  settings: ShotSettings
): GroundPoint => {
  const { clearance } = settings.camera;

  const out = Math.min(
    settings.knockoutCamera.standOff,
    clearDistance(
      fallen,
      side,
      arena,
      clearance.margin,
      clearance.columnFeather
    )
  );

  return { x: fallen.x + side.x * out, z: fallen.z + side.z * out };
};
