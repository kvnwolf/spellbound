import { describe, expect, it } from "vitest";

import { tuning } from "../tuning";
import { createDuel } from "./duel";
import type { ArenaLayout, Duel, DuelEvent, DuelistState } from "./duel";
import type { Intent } from "./intent";

const openArena: ArenaLayout = {
  bounds: { halfDepth: 10, halfWidth: 10 },
  cover: [],
  obstructions: [],
};

const secondsToTicks = (seconds: number) =>
  Math.round(seconds * tuning.tickRate);

/** A 1v1 with the hero facing the rival 10 m away along -z, still in the Round intro. */
const createOneVsOne = (arena: ArenaLayout = openArena): Duel =>
  createDuel({
    arena,
    duelists: [
      { id: "hero", spawn: { x: 0, z: 5 }, team: "gryffindor" },
      { id: "rival", spawn: { x: 0, z: -5 }, team: "slytherin" },
    ],
    tuning,
  });

/** Steps idle ticks until the Round intro's countdown is over and Duelists can act. */
const skipIntro = (duel: Duel) => {
  for (
    let tick = 0;
    tick < secondsToTicks(10) && duel.snapshot().round.phase === "intro";
    tick += 1
  ) {
    duel.step({});
  }
};

/** A 1v1 with control already given: the Round intro has played out. */
const fight = (arena: ArenaLayout = openArena): Duel => {
  const duel = createOneVsOne(arena);
  skipIntro(duel);

  return duel;
};

const intent = (overrides: Partial<Intent>): Intent => ({
  aim: { x: 0, y: 0 },
  lightSpell: false,
  move: { x: 0, y: 0 },
  ...overrides,
});

const castLight = intent({ lightSpell: true });

/** Steps the Duel for `seconds` with the hero holding `heroIntent` and the rival idle. */
const hold = (duel: Duel, heroIntent: Intent, seconds: number) => {
  for (let tick = 0; tick < secondsToTicks(seconds); tick += 1) {
    duel.step({ hero: heroIntent });
  }

  return duel.snapshot();
};

/**
 * Steps `ticks` ticks with the given Intents (idle for anyone left out) and
 * returns every event emitted along the way.
 */
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

/** Presses the Light Spell for one tick as `who`, then lets go for a tick. */
const tapLight = (duel: Duel, who: string): DuelEvent[] => [
  ...run(duel, 1, { [who]: castLight }),
  ...run(duel, 1),
];

/** Lets every Spell in flight land: 1.5 s covers the longest flight in the test Arena. */
const settle = (duel: Duel): DuelEvent[] => run(duel, secondsToTicks(1.5));

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

describe("Duel ticks", () => {
  it("advances the tick count and reports no events while Duelists only move", () => {
    const duel = fight();
    const before = duel.snapshot().tick;

    const { snapshot, events } = duel.step({
      hero: intent({ move: { x: 1, y: 1 } }),
    });

    expect(snapshot.tick).toBe(before + 1);
    expect(events).toStrictEqual([]);
  });
});

describe("Duel movement", () => {
  it("walks the Duelist toward its Target at walk speed when the stick is pushed forward", () => {
    const duel = fight();

    hold(duel, intent({ move: { x: 0, y: 1 } }), 1);

    expect(duelist(duel, "hero").position.x).toBeCloseTo(0);
    expect(duelist(duel, "hero").position.z).toBeCloseTo(
      5 - tuning.duelist.walkSpeed
    );
  });

  it("circles the Target at a constant distance when strafing right", () => {
    const duel = fight();

    hold(duel, intent({ move: { x: 1, y: 0 } }), 1);

    const { position } = duelist(duel, "hero");
    expect(position.x).toBeGreaterThan(3);
    expect(Math.hypot(position.x, position.z + 5)).toBeCloseTo(10);
  });
});

