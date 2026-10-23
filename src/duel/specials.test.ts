/**
 * Focus, the Spell Wheel and the Special Spells (Incendio, Petrificus
 * Totalus) through the Duel seam: drive `createDuel` with Intents, assert
 * snapshots and events. Same seam as `duel.test.ts` and `defence.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { tuning } from "../tuning";
import type { Tuning } from "../tuning";
import { createDuel } from "./duel";
import type { ArenaLayout, Duel, DuelEvent, DuelistState } from "./duel";
import { idleIntent } from "./intent";
import type { Intent, Vec2 } from "./intent";

const openArena: ArenaLayout = {
  bounds: { halfDepth: 10, halfWidth: 10 },
  cover: [],
  obstructions: [],
};

const { focus, incendio, petrificus } = tuning;
const segmentCost = (segments: number) => segments * focus.segment;

const secondsToTicks = (seconds: number) =>
  Math.round(seconds * tuning.tickRate);

const intent = (overrides: Partial<Intent>): Intent => ({
  ...idleIntent,
  ...overrides,
});

/** A rival tough enough to take every Stupefy these tests land to build Focus. */
const sturdy: Tuning = {
  ...tuning,
  duelist: { ...tuning.duelist, health: 1000 },
};

/** A 1v1 with the hero facing the rival 10 m away along -z, past the Round intro. */
const fight = (settings: Tuning = sturdy): Duel => {
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

/** Holds `held` for one tick, then lets go for a tick: a press. */
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

/**
 * Steps idle ticks until the rival's bolt is due to reach the hero's body
 * (standing where they are) within `seconds`.
 */
const untilBoltWithin = (duel: Duel, seconds: number) => {
  const reach = tuning.duelist.bodyRadius + tuning.stupefy.radius;

  const due = () => {
    const [bolt] = duel.snapshot().spells;
    const front = duelist(duel, "hero").position.z - reach;

    return bolt ? (front - bolt.position.z) / bolt.velocity.z : 0;
  };

  while (due() > seconds) {
    run(duel, 1);
  }
};

/** Lets every Spell in flight land, and any Stagger or Petrified wear off. */
const settle = (duel: Duel): DuelEvent[] => run(duel, secondsToTicks(2));

/** The right stick on the Spell Wheel: Incendio's slice is to the right, Petrificus Totalus's to the left, the locked one at the top. */
const toIncendio: Vec2 = { x: 1, y: 0 };
const toPetrificus: Vec2 = { x: -1, y: 0 };
const toLocked: Vec2 = { x: 0, y: 1 };
const centred: Vec2 = { x: 0, y: 0 };

const wheel = (pick: Vec2, extra: Partial<Intent> = {}) =>
  intent({ ...extra, spellWheel: { held: true, pick } });

/**
 * Opens the Spell Wheel, holds the stick on `pick` for a moment, then lets
 * go of R2 (and the stick) on the same tick, as a player does.
 */
const castFromWheel = (duel: Duel, pick: Vec2, who = "hero"): DuelEvent[] => [
  ...run(duel, secondsToTicks(0.2), { [who]: wheel(pick) }),
  ...run(duel, 1),
];

/** The hero lands Stupefies on the rival until their Focus reaches `points`. */
const buildFocus = (duel: Duel, points: number) => {
  for (let cast = 0; duelist(duel, "hero").focus < points; cast += 1) {
    if (cast > 20) {
      throw new Error("Focus never built up");
    }

    tap(duel, { lightSpell: true });
    run(duel, secondsToTicks(0.6));
  }

  settle(duel);
};

describe("Focus", () => {
  it("starts empty", () => {
    const duel = fight();

    expect(duelist(duel, "hero").focus).toBe(0);
    expect(duelist(duel, "rival").focus).toBe(0);
  });

  it("builds with every Light Spell hit, and a little for the Duelist hit", () => {
    const duel = fight();

    tap(duel, { lightSpell: true });
    settle(duel);

    expect(duelist(duel, "hero").focus).toBe(focus.gain.lightSpellHit);
    expect(duelist(duel, "rival").focus).toBe(focus.gain.damageTaken);
  });

  it("builds with a Parry and with a Perfect Dodge", () => {
    const parried = fight();
    tap(parried, { lightSpell: true }, "rival");
    // Raise the Shield just before the bolt lands: inside the Parry window.
    untilBoltWithin(parried, tuning.defence.shield.parryWindow / 2);

    const parry = run(parried, secondsToTicks(0.3), {
      hero: intent({ shield: true }),
    });

    settle(parried);

    const dodged = fight();
    tap(dodged, { lightSpell: true }, "rival");
    untilBoltWithin(dodged, tuning.defence.dodge.perfectWindow * 0.6);
    const dodge = tap(dodged, { dodge: true, move: { x: 1, y: 0 } });
    settle(dodged);

    expect(ofType(parry, "parry")).toHaveLength(1);
    // The Parry, plus the reflected bolt landing as the hero's Light Spell hit.
    expect(duelist(parried, "hero").focus).toBe(
      focus.gain.parry + focus.gain.lightSpellHit
    );
    expect(ofType(dodge, "perfect-dodge")).toHaveLength(1);
    expect(duelist(dodged, "hero").focus).toBe(focus.gain.perfectDodge);
  });

  it("never decays and never passes the three segments", () => {
    const duel = fight();
    buildFocus(duel, focus.max);
    tap(duel, { lightSpell: true });
    settle(duel);
    const full = duelist(duel, "hero").focus;

    run(duel, secondsToTicks(10));

    expect(full).toBe(focus.max);
    expect(focus.max).toBe(segmentCost(3));
    expect(duelist(duel, "hero").focus).toBe(focus.max);
  });

  it("starts empty again every Round", () => {
    // A frail rival, so a few hits win the Round.
    const frail: Tuning = {
      ...tuning,
      duelist: { ...tuning.duelist, health: 20 },
    };

    const duel = fight(frail);

    while (duel.snapshot().round.number === 1) {
      tap(duel, { lightSpell: true });
      run(duel, secondsToTicks(0.5));
    }

    expect(duelist(duel, "hero").focus).toBe(0);
    expect(duelist(duel, "rival").focus).toBe(0);
  });
});

describe("Spell Wheel", () => {
  it("opens while R2 is held and shows the slice the right stick picks", () => {
    const duel = fight();

    run(duel, 2, { hero: wheel(centred) });
    const opened = duelist(duel, "hero").spellWheel;
    run(duel, 2, { hero: wheel(toIncendio) });
    const incendioPicked = duelist(duel, "hero").spellWheel;
    run(duel, 2, { hero: wheel(toPetrificus) });
    const petrificusPicked = duelist(duel, "hero").spellWheel;
    run(duel, 2, { hero: wheel(toLocked) });
    const lockedPicked = duelist(duel, "hero").spellWheel;
    run(duel, 1);

    expect(opened).toStrictEqual({ open: true, selected: null });
    expect(incendioPicked).toStrictEqual({ open: true, selected: "incendio" });
    expect(petrificusPicked).toStrictEqual({
      open: true,
      selected: "petrificus",
    });
    // Expelliarmus's slice is not in the game yet: it picks nothing.
    expect(lockedPicked).toStrictEqual({ open: true, selected: null });
    expect(duelist(duel, "hero").spellWheel).toStrictEqual({
      open: false,
      selected: null,
    });
  });

  it("casts the picked Special Spell on release, spending its Focus and starting its Cooldown", () => {
    const duel = fight();
    buildFocus(duel, segmentCost(incendio.segments));
    const before = duelist(duel, "hero").focus;

    const events = castFromWheel(duel, toIncendio);

    expect(ofType(events, "spell-cast")).toMatchObject([
      { spell: { casterId: "hero", kind: "incendio" } },
    ]);
    expect(duelist(duel, "hero").focus).toBe(
      before - segmentCost(incendio.segments)
    );
    expect(duelist(duel, "hero").cooldowns.incendio).toBeCloseTo(
      incendio.cooldownSeconds,
      1
    );
    expect(duelist(duel, "hero").cooldowns.petrificus).toBe(0);
  });

  it("aims a Special Spell like any other: at the crosshair, or the Target while Locked On", () => {
    const duel = fight();
    buildFocus(duel, segmentCost(petrificus.segments));
    run(duel, 1, { hero: intent({ lockOn: true }) });

    const [cast] = ofType(castFromWheel(duel, toPetrificus), "spell-cast");

    expect(cast?.spell.homing).toMatchObject({ targetId: "rival" });
    // Straight up the Arena at the rival.
    expect(cast?.spell.velocity.z).toBeLessThan(0);
    expect(Math.abs(cast?.spell.velocity.x ?? 1)).toBeLessThan(1);
  });

  it("cancels when R2 is released with the stick centred", () => {
    const duel = fight();
    buildFocus(duel, segmentCost(incendio.segments));
    const before = duelist(duel, "hero").focus;

    const events = [
      ...run(duel, secondsToTicks(0.3), { hero: wheel(centred) }),
      ...run(duel, 1),
    ];

    expect(ofType(events, "spell-cast")).toStrictEqual([]);
    expect(duelist(duel, "hero").focus).toBe(before);
  });

  it("cancels when the stick goes back to the centre before R2 is released", () => {
    const duel = fight();
    buildFocus(duel, segmentCost(incendio.segments));

    const events = [
      ...run(duel, secondsToTicks(0.2), { hero: wheel(toIncendio) }),
      ...run(duel, secondsToTicks(0.3), { hero: wheel(centred) }),
      ...run(duel, 1),
    ];

    expect(ofType(events, "spell-cast")).toStrictEqual([]);
  });

  it("still casts when the stick slips back to the centre a moment before R2", () => {
    const duel = fight();
    buildFocus(duel, segmentCost(incendio.segments));

    const events = [
      ...run(duel, secondsToTicks(0.2), { hero: wheel(toIncendio) }),
      ...run(duel, 2, { hero: wheel(centred) }),
      ...run(duel, 1),
    ];

    expect(ofType(events, "spell-cast")).toMatchObject([
      { spell: { kind: "incendio" } },
    ]);
  });

  it("casts nothing from the locked slice", () => {
    const duel = fight();
    buildFocus(duel, focus.max);

    expect(ofType(castFromWheel(duel, toLocked), "spell-cast")).toStrictEqual(
      []
    );
  });

  it("refuses a Special Spell the Focus cannot pay for", () => {
    const duel = fight();
    buildFocus(duel, 1);

    const events = castFromWheel(duel, toIncendio);

    expect(duelist(duel, "hero").focus).toBeLessThan(
      segmentCost(incendio.segments)
    );
    expect(ofType(events, "spell-cast")).toStrictEqual([]);
  });

  it("refuses a Special Spell while its Cooldown runs, but not the other one", () => {
    const duel = fight();
    buildFocus(duel, focus.max);
    castFromWheel(duel, toPetrificus);
    settle(duel);
    buildFocus(duel, focus.max);

    const again = castFromWheel(duel, toPetrificus);
    const other = castFromWheel(duel, toIncendio);

    expect(ofType(again, "spell-cast")).toStrictEqual([]);
    expect(ofType(other, "spell-cast")).toMatchObject([
      { spell: { kind: "incendio" } },
    ]);
  });

  it("allows the Special Spell again once its Cooldown is over", () => {
    const duel = fight();
    buildFocus(duel, segmentCost(petrificus.segments));
    castFromWheel(duel, toPetrificus);
    run(duel, secondsToTicks(petrificus.cooldownSeconds));
    buildFocus(duel, segmentCost(petrificus.segments));

    expect(duelist(duel, "hero").cooldowns.petrificus).toBe(0);
    expect(
      ofType(castFromWheel(duel, toPetrificus), "spell-cast")
    ).toMatchObject([{ spell: { kind: "petrificus" } }]);
  });

  it("cannot cast a Special Spell in the air", () => {
    const duel = fight();
    buildFocus(duel, segmentCost(incendio.segments));

    const events = [
      ...run(duel, secondsToTicks(0.2), { hero: wheel(toIncendio) }),
      ...run(duel, 1, { hero: wheel(toIncendio, { jump: true }) }),
      ...run(duel, 1),
    ];

    expect(ofType(events, "jump")).toHaveLength(1);
    expect(ofType(events, "spell-cast")).toStrictEqual([]);
  });

  it("keeps the Duel running while it is open: the Duelist still moves", () => {
    const duel = fight();
    const before = duelist(duel, "hero").position;

    run(duel, secondsToTicks(0.5), {
      hero: wheel(toIncendio, { move: { x: 1, y: 0 } }),
    });

    expect(duelist(duel, "hero").position.x).toBeGreaterThan(before.x + 1);
  });
});

describe("Incendio", () => {
  it("explodes on the Duelist it hits, dealing its damage and leaving a Burn", () => {
    const duel = fight();
    buildFocus(duel, segmentCost(incendio.segments));
    const { health } = duelist(duel, "rival");

    const events = [
      ...castFromWheel(duel, toIncendio),
      ...run(duel, secondsToTicks(1)),
    ];

    const burnt = duelist(duel, "rival");

    expect(ofType(events, "spell-hit")).toMatchObject([
      {
        damage: incendio.damage,
        spell: { kind: "incendio" },
        targetId: "rival",
      },
    ]);
    expect(ofType(events, "explosion")).toMatchObject([
      { burned: ["rival"], spell: { kind: "incendio" } },
    ]);
    expect(burnt.burnSeconds).toBeGreaterThan(0);

    // The Burn wears off after dealing its damage over its duration.
    run(duel, secondsToTicks(incendio.burn.seconds));

    const total =
      incendio.damage + incendio.burn.damagePerSecond * incendio.burn.seconds;

    expect(duelist(duel, "rival").burnSeconds).toBe(0);
    expect(duelist(duel, "rival").health).toBeCloseTo(health - total, 0);
  });

  it("is blocked by a Shield, but its Burn reaches the Shielded Duelist inside the blast", () => {
    const duel = fight();
    buildFocus(duel, segmentCost(incendio.segments));
    const { health } = duelist(duel, "rival");
    const shield = intent({ shield: true });

    // The rival's Shield is up well before the blast: a block, not a Parry.
    run(duel, secondsToTicks(0.5), { rival: shield });

    const events = [
      ...run(duel, secondsToTicks(0.2), {
        hero: wheel(toIncendio),
        rival: shield,
      }),
      ...run(duel, secondsToTicks(1), { rival: shield }),
    ];

    expect(ofType(events, "spell-blocked")).toMatchObject([
      { duelistId: "rival", spell: { kind: "incendio" } },
    ]);
    expect(ofType(events, "spell-hit")).toStrictEqual([]);
    expect(ofType(events, "explosion")).toMatchObject([{ burned: ["rival"] }]);
    // Burning: it costs Health, though the direct hit never landed.
    expect([
      duelist(duel, "rival").burnSeconds > 0,
      duelist(duel, "rival").health < health,
    ]).toStrictEqual([true, true]);
  });

  it("explodes on the floor, burning only Duelists inside the blast", () => {
    const duel = fight();
    buildFocus(duel, segmentCost(incendio.segments));
    // Look well down, so the fireball lands a few metres ahead of the hero.
    run(duel, secondsToTicks(1), {
      hero: intent({ look: { pitch: -3, yaw: 0 } }),
    });

    const events = [
      ...castFromWheel(duel, toIncendio),
      ...run(duel, secondsToTicks(1)),
    ];

    const [blast] = ofType(events, "explosion");

    expect(ofType(events, "spell-stopped")).toMatchObject([{ by: "floor" }]);
    expect(blast?.position.y).toBeCloseTo(0, 1);
    expect(blast?.burned).toStrictEqual([]);
    expect(duelist(duel, "rival").burnSeconds).toBe(0);
  });
});

/** The hero casts Petrificus Totalus at the rival; returns the events up to the tick it lands. */
const petrify = (duel: Duel): DuelEvent[] => {
  buildFocus(duel, segmentCost(petrificus.segments));
  const events = castFromWheel(duel, toPetrificus);

  while (
    ofType(events, "spell-hit").length === 0 &&
    duel.snapshot().spells.length > 0
  ) {
    events.push(...run(duel, 1));
  }

  return events;
};

describe("Petrificus Totalus", () => {
  const tryToAct = intent({
    dodge: true,
    lightSpell: true,
    move: { x: 1, y: 0 },
  });

  it("leaves the Duelist it hits Petrified for its duration", () => {
    const duel = fight();
    const events = petrify(duel);

    expect(ofType(events, "spell-hit")).toMatchObject([
      { damage: 0, spell: { kind: "petrificus" }, targetId: "rival" },
    ]);
    expect(duelist(duel, "rival").petrifiedSeconds).toBeCloseTo(
      petrificus.petrifiedSeconds,
      1
    );
  });

  it("stops the Petrified Duelist from moving, casting or Dodging until it wears off", () => {
    const duel = fight();
    petrify(duel);
    const frozen = duelist(duel, "rival");

    const whileFrozen = run(
      duel,
      secondsToTicks(petrificus.petrifiedSeconds) - 2,
      { rival: tryToAct }
    );

    const stillFrozen = duelist(duel, "rival");

    expect(ofType(whileFrozen, "spell-cast")).toStrictEqual([]);
    expect(ofType(whileFrozen, "dodge")).toStrictEqual([]);
    expect(stillFrozen.position).toStrictEqual(frozen.position);
    expect(stillFrozen.petrifiedSeconds).toBeGreaterThan(0);
  });

  it("frees the Duelist once it wears off", () => {
    const duel = fight();
    petrify(duel);
    const frozen = duelist(duel, "rival");
    run(duel, secondsToTicks(petrificus.petrifiedSeconds) + 1);

    const thawed = duelist(duel, "rival");
    run(duel, secondsToTicks(0.3), { rival: intent({ move: { x: 1, y: 0 } }) });

    const { position } = duelist(duel, "rival");

    expect(thawed.petrifiedSeconds).toBe(0);
    expect(
      Math.hypot(position.x - frozen.position.x, position.z - frozen.position.z)
    ).toBeGreaterThan(0.5);
  });

  it("is stopped by a Shield", () => {
    const duel = fight();
    buildFocus(duel, segmentCost(petrificus.segments));
    const shield = intent({ shield: true });
    run(duel, secondsToTicks(0.5), { rival: shield });

    const events = [
      ...run(duel, secondsToTicks(0.2), {
        hero: wheel(toPetrificus),
        rival: shield,
      }),
      ...run(duel, secondsToTicks(1), { rival: shield }),
    ];

    expect(ofType(events, "spell-blocked")).toHaveLength(1);
    expect(duelist(duel, "rival").petrifiedSeconds).toBe(0);
  });
});
