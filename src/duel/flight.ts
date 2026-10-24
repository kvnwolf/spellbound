/**
 * Spell flight for one tick: every Spell in the air travels its straight
 * segment, and whatever it meets first along that segment decides its fate:
 * another Spell (both cancel, or lock into a Clash), a Duelist (a hit), Cover, the Arena bounds or
 * the floor. Collisions are swept, so a fast Spell never tunnels through a
 * thin target between two ticks. Pure; the Duel simulation applies outcomes.
 */
import type { ArenaLayout, DuelistId, SpellState, TeamId } from "./duel";
import type { GroundPoint, Point3 } from "./geometry";

/** A Duelist a Spell can hit: a standing cylinder, lifted off the floor while they jump. */
export interface FlightTarget {
  readonly id: DuelistId;
  readonly team: TeamId;
  readonly position: GroundPoint;
  /** Height of the cylinder's base (the feet) above the floor. */
  readonly elevation: number;
  /** How tall the cylinder stands (lower crouched); `bodyHeight` when not given. */
  readonly height?: number;
}

export interface FlightBodies {
  readonly arena: ArenaLayout;
  readonly targets: readonly FlightTarget[];
  /** Radius and height of a Duelist's body (standing: a target can be lower). */
  readonly bodyRadius: number;
  readonly bodyHeight: number;
  /** Radius of a Spell's sphere, which differs by kind (Confringo is a big, slow blast). */
  readonly radiusOf: (spell: SpellState) => number;
  /**
   * Which pairs of opposing Spells lock into a Clash instead of cancelling,
   * and how close (centre to centre, metres) they need to come to do it.
   * Without it every meeting cancels.
   */
  readonly clash?: {
    readonly reach: number;
    readonly locks: (a: SpellState, b: SpellState) => boolean;
  };
}

export type FlightOutcome =
  | {
      readonly kind: "hit";
      readonly spell: SpellState;
      readonly targetId: DuelistId;
      readonly position: Point3;
    }
  | {
      readonly kind: "stopped";
      readonly spell: SpellState;
      readonly by: "bounds" | "cover" | "floor";
      readonly position: Point3;
    }
  | {
      readonly kind: "cancelled";
      readonly spells: readonly [SpellState, SpellState];
      readonly position: Point3;
    }
  /** Two Spells that met in the air and locked into a Clash; both leave the air. */
  | {
      readonly kind: "clashed";
      readonly spells: readonly [SpellState, SpellState];
      readonly position: Point3;
    };

/** One tick of flight: the Spells still in the air, and what became of the others. */
export interface Flight {
  readonly flying: readonly SpellState[];
  readonly outcomes: readonly FlightOutcome[];
}

/** Something a Spell meets at fraction `at` of this tick's segment. */
interface Contact {
  readonly at: number;
  readonly spells: readonly SpellState[];
  readonly outcome: FlightOutcome;
}

const pointAt = (spell: SpellState, seconds: number, at: number): Point3 => ({
  x: spell.position.x + spell.velocity.x * seconds * at,
  y: spell.position.y + spell.velocity.y * seconds * at,
  z: spell.position.z + spell.velocity.z * seconds * at,
});

/**
 * First fraction in [0, 1] at which `start + at * delta` comes within `radius`
 * of the origin, or undefined if it never does. Works in any number of
 * dimensions: pass the components to compare.
 */
const firstWithin = (
  start: readonly number[],
  delta: readonly number[],
  radius: number
): number | undefined => {
  let a = 0;
  let b = 0;
  let c = -radius * radius;

  for (const [index, from] of start.entries()) {
    const step = delta[index] ?? 0;
    a += step * step;
    b += 2 * from * step;
    c += from * from;
  }

  if (c <= 0) {
    // Already touching at the start of the tick.
    return 0;
  }

  const discriminant = b * b - 4 * a * c;

  if (a < 1e-12 || discriminant < 0) {
    return undefined;
  }

  const at = (-b - Math.sqrt(discriminant)) / (2 * a);

  return at >= 0 && at <= 1 ? at : undefined;
};

/** Where a segment from inside the Arena leaves it on one axis, as a fraction. */
const exitAlong = (from: number, delta: number, half: number) => {
  if (delta > 0) {
    return (half - from) / delta;
  }

  if (delta < 0) {
    return (-half - from) / delta;
  }

  return Number.POSITIVE_INFINITY;
};