describe("Duel collision", () => {
  it("stops the Duelist at the Arena bounds", () => {
    const duel = fight();

    hold(duel, intent({ move: { x: 0, y: -1 } }), 3);

    expect(duelist(duel, "hero").position).toStrictEqual({
      x: 0,
      z: 10 - tuning.duelist.bodyRadius,
    });
  });

  it("stops the Duelist against a column of Cover standing in the way", () => {
    const duel = fight({
      ...openArena,
      cover: [{ center: { x: 0, z: 0 }, radius: 1 }],
    });

    hold(duel, intent({ move: { x: 0, y: 1 } }), 2);

    const { position } = duelist(duel, "hero");
    expect(position.x).toBeCloseTo(0);
    expect(position.z).toBeCloseTo(1 + tuning.duelist.bodyRadius);
  });

  it("slides the Duelist around a column it walks into off-centre", () => {
    const duel = fight({
      ...openArena,
      cover: [{ center: { x: 0.3, z: 0 }, radius: 1 }],
    });

    hold(duel, intent({ move: { x: 0, y: 1 } }), 3);

    expect(duelist(duel, "hero").position.z).toBeLessThan(0);
  });

  it("stops the Duelist against an Obstruction standing in the way", () => {
    const duel = fight({
      ...openArena,
      obstructions: [{ center: { x: 0, z: 0 }, radius: 1 }],
    });

    hold(duel, intent({ move: { x: 0, y: 1 } }), 2);

    const { position } = duelist(duel, "hero");
    expect(position.x).toBeCloseTo(0);
    expect(position.z).toBeCloseTo(1 + tuning.duelist.bodyRadius);
  });

  it("slides the Duelist around an Obstruction it walks into off-centre", () => {
    const duel = fight({
      ...openArena,
      obstructions: [{ center: { x: 0.3, z: 0 }, radius: 1 }],
    });

    hold(duel, intent({ move: { x: 0, y: 1 } }), 3);

    expect(duelist(duel, "hero").position.z).toBeLessThan(0);
  });

  it("does not let a Duelist walk through another Duelist", () => {
    const duel = fight();

    hold(duel, intent({ move: { x: 0, y: 1 } }), 4);

    const hero = duelist(duel, "hero");
    const rival = duelist(duel, "rival");
    expect(rival.position).toStrictEqual({ x: 0, z: -5 });
    expect(hero.position.z - rival.position.z).toBeCloseTo(
      2 * tuning.duelist.bodyRadius
    );
  });
});

describe("Duel Targets", () => {
  it("locks each Duelist onto the opposing Duelist and keeps them facing it", () => {
    const duel = fight();

    hold(duel, intent({ move: { x: 1, y: 0 } }), 0.5);

    const hero = duelist(duel, "hero");
    const rival = duelist(duel, "rival");
    expect([hero.targetId, rival.targetId]).toStrictEqual(["rival", "hero"]);

    const toHero = {
      x: hero.position.x - rival.position.x,
      z: hero.position.z - rival.position.z,
    };

    const length = Math.hypot(toHero.x, toHero.z);
    expect(rival.facing.x).toBeCloseTo(toHero.x / length);
    expect(rival.facing.z).toBeCloseTo(toHero.z / length);
  });
});

describe("Duel aim", () => {
  it("aims at the Target's chest while the right stick is centred", () => {
    const duel = fight();

    hold(duel, intent({}), 0.1);

    expect(duelist(duel, "hero").aimPoint).toStrictEqual({
      x: 0,
      y: tuning.duelist.chestHeight,
      z: -5,
    });
  });

  it("nudges the aim point right of and above the Target with the right stick", () => {
    const duel = fight();

    hold(duel, intent({ aim: { x: 1, y: 1 } }), 0.1);

    const { aimPoint } = duelist(duel, "hero");
    expect(aimPoint.x).toBeCloseTo(tuning.aim.maxHorizontalOffset);
    expect(aimPoint.y).toBeCloseTo(
      tuning.duelist.chestHeight + tuning.aim.maxVerticalOffset
    );
    expect(aimPoint.z).toBeCloseTo(-5);
  });
});

