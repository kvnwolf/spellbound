/**
 * The Duel simulation: pure, deterministic and advanced on a fixed timestep.
 * It is the only place game state changes. Views read its snapshot; Controllers
 * feed it one Intent per Duelist per tick. No three.js, no DOM.
 */
import type { Tuning } from "../tuning";
import {
  addAim,
  aimAt,
  angleToBody,
  aimPivot,
  castAimRay,
  sightBlocked,
  towardPoint,
} from "./aim";
import type { Difficulty } from "./difficulty";
import { fly } from "./flight";
import {
  angleBetween,
  clamp,
  defaultForward,
  direction,
  directionOf,
  distanceBetween,
  forwardOf,
  rightOf,
  rotateToward,
  unit3,
  wrapAngle,
  yawOf,
} from "./geometry";
import type { Aim, GroundPoint, Point3 } from "./geometry";
import { idleIntent } from "./intent";
import type { Intent, Vec2 } from "./intent";

export type DuelistId = string;

export type TeamId = string;

/** A column of Cover or an Obstruction standing on the Arena floor, as a circle. */
export interface CoverColumn {
  readonly center: GroundPoint;
  readonly radius: number;
}

/** Arena geometry the simulation collides against, centred on the origin. */
export interface ArenaLayout {
  /** The walkable rectangle spans ±halfWidth on x and ±halfDepth on z. */
  readonly bounds: { readonly halfDepth: number; readonly halfWidth: number };
  /** Stops both Duelists and Spells. */
  readonly cover: readonly CoverColumn[];
  /** Low geometry that stops Duelists only: Spells fly over it. */
  readonly obstructions: readonly CoverColumn[];
}

export interface DuelistSetup {
  readonly id: DuelistId;
  readonly team: TeamId;
  readonly spawn: GroundPoint;
}

/** Everything a Duel is created from. */
export interface DuelConfig {
  readonly arena: ArenaLayout;
  /** Carried for the AI Controller to read; the simulation itself ignores it. */
  readonly difficulty?: Difficulty;
  readonly duelists: readonly DuelistSetup[];
  readonly tuning: Tuning;
}

export interface DuelistState {
  readonly id: DuelistId;
  readonly team: TeamId;
  readonly position: GroundPoint;
  /**
   * Unit vector the Duelist faces: where their aim looks (the camera's
   * horizontal direction, for a human), or toward their Target while Locked On.
   */
  readonly facing: GroundPoint;
  /**
   * Where the Duelist looks: for a human, the camera's direction. The aim ray
   * starts at the aim pivot over their right shoulder (see `aim.ts`).
   */
  readonly aim: Aim;
  /** The opponent this Duelist is Locked On to, or null while free-aiming. */
  readonly targetId: DuelistId | null;
  /**
   * While Locked On, how far the right stick has nudged the framing off the
   * Target (radians); it springs back to zero once the stick rests. Spells
   * still go to the Target. Zero while free-aiming.
   */
  readonly lockNudge: Aim;
  /** While Locked On, how long the Target has been out of sight behind Cover; 0 while in sight. */
  readonly targetHiddenSeconds: number;
  /**
   * Where the Duelist's Spells go: the point under the crosshair (the first
   * thing the aim ray reaches), or the Target's chest while Locked On.
   */
  readonly aimPoint: Point3;
  /** Between 0 (Knockout) and `tuning.duelist.health`; full again every Round. */
  readonly health: number;
  /** Seconds left Staggered, unable to move or cast; 0 when free to act. */
  readonly staggerSeconds: number;
  /** Knocked Out this Round: down, and out of the fight until the next Round. */
  readonly knockedOut: boolean;
}

export type SpellKind = "stupefy";

/** A Spell in flight. Ids are unique for the whole Duel, so views can track one across ticks. */
export interface SpellState {
  readonly id: number;
  readonly kind: SpellKind;
  readonly casterId: DuelistId;
  readonly team: TeamId;
  /** The stronger cast that ends a chain of consecutive Light Spells; it Staggers. */
  readonly strong: boolean;
  readonly position: Point3;
  /** Metres per second. Spells fly straight, unless homing. */
  readonly velocity: Point3;
  /**
   * A Spell cast while Locked On turns weakly toward its Target for a short
   * while after launch (see `tuning.lockOn.homing`); null for free-aimed Spells.
   */
  readonly homing: {
    readonly targetId: DuelistId;
    readonly secondsLeft: number;
  } | null;
}

