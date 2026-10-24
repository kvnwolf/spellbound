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
import { chargeLevel, chargeStage } from "./charge";
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
  springStep,
  unit3,
  wrapAngle,
  yawOf,
} from "./geometry";
import type { Aim, GroundPoint, Point3 } from "./geometry";
import { idleIntent } from "./intent";
import type { Intent, Vec2 } from "./intent";
import { fullCharges, potionIn } from "./potions";
import type { LastingPotion, PotionKind, PotionSlot } from "./potions";
import { createPracticeKeeper } from "./practice";
import type { PracticeRules } from "./practice";
import {
  boundTo,
  focusCost,
  readiness,
  specialSpellKinds,
} from "./spell-slots";
import type { SpecialSpellKind, SpellSlot } from "./spell-slots";

export type { SpecialSpellKind, SpellSlot } from "./spell-slots";

export type { LastingPotion, PotionKind, PotionSlot } from "./potions";

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
  /**
   * Set for a Practice (see `practice.ts`): no Round intro, no Knockout and
   * no Round end, the learner's meters refilled and the rival's Health
   * recovered.
   */
  readonly practice?: PracticeRules;
  readonly tuning: Tuning;
}

export interface DuelistState {
  readonly id: DuelistId;
  readonly team: TeamId;
  readonly position: GroundPoint;
  /**
   * Unit vector the Duelist faces. Locked On, toward their Target. Free-aiming,
   * it turns toward where they walk and stays put while they stand still, so
   * the camera can orbit round to their face; casting, Charging or Shielding
   * turns it quickly to the aim (see `tuning.facing`).
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
  /**
   * How long the Heavy Spell has been Charging, in seconds since the press;
   * 0 when not Charging. A full Charge takes `tuning.confringo.fullSeconds`,
   * and a moment after that it Backfires (see `chargeStage`).
   */
  readonly chargeSeconds: number;
  /** Seconds left sliding back from a Confringo hit, unable to move or cast; 0 when not. */
  readonly knockbackSeconds: number;
  /** Knocked Out this Round: down, and out of the fight until the next Round. */
  readonly knockedOut: boolean;
  /**
   * In a Practice, seconds left down after the rival reached zero Health:
   * falling, lying until its Health comes back, then getting back up. Down,
   * it can neither act nor be hit. 0 when on its feet, and always 0 in a Duel.
   */
  readonly downSeconds: number;
  /**
   * Between 0 and `tuning.defence.stamina.max`; full again every Round. The
   * Shield, the Dodge, the jump and the sprint spend it, and it regenerates
   * a moment after it was last spent.
   */
  readonly stamina: number;
  /** How high the feet are off the Arena floor, metres: above 0 while jumping. */
  readonly elevation: number;
  /** Seconds left of a Dodge; the Duelist cannot be hit while it is above 0. */
  readonly dodgeSeconds: number;
  /** The Shield is up: Spells reaching the front half of the body are blocked (or Parried). */
  readonly shielding: boolean;
  /** Running at sprint speed this tick, draining Stamina. */
  readonly sprinting: boolean;
  /**
   * Ground velocity over the last tick, m/s. Walking eases it toward what
   * the stick asks (see `tuning.movement`), so starting, stopping and
   * turning take a moment, as a body's do; a Dodge dashes at once.
   */
  readonly velocity: GroundPoint;
  /**
   * Focus points, between 0 and `tuning.focus.max` (three segments of
   * `tuning.focus.segment`). Built by landing Light Spells, Parrying, Perfect
   * Dodging and taking damage; spent on Special Spells. Empty every Round,
   * and it never decays.
   */
  readonly focus: number;
  /** Seconds left before each Special Spell can be cast again; 0 when ready. */
  readonly cooldowns: Readonly<Record<SpecialSpellKind, number>>;
  /** The Spell Slots' modifier (R2) is held: a face button now casts from its slot. */
  readonly spellSlotsHeld: boolean;
  /** Seconds left of an Incendio Burn, taking damage over time; 0 when not burning. */
  readonly burnSeconds: number;
  /** Seconds left Petrified by Petrificus Totalus, frozen and unable to act; 0 when not. */
  readonly petrifiedSeconds: number;
  /**
   * The Duelist's Wand while they are Disarmed: knocked loose by
   * Expelliarmus, flying off and then lying on the Arena floor. Null while
   * it is in their hand. Disarmed, they cannot cast or Shield.
   */
  readonly looseWand: LooseWand | null;
  /** Charges left of each Potion this Round; full again every Round. */
  readonly potions: Readonly<Record<PotionKind, number>>;
  /**
   * The Potion being drunk, and how long until it is down; null when not
   * drinking. Drinking, the Duelist walks slowly and cannot cast, Shield,
   * Charge, Dodge or jump, and a Spell landing on them interrupts it.
   */
  readonly drinking: Drinking | null;
  /** Seconds left of each lasting Potion's effect; 0 while it is not active. */
  readonly potionEffects: Readonly<Record<LastingPotion, number>>;
  /** The Potion Slots' modifier (L2) is held: a face button now drinks from its slot. */
  readonly potionSlotsHeld: boolean;
}

/** A Potion on its way down. */
export interface Drinking {
  readonly kind: PotionKind;
  /** Seconds until it is drunk and takes effect. */
  readonly secondsLeft: number;
}

/** A Disarmed Duelist's Wand, out of their hand. */
export interface LooseWand {
  /** Where it is now: arcing through the air from the hand, then lying on the floor (y = 0). */
  readonly position: Point3;
  /** Where it comes to rest on the Arena floor: inside the walls, clear of Cover and Obstructions. */
  readonly landing: GroundPoint;
  /** Which way along the floor it was knocked (a unit vector), the way the hit flew. */
  readonly heading: GroundPoint;
  /** Lying on the floor, where its owner can pick it up by walking over it; false while still flying. */
  readonly grounded: boolean;
  /** Seconds until it returns to its owner's hand on its own. */
  readonly returnSeconds: number;
}

/** Stupefy is the Light Spell; Confringo the Heavy Spell; the rest are Special Spells. */
export type SpellKind = "confringo" | "stupefy" | SpecialSpellKind;

/**
 * The Spells that fly as projectiles: every one but Depulso, a cone of force
 * that lands the moment it is cast and is never in `DuelSnapshot.spells`.
 */
export type ProjectileKind = Exclude<SpellKind, "depulso">;