describe("Stupefy", () => {
  it("casts a Stupefy from the Wand toward the aim point when the Light Spell is pressed", () => {
    const duel = fight();

    const events = run(duel, 1, { hero: castLight });

    expect(ofType(events, "spell-cast")).toMatchObject([
      { spell: { casterId: "hero", kind: "stupefy", strong: false } },
    ]);

    const [spell] = duel.snapshot().spells;
    // Flying down the Arena toward the rival at Stupefy's speed.
    expect(spell?.casterId).toBe("hero");
    expect(spell?.velocity.z).toBeCloseTo(-tuning.stupefy.speed, 0);
  });

  it("costs the Duelist it hits Health and reports a Light Spell hit", () => {
    const duel = fight();

    const events = [...tapLight(duel, "hero"), ...settle(duel)];

    expect(ofType(events, "spell-hit")).toMatchObject([
      {
        damage: tuning.stupefy.damage,
        spell: { casterId: "hero", kind: "stupefy" },
        staggered: false,
        targetId: "rival",
      },
    ]);
    expect(duelist(duel, "rival").health).toBe(
      tuning.duelist.health - tuning.stupefy.damage
    );
    expect(duel.snapshot().spells).toStrictEqual([]);
  });

  it("casts once per press at a fast cadence, keeping a press made while recovering", () => {
    const duel = fight();
    const recovery = secondsToTicks(tuning.stupefy.castInterval);

    // Holding the button casts once, not every tick.
    const held = run(duel, 3, { hero: castLight });
    // A second press right away waits for the recovery, then casts.
    const early = [...run(duel, 1), ...run(duel, 1, { hero: castLight })];
    const waiting = run(duel, recovery - 6);
    const recovered = run(duel, 2);

    expect(ofType(held, "spell-cast")).toHaveLength(1);
    expect(ofType([...early, ...waiting], "spell-cast")).toHaveLength(0);
    expect(ofType(recovered, "spell-cast")).toHaveLength(1);
  });

  it("makes every third consecutive cast strong, Staggering the Duelist it hits", () => {
    const duel = fight();
    const recovery = secondsToTicks(tuning.stupefy.castInterval);
    const casts: DuelEvent[] = [];

    for (let cast = 0; cast < 3; cast += 1) {
      casts.push(...tapLight(duel, "hero"), ...run(duel, recovery));
    }

    const events = [...casts, ...settle(duel)];

    expect(
      ofType(events, "spell-cast").map(({ spell }) => spell.strong)
    ).toStrictEqual([false, false, true]);
    expect(
      ofType(events, "spell-hit").map(({ damage, staggered }) => ({
        damage,
        staggered,
      }))
    ).toStrictEqual([
      { damage: tuning.stupefy.damage, staggered: false },
      { damage: tuning.stupefy.damage, staggered: false },
      { damage: tuning.stupefy.strongDamage, staggered: true },
    ]);
  });

  it("starts a new chain when casts are too far apart", () => {
    const duel = fight();
    const pause = secondsToTicks(tuning.stupefy.chainWindow) + 1;
    const events: DuelEvent[] = [];

    for (let cast = 0; cast < 3; cast += 1) {
      events.push(...tapLight(duel, "hero"), ...run(duel, pause));
    }

    expect(
      ofType(events, "spell-cast").some(({ spell }) => spell.strong)
    ).toBeFalsy();
  });
});

/** The hero lands a three-cast chain on the rival; returns right after the strong hit. */
const staggerRival = (duel: Duel) => {
  const recovery = secondsToTicks(tuning.stupefy.castInterval);

  for (let cast = 0; cast < 3; cast += 1) {
    tapLight(duel, "hero");
    run(duel, recovery);
  }

  for (let tick = 0; tick < secondsToTicks(1.5); tick += 1) {
    if (ofType(run(duel, 1), "spell-hit").some((hit) => hit.staggered)) {
      return;
    }
  }
};

