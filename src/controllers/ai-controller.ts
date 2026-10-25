/**
 * The AI Controller: duels like a person at one of three Difficulties. It
 * reads the Duel snapshot and produces the same Intent a human's DualSense
 * does: it turns its aim and presses R3 to Lock On, walks and strafes to keep
 * its distance, taps Stupefy and holds Confringo, raises the Shield, Dodges
 * and jumps at incoming Spells, ducks behind Cover, casts the Special Spell
 * that fits the moment from its Spell Slots, punishes an opponent left open
 * (Staggered, Petrified, Disarmed or drinking), walks round Cover to its
 * Wand when Disarmed, drinks Potions when it is safe and they make sense,
 * and pumps in a Clash. Every reaction waits a human-like delay, and every choice is
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
  LooseWand,
  PotionSlot,
  SpellKind,
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
import type { SpecialSpellKind, SpellSlot } from "../duel/spell-slots";
import type { Tuning } from "../tuning";
import { wayToward } from "./ai-path";
import {
  handsFree,
  potionSlotOf,
  potionToDrink,
  safeToDrink,
} from "./ai-potions";
import {
  fittingSpecial,
  plausibleSpecials,
  readySpecials,
  slotOf,
  withinDepulso,
} from "./ai-specials";
import type { Controller } from "./controller";
import { between, gaussian, pick } from "./random";
import type { Random } from "./random";

export interface AiSetup {
  /**
   * The Arena the Duel is fought in: for sight lines, Cover and the aim
   * pivot. Each tick the AI reads it as it stands in the snapshot, so it
   * never hides behind Cover that Spells have broken.
   */
  readonly arena: ArenaLayout;
  readonly difficulty: Difficulty;
  readonly random: Random;
  readonly tuning: Tuning;
}

const defenceKinds = ["dodge", "jump", "shield"] as const;

/** The Spell Slots untouched: R2 up, no face button. */
const idleSpells = { spellSlots: idleIntent.spellSlots };

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

/** The casting in progress: a burst of Stupefies, or a Confringo being Charged. */
type Casting =
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

/** The ways an opponent can be left open to a punish. */
type Opening = "disarmed" | "drinking" | "petrified" | "staggered";

/** The opening `opponent` gives right now, if any. */
const openingOf = (opponent: DuelistState): Opening | undefined => {
  if (opponent.petrifiedSeconds > 0) {
    return "petrified";
  }

  if (opponent.staggerSeconds > 0) {
    return "staggered";
  }

  if (opponent.drinking) {
    return "drinking";
  }

  return opponent.looseWand ? "disarmed" : undefined;
};

/** Everything the AI keeps between ticks. Times are Duel seconds. */
interface Memory {
  round: number;
  /** R3 is not pressed again before this, so a lock is never toggled straight off. */
  lockReadyAt: number;
  wasLocked: boolean;
  strafe: -1 | 0 | 1;
  strafeUntil: number;
  /** Stepping out from behind Cover on the `strafe` side until then. */
  stepOutUntil: number;
  stuckTicks: number;
  /** Defences planned against Spells on their way, in the order they were planned. */
  defences: Defence[];
  casting: Casting | undefined;
  nextCastingAt: number;
  punishAt: number | undefined;
  /** The opening the opponent gave last tick, if any. */
  opponentOpening: Opening | undefined;
  cover: { readonly spot: GroundPoint; readonly until: number } | undefined;
  seen: Set<number>;
  previous: DuelSnapshot | undefined;
  /** What was pressed last tick: a press needs the button up the tick before. */
  pressed: { dodge: boolean; jump: boolean; light: boolean; pump: boolean };
  /** In a Clash, when the next pump is due; undefined outside one. */
  pumpAt: number | undefined;
  /** How far the AI asked to walk last tick, in metres, to tell when it is stuck. */
  askedStride: number;
  /** Disarmed and stuck on the way to the Wand: go round obstacles on this side until then. */
  detour: { readonly side: -1 | 1; readonly until: number } | undefined;
  /** Disarmed: the side it goes round whatever is in the way to the Wand, kept while something is. */
  wandSide: -1 | 1 | undefined;
  /** When the AI next looks for a Special Spell to cast. */
  specialLookAt: number;
  /** When the AI last cast a Light or Heavy Spell. */
  castAt: number;
  /** A Shield being baited before an Expelliarmus: until when, and whether the Shield went up. */
  bait: { readonly sawShield: boolean; readonly until: number } | undefined;
  /** The opponent was Charging or drinking within Depulso's reach last tick. */
  opponentWasThreatening: boolean;
  /** When the AI next weighs drinking a Potion. */
  potionLookAt: number;
  /** Already thought about hiding to drink during this stretch of low Health. */
  hidToDrink: boolean;
  /** The opponent's latest Spells, oldest first: which, and when first seen. */
  rhythm: {
    readonly id: number;
    readonly kind: SpellKind;
    readonly at: number;
  }[];
  /** Answering spam until then: Parrying it, holding its own fire but for a punish. */
  spamUntil: number;
}

