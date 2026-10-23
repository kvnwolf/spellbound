/**
 * Depulso, the Special Spell on the ✕ Spell Slot, through the Duel seam:
 * drive `createDuel` with Intents, assert snapshots and events. Same seam as
 * `specials.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { tuning } from "../tuning";
import type { Tuning } from "../tuning";
import { createDuel } from "./duel";
import type {
  ArenaLayout,
  CoverColumn,
  Duel,
  DuelEvent,
  DuelistState,
} from "./duel";
import type { GroundPoint } from "./geometry";
import { idleIntent } from "./intent";
import type { Intent } from "./intent";

const openArena: ArenaLayout = {
  bounds: { halfDepth: 10, halfWidth: 10 },
  cover: [],
  obstructions: [],
};

const { depulso, focus } = tuning;

const secondsToTicks = (seconds: number) =>
  Math.round(seconds * tuning.tickRate);

const intent = (overrides: Partial<Intent>): Intent => ({
  ...idleIntent,
  ...overrides,
});

/** Rivals tough enough to take every hit these tests land. */
const sturdy: Tuning = {
  ...tuning,
  duelist: { ...tuning.duelist, health: 1000 },
};

/** Where the hero stands, facing -z (down the Arena) toward the rival. */
const heroSpawn: GroundPoint = { x: 0, z: 5 };

interface Setup {
  /** Where the rival stands; the hero is at `heroSpawn`. */
  readonly rival: GroundPoint;
  readonly cover?: readonly CoverColumn[];
  readonly settings?: Tuning;
}

/**
 * A 1v1 past the Round intro, the hero holding Focus for a Depulso and
 * looking straight down the Arena (-z), whatever the rival's place.
 */
const fight = ({ cover = [], rival, settings = sturdy }: Setup): Duel => {
  const duel = createDuel({
    arena: { ...openArena, cover },
    duelists: [
      { id: "hero", spawn: heroSpawn, team: "gryffindor" },
      { id: "rival", spawn: rival, team: "slytherin" },
      // A third Duelist far up the Arena, Stupefied by the hero to build Focus.
      { id: "dummy", spawn: { x: 0, z: -9 }, team: "slytherin" },
    ],
    tuning: settings,
  });

  while (duel.snapshot().round.phase === "intro") {
    duel.step({});
  }

  return duel;
};

const run = (
  duel: Duel,
  ticks: number,
  intents: Readonly<Record<string, Intent>> = {}
): DuelEvent[] => {
  const events: DuelEvent[] = [];

  for (let tick = 0; tick < ticks; tick += 1) {
    events.push(...duel.step(intents).events);
  }

  return events;
};

const ofType = <T extends DuelEvent["type"]>(
  events: readonly DuelEvent[],
  type: T
) =>
  events.filter(
    (event): event is Extract<DuelEvent, { type: T }> => event.type === type
  );

const duelist = (duel: Duel, id: string): DuelistState => {
  const found = duel.snapshot().duelists.find((each) => each.id === id);

  if (!found) {
    throw new Error(`No Duelist ${id}`);
  }

  return found;
};

/** The hero turns to look straight down the Arena (yaw 0), the pitch at rest. */
const lookDownTheArena = (duel: Duel) => {
  const { rest } = tuning.aim.pitch;

  for (let tick = 0; tick < 240; tick += 1) {
    const { pitch, yaw } = duelist(duel, "hero").aim;

    if (Math.abs(yaw) < 1e-3 && Math.abs(pitch - rest) < 1e-3) {
      return;
    }

    run(duel, 1, {
      hero: intent({
        look: {
          pitch: (rest - pitch) * tuning.tickRate,
          yaw: -yaw * tuning.tickRate,
        },
      }),
    });
  }
};

/**
 * Gives the hero `points` of Focus the honest way: Locked On to whoever is
 * nearest their crosshair, landing Light Spells, then letting go of the lock.
 */
const buildFocus = (duel: Duel, points: number) => {
  run(duel, 1, { hero: intent({ lockOn: true }) });
  run(duel, 1);

  for (let cast = 0; duelist(duel, "hero").focus < points; cast += 1) {
    if (cast > 20) {
      throw new Error("Focus never built up");
    }

    run(duel, 1, { hero: intent({ lightSpell: true }) });
    run(duel, secondsToTicks(0.6));
  }

  run(duel, secondsToTicks(1));
  run(duel, 1, { hero: intent({ lockOn: true }) });
  run(duel, 1);
};

/** Holds R2 and presses ✕ for a tick, then lets go of both. */
const depulsoFrom = (duel: Duel, extra: Record<string, Intent> = {}) => [
  ...run(duel, 1, {
    ...extra,
    hero: intent({ spellSlots: { held: true, press: "cross" } }),
  }),
  ...run(duel, 1, extra),
];