/** The first solid thing a lone Spell runs into this tick, if any. */
const firstContact = (
  spell: SpellState,
  bodies: FlightBodies,
  seconds: number
): Contact | undefined => {
  const delta = {
    x: spell.velocity.x * seconds,
    y: spell.velocity.y * seconds,
    z: spell.velocity.z * seconds,
  };

  const contacts: Contact[] = [];

  const stop = (at: number, by: "bounds" | "cover" | "floor") =>
    contacts.push({
      at,
      outcome: {
        by,
        kind: "stopped",
        position: pointAt(spell, seconds, at),
        spell,
      },
      spells: [spell],
    });

  for (const target of bodies.targets) {
    if (target.team === spell.team) {
      continue;
    }

    const at = firstWithin(
      [
        spell.position.x - target.position.x,
        spell.position.z - target.position.z,
      ],
      [delta.x, delta.z],
      bodies.bodyRadius + bodies.radiusOf(spell)
    );

    if (at === undefined) {
      continue;
    }

    // The body is a cylinder: a Spell passing over the head (a crouching
    // Duelist's) or under the feet (a jumping Duelist's) misses.
    const position = pointAt(spell, seconds, at);
    const feet = target.elevation;
    const head = feet + (target.height ?? bodies.bodyHeight);

    if (position.y >= feet && position.y <= head) {
      contacts.push({
        at,
        outcome: { kind: "hit", position, spell, targetId: target.id },
        spells: [spell],
      });
    }
  }

  // Columns of Cover are taller than any Spell flies, so they are circles.
  for (const column of bodies.arena.cover) {
    const at = firstWithin(
      [spell.position.x - column.center.x, spell.position.z - column.center.z],
      [delta.x, delta.z],
      column.radius + bodies.radiusOf(spell)
    );

    if (at !== undefined) {
      stop(at, "cover");
    }
  }

  const { halfDepth, halfWidth } = bodies.arena.bounds;

  const leaves = Math.min(
    exitAlong(spell.position.x, delta.x, halfWidth),
    exitAlong(spell.position.z, delta.z, halfDepth)
  );

  if (leaves <= 1) {
    stop(Math.max(leaves, 0), "bounds");
  }

  if (spell.position.y + delta.y < 0) {
    stop(
      spell.position.y / (spell.position.y - (spell.position.y + delta.y)),
      "floor"
    );
  }

  let first: Contact | undefined;

  for (const contact of contacts) {
    if (first === undefined || contact.at < first.at) {
      first = contact;
    }
  }

  return first;
};

/** When two opposing Spells meet in the air this tick (to cancel, or to Clash), if they do. */
const meeting = (
  a: SpellState,
  b: SpellState,
  bodies: FlightBodies,
  seconds: number
): Contact | undefined => {
  if (a.team === b.team) {
    return undefined;
  }

  const touching = bodies.radiusOf(a) + bodies.radiusOf(b);
  const locks = bodies.clash?.locks(a, b) ?? false;

  const at = firstWithin(
    [
      a.position.x - b.position.x,
      a.position.y - b.position.y,
      a.position.z - b.position.z,
    ],
    [
      (a.velocity.x - b.velocity.x) * seconds,
      (a.velocity.y - b.velocity.y) * seconds,
      (a.velocity.z - b.velocity.z) * seconds,
    ],
    locks ? Math.max(bodies.clash?.reach ?? 0, touching) : touching
  );

  if (at === undefined) {
    return undefined;
  }

  const pointA = pointAt(a, seconds, at);
  const pointB = pointAt(b, seconds, at);

  return {
    at,
    outcome: {
      kind: locks ? "clashed" : "cancelled",
      position: {
        x: (pointA.x + pointB.x) / 2,
        y: (pointA.y + pointB.y) / 2,
        z: (pointA.z + pointB.z) / 2,
      },
      spells: [a, b],
    },
    spells: [a, b],
  };
};

/**
 * Flies every Spell for `seconds`. Contacts are settled in the order they
 * happen along the tick, so a Spell that is cancelled mid-air never also
 * hits the Duelist behind it, and vice versa.
 */
export const fly = (
  spells: readonly SpellState[],
  bodies: FlightBodies,
  seconds: number
): Flight => {
  const contacts: Contact[] = [];

  for (const [index, spell] of spells.entries()) {
    const contact = firstContact(spell, bodies, seconds);

    if (contact) {
      contacts.push(contact);
    }

    for (const other of spells.slice(index + 1)) {
      const met = meeting(spell, other, bodies, seconds);

      if (met) {
        contacts.push(met);
      }
    }
  }

  // Stable sort: equal times keep cast order, so the result is deterministic.
  contacts.sort((a, b) => a.at - b.at);

  const settled = new Set<SpellState>();
  const outcomes: FlightOutcome[] = [];

  for (const contact of contacts) {
    if (contact.spells.some((spell) => settled.has(spell))) {
      continue;
    }

    for (const spell of contact.spells) {
      settled.add(spell);
    }

    outcomes.push(contact.outcome);
  }

  const flying = spells.flatMap((spell) =>
    settled.has(spell)
      ? []
      : [{ ...spell, position: pointAt(spell, seconds, 1) }]
  );

  return { flying, outcomes };
};
