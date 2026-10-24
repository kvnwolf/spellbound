/**
 * Defence through the Duel seam: Stamina, the Dodge and the Perfect Dodge,
 * the Shield and its Parry, the jump and the sprint. Same seam as
 * `duel.test.ts`: drive `createDuel` with Intents, assert snapshots and events.
 */
import { describe, expect, it } from "vitest";

import { tuning } from "../tuning";
import type { Tuning } from "../tuning";
import { createDuel } from "./duel";
import type { ArenaLayout, Duel, DuelEvent, DuelistState } from "./duel";
import { idleIntent } from "./intent";
import type { Intent } from "./intent";

const openArena: ArenaLayout = {
  bounds: { halfDepth: 10, halfWidth: 10 },
  cover: [],
  obstructions: [],
};

const { dodge, jump, shield, sprint, stamina } = tuning.defence;

const secondsToTicks = (seconds: number) =>
  Math.round(seconds * tuning.tickRate);

const intent = (overrides: Partial<Intent>): Intent => ({
  ...idleIntent,
  ...overrides,
});

/** A 1v1 with the hero facing the rival 10 m away along -z, past the Round intro. */
const fight = (settings: Tuning = tuning): Duel => {
  const duel = createDuel({
    arena: openArena,
    duelists: [
      { id: "hero", spawn: { x: 0, z: 5 }, team: "gryffindor" },
      { id: "rival", spawn: { x: 0, z: -5 }, team: "slytherin" },
    ],
    tuning: settings,
  });

  while (duel.snapshot().round.phase === "intro") {
    duel.step({});
  }

  return duel;
};

/** Steps `ticks` ticks with the given Intents and returns every event emitted. */
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

/** Holds `held` as the hero for one tick, then lets go for a tick: a press. */
const tap = (duel: Duel, held: Partial<Intent>, who = "hero") => [
  ...run(duel, 1, { [who]: intent(held) }),
  ...run(duel, 1),
];

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

describe("Stamina", () => {
  it("starts every Round full", () => {
    const duel = fight();

    expect(duelist(duel, "hero").stamina).toBe(stamina.max);
  });

  it("regenerates once it has not been spent for a moment", () => {
    const duel = fight();
    tap(duel, { jump: true });
    const spent = duelist(duel, "hero").stamina;

    // Still waiting out the delay: nothing back yet.
    run(duel, secondsToTicks(stamina.regenDelay) - 4);
    expect(duelist(duel, "hero").stamina).toBe(spent);

    run(duel, secondsToTicks(stamina.regenDelay));
    expect(duelist(duel, "hero").stamina).toBeGreaterThan(spent);

    run(duel, secondsToTicks(2));
    expect(duelist(duel, "hero").stamina).toBe(stamina.max);
  });
});

