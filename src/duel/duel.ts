/**
 * The Duel simulation: pure, deterministic and advanced on a fixed timestep.
 * It is the only place game state changes. Views read its snapshot; Controllers
 * feed it one Intent per Duelist per tick. No three.js, no DOM.
 */
import type { Tuning } from "../tuning";
import {
  clamp,
  defaultForward,
  direction,
  distanceBetween,
  rightOf,
} from "./geometry";
import type { GroundPoint, Point3 } from "./geometry";
import { idleIntent } from "./intent";
import type { Intent, Vec2 } from "./intent";

export type DuelistId = string;

export type TeamId = string;

/** A column of Cover standing on the Arena floor, as a circle. */
export interface CoverColumn {
  readonly center: GroundPoint;
  readonly radius: number;
}

/** Arena geometry the simulation collides against, centred on the origin. */
export interface ArenaLayout {
  /** The walkable rectangle spans ±halfWidth on x and ±halfDepth on z. */
  readonly bounds: { readonly halfDepth: number; readonly halfWidth: number };
  readonly cover: readonly CoverColumn[];
}

export interface DuelistSetup {
  readonly id: DuelistId;
  readonly team: TeamId;
  readonly spawn: GroundPoint;
}

/** Everything a Duel is created from. */
export interface DuelConfig {
  readonly arena: ArenaLayout;
  readonly duelists: readonly DuelistSetup[];
  readonly tuning: Tuning;
}

export interface DuelistState {
  readonly id: DuelistId;
  readonly team: TeamId;
  readonly position: GroundPoint;
  /** Unit vector the Duelist faces: toward their Target when they have one. */
  readonly facing: GroundPoint;
  /** The opposing Duelist this one is locked onto, if any is left. */
  readonly targetId: DuelistId | null;
  /**
   * Where the Duelist's Spells are aimed: the Target's chest, nudged by the
   * Intent's aim offset; straight ahead at chest height without a Target.
   */
  readonly aimPoint: Point3;
}

/** A read-only picture of the Duel after a tick. A new object every tick. */
export interface DuelSnapshot {
  readonly tick: number;
  readonly duelists: readonly DuelistState[];
}

/**
 * Everything the simulation reports happening during a tick, for views,
 * audio and haptics to react to. Movement alone reports nothing; the first
 * events (Spell cast, hit) arrive with the Light Spell.
 */
export type DuelEvent = never;

/** The outcome of one tick: the new snapshot and the events emitted during it. */
export interface DuelTick {
  readonly snapshot: DuelSnapshot;
  readonly events: readonly DuelEvent[];
}

export interface Duel {
  readonly snapshot: () => DuelSnapshot;
  /**
   * Advances one fixed tick of `1 / tuning.tickRate` seconds with one Intent
   * per Duelist. A Duelist missing from `intents` is idle this tick.
   */
  readonly step: (intents: Readonly<Record<DuelistId, Intent>>) => DuelTick;
}

/** A circle a Duelist's body cannot overlap: a column of Cover or another Duelist. */
interface Obstacle {
  readonly center: GroundPoint;
  readonly radius: number;
}

/**
 * Pushes a Duelist's body (a circle of `radius`) out of every obstacle it
 * overlaps, then back inside the Arena bounds. Pushing out along the contact
 * normal is what makes a Duelist slide around a column instead of sticking.
 */
const collide = (
  point: GroundPoint,
  radius: number,
  obstacles: readonly Obstacle[],
  arena: ArenaLayout
): GroundPoint => {
  const maxX = arena.bounds.halfWidth - radius;
  const maxZ = arena.bounds.halfDepth - radius;
  let { x, z } = point;

  // Two passes settle the rare case of a column close enough to a wall that
  // resolving one contact pushes the body into the other.
  for (let pass = 0; pass < 2; pass += 1) {
    for (const obstacle of obstacles) {
      const distance = distanceBetween(obstacle.center, { x, z });
      const minDistance = obstacle.radius + radius;

      if (distance < minDistance && distance > 1e-9) {
        x =
          obstacle.center.x +
          ((x - obstacle.center.x) / distance) * minDistance;
        z =
          obstacle.center.z +
          ((z - obstacle.center.z) / distance) * minDistance;
      }
    }

    x = clamp(x, -maxX, maxX);
    z = clamp(z, -maxZ, maxZ);
  }

  return { x, z };
};

/**
 * Lock-on movement: `forward` metres toward the Target and `right` metres
 * around it. Strafing orbits the Target at a constant distance, which is how
 * the stick feels with the camera locked behind the Duelist.
 */