/** The rival trying to strafe and cast at once. */
const rivalTries = intent({ lightSpell: true, move: { x: 1, y: 0 } });

describe("Stagger", () => {
  it("stops a Staggered Duelist from moving or casting", () => {
    const duel = fight();
    staggerRival(duel);
    const before = duelist(duel, "rival").position;

    const whileStaggered = run(duel, secondsToTicks(0.5), {
      rival: rivalTries,
    });

    expect(duelist(duel, "rival").staggerSeconds).toBeGreaterThan(0);
    expect(duelist(duel, "rival").position).toStrictEqual(before);
    expect(ofType(whileStaggered, "spell-cast")).toStrictEqual([]);
  });

  it("lets the Duelist act again once the Stagger wears off", () => {
    const duel = fight();
    staggerRival(duel);
    const before = duelist(duel, "rival").position;
    run(duel, secondsToTicks(tuning.stupefy.staggerSeconds));

    const recovered = [
      ...run(duel, 1, { rival: rivalTries }),
      ...run(duel, 1, { rival: rivalTries }),
    ];

    expect(duelist(duel, "rival").staggerSeconds).toBe(0);
    expect(duelist(duel, "rival").position).not.toStrictEqual(before);
    expect(ofType(recovered, "spell-cast")).toMatchObject([
      { spell: { casterId: "rival" } },
    ]);
  });
});

describe("Spell flight", () => {
  it("flies over an Obstruction standing between the Duelists", () => {
    const duel = fight({
      ...openArena,
      obstructions: [{ center: { x: 0, z: 0 }, radius: 0.6 }],
    });

    const events = [...tapLight(duel, "hero"), ...settle(duel)];

    expect(ofType(events, "spell-stopped")).toStrictEqual([]);
    expect(ofType(events, "spell-hit")).toHaveLength(1);
  });

  it("is stopped by Cover standing between the Duelists", () => {
    const duel = fight({
      ...openArena,
      cover: [{ center: { x: 0, z: 0 }, radius: 0.6 }],
    });

    const events = [...tapLight(duel, "hero"), ...settle(duel)];

    expect(ofType(events, "spell-stopped")).toMatchObject([{ by: "cover" }]);
    expect(ofType(events, "spell-hit")).toStrictEqual([]);
    expect(duelist(duel, "rival").health).toBe(tuning.duelist.health);
  });

  it("is stopped by the Arena bounds when it misses", () => {
    const duel = fight();

    // Aim far right of the rival: the Spell sails past and reaches the wall.
    const events = [
      ...run(duel, 1, {
        hero: intent({ aim: { x: 1, y: 0 }, lightSpell: true }),
      }),
      ...settle(duel),
    ];

    expect(ofType(events, "spell-hit")).toStrictEqual([]);
    expect(ofType(events, "spell-stopped")).toMatchObject([{ by: "bounds" }]);
    expect(duel.snapshot().spells).toStrictEqual([]);
  });

  it("cancels two Spells from opposing Duelists that meet in the air, in a burst", () => {
    const duel = fight();

    const events = [
      ...run(duel, 1, { hero: castLight, rival: castLight }),
      ...settle(duel),
    ];

    const [burst] = ofType(events, "spells-cancelled");
    expect(
      burst?.spells.map((spell) => spell.casterId).toSorted()
    ).toStrictEqual(["hero", "rival"]);
    // They meet halfway down the Arena.
    expect(burst?.position.z).toBeCloseTo(0, 0);
    expect(ofType(events, "spell-hit")).toStrictEqual([]);
    expect(duelist(duel, "hero").health).toBe(tuning.duelist.health);
    expect(duelist(duel, "rival").health).toBe(tuning.duelist.health);
  });
});

/**
 * The hero keeps casting at the rival until the Round has a winner (giving
 * up after far more casts than a full Health bar needs); returns every event.
 */
