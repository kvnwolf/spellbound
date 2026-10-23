/**
 * The AI Controller: duels like a person at one of three Difficulties. It
 * reads the Duel snapshot and produces the same Intent a human's DualSense
 * does: it turns its aim and presses R3 to Lock On, walks and strafes to keep
 * its distance, taps Stupefy and holds Confringo, raises the Shield, Dodges
 * and jumps at incoming Spells, ducks behind Cover, punishes a Staggered
 * opponent and pumps R2 in a Clash. Every reaction waits a human-like delay, and every choice is
 * rolled on a seeded random source, so a Duel replays exactly per seed.
 * Pure: no three.js, no DOM.
 */
import { aimAt, sightBlocked } from "../duel/aim";
import type { Difficulty } from "../duel/difficulty";
import { clashOpponentOf } from "../duel/duel";
import type {
  ArenaLayout,
  DuelistState,
  DuelSnapshot,
  SpellState,
} from "../duel/duel";
import {
  clamp,
  direction,
  distanceBetween,
  rightOf,
  forwardOf,
  wrapAngle,
} from "../duel/geometry";
import type { GroundPoint } from "../duel/geometry";
import { idleIntent } from "../duel/intent";
import type { Intent, Vec2 } from "../duel/intent";
import type { Tuning } from "../tuning";
import type { Controller } from "./controller";
import { between, gaussian, pick } from "./random";
import type { Random } from "./random";

export interface AiSetup {
  /** The Arena the Duel is fought in: for sight lines, Cover and the aim pivot. */
  readonly arena: ArenaLayout;
  readonly difficulty: Difficulty;
  readonly random: Random;
  readonly tuning: Tuning;
}

const defenceKinds = ["dodge", "jump", "shield"] as const;

type DefenceKind = (typeof defenceKinds)[number];

/** A defence planned against an incoming Spell, pressed at its time. */
type Defence =
  | {
      readonly action: "shield";
      readonly raiseAt: number;
      readonly lowerAt: number;
    }
  | { readonly action: "dodge"; readonly at: number; readonly side: -1 | 1 }
  | { readonly action: "jump"; readonly at: number };

/** The attack in progress: a burst of Stupefies, or a Confringo being Charged. */
type Attack =
  | { readonly kind: "light"; readonly left: number; readonly nextAt: number }
  | {
      readonly kind: "heavy";
      readonly startedAt: number;
      readonly releaseAt: number;
    };

/** A Spell on its way to the body: when it lands, and how high on the body. */
interface Threat {
  readonly seconds: number;
  readonly height: number;
}

/** Everything the AI keeps between ticks. Times are Duel seconds. */
interface Memory {
  round: number;
  /** R3 is not pressed again before this, so a lock is never toggled straight off. */
  lockReadyAt: number;
  wasLocked: boolean;
  strafe: -1 | 0 | 1;
  strafeUntil: number;
  stuckTicks: number;
  /** Defences planned against Spells on their way, in the order they were planned. */
  defences: Defence[];
  attack: Attack | undefined;
  nextAttackAt: number;
  punishAt: number | undefined;
  opponentWasStaggered: boolean;
  cover: { readonly spot: GroundPoint; readonly until: number } | undefined;
  seen: Set<number>;
  previous: DuelSnapshot | undefined;
  /** What was pressed last tick: a press needs the button up the tick before. */
  pressed: { dodge: boolean; jump: boolean; light: boolean; pump: boolean };
  /** In a Clash, when the next pump is due; undefined outside one. */
  pumpAt: number | undefined;
  /** How far the AI asked to walk last tick, in metres, to tell when it is stuck. */
  askedStride: number;
}

const freshMemory = (): Memory => ({
  askedStride: 0,
  attack: undefined,
  cover: undefined,
  defences: [],
  lockReadyAt: 0,
  nextAttackAt: 0,
  opponentWasStaggered: false,
  pressed: { dodge: false, jump: false, light: false, pump: false },
  previous: undefined,
  pumpAt: undefined,
  punishAt: undefined,
  round: 0,
  seen: new Set(),
  strafe: 0,
  strafeUntil: 0,
  stuckTicks: 0,
  wasLocked: false,
});