describe("Jump", () => {
  it("jumps on ✕, spending Stamina, and falls back to land", () => {
    const duel = fight();

    const events = tap(duel, { jump: true });
    run(duel, secondsToTicks(0.3));
    const rising = duelist(duel, "hero");
    const landing = run(duel, secondsToTicks(1));

    expect(ofType(events, "jump")).toStrictEqual([
      { duelistId: "hero", type: "jump" },
    ]);
    expect(rising.elevation).toBeGreaterThan(1);
    expect(rising.stamina).toBe(stamina.max - jump.cost);
    expect(ofType(landing, "land")).toStrictEqual([
      { duelistId: "hero", type: "land" },
    ]);
    expect(duelist(duel, "hero").elevation).toBe(0);
  });

  it("is snappy, not floaty: back on the floor 2 × speed / gravity after the take-off, in well under a second", () => {
    const duel = fight();
    const airSeconds = (2 * jump.speed) / jump.gravity;
    const airTicks = secondsToTicks(airSeconds);

    const flight = [
      ...run(duel, 1, { hero: intent({ jump: true }) }),
      ...run(duel, airTicks - 2),
    ];

    const landing = run(duel, 4);

    expect(airSeconds).toBeLessThan(0.65);
    expect(ofType(flight, "land")).toStrictEqual([]);
    expect(ofType(landing, "land")).toStrictEqual([
      { duelistId: "hero", type: "land" },
    ]);
  });

  it("cannot jump again in the air", () => {
    const duel = fight();
    tap(duel, { jump: true });
    run(duel, secondsToTicks(0.2));

    const again = tap(duel, { jump: true });

    expect(ofType(again, "jump")).toStrictEqual([]);
    expect(duelist(duel, "hero").stamina).toBe(stamina.max - jump.cost);
  });

  it("lets a bolt pass under the Duelist at the top of the jump", () => {
    const duel = fight();

    // Jumping as the rival casts: the bolt, aimed at the hero's chest as they
    // stood, arrives while their feet are near the top of the jump.
    const events = [
      ...run(duel, 1, {
        hero: intent({ jump: true }),
        rival: intent({ lightSpell: true }),
      }),
      ...run(duel, secondsToTicks(1.5)),
    ];

    expect(ofType(events, "spell-hit")).toStrictEqual([]);
    expect(ofType(events, "spell-stopped")).toMatchObject([{ by: "bounds" }]);
    expect(duelist(duel, "hero").health).toBe(tuning.duelist.health);
  });

  it("can cast the Light Spell in the air", () => {
    const duel = fight();
    tap(duel, { jump: true });
    run(duel, secondsToTicks(0.2));

    const events = tap(duel, { lightSpell: true });

    expect(duelist(duel, "hero").elevation).toBeGreaterThan(0);
    expect(ofType(events, "spell-cast")).toMatchObject([
      { spell: { casterId: "hero", kind: "stupefy" } },
    ]);
  });
});

describe("Sprint", () => {
  it("runs faster than walking while R1 is held, draining Stamina", () => {
    const walked = fight();
    const sprinted = fight();
    const forward = { x: 0, y: 1 };

    run(walked, secondsToTicks(0.5), { hero: intent({ move: forward }) });
    run(sprinted, secondsToTicks(0.5), {
      hero: intent({ move: forward, sprint: true }),
    });

    const walkedBy = 5 - duelist(walked, "hero").position.z;
    const sprintedBy = 5 - duelist(sprinted, "hero").position.z;

    expect(sprintedBy / walkedBy).toBeCloseTo(sprint.speedScale, 1);
    expect(duelist(sprinted, "hero").sprinting).toBeTruthy();
    expect(duelist(sprinted, "hero").stamina).toBeCloseTo(
      stamina.max - sprint.drain * 0.5,
      0
    );
  });

  it("costs nothing while standing still", () => {
    const duel = fight();

    run(duel, secondsToTicks(0.5), { hero: intent({ sprint: true }) });

    expect(duelist(duel, "hero").stamina).toBe(stamina.max);
    expect(duelist(duel, "hero").sprinting).toBeFalsy();
  });

  it("stops when Stamina runs out, until R1 is pressed again", () => {
    const duel = fight();
    const running = intent({ move: { x: 0, y: -1 }, sprint: true });

    // Sprint backwards (away from the rival) until Stamina is gone.
    run(duel, secondsToTicks(stamina.max / sprint.drain + 0.2), {
      hero: running,
    });

    expect(duelist(duel, "hero").stamina).toBe(0);
    expect(duelist(duel, "hero").sprinting).toBeFalsy();

    // Still holding R1 once Stamina is back: walking, not running.
    run(duel, secondsToTicks(1.5), { hero: running });
    expect(duelist(duel, "hero").sprinting).toBeFalsy();
  });
});

/** The rival taps the Light Spell: a bolt flies down the Arena at the hero. */
const rivalCasts = (duel: Duel) =>
  run(duel, 1, { rival: intent({ lightSpell: true }) });

/**
 * Steps idle ticks until the rival's bolt is due to reach the hero's body
 * (standing where they are) within `seconds`.
 */
const untilBoltWithin = (duel: Duel, seconds: number): DuelEvent[] => {
  const events: DuelEvent[] = [];
  const reach = tuning.duelist.bodyRadius + tuning.stupefy.radius;

  const due = () => {
    const [bolt] = duel.snapshot().spells;
    const front = duelist(duel, "hero").position.z - reach;

    return bolt ? (front - bolt.position.z) / bolt.velocity.z : 0;
  };

  while (due() > seconds) {
    events.push(...run(duel, 1));
  }

  return events;
};