/**
 * Where the current Round stands.
 * - `intro`: the "3, 2, 1, ¡Duelo!" countdown; nobody can act yet.
 * - `fighting`: Duelists are in control.
 * - `knockout`: a Duelist just went down; played in slow motion by the game loop.
 * - `result`: the Round's result holds before the next Round's intro.
 * - `over`: the Duel has a winner; nothing more happens.
 */
export type RoundPhase = "fighting" | "intro" | "knockout" | "over" | "result";

export interface RoundState {
  /** 1 for the first Round. */
  readonly number: number;
  readonly phase: RoundPhase;
  /** Simulation seconds until the phase ends; 0 for `fighting` and `over`, which end on their own terms. */
  readonly phaseSecondsLeft: number;
  /** The Team that won this Round once it is decided; null while undecided or after a draw. */
  readonly winner: TeamId | null;
}

/** A read-only picture of the Duel after a tick. A new object every tick. */
export interface DuelSnapshot {
  readonly tick: number;
  readonly duelists: readonly DuelistState[];
  readonly spells: readonly SpellState[];
  readonly round: RoundState;
  /** Rounds won by each Team. */
  readonly score: Readonly<Record<TeamId, number>>;
  /** The Team that won the Duel, once one has won enough Rounds. */
  readonly winner: TeamId | null;
}

/**
 * Everything the simulation reports happening during a tick, for views,
 * audio and haptics to react to. Movement alone reports nothing.
 */
export type DuelEvent =
  /** The intro's countdown ended: Duelists are in control. */
  | { readonly type: "round-start"; readonly round: number }
  | { readonly type: "spell-cast"; readonly spell: SpellState }
  /** A Duelist Locked On to a Target, or switched to a new one. */
  | {
      readonly type: "lock-on";
      readonly duelistId: DuelistId;
      readonly targetId: DuelistId;
    }
  /**
   * A Duelist's Lock-on ended: released with R3 (`toggle`), the Target was
   * Knocked Out, or it stayed out of sight behind Cover too long.
   */
  | {
      readonly type: "lock-off";
      readonly duelistId: DuelistId;
      readonly targetId: DuelistId;
      readonly reason: "knockout" | "sight" | "toggle";
    }
  /** A Spell landed on a Duelist. Light Spell hits are what will build Focus. */
  | {
      readonly type: "spell-hit";
      readonly spell: SpellState;
      readonly targetId: DuelistId;
      readonly damage: number;
      readonly staggered: boolean;
      readonly position: Point3;
    }
  | {
      readonly type: "spell-stopped";
      readonly spell: SpellState;
      readonly by: "bounds" | "cover" | "floor";
      readonly position: Point3;
    }
  /** Two Spells from opposing Duelists met in the air and burst. */
  | {
      readonly type: "spells-cancelled";
      readonly spells: readonly [SpellState, SpellState];
      readonly position: Point3;
    }
  | {
      readonly type: "knockout";
      readonly duelistId: DuelistId;
      readonly position: GroundPoint;
    }
  /** The Round was decided. `winner` is null when every Team went down together. */
  | {
      readonly type: "round-end";
      readonly round: number;
      readonly winner: TeamId | null;
    }
  | { readonly type: "duel-end"; readonly winner: TeamId };

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

/** A circle a Duelist's body cannot overlap: a column of Cover, an Obstruction or another Duelist. */
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
 * Movement for one tick: `forward` metres and `right` metres sideways.
 * Free-aiming, that is relative to where the Duelist looks (the camera).
 * Locked On, forward is toward the Target and strafing orbits it at a
 * constant distance, which is how the stick feels with the camera framing both.
 */