/** `world`, a direction on the floor, as a move vector relative to `ahead`. */
const relativeTo = (world: GroundPoint, ahead: GroundPoint): Vec2 => {
  const side = rightOf(ahead);

  return {
    x: world.x * side.x + world.z * side.z,
    y: world.x * ahead.x + world.z * ahead.z,
  };
};

const find = (snapshot: DuelSnapshot, id: string) =>
  snapshot.duelists.find((each) => each.id === id);

/** The nearest opponent of `self` still standing. */
const nearestOpponent = (
  snapshot: DuelSnapshot,
  self: DuelistState
): DuelistState | undefined => {
  let nearest: DuelistState | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const each of snapshot.duelists) {
    const distance = distanceBetween(self.position, each.position);

    if (
      each.team !== self.team &&
      !each.knockedOut &&
      distance < nearestDistance
    ) {
      nearest = each;
      nearestDistance = distance;
    }
  }

  return nearest;
};

export const createAiController = ({
  arena,
  difficulty,
  random,
  tuning,
}: AiSetup): Controller => {
  const { ai } = tuning;
  const profile = ai.profiles[difficulty];
  const tickSeconds = 1 / tuning.tickRate;
  const { bodyRadius } = tuning.duelist;
  const memory = freshMemory();

  const reaction = () => between(random, profile.reactionSeconds);

  /** Back to a clean slate at the start of every Round. */
  const resetFor = (round: number, now: number) => {
    Object.assign(memory, freshMemory(), {
      nextAttackAt: now + reaction(),
      round,
    });
  };

  const chestOf = (duelist: DuelistState) => ({
    x: duelist.position.x,
    y: tuning.duelist.chestHeight + duelist.elevation,
    z: duelist.position.z,
  });

  /**
   * When and how high an opposing Spell lands on `self` if they stand
   * still, flying straight along its line; undefined if it passes by or
   * Cover stands in the way.
   */
  const threatOf = (
    self: DuelistState,
    spell: SpellState
  ): Threat | undefined => {
    const { velocity } = spell;
    const groundSpeed = Math.hypot(velocity.x, velocity.z);

    if (groundSpeed < 1e-6) {
      return undefined;
    }

    const offsetX = self.position.x - spell.position.x;
    const offsetZ = self.position.z - spell.position.z;

    const closestAt =
      (offsetX * velocity.x + offsetZ * velocity.z) / groundSpeed ** 2;

    if (closestAt <= 0) {
      return undefined;
    }

    const miss = Math.hypot(
      offsetX - velocity.x * closestAt,
      offsetZ - velocity.z * closestAt
    );

    // Depulso never flies, so it is never in the air to see coming.
    if (spell.kind === "depulso") {
      return undefined;
    }

    const { radius } = tuning[spell.kind];
    const contact = bodyRadius + radius;

    if (miss > contact + ai.threatMargin) {
      return undefined;
    }

    const height = spell.position.y + velocity.y * closestAt - self.elevation;

    if (height < -radius || height > tuning.duelist.height + radius) {
      return undefined;
    }

    // Cover in the way stops it: a column counts as wide as it is plus the
    // Spell, since the Spell is stopped as soon as it touches one.
    const columns = arena.cover.map((column) => ({
      ...column,
      radius: column.radius + radius,
    }));

    if (sightBlocked(spell.position, self.position, columns)) {
      return undefined;
    }

    const entry = Math.sqrt(Math.max(contact ** 2 - miss ** 2, 0));

    return {
      height,
      seconds: Math.max(closestAt - entry / groundSpeed, 0),
    };
  };

  /** Picks how to meet a Spell landing `threat.seconds` from `now`, if anything can. */
  const planDefence = (
    self: DuelistState,
    threat: Threat,
    now: number
  ): Defence | undefined => {
    const readyAt = now + reaction();
    const landsAt = now + threat.seconds;
    const { defence } = tuning;

    const can: Record<DefenceKind, boolean> = {
      dodge: self.stamina >= defence.dodge.cost + ai.staminaReserve,
      jump:
        self.stamina >= defence.jump.cost &&
        landsAt - readyAt >= ai.jump.minWarning &&
        threat.height < ai.jump.maxHeight,
      shield: self.stamina > ai.staminaReserve,
    };

    const action = pick(
      random,
      defenceKinds.map((kind) => [kind, can[kind] ? profile.defences[kind] : 0])
    );

    if (action === undefined) {
      return undefined;
    }

    if (action === "shield") {
      return {
        action,
        lowerAt: landsAt + ai.shieldHoldSeconds,
        raiseAt: Math.max(
          readyAt,
          landsAt - between(random, profile.shieldLead)
        ),
      };
    }

    if (action === "jump") {
      return { action, at: Math.max(readyAt, landsAt - ai.jump.lead) };
    }

    let side: -1 | 1 = random() < 0.5 ? -1 : 1;

    if (memory.strafe !== 0) {
      side = memory.strafe;
    }

    return {
      action,
      at: Math.max(readyAt, landsAt - between(random, ai.dodgeLead)),
      side,
    };
  };

  /** Notices Spells newly flying at `self`, and rolls whether (and how) to defend each. */
  const watchSpells = (
    self: DuelistState,
    snapshot: DuelSnapshot,
    now: number
  ) => {
    const flying = new Set<number>();

    for (const spell of snapshot.spells) {
      flying.add(spell.id);

      if (spell.team === self.team || memory.seen.has(spell.id)) {
        continue;
      }

      memory.seen.add(spell.id);
      const threat = threatOf(self, spell);

      if (!threat || random() >= profile.defendChance) {
        continue;
      }

      const plan = planDefence(self, threat, now);
      // One Dodge or jump at a time: it already carries the Duelist clear.
      const moving = memory.defences.some((each) => each.action !== "shield");

      if (plan && (plan.action === "shield" || !moving)) {
        memory.defences.push(plan);
      }
    }

    for (const id of memory.seen) {
      if (!flying.has(id)) {
        memory.seen.delete(id);
      }
    }
  };

  /** A Staggered or Petrified opponent: after a reaction, maybe go for the punish. */
  const watchOpponent = (opponent: DuelistState, now: number) => {
    const staggered =
      opponent.staggerSeconds > 0 || opponent.petrifiedSeconds > 0;

    if (staggered && !memory.opponentWasStaggered) {
      memory.punishAt =
        random() < profile.punishChance ? now + reaction() : undefined;
    }

    if (!staggered) {
      memory.punishAt = undefined;
    }

    memory.opponentWasStaggered = staggered;
  };

  const chargeHold = () =>
    clamp(
      gaussian(random, profile.chargeHold.mean, profile.chargeHold.spread),
      tickSeconds,
      tuning.confringo.fullSeconds * 2
    );

  /** The punish: a Charged Confringo when the opening lasts long enough to release it, else a full Stupefy chain. */
  const punish = (opponent: DuelistState, now: number) => {
    memory.punishAt = undefined;

    if (memory.attack?.kind === "heavy") {
      return;
    }

    const opening = Math.max(
      opponent.staggerSeconds,
      opponent.petrifiedSeconds
    );

    const hold = chargeHold();

    memory.attack =
      opening >= hold
        ? { kind: "heavy", releaseAt: now + hold, startedAt: now }
        : {
            kind: "light",
            left: tuning.stupefy.chainLength,
            nextAt: now,
          };
  };

  /** Starts the next attack once its pause is over, unless the Target is crossing the line of fire. */
  const startAttack = (
    self: DuelistState,
    opponent: DuelistState,
    now: number
  ) => {
    const before = memory.previous && find(memory.previous, opponent.id);

    if (before) {
      const moved = {
        x: (opponent.position.x - before.position.x) / tickSeconds,
        z: (opponent.position.z - before.position.z) / tickSeconds,
      };

      const across = rightOf(direction(self.position, opponent.position));
      const crossing = Math.abs(moved.x * across.x + moved.z * across.z);

      if (crossing > ai.crossingSpeed && random() < profile.discipline) {
        memory.nextAttackAt = now + ai.waitSeconds;

        return;
      }
    }

    if (random() < profile.heavyShare) {
      memory.attack = {
        kind: "heavy",
        releaseAt: now + chargeHold(),
        startedAt: now,
      };
    } else {
      const { max, min } = profile.burst;

      memory.attack = {
        kind: "light",
        left: min + Math.floor(random() * (max - min + 1)),
        nextAt: now,
      };
    }
  };

  /** The buttons of the attack in progress this tick, moving it along. */
  const attackButtons = (
    self: DuelistState,
    now: number
  ): Pick<Intent, "heavySpell" | "lightSpell"> => {
    const { attack } = memory;
    const none = { heavySpell: false, lightSpell: false };

    if (!attack) {
      return none;
    }

    if (attack.kind === "heavy") {
      // The Charge was lost (a hit, a Dodge): give up on it.
      const lost =
        now > attack.startedAt + 2 * tickSeconds && self.chargeSeconds === 0;

      if (now < attack.releaseAt && !lost) {
        return { ...none, heavySpell: true };
      }

      memory.attack = undefined;
      memory.nextAttackAt = now + between(random, profile.attackPause);

      return none;
    }

    if (now < attack.nextAt || memory.pressed.light) {
      return none;
    }

    const left = attack.left - 1;

    memory.attack =
      left > 0
        ? {
            ...attack,
            left,
            nextAt:
              now + tuning.stupefy.castInterval + between(random, ai.burstGap),
          }
        : undefined;

    if (left === 0) {
      memory.nextAttackAt = now + between(random, profile.attackPause);
    }

    return { ...none, lightSpell: true };
  };

  /**
   * The defence buttons this tick, from the plans: the Shield is up through
   * every planned Shield's window (overlapping windows hold it up, separate
   * ones raise it afresh, which is what Parries); a Dodge or jump is pressed
   * once its moment comes. Plans carried out or past are dropped.
   */
  const defenceButtons = (
    now: number
  ): Partial<Pick<Intent, "dodge" | "jump" | "move" | "shield">> => {
    memory.defences = memory.defences.filter(
      (plan) => plan.action !== "shield" || now < plan.lowerAt
    );

    const shield = memory.defences.some(
      (plan) => plan.action === "shield" && now >= plan.raiseAt
    );

    const due = memory.defences.find(
      (plan) =>
        plan.action !== "shield" &&
        now >= plan.at &&
        !memory.pressed[plan.action]
    );

    if (!due || due.action === "shield") {
      return { shield };
    }

    memory.defences = memory.defences.filter((plan) => plan !== due);

    return due.action === "dodge"
      ? { dodge: true, move: { x: due.side, y: 0 } }
      : { jump: true, shield };
  };

  /** A spot behind the nearest column, out of the opponent's sight, within reach. */
  const coverSpot = (
    self: DuelistState,
    opponent: DuelistState
  ): GroundPoint | undefined => {
    let best: GroundPoint | undefined;
    let bestDistance: number = ai.cover.reach;

    for (const column of arena.cover) {
      const away = direction(opponent.position, column.center);
      const back = column.radius + bodyRadius + ai.cover.standOff;

      const spot = {
        x: column.center.x + away.x * back,
        z: column.center.z + away.z * back,
      };

      const distance = distanceBetween(self.position, spot);

      if (distance < bestDistance) {
        best = spot;
        bestDistance = distance;
      }
    }

    return best;
  };

  /** Hit since last tick: maybe run for Cover. */
  const watchHealth = (
    self: DuelistState,
    opponent: DuelistState,
    now: number
  ) => {
    const before = memory.previous && find(memory.previous, self.id);

    if (
      !before ||
      self.health >= before.health ||
      memory.cover ||
      random() >= profile.coverChance
    ) {
      return;
    }

    const spot = coverSpot(self, opponent);

    if (spot) {
      memory.cover = {
        spot,
        until: now + between(random, ai.cover.seconds),
      };
      memory.attack = undefined;
    }
  };

  /** Picks a new strafe now and then, and turns round when stuck against something. */
  const steerStrafe = (self: DuelistState, now: number) => {
    const before = memory.previous && find(memory.previous, self.id);
    const walked = before ? distanceBetween(before.position, self.position) : 0;

    const free =
      before !== undefined &&
      !self.shielding &&
      self.chargeSeconds === 0 &&
      self.dodgeSeconds === 0 &&
      self.staggerSeconds === 0 &&
      self.knockbackSeconds === 0;

    memory.stuckTicks =
      free &&
      memory.askedStride > 0 &&
      walked < memory.askedStride * ai.stuckShare
        ? memory.stuckTicks + 1
        : 0;

    if (memory.stuckTicks > ai.stuckTicks && memory.strafe !== 0) {
      memory.strafe = memory.strafe === 1 ? -1 : 1;
      memory.stuckTicks = 0;
      memory.strafeUntil = now + between(random, ai.strafeSeconds);
    }

    if (now >= memory.strafeUntil) {
      const strafing = random() < profile.strafeChance;
      memory.strafe = random() < 0.5 ? -1 : 1;

      if (!strafing) {
        memory.strafe = 0;
      }

      memory.strafeUntil = now + between(random, ai.strafeSeconds);
    }
  };

  /** Where to walk this tick: keep within the band and strafe, or head for Cover. */
  const walk = (
    self: DuelistState,
    opponent: DuelistState,
    now: number
  ): Pick<Intent, "move" | "sprint"> => {
    const locked = self.targetId !== null;

    const ahead = locked
      ? direction(self.position, opponent.position)
      : forwardOf(self.aim.yaw);

    if (memory.cover && now >= memory.cover.until) {
      memory.cover = undefined;
    }

    if (memory.cover) {
      const { spot } = memory.cover;
      const there = distanceBetween(self.position, spot) < bodyRadius;

      return {
        move: there
          ? { x: 0, y: 0 }
          : relativeTo(direction(self.position, spot), ahead),
        sprint: false,
      };
    }

    const distance = distanceBetween(self.position, opponent.position);
    const { band } = profile;
    let forward = 0;

    if (distance > band.max) {
      forward = 1;
    } else if (distance < band.min) {
      forward = -1;
    }

    const sprint =
      distance > band.max + ai.sprintBeyond &&
      self.stamina > tuning.defence.stamina.max / 2;

    // Out of sight behind Cover: step out of the column's shadow the short
    // way, square to the line from the opponent past the column.
    const blocking = arena.cover.find((column) =>
      sightBlocked(self.position, opponent.position, [column])
    );

    if (blocking) {
      const line = direction(opponent.position, blocking.center);
      const across = rightOf(line);

      const offset =
        (self.position.x - blocking.center.x) * across.x +
        (self.position.z - blocking.center.z) * across.z;

      const way = offset >= 0 ? 1 : -1;

      return {
        move: relativeTo({ x: across.x * way, z: across.z * way }, ahead),
        sprint,
      };
    }

    return {
      move: { x: memory.strafe * profile.strafeSpeed, y: forward },
      sprint,
    };
  };

  /**
   * Free-aiming: turns the aim toward the opponent's chest like a right
   * stick, and presses R3 once it is on them and in sight. Locked On: leaves
   * the stick alone.
   */
  const aimAndLock = (
    self: DuelistState,
    opponent: DuelistState,
    now: number
  ): Pick<Intent, "lockOn" | "look"> => {
    const locked = self.targetId !== null;

    if (memory.wasLocked && !locked) {
      // The lock broke: it takes a moment to notice and press R3 again.
      memory.lockReadyAt = now + reaction();
    }

    memory.wasLocked = locked;

    if (locked) {
      return { lockOn: false, look: { pitch: 0, yaw: 0 } };
    }

    const wanted = aimAt(
      self.position,
      chestOf(opponent),
      arena,
      tuning.aim.eye
    );

    const yawLeft = wrapAngle(wanted.yaw - self.aim.yaw);
    const pitchLeft = wanted.pitch - self.aim.pitch;
    const { gain, lockAngle, maxSpeed } = ai.look;

    const lockable =
      now >= memory.lockReadyAt &&
      Math.abs(yawLeft) < lockAngle &&
      Math.abs(pitchLeft) < lockAngle * 2 &&
      distanceBetween(self.position, opponent.position) <=
        tuning.lockOn.range &&
      !sightBlocked(self.position, opponent.position, arena.cover);

    if (lockable) {
      memory.lockReadyAt = now + reaction();
    }

    return {
      lockOn: lockable,
      look: {
        pitch: clamp(pitchLeft * gain, -maxSpeed, maxSpeed),
        yaw: clamp(yawLeft * gain, -maxSpeed, maxSpeed),
      },
    };
  };

  /**
   * The attack buttons this tick: a punish once its reaction is over, else
   * the next attack once its pause is, carried on until done. Defending
   * drops the attack under way; the next one can follow as soon as the
   * defence is over, a counter.
   */
  const attackFor = (
    self: DuelistState,
    opponent: DuelistState,
    busy: boolean,
    now: number
  ): Pick<Intent, "heavySpell" | "lightSpell"> => {
    if (busy) {
      memory.attack = undefined;
    }

    // Waiting on a defence: hold fire (a Spell cast now would only meet the
    // incoming one in the air), though a Charge already building carries on.
    const waiting =
      memory.defences.length > 0 && memory.attack?.kind !== "heavy";

    const canAttack =
      !busy &&
      !waiting &&
      memory.cover === undefined &&
      self.targetId === opponent.id &&
      self.elevation === 0;

    if (!canAttack) {
      return { heavySpell: false, lightSpell: false };
    }

    if (memory.punishAt !== undefined && now >= memory.punishAt) {
      punish(opponent, now);
    } else if (!memory.attack && now >= memory.nextAttackAt) {
      startAttack(self, opponent, now);
    }

    return attackButtons(self, now);
  };

  /** Everything the AI does while the Round is fought and it is free to act. */
  const fight = (
    self: DuelistState,
    opponent: DuelistState,
    now: number
  ): Omit<Intent, "lockOn" | "look"> => {
    const walked = walk(self, opponent, now);

    // Bracing for a Spell to land on the Shield: feet planted, no strafing
    // (unless walking out from behind Cover).
    const bracing =
      memory.defences.some((plan) => plan.action === "shield") &&
      !sightBlocked(self.position, opponent.position, arena.cover);

    const walking = bracing
      ? { ...walked, move: { x: 0, y: walked.move.y } }
      : walked;

    const defending = defenceButtons(now);

    const busy =
      defending.shield === true ||
      defending.dodge === true ||
      defending.jump === true ||
      self.shielding ||
      self.dodgeSeconds > 0;

    const intent = {
      ...idleIntent,
      ...walking,
      ...attackFor(self, opponent, busy, now),
      ...defending,
    };

    memory.askedStride =
      Math.min(Math.hypot(intent.move.x, intent.move.y), 1) *
      tuning.duelist.walkSpeed *
      tickSeconds;

    return intent;
  };

  /**
   * Locked in a Clash, the AI mashes R2 at its Difficulty's rate: the first
   * pump after a reaction, then one press (a tick down, then up) every
   * 1 / rate seconds, the rate picked afresh each time. Whatever it was
   * doing before the Clash is dropped.
   */
  const pumpFor = (now: number): boolean => {
    memory.attack = undefined;
    memory.defences = [];

    if (memory.pumpAt === undefined) {
      memory.pumpAt = now + reaction();

      return false;
    }

    if (memory.pressed.pump || now < memory.pumpAt) {
      return false;
    }

    memory.pumpAt = now + 1 / between(random, profile.clashPumpRate);

    return true;
  };

  const decide = (snapshot: DuelSnapshot, selfId: string): Intent => {
    const now = snapshot.tick * tickSeconds;
    const self = find(snapshot, selfId);
    const { phase } = snapshot.round;

    if (snapshot.round.number !== memory.round) {
      resetFor(snapshot.round.number, now);
    }

    const opponent = self && nearestOpponent(snapshot, self);

    if (
      !self ||
      self.knockedOut ||
      !opponent ||
      (phase !== "fighting" && phase !== "intro")
    ) {
      return idleIntent;
    }

    if (clashOpponentOf(snapshot.clash, selfId) !== undefined) {
      return { ...idleIntent, clashPump: pumpFor(now) };
    }

    memory.pumpAt = undefined;

    const aiming = aimAndLock(self, opponent, now);

    if (phase === "intro") {
      return { ...idleIntent, ...aiming };
    }

    watchSpells(self, snapshot, now);
    watchOpponent(opponent, now);
    watchHealth(self, opponent, now);
    steerStrafe(self, now);

    if (
      self.staggerSeconds > 0 ||
      self.petrifiedSeconds > 0 ||
      self.knockbackSeconds > 0
    ) {
      // Sidelined: whatever was under way is lost; start afresh once free.
      memory.attack = undefined;
      memory.defences = [];

      return { ...idleIntent, ...aiming };
    }

    return { ...fight(self, opponent, now), ...aiming };
  };

  return {
    intent: ({ self, snapshot }) => {
      const intent = decide(snapshot, self);

      memory.previous = snapshot;
      memory.pressed = {
        dodge: intent.dodge,
        jump: intent.jump,
        light: intent.lightSpell,
        pump: intent.clashPump,
      };

      return intent;
    },
  };
};
