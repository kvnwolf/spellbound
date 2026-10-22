/**
 * The Duel simulation: pure, deterministic and advanced on a fixed timestep.
 * It is the only place game state changes. Views read its snapshot; Controllers
 * feed it one Intent per Duelist per tick. No three.js, no DOM.
 */
import type { Tuning } from "../tuning";
import { fly } from "./flight";
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
  /** Metres per second. Spells fly straight. */
  readonly velocity: Point3;
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
}

const freshBookkeeping = (): Bookkeeping => ({
  chain: 0,
  held: false,
  queued: false,
  recoveryTicks: 0,
  staggerTicks: 0,
  ticksSinceCast: Number.POSITIVE_INFINITY,
});

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

/** Velocity of a Spell flying from `from` through `to` at `speed`. */
const towards = (from: Point3, to: Point3, speed: number): Point3 => {
  const x = to.x - from.x;
  const y = to.y - from.y;
  const z = to.z - from.z;
  const length = Math.hypot(x, y, z) || 1;

  return {
    x: (x / length) * speed,
    y: (y / length) * speed,
    z: (z / length) * speed,
  };
};

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

  /** Everyone back at their spawn at full Health, as every Round starts. */
  const lineUp = (): DuelistState[] => {
    bookkeeping.clear();

    return lockOn(
      config.duelists.map((setup) => ({
        aimPoint: { x: setup.spawn.x, y: 0, z: setup.spawn.z },
        facing: defaultForward,
        health: tuning.duelist.health,
        id: setup.id,
        knockedOut: false,
        position: setup.spawn,
        staggerSeconds: 0,
        targetId: null,
        team: setup.team,
      })),
      () => idleIntent.aim,
      tuning
    );
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
      draft.spells,
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

  /** Duelists move and decide to cast: only while fighting, standing and not Staggered. */
  const act = (
    draft: Draft,
    intentOf: (id: DuelistId) => Intent
  ): Set<DuelistId> => {
    const casters = new Set<DuelistId>();
    const byId = new Map(draft.duelists.map((each) => [each.id, each]));

    const acted = draft.duelists.map((self) => {
      const intent = intentOf(self.id);
      const book = books(self.id);
      const pressed = intent.lightSpell && !book.held;

      const canAct =
        draft.round.phase === "fighting" &&
        !self.knockedOut &&
        book.staggerTicks === 0;

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

    draft.duelists = lockOn(acted, (id) => intentOf(id).aim, tuning);

    return casters;
  };

  /**
   * New Stupefies leave the Wand toward the freshly locked aim point. Casts
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

      const spell: SpellState = {
        casterId: self.id,
        id: nextSpellId,
        kind: "stupefy",
        position: origin,
        strong,
        team: self.team,
        velocity: towards(origin, self.aimPoint, stupefy.speed),
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