const walk = (
  from: GroundPoint,
  target: GroundPoint | undefined,
  right: number,
  forward: number
): GroundPoint => {
  const distance = target ? distanceBetween(from, target) : 0;

  if (!target || distance < 1e-6) {
    // No Target to orbit: plain movement in the default frame.
    return { x: from.x + right, z: from.z - forward };
  }

  const side = rightOf(direction(from, target));
  // Offset from the Target after the sideways step, rescaled so the distance
  // only changes by the forward component.
  const offsetX = from.x + side.x * right - target.x;
  const offsetZ = from.z + side.z * right - target.z;
  const offsetLength = Math.hypot(offsetX, offsetZ);
  const nextDistance = Math.max(distance - forward, 0);

  return {
    x: target.x + (offsetX / offsetLength) * nextDistance,
    z: target.z + (offsetZ / offsetLength) * nextDistance,
  };
};

/** Scales `vector` down to length `max` when it is longer. */
const clampLength = (vector: Vec2, max: number): Vec2 => {
  const length = Math.hypot(vector.x, vector.y);

  return length <= max
    ? vector
    : { x: (vector.x / length) * max, y: (vector.y / length) * max };
};

const nearest = (
  from: GroundPoint,
  candidates: readonly DuelistState[]
): DuelistState | undefined => {
  let best: DuelistState | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const distance = distanceBetween(from, candidate.position);

    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }

  return best;
};

/**
 * Locks every Duelist onto a Target (keeping the current one while it is still
 * an opponent, otherwise the nearest opponent), turns them to face it and
 * places their aim point around it.
 */
const lockOn = (
  duelists: readonly DuelistState[],
  aimOf: (id: DuelistId) => Vec2,
  tuning: Tuning
): DuelistState[] =>
  duelists.map((self) => {
    const opponents = duelists.filter((other) => other.team !== self.team);

    const target =
      opponents.find((other) => other.id === self.targetId) ??
      nearest(self.position, opponents);

    const facing = target
      ? direction(self.position, target.position)
      : self.facing;

    const center = target?.position ?? {
      x: self.position.x + facing.x * tuning.aim.untargetedDistance,
      z: self.position.z + facing.z * tuning.aim.untargetedDistance,
    };

    const offset = aimOf(self.id);
    const sideways = clamp(offset.x, -1, 1) * tuning.aim.maxHorizontalOffset;
    const upward = clamp(offset.y, -1, 1) * tuning.aim.maxVerticalOffset;
    const side = rightOf(facing);

    return {
      ...self,
      aimPoint: {
        x: center.x + side.x * sideways,
        y: tuning.duelist.chestHeight + upward,
        z: center.z + side.z * sideways,
      },
      facing,
      targetId: target?.id ?? null,
    };
  });

export const createDuel = (config: DuelConfig): Duel => {
  const { arena, tuning } = config;
  const { bodyRadius } = tuning.duelist;
  const stride = tuning.duelist.walkSpeed / tuning.tickRate;

  let current: DuelSnapshot = {
    duelists: lockOn(
      config.duelists.map((setup) => ({
        aimPoint: { x: setup.spawn.x, y: 0, z: setup.spawn.z },
        facing: defaultForward,
        id: setup.id,
        position: setup.spawn,
        targetId: null,
        team: setup.team,
      })),
      () => idleIntent.aim,
      tuning
    ),
    tick: 0,
  };

  const step = (intents: Readonly<Record<DuelistId, Intent>>): DuelTick => {
    const intentOf = (id: DuelistId) => intents[id] ?? idleIntent;
    const byId = new Map(current.duelists.map((each) => [each.id, each]));

    const moved = current.duelists.map((self) => {
      const move = clampLength(intentOf(self.id).move, 1);

      const target =
        self.targetId === null ? undefined : byId.get(self.targetId);

      const wanted = walk(
        self.position,
        target?.position,
        move.x * stride,
        move.y * stride
      );

      // Other Duelists block at their position from the start of the tick, so
      // the result does not depend on the order Duelists are processed in.
      const others = current.duelists
        .filter((other) => other.id !== self.id)
        .map((other) => ({ center: other.position, radius: bodyRadius }));

      const obstacles = [...arena.cover, ...others];

      return {
        ...self,
        position: collide(wanted, bodyRadius, obstacles, arena),
      };
    });

    current = {
      duelists: lockOn(moved, (id) => intentOf(id).aim, tuning),
      tick: current.tick + 1,
    };

    return { events: [], snapshot: current };
  };

  return { snapshot: () => current, step };
};