const walk = (
  from: GroundPoint,
  yaw: number,
  target: GroundPoint | undefined,
  right: number,
  forward: number
): GroundPoint => {
  const distance = target ? distanceBetween(from, target) : 0;

  if (!target || distance < 1e-6) {
    const ahead = forwardOf(yaw);
    const side = rightOf(ahead);

    return {
      x: from.x + ahead.x * forward + side.x * right,
      z: from.z + ahead.z * forward + side.z * right,
    };
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

/** A Duelist's chest: where Lock-on and Aim Assist aim at them. */
const chestOf = (duelist: DuelistState, tuning: Tuning): Point3 => ({
  x: duelist.position.x,
  y: tuning.duelist.chestHeight,
  z: duelist.position.z,
});

/**
 * Per-Duelist bookkeeping the snapshot has no need to show. Timers count
 * whole ticks so cadences are exact instead of drifting with float sums.
 */
interface Bookkeeping {
  /** The Light Spell button was down last tick: casting happens on the press. */
  held: boolean;
  /** A press made during the previous cast's recovery, cast as soon as it ends. */
  queued: boolean;
  recoveryTicks: number;
  ticksSinceCast: number;
  /** Consecutive Light Spells in the current chain. */
  chain: number;
  staggerTicks: number;
  /** Ticks the Lock-on Target has been out of sight behind Cover. */
  hiddenTicks: number;
  /** Ticks left of a recentre after R3 found nothing to lock on to. */
  recentreTicks: number;
}

const freshBookkeeping = (): Bookkeeping => ({
  chain: 0,
  held: false,
  hiddenTicks: 0,
  queued: false,
  recentreTicks: 0,
  recoveryTicks: 0,
  staggerTicks: 0,
  ticksSinceCast: Number.POSITIVE_INFINITY,
});

const noNudge: Aim = { pitch: 0, yaw: 0 };

/** Where a Duelist's Spells leave the Wand. */
const wandTip = (self: DuelistState, tuning: Tuning): Point3 => {
  const { forward, height, right } = tuning.duelist.wandTip;
  const side = rightOf(self.facing);

  return {
    x: self.position.x + self.facing.x * forward + side.x * right,
    y: height,
    z: self.position.z + self.facing.z * forward + side.z * right,
  };
};

const scale = (vector: Point3, by: number): Point3 => ({
  x: vector.x * by,
  y: vector.y * by,
  z: vector.z * by,
});

export const createDuel = (config: DuelConfig): Duel => {
  const { arena, tuning } = config;
  const { bodyRadius } = tuning.duelist;
  const { round: rounds, stupefy } = tuning;
  const tickSeconds = 1 / tuning.tickRate;
  const stride = tuning.duelist.walkSpeed * tickSeconds;
  const ticksOf = (seconds: number) => Math.round(seconds * tuning.tickRate);

  const bookkeeping = new Map<DuelistId, Bookkeeping>();

  const books = (id: DuelistId): Bookkeeping => {
    let found = bookkeeping.get(id);

    if (!found) {
      found = freshBookkeeping();
      bookkeeping.set(id, found);
    }

    return found;
  };

  const { eye } = tuning.aim;

  /**
   * Whether a Locked On Duelist's lock holds after everyone moved this tick:
   * it breaks when the Target is Knocked Out, or once the Target has been
   * out of sight behind Cover for longer than the grace. Returns the Target
   * while the lock holds.
   */
  const keepLock = (
    self: DuelistState,
    duelists: readonly DuelistState[],
    events: DuelEvent[]
  ): DuelistState | undefined => {
    if (self.targetId === null) {
      return undefined;
    }

    const book = books(self.id);
    const target = duelists.find((other) => other.id === self.targetId);
    let reason: "knockout" | "sight" | undefined;

    if (!target || target.knockedOut) {
      reason = "knockout";
    } else {
      book.hiddenTicks = sightBlocked(
        self.position,
        target.position,
        arena.cover
      )
        ? book.hiddenTicks + 1
        : 0;

      if (book.hiddenTicks * tickSeconds > tuning.lockOn.sightGraceSeconds) {
        reason = "sight";
      }
    }

    if (reason === undefined) {
      return target;
    }

    book.hiddenTicks = 0;
    events.push({
      duelistId: self.id,
      reason,
      targetId: self.targetId,
      type: "lock-off",
    });

    return undefined;
  };

  /**
   * Faces each Duelist and settles where their Spells go, once everyone has
   * moved this tick. Locked On: they face the Target and aim at its chest
   * (the framing nudge only turns the aim, i.e. the camera). Free-aiming:
   * they face where they look, and their Spells go to the point under the
   * crosshair, the first thing their aim ray reaches, other standing Duelists
   * included. A lock that breaks leaves the aim exactly where it was.
   */
  const settleAim = (
    duelists: readonly DuelistState[],
    events: DuelEvent[]
  ): DuelistState[] =>
    duelists.map((self) => {
      if (self.knockedOut) {
        return self;
      }

      const target = keepLock(self, duelists, events);

      if (target) {
        const chest = chestOf(target, tuning);

        return {
          ...self,
          aim: addAim(aimAt(self.position, chest, arena, eye), self.lockNudge),
          aimPoint: chest,
          facing: direction(self.position, target.position),
          targetHiddenSeconds: books(self.id).hiddenTicks * tickSeconds,
        };
      }

      const bodies = duelists.flatMap((other) =>
        other.id === self.id || other.knockedOut
          ? []
          : [
              {
                height: tuning.duelist.height,
                position: other.position,
                radius: bodyRadius,
              },
            ]
      );

      const { max, min } = tuning.aim.pitch;
      const aim = { ...self.aim, pitch: clamp(self.aim.pitch, min, max) };

      return {
        ...self,
        aim,
        aimPoint: castAimRay(
          aimPivot(self.position, aim.yaw, arena, eye),
          directionOf(aim),
          arena,
          bodies
        ),
        facing: forwardOf(aim.yaw),
        lockNudge: noNudge,
        targetHiddenSeconds: 0,
        targetId: null,
      };
    });

  /**
   * Everyone back at their spawn at full Health, as every Round starts, each
   * looking at the nearest opponent's chest.
   */
  const lineUp = (): DuelistState[] => {
    bookkeeping.clear();

    const spawned: DuelistState[] = config.duelists.map((setup) => ({
      aim: { pitch: tuning.aim.pitch.rest, yaw: 0 },
      aimPoint: { x: setup.spawn.x, y: 0, z: setup.spawn.z },
      facing: defaultForward,
      health: tuning.duelist.health,
      id: setup.id,
      knockedOut: false,
      lockNudge: noNudge,
      position: setup.spawn,
      staggerSeconds: 0,
      targetHiddenSeconds: 0,
      targetId: null,
      team: setup.team,
    }));

    return settleAim(
      spawned.map((self) => {
        const opponent = nearest(
          self.position,
          spawned.filter((other) => other.team !== self.team)
        );

        return opponent
          ? {
              ...self,
              aim: aimAt(self.position, chestOf(opponent, tuning), arena, eye),
            }
          : self;
      }),
      []
    );
  };

  /** Opponents `self` can see: standing, within `range` and not behind Cover. */
  const inSight = (
    self: DuelistState,
    duelists: readonly DuelistState[],
    range = Number.POSITIVE_INFINITY
  ) =>
    duelists.filter(
      (other) =>
        other.team !== self.team &&
        !other.knockedOut &&
        distanceBetween(self.position, other.position) <= range &&
        !sightBlocked(self.position, other.position, arena.cover)
    );

  /**
   * The opponent in sight whose body (its nearest edge, not its centre) is
   * the smallest angle off `self`'s crosshair, with that angle (radians, seen
   * from the free camera): what Aim Assist helps toward, and what R3 Locks On to.
   */
  const nearestToCrosshair = (
    self: DuelistState,
    duelists: readonly DuelistState[],
    range = Number.POSITIVE_INFINITY
  ):
    | { readonly opponent: DuelistState; readonly angle: number }
    | undefined => {
    const pivot = aimPivot(self.position, self.aim.yaw, arena, eye);
    const ray = directionOf(self.aim);
    // Angles are taken from where the free camera sits, straight behind the
    // pivot, so the crosshair on screen marks exactly what they measure.
    const back = tuning.camera.free.distance;

    const viewpoint = {
      x: pivot.x - ray.x * back,
      y: pivot.y - ray.y * back,
      z: pivot.z - ray.z * back,
    };

    let best: { opponent: DuelistState; angle: number } | undefined;

    for (const opponent of inSight(self, duelists, range)) {
      const angle = angleToBody(viewpoint, ray, {
        height: tuning.duelist.height,
        position: opponent.position,
        radius: bodyRadius,
      });

      if (!best || angle < best.angle) {
        best = { angle, opponent };
      }
    }

    return best;
  };

  /**
   * Turns a free-aiming Duelist's aim by the Intent's look rates for one
   * tick. Pitch stays within its limits, easing off over the last stretch
   * before each so the stop never feels like hitting a wall. Aim Assist's
   * friction slows the turn while the crosshair is over an opponent.
   */
  const look = (
    self: DuelistState,
    rates: Aim,
    duelists: readonly DuelistState[]
  ): Aim => {
    const limits = tuning.aim.pitch;
    const assist = tuning.aimAssist;

    const room =
      rates.pitch > 0
        ? limits.max - self.aim.pitch
        : self.aim.pitch - limits.min;

    const edge = clamp(room / limits.edgeEase, limits.edgeFloor, 1);

    // Friction: strongest with the crosshair dead on, gone at the edge of its cone.
    const near = nearestToCrosshair(self, duelists)?.angle ?? Infinity;

    const friction =
      near < assist.bendAngle
        ? assist.friction + (1 - assist.friction) * (near / assist.bendAngle)
        : 1;

    return {
      pitch: clamp(
        self.aim.pitch + rates.pitch * edge * friction * tickSeconds,
        limits.min,
        limits.max
      ),
      yaw: wrapAngle(self.aim.yaw + rates.yaw * friction * tickSeconds),
    };
  };

  /**
   * Aim Assist at launch: a free-aimed cast whose crosshair is close to an
   * opponent leaves the Wand turned part of the way toward their chest. Only
   * the launch direction bends; the Spell then flies straight.
   */
  const assistedLaunch = (
    self: DuelistState,
    origin: Point3,
    launch: Point3,
    duelists: readonly DuelistState[]
  ): Point3 => {
    const near = nearestToCrosshair(self, duelists);

    if (!near || near.angle > tuning.aimAssist.bendAngle) {
      return launch;
    }

    const toChest = towardPoint(origin, chestOf(near.opponent, tuning));

    return rotateToward(
      launch,
      toChest,
      angleBetween(launch, toChest) * tuning.aimAssist.bendStrength
    );
  };

  /**
   * The next opponent to the `side` (-1 left, 1 right) of a Locked On
   * Duelist's current Target, as seen from the Duelist: the one the smallest
   * turn away that way, in sight and in range. None past the last one.
   */
  const nextTarget = (
    self: DuelistState,
    duelists: readonly DuelistState[],
    side: -1 | 1
  ): DuelistState | undefined => {
    const current = duelists.find((other) => other.id === self.targetId);

    if (!current) {
      return undefined;
    }

    const bearing = yawOf(direction(self.position, current.position));
    let best: DuelistState | undefined;
    let bestTurn = Number.POSITIVE_INFINITY;

    for (const other of inSight(self, duelists, tuning.lockOn.range)) {
      const turnBy =
        side *
        wrapAngle(yawOf(direction(self.position, other.position)) - bearing);

      if (other.id !== current.id && turnBy > 0 && turnBy < bestTurn) {
        best = other;
        bestTurn = turnBy;
      }
    }

    return best;
  };

  /**
   * The framing nudge for one tick while Locked On, a spring: the look rates
   * push it (scaled by the gain, up to its limits) while it always pulls back
   * toward zero. Holding the stick settles on an offset that grows with the
   * deflection; letting go springs back.
   */
  const nudge = (from: Aim, rates: Aim): Aim => {
    const { gain, maxPitch, maxYaw, returnSharpness } = tuning.lockOn.nudge;
    const settle = Math.exp(-returnSharpness * tickSeconds);

    const axis = (offset: number, rate: number, limit: number) =>
      clamp(offset * settle + rate * gain * tickSeconds, -limit, limit);

    return {
      pitch: axis(from.pitch, rates.pitch, maxPitch),
      yaw: axis(from.yaw, rates.yaw, maxYaw),
    };
  };

  /**
   * Lock-on and the aim for one tick, from the Intent. R3 releases the
   * Target, or Locks On to the opponent nearest the crosshair (in range and
   * in sight); with nothing to lock on to it recentres the camera's pitch
   * instead. A flick switches Target. Locked On, the look rates only nudge
   * the framing; free-aiming, they turn the aim.
   */
  const steer = (
    self: DuelistState,
    intent: Intent,
    duelists: readonly DuelistState[],
    events: DuelEvent[]
  ): DuelistState => {
    const book = books(self.id);
    let next = self;

    const lockOnto = (target: DuelistState) => {
      book.hiddenTicks = 0;
      book.recentreTicks = 0;
      next = { ...next, lockNudge: noNudge, targetId: target.id };
      events.push({ duelistId: self.id, targetId: target.id, type: "lock-on" });
    };

    if (intent.lockOn && self.targetId !== null) {
      book.hiddenTicks = 0;
      next = { ...next, lockNudge: noNudge, targetId: null };
      events.push({
        duelistId: self.id,
        reason: "toggle",
        targetId: self.targetId,
        type: "lock-off",
      });
    } else if (intent.lockOn) {
      const near = nearestToCrosshair(self, duelists, tuning.lockOn.range);

      if (near) {
        lockOnto(near.opponent);
      } else {
        book.recentreTicks = ticksOf(tuning.lockOn.recentreSeconds);
      }
    } else if (self.targetId !== null && intent.switchTarget !== 0) {
      const switched = nextTarget(self, duelists, intent.switchTarget);

      if (switched) {
        lockOnto(switched);
      }
    }

    if (next.targetId !== null) {
      return { ...next, lockNudge: nudge(next.lockNudge, intent.look) };
    }

    const aim = look(next, intent.look, duelists);

    if (book.recentreTicks === 0) {
      return { ...next, aim };
    }

    // Recentring: the pitch glides back to rest over the remaining ticks.
    const pitch =
      aim.pitch + (tuning.aim.pitch.rest - aim.pitch) / book.recentreTicks;

    book.recentreTicks -= 1;

    return { ...next, aim: { ...aim, pitch } };
  };

  /**
   * A homing Spell turns toward its Target's chest by at most the homing
   * turn rate this tick, while its homing lasts and the Target is still
   * standing and ahead of it.
   */
  const home = (
    spell: SpellState,
    duelists: readonly DuelistState[]
  ): SpellState => {
    const { homing } = spell;

    if (!homing) {
      return spell;
    }

    const target = duelists.find((other) => other.id === homing.targetId);
    const heading = unit3(spell.velocity);

    const toChest = target
      ? towardPoint(spell.position, chestOf(target, tuning))
      : heading;

    const ahead =
      heading.x * toChest.x + heading.y * toChest.y + heading.z * toChest.z > 0;

    if (!target || target.knockedOut || !ahead || homing.secondsLeft <= 0) {
      return { ...spell, homing: null };
    }

    const turned = rotateToward(
      heading,
      toChest,
      tuning.lockOn.homing.turnRate * tickSeconds
    );

    return {
      ...spell,
      homing: { ...homing, secondsLeft: homing.secondsLeft - tickSeconds },
      velocity: scale(
        turned,
        Math.hypot(spell.velocity.x, spell.velocity.y, spell.velocity.z)
      ),
    };
  };

  let nextSpellId = 1;
  // Ticks until the current Round phase ends; 0 for phases without a clock.
  let phaseTicks = ticksOf(rounds.introSeconds);

  let current: DuelSnapshot = {
    duelists: lineUp(),
    round: {
      number: 1,
      phase: "intro",
      phaseSecondsLeft: rounds.introSeconds,
      winner: null,
    },
    score: Object.fromEntries(config.duelists.map(({ team }) => [team, 0])),
    spells: [],
    tick: 0,
    winner: null,
  };

  /** The tick being built: stages below read and replace its fields in order. */
  interface Draft {
    duelists: readonly DuelistState[];
    round: RoundState;
    score: Readonly<Record<TeamId, number>>;
    spells: readonly SpellState[];
    winner: TeamId | null;
    readonly events: DuelEvent[];
  }

  /** The Round's clock: intro → fighting, knockout → result → the next intro, or over. */
  const advanceClock = (draft: Draft) => {
    if (phaseTicks === 0) {
      return;
    }

    phaseTicks -= 1;

    if (phaseTicks > 0) {
      return;
    }

    const { round } = draft;

    if (round.phase === "intro") {
      draft.round = { ...round, phase: "fighting" };
      draft.events.push({ round: round.number, type: "round-start" });
    } else if (round.phase === "knockout" && draft.winner !== null) {
      draft.round = { ...round, phase: "over" };
    } else if (round.phase === "knockout") {
      draft.round = { ...round, phase: "result" };
      phaseTicks = ticksOf(rounds.resultSeconds);
    } else if (round.phase === "result") {
      draft.duelists = lineUp();
      draft.spells = [];
      draft.round = {
        number: round.number + 1,
        phase: "intro",
        phaseSecondsLeft: rounds.introSeconds,
        winner: null,
      };
      phaseTicks = ticksOf(rounds.introSeconds);
    }
  };

  /**
   * Spells in flight travel against where everyone stood at the start of the
   * tick. Duelists can only be hit while the Round is being fought, so a
   * Spell still in the air after a Knockout flies over the fallen. Returns
   * the damage each Duelist took.
   */
  const flySpells = (draft: Draft): Map<DuelistId, number> => {
    const flight = fly(
      draft.spells.map((spell) => home(spell, draft.duelists)),
      {
        arena,
        bodyHeight: tuning.duelist.height,
        bodyRadius,
        spellRadius: stupefy.radius,
        targets:
          draft.round.phase === "fighting"
            ? draft.duelists.filter((each) => !each.knockedOut)
            : [],
      },
      tickSeconds
    );

    draft.spells = flight.flying;
    const damage = new Map<DuelistId, number>();

    for (const outcome of flight.outcomes) {
      if (outcome.kind === "hit") {
        const { spell, targetId } = outcome;
        const amount = spell.strong ? stupefy.strongDamage : stupefy.damage;
        damage.set(targetId, (damage.get(targetId) ?? 0) + amount);

        // The strong Stupefy Staggers: no moving or casting for a moment.
        if (spell.strong) {
          books(targetId).staggerTicks = ticksOf(stupefy.staggerSeconds);
        }

        draft.events.push({
          damage: amount,
          position: outcome.position,
          spell,
          staggered: spell.strong,
          targetId,
          type: "spell-hit",
        });
      } else if (outcome.kind === "stopped") {
        draft.events.push({ ...outcome, type: "spell-stopped" });
      } else {
        draft.events.push({
          position: outcome.position,
          spells: outcome.spells,
          type: "spells-cancelled",
        });
      }
    }

    return damage;
  };

  /** Health drops by the damage taken; zero Health is a Knockout. */
  const applyDamage = (draft: Draft, damage: Map<DuelistId, number>) => {
    draft.duelists = draft.duelists.map((self) => {
      const health = Math.max(self.health - (damage.get(self.id) ?? 0), 0);
      const knockedOut = self.knockedOut || health === 0;

      if (knockedOut && !self.knockedOut) {
        draft.events.push({
          duelistId: self.id,
          position: self.position,
          type: "knockout",
        });
      }

      return { ...self, health, knockedOut };
    });
  };

  /**
   * The Round is decided once at most one Team is left standing; nobody
   * standing is a draw that scores for no one. The Knockout then plays out.
   */
  const decideRound = (draft: Draft) => {
    const standing = new Set(
      draft.duelists.filter((each) => !each.knockedOut).map((each) => each.team)
    );

    if (draft.round.phase !== "fighting" || standing.size > 1) {
      return;
    }

    const [roundWinner = null] = standing;

    draft.events.push({
      round: draft.round.number,
      type: "round-end",
      winner: roundWinner,
    });

    if (roundWinner !== null) {
      const won = (draft.score[roundWinner] ?? 0) + 1;
      draft.score = { ...draft.score, [roundWinner]: won };

      if (won >= rounds.roundsToWin) {
        draft.winner = roundWinner;
        draft.events.push({ type: "duel-end", winner: roundWinner });
      }
    }

    draft.round = { ...draft.round, phase: "knockout", winner: roundWinner };
    phaseTicks = ticksOf(
      rounds.knockout.realSeconds * rounds.knockout.timeScale
    );
  };

  /**
   * Light Spell timing for one Duelist this tick: true when a Stupefy leaves
   * the Wand. Casting happens on the press, or as soon as the last cast's
   * recovery ends if the press came during it.
   */
  const wantsToCast = (book: Bookkeeping, pressed: boolean) => {
    book.queued ||= pressed;

    if (!book.queued || book.recoveryTicks > 0) {
      return false;
    }

    book.queued = false;

    return true;
  };

  /**
   * Duelists aim, move and decide to cast. Looking around works during the
   * intro's countdown and while Staggered; moving and casting only while
   * fighting, standing and not Staggered.
   */
  const act = (
    draft: Draft,
    intentOf: (id: DuelistId) => Intent
  ): Set<DuelistId> => {
    const casters = new Set<DuelistId>();
    const byId = new Map(draft.duelists.map((each) => [each.id, each]));
    const { phase } = draft.round;

    const acted = draft.duelists.map((standing) => {
      const intent = intentOf(standing.id);
      const book = books(standing.id);
      const pressed = intent.lightSpell && !book.held;

      const canLook =
        (phase === "fighting" || phase === "intro") && !standing.knockedOut;

      const self = canLook
        ? steer(standing, intent, draft.duelists, draft.events)
        : standing;

      const canAct =
        phase === "fighting" && !self.knockedOut && book.staggerTicks === 0;

      book.held = intent.lightSpell;
      book.recoveryTicks = Math.max(book.recoveryTicks - 1, 0);
      book.staggerTicks = Math.max(book.staggerTicks - 1, 0);
      book.ticksSinceCast += 1;

      const staggerSeconds = book.staggerTicks * tickSeconds;

      if (!canAct) {
        book.queued = false;

        return { ...self, staggerSeconds };
      }

      if (wantsToCast(book, pressed)) {
        casters.add(self.id);
      }

      const move = clampLength(intent.move, 1);

      const target =
        self.targetId === null ? undefined : byId.get(self.targetId);

      const wanted = walk(
        self.position,
        self.aim.yaw,
        target?.position,
        move.x * stride,
        move.y * stride
      );

      // Other Duelists block at their position from the start of the tick, so
      // the result does not depend on the order Duelists are processed in.
      const others = draft.duelists
        .filter((other) => other.id !== self.id)
        .map((other) => ({ center: other.position, radius: bodyRadius }));

      const obstacles = [...arena.cover, ...arena.obstructions, ...others];

      return {
        ...self,
        position: collide(wanted, bodyRadius, obstacles, arena),
        staggerSeconds,
      };
    });

    draft.duelists = settleAim(acted, draft.events);

    return casters;
  };

  /**
   * New Stupefies leave the Wand toward the point under the crosshair. Casts
   * close enough together form a chain; every `chainLength`-th one is strong.
   */
  const cast = (draft: Draft, casters: Set<DuelistId>) => {
    for (const self of draft.duelists) {
      if (!casters.has(self.id)) {
        continue;
      }

      const book = books(self.id);
      const chained = book.ticksSinceCast <= ticksOf(stupefy.chainWindow);
      book.chain = chained ? book.chain + 1 : 1;
      const strong = book.chain >= stupefy.chainLength;

      if (strong) {
        book.chain = 0;
      }

      book.ticksSinceCast = 0;
      book.recoveryTicks = ticksOf(stupefy.castInterval);

      const origin = wandTip(self, tuning);
      const launch = towardPoint(origin, self.aimPoint);

      // Locked On: straight at the Target's chest where it stands now (no
      // lead), with a weak homing a strafe can still beat. Free-aiming: to
      // the point under the crosshair, bent by Aim Assist at launch only.
      const spell: SpellState = {
        casterId: self.id,
        homing:
          self.targetId === null
            ? null
            : {
                secondsLeft: tuning.lockOn.homing.seconds,
                targetId: self.targetId,
              },
        id: nextSpellId,
        kind: "stupefy",
        position: origin,
        strong,
        team: self.team,
        velocity: scale(
          self.targetId === null
            ? assistedLaunch(self, origin, launch, draft.duelists)
            : launch,
          stupefy.speed
        ),
      };

      nextSpellId += 1;
      draft.spells = [...draft.spells, spell];
      draft.events.push({ spell, type: "spell-cast" });
    }
  };

  const step = (intents: Readonly<Record<DuelistId, Intent>>): DuelTick => {
    const draft: Draft = { ...current, events: [] };

    advanceClock(draft);
    applyDamage(draft, flySpells(draft));
    decideRound(draft);
    cast(
      draft,
      act(draft, (id) => intents[id] ?? idleIntent)
    );

    current = {
      duelists: draft.duelists,
      round: { ...draft.round, phaseSecondsLeft: phaseTicks * tickSeconds },
      score: draft.score,
      spells: draft.spells,
      tick: current.tick + 1,
      winner: draft.winner,
    };

    return { events: draft.events, snapshot: current };
  };

  return { snapshot: () => current, step };
};
