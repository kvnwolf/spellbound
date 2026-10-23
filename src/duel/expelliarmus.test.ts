/**
 * Expelliarmus, Disarm and the Wand through the Duel seam: drive
 * `createDuel` with Intents, assert snapshots and events. Same seam as
 * `specials.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { tuning } from "../tuning";
import type { Tuning } from "../tuning";
import { createDuel } from "./duel";
import type { ArenaLayout, Duel, DuelEvent, DuelistState } from "./duel";
import { direction, distanceBetween, forwardOf, rightOf } from "./geometry";
import type { GroundPoint } from "./geometry";
import { idleIntent } from "./intent";
import type { Intent } from "./intent";
import type { SpellSlot } from "./spell-slots";

const openArena: ArenaLayout = {
  bounds: { halfDepth: 10, halfWidth: 10 },
  cover: [],
  obstructions: [],
};

const { expelliarmus, focus } = tuning;

const secondsToTicks = (seconds: number) =>
  Math.round(seconds * tuning.tickRate);

const intent = (overrides: Partial<Intent>): Intent => ({
  ...idleIntent,
  ...overrides,
});

/** Rivals tough enough to take every Stupefy these tests land to build Focus. */
const sturdy: Tuning = {
  ...tuning,
  duelist: { ...tuning.duelist, health: 1000 },
};