/** Lets every Spell in flight land. */
const settle = (duel: Duel): DuelEvent[] => run(duel, secondsToTicks(1.5));

describe("Dodge", () => {
  it("dashes a short way on ○ in the direction held, spending Stamina", () => {
    const duel = fight();
    const before = duelist(duel, "hero");

    const events = tap(duel, { dodge: true, move: { x: 1, y: 0 } });
    run(duel, secondsToTicks(dodge.seconds));
    const after = duelist(duel, "hero");

    expect(ofType(events, "dodge")).toMatchObject([{ duelistId: "hero" }]);

    // Sideways to where the hero looks, the full Dodge distance.
    const moved = {
      x: after.position.x - before.position.x,
      z: after.position.z - before.position.z,
    };

    expect(Math.hypot(moved.x, moved.z)).toBeCloseTo(dodge.distance, 1);
    expect(moved.x * before.facing.x + moved.z * before.facing.z).toBeCloseTo(
      0,
      1
    );
    expect(after.stamina).toBe(stamina.max - dodge.cost);
    expect(after.dodgeSeconds).toBe(0);
  });

  it("dashes straight back with no direction held", () => {
    const duel = fight();
    tap(duel, { dodge: true });
    run(duel, secondsToTicks(dodge.seconds));

    // The hero looks down -z at the rival, so back is +z.
    expect(duelist(duel, "hero").position.z).toBeCloseTo(5 + dodge.distance, 0);
  });

  it("dashes relative to the line to the Target while Locked On", () => {
    const duel = fight();
    tap(duel, { lockOn: true });
    expect(duelist(duel, "hero").targetId).toBe("rival");

    tap(duel, { dodge: true, move: { x: 1, y: 0 } });
    run(duel, secondsToTicks(dodge.seconds));

    // Square to the line between the two, which runs down -z.
    const { position } = duelist(duel, "hero");
    expect(position.x).toBeCloseTo(dodge.distance, 1);
    expect(position.z).toBeCloseTo(5, 1);
  });

  it("cannot be hit while Dodging: the Spell flies straight through", () => {
    const duel = fight();
    rivalCasts(duel);
    untilBoltWithin(duel, 0.12);

    // Dashing toward the bolt, right through it.
    const events = [
      ...tap(duel, { dodge: true, move: { x: 0, y: 1 } }),
      ...settle(duel),
    ];

    expect(ofType(events, "spell-hit")).toStrictEqual([]);
    expect(ofType(events, "spell-stopped")).toMatchObject([{ by: "bounds" }]);
    expect(duelist(duel, "hero").health).toBe(tuning.duelist.health);
  });

  it("is a Perfect Dodge when started just before a Spell would have hit", () => {
    const duel = fight();
    rivalCasts(duel);
    untilBoltWithin(duel, dodge.perfectWindow * 0.6);

    const events = [
      ...tap(duel, { dodge: true, move: { x: 1, y: 0 } }),
      ...settle(duel),
    ];

    expect(ofType(events, "perfect-dodge")).toMatchObject([
      { duelistId: "hero", spell: { casterId: "rival" } },
    ]);
    expect(ofType(events, "spell-hit")).toStrictEqual([]);
  });

  it("is no Perfect Dodge when started early, or with nothing incoming", () => {
    const early = fight();
    rivalCasts(early);
    untilBoltWithin(early, dodge.perfectWindow * 1.6);
    const quiet = fight();

    const events = [
      ...tap(early, { dodge: true, move: { x: 1, y: 0 } }),
      ...tap(quiet, { dodge: true, move: { x: 1, y: 0 } }),
    ];

    expect(ofType(events, "dodge")).toHaveLength(2);
    expect(ofType(events, "perfect-dodge")).toStrictEqual([]);
  });
});