const freshMemory = (): Memory => ({
  askedStride: 0,
  bait: undefined,
  castAt: Number.NEGATIVE_INFINITY,
  casting: undefined,
  cover: undefined,
  defences: [],
  detour: undefined,
  hidToDrink: false,
  lockReadyAt: 0,
  nextCastingAt: 0,
  opponentOpening: undefined,
  opponentWasThreatening: false,
  potionLookAt: 0,
  pressed: { dodge: false, jump: false, light: false, pump: false },
  previous: undefined,
  pumpAt: undefined,
  punishAt: undefined,
  rhythm: [],
  round: 0,
  seen: new Set(),
  spamUntil: Number.NEGATIVE_INFINITY,
  specialLookAt: 0,
  stepOutUntil: Number.NEGATIVE_INFINITY,
  strafe: 0,
  strafeUntil: 0,
  stuckTicks: 0,
  wandSide: undefined,
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
  arena: built,
  difficulty,
  random,
  tuning,
}: AiSetup): Controller => {
  const { ai } = tuning;
  const profile = ai.profiles[difficulty];
  const tickSeconds = 1 / tuning.tickRate;
  const { bodyRadius } = tuning.duelist;
  const memory = freshMemory();
  /** The Arena as it stands this tick (see `AiSetup.arena`). */
  let arena = built;

  const reaction = () => between(random, profile.reactionSeconds);

  /** Back to a clean slate at the start of every Round. */
  const resetFor = (round: number, now: number) => {
    Object.assign(memory, freshMemory(), {
      nextCastingAt: now + reaction(),
      round,
      specialLookAt: now + reaction(),
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
      // Disarmed, there is no Shield to raise.
      shield: self.looseWand === null && self.stamina > ai.staminaReserve,
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

  /**
   * Whether the opponent's latest Spells repeat one kind at a predictable
   * rhythm: spam, which the AI can see coming and time a Parry against.
   */
  const readsAsSpam = () => {
    const { casts, jitter, maxGap } = ai.spamRead;
    const latest = memory.rhythm.slice(-casts);
    const [first] = latest;

    if (!first || latest.length < casts) {
      return false;
    }

    const gaps = latest
      .slice(1)
      .map((each, index) => each.at - (latest[index]?.at ?? each.at));

    const mean = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;

    return (
      latest.every((each) => each.kind === first.kind) &&
      mean <= maxGap &&
      gaps.every((gap) => Math.abs(gap - mean) <= jitter)
    );
  };

  /**
   * Against a Spell read as spam: the Shield, raised just before it lands
   * for the Parry. Disarmed or short of Stamina for the Shield, whatever
   * defence is left.
   */
  const parryFor = (
    self: DuelistState,
    threat: Threat,
    now: number
  ): Defence | undefined => {
    if (self.looseWand !== null || self.stamina <= ai.staminaReserve) {
      return planDefence(self, threat, now);
    }

    const landsAt = now + threat.seconds;

    return {
      action: "shield",
      lowerAt: landsAt + ai.shieldHoldSeconds,
      raiseAt: Math.max(
        now + reaction(),
        landsAt - between(random, ai.spamRead.parryLead)
      ),
    };
  };

  /**
   * Notices Spells newly flying at `self`, and rolls whether (and how) to
   * defend each: one read as spam is met with a Parry on the Difficulty's
   * `spamRead`, anything else defended on its `defendChance`. `sidelined`
   * (Staggered, Petrified, knocked back), it only notes the opponent's
   * rhythm: the Spells still flying are noticed once it is free again.
   */
  const watchSpells = (
    self: DuelistState,
    snapshot: DuelSnapshot,
    now: number,
    sidelined: boolean
  ) => {
    const flying = new Set<number>();

    for (const spell of snapshot.spells) {
      flying.add(spell.id);

      if (spell.team === self.team) {
        continue;
      }

      // Spell ids only grow: each Spell counts once toward the rhythm.
      if (spell.id > (memory.rhythm.at(-1)?.id ?? -1)) {
        memory.rhythm = [
          ...memory.rhythm.slice(1 - ai.spamRead.casts),
          { at: now, id: spell.id, kind: spell.kind },
        ];
      }

      if (sidelined || memory.seen.has(spell.id)) {
        continue;
      }

      memory.seen.add(spell.id);

      const threat = threatOf(self, spell);

      if (!threat) {
        continue;
      }

      let plan: Defence | undefined;

      if (readsAsSpam() && random() < profile.spamRead) {
        memory.spamUntil = now + ai.spamRead.maxGap;
        plan = parryFor(self, threat, now);
      } else if (random() < profile.defendChance) {
        plan = planDefence(self, threat, now);
      }

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

  /**
   * An opponent left open (Staggered, Petrified, Disarmed or drinking):
   * each time an opening starts, after a reaction, maybe go for the punish.
   */
  const watchOpponent = (
    self: DuelistState,
    opponent: DuelistState,
    now: number
  ) => {
    const opening = openingOf(opponent);

    if (opening !== undefined && opening !== memory.opponentOpening) {
      memory.punishAt =
        random() < profile.punishChance ? now + reaction() : undefined;
    }

    if (opening === undefined) {
      memory.punishAt = undefined;
    }

    memory.opponentOpening = opening;

    // Starting to Charge or drink within Depulso's reach: look for a Special soon.
    const threatening =
      (opponent.chargeSeconds > 0 || opponent.drinking !== null) &&
      withinDepulso(self, opponent, tuning);

    if (threatening && !memory.opponentWasThreatening) {
      memory.specialLookAt = Math.min(memory.specialLookAt, now + reaction());
    }

    memory.opponentWasThreatening = threatening;
  };

  const chargeHold = () =>
    clamp(
      gaussian(random, profile.chargeHold.mean, profile.chargeHold.spread),
      tickSeconds,
      tuning.confringo.fullSeconds * 2
    );

  /**
   * How long the opponent's opening has left for a Confringo released into
   * it: a Stagger or Petrified as it stands; a drink, less the Spell's flight
   * (it must land before the Potion is down); a Disarm until the Wand
   * returns (no Shield till then).
   */
  const openingLeft = (self: DuelistState, opponent: DuelistState) => {
    if (opponent.drinking) {
      const flight =
        distanceBetween(self.position, opponent.position) /
        tuning.confringo.speed;

      return opponent.drinking.secondsLeft - flight;
    }

    if (opponent.looseWand) {
      return opponent.looseWand.returnSeconds;
    }

    return Math.max(opponent.staggerSeconds, opponent.petrifiedSeconds);
  };

  /** The punish: a Charged Confringo when the opening lasts long enough to release it, else a full Stupefy chain. */
  const punish = (self: DuelistState, opponent: DuelistState, now: number) => {
    memory.punishAt = undefined;

    if (memory.casting?.kind === "heavy") {
      return;
    }

    const opening = openingLeft(self, opponent);

    const hold = chargeHold();

    const heavy =
      opening >= hold && self.stamina >= tuning.confringo.staminaCost;

    memory.casting = heavy
      ? { kind: "heavy", releaseAt: now + hold, startedAt: now }
      : {
          kind: "light",
          left: tuning.stupefy.chainLength,
          nextAt: now,
        };
  };

  /** Starts the next casting once its pause is over, unless the Target is crossing the line of fire. */
  const startCasting = (
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
        memory.nextCastingAt = now + ai.waitSeconds;

        return;
      }
    }

    // Every cast keeps `castReserve` Stamina back for the answer: a Charge
    // it cannot afford becomes Stupefies, a burst shortens to what it can.
    const spare = self.stamina - ai.castReserve;

    if (
      random() < profile.heavyShare &&
      spare >= tuning.confringo.staminaCost
    ) {
      memory.casting = {
        kind: "heavy",
        releaseAt: now + chargeHold(),
        startedAt: now,
      };

      return;
    }

    const { max, min } = profile.burst;

    const left = Math.min(
      min + Math.floor(random() * (max - min + 1)),
      Math.floor(spare / tuning.stupefy.staminaCost)
    );

    if (left <= 0) {
      memory.nextCastingAt = now + ai.waitSeconds;

      return;
    }

    memory.casting = { kind: "light", left, nextAt: now };
  };

  /** The buttons of the casting in progress this tick, moving it along. */
  const castingButtons = (
    self: DuelistState,
    now: number
  ): Pick<Intent, "heavySpell" | "lightSpell"> => {
    const { casting } = memory;
    const none = { heavySpell: false, lightSpell: false };

    if (!casting) {
      return none;
    }

    if (casting.kind === "heavy") {
      // The Charge was lost (a hit, a Dodge): give up on it.
      const lost =
        now > casting.startedAt + 2 * tickSeconds && self.chargeSeconds === 0;

      if (now < casting.releaseAt && !lost) {
        return { ...none, heavySpell: true };
      }

      memory.casting = undefined;
      memory.nextCastingAt = now + between(random, profile.castingPause);
      memory.castAt = now;

      return none;
    }

    if (now < casting.nextAt || memory.pressed.light) {
      return none;
    }

    // Out of Stamina for the next Stupefy: the burst is over.
    if (self.stamina < tuning.stupefy.staminaCost) {
      memory.casting = undefined;
      memory.nextCastingAt = now + between(random, profile.castingPause);

      return none;
    }

    const left = casting.left - 1;

    memory.casting =
      left > 0
        ? {
            ...casting,
            left,
            nextAt:
              now + tuning.stupefy.castInterval + between(random, ai.burstGap),
          }
        : undefined;

    if (left === 0) {
      memory.nextCastingAt = now + between(random, profile.castingPause);
    }

    memory.castAt = now;

    return { ...none, lightSpell: true };
  };

  /**
   * The defence buttons this tick, from the plans: the Shield is up through
   * every planned Shield's window (overlapping windows hold it up, separate
   * ones raise it afresh, which is what Parries); a Dodge or jump is pressed
   * once its moment comes, along `toward` if given (else to its side).
   * Plans carried out or past are dropped.
   */
  const defenceButtons = (
    now: number,
    toward: Vec2 | undefined
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
      ? { dodge: true, move: toward ?? { x: due.side, y: 0 } }
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

  /** Whether a column of Cover still stands beside `spot`, as when the AI chose it. */
  const besideCover = (spot: GroundPoint) =>
    arena.cover.some(
      (column) =>
        distanceBetween(column.center, spot) <=
        column.radius + bodyRadius + ai.cover.standOff + 1e-6
    );

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
      memory.casting = undefined;
    }
  };

  /** Counts the ticks in a row the AI, free to walk, covered much less ground than it asked to: stuck against something. */
  const countStuck = (self: DuelistState) => {
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
  };

  /** Picks a new strafe now and then, and turns round when stuck against something. */
  const steerStrafe = (self: DuelistState, now: number) => {
    countStuck(self);

    // Stuck on the way to its Wand: go round the other way for a while.
    if (memory.stuckTicks > ai.stuckTicks && self.looseWand) {
      memory.detour = {
        side: (memory.detour?.side ?? memory.wandSide) === 1 ? -1 : 1,
        until: now + between(random, ai.wand.detourSeconds),
      };
      memory.stuckTicks = 0;
    }

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

  /**
   * Disarmed: straight for the Wand where it lands, the short way round
   * Cover, Obstructions and the opponent, sprinting while Stamina leaves
   * enough for a Dodge. Hiding in Cover is forgotten.
   */
  const toWand = (
    self: DuelistState,
    wand: LooseWand,
    opponent: DuelistState,
    ahead: GroundPoint,
    now: number
  ): Pick<Intent, "move" | "sprint"> => {
    memory.cover = undefined;

    if (memory.detour && now >= memory.detour.until) {
      memory.detour = undefined;
    }

    const obstacles = [
      ...arena.cover,
      ...arena.obstructions,
      { center: opponent.position, radius: bodyRadius },
    ];

    // There already: wait for the Wand to come down, rather than dither over it.
    if (distanceBetween(self.position, wand.landing) <= ai.wand.arriveRadius) {
      return { move: { x: 0, y: 0 }, sprint: false };
    }

    const { heading, side } = wayToward(
      self.position,
      wand.landing,
      obstacles,
      bodyRadius + ai.wand.clearance,
      memory.detour?.side ?? memory.wandSide
    );

    memory.wandSide = side;

    const sprint = self.stamina > tuning.defence.dodge.cost + ai.staminaReserve;

    return { move: relativeTo(heading, ahead), sprint };
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

    if (self.looseWand) {
      return toWand(self, self.looseWand, opponent, ahead, now);
    }

    memory.wandSide = undefined;

    // Hiding ends in time, or at once when the column it hid behind breaks.
    if (
      memory.cover &&
      (now >= memory.cover.until || !besideCover(memory.cover.spot))
    ) {
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

      let move = relativeTo(
        offset >= 0 ? across : { x: -across.x, z: -across.z },
        ahead
      );

      // Once stepping out one way, keep to it: out of the next column's
      // shadow too, and strafing on once back in sight, never straight back.
      const side = move.x >= 0 ? 1 : -1;

      if (now >= memory.stepOutUntil || memory.strafe === 0) {
        memory.strafe = side;
      }

      if (side !== memory.strafe) {
        move = { x: -move.x, y: -move.y };
      }

      memory.stepOutUntil = now + ai.stepOutSeconds;
      memory.strafeUntil = Math.max(memory.strafeUntil, memory.stepOutUntil);

      return { move, sprint };
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

  /** The Spell Slot of the Special Spell `kind`, cast now: the casting under way is dropped and the next waits its pause. */
  const castSpecial = (kind: SpecialSpellKind, now: number) => {
    memory.casting = undefined;
    memory.bait = undefined;
    memory.nextCastingAt = now + between(random, profile.castingPause);

    return slotOf(kind, tuning);
  };

  /**
   * Baiting a Shield: Expelliarmus as soon as the Shield it drew drops, or
   * once the bait has had its time; with a Spell `incoming` it holds the
   * cast (given up once the bait's time is out).
   */
  const baited = (
    self: DuelistState,
    opponent: DuelistState,
    incoming: boolean,
    now: number
  ): SpellSlot | undefined => {
    const { bait } = memory;

    if (!bait || memory.casting) {
      return undefined;
    }

    if (incoming) {
      if (now >= bait.until) {
        memory.bait = undefined;
      }

      return undefined;
    }

    if (opponent.shielding) {
      memory.bait = { ...bait, sawShield: true };

      return undefined;
    }

    if (!bait.sawShield && now < bait.until) {
      return undefined;
    }

    memory.bait = undefined;

    const still =
      readySpecials(self, tuning).includes("expelliarmus") &&
      opponent.dodgeSeconds === 0 &&
      opponent.looseWand === null &&
      !sightBlocked(self.position, opponent.position, arena.cover);

    return still ? castSpecial("expelliarmus", now) : undefined;
  };

  /**
   * A Special Spell to cast this tick, if any. Every `specials.lookSeconds`
   * (sooner, after a reaction, when the opponent starts to Charge or drink
   * within Depulso's reach) the AI looks for the one that fits the moment
   * and, on its Difficulty's `chance`, casts it: the fitting one on its
   * `sense`, else any it can pay for. Before an Expelliarmus it may first
   * bait a Shield with a Stupefy and cast as the Shield drops. Never while
   * Charging, within `specials.afterCastSeconds` of its last cast, or (but
   * Depulso) with a Spell `incoming`.
   */
  const specialFor = (
    self: DuelistState,
    opponent: DuelistState,
    incoming: boolean,
    now: number
  ): SpellSlot | undefined => {
    // Not while Charging, nor on the heels of the last cast: hands take a moment.
    if (
      memory.casting?.kind === "heavy" ||
      now < memory.castAt + ai.specials.afterCastSeconds
    ) {
      return undefined;
    }

    if (memory.bait) {
      return baited(self, opponent, incoming, now);
    }

    if (now < memory.specialLookAt) {
      return undefined;
    }

    memory.specialLookAt = now + ai.specials.lookSeconds;

    // With a Spell on its way, one cast now would only meet it in the air:
    // only Depulso, which does not fly, still makes sense.
    const plausible = plausibleSpecials(self, opponent, arena, tuning).filter(
      (each) => !incoming || each === "depulso"
    );

    if (plausible.length === 0 || random() >= profile.specials.chance) {
      return undefined;
    }

    const kind =
      random() < profile.specials.sense
        ? fittingSpecial({
            arena,
            opponent,
            reactionSeconds: profile.reactionSeconds.max,
            self,
            settings: tuning,
          })
        : plausible[Math.floor(random() * plausible.length)];

    if (kind === undefined || !plausible.includes(kind)) {
      return undefined;
    }

    if (kind === "expelliarmus" && random() < profile.specials.bait) {
      // A single Stupefy to draw the Shield out first.
      memory.casting = { kind: "light", left: 1, nextAt: now };
      memory.bait = {
        sawShield: false,
        until: now + ai.specials.baitSeconds,
      };

      return undefined;
    }

    return castSpecial(kind, now);
  };

  /**
   * The casting buttons this tick: a punish once its reaction is over, else
   * the next casting once its pause is, carried on until done. Defending
   * drops the casting under way; the next one can follow as soon as the
   * defence is over, a counter.
   */
  const castingFor = (
    self: DuelistState,
    opponent: DuelistState,
    { busy, incoming }: { readonly busy: boolean; readonly incoming: boolean },
    now: number
  ): Pick<Intent, "heavySpell" | "lightSpell" | "spellSlots"> => {
    const none = { ...idleSpells, heavySpell: false, lightSpell: false };

    if (busy) {
      memory.casting = undefined;
    }

    // Waiting on a defence: hold fire (a Spell cast now would only meet the
    // incoming one in the air), though a Charge already building carries on.
    const waiting =
      memory.defences.length > 0 && memory.casting?.kind !== "heavy";

    const canCast =
      !busy &&
      !waiting &&
      memory.cover === undefined &&
      self.targetId === opponent.id &&
      self.elevation === 0 &&
      self.looseWand === null &&
      self.drinking === null;

    if (!canCast) {
      return none;
    }

    const special = specialFor(self, opponent, incoming, now);

    if (special) {
      return { ...none, spellSlots: { held: true, press: special } };
    }

    if (memory.punishAt !== undefined && now >= memory.punishAt) {
      punish(self, opponent, now);
    } else if (
      !memory.casting &&
      !memory.bait &&
      now >= memory.nextCastingAt &&
      // Answering spam: the Parries are the answer; Stamina goes on the Shield.
      now >= memory.spamUntil
    ) {
      startCasting(self, opponent, now);
    }

    return { ...castingButtons(self, now), ...idleSpells };
  };

  /**
   * Low on Health with Wiggenweld left but no safe moment to drink it: once
   * per such stretch, maybe head for Cover to drink there.
   */
  const hideToDrink = (
    self: DuelistState,
    opponent: DuelistState,
    now: number
  ) => {
    if (memory.hidToDrink || memory.cover) {
      return;
    }

    memory.hidToDrink = true;

    const spot =
      random() < profile.potions.seekCover
        ? coverSpot(self, opponent)
        : undefined;

    if (spot) {
      memory.cover = { spot, until: now + between(random, ai.cover.seconds) };
      memory.casting = undefined;
    }
  };

  /**
   * The Potion Slot to drink from this tick, if any. Every
   * `potions.lookSeconds`, with its hands free and no defence under way, the
   * AI weighs its Potions: Wiggenweld at low Health when it is safe (else it
   * may hide to drink); Swiftness to chase a Wand lying far off, or to get
   * away at low Health with no Wiggenweld left; Strength while the opponent
   * is Disarmed or its own Focus is full; Felix Felicis when a whole Focus
   * segment would fit. Never with a Spell on its way.
   */
  const potionFor = (
    self: DuelistState,
    opponent: DuelistState,
    incoming: boolean,
    busy: boolean,
    now: number
  ): PotionSlot | undefined => {
    const max = tuning.duelist.health;
    const low = self.health <= max * profile.potions.wiggenweldBelow;

    if (!low) {
      memory.hidToDrink = false;
    }

    if (
      busy ||
      !handsFree(self) ||
      memory.casting?.kind === "heavy" ||
      now < memory.potionLookAt
    ) {
      return undefined;
    }

    memory.potionLookAt = now + ai.potions.lookSeconds;

    // Answering spam, the next Spell is always on its way.
    const spam = now < memory.spamUntil;

    const safe = safeToDrink({
      arena,
      incoming: incoming || spam,
      opponent,
      self,
      settings: tuning,
    });

    const choice = potionToDrink({
      incoming: incoming || spam,
      low,
      opponent,
      safe,
      self,
      settings: tuning,
    });

    if (choice === "hide") {
      hideToDrink(self, opponent, now);

      return undefined;
    }

    const chance =
      choice === "wiggenweld" ? profile.potions.chance : profile.potions.boost;

    // Felix Felicis is never a gamble: once it makes sense it is drunk.
    if (choice === undefined || (choice !== "felix" && random() >= chance)) {
      return undefined;
    }

    memory.casting = undefined;
    memory.bait = undefined;

    return potionSlotOf(choice, tuning);
  };

  /** Everything the AI does while the Round is fought and it is free to act. */
  const fight = (
    self: DuelistState,
    opponent: DuelistState,
    snapshot: DuelSnapshot,
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

    // Disarmed, a Dodge carries it on toward its Wand.
    const defending = defenceButtons(
      now,
      self.looseWand ? walked.move : undefined
    );

    const busy =
      defending.shield === true ||
      defending.dodge === true ||
      defending.jump === true ||
      self.shielding ||
      self.dodgeSeconds > 0;

    // A Spell on its way: an opponent's, flying toward the AI (it may yet
    // home onto it, and a Spell cast back would meet it in the air).
    const incoming = snapshot.spells.some(
      (spell) =>
        spell.team !== self.team &&
        (self.position.x - spell.position.x) * spell.velocity.x +
          (self.position.z - spell.position.z) * spell.velocity.z >
          0
    );

    const potion = potionFor(self, opponent, incoming, busy, now);

    const intent = potion
      ? {
          ...idleIntent,
          ...walking,
          potionSlots: { held: true, press: potion },
        }
      : {
          ...idleIntent,
          ...walking,
          ...castingFor(self, opponent, { busy, incoming }, now),
          ...defending,
        };

    memory.askedStride =
      Math.min(Math.hypot(intent.move.x, intent.move.y), 1) *
      tuning.duelist.walkSpeed *
      tickSeconds;

    return intent;
  };

  /**
   * Locked in a Clash, the AI mashes the pump at its Difficulty's rate: the first
   * pump after a reaction, then one press (a tick down, then up) every
   * 1 / rate seconds, the rate picked afresh each time. Whatever it was
   * doing before the Clash is dropped.
   */
  const pumpFor = (now: number): boolean => {
    memory.casting = undefined;
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

    const sidelined =
      self.staggerSeconds > 0 ||
      self.petrifiedSeconds > 0 ||
      self.knockbackSeconds > 0;

    watchSpells(self, snapshot, now, sidelined);
    watchOpponent(self, opponent, now);
    watchHealth(self, opponent, now);
    steerStrafe(self, now);

    if (sidelined) {
      // Sidelined: whatever was under way is lost; start afresh once free,
      // noticing every Spell still flying at it then.
      memory.casting = undefined;
      memory.defences = [];
      memory.seen.clear();

      return { ...idleIntent, ...aiming };
    }

    return { ...fight(self, opponent, snapshot, now), ...aiming };
  };

  return {
    intent: ({ self, snapshot }) => {
      ({ arena } = snapshot);
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