/** A 1v1 with the hero facing the rival 10 m away along -z, past the Round intro. */
const fight = (arena: ArenaLayout = openArena, settings = sturdy): Duel => {
  const duel = createDuel({
    arena,
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

/** Lets every Spell in flight land, and any Stagger wear off. */
const settle = (duel: Duel): DuelEvent[] => run(duel, secondsToTicks(2));

/** Expelliarmus sits in the ○ Spell Slot. */
const toExpelliarmus: SpellSlot = "circle";

/** Holds R2 and presses ○ for a tick, then lets go of both. */
const castExpelliarmus = (duel: Duel, who = "hero"): DuelEvent[] => [
  ...run(duel, 1, {
    [who]: intent({ spellSlots: { held: true, press: toExpelliarmus } }),
  }),
  ...run(duel, 1),
];

/** `who` lands Stupefies on the other Duelist until their Focus is full. */
const fillFocus = (duel: Duel, who = "hero") => {
  for (let cast = 0; duelist(duel, who).focus < focus.max; cast += 1) {
    if (cast > 20) {
      throw new Error("Focus never filled");
    }

    tap(duel, { lightSpell: true }, who);
    run(duel, secondsToTicks(0.6));
  }

  settle(duel);
};

/** The hero fills their Focus and Disarms the rival, whose Wand lands; returns the events from the cast on. */
const disarmRival = (duel: Duel): DuelEvent[] => {
  fillFocus(duel);

  return [...castExpelliarmus(duel), ...run(duel, secondsToTicks(1.2))];
};

describe("Expelliarmus", () => {
  it("costs three Focus segments and starts its long Cooldown", () => {
    const duel = fight();
    fillFocus(duel);

    const events = castExpelliarmus(duel);

    expect(ofType(events, "spell-cast")).toMatchObject([
      { spell: { casterId: "hero", kind: "expelliarmus" } },
    ]);
    expect(duelist(duel, "hero").focus).toBe(0);
    expect(expelliarmus.segments).toBe(3);
    expect(duelist(duel, "hero").cooldowns.expelliarmus).toBeCloseTo(
      expelliarmus.cooldownSeconds,
      1
    );
    expect(expelliarmus.cooldownSeconds).toBeGreaterThanOrEqual(10);
  });

  it("deals no damage and Disarms the Duelist it hits", () => {
    const duel = fight();
    fillFocus(duel);
    const { health } = duelist(duel, "rival");

    const events = [...castExpelliarmus(duel), ...run(duel, secondsToTicks(1))];

    expect(ofType(events, "spell-hit")).toMatchObject([
      { damage: 0, spell: { kind: "expelliarmus" }, targetId: "rival" },
    ]);
    expect(ofType(events, "disarm")).toMatchObject([
      { casterId: "hero", duelistId: "rival" },
    ]);
    expect(duelist(duel, "rival").health).toBe(health);
    expect(duelist(duel, "rival").looseWand).not.toBeNull();
    expect(duelist(duel, "hero").looseWand).toBeNull();
  });
});

describe("The Wand knocked loose", () => {
  it("flies a few metres along the hit and lands on the floor", () => {
    const duel = fight();
    const events = disarmRival(duel);
    const [disarm] = ofType(events, "disarm");
    const rival = duelist(duel, "rival");

    // The hero cast up the Arena along -z, so the Wand flies on that way.
    expect(disarm?.landing.z).toBeLessThan(rival.position.z - 3);
    expect(Math.abs(disarm?.landing.x ?? 1)).toBeLessThan(0.5);
    expect(ofType(events, "wand-landed")).toMatchObject([
      { duelistId: "rival", position: disarm?.landing },
    ]);
    expect(rival.looseWand).toMatchObject({
      grounded: true,
      landing: disarm?.landing,
      position: { x: disarm?.landing.x, y: 0, z: disarm?.landing.z },
    });
  });

  it("lands inside the Arena's walls", () => {
    // The rival stands a metre from the back wall.
    const cramped: ArenaLayout = {
      ...openArena,
      bounds: { halfDepth: 6, halfWidth: 10 },
    };

    const duel = fight(cramped);
    const [disarm] = ofType(disarmRival(duel), "disarm");

    expect(disarm?.landing.z).toBeGreaterThanOrEqual(
      -6 + tuning.duelist.bodyRadius
    );
  });

  it("stops short of Cover in its way", () => {
    const column = { center: { x: 0, z: -7.5 }, radius: 0.55 };
    const duel = fight({ ...openArena, cover: [column] });
    const [disarm] = ofType(disarmRival(duel), "disarm");

    expect(disarm?.landing.z).toBeGreaterThan(column.center.z + column.radius);
    expect(disarm?.landing.z).toBeLessThan(-5);
  });
});

describe("A Disarmed Duelist", () => {
  it("cannot cast any Spell or raise the Shield", () => {
    const duel = fight();
    disarmRival(duel);

    const light = tap(duel, { lightSpell: true }, "rival");

    const heavy = run(duel, secondsToTicks(0.5), {
      rival: intent({ heavySpell: true }),
    });

    const charge = duelist(duel, "rival").chargeSeconds;
    run(duel, 1);
    const shield = run(duel, 2, { rival: intent({ shield: true }) });
    const { shielding } = duelist(duel, "rival");

    expect(ofType([...light, ...heavy, ...shield], "spell-cast")).toStrictEqual(
      []
    );
    expect(charge).toBe(0);
    expect(shielding).toBeFalsy();
  });

  it("can still move, jump and Dodge", () => {
    const duel = fight();
    disarmRival(duel);
    const before = duelist(duel, "rival").position;

    run(duel, secondsToTicks(0.3), {
      rival: intent({ move: { x: 1, y: 0 } }),
    });

    const moved = duelist(duel, "rival").position;
    const jump = tap(duel, { jump: true }, "rival");
    run(duel, secondsToTicks(1));
    const dodge = tap(duel, { dodge: true }, "rival");

    expect(moved).not.toStrictEqual(before);
    expect(ofType(jump, "jump")).toHaveLength(1);
    expect(ofType(dodge, "dodge")).toHaveLength(1);
  });

  it("drops a raised Shield and loses a Charge in progress", () => {
    const duel = fight();
    fillFocus(duel);
    // The rival Charges as the Expelliarmus flies at them, without casting it.
    castExpelliarmus(duel);

    const events = run(duel, secondsToTicks(0.6), {
      rival: intent({ heavySpell: true }),
    });

    expect(ofType(events, "disarm")).toHaveLength(1);
    expect(ofType(events, "spell-cast")).toStrictEqual([]);
    expect(duelist(duel, "rival").chargeSeconds).toBe(0);
  });
});

/**
 * Walks `who` (free-aiming) toward `spot` until they stand on it, steering
 * the stick relative to their aim every tick; at most a few seconds.
 */
const walkTo = (duel: Duel, who: string, spot: GroundPoint) => {
  const events: DuelEvent[] = [];

  for (let tick = 0; tick < secondsToTicks(4); tick += 1) {
    const self = duelist(duel, who);
    const offset = distanceBetween(self.position, spot);

    if (offset < 0.1) {
      break;
    }

    const way = direction(self.position, spot);
    const ahead = forwardOf(self.aim.yaw);
    const side = rightOf(ahead);
    const pace = Math.min(offset / 0.1, 1);

    const move = {
      x: (way.x * side.x + way.z * side.z) * pace,
      y: (way.x * ahead.x + way.z * ahead.z) * pace,
    };

    events.push(...run(duel, 1, { [who]: intent({ move }) }));
  }

  return events;
};

describe("Getting the Wand back", () => {
  it("is picking it up by walking over it", () => {
    const duel = fight();
    const [disarm] = ofType(disarmRival(duel), "disarm");
    const landing = disarm?.landing ?? { x: 0, z: 0 };

    // The rival walks back to where the Wand lies.
    const events = walkTo(duel, "rival", landing);

    expect(ofType(events, "wand-recovered")).toMatchObject([
      { duelistId: "rival", how: "pickup" },
    ]);
    expect(duelist(duel, "rival").looseWand).toBeNull();

    const cast = tap(duel, { lightSpell: true }, "rival");

    expect(ofType(cast, "spell-cast")).toHaveLength(1);
  });

  it("is never the opponent's: walking over it does nothing", () => {
    const duel = fight();
    const [disarm] = ofType(disarmRival(duel), "disarm");
    const landing = disarm?.landing ?? { x: 0, z: 0 };

    // The rival steps aside, and the hero walks up to the Wand.
    run(duel, secondsToTicks(0.6), { rival: intent({ move: { x: 1, y: 0 } }) });
    const events = walkTo(duel, "hero", landing);
    const hero = duelist(duel, "hero").position;

    expect(Math.hypot(hero.x - landing.x, hero.z - landing.z)).toBeLessThan(
      tuning.expelliarmus.wand.pickupRadius
    );
    expect(ofType(events, "wand-recovered")).toStrictEqual([]);
    expect(duelist(duel, "rival").looseWand).toMatchObject({ landing });
  });

  it("returns to its owner's hand on its own about six seconds after the Disarm", () => {
    const duel = fight();
    fillFocus(duel);
    castExpelliarmus(duel);
    let ticks = 0;

    while (ofType(run(duel, 1), "disarm").length === 0) {
      ticks += 1;

      if (ticks > secondsToTicks(2)) {
        throw new Error("No Disarm");
      }
    }

    const events = run(duel, secondsToTicks(expelliarmus.wand.returnSeconds));

    expect(expelliarmus.wand.returnSeconds).toBeCloseTo(6, 0);
    expect(ofType(events, "wand-recovered")).toMatchObject([
      { duelistId: "rival", how: "return" },
    ]);
    expect(events.at(-1)).toMatchObject({ type: "wand-recovered" });
    expect(duelist(duel, "rival").looseWand).toBeNull();
  });

  it("is back in hand at the next Round", () => {
    // A rival a few Stupefies can Knock Out once Disarmed.
    const frail: Tuning = {
      ...tuning,
      duelist: { ...tuning.duelist, health: 120 },
    };

    const duel = fight(openArena, frail);
    disarmRival(duel);

    while (duel.snapshot().round.number === 1) {
      tap(duel, { lightSpell: true });
      run(duel, secondsToTicks(0.3));
    }

    expect(duelist(duel, "rival").looseWand).toBeNull();
  });
});

describe("No Disarm lock", () => {
  it("an Expelliarmus on a Duelist already Disarmed has no further effect", () => {
    // One segment and no real Cooldown, so the hero can cast two in a row.
    const quick: Tuning = {
      ...sturdy,
      expelliarmus: { ...expelliarmus, cooldownSeconds: 0.1, segments: 1 },
    };

    const duel = fight(openArena, quick);
    fillFocus(duel);
    const first = [...castExpelliarmus(duel), ...run(duel, secondsToTicks(1))];
    const wand = duelist(duel, "rival").looseWand;
    const second = [...castExpelliarmus(duel), ...run(duel, secondsToTicks(1))];

    expect(ofType(first, "disarm")).toHaveLength(1);
    expect(ofType(second, "spell-hit")).toMatchObject([
      { spell: { kind: "expelliarmus" }, targetId: "rival" },
    ]);
    expect(ofType(second, "disarm")).toStrictEqual([]);
    expect(duelist(duel, "rival").looseWand?.landing).toStrictEqual(
      wand?.landing
    );
    // The return clock was not restarted.
    expect(duelist(duel, "rival").looseWand?.returnSeconds).toBeLessThan(
      (wand?.returnSeconds ?? 0) - 1
    );
  });
});

describe("A Parried Expelliarmus", () => {
  it("flies back and Disarms its caster", () => {
    const duel = fight();
    fillFocus(duel);
    castExpelliarmus(duel);

    // The rival raises the Shield just before it lands: inside the Parry window.
    const reach = tuning.duelist.bodyRadius + expelliarmus.radius;

    const due = () => {
      const [spell] = duel.snapshot().spells;
      const front = duelist(duel, "rival").position.z + reach;

      return spell ? (spell.position.z - front) / -spell.velocity.z : 0;
    };

    while (due() > tuning.defence.shield.parryWindow / 2) {
      run(duel, 1);
    }

    const events = run(duel, secondsToTicks(1.5), {
      rival: intent({ shield: true }),
    });

    expect(ofType(events, "parry")).toMatchObject([
      { duelistId: "rival", spell: { kind: "expelliarmus" } },
    ]);
    expect(ofType(events, "disarm")).toMatchObject([
      { casterId: "rival", duelistId: "hero" },
    ]);
    expect(duelist(duel, "hero").looseWand).not.toBeNull();
    expect(duelist(duel, "rival").looseWand).toBeNull();
  });
});