describe("Shield", () => {
  const raise = intent({ shield: true });

  it("blocks a Spell reaching the front while L1 is held, draining Stamina", () => {
    const duel = fight();
    run(duel, 1, { hero: raise });
    rivalCasts(duel);

    const events = run(duel, secondsToTicks(1), { hero: raise });

    expect(ofType(events, "spell-blocked")).toMatchObject([
      { duelistId: "hero", spell: { casterId: "rival" } },
    ]);
    expect(
      ofType(events, "spell-hit").length + ofType(events, "parry").length
    ).toBe(0);
    expect(duel.snapshot().spells).toStrictEqual([]);
    expect(duelist(duel, "hero")).toMatchObject({
      health: tuning.duelist.health,
      shielding: true,
    });
    // Up for 1 s and a tick; the tick the rival cast on, the Shield was down.
    expect(duelist(duel, "hero").stamina).toBeCloseTo(
      stamina.max - shield.drain * (1 + 1 / tuning.tickRate),
      0
    );
  });

  it("lets a Spell from behind land", () => {
    const duel = fight();
    // Turn round to look away from the rival, then raise the Shield, which
    // turns the hero to the aim: their back to the rival.
    run(duel, secondsToTicks(1), {
      hero: intent({ look: { pitch: 0, yaw: Math.PI } }),
    });
    run(duel, secondsToTicks(tuning.facing.aimTurnSeconds), { hero: raise });
    expect(duelist(duel, "hero").facing.z).toBeGreaterThan(0.9);
    rivalCasts(duel);

    const events = run(duel, secondsToTicks(1), { hero: raise });

    expect(ofType(events, "spell-blocked")).toStrictEqual([]);
    expect(ofType(events, "spell-hit")).toMatchObject([{ targetId: "hero" }]);
  });

  it("drops once Stamina runs out, until L1 is pressed again", () => {
    const duel = fight();

    run(duel, secondsToTicks(stamina.max / shield.drain + 0.1), {
      hero: raise,
    });
    expect(duelist(duel, "hero").stamina).toBe(0);
    expect(duelist(duel, "hero").shielding).toBeFalsy();

    // Stamina comes back while L1 stays held, but the Shield stays down.
    run(duel, secondsToTicks(1.5), { hero: raise });
    expect(duelist(duel, "hero").stamina).toBeGreaterThan(0);
    expect(duelist(duel, "hero").shielding).toBeFalsy();
  });

  it("cannot cast from behind the Shield", () => {
    const duel = fight();
    run(duel, 1, { hero: raise });

    const events = run(duel, 2, {
      hero: intent({ lightSpell: true, shield: true }),
    });

    expect(ofType(events, "spell-cast")).toStrictEqual([]);
  });
});

describe("Parry", () => {
  it("reflects a Spell back at its caster when the Shield goes up just before it lands", () => {
    const duel = fight();
    rivalCasts(duel);
    untilBoltWithin(duel, shield.parryWindow / 2);

    const events = [
      ...run(duel, secondsToTicks(0.3), { hero: intent({ shield: true }) }),
      ...settle(duel),
    ];

    const [parry] = ofType(events, "parry");
    expect(parry).toMatchObject({
      duelistId: "hero",
      reflected: { casterId: "hero", kind: "stupefy", team: "gryffindor" },
      spell: { casterId: "rival" },
    });
    // Flying back up the Arena, toward the rival.
    expect(parry?.reflected.velocity.z).toBeLessThan(0);
    expect(ofType(events, "spell-blocked")).toStrictEqual([]);
    expect(ofType(events, "spell-hit")).toMatchObject([
      { spell: { casterId: "hero" }, targetId: "rival" },
    ]);
    expect(
      duel.snapshot().duelists.map(({ health, id }) => ({ health, id }))
    ).toStrictEqual([
      { health: tuning.duelist.health, id: "hero" },
      { health: tuning.duelist.health - tuning.stupefy.damage, id: "rival" },
    ]);
  });

  it("only blocks when the Shield went up before the Parry window", () => {
    const duel = fight();
    rivalCasts(duel);
    untilBoltWithin(duel, shield.parryWindow * 1.6);

    const events = [
      ...run(duel, secondsToTicks(0.4), { hero: intent({ shield: true }) }),
      ...settle(duel),
    ];

    expect(ofType(events, "parry")).toStrictEqual([]);
    expect(ofType(events, "spell-blocked")).toHaveLength(1);
  });

  it("is too late once the Spell has landed", () => {
    const duel = fight();
    rivalCasts(duel);

    const events = [
      ...untilBoltWithin(duel, 0),
      ...run(duel, 2),
      ...run(duel, secondsToTicks(0.3), { hero: intent({ shield: true }) }),
    ];

    expect(ofType(events, "parry")).toStrictEqual([]);
    expect(ofType(events, "spell-hit")).toMatchObject([{ targetId: "hero" }]);
  });
});