/** A fight ready for a Depulso: Focus for one, looking down the Arena. */
const ready = (setup: Setup): Duel => {
  const duel = fight(setup);
  lookDownTheArena(duel);
  buildFocus(duel, depulso.segments * focus.segment);
  lookDownTheArena(duel);

  return duel;
};

/** Where the rival stands `distance` metres from the hero, `degrees` off their facing. */
const offFacing = (distance: number, degrees: number): GroundPoint => {
  const angle = (degrees * Math.PI) / 180;

  return {
    x: heroSpawn.x + Math.sin(angle) * distance,
    z: heroSpawn.z - Math.cos(angle) * distance,
  };
};

const travelled = (from: GroundPoint, to: GroundPoint) =>
  Math.hypot(to.x - from.x, to.z - from.z);

/** Lets every knockback slide to its end. */
const settle = (duel: Duel) => run(duel, secondsToTicks(1));

describe("Depulso", () => {
  it("is cast from ✕, spending one Focus segment and starting its Cooldown, with no projectile", () => {
    const duel = ready({ rival: offFacing(8, 60) });
    const before = duelist(duel, "hero").focus;

    const events = depulsoFrom(duel);

    expect(ofType(events, "spell-cast")).toMatchObject([
      { spell: { casterId: "hero", kind: "depulso" } },
    ]);
    expect(duel.snapshot().spells).toStrictEqual([]);
    expect(duelist(duel, "hero").focus).toBe(
      before - depulso.segments * focus.segment
    );
    expect(duelist(duel, "hero").cooldowns.depulso).toBeCloseTo(
      depulso.cooldownSeconds,
      1
    );
  });

  it("hits an opponent in its cone: a little damage, a hit like any other, and a push straight away from the caster", () => {
    const rival = offFacing(2.5, 20);
    const duel = ready({ rival });
    const { health, position } = duelist(duel, "rival");

    const events = [...depulsoFrom(duel), ...settle(duel)];
    const pushed = duelist(duel, "rival").position;

    expect(ofType(events, "spell-hit")).toMatchObject([
      {
        damage: depulso.damage,
        spell: { casterId: "hero", kind: "depulso" },
        staggered: false,
        targetId: "rival",
      },
    ]);
    expect(duelist(duel, "rival").health).toBe(health - depulso.damage);
    expect(travelled(position, pushed)).toBeGreaterThan(1);
    // Straight away from the hero: further from them along the same bearing.
    const away = Math.atan2(pushed.x - heroSpawn.x, heroSpawn.z - pushed.z);
    expect((away * 180) / Math.PI).toBeCloseTo(20, 0);
  });

  it("misses an opponent outside its angle or beyond its range", () => {
    const wide = ready({ rival: offFacing(2.5, depulso.coneDegrees / 2 + 10) });

    const far = ready({
      rival: offFacing(depulso.range + tuning.duelist.bodyRadius + 0.5, 0),
    });

    const missed = [
      ...depulsoFrom(wide),
      ...settle(wide),
      ...depulsoFrom(far),
      ...settle(far),
    ];

    expect(ofType(missed, "spell-cast")).toHaveLength(2);
    expect(ofType(missed, "spell-hit")).toStrictEqual([]);
  });

  it("reaches an opponent whose body touches the edge of its range", () => {
    const duel = ready({
      rival: offFacing(depulso.range + tuning.duelist.bodyRadius - 0.1, 0),
    });

    expect(ofType(depulsoFrom(duel), "spell-hit")).toHaveLength(1);
  });

  it("pushes a closer opponent further", () => {
    const near = ready({ rival: offFacing(1.2, 0) });
    const far = ready({ rival: offFacing(3.6, 0) });
    const nearFrom = duelist(near, "rival").position;
    const farFrom = duelist(far, "rival").position;

    depulsoFrom(near);
    settle(near);
    depulsoFrom(far);
    settle(far);

    const nearPush = travelled(nearFrom, duelist(near, "rival").position);
    const farPush = travelled(farFrom, duelist(far, "rival").position);

    expect(farPush).toBeGreaterThan(1);
    expect(nearPush).toBeGreaterThan(farPush + 1);
  });

  it("leaves an opponent behind Cover untouched", () => {
    // A column between the hero and the rival, clear of the far dummy.
    const duel = ready({
      cover: [{ center: offFacing(1.6, -25), radius: 0.35 }],
      rival: offFacing(3, -25),
    });

    const { health, position } = duelist(duel, "rival");

    const events = [...depulsoFrom(duel), ...settle(duel)];

    expect(ofType(events, "spell-hit")).toStrictEqual([]);
    expect(duelist(duel, "rival").health).toBe(health);
    expect(duelist(duel, "rival").position).toStrictEqual(position);
  });

  it("makes the opponent lose a Charge in progress, without a Backfire", () => {
    const duel = ready({ rival: offFacing(2.5, 0) });
    const charging = { rival: intent({ heavySpell: true }) };
    run(duel, secondsToTicks(0.2), charging);
    const charged = duelist(duel, "rival").chargeSeconds;

    // The rival keeps holding △ through the push and long after it.
    const events = [
      ...depulsoFrom(duel, charging),
      ...run(duel, secondsToTicks(1), charging),
    ];

    expect(charged).toBeGreaterThan(0);
    expect(ofType(events, "spell-hit")).toHaveLength(1);
    expect(ofType(events, "backfire")).toStrictEqual([]);
    expect(ofType(events, "spell-cast")).toMatchObject([
      { spell: { kind: "depulso" } },
    ]);
    expect(duelist(duel, "rival").chargeSeconds).toBe(0);
  });

  // Not tested yet: Depulso interrupting an opponent drinking a Potion (the
  // Potion lost). Potions do not exist until #8; Depulso's hit is a
  // `spell-hit` like any other, so the rule "a hit interrupts drinking" will
  // cover it. #8 should add that test here.

  it("is blocked by a Shield facing the caster, which still slides back, less far, and stays up", () => {
    const shield = { rival: intent({ shield: true }) };
    const guarded = ready({ rival: offFacing(2.5, 0) });
    const open = ready({ rival: offFacing(2.5, 0) });
    // Up well before the push, though it could not Parry Depulso anyway.
    run(guarded, secondsToTicks(0.5), shield);
    const { health, position } = duelist(guarded, "rival");
    const openFrom = duelist(open, "rival").position;

    const events = [
      ...depulsoFrom(guarded, shield),
      ...run(guarded, secondsToTicks(1), shield),
    ];

    depulsoFrom(open);
    settle(open);

    const guardedPush = travelled(position, duelist(guarded, "rival").position);
    const openPush = travelled(openFrom, duelist(open, "rival").position);

    expect(ofType(events, "spell-blocked")).toMatchObject([
      { duelistId: "rival", spell: { kind: "depulso" } },
    ]);
    expect(ofType(events, "spell-hit")).toStrictEqual([]);
    // Unhurt, and still behind the Shield after the slide.
    expect([
      duelist(guarded, "rival").health,
      duelist(guarded, "rival").shielding,
    ]).toStrictEqual([health, true]);
    expect(guardedPush).toBeGreaterThan(0.3);
    expect(guardedPush).toBeCloseTo(
      openPush * depulso.knockback.shieldScale,
      1
    );
  });

  it("cannot be Parried", () => {
    const duel = ready({ rival: offFacing(2.5, 0) });

    // The Shield goes up on the very tick Depulso lands.
    const events = [
      ...depulsoFrom(duel, { rival: intent({ shield: true }) }),
      ...settle(duel),
    ];

    expect(ofType(events, "parry")).toStrictEqual([]);
    expect(ofType(events, "spell-blocked")).toHaveLength(1);
  });

  it("does not touch a Dodging opponent", () => {
    const duel = ready({ rival: offFacing(2.5, 0) });
    const { health } = duelist(duel, "rival");
    // Dodging sideways, still inside the cone when it lands.
    run(duel, 2, { rival: intent({ dodge: true, move: { x: 1, y: 0 } }) });

    const events = depulsoFrom(duel);

    expect(ofType(events, "spell-hit")).toStrictEqual([]);
    expect(duelist(duel, "rival").health).toBe(health);
  });

  it("is refused while its Cooldown runs, and again castable once it is over", () => {
    const duel = ready({ rival: offFacing(8, 60) });
    depulsoFrom(duel);
    buildFocus(duel, focus.max);
    lookDownTheArena(duel);

    const again = depulsoFrom(duel);
    run(duel, secondsToTicks(depulso.cooldownSeconds));
    const later = depulsoFrom(duel);

    expect(ofType(again, "spell-cast")).toStrictEqual([]);
    expect(ofType(later, "spell-cast")).toMatchObject([
      { spell: { kind: "depulso" } },
    ]);
  });

  it("is refused without the Focus to pay for it", () => {
    const duel = fight({ rival: offFacing(2.5, 0) });
    const { health } = duelist(duel, "rival");

    const events = depulsoFrom(duel);

    expect(ofType(events, "spell-cast")).toStrictEqual([]);
    expect(duelist(duel, "rival").health).toBe(health);
  });
});
