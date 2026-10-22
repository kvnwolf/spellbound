import { describe, expect, it } from "vitest";

import { tuning } from "../tuning";
import type { Tuning } from "../tuning";
import { createDuel } from "./duel";
import type { ArenaLayout, Duel, DuelEvent, DuelistState } from "./duel";
import { rightOf } from "./geometry";
import type { Aim } from "./geometry";
import { idleIntent } from "./intent";
import type { Intent } from "./intent";

const openArena: ArenaLayout = {
  bounds: { halfDepth: 10, halfWidth: 10 },
  cover: [],
  obstructions: [],
};

const secondsToTicks = (seconds: number) =>
  Math.round(seconds * tuning.tickRate);

/** The same tuning with Aim Assist switched off: no friction, no bend. */
const withoutAimAssist: Tuning = {
  ...tuning,
  aimAssist: { ...tuning.aimAssist, bendStrength: 0, friction: 1 },
};

/** A 1v1 with the hero facing the rival 10 m away along -z, still in the Round intro. */
const createOneVsOne = (
  arena: ArenaLayout = openArena,
  settings: Tuning = tuning
): Duel =>
  createDuel({
    arena,
    duelists: [
      { id: "hero", spawn: { x: 0, z: 5 }, team: "gryffindor" },
      { id: "rival", spawn: { x: 0, z: -5 }, team: "slytherin" },
    ],
    tuning: settings,
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
const fight = (
  arena: ArenaLayout = openArena,
  settings: Tuning = tuning
): Duel => {
  const duel = createOneVsOne(arena, settings);
  skipIntro(duel);

  return duel;
};

const intent = (overrides: Partial<Intent>): Intent => ({
  ...idleIntent,
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

/** Turns the hero's aim by `by` radians, spread over one second of look input. */
const turn = (duel: Duel, by: Aim) => hold(duel, intent({ look: by }), 1);

/**
 * A fight (without Aim Assist) in which the hero has turned to look straight
 * down the Arena, along -z, so walking forward heads down the centre line.
 * At the start the over-the-shoulder aim looks slightly left of that, to put
 * the crosshair on the rival.
 */
const fightLookingDownTheArena = (arena: ArenaLayout = openArena): Duel => {
  const duel = fight(arena, withoutAimAssist);
  const { yaw } = duel.snapshot().duelists[0]?.aim ?? { yaw: 0 };
  turn(duel, { pitch: 0, yaw: -yaw });

  return duel;
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

describe("Free aim", () => {
  it("starts each Round looking at the nearest opponent, with the crosshair on their chest", () => {
    const duel = fight();

    const hero = duelist(duel, "hero");

    expect(hero.targetId).toBeNull();
    expect(hero.facing.z).toBeCloseTo(-1);
    // The crosshair lands on the front of the rival's body, at chest height.
    expect(hero.aimPoint.x).toBeCloseTo(0, 1);
    expect(hero.aimPoint.y).toBeCloseTo(tuning.duelist.chestHeight, 1);
    expect(hero.aimPoint.z).toBeCloseTo(-5 + tuning.duelist.bodyRadius, 1);
  });

  it("turns the aim at the look rates and always faces where it looks", () => {
    const duel = fight(openArena, withoutAimAssist);
    const before = duelist(duel, "hero");

    turn(duel, { pitch: 0.2, yaw: Math.PI / 2 });

    const hero = duelist(duel, "hero");
    expect(hero.aim.yaw - before.aim.yaw).toBeCloseTo(Math.PI / 2);
    expect(hero.aim.pitch - before.aim.pitch).toBeCloseTo(0.2);
    // A quarter turn right: now facing what was on the right.
    expect(hero.facing.x).toBeCloseTo(rightOf(before.facing).x);
    expect(hero.facing.z).toBeCloseTo(rightOf(before.facing).z);
  });

  it("keeps the pitch within its limits", () => {
    const duel = fight();

    turn(duel, { pitch: 3, yaw: 0 });
    const up = duelist(duel, "hero").aim.pitch;
    turn(duel, { pitch: -6, yaw: 0 });
    const down = duelist(duel, "hero").aim.pitch;

    expect(up).toBeCloseTo(tuning.aim.pitch.max);
    expect(down).toBeCloseTo(tuning.aim.pitch.min);
  });

  it("walks where the camera looks and strafes sideways without turning", () => {
    const duel = fight(openArena, withoutAimAssist);
    turn(duel, { pitch: 0, yaw: Math.PI / 2 });
    const start = duelist(duel, "hero");

    hold(duel, intent({ move: { x: 0, y: 1 } }), 0.5);
    const walked = duelist(duel, "hero");
    hold(duel, intent({ move: { x: 1, y: 0 } }), 0.5);
    const strafed = duelist(duel, "hero");

    const stride = tuning.duelist.walkSpeed * 0.5;
    const right = rightOf(start.facing);
    expect(walked.position.x - start.position.x).toBeCloseTo(
      start.facing.x * stride
    );
    expect(walked.position.z - start.position.z).toBeCloseTo(
      start.facing.z * stride
    );
    expect(strafed.position.x - walked.position.x).toBeCloseTo(
      right.x * stride
    );
    expect(strafed.position.z - walked.position.z).toBeCloseTo(
      right.z * stride
    );
    expect(strafed.facing).toStrictEqual(start.facing);
  });
});

/** Turn speed over the next tick, radians per second, for a look rate of `rate`. */
const turnSpeed = (duel: Duel, rate: number) => {
  const before = duelist(duel, "hero").aim.yaw;
  run(duel, 1, { hero: intent({ look: { pitch: 0, yaw: rate } }) });

  return (duelist(duel, "hero").aim.yaw - before) * tuning.tickRate;
};

const longArena: ArenaLayout = {
  ...openArena,
  bounds: { halfDepth: 30, halfWidth: 10 },
};

/**
 * Casts once, with the rival `distance` m away, with the aim ray passing
 * `beyond` radians outside the edge of the rival's body (seen from the free
 * camera behind the aim pivot, which is what the crosshair shows), and reports
 * whether the Spell hit and the velocity it launched with.
 */
const castsBeyondEdge = (
  distance: number,
  beyond: number,
  settings: Tuning
) => {
  const rivalZ = 5 - distance;

  const duel = createDuel({
    arena: longArena,
    duelists: [
      { id: "hero", spawn: { x: 0, z: 5 }, team: "gryffindor" },
      { id: "rival", spawn: { x: 0, z: rivalZ }, team: "slytherin" },
    ],
    tuning: settings,
  });

  skipIntro(duel);

  // The crosshair starts on the rival's chest. The aim ray, turned right
  // about the pivot, passes the body's axis at `away * sin(turn)`: its edge
  // when that is the body radius, and `beyond` more (as seen from the camera,
  // `back` behind the pivot) at the extra gap below.
  const hero = duelist(duel, "hero");
  const right = rightOf(hero.facing);
  const pivotX = hero.position.x + right.x * tuning.aim.eye.shoulder;
  const pivotZ = hero.position.z + right.z * tuning.aim.eye.shoulder;
  const away = Math.hypot(pivotX, pivotZ - rivalZ);

  const gap =
    tuning.duelist.bodyRadius + (away + tuning.camera.free.distance) * beyond;

  turn(duel, { pitch: 0, yaw: Math.asin(gap / away) });

  const cast = tapLight(duel, "hero");
  const velocity = ofType(cast, "spell-cast")[0]?.spell.velocity;
  const hit = ofType([...cast, ...settle(duel)], "spell-hit").length > 0;

  return { hit, velocity };
};

describe("Aim Assist", () => {
  it("eases the turn speed while the crosshair is over an opponent", () => {
    const duel = fight();

    const overRival = turnSpeed(duel, 0.5);
    turn(duel, { pitch: 0, yaw: 1 });
    const clear = turnSpeed(duel, 0.5);

    expect(overRival).toBeLessThan(0.4);
    expect(overRival).toBeGreaterThan(0.2);
    expect(clear).toBeCloseTo(0.5);
  });

  describe.each([14, 22])("with the rival %i m away", (distance) => {
    const bendOnly: Tuning = {
      ...tuning,
      aimAssist: { ...tuning.aimAssist, friction: 1 },
    };

    it("bends a cast whose aim passes just within the angle of the body, and it hits", () => {
      const plain = castsBeyondEdge(distance, 0.03, withoutAimAssist);
      const assisted = castsBeyondEdge(distance, 0.03, bendOnly);

      expect(assisted.hit).toBeTruthy();
      expect(assisted.velocity).not.toStrictEqual(plain.velocity);
    });

    it("does not bend a cast whose aim passes outside the angle, and it misses", () => {
      const plain = castsBeyondEdge(distance, 0.05, withoutAimAssist);
      const assisted = castsBeyondEdge(distance, 0.05, bendOnly);

      expect(assisted.hit).toBeFalsy();
      expect(assisted.velocity).toStrictEqual(plain.velocity);
    });
  });

  it("flies straight after launch: the bend is no homing", () => {
    const duel = fight();
    tapLight(duel, "hero");
    const [launched] = duel.snapshot().spells;

    run(duel, 3, { rival: intent({ move: { x: 1, y: 0 } }) });

    expect(duel.snapshot().spells[0]?.velocity).toStrictEqual(
      launched?.velocity
    );
  });
});

describe("Duel collision", () => {
  it("stops the Duelist at the Arena bounds", () => {
    const duel = fightLookingDownTheArena();

    hold(duel, intent({ move: { x: 0, y: -1 } }), 3);

    const { position } = duelist(duel, "hero");
    expect(position.x).toBeCloseTo(0);
    expect(position.z).toBe(10 - tuning.duelist.bodyRadius);
  });

  it("stops the Duelist against a column of Cover standing in the way", () => {
    const duel = fightLookingDownTheArena({
      ...openArena,
      cover: [{ center: { x: 0, z: 0 }, radius: 1 }],
    });

    hold(duel, intent({ move: { x: 0, y: 1 } }), 2);

    const { position } = duelist(duel, "hero");
    expect(position.x).toBeCloseTo(0);
    expect(position.z).toBeCloseTo(1 + tuning.duelist.bodyRadius);
  });

  it("slides the Duelist around a column it walks into off-centre", () => {
    const duel = fightLookingDownTheArena({
      ...openArena,
      cover: [{ center: { x: 0.3, z: 0 }, radius: 1 }],
    });

    hold(duel, intent({ move: { x: 0, y: 1 } }), 3);

    expect(duelist(duel, "hero").position.z).toBeLessThan(0);
  });

  it("stops the Duelist against an Obstruction standing in the way", () => {
    const duel = fightLookingDownTheArena({
      ...openArena,
      obstructions: [{ center: { x: 0, z: 0 }, radius: 1 }],
    });

    hold(duel, intent({ move: { x: 0, y: 1 } }), 2);

    const { position } = duelist(duel, "hero");
    expect(position.x).toBeCloseTo(0);
    expect(position.z).toBeCloseTo(1 + tuning.duelist.bodyRadius);
  });

  it("slides the Duelist around an Obstruction it walks into off-centre", () => {
    const duel = fightLookingDownTheArena({
      ...openArena,
      obstructions: [{ center: { x: 0.3, z: 0 }, radius: 1 }],
    });

    hold(duel, intent({ move: { x: 0, y: 1 } }), 3);

    expect(duelist(duel, "hero").position.z).toBeLessThan(0);
  });

  it("does not let a Duelist walk through another Duelist", () => {
    const duel = fightLookingDownTheArena();

    hold(duel, intent({ move: { x: 0, y: 1 } }), 4);

    const hero = duelist(duel, "hero");
    const rival = duelist(duel, "rival");
    expect(rival.position).toStrictEqual({ x: 0, z: -5 });
    expect(hero.position.z - rival.position.z).toBeCloseTo(
      2 * tuning.duelist.bodyRadius
    );
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

  it("flies to the point under the crosshair", () => {
    const duel = fight(openArena, withoutAimAssist);
    // Look down at the floor a few metres ahead.
    turn(duel, { pitch: -0.35, yaw: 0 });
    const { aimPoint } = duelist(duel, "hero");

    const events = [...tapLight(duel, "hero"), ...settle(duel)];

    const [stopped] = ofType(events, "spell-stopped");
    expect(stopped?.by).toBe("floor");
    expect(aimPoint.y).toBeCloseTo(0);
    expect(stopped?.position.x).toBeCloseTo(aimPoint.x, 1);
    expect(stopped?.position.z).toBeCloseTo(aimPoint.z, 1);
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
    turn(duel, { pitch: 0, yaw: 0.6 });
    const events = [...tapLight(duel, "hero"), ...settle(duel)];

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

const pressLockOn = intent({ lockOn: true });

/** The hero presses R3 for one tick; returns that tick's events. */
const toggleLock = (duel: Duel): DuelEvent[] =>
  run(duel, 1, { hero: pressLockOn });

/**
 * The hero against two rivals on the same Team, 8 m apart across the far
 * end. The hero starts looking at the left one.
 */
const fightTwo = (settings: Tuning = tuning): Duel => {
  const duel = createDuel({
    arena: openArena,
    duelists: [
      { id: "hero", spawn: { x: 0, z: 5 }, team: "gryffindor" },
      { id: "left", spawn: { x: -4, z: -5 }, team: "slytherin" },
      { id: "right", spawn: { x: 4, z: -5 }, team: "slytherin" },
    ],
    tuning: settings,
  });

  skipIntro(duel);

  return duel;
};

/** The rival side-stepping: to its own left, which is the hero's right (+x). */
const rivalStrafes = intent({ move: { x: -1, y: 0 } });

describe("Lock-on", () => {
  it("locks on to the opponent with R3 and faces them", () => {
    const duel = fight();

    const events = toggleLock(duel);

    expect(ofType(events, "lock-on")).toStrictEqual([
      { duelistId: "hero", targetId: "rival", type: "lock-on" },
    ]);
    expect(duelist(duel, "hero").targetId).toBe("rival");
    expect(duelist(duel, "hero").facing.x).toBeCloseTo(0);
    expect(duelist(duel, "hero").facing.z).toBeCloseTo(-1);
  });

  it("locks on to the opponent nearest the crosshair", () => {
    const duel = fightTwo(withoutAimAssist);
    // From the left rival round to the right one.
    turn(duel, { pitch: 0, yaw: 0.75 });

    toggleLock(duel);

    expect(duelist(duel, "hero").targetId).toBe("right");
  });

  it("locks on through an Obstruction, which Spells fly over", () => {
    const duel = fight({
      ...openArena,
      obstructions: [{ center: { x: 0, z: 0 }, radius: 1 }],
    });

    toggleLock(duel);

    expect(duelist(duel, "hero").targetId).toBe("rival");
  });

  it("does not lock on to an opponent behind Cover, and recentres the camera instead", () => {
    const duel = fight(
      { ...openArena, cover: [{ center: { x: 0, z: 0 }, radius: 0.6 }] },
      withoutAimAssist
    );

    turn(duel, { pitch: -0.4, yaw: 0 });

    const events = [
      ...toggleLock(duel),
      ...run(duel, secondsToTicks(tuning.lockOn.recentreSeconds)),
    ];

    expect(ofType(events, "lock-on")).toStrictEqual([]);
    expect(duelist(duel, "hero").targetId).toBeNull();
    expect(duelist(duel, "hero").aim.pitch).toBeCloseTo(tuning.aim.pitch.rest);
  });

  it("does not lock on to an opponent out of range", () => {
    const duel = createDuel({
      arena: { ...openArena, bounds: { halfDepth: 40, halfWidth: 10 } },
      duelists: [
        { id: "hero", spawn: { x: 0, z: 20 }, team: "gryffindor" },
        { id: "rival", spawn: { x: 0, z: -20 }, team: "slytherin" },
      ],
      tuning,
    });

    skipIntro(duel);

    toggleLock(duel);

    expect(duelist(duel, "hero").targetId).toBeNull();
  });

  it("strafes round the Target at a constant distance, still facing it", () => {
    const duel = fight();
    toggleLock(duel);

    hold(duel, intent({ move: { x: 1, y: 0 } }), 1);

    const { facing, position } = duelist(duel, "hero");
    const toRival = { x: 0 - position.x, z: -5 - position.z };
    const distance = Math.hypot(toRival.x, toRival.z);
    expect(position.x).toBeGreaterThan(3);
    expect(distance).toBeCloseTo(10);
    expect(facing.x).toBeCloseTo(toRival.x / distance);
    expect(facing.z).toBeCloseTo(toRival.z / distance);
  });

  it("only nudges the framing with the right stick, springing back once it rests", () => {
    const duel = fight();
    toggleLock(duel);

    hold(duel, intent({ look: { pitch: 8, yaw: 8 } }), 1);
    const nudged = duelist(duel, "hero");
    // A released stick eases out, so a trace of turn rate lingers.
    hold(duel, intent({ look: { pitch: 0.01, yaw: 0.01 } }), 1);
    const rested = duelist(duel, "hero");

    expect(nudged.targetId).toBe("rival");
    expect(nudged.facing.z).toBeCloseTo(-1);
    expect(nudged.lockNudge.yaw).toBeCloseTo(tuning.lockOn.nudge.maxYaw);
    expect(nudged.lockNudge.pitch).toBeCloseTo(tuning.lockOn.nudge.maxPitch);
    // Back to rest on both axes.
    expect(
      Math.hypot(rested.lockNudge.yaw, rested.lockNudge.pitch)
    ).toBeCloseTo(0);
  });

  it("switches to the next opponent left or right on a flick", () => {
    const duel = fightTwo();
    toggleLock(duel);
    const locked = duelist(duel, "hero").targetId;

    const switched = run(duel, 1, { hero: intent({ switchTarget: 1 }) });
    const toRight = duelist(duel, "hero").targetId;
    run(duel, 1, { hero: intent({ switchTarget: 1 }) });
    const nothingFurther = duelist(duel, "hero").targetId;
    run(duel, 1, { hero: intent({ switchTarget: -1 }) });
    const back = duelist(duel, "hero").targetId;

    expect([locked, toRight, nothingFurther, back]).toStrictEqual([
      "left",
      "right",
      "right",
      "left",
    ]);
    expect(ofType(switched, "lock-on")).toStrictEqual([
      { duelistId: "hero", targetId: "right", type: "lock-on" },
    ]);
  });

  it("releases the lock on R3 again, keeping the aim where it was", () => {
    const duel = fight();
    toggleLock(duel);
    hold(duel, intent({ move: { x: 1, y: 0 } }), 0.5);
    const locked = duelist(duel, "hero");

    const events = toggleLock(duel);

    expect(ofType(events, "lock-off")).toStrictEqual([
      {
        duelistId: "hero",
        reason: "toggle",
        targetId: "rival",
        type: "lock-off",
      },
    ]);
    expect(duelist(duel, "hero").targetId).toBeNull();
    expect(duelist(duel, "hero").aim).toStrictEqual(locked.aim);
  });

  it("breaks once the Target has stayed out of sight behind Cover for a moment", () => {
    const duel = fight({
      ...openArena,
      cover: [{ center: { x: 2, z: 0 }, radius: 1 }],
    });

    toggleLock(duel);

    // The rival steps out of sight behind the column...
    const stepping = run(duel, secondsToTicks(0.9), { rival: rivalStrafes });
    const hidden = duelist(duel, "hero");
    // ...and stays there.
    const waiting = run(duel, secondsToTicks(tuning.lockOn.sightGraceSeconds));

    expect(ofType(stepping, "lock-off")).toStrictEqual([]);
    expect(hidden.targetId).toBe("rival");
    expect(hidden.targetHiddenSeconds).toBeGreaterThan(0);
    expect(ofType(waiting, "lock-off")).toMatchObject([
      { duelistId: "hero", reason: "sight", targetId: "rival" },
    ]);
    expect(duelist(duel, "hero").targetId).toBeNull();
  });

  it("breaks when the Target is Knocked Out", () => {
    const duel = fight();
    toggleLock(duel);

    const events = knockOutRival(duel);

    expect(ofType(events, "lock-off")).toMatchObject([
      { duelistId: "hero", reason: "knockout", targetId: "rival" },
    ]);
  });

  it("casts at the Target's chest even with the framing nudged", () => {
    const duel = fight();
    toggleLock(duel);
    hold(duel, intent({ look: { pitch: 0, yaw: 4 } }), 0.3);

    const cast = run(duel, 1, {
      hero: intent({ lightSpell: true, look: { pitch: 0, yaw: 4 } }),
    });

    const { lockNudge } = duelist(duel, "hero");
    const events = [...cast, ...settle(duel)];

    expect(lockNudge.yaw).toBeGreaterThan(0.1);
    expect(ofType(events, "spell-hit")).toMatchObject([{ targetId: "rival" }]);
  });

  it("homes in on the Target weakly, turning no faster than its turn rate", () => {
    const duel = fight();
    toggleLock(duel);
    run(duel, 1, { hero: castLight });
    const turns: number[] = [];

    for (let tick = 0; tick < 8; tick += 1) {
      const before = duel.snapshot().spells[0]?.velocity;
      run(duel, 1, { rival: rivalStrafes });
      const after = duel.snapshot().spells[0]?.velocity;

      if (before && after) {
        const dot =
          (before.x * after.x + before.y * after.y + before.z * after.z) /
          (Math.hypot(before.x, before.y, before.z) *
            Math.hypot(after.x, after.y, after.z));

        turns.push(Math.acos(Math.min(dot, 1)));
      }
    }

    const mostPerTick = tuning.lockOn.homing.turnRate / tuning.tickRate;
    expect(turns.length).toBeGreaterThan(4);
    expect(Math.max(...turns)).toBeGreaterThan(0);
    expect(Math.max(...turns)).toBeLessThanOrEqual(mostPerTick + 1e-9);
  });

  it("can be escaped by a sideways strafe at mid range", () => {
    const duel = fight();
    toggleLock(duel);

    const events = [
      ...run(duel, 1, { hero: castLight, rival: rivalStrafes }),
      ...run(duel, secondsToTicks(1.5), { rival: rivalStrafes }),
    ];

    expect(ofType(events, "spell-cast")).toHaveLength(1);
    expect(ofType(events, "spell-hit")).toStrictEqual([]);
  });

  it("is let go at the start of every Round", () => {
    const duel = fight();
    toggleLock(duel);
    knockOutRival(duel);

    nextRound(duel);

    expect(duelist(duel, "hero").targetId).toBeNull();
  });
});

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
    hold(duel, intent({ move: { x: -1, y: 0 } }), 1);
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