describe("Running out of Stamina", () => {
  it("refuses a Dodge, a jump, the Shield or a sprint with no Stamina left", () => {
    const duel = fight();

    // Back-to-back Dodges, quicker than Stamina regenerates, spend it all.
    for (let each = 0; each < stamina.max / dodge.cost; each += 1) {
      tap(duel, { dodge: true, move: { x: each % 2 === 0 ? 1 : -1, y: 0 } });
      run(duel, secondsToTicks(dodge.seconds));
    }

    expect(duelist(duel, "hero").stamina).toBe(0);

    const events = [
      ...tap(duel, { dodge: true }),
      ...tap(duel, { jump: true }),
      ...tap(duel, { shield: true }),
      ...tap(duel, { move: { x: 0, y: 1 }, sprint: true }),
    ];

    expect(ofType(events, "dodge")).toStrictEqual([]);
    expect(ofType(events, "jump")).toStrictEqual([]);
    expect(
      ofType(events, "stamina-short").map(({ action }) => action)
    ).toStrictEqual(["dodge", "jump", "shield", "sprint"]);
    expect(duelist(duel, "hero")).toMatchObject({
      dodgeSeconds: 0,
      elevation: 0,
      shielding: false,
      sprinting: false,
    });
  });

  it("refuses a Dodge that costs more than what is left", () => {
    const duel = fight();
    // A long Shield leaves a little Stamina, but less than a Dodge costs.
    run(duel, secondsToTicks((stamina.max - dodge.cost + 5) / shield.drain), {
      hero: intent({ shield: true }),
    });
    const left = duelist(duel, "hero").stamina;
    expect(left).toBeLessThan(dodge.cost);
    expect(left).toBeGreaterThan(0);

    const events = tap(duel, { dodge: true });

    expect(ofType(events, "stamina-short")).toMatchObject([
      { action: "dodge" },
    ]);
    expect(ofType(events, "dodge")).toStrictEqual([]);
  });
});

/** Holds the Shield long enough to leave `left` Stamina (a little more, the last tick's drain aside). */
const drainTo = (duel: Duel, left: number) =>
  run(duel, secondsToTicks((stamina.max - left) / shield.drain), {
    hero: intent({ shield: true }),
  });