const knockOutRival = (duel: Duel): DuelEvent[] => {
  const recovery = secondsToTicks(tuning.stupefy.castInterval);
  const events: DuelEvent[] = [];

  for (
    let cast = 0;
    cast < 100 && duel.snapshot().round.phase === "fighting";
    cast += 1
  ) {
    events.push(...tapLight(duel, "hero"), ...run(duel, recovery));
  }

  return events;
};

/** Steps idle ticks until the next Round's intro starts (or 10 s pass). */
const nextRound = (duel: Duel): DuelEvent[] => {
  const events: DuelEvent[] = [];

  for (
    let tick = 0;
    tick < secondsToTicks(10) && duel.snapshot().round.phase !== "intro";
    tick += 1
  ) {
    events.push(...run(duel, 1));
  }

  return events;
};

describe("Rounds and the Duel", () => {
  it("counts down an intro at the start of the Duel during which nobody can act", () => {
    const duel = createOneVsOne();

    expect(duel.snapshot().round).toMatchObject({
      number: 1,
      phase: "intro",
      phaseSecondsLeft: tuning.round.introSeconds,
    });

    const during = run(duel, secondsToTicks(tuning.round.introSeconds) - 1, {
      hero: intent({ lightSpell: true, move: { x: 0, y: 1 } }),
    });

    expect(ofType(during, "spell-cast")).toStrictEqual([]);
    expect(duelist(duel, "hero").position).toStrictEqual({ x: 0, z: 5 });

    expect(run(duel, 1)).toStrictEqual([{ round: 1, type: "round-start" }]);
    expect(duel.snapshot().round.phase).toBe("fighting");
  });

  it("knocks out a Duelist at zero Health, which ends the Round for the other Team", () => {
    const duel = fight();

    const events = knockOutRival(duel);

    expect(duelist(duel, "rival")).toMatchObject({
      health: 0,
      knockedOut: true,
    });
    expect(
      events.filter(
        (event) => event.type === "knockout" || event.type === "round-end"
      )
    ).toMatchObject([
      { duelistId: "rival", type: "knockout" },
      { round: 1, type: "round-end", winner: "gryffindor" },
    ]);
    expect(duel.snapshot().round).toMatchObject({
      phase: "knockout",
      winner: "gryffindor",
    });
    expect(duel.snapshot().score).toStrictEqual({
      gryffindor: 1,
      slytherin: 0,
    });
  });

  it("starts the next Round with Health and positions reset, after the Knockout and the result", () => {
    const duel = fight();
    tapLight(duel, "hero");
    hold(duel, intent({ move: { x: 1, y: 0 } }), 1);
    knockOutRival(duel);

    nextRound(duel);

    expect(duel.snapshot().round).toMatchObject({ number: 2, phase: "intro" });
    expect(duel.snapshot().spells).toStrictEqual([]);
    expect(duelist(duel, "hero")).toMatchObject({
      health: tuning.duelist.health,
      knockedOut: false,
      position: { x: 0, z: 5 },
    });
    expect(duelist(duel, "rival")).toMatchObject({
      health: tuning.duelist.health,
      knockedOut: false,
      position: { x: 0, z: -5 },
    });
    expect(duel.snapshot().score).toStrictEqual({
      gryffindor: 1,
      slytherin: 0,
    });
  });

  it("ends the Duel when a Team wins its second Round", () => {
    const duel = fight();
    knockOutRival(duel);
    nextRound(duel);
    skipIntro(duel);

    const events = knockOutRival(duel);

    expect(ofType(events, "duel-end")).toStrictEqual([
      { type: "duel-end", winner: "gryffindor" },
    ]);
    expect(duel.snapshot().winner).toBe("gryffindor");

    // After the Knockout plays out, the Duel stays over: no third Round.
    run(duel, secondsToTicks(10));
    expect(duel.snapshot().round).toMatchObject({ number: 2, phase: "over" });
  });
});