/** A Spell in flight. Ids are unique for the whole Duel, so views can track one across ticks. */
export interface SpellState {
  readonly id: number;
  readonly kind: SpellKind;
  readonly casterId: DuelistId;
  readonly team: TeamId;
  /** The stronger cast that ends a chain of consecutive Light Spells; it Staggers. */
  readonly strong: boolean;
  /** The Charge (0 to 1) a Confringo was released with, which scales its damage and knockback; 0 for Stupefy. */
  readonly charge: number;
  /** A Confringo released with a Perfect Release: more damage and knockback. */
  readonly empowered: boolean;
  /** Where it is; for Depulso, the Wand tip it blasts from. */
  readonly position: Point3;
  /**
   * Metres per second. Spells fly straight, unless homing. Depulso never
   * flies: its velocity is the axis of its cone, a unit vector on the floor.
   */
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

/** One side of a Clash: a Duelist and the Confringo they hold in the beam. */
export interface ClashSide {
  readonly duelistId: DuelistId;
  /** Their Confringo, out of the air while the Clash lasts. */
  readonly spell: SpellState;
  /** Their Wand tip, where their half of the beam starts. */
  readonly wand: Point3;
}

/**
 * A Clash in progress: two fully Charged Confringos locked in a beam
 * between their casters' Wands, both Duelists rooted, each pump pushing the
 * meeting point toward the opponent.
 */
export interface ClashState {
  readonly sides: readonly [ClashSide, ClashSide];
  /**
   * Where the meeting point sits along the beam: 0 at the first side's
   * Wand, 1 at the second's. The first side's pumps push it up, the
   * second's down; reaching a Wand wins the Clash for the other side.
   */
  readonly along: number;
  /** The meeting point itself, on the beam. */
  readonly point: Point3;
  /** Seconds before the Clash explodes if nobody wins it. */
  readonly secondsLeft: number;
}

/** A read-only picture of the Duel after a tick. A new object every tick. */
export interface DuelSnapshot {
  readonly tick: number;
  readonly duelists: readonly DuelistState[];
  readonly spells: readonly SpellState[];
  /** The Clash being fought, or null. */
  readonly clash: ClashState | null;
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
  /** A Heavy Spell was released in the Perfect Release window; `spell` is the empowered cast. */
  | {
      readonly type: "perfect-release";
      readonly duelistId: DuelistId;
      readonly spell: SpellState;
    }
  /** A Duelist held a full Charge too long: no Spell, they are hurt for `damage` and Staggered. `position` is their Wand tip. */
  | {
      readonly type: "backfire";
      readonly damage: number;
      readonly duelistId: DuelistId;
      readonly position: Point3;
    }
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
  | { readonly type: "duel-end"; readonly winner: TeamId }
  /** A Duelist left the floor. */
  | { readonly type: "jump"; readonly duelistId: DuelistId }
  /** A jumping Duelist touched down again. */
  | { readonly type: "land"; readonly duelistId: DuelistId }
  /** A Duelist started a Dodge, dashing along `direction` (a unit vector on the floor). */
  | {
      readonly type: "dodge";
      readonly duelistId: DuelistId;
      readonly direction: GroundPoint;
    }
  /**
   * A Dodge started just before `spell` would have hit (had the Duelist stood
   * still): what will build Focus.
   */
  | {
      readonly type: "perfect-dodge";
      readonly duelistId: DuelistId;
      readonly spell: SpellState;
    }
  /** A Shield stopped a Spell; the Spell is gone. */
  | {
      readonly type: "spell-blocked";
      readonly duelistId: DuelistId;
      readonly spell: SpellState;
      readonly position: Point3;
    }
  /**
   * A Shield raised just before `spell` landed Parried it: `reflected` is
   * the same Spell flying back at its caster, now cast by the Parrying Duelist.
   */
  | {
      readonly type: "parry";
      readonly duelistId: DuelistId;
      readonly spell: SpellState;
      readonly reflected: SpellState;
      readonly position: Point3;
    }
  /**
   * An Incendio exploded at `position` (on a Duelist, a Shield, another
   * Spell, Cover or the floor), leaving every opponent in the blast, Shield
   * or not, with a Burn: `burned`, by id.
   */
  | {
      readonly type: "explosion";
      readonly spell: SpellState;
      readonly position: Point3;
      readonly burned: readonly DuelistId[];
    }
  /**
   * An Expelliarmus (cast by `casterId`) Disarmed `duelistId`: their Wand
   * leaves their hand at `position` and flies off to land at `landing`.
   */
  | {
      readonly type: "disarm";
      readonly duelistId: DuelistId;
      readonly casterId: DuelistId;
      readonly position: Point3;
      readonly landing: GroundPoint;
    }
  /** A Disarmed Duelist's Wand came to rest on the Arena floor at `position`. */
  | {
      readonly type: "wand-landed";
      readonly duelistId: DuelistId;
      readonly position: GroundPoint;
    }
  /**
   * A Disarmed Duelist has their Wand back: they walked over it (`pickup`)
   * or it returned to their hand on its own (`return`). `position` is where
   * it was, on the floor or still in the air.
   */
  | {
      readonly type: "wand-recovered";
      readonly duelistId: DuelistId;
      readonly how: "pickup" | "return";
      readonly position: Point3;
    }
  /** A Duelist started drinking a Potion from its slot; its charge is spent. */
  | {
      readonly type: "potion-start";
      readonly duelistId: DuelistId;
      readonly kind: PotionKind;
    }
  /** A Potion is down and takes effect: Wiggenweld heals at once, the others start lasting. */
  | {
      readonly type: "potion-drunk";
      readonly duelistId: DuelistId;
      readonly kind: PotionKind;
    }
  /** A Spell landed on a Duelist drinking a Potion (or they lost control): the Potion is lost. */
  | {
      readonly type: "potion-interrupted";
      readonly duelistId: DuelistId;
      readonly kind: PotionKind;
    }
  /** A defence was asked for without enough Stamina, and refused. */
  | {
      readonly type: "stamina-short";
      readonly duelistId: DuelistId;
      readonly action: DefenceAction;
    }
  /** Two fully Charged Confringos met head-on and locked into a Clash. */
  | { readonly type: "clash-start"; readonly clash: ClashState }
  /** A Duelist in a Clash pumped, pushing the meeting point to where `clash` shows it. */
  | {
      readonly type: "clash-pump";
      readonly duelistId: DuelistId;
      readonly clash: ClashState;
    }
  /**
   * A Clash ended at `position`: `won` by `winnerId`, whose Confringo hits
   * the loser empowered (reported as its own Spell hit); `exploded` when
   * nobody won in time, knocking both Duelists back; or `interrupted` when
   * the Round stopped being fought (a Knockout) before either.
   */
  | {
      readonly type: "clash-end";
      readonly outcome: "exploded" | "interrupted" | "won";
      readonly winnerId: DuelistId | null;
      readonly clash: ClashState;
      readonly position: Point3;
    };

/** The defences paid for with Stamina. */
export type DefenceAction = "dodge" | "jump" | "shield" | "sprint";

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

/**
 * The ground direction a free-aiming Duelist walks for the stick `move`,
 * relative to where they look (`yaw`, the camera); undefined standing still.
 */
const walkHeading = (yaw: number, move: Vec2): GroundPoint | undefined => {
  if (Math.hypot(move.x, move.y) === 0) {
    return undefined;
  }

  const ahead = forwardOf(yaw);
  const side = rightOf(ahead);

  return direction(
    { x: 0, z: 0 },
    {
      x: ahead.x * move.y + side.x * move.x,
      z: ahead.z * move.y + side.z * move.x,
    }
  );
};

/**
 * The same spring on a rate itself (a velocity drawn toward `goal`, which
 * changes at `change`): the new rate, its change, and the distance covered.
 */
const rateSpring = (
  rate: number,
  change: number,
  goal: number,
  halflife: number,
  step: number
) => {
  const damping = (2 * Math.LN2) / halflife;
  const gap = rate - goal;
  const drift = change + gap * damping;
  const decay = Math.exp(-damping * step);

  return {
    change: decay * (change - drift * damping * step),
    covered:
      decay * (-drift / (damping * damping) + (-gap - drift * step) / damping) +
      drift / (damping * damping) +
      gap / damping +
      goal * step,
    rate: decay * (gap + drift * step) + goal,
  };
};

/** How much of `vector` lies along the unit ground vector `axis`. */
const alongAxis = (vector: GroundPoint, axis: GroundPoint) =>
  vector.x * axis.x + vector.z * axis.z;

/**
 * `facing` turned toward the unit ground vector `toward` by at most
 * `maxTurn` radians, the short way round (a half turn always the same way).
 */
const turnToward = (
  facing: GroundPoint,
  toward: GroundPoint,
  maxTurn: number
): GroundPoint => {
  const from = yawOf(facing);
  const left = wrapAngle(yawOf(toward) - from);

  return Math.abs(left) <= maxTurn
    ? toward
    : forwardOf(from + Math.sign(left) * maxTurn);
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

/** A Duelist's chest, wherever it is mid-jump: where Lock-on and Aim Assist aim at them. */
const chestOf = (duelist: DuelistState, tuning: Tuning): Point3 => ({
  x: duelist.position.x,
  y: tuning.duelist.chestHeight + duelist.elevation,
  z: duelist.position.z,
});

/**
 * Per-Duelist bookkeeping the snapshot has no need to show. Timers count
 * whole ticks so cadences are exact instead of drifting with float sums.
 */
interface Bookkeeping {
  /** How the walking velocity is changing, m/s² (world): the velocity spring's other half. */
  acceleration: GroundPoint;
  /**
   * Where last tick's walk meant to end, and the spring's velocity there
   * (the tick's own average lags it): when the Duelist did end there,
   * nothing having stopped or pushed them, the spring carries on from it.
   */
  walk: { readonly to: GroundPoint; readonly rate: GroundPoint } | undefined;
  /** How fast a walk is turning the facing, radians a second: the facing spring's other half. */
  turnSpeed: number;
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
  /** The Heavy Spell button was down last tick: a Charge starts on the press. */
  heavyHeld: boolean;
  /** Ticks the current Charge has been held, the press included; 0 when not Charging. */
  chargeTicks: number;
  /**
   * A knockback in progress (Confringo's, or Depulso's): sliding `distance`
   * metres along `direction` over `ticks` ticks, `ticksLeft` of them still to
   * go. A `guarded` slide (Depulso's push on a Shield) keeps the Shield up.
   */
  knockback:
    | {
        readonly direction: GroundPoint;
        readonly distance: number;
        readonly guarded?: boolean;
        readonly ticks: number;
        ticksLeft: number;
      }
    | undefined;
  /** The defence buttons as they were last tick, so a press can be told from a hold. */
  buttons: Readonly<Record<DefenceAction, boolean>>;
  /**
   * The Shield and the sprint start on a press and last while the button is
   * held; running out of Stamina (and, for the Shield, a Dodge or a Stagger)
   * ends them until the next press. So a held L1 never re-raises the Shield
   * by itself, which would otherwise be a free Parry.
   */
  shieldHeld: boolean;
  sprintHeld: boolean;
  /** The tick the Shield last went up on: the Parry window counts from it. */
  shieldRaisedTick: number;
  /** Ticks left of the current Dodge, and how far it carries the Duelist each tick. */
  dodgeTicks: number;
  dodgeStep: GroundPoint;
  /** Upward speed while airborne, m/s (negative falling). */
  verticalSpeed: number;
  /** Ticks to wait before Stamina regenerates again. */
  regenTicks: number;
  /** Ticks left of each Special Spell's Cooldown. */
  cooldownTicks: Record<SpecialSpellKind, number>;
  /** Ticks left of an Incendio Burn. */
  burnTicks: number;
  /** Ticks left Petrified. */
  petrifiedTicks: number;
  /** The Wand knocked loose by Expelliarmus, while Disarmed. */
  wand: LostWand | undefined;
  /** The Clash pump was down last tick: a Clash counts presses, not the hold. */
  pumpHeld: boolean;
  /** The Potion being drunk and the ticks until it is down. */
  drink: { readonly kind: PotionKind; ticksLeft: number } | undefined;
  /** Ticks left of each lasting Potion's effect. */
  effectTicks: Record<LastingPotion, number>;
}

/** A Wand knocked loose: where it left the hand, where it lands, and how many ticks since. */
interface LostWand {
  readonly from: Point3;
  readonly landing: GroundPoint;
  readonly heading: GroundPoint;
  ageTicks: number;
}

/**
 * What a Duelist lets go of this tick: a Light Spell, a Heavy Spell after
 * Charging for `chargeSeconds`, or a Special Spell from a Spell Slot.
 */
type Release =
  | { readonly kind: "stupefy" }
  | { readonly kind: "confringo"; readonly chargeSeconds: number }
  | { readonly kind: SpecialSpellKind };

const freshBookkeeping = (): Bookkeeping => ({
  acceleration: { x: 0, z: 0 },
  burnTicks: 0,
  buttons: { dodge: false, jump: false, shield: false, sprint: false },
  chain: 0,
  chargeTicks: 0,
  cooldownTicks: { depulso: 0, expelliarmus: 0, incendio: 0, petrificus: 0 },
  dodgeStep: { x: 0, z: 0 },
  dodgeTicks: 0,
  drink: undefined,
  effectTicks: { strength: 0, swiftness: 0 },
  heavyHeld: false,
  held: false,
  hiddenTicks: 0,
  knockback: undefined,
  petrifiedTicks: 0,
  pumpHeld: false,
  queued: false,
  recentreTicks: 0,
  recoveryTicks: 0,
  regenTicks: 0,
  shieldHeld: false,
  shieldRaisedTick: 0,
  sprintHeld: false,
  staggerTicks: 0,
  ticksSinceCast: Number.POSITIVE_INFINITY,
  turnSpeed: 0,
  verticalSpeed: 0,
  walk: undefined,
  wand: undefined,
});

const noNudge: Aim = { pitch: 0, yaw: 0 };

/** A Special Spell leaving the Wand this tick, and the Focus it costs. */
interface SpecialCast {
  readonly kind: SpecialSpellKind;
  readonly cost: number;
}

/** The Duelist `id` is locked in a Clash with, or undefined when they are in none. */
export const clashOpponentOf = (
  clash: ClashState | null,
  id: DuelistId
): DuelistId | undefined => {
  if (!clash) {
    return undefined;
  }

  const [first, second] = clash.sides;

  if (first.duelistId === id) {
    return second.duelistId;
  }

  return second.duelistId === id ? first.duelistId : undefined;
};

/**
 * Whether a Duelist is on their feet: not Knocked Out, and not down in a
 * Practice after reaching zero Health. Only a Duelist on their feet acts,
 * is hit or is seen.
 */
export const onFeet = (
  self: Pick<DuelistState, "downSeconds" | "knockedOut">
): boolean => !self.knockedOut && self.downSeconds === 0;

/**
 * Whether a Duelist looks around (turns, Locks On, holds the Spell Slots)
 * this tick: standing, during the intro or the fight, and not rooted in a
 * Clash, where △ is the pump and nothing else moves.
 */
const looksAround = (
  self: DuelistState,
  phase: RoundPhase,
  clash: ClashState | null
) =>
  (phase === "fighting" || phase === "intro") &&
  onFeet(self) &&
  clashOpponentOf(clash, self.id) === undefined;

/** Where a Duelist's Spells leave the Wand. */
export const wandTip = (self: DuelistState, tuning: Tuning): Point3 => {
  const { forward, height, right } = tuning.duelist.wandTip;
  const side = rightOf(self.facing);

  return {
    x: self.position.x + self.facing.x * forward + side.x * right,
    y: height + self.elevation,
    z: self.position.z + self.facing.z * forward + side.z * right,
  };
};

const scale = (vector: Point3, by: number): Point3 => ({
  x: vector.x * by,
  y: vector.y * by,
  z: vector.z * by,
});

/**
 * Which way a Dodge dashes, as a unit vector on the floor: the move
 * direction, relative to where the Duelist looks (the camera) while
 * free-aiming, or to the line toward the Target while Locked On. With no
 * direction held, straight back.
 */
const dodgeHeading = (
  self: DuelistState,
  move: Vec2,
  target: DuelistState | undefined
): GroundPoint => {
  const stick = Math.hypot(move.x, move.y) > 0 ? move : { x: 0, y: -1 };

  const ahead = target
    ? direction(self.position, target.position)
    : forwardOf(self.aim.yaw);

  const side = rightOf(ahead);

  return direction(
    { x: 0, z: 0 },
    {
      x: ahead.x * stick.y + side.x * stick.x,
      z: ahead.z * stick.y + side.z * stick.x,
    }
  );
};

export const createDuel = (config: DuelConfig): Duel => {
  const { arena, tuning } = config;
  const { bodyRadius } = tuning.duelist;

  const {
    confringo,
    depulso,
    expelliarmus,
    incendio,
    petrificus,
    round: rounds,
    stupefy,
  } = tuning;

  /** The radius of a Spell's sphere, for collisions; Depulso never flies. */
  const spellRadius = (spell: SpellState) =>
    spell.kind === "depulso" ? 0 : tuning[spell.kind].radius;

  const tickSeconds = 1 / tuning.tickRate;
  const stride = () => tuning.duelist.walkSpeed * tickSeconds;
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

  // Facing turns to the aim fast enough to finish a half turn in
  // `aimTurnSeconds` (a walk turns it on a spring: see `turnFacing`).
  const aimTurn = (Math.PI / tuning.facing.aimTurnSeconds) * tickSeconds;
  const aimHoldTicks = ticksOf(tuning.facing.aimHoldSeconds);

  /**
   * Which way a Duelist faces after this tick, Locked On or not (the lock
   * holds the camera and the aim, not the body). `aiming` (casting,
   * Charging, Shielding, or just after a cast) turns them to the aim, fast;
   * otherwise a walk along `heading` turns them toward it, and standing
   * still (or Dodging) keeps the facing.
   */
  const turnFacing = (
    self: DuelistState,
    book: Bookkeeping,
    aiming: boolean,
    heading: GroundPoint | undefined
  ): GroundPoint => {
    if (aiming) {
      book.turnSpeed = 0;

      return turnToward(self.facing, forwardOf(self.aim.yaw), aimTurn);
    }

    if (!heading) {
      book.turnSpeed = 0;

      return self.facing;
    }

    // A walk turns the body on a spring: it eases into the turn and out of
    // it, however far round it goes.
    const from = yawOf(self.facing);

    const turned = springStep(
      0,
      book.turnSpeed,
      wrapAngle(yawOf(heading) - from),
      tuning.movement.turnHalflife,
      tickSeconds
    );

    book.turnSpeed = turned.rate;

    return forwardOf(from + turned.value);
  };

  /**
   * `vector` (a velocity or its change) turned by how far round `target`
   * the Duelist moved with `velocity` last tick, so it keeps its bearing
   * to the Target.
   */
  const orbitTurned = (
    vector: GroundPoint,
    position: GroundPoint,
    velocity: GroundPoint,
    target: GroundPoint
  ): GroundPoint => {
    const before = {
      x: position.x - velocity.x * tickSeconds,
      z: position.z - velocity.z * tickSeconds,
    };

    const turn = wrapAngle(
      yawOf(direction(position, target)) - yawOf(direction(before, target))
    );

    const cos = Math.cos(turn);
    const sin = Math.sin(turn);

    // Turned the way `forwardOf` turns as the yaw grows.
    return {
      x: vector.x * cos - vector.z * sin,
      z: vector.z * cos + vector.x * sin,
    };
  };

  /** Notes where a walk means to end and the spring's velocity there, and returns the spot. */
  const walkTo = (
    book: Bookkeeping,
    to: GroundPoint,
    rate: GroundPoint
  ): GroundPoint => {
    book.walk = { rate, to };

    return to;
  };

  /**
   * Where a walk toward `wanted` (this tick's step at the stick's full
   * pace) actually takes the Duelist: their velocity is drawn toward that
   * step's by a critically damped spring (`tuning.movement`: half the gap
   * closed every `speedUpHalflife` seconds, `slowDownHalflife` when
   * slowing or turning back), from what they last moved (no faster than a
   * run), so it never jolts. Locked On, the spring works in the Target's
   * frame, closing and circling, so strafing keeps orbiting at a constant
   * distance.
   */
  const easeStep = (
    self: DuelistState,
    book: Bookkeeping,
    wanted: GroundPoint,
    swift: number,
    target: GroundPoint | undefined
  ): GroundPoint => {
    const top =
      tuning.duelist.walkSpeed * tuning.defence.sprint.speedScale * swift;

    // The spring's own velocity if last tick's walk went as meant, else
    // what the Duelist actually moved. Locked On, it (and its change) turn
    // with the Duelist round the Target.
    const meant =
      book.walk && distanceBetween(book.walk.to, self.position) < 1e-9
        ? book.walk.rate
        : self.velocity;

    const carried = target
      ? orbitTurned(meant, self.position, self.velocity, target)
      : meant;

    const changing = target
      ? orbitTurned(book.acceleration, self.position, self.velocity, target)
      : book.acceleration;

    // As a stick-style vector: x across, y along z.
    const capped = clampLength({ x: carried.x, y: carried.z }, top);
    const now = { x: capped.x, z: capped.y };

    const asked = {
      x: (wanted.x - self.position.x) / tickSeconds,
      z: (wanted.z - self.position.z) / tickSeconds,
    };

    const halflife =
      Math.hypot(asked.x, asked.z) >= Math.hypot(now.x, now.z)
        ? tuning.movement.speedUpHalflife
        : tuning.movement.slowDownHalflife;

    const spring = (rate: number, change: number, goal: number) =>
      rateSpring(rate, change, goal, halflife, tickSeconds);

    const distance = target ? distanceBetween(self.position, target) : 0;

    if (!target || distance < 1e-6) {
      const x = spring(now.x, changing.x, asked.x);
      const z = spring(now.z, changing.z, asked.z);
      book.acceleration = { x: x.change, z: z.change };

      return walkTo(
        book,
        { x: self.position.x + x.covered, z: self.position.z + z.covered },
        { x: x.rate, z: z.rate }
      );
    }

    // Round the Target, in its frame: toward it shortens the distance (by
    // exactly what the walk asked), across it turns the Duelist round.
    const toward = direction(self.position, target);
    const across = rightOf(toward);

    // How fast it last closed on the Target, from the distances themselves
    // (a step round a circle is a chord, whose inward lean is not closing).
    const before = {
      x: self.position.x - self.velocity.x * tickSeconds,
      z: self.position.z - self.velocity.z * tickSeconds,
    };

    const closing = Math.min(
      Math.max(
        (distanceBetween(before, target) - distance) / tickSeconds,
        -top
      ),
      top
    );

    const closer = spring(
      closing,
      alongAxis(changing, toward),
      (distance - distanceBetween(wanted, target)) / tickSeconds
    );

    const circling = spring(
      alongAxis(now, across),
      alongAxis(changing, across),
      alongAxis(asked, across)
    );

    book.acceleration = {
      x: toward.x * closer.change + across.x * circling.change,
      z: toward.z * closer.change + across.z * circling.change,
    };

    const reach = Math.max(distance - closer.covered, 0);
    const offsetX = self.position.x + across.x * circling.covered - target.x;
    const offsetZ = self.position.z + across.z * circling.covered - target.z;
    const offset = Math.hypot(offsetX, offsetZ);

    return walkTo(
      book,
      {
        x: target.x + (offsetX / offset) * reach,
        z: target.z + (offsetZ / offset) * reach,
      },
      {
        x: toward.x * closer.rate + across.x * circling.rate,
        z: toward.z * closer.rate + across.z * circling.rate,
      }
    );
  };

  /** Still facing the aim after a cast: a burst on the move never swings the Duelist about. */
  const castRecently = (book: Bookkeeping) =>
    book.ticksSinceCast < aimHoldTicks;

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
   * moved this tick. Locked On: they aim at the Target's chest (the framing
   * nudge only turns the aim, i.e. the camera). Free-aiming: their Spells go
   * to the point under the crosshair, the first thing their aim ray
   * reaches, other standing Duelists included. Either way the facing is
   * left as `act` turned it. A lock that breaks leaves the aim exactly
   * where it was.
   */
  const settleAim = (
    duelists: readonly DuelistState[],
    events: DuelEvent[],
    clash: ClashState | null = null
  ): DuelistState[] =>
    duelists.map((self) => {
      if (self.knockedOut) {
        return self;
      }

      // Locked in a Clash, a Duelist faces their opponent down the beam,
      // whatever the lock or the stick says.
      const foeId = clashOpponentOf(clash, self.id);
      const foe = duelists.find((other) => other.id === foeId);

      if (foe) {
        const chest = chestOf(foe, tuning);

        return {
          ...self,
          aim: aimAt(self.position, chest, arena, eye),
          aimPoint: chest,
          facing: direction(self.position, foe.position),
          lockNudge: noNudge,
        };
      }

      const target = keepLock(self, duelists, events);

      if (target) {
        const chest = chestOf(target, tuning);

        return {
          ...self,
          aim: addAim(aimAt(self.position, chest, arena, eye), self.lockNudge),
          aimPoint: chest,
          targetHiddenSeconds: books(self.id).hiddenTicks * tickSeconds,
        };
      }

      const bodies = duelists.flatMap((other) =>
        other.id === self.id || !onFeet(other)
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
        lockNudge: noNudge,
        targetHiddenSeconds: 0,
        targetId: null,
      };
    });

  /**
   * Everyone back at their spawn at full Health, as every Round starts, each
   * looking at the nearest opponent's chest and facing the way they look.
   */
  const lineUp = (): DuelistState[] => {
    bookkeeping.clear();

    const spawned: DuelistState[] = config.duelists.map((setup) => ({
      aim: { pitch: tuning.aim.pitch.rest, yaw: 0 },
      aimPoint: { x: setup.spawn.x, y: 0, z: setup.spawn.z },
      burnSeconds: 0,
      chargeSeconds: 0,
      cooldowns: { depulso: 0, expelliarmus: 0, incendio: 0, petrificus: 0 },
      dodgeSeconds: 0,
      downSeconds: 0,
      drinking: null,
      elevation: 0,
      facing: defaultForward,
      // Focus starts empty every Round.
      focus: 0,
      health: tuning.duelist.health,
      id: setup.id,
      knockbackSeconds: 0,
      knockedOut: false,
      lockNudge: noNudge,
      looseWand: null,
      petrifiedSeconds: 0,
      position: setup.spawn,
      potionEffects: { strength: 0, swiftness: 0 },
      potionSlotsHeld: false,
      // Every Potion's charges refill every Round.
      potions: fullCharges(tuning),
      shielding: false,
      spellSlotsHeld: false,
      sprinting: false,
      staggerSeconds: 0,
      stamina: tuning.defence.stamina.max,
      targetHiddenSeconds: 0,
      targetId: null,
      team: setup.team,
      velocity: { x: 0, z: 0 },
    }));

    return settleAim(
      spawned.map((self) => {
        const opponent = nearest(
          self.position,
          spawned.filter((other) => other.team !== self.team)
        );

        if (!opponent) {
          return self;
        }

        const aim = aimAt(self.position, chestOf(opponent, tuning), arena, eye);

        return { ...self, aim, facing: forwardOf(aim.yaw) };
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
        onFeet(other) &&
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

      if (
        near &&
        near.angle <= tuning.lockOn.acquireCrosses * tuning.aimAssist.bendAngle
      ) {
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

  const { practice } = config;
  const practiceKeeper = practice && createPracticeKeeper(practice, tuning);
  // A Practice skips the Round intro: it is fought from the first tick.
  const introSeconds = practice ? 0 : rounds.introSeconds;

  // Ticks until the current Round phase ends; 0 for phases without a clock.
  let phaseTicks = ticksOf(introSeconds);

  let current: DuelSnapshot = {
    clash: null,
    // A Training lesson on Special Spells starts the learner with full Focus.
    duelists: lineUp().map((self) =>
      practice?.fullFocus === true && self.id === practice.learner
        ? { ...self, focus: tuning.focus.max }
        : self
    ),
    round: {
      number: 1,
      phase: practice ? "fighting" : "intro",
      phaseSecondsLeft: introSeconds,
      winner: null,
    },
    score: Object.fromEntries(config.duelists.map(({ team }) => [team, 0])),
    spells: [],
    tick: 0,
    winner: null,
  };

  /** The number of the tick being built (the snapshot's tick once it is done). */
  const tickInProgress = () => current.tick + 1;

  /** The tick being built: stages below read and replace its fields in order. */
  interface Draft {
    clash: ClashState | null;
    duelists: readonly DuelistState[];
    round: RoundState;
    score: Readonly<Record<TeamId, number>>;
    spells: readonly SpellState[];
    winner: TeamId | null;
    readonly events: DuelEvent[];
    /** What Backfires cost their casters this tick, applied once the Duelists have acted. */
    readonly backfires: Map<DuelistId, number>;
    /** What Depulso's cone costs the Duelists it caught this tick, applied once the Spells are cast. */
    readonly blasts: Map<DuelistId, number>;
    /** How many of `events` have been checked for hits interrupting a Potion. */
    checkedForDrinks: number;
  }

  const { defence } = tuning;

  /**
   * The Wand in hand and not mid-Dodge: free to Shield or cast. Disarmed,
   * the Wand is not in hand: no Shield, no Spells.
   */
  const handsFree = (book: Bookkeeping) =>
    book.dodgeTicks === 0 && book.wand === undefined;

  /** Stamina as it is spent through one tick; `unlimited` under a Swiftness Potion, when nothing costs any. */
  interface Purse {
    stamina: number;
    spent: boolean;
    readonly unlimited: boolean;
  }

  /** A Duelist's Stamina for this tick: under a Swiftness Potion it stays full and nothing spends it. */
  const purseOf = (self: DuelistState, book: Bookkeeping): Purse => {
    const unlimited = book.effectTicks.swiftness > 0;

    return {
      spent: false,
      stamina: unlimited ? defence.stamina.max : self.stamina,
      unlimited,
    };
  };

  const spend = (purse: Purse, amount: number) => {
    if (purse.unlimited) {
      return;
    }

    purse.stamina = Math.max(purse.stamina - amount, 0);
    purse.spent = true;
  };

  /** Stamina regenerates only once nothing has been spent for a moment. */
  const regenerate = (book: Bookkeeping, purse: Purse) => {
    if (purse.spent) {
      book.regenTicks = ticksOf(defence.stamina.regenDelay);
    } else if (book.regenTicks > 0) {
      book.regenTicks -= 1;
    } else {
      purse.stamina = Math.min(
        purse.stamina + defence.stamina.regenRate * tickSeconds,
        defence.stamina.max
      );
    }
  };

  const refuse = (self: DuelistState, action: DefenceAction, draft: Draft) =>
    draft.events.push({ action, duelistId: self.id, type: "stamina-short" });

  /** The jump's flight: gravity pulls an airborne Duelist down until they land. Returns the new elevation. */
  const fall = (self: DuelistState, book: Bookkeeping, draft: Draft) => {
    if (self.elevation === 0 && book.verticalSpeed <= 0) {
      return 0;
    }

    book.verticalSpeed -= defence.jump.gravity * tickSeconds;

    const elevation = Math.max(
      self.elevation + book.verticalSpeed * tickSeconds,
      0
    );

    if (elevation === 0) {
      book.verticalSpeed = 0;
      draft.events.push({ duelistId: self.id, type: "land" });
    }

    return elevation;
  };

  /**
   * The Spell that would hit `self` within the Perfect Dodge window if they
   * stood still, if any: every opposing Spell in the air flown ahead along
   * its current line against `self`'s body.
   */
  const threatTo = (
    self: DuelistState,
    spells: readonly SpellState[]
  ): SpellState | undefined => {
    const ahead = fly(
      spells.filter((spell) => spell.team !== self.team),
      {
        arena,
        bodyHeight: tuning.duelist.height,
        bodyRadius,
        radiusOf: spellRadius,
        targets: [self],
      },
      defence.dodge.perfectWindow
    );

    for (const outcome of ahead.outcomes) {
      if (outcome.kind === "hit") {
        return outcome.spell;
      }
    }

    return undefined;
  };

  /** Starts a Dodge, if there is Stamina for it; a Perfect Dodge when a Spell is about to land. */
  const startDodge = (
    self: DuelistState,
    move: Vec2,
    target: DuelistState | undefined,
    purse: Purse,
    draft: Draft
  ) => {
    if (purse.stamina < defence.dodge.cost) {
      refuse(self, "dodge", draft);

      return;
    }

    const book = books(self.id);
    spend(purse, defence.dodge.cost);
    book.dodgeTicks = ticksOf(defence.dodge.seconds);
    const heading = dodgeHeading(self, move, target);
    const reach = defence.dodge.distance / book.dodgeTicks;
    book.dodgeStep = { x: heading.x * reach, z: heading.z * reach };
    draft.events.push({
      direction: heading,
      duelistId: self.id,
      type: "dodge",
    });

    const threat = threatTo(self, draft.spells);

    if (threat) {
      draft.events.push({
        duelistId: self.id,
        spell: threat,
        type: "perfect-dodge",
      });
    }
  };

  /** Leaves the floor, if there is Stamina for it. */
  const startJump = (self: DuelistState, purse: Purse, draft: Draft) => {
    if (purse.stamina < defence.jump.cost) {
      refuse(self, "jump", draft);

      return;
    }

    spend(purse, defence.jump.cost);
    books(self.id).verticalSpeed = defence.jump.speed;
    draft.events.push({ duelistId: self.id, type: "jump" });
  };

  /**
   * Whether a held action (the Shield or the sprint) carries on this tick:
   * it starts on a press with any Stamina left, lasts while `held` (and
   * while `allowed`), and once it ends, only a new press starts it again.
   */
  const keepHolding = (
    self: DuelistState,
    action: "shield" | "sprint",
    {
      allowed,
      held,
      pressed,
      running,
    }: {
      readonly allowed: boolean;
      readonly held: boolean;
      readonly pressed: boolean;
      readonly running: boolean;
    },
    purse: Purse,
    draft: Draft
  ): boolean => {
    if (!allowed || !held) {
      return false;
    }

    if (!pressed) {
      return running;
    }

    if (purse.stamina > 0) {
      return true;
    }

    refuse(self, action, draft);

    return false;
  };

  /**
   * What holding the Shield and sprinting cost this tick. A Shield going up
   * notes the tick, which the Parry window counts from. Out of Stamina, the
   * Shield drops and the sprint ends, until pressed again.
   */
  const drain = (
    book: Bookkeeping,
    shielding: boolean,
    sprinting: boolean,
    purse: Purse
  ) => {
    if (shielding && !book.shieldHeld) {
      book.shieldRaisedTick = tickInProgress();
    }

    book.shieldHeld = shielding;

    if (shielding) {
      spend(purse, defence.shield.drain * tickSeconds);
    }

    if (sprinting) {
      spend(purse, defence.sprint.drain * tickSeconds);
    }

    if (purse.stamina === 0) {
      book.shieldHeld = false;
      book.sprintHeld = false;
    }
  };

  /** The walking stride's multiplier: slower behind the Shield, faster sprinting. */
  const paceOf = (shielding: boolean, sprinting: boolean) => {
    if (shielding) {
      return defence.shield.walkScale;
    }

    return sprinting ? defence.sprint.speedScale : 1;
  };

  /** What a Duelist's defence settled this tick, for `act` to move and cast by. */
  interface Guard {
    readonly state: Pick<
      DuelistState,
      "dodgeSeconds" | "elevation" | "shielding" | "sprinting" | "stamina"
    >;
    /** How far a Dodge carries the Duelist this tick; it replaces walking. */
    readonly dash: GroundPoint | undefined;
    /** The walking stride's multiplier: faster sprinting, slower behind the Shield. */
    readonly pace: number;
    /** No casting mid-Dodge, behind the Shield or Disarmed. */
    readonly canCast: boolean;
    /** Off the floor (or leaving it this tick): only the Light Spell can be cast. */
    readonly airborne: boolean;
  }

  /**
   * Defence for one Duelist this tick: the jump's flight, then Dodge, jump,
   * Shield and sprint from the Intent, and the Stamina they spend. Dodge and
   * jump happen on the press, never in the air or mid-Dodge; the Shield goes
   * up on the press (which is what times a Parry) and the sprint starts on
   * it, both lasting while held. Anything costing more Stamina than is left
   * is refused. Gravity and regeneration run even when the Duelist cannot
   * act (Staggered, or outside the fight). `canGuard`: whether the Shield
   * can stay up, as when they can act, or sliding back from a Depulso
   * behind it, when they cannot.
   */
  const defend = (
    self: DuelistState,
    intent: Intent,
    canAct: boolean,
    target: DuelistState | undefined,
    draft: Draft,
    canGuard = canAct
  ): Guard => {
    const book = books(self.id);
    const was = book.buttons;
    const pressed = (action: DefenceAction) => intent[action] && !was[action];

    book.buttons = {
      dodge: intent.dodge,
      jump: intent.jump,
      shield: intent.shield,
      sprint: intent.sprint,
    };

    const purse = purseOf(self, book);
    const elevation = fall(self, book, draft);
    const grounded = elevation === 0 && book.verticalSpeed === 0;
    book.dodgeTicks = Math.max(book.dodgeTicks - 1, 0);

    if (canAct && grounded && book.dodgeTicks === 0 && pressed("dodge")) {
      startDodge(self, intent.move, target, purse, draft);
    }

    const dodging = book.dodgeTicks > 0;

    if (canAct && grounded && !dodging && pressed("jump")) {
      startJump(self, purse, draft);
    }

    const handy = handsFree(book);

    // The Shield drops mid-Dodge, when Staggered or Disarmed, or on release.
    const shielding = keepHolding(
      self,
      "shield",
      {
        allowed: canGuard && handy,
        held: intent.shield,
        pressed: pressed("shield"),
        running: book.shieldHeld,
      },
      purse,
      draft
    );

    book.sprintHeld = keepHolding(
      self,
      "sprint",
      {
        allowed: canAct,
        held: intent.sprint,
        pressed: pressed("sprint"),
        running: book.sprintHeld,
      },
      purse,
      draft
    );

    // Sprinting only costs anything while actually running, and holding a
    // Charge (△) keeps the Duelist to a creep.
    const sprinting =
      book.sprintHeld &&
      book.chargeTicks === 0 &&
      !intent.heavySpell &&
      !shielding &&
      !dodging &&
      Math.hypot(intent.move.x, intent.move.y) > 0;

    drain(book, shielding, sprinting, purse);
    regenerate(book, purse);

    return {
      airborne: elevation > 0 || book.verticalSpeed > 0,
      canCast: handy && !shielding,
      dash: dodging ? book.dodgeStep : undefined,
      pace: paceOf(shielding, sprinting),
      state: {
        dodgeSeconds: book.dodgeTicks * tickSeconds,
        elevation,
        shielding: book.shieldHeld,
        sprinting,
        stamina: purse.stamina,
      },
    };
  };

  /**
   * What a Spell that reached `self` does: Parried back at its caster when
   * the Shield went up within the Parry window before it landed, blocked by
   * a Shield that was up earlier, or a hit. The Shield covers the front half
   * of the body, the side the Duelist faces: a Spell landing behind that
   * line gets through.
   */
  const meetShield = (
    self: DuelistState,
    spell: SpellState,
    contact: Point3,
    draft: Draft
  ): "blocked" | "hit" | "parried" => {
    const front =
      (contact.x - self.position.x) * self.facing.x +
        (contact.z - self.position.z) * self.facing.z >=
      0;

    if (!self.shielding || !front) {
      return "hit";
    }

    const raisedFor =
      (tickInProgress() - books(self.id).shieldRaisedTick) * tickSeconds;

    if (raisedFor > defence.shield.parryWindow) {
      draft.events.push({
        duelistId: self.id,
        position: contact,
        spell,
        type: "spell-blocked",
      });

      return "blocked";
    }

    // Reflected: the same Spell, now the Parrying Duelist's, flying straight
    // back at its caster's chest (or back the way it came if they are down).
    const caster = draft.duelists.find((each) => each.id === spell.casterId);

    const speed = Math.hypot(
      spell.velocity.x,
      spell.velocity.y,
      spell.velocity.z
    );

    const heading =
      caster && !caster.knockedOut
        ? towardPoint(contact, chestOf(caster, tuning))
        : unit3(scale(spell.velocity, -1));

    const reflected: SpellState = {
      ...spell,
      casterId: self.id,
      homing: null,
      id: nextSpellId,
      position: contact,
      team: self.team,
      velocity: scale(heading, speed),
    };

    nextSpellId += 1;
    draft.spells = [...draft.spells, reflected];
    draft.events.push({
      duelistId: self.id,
      position: contact,
      reflected,
      spell,
      type: "parry",
    });

    return "parried";
  };

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
      draft.clash = null;
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
   * What a Spell does to the Duelist it hits: damage, and how many metres it
   * knocks them back. Confringo scales both with its Charge, from a tap's
   * minimum to a full Charge's, and a Perfect Release empowers both.
   */
  const impactOf = (spell: SpellState) => {
    if (spell.kind === "stupefy") {
      return {
        amount: spell.strong ? stupefy.strongDamage : stupefy.damage,
        knockback: 0,
      };
    }

    // Incendio's direct hit; its Burn comes from the explosion. Petrificus
    // Totalus deals no damage: it Petrifies.
    if (spell.kind === "incendio") {
      return { amount: incendio.damage, knockback: 0 };
    }

    // Neither Petrificus Totalus nor Expelliarmus deals damage: one
    // Petrifies, the other Disarms.
    if (spell.kind === "petrificus" || spell.kind === "expelliarmus") {
      return { amount: 0, knockback: 0 };
    }

    const empower = spell.empowered ? confringo.perfectScale : 1;

    const scaled = (range: { readonly full: number; readonly min: number }) =>
      (range.min + (range.full - range.min) * spell.charge) * empower;

    return {
      amount: scaled(confringo.damage),
      knockback: scaled(confringo.knockback),
    };
  };

  /**
   * One tick of a knockback slide, as the offset to move by. The speed falls
   * steadily to zero: the steps (2 * ticksLeft - 1) / ticks² sum to exactly
   * the knockback distance over the slide.
   */
  const slide = (book: Bookkeeping): GroundPoint => {
    const { knockback } = book;

    if (!knockback) {
      return { x: 0, z: 0 };
    }

    const share =
      (2 * knockback.ticksLeft - 1) / (knockback.ticks * knockback.ticks);

    const step = knockback.distance * share;

    knockback.ticksLeft -= 1;

    if (knockback.ticksLeft === 0) {
      book.knockback = undefined;
    }

    return { x: knockback.direction.x * step, z: knockback.direction.z * step };
  };

  /**
   * Whether a Duelist's body (a cylinder, lifted while they jump) reaches
   * within the blast's radius of `centre`: a jump can clear a blast on the floor.
   */
  const inBlast = (self: DuelistState, centre: Point3) => {
    const across = Math.max(
      distanceBetween(self.position, { x: centre.x, z: centre.z }) - bodyRadius,
      0
    );

    const feet = self.elevation;
    const head = feet + tuning.duelist.height;
    const up = Math.max(feet - centre.y, centre.y - head, 0);

    return Math.hypot(across, up) <= incendio.blastRadius;
  };

  /**
   * An Incendio explosion: every opponent of its caster standing in the
   * blast (not Dodging, and only while the Round is fought) is left with a
   * Burn, whether or not their Shield stopped the fireball itself. A fresh
   * Burn restarts its clock; Burns do not stack.
   */
  const explode = (draft: Draft, spell: SpellState, position: Point3) => {
    const caught =
      draft.round.phase === "fighting"
        ? draft.duelists.filter(
            (each) =>
              each.team !== spell.team &&
              onFeet(each) &&
              each.dodgeSeconds === 0 &&
              inBlast(each, position)
          )
        : [];

    for (const each of caught) {
      books(each.id).burnTicks = ticksOf(incendio.burn.seconds);
    }

    draft.events.push({
      burned: caught.map((each) => each.id),
      position,
      spell,
      type: "explosion",
    });
  };

  /**
   * Where a Wand knocked from a Duelist standing at `from` comes to rest:
   * `flightDistance` metres along `heading`, or short of it where the
   * flight would leave the walkable Arena or come within `clearance` of
   * Cover or an Obstruction, so its owner can always walk to it.
   */
  const landingOf = (from: GroundPoint, heading: GroundPoint): GroundPoint => {
    const { clearance, flightDistance } = expelliarmus.wand;
    const maxX = arena.bounds.halfWidth - bodyRadius;
    const maxZ = arena.bounds.halfDepth - bodyRadius;
    const blockers = [...arena.cover, ...arena.obstructions];
    const stepLength = 0.05;
    const steps = Math.ceil(flightDistance / stepLength);
    let landing = from;

    for (let index = 1; index <= steps; index += 1) {
      const reach = (flightDistance * index) / steps;

      const at = {
        x: from.x + heading.x * reach,
        z: from.z + heading.z * reach,
      };

      const clear =
        Math.abs(at.x) <= maxX &&
        Math.abs(at.z) <= maxZ &&
        blockers.every(
          (blocker) =>
            distanceBetween(blocker.center, at) >= blocker.radius + clearance
        );

      if (!clear) {
        break;
      }

      landing = at;
    }

    return landing;
  };

  /**
   * An Expelliarmus landed on `self`: their Wand flies from their hand along
   * the Spell's flight. A Duelist already Disarmed is not Disarmed again.
   */
  const disarm = (draft: Draft, self: DuelistState, spell: SpellState) => {
    const book = books(self.id);

    if (book.wand) {
      return;
    }

    const heading = direction(
      { x: 0, z: 0 },
      { x: spell.velocity.x, z: spell.velocity.z }
    );

    const from = wandTip(self, tuning);
    const landing = landingOf(self.position, heading);

    book.wand = { ageTicks: 0, from, heading, landing };
    draft.events.push({
      casterId: spell.casterId,
      duelistId: self.id,
      landing,
      position: from,
      type: "disarm",
    });
  };

  /** Where a loose Wand is `ageTicks` into its flight: an arc from the hand down to its landing. */
  const wandPosition = (wand: LostWand): Point3 => {
    const flight = expelliarmus.wand;
    const progress = Math.min(wand.ageTicks / ticksOf(flight.flightSeconds), 1);

    if (progress === 1) {
      return { x: wand.landing.x, y: 0, z: wand.landing.z };
    }

    return {
      x: wand.from.x + (wand.landing.x - wand.from.x) * progress,
      y:
        wand.from.y * (1 - progress) +
        4 * flight.flightHeight * progress * (1 - progress),
      z: wand.from.z + (wand.landing.z - wand.from.z) * progress,
    };
  };

  /**
   * One tick of every loose Wand, once the Duelists have moved: it flies on
   * and lands; lying on the floor, its owner (and only its owner) picks it
   * up by walking over it; and it returns to their hand on its own once its
   * time is up, wherever it is.
   */
  const tendWands = (draft: Draft) => {
    const flight = expelliarmus.wand;
    const flightTicks = ticksOf(flight.flightSeconds);
    const returnTicks = ticksOf(flight.returnSeconds);

    draft.duelists = draft.duelists.map((self) => {
      const book = books(self.id);
      const { wand } = book;

      if (!wand) {
        return self.looseWand === null ? self : { ...self, looseWand: null };
      }

      wand.ageTicks += 1;
      const grounded = wand.ageTicks >= flightTicks;
      const position = wandPosition(wand);

      if (wand.ageTicks === flightTicks) {
        draft.events.push({
          duelistId: self.id,
          position: wand.landing,
          type: "wand-landed",
        });
      }

      const pickedUp =
        grounded &&
        onFeet(self) &&
        distanceBetween(self.position, wand.landing) <= flight.pickupRadius;

      if (pickedUp || wand.ageTicks >= returnTicks) {
        book.wand = undefined;
        draft.events.push({
          duelistId: self.id,
          how: pickedUp ? "pickup" : "return",
          position,
          type: "wand-recovered",
        });

        return { ...self, looseWand: null };
      }

      return {
        ...self,
        looseWand: {
          grounded,
          heading: wand.heading,
          landing: wand.landing,
          position,
          returnSeconds: (returnTicks - wand.ageTicks) * tickSeconds,
        },
      };
    });
  };

  /** What a Duelist's Spell damage is multiplied by: more under a Strength Potion. */
  const strengthOf = (id: DuelistId) =>
    books(id).effectTicks.strength > 0
      ? tuning.potions.strength.damageScale
      : 1;

  /**
   * A Spell landing on a Duelist at `position`: its damage (added to
   * `damage`), the Stagger, Petrified or knockback it brings, and the hit
   * reported.
   */
  const strike = (
    draft: Draft,
    damage: Map<DuelistId, number>,
    spell: SpellState,
    targetId: DuelistId,
    position: Point3
  ) => {
    const { knockback } = impactOf(spell);
    const amount = impactOf(spell).amount * strengthOf(spell.casterId);
    damage.set(targetId, (damage.get(targetId) ?? 0) + amount);

    // The strong Stupefy Staggers: no moving or casting for a moment.
    if (spell.strong) {
      books(targetId).staggerTicks = ticksOf(stupefy.staggerSeconds);
    }

    // Petrificus Totalus freezes the Duelist it hits.
    if (spell.kind === "petrificus") {
      books(targetId).petrifiedTicks = ticksOf(petrificus.petrifiedSeconds);
    }

    // Expelliarmus knocks the Wand out of the hand it hits.
    const struck = draft.duelists.find((each) => each.id === targetId);

    if (spell.kind === "expelliarmus" && struck) {
      disarm(draft, struck, spell);
    }

    // Confringo knocks the Duelist it hits back along its flight.
    if (knockback > 0) {
      const ticks = ticksOf(confringo.knockback.seconds);

      books(targetId).knockback = {
        direction: direction(
          { x: 0, z: 0 },
          { x: spell.velocity.x, z: spell.velocity.z }
        ),
        distance: knockback,
        ticks,
        ticksLeft: ticks,
      };
    }

    draft.events.push({
      damage: amount,
      position,
      spell,
      staggered: spell.strong,
      targetId,
      type: "spell-hit",
    });
  };

  const cancel = (
    draft: Draft,
    spells: readonly [SpellState, SpellState],
    position: Point3
  ) => draft.events.push({ position, spells, type: "spells-cancelled" });

  /** Ticks left before the Clash in progress explodes. */
  let clashTicks = 0;

  /**
   * Whether two opposing Spells meeting in the air lock into a Clash: both
   * Confringos at a full Charge, flying at each other roughly head-on, while
   * the Round is fought and no other Clash is on.
   */
  const locksIntoClash = (draft: Draft) => (a: SpellState, b: SpellState) =>
    draft.round.phase === "fighting" &&
    draft.clash === null &&
    [a, b].every(
      (spell) =>
        spell.kind === "confringo" &&
        spell.charge >= 1 &&
        // A Disarmed caster has no Wand to hold the beam with.
        books(spell.casterId).wand === undefined
    ) &&
    angleBetween(unit3(a.velocity), unit3(scale(b.velocity, -1))) <=
      tuning.clash.maxAngle;

  /**
   * A Clash as the snapshot shows it: each side's Wand tip with the
   * Duelists facing each other down the beam, and the meeting point
   * `along` it (held between the Wands).
   */
  const placeClash = (
    sides: readonly [Omit<ClashSide, "wand">, Omit<ClashSide, "wand">],
    along: number,
    duelists: readonly DuelistState[]
  ): ClashState | null => {
    const [first, second] = sides.map((side) =>
      duelists.find((each) => each.id === side.duelistId)
    );

    if (!first || !second) {
      return null;
    }

    const tipOf = (self: DuelistState, foe: DuelistState) =>
      wandTip(
        { ...self, facing: direction(self.position, foe.position) },
        tuning
      );

    const from = tipOf(first, second);
    const to = tipOf(second, first);
    const share = clamp(along, 0, 1);

    return {
      along,
      point: {
        x: from.x + (to.x - from.x) * share,
        y: from.y + (to.y - from.y) * share,
        z: from.z + (to.z - from.z) * share,
      },
      secondsLeft: clashTicks * tickSeconds,
      sides: [
        { ...sides[0], wand: from },
        { ...sides[1], wand: to },
      ],
    };
  };

  /**
   * Two Confringos lock into a Clash where they met: their casters are
   * rooted, the beam joins their Wands and the meeting point starts where
   * the Spells met (kept off either end). A Clash that cannot start (a
   * caster gone, another Clash on) is a plain mid-air cancel instead.
   */
  const startClash = (
    draft: Draft,
    spells: readonly [SpellState, SpellState],
    position: Point3
  ) => {
    const [a, b] = spells;

    const casters = spells.map((spell) =>
      draft.duelists.find(
        (each) => each.id === spell.casterId && !each.knockedOut
      )
    );

    const [first, second] = casters;

    if (draft.clash !== null || !first || !second || first.id === second.id) {
      cancel(draft, spells, position);

      return;
    }

    clashTicks = ticksOf(tuning.clash.seconds);

    const sides = [
      { duelistId: first.id, spell: a },
      { duelistId: second.id, spell: b },
    ] as const;

    const placed = placeClash(sides, 0, draft.duelists);

    if (!placed) {
      return;
    }

    // How far along the beam they met, from the first side's Wand.
    const [{ wand: from }, { wand: to }] = placed.sides;
    const beam = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
    const length = Math.hypot(beam.x, beam.y, beam.z) || 1;

    const met =
      ((position.x - from.x) * beam.x +
        (position.y - from.y) * beam.y +
        (position.z - from.z) * beam.z) /
      (length * length);

    const { max, min } = tuning.clash.start;
    draft.clash = placeClash(sides, clamp(met, min, max), draft.duelists);

    if (draft.clash) {
      draft.events.push({ clash: draft.clash, type: "clash-start" });
    }
  };

  /** The Clash ends: nobody is rooted any more. */
  const endClash = (
    draft: Draft,
    clash: ClashState,
    outcome: "exploded" | "interrupted" | "won",
    winnerId: DuelistId | null,
    position: Point3
  ) => {
    draft.clash = null;
    draft.events.push({
      clash,
      outcome,
      position,
      type: "clash-end",
      winnerId,
    });
  };

  /**
   * The winner pushed the meeting point all the way: their Confringo hits
   * the loser at once, empowered, as a full Charge.
   */
  const winClash = (
    draft: Draft,
    damage: Map<DuelistId, number>,
    clash: ClashState,
    winner: ClashSide,
    loser: ClashSide
  ) => {
    const target = draft.duelists.find((each) => each.id === loser.duelistId);
    const contact = target ? chestOf(target, tuning) : loser.wand;

    endClash(draft, clash, "won", winner.duelistId, contact);
    strike(
      draft,
      damage,
      { ...winner.spell, charge: 1, empowered: true, position: contact },
      loser.duelistId,
      contact
    );
  };

  /** Nobody won in time: the beam blows up and knocks both Duelists back, away from it. */
  const explodeClash = (draft: Draft, clash: ClashState) => {
    const { knockback, seconds } = tuning.clash.explosion;
    const ticks = ticksOf(seconds);

    for (const side of clash.sides) {
      const self = draft.duelists.find((each) => each.id === side.duelistId);

      if (self) {
        books(self.id).knockback = {
          direction: direction(
            { x: clash.point.x, z: clash.point.z },
            self.position
          ),
          distance: knockback,
          ticks,
          ticksLeft: ticks,
        };
      }
    }

    endClash(draft, clash, "exploded", null, clash.point);
  };

  /**
   * One tick of the Clash in progress: every pump (a press of the Clash
   * pump, never the hold) pushes the meeting point toward the pumping
   * Duelist's opponent. Reaching a Wand wins it; running out of time blows
   * it up; the Round stopping (a Knockout) ends it with neither. Presses are
   * tracked for everyone, so a pump held into a Clash is no press.
   */
  const struggle = (
    draft: Draft,
    intentOf: (id: DuelistId) => Intent,
    damage: Map<DuelistId, number>
  ) => {
    const pumped = new Set<DuelistId>();

    for (const self of draft.duelists) {
      const book = books(self.id);
      const down = intentOf(self.id).clashPump;

      if (down && !book.pumpHeld) {
        pumped.add(self.id);
      }

      book.pumpHeld = down;
    }

    const { clash } = draft;

    if (!clash) {
      return;
    }

    const [first, second] = clash.sides;

    const standing = (side: ClashSide) =>
      draft.duelists.some((each) => each.id === side.duelistId && onFeet(each));

    if (
      draft.round.phase !== "fighting" ||
      !standing(first) ||
      !standing(second)
    ) {
      endClash(draft, clash, "interrupted", null, clash.point);

      return;
    }

    // A Duelist Disarmed mid-Clash (by a Spell already in the air) loses
    // their half of the beam: the other side's drives through.
    const firstArmed = books(first.duelistId).wand === undefined;
    const secondArmed = books(second.duelistId).wand === undefined;

    if (firstArmed !== secondArmed) {
      const [winner, loser] = firstArmed ? [first, second] : [second, first];
      winClash(draft, damage, clash, winner, loser);

      return;
    }

    if (!firstArmed) {
      endClash(draft, clash, "interrupted", null, clash.point);

      return;
    }

    let latest = clash;

    for (const [side, push] of [
      [first, 1],
      [second, -1],
    ] as const) {
      if (pumped.has(side.duelistId)) {
        latest =
          placeClash(
            latest.sides,
            latest.along + push * tuning.clash.pumpShare,
            draft.duelists
          ) ?? latest;
        draft.events.push({
          clash: latest,
          duelistId: side.duelistId,
          type: "clash-pump",
        });
      }
    }

    clashTicks = Math.max(clashTicks - 1, 0);
    draft.clash = latest;

    if (latest.along >= 1) {
      winClash(draft, damage, latest, first, second);
    } else if (latest.along <= 0) {
      winClash(draft, damage, latest, second, first);
    } else if (clashTicks === 0) {
      explodeClash(draft, latest);
    }
  };

  /**
   * Spells in flight travel against where everyone stood at the start of the
   * tick. Duelists can only be hit while the Round is being fought, so a
   * Spell still in the air after a Knockout flies over the fallen. Two full
   * Confringos meeting head-on lock into a Clash. Returns the damage each
   * Duelist took.
   */
  const flySpells = (draft: Draft): Map<DuelistId, number> => {
    const flight = fly(
      draft.spells.map((spell) => home(spell, draft.duelists)),
      {
        arena,
        bodyHeight: tuning.duelist.height,
        bodyRadius,
        clash: { locks: locksIntoClash(draft), reach: tuning.clash.reach },
        radiusOf: spellRadius,
        // A Dodging Duelist cannot be hit: Spells fly straight through.
        targets:
          draft.round.phase === "fighting"
            ? draft.duelists.filter(
                (each) => onFeet(each) && each.dodgeSeconds === 0
              )
            : [],
      },
      tickSeconds
    );

    draft.spells = flight.flying;
    const damage = new Map<DuelistId, number>();

    for (const outcome of flight.outcomes) {
      const struck =
        outcome.kind === "hit"
          ? draft.duelists.find((each) => each.id === outcome.targetId)
          : undefined;

      // A Shield in the way blocks or Parries it instead.
      const met =
        outcome.kind === "hit" && struck
          ? meetShield(struck, outcome.spell, outcome.position, draft)
          : "hit";

      if (outcome.kind === "hit" && met === "hit") {
        strike(
          draft,
          damage,
          outcome.spell,
          outcome.targetId,
          outcome.position
        );
      } else if (outcome.kind === "stopped") {
        draft.events.push({ ...outcome, type: "spell-stopped" });
      } else if (outcome.kind === "cancelled") {
        cancel(draft, outcome.spells, outcome.position);
      } else if (outcome.kind === "clashed") {
        startClash(draft, outcome.spells, outcome.position);
      }

      // Incendio explodes wherever it ends, Shield or not; only a Parry,
      // which sends it back, keeps it flying.
      const ended = "spells" in outcome ? outcome.spells : [outcome.spell];

      for (const spell of ended) {
        if (spell.kind === "incendio" && met !== "parried") {
          explode(draft, spell, outcome.position);
        }
      }
    }

    return damage;
  };

  /**
   * One tick of every Burn while the Round is fought: damage over time,
   * added to `damage`.
   */
  const burn = (draft: Draft, damage: Map<DuelistId, number>) => {
    if (draft.round.phase !== "fighting") {
      return damage;
    }

    for (const self of draft.duelists) {
      const book = books(self.id);

      if (book.burnTicks > 0 && !self.knockedOut) {
        book.burnTicks -= 1;
        damage.set(
          self.id,
          (damage.get(self.id) ?? 0) +
            incendio.burn.damagePerSecond * tickSeconds
        );
      }
    }

    return damage;
  };

  /** Health drops by the damage taken; zero Health is a Knockout, except in a Practice. */
  const applyDamage = (draft: Draft, damage: Map<DuelistId, number>) => {
    draft.duelists = draft.duelists.map((self) => {
      const health = Math.max(self.health - (damage.get(self.id) ?? 0), 0);
      const knockedOut = !practice && (self.knockedOut || health === 0);

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
   * The Heavy Spell's Charge for one Duelist free to act this tick. A press
   * starts a Charge and holding builds it; letting go releases Confringo with
   * the Charge it reached. Returns the release, if any.
   */
  const charge = (
    book: Bookkeeping,
    intent: Intent,
    pressed: boolean
  ): Release | undefined => {
    if (book.chargeTicks > 0 && intent.heavySpell) {
      book.chargeTicks += 1;
    } else if (book.chargeTicks > 0) {
      const chargeSeconds = book.chargeTicks / tuning.tickRate;
      book.chargeTicks = 0;

      return { chargeSeconds, kind: "confringo" };
    } else if (pressed) {
      book.chargeTicks = 1;
    }

    return undefined;
  };

  /**
   * A Duelist who cannot act this tick (Staggered, knocked back, Knocked
   * Out or outside the fight): no casting, and any Charge is lost. A
   * knockback still slides them on, whatever else is going on.
   */
  const sidelined = (
    self: DuelistState,
    book: Bookkeeping,
    obstacles: readonly Obstacle[]
  ): DuelistState => {
    book.queued = false;
    book.chargeTicks = 0;

    const pushed = book.knockback ? slide(book) : undefined;

    return {
      ...self,
      chargeSeconds: 0,
      knockbackSeconds: (book.knockback?.ticksLeft ?? 0) * tickSeconds,
      position: pushed
        ? collide(
            { x: self.position.x + pushed.x, z: self.position.z + pushed.z },
            bodyRadius,
            obstacles,
            arena
          )
        : self.position,
      staggerSeconds: book.staggerTicks * tickSeconds,
    };
  };

  /**
   * Overcharge: a Charge held a moment past full Backfires. No Spell
   * leaves the Wand, and the caster is hurt and Staggered.
   */
  const backfire = (
    self: DuelistState,
    book: Bookkeeping,
    events: DuelEvent[],
    backfires: Map<DuelistId, number>
  ): DuelistState => {
    book.chargeTicks = 0;
    book.queued = false;
    book.staggerTicks = ticksOf(confringo.backfire.staggerSeconds);
    backfires.set(self.id, confringo.backfire.damage);
    events.push({
      damage: confringo.backfire.damage,
      duelistId: self.id,
      position: wandTip(self, tuning),
      type: "backfire",
    });

    return {
      ...self,
      chargeSeconds: 0,
      knockbackSeconds: 0,
      staggerSeconds: book.staggerTicks * tickSeconds,
    };
  };

  /**
   * Charging and casting for a Duelist free to act this tick, returning the
   * Spell they let go of, if any. Mid-Dodge or behind the Shield no Spell is
   * cast, and in the air only the Light Spell: a Charge in progress is lost,
   * and none starts. Charging (or releasing) holds the Light Spell back.
   */
  const spellsOf = (
    book: Bookkeeping,
    intent: Intent,
    guard: Guard,
    pressed: boolean,
    heavyPressed: boolean
  ): Release | undefined => {
    const canCharge = guard.canCast && !guard.airborne;

    if (!canCharge) {
      book.chargeTicks = 0;
    }

    const heavy = canCharge ? charge(book, intent, heavyPressed) : undefined;

    if (heavy) {
      return heavy;
    }

    if (!guard.canCast || book.chargeTicks > 0) {
      book.queued = false;

      return undefined;
    }

    return wantsToCast(book, pressed) ? { kind: "stupefy" } : undefined;
  };

  /** The Special Spells' Cooldowns as the snapshot shows them, in seconds. */
  const cooldownsOf = (book: Bookkeeping) => ({
    depulso: book.cooldownTicks.depulso * tickSeconds,
    expelliarmus: book.cooldownTicks.expelliarmus * tickSeconds,
    incendio: book.cooldownTicks.incendio * tickSeconds,
    petrificus: book.cooldownTicks.petrificus * tickSeconds,
  });

  /** A Practice rival that casts Special Spells free of Focus and Cooldown. */
  const castsFree = (self: DuelistState) =>
    practice !== undefined &&
    practice.rivalsCastFree &&
    self.id !== practice.learner;

  /**
   * Whether a Special Spell pressed from its slot leaves the Wand: only on
   * the floor, free to cast (not Dodging or behind the Shield), not in the
   * middle of a Charge, with the Focus to pay for it and off Cooldown.
   */
  const canCastSpecial = (
    self: DuelistState,
    book: Bookkeeping,
    guard: Guard,
    kind: SpecialSpellKind
  ) =>
    guard.canCast &&
    !guard.airborne &&
    book.chargeTicks === 0 &&
    (castsFree(self) ||
      readiness(
        kind,
        { cooldowns: cooldownsOf(book), focus: self.focus },
        tuning
      ) === "ready");

  /**
   * The Special Spell a Duelist free to act casts this tick: the one bound
   * to the Spell Slot they pressed, if the slot holds one they can cast, with
   * the Focus it costs. Its Cooldown starts as it leaves. An empty slot, or a
   * Special Spell short of Focus or cooling down, casts nothing.
   */
  const specialOf = (
    self: DuelistState,
    book: Bookkeeping,
    guard: Guard,
    pressed: SpellSlot | null
  ): SpecialCast | undefined => {
    const kind = pressed === null ? null : boundTo(pressed, tuning);

    if (kind === null || !canCastSpecial(self, book, guard, kind)) {
      return undefined;
    }

    if (castsFree(self)) {
      return { cost: 0, kind };
    }

    book.cooldownTicks[kind] = ticksOf(tuning[kind].cooldownSeconds);

    return { cost: focusCost(kind, tuning), kind };
  };

  /** Whether a standing Duelist is free to act: not Staggered, Petrified, knocked back or rooted in a Clash. */
  const free = (
    self: DuelistState,
    book: Bookkeeping,
    clash: ClashState | null
  ) =>
    onFeet(self) &&
    book.staggerTicks === 0 &&
    book.petrifiedTicks === 0 &&
    book.knockback === undefined &&
    clashOpponentOf(clash, self.id) === undefined;

  /** Whether a standing Duelist is only sliding back behind their Shield from a Depulso, mid-fight: they can keep it up. */
  const guardedSlide = (
    self: DuelistState,
    book: Bookkeeping,
    phase: RoundPhase
  ) =>
    phase === "fighting" &&
    onFeet(self) &&
    book.staggerTicks === 0 &&
    book.petrifiedTicks === 0 &&
    book.knockback?.guarded === true;

  /** One tick off every per-Duelist timer: recovery, Stagger, Petrified and the Cooldowns. */
  const countDown = (book: Bookkeeping) => {
    book.recoveryTicks = Math.max(book.recoveryTicks - 1, 0);
    book.staggerTicks = Math.max(book.staggerTicks - 1, 0);
    book.petrifiedTicks = Math.max(book.petrifiedTicks - 1, 0);
    book.ticksSinceCast += 1;

    for (const kind of specialSpellKinds) {
      book.cooldownTicks[kind] = Math.max(book.cooldownTicks[kind] - 1, 0);
    }

    book.effectTicks.strength = Math.max(book.effectTicks.strength - 1, 0);
    book.effectTicks.swiftness = Math.max(book.effectTicks.swiftness - 1, 0);
  };

  /**
   * A Potion being drunk is lost: a Spell landed, or the drinker lost
   * control. Reported only while the Round is fought (`reported`): past a
   * Knockout it just goes.
   */
  const interruptDrink = (draft: Draft, id: DuelistId, reported = true) => {
    const book = books(id);

    if (book.drink && reported) {
      draft.events.push({
        duelistId: id,
        kind: book.drink.kind,
        type: "potion-interrupted",
      });
    }

    book.drink = undefined;
  };

  /**
   * Every Spell that landed on a drinker since the last check (a direct hit,
   * Depulso's included, whatever its damage; not a Burn) interrupts their
   * Potion, which is lost.
   */
  const interruptDrinks = (draft: Draft) => {
    for (const event of draft.events.slice(draft.checkedForDrinks)) {
      if (event.type === "spell-hit") {
        interruptDrink(draft, event.targetId);
      }
    }

    draft.checkedForDrinks = draft.events.length;
  };

  /**
   * The Potion a Duelist free to act starts drinking this tick: the one bound
   * to the Potion Slot they pressed, if they have a charge of it and their
   * hands are free of anything else (on the floor, not Dodging, Shielding or
   * Charging, and not already drinking). A Disarmed Duelist can drink.
   */
  const drinkOf = (
    self: DuelistState,
    book: Bookkeeping,
    guard: Guard,
    pressed: PotionSlot | null
  ): PotionKind | undefined => {
    const kind = pressed === null ? null : potionIn(pressed, tuning);

    if (
      kind === null ||
      self.potions[kind] <= 0 ||
      book.drink !== undefined ||
      book.dodgeTicks > 0 ||
      book.chargeTicks > 0 ||
      guard.state.shielding ||
      guard.airborne
    ) {
      return undefined;
    }

    return kind;
  };

  /** A Potion is down: Wiggenweld heals at once, the others start lasting. Returns the drinker's new Health. */
  const takeEffect = (
    self: DuelistState,
    book: Bookkeeping,
    kind: PotionKind,
    draft: Draft
  ) => {
    draft.events.push({ duelistId: self.id, kind, type: "potion-drunk" });

    if (kind === "wiggenweld") {
      const max = tuning.duelist.health;

      return Math.min(
        self.health + max * tuning.potions.wiggenweld.healShare,
        max
      );
    }

    book.effectTicks[kind] = ticksOf(tuning.potions[kind].seconds);

    return self.health;
  };

  /** The walking stride's multiplier under a Swiftness Potion: faster while it lasts. */
  const swiftScale = (book: Bookkeeping) =>
    book.effectTicks.swiftness > 0 ? tuning.potions.swiftness.speedScale : 1;

  /** What `drinkTick` needs of the Duelist acting this tick. */
  interface Actor {
    /** As they stood at the start of the tick. */
    readonly self: DuelistState;
    /** With their defence settled. */
    readonly defended: DuelistState;
    readonly guard: Guard;
    readonly intent: Intent;
    readonly obstacles: readonly Obstacle[];
    readonly target: DuelistState | undefined;
  }

  /**
   * A Potion for a Duelist free to act this tick: drinking starts from the
   * Potion Slot pressed (spending its charge), or goes on, and once it is
   * down it takes effect. Drinking, the Duelist casts nothing, loses any
   * Charge and only walks slowly. Returns their state, or undefined when
   * they are not drinking.
   */
  const drinkTick = (
    { defended, guard, intent, obstacles, self, target }: Actor,
    book: Bookkeeping,
    draft: Draft
  ): DuelistState | undefined => {
    const started = drinkOf(self, book, guard, intent.potionSlots.press);

    if (started) {
      book.drink = {
        kind: started,
        ticksLeft: ticksOf(tuning.potions.drink.seconds),
      };
      draft.events.push({
        duelistId: self.id,
        kind: started,
        type: "potion-start",
      });
    } else if (book.drink) {
      book.drink.ticksLeft -= 1;
    }

    const { drink } = book;

    if (!drink) {
      return undefined;
    }

    book.chargeTicks = 0;
    book.queued = false;

    const down = drink.ticksLeft === 0;

    const health = down
      ? takeEffect(self, book, drink.kind, draft)
      : self.health;

    if (down) {
      book.drink = undefined;
    }

    const move = clampLength(intent.move, 1);
    const speed = stride() * tuning.potions.drink.moveScale * swiftScale(book);

    const stepTo = walk(
      self.position,
      self.aim.yaw,
      target?.position,
      move.x * speed,
      move.y * speed
    );

    const wanted = easeStep(
      self,
      book,
      stepTo,
      swiftScale(book),
      target?.position
    );

    return {
      ...defended,
      chargeSeconds: 0,
      facing: turnFacing(
        self,
        book,
        castRecently(book),
        walkHeading(self.aim.yaw, move)
      ),
      health,
      knockbackSeconds: 0,
      position: collide(wanted, bodyRadius, obstacles, arena),
      potions: started
        ? { ...self.potions, [started]: self.potions[started] - 1 }
        : self.potions,
      staggerSeconds: book.staggerTicks * tickSeconds,
    };
  };

  /**
   * Which way a free-aiming Duelist who acted this tick faces: casting,
   * Charging and Shielding turn them to the aim, walking toward where they
   * walk; a Dodge dashes without turning.
   */
  const faceAfterActing = (
    self: DuelistState,
    book: Bookkeeping,
    guard: Guard,
    release: Release | undefined,
    move: Vec2
  ): GroundPoint =>
    turnFacing(
      self,
      book,
      release !== undefined ||
        book.chargeTicks > 0 ||
        guard.state.shielding ||
        castRecently(book),
      guard.dash ? undefined : walkHeading(self.aim.yaw, move)
    );

  /**
   * Duelists aim, move and decide to cast. Looking around works during the
   * intro's countdown and while Staggered; moving, Charging and casting only
   * while fighting, standing, not Staggered and not knocked back. Anything
   * that takes control away also loses a Charge in progress.
   */
  const act = (
    draft: Draft,
    intentOf: (id: DuelistId) => Intent
  ): Map<DuelistId, Release> => {
    const releases = new Map<DuelistId, Release>();
    const byId = new Map(draft.duelists.map((each) => [each.id, each]));
    const { phase } = draft.round;

    const acted = draft.duelists.map((standing): DuelistState => {
      const intent = intentOf(standing.id);
      const book = books(standing.id);
      const pressed = intent.lightSpell && !book.held;
      const heavyPressed = intent.heavySpell && !book.heavyHeld;

      const canLook = looksAround(standing, phase, draft.clash);

      const self = canLook
        ? steer(standing, intent, draft.duelists, draft.events)
        : standing;

      const canAct = phase === "fighting" && free(self, book, draft.clash);

      book.held = intent.lightSpell;
      book.heavyHeld = intent.heavySpell;
      countDown(book);

      /** What the snapshot shows of the Spell Slots, Cooldowns, Burn and Petrified, whatever the Duelist did. */
      const status = (state: DuelistState): DuelistState => ({
        ...state,
        burnSeconds: book.burnTicks * tickSeconds,
        cooldowns: cooldownsOf(book),
        drinking: book.drink
          ? {
              kind: book.drink.kind,
              secondsLeft: book.drink.ticksLeft * tickSeconds,
            }
          : null,
        petrifiedSeconds: book.petrifiedTicks * tickSeconds,
        potionEffects: {
          strength: book.effectTicks.strength * tickSeconds,
          swiftness: book.effectTicks.swiftness * tickSeconds,
        },
        potionSlotsHeld: canLook && intent.potionSlots.held,
        // In a Clash, R2 is the pump, not the Spell Slots' modifier.
        spellSlotsHeld: canLook && intent.spellSlots.held,
      });

      const target =
        self.targetId === null ? undefined : byId.get(self.targetId);

      const targetAt = target?.position;

      // Drinking a Potion, the hands are full: no Dodge, jump, sprint or Shield.
      const canDefend = canAct && book.drink === undefined;

      // Defence runs first, and even for a Duelist who cannot act: a jump
      // still falls and Stamina still regenerates.
      // Pushed back behind a Shield by Depulso, the Shield stays up.
      const guard = defend(
        self,
        intent,
        canDefend,
        target,
        draft,
        canDefend || guardedSlide(self, book, phase)
      );

      const defended = { ...self, ...guard.state };

      // Other Duelists block at their position from the start of the tick, so
      // the result does not depend on the order Duelists are processed in.
      const others = draft.duelists
        .filter((other) => other.id !== self.id)
        .map((other) => ({ center: other.position, radius: bodyRadius }));

      const obstacles = [...arena.cover, ...arena.obstructions, ...others];

      if (!canAct) {
        // Losing control loses the Potion too.
        interruptDrink(draft, self.id, phase === "fighting");

        return status(sidelined(defended, book, obstacles));
      }

      // Drinking a Potion (or starting one) takes the whole tick.
      const drinking = drinkTick(
        { defended, guard, intent, obstacles, self, target },
        book,
        draft
      );

      if (drinking) {
        return status(drinking);
      }

      const special = specialOf(self, book, guard, intent.spellSlots.press);

      // A Special Spell goes first; a Light Spell pressed on the same tick
      // waits for its recovery.
      if (special) {
        book.queued ||= pressed;
      }

      const release: Release | undefined = special
        ? { kind: special.kind }
        : spellsOf(book, intent, guard, pressed, heavyPressed);

      const chargeSeconds = book.chargeTicks / tuning.tickRate;

      // Overcharge: held a moment past full, the Charge Backfires. No
      // Spell leaves the Wand, and the caster is hurt and Staggered.
      if (chargeStage(chargeSeconds, confringo) === "overcharged") {
        return status(backfire(defended, book, draft.events, draft.backfires));
      }

      if (release) {
        releases.set(self.id, release);
      }

      const move = clampLength(intent.move, 1);

      // Charging is a commitment: the Duelist creeps (and cannot sprint).
      const speed =
        (book.chargeTicks > 0
          ? stride() * confringo.chargeMoveScale
          : stride() * guard.pace) * swiftScale(book);

      // A Dodge dashes along its own line at once; a walk eases toward
      // where the stick asks.
      const wanted = guard.dash
        ? {
            x: self.position.x + guard.dash.x,
            z: self.position.z + guard.dash.z,
          }
        : easeStep(
            self,
            book,
            walk(
              self.position,
              self.aim.yaw,
              targetAt,
              move.x * speed,
              move.y * speed
            ),
            swiftScale(book),
            targetAt
          );

      return status({
        ...defended,
        chargeSeconds,
        facing: faceAfterActing(self, book, guard, release, move),
        focus: self.focus - (special?.cost ?? 0),
        knockbackSeconds: 0,
        position: collide(wanted, bodyRadius, obstacles, arena),
        staggerSeconds: book.staggerTicks * tickSeconds,
      });
    });

    // Velocity is what each Duelist actually walked this tick, walls and
    // all; a Dodge or a knock-back ends where it ends, carrying nothing on.
    const moved = acted.map((each) => {
      const before = byId.get(each.id) ?? each;

      const thrown =
        each.dodgeSeconds > 0 ||
        before.dodgeSeconds > 0 ||
        each.knockbackSeconds > 0 ||
        before.knockbackSeconds > 0;

      if (thrown) {
        books(each.id).acceleration = { x: 0, z: 0 };
      }

      return {
        ...each,
        velocity: thrown
          ? { x: 0, z: 0 }
          : {
              x: (each.position.x - before.position.x) / tickSeconds,
              z: (each.position.z - before.position.z) / tickSeconds,
            },
      };
    });

    draft.duelists = settleAim(moved, draft.events, draft.clash);

    return releases;
  };

  /**
   * New Spells leave the Wand toward the point under the crosshair (or the
   * Target, Locked On). Stupefies cast close enough together form a chain;
   * every `chainLength`-th one is strong. Confringo carries the Charge it
   * was released with; released in the Perfect Release window it is a full
   * Charge, empowered, and the Perfect Release is reported.
   */
  /**
   * Depulso's cone, the moment it is cast: every opponent of the caster
   * standing within its range (to the edge of their body) and its angle
   * round the caster's facing, not Dodging and not behind Cover, while the
   * Round is fought. Each is pushed straight away from the caster, harder the
   * closer they stand, losing any Charge (no Backfire), and takes its damage,
   * unless a Shield facing the caster blocks it (it cannot be Parried): then
   * the push is weaker, and the Shield stays up through the slide.
   * Its hit is a `spell-hit` like any other, so it interrupts a Potion being
   * drunk.
   */
  const blast = (draft: Draft, caster: DuelistState, spell: SpellState) => {
    if (draft.round.phase !== "fighting") {
      return;
    }

    const { coneDegrees, knockback, range } = depulso;
    const damage = depulso.damage * strengthOf(caster.id);
    const halfAngle = (coneDegrees * Math.PI) / 360;
    const ticks = ticksOf(knockback.seconds);
    const caught = new Set<DuelistId>();

    for (const other of draft.duelists) {
      const distance = distanceBetween(caster.position, other.position);
      const away = direction(caster.position, other.position);
      const reach = Math.max(distance - bodyRadius, 0);

      const off = Math.acos(
        clamp(away.x * caster.facing.x + away.z * caster.facing.z, -1, 1)
      );

      if (
        other.team === caster.team ||
        !onFeet(other) ||
        other.dodgeSeconds > 0 ||
        reach > range ||
        off > halfAngle ||
        sightBlocked(caster.position, other.position, arena.cover)
      ) {
        continue;
      }

      // A Shield facing the caster: the caster stands in front of its line.
      const shielded =
        other.shielding &&
        (caster.position.x - other.position.x) * other.facing.x +
          (caster.position.z - other.position.z) * other.facing.z >=
          0;

      const metres =
        (knockback.near + (knockback.far - knockback.near) * (reach / range)) *
        (shielded ? knockback.shieldScale : 1);

      const book = books(other.id);
      book.chargeTicks = 0;
      book.queued = false;
      book.knockback = {
        direction: away,
        distance: metres,
        guarded: shielded,
        ticks,
        ticksLeft: ticks,
      };
      caught.add(other.id);

      const position = chestOf(other, tuning);

      if (shielded) {
        draft.events.push({
          duelistId: other.id,
          position,
          spell,
          type: "spell-blocked",
        });
      } else {
        draft.blasts.set(other.id, (draft.blasts.get(other.id) ?? 0) + damage);
        draft.events.push({
          damage,
          position,
          spell,
          staggered: false,
          targetId: other.id,
          type: "spell-hit",
        });
      }
    }

    draft.duelists = draft.duelists.map((each) =>
      caught.has(each.id)
        ? {
            ...each,
            chargeSeconds: 0,
            knockbackSeconds: ticks * tickSeconds,
          }
        : each
    );
  };

  const cast = (draft: Draft, releases: Map<DuelistId, Release>) => {
    for (const self of draft.duelists) {
      const release = releases.get(self.id);

      if (!release) {
        continue;
      }

      const book = books(self.id);
      let strong = false;
      let power = 0;
      let empowered = false;

      if (release.kind === "stupefy") {
        const chained = book.ticksSinceCast <= ticksOf(stupefy.chainWindow);
        book.chain = chained ? book.chain + 1 : 1;
        strong = book.chain >= stupefy.chainLength;

        if (strong) {
          book.chain = 0;
        }

        book.recoveryTicks = ticksOf(stupefy.castInterval);
      } else if (release.kind === "confringo") {
        empowered = chargeStage(release.chargeSeconds, confringo) === "perfect";
        power = empowered ? 1 : chargeLevel(release.chargeSeconds, confringo);
        // A Heavy Spell breaks the Light Spell's rhythm.
        book.chain = 0;
        book.recoveryTicks = ticksOf(confringo.recoverySeconds);
      } else {
        // A Special Spell, like a Heavy one, breaks the Light Spell's rhythm.
        book.chain = 0;
        book.recoveryTicks = ticksOf(tuning[release.kind].recoverySeconds);
      }

      book.ticksSinceCast = 0;

      // A cast turns the Duelist to the aim (see `turnFacing`): the Spell
      // leaves the Wand where that turn puts it, and Depulso's cone opens
      // along the aim, even while the body is still coming round.
      const caster = { ...self, facing: forwardOf(self.aim.yaw) };

      const origin = wandTip(caster, tuning);

      // Depulso does not fly: its cone lands on everyone in it at once.
      if (release.kind === "depulso") {
        const spell: SpellState = {
          casterId: self.id,
          charge: 0,
          empowered: false,
          homing: null,
          id: nextSpellId,
          kind: "depulso",
          position: origin,
          strong: false,
          team: self.team,
          velocity: { x: caster.facing.x, y: 0, z: caster.facing.z },
        };

        nextSpellId += 1;
        draft.events.push({ spell, type: "spell-cast" });
        blast(draft, caster, spell);
        continue;
      }

      const launch = towardPoint(origin, self.aimPoint);

      // Every Spell aims the same way. Locked On: straight at the Target's
      // chest where it stands now (no lead), with a weak homing a strafe can
      // still beat. Free-aiming: to the point under the crosshair, bent by
      // Aim Assist at launch only.
      const spell: SpellState = {
        casterId: self.id,
        charge: power,
        empowered,
        homing:
          self.targetId === null
            ? null
            : {
                secondsLeft: tuning.lockOn.homing.seconds,
                targetId: self.targetId,
              },
        id: nextSpellId,
        kind: release.kind,
        position: origin,
        strong,
        team: self.team,
        velocity: scale(
          self.targetId === null
            ? assistedLaunch(self, origin, launch, draft.duelists)
            : launch,
          tuning[release.kind].speed
        ),
      };

      nextSpellId += 1;
      draft.spells = [...draft.spells, spell];
      draft.events.push({ spell, type: "spell-cast" });

      if (empowered) {
        draft.events.push({
          duelistId: self.id,
          spell,
          type: "perfect-release",
        });
      }
    }
  };

  /**
   * Focus earned this tick, read off its events: a Light Spell landed, a
   * Parry, a Perfect Dodge, and a little for every Spell that damaged the
   * Duelist (its direct hit and its Burn count once together). Capped at
   * three segments; it never decays.
   */
  const gainFocus = (draft: Draft) => {
    const { gain, max } = tuning.focus;
    const gains = new Map<DuelistId, number>();
    // Each Spell's damage counts once per Duelist it hurt.
    const hurt = new Set<string>();

    const add = (id: DuelistId, points: number) =>
      gains.set(id, (gains.get(id) ?? 0) + points);

    const damaged = (spell: SpellState, id: DuelistId) => {
      const key = `${spell.id}:${id}`;

      if (!hurt.has(key)) {
        hurt.add(key);
        add(id, gain.damageTaken);
      }
    };

    for (const event of draft.events) {
      if (event.type === "spell-hit" && event.spell.kind === "stupefy") {
        add(event.spell.casterId, gain.lightSpellHit);
      }

      if (event.type === "spell-hit" && event.damage > 0) {
        damaged(event.spell, event.targetId);
      } else if (event.type === "explosion") {
        for (const id of event.burned) {
          damaged(event.spell, id);
        }
      } else if (event.type === "parry") {
        add(event.duelistId, gain.parry);
      } else if (event.type === "perfect-dodge") {
        add(event.duelistId, gain.perfectDodge);
      } else if (event.type === "clash-end" && event.winnerId !== null) {
        add(event.winnerId, gain.clashWin);
      }
    }

    if (gains.size > 0) {
      draft.duelists = draft.duelists.map((self) => ({
        ...self,
        focus: Math.min(self.focus + (gains.get(self.id) ?? 0), max),
      }));
    }
  };

  const step = (intents: Readonly<Record<DuelistId, Intent>>): DuelTick => {
    const draft: Draft = {
      ...current,
      backfires: new Map(),
      blasts: new Map(),
      checkedForDrinks: 0,
      events: [],
    };

    const intentOf = (id: DuelistId) => intents[id] ?? idleIntent;

    advanceClock(draft);

    const damage = flySpells(draft);

    struggle(draft, intentOf, damage);
    // A Spell landing on a drinker (in flight, or a Clash won) loses their Potion.
    interruptDrinks(draft);
    applyDamage(draft, burn(draft, damage));
    decideRound(draft);

    const releases = act(draft, intentOf);

    // A Backfire hurts its caster like any hit, and can Knock them Out.
    applyDamage(draft, draft.backfires);
    decideRound(draft);
    tendWands(draft);
    cast(draft, releases);
    // Depulso's cone lands as it is cast, interrupting a drinker caught in it.
    interruptDrinks(draft);
    // Depulso lands as it is cast, and can Knock an opponent Out.
    applyDamage(draft, draft.blasts);
    decideRound(draft);
    gainFocus(draft);

    // A Practice keeps the learner's meters up and brings the rival's Health back.
    if (practiceKeeper) {
      draft.duelists = practiceKeeper.tend(current.duelists, draft.duelists);
    }

    // The beam follows the Wands wherever the Duelists ended the tick.
    const { clash } = draft;

    current = {
      clash: clash && placeClash(clash.sides, clash.along, draft.duelists),
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