describe("Casting costs Stamina", () => {
  const { confringo, stupefy } = tuning;

  it("spends Stamina on a Stupefy and on a Confringo, which then waits to regenerate", () => {
    const duel = fight();

    tap(duel, { lightSpell: true });
    const afterStupefy = duelist(duel, "hero").stamina;
    run(duel, secondsToTicks(0.5));
    const stillWaiting = duelist(duel, "hero").stamina;
    run(duel, secondsToTicks(4));
    run(duel, secondsToTicks(0.3), { hero: intent({ heavySpell: true }) });
    const charging = duelist(duel, "hero").stamina;
    run(duel, 1);
    const afterConfringo = duelist(duel, "hero").stamina;

    expect(afterStupefy).toBe(stamina.max - stupefy.staminaCost);
    expect(stillWaiting).toBe(afterStupefy);
    // A Charge costs nothing while it builds: the cast pays on release.
    expect(charging).toBe(stamina.max);
    expect(afterConfringo).toBe(stamina.max - confringo.staminaCost);
  });

  it("refuses a Stupefy without enough Stamina left, like a Dodge", () => {
    const duel = fight();
    drainTo(duel, stupefy.staminaCost - 3);
    const left = duelist(duel, "hero").stamina;

    const events = tap(duel, { lightSpell: true });

    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThan(stupefy.staminaCost);
    expect(ofType(events, "spell-cast")).toStrictEqual([]);
    expect(ofType(events, "stamina-short")).toMatchObject([
      { action: "stupefy", duelistId: "hero" },
    ]);
    expect(duelist(duel, "hero").stamina).toBe(left);
  });

  it("refuses to start a Charge without enough Stamina for the Confringo", () => {
    const duel = fight();
    drainTo(duel, confringo.staminaCost - 5);

    const events = [
      ...run(duel, secondsToTicks(0.3), { hero: intent({ heavySpell: true }) }),
      ...run(duel, secondsToTicks(0.3)),
    ];

    expect(ofType(events, "spell-cast")).toStrictEqual([]);
    expect(ofType(events, "stamina-short")).toMatchObject([
      { action: "confringo", duelistId: "hero" },
    ]);
  });

  it("empties the pool when Stupefy is mashed, leaving no Dodge", () => {
    // A rival sturdy enough to take every cast without a Knockout.
    const duel = fight({
      ...tuning,
      duelist: { ...tuning.duelist, health: 100_000 },
    });

    const mashed: DuelEvent[] = [];

    for (let press = 0; press < secondsToTicks(5) / 2; press += 1) {
      mashed.push(...tap(duel, { lightSpell: true }));
    }

    const left = duelist(duel, "hero").stamina;
    const events = tap(duel, { dodge: true });

    // Far fewer casts than presses: the pool runs dry within a few seconds.
    expect(ofType(mashed, "spell-cast").length).toBeLessThan(
      stamina.max / stupefy.staminaCost + 4
    );
    expect(ofType(mashed, "stamina-short").length).toBeGreaterThan(0);
    expect(left).toBeLessThan(stupefy.staminaCost);
    expect(ofType(events, "dodge")).toStrictEqual([]);
    expect(ofType(events, "stamina-short")).toMatchObject([
      { action: "dodge" },
    ]);
  });
});

describe("Defence and the Charge", () => {
  const charging = intent({ heavySpell: true });

  /** The hero Charges Confringo for a moment, still holding △. */
  const startCharging = (duel: Duel) =>
    run(duel, secondsToTicks(0.3), { hero: charging });

  it.each([
    ["a Dodge", { dodge: true }],
    ["raising the Shield", { shield: true }],
    ["a jump", { jump: true }],
  ] as const)("loses a Charge in progress to %s", (_, defence) => {
    const duel = fight();
    startCharging(duel);
    expect(duelist(duel, "hero").chargeSeconds).toBeGreaterThan(0);

    const events = [
      ...run(duel, 1, { hero: intent({ ...defence, heavySpell: true }) }),
      // Letting go of △ afterwards casts nothing.
      ...run(duel, secondsToTicks(0.2)),
    ];

    expect(duelist(duel, "hero").chargeSeconds).toBe(0);
    expect(ofType(events, "spell-cast")).toStrictEqual([]);
  });

  it("cannot Charge the Heavy Spell in the air, only cast the Light Spell", () => {
    const duel = fight();
    tap(duel, { jump: true });

    const events = run(duel, secondsToTicks(0.4), { hero: charging });

    expect(duelist(duel, "hero").elevation).toBeGreaterThan(0);
    expect(duelist(duel, "hero").chargeSeconds).toBe(0);
    expect(ofType(events, "spell-cast")).toStrictEqual([]);
  });

  it("cannot sprint while Charging", () => {
    const duel = fight();

    run(duel, secondsToTicks(0.5), {
      hero: intent({ heavySpell: true, move: { x: 1, y: 0 }, sprint: true }),
    });

    expect(duelist(duel, "hero")).toMatchObject({
      sprinting: false,
      stamina: stamina.max,
    });
  });

  it("Parries a Confringo back at its caster", () => {
    const duel = fight();
    run(duel, secondsToTicks(0.5), { rival: charging });
    run(duel, 1);
    untilBoltWithin(duel, shield.parryWindow / 2);

    const events = [
      ...run(duel, secondsToTicks(0.3), { hero: intent({ shield: true }) }),
      ...settle(duel),
    ];

    expect(ofType(events, "parry")).toMatchObject([
      { reflected: { casterId: "hero", kind: "confringo" } },
    ]);
    expect(ofType(events, "spell-hit")).toMatchObject([
      { spell: { casterId: "hero", kind: "confringo" }, targetId: "rival" },
    ]);
  });
});
