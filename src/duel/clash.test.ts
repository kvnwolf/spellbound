/**
 * The Clash through the Duel seam: two fully Charged Confringos meeting
 * head-on lock into a beam struggle the Duelists fight by pumping. Drives
 * `createDuel` with Intents and asserts snapshots and events, like
 * `duel.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { tuning } from "../tuning";
import type { Tuning } from "../tuning";
import { createDuel } from "./duel";
import type { ArenaLayout, Duel, DuelEvent, DuelistState } from "./duel";
import { wrapAngle } from "./geometry";
import type { GroundPoint } from "./geometry";
import { idleIntent } from "./intent";
import type { Intent } from "./intent";

const openArena: ArenaLayout = {
  bounds: { halfDepth: 10, halfWidth: 10 },
  cover: [],
  obstructions: [],
};

const { clash } = tuning;

const secondsToTicks = (seconds: number) =>
  Math.round(seconds * tuning.tickRate);

const intent = (overrides: Partial<Intent>): Intent => ({
  ...idleIntent,
  ...overrides,
});

const facingHero: GroundPoint = { x: 0, z: -5 };

/** A 1v1 with the hero facing the rival 10 m away along -z, past the Round intro. */
const fight = (
  rivalSpawn: GroundPoint = facingHero,
  settings: Tuning = tuning
): Duel => {
  const duel = createDuel({
    arena: openArena,
    duelists: [
      { id: "hero", spawn: { x: 0, z: 5 }, team: "gryffindor" },
      { id: "rival", spawn: rivalSpawn, team: "slytherin" },
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

const chargeHeavy = intent({ heavySpell: true });

/** The same tuning with Aim Assist switched off: no friction, no bend. */
const withoutAimAssist: Tuning = {
  ...tuning,
  aimAssist: { ...tuning.aimAssist, bendStrength: 0, friction: 1 },
};

/** Turns `who`'s free aim to look along `yaw`, spread over one second of look input. */
const turnTo = (duel: Duel, who: string, yaw: number) => {
  const by = wrapAngle(yaw - duelist(duel, who).aim.yaw);
  run(duel, secondsToTicks(1), {
    [who]: intent({ look: { pitch: 0, yaw: by } }),
  });
};

/** A full Charge, released in the Perfect Release window. */
const full = 0.5;

/** A full Charge held past the Perfect Release window, short of its Backfire. */
const heldFull = 0.58;

/** Half a Charge. */
const half = 0.25;

/**
 * Both Duelists Charge together, each for their own time, and let go; then
 * the Spells fly for up to 1.5 s or until a Clash starts. Returns the events.
 */
const bothRelease = (duel: Duel, hero: number, rival: number) => {
  const events: DuelEvent[] = [];
  const longest = Math.max(hero, rival);

  for (let tick = 0; tick < secondsToTicks(longest) + 1; tick += 1) {
    events.push(
      ...duel.step({
        hero: tick < secondsToTicks(hero) ? chargeHeavy : idleIntent,
        rival: tick < secondsToTicks(rival) ? chargeHeavy : idleIntent,
      }).events
    );
  }

  for (
    let tick = 0;
    tick < secondsToTicks(1.5) && duel.snapshot().clash === null;
    tick += 1
  ) {
    events.push(...run(duel, 1));
  }

  return events;
};

/** A Duel already locked in a Clash, both Confringos released at a full Charge. */
const clashing = (): Duel => {
  const duel = fight();
  bothRelease(duel, full, full);

  if (duel.snapshot().clash === null) {
    throw new Error("No Clash started");
  }

  return duel;
};

const pump = intent({ clashPump: true });

/**
 * `who` pumps R2 `presses` times, one tick down and one up; the other side
 * does nothing. Returns the events.
 */
const pumpTimes = (duel: Duel, who: string, presses: number) => {
  const events: DuelEvent[] = [];

  for (
    let press = 0;
    press < presses && duel.snapshot().clash !== null;
    press += 1
  ) {
    events.push(...run(duel, 1, { [who]: pump }), ...run(duel, 1));
  }

  return events;
};

describe("Clash", () => {
  it("starts when two fully Charged Confringos meet head-on: no burst, no hit, a beam instead", () => {
    const duel = fight();
    const events = bothRelease(duel, full, full);

    const [started] = ofType(events, "clash-start");
    expect(
      started?.clash.sides.map((side) => side.duelistId).toSorted()
    ).toStrictEqual(["hero", "rival"]);
    expect(ofType(events, "spells-cancelled")).toStrictEqual([]);
    expect(ofType(events, "spell-hit")).toStrictEqual([]);

    const { clash: locked, spells } = duel.snapshot();
    // The Spells are the beam now, not flying.
    expect(spells).toStrictEqual([]);
    // They meet halfway, and the meeting point sits on the beam between the Wands.
    expect(locked?.point.z).toBeCloseTo(0, 0);
  });

  it("starts with Confringos released at a full Charge past the Perfect Release window too", () => {
    const duel = fight();
    const events = bothRelease(duel, heldFull, heldFull);

    expect(ofType(events, "clash-start")).toHaveLength(1);
  });

  it("starts at an angle across the Arena, as long as the Duelists cast at each other", () => {
    const duel = fight({ x: 7, z: -3 });
    const events = bothRelease(duel, full, full);

    expect(ofType(events, "clash-start")).toHaveLength(1);
  });

  it.each([
    ["the hero's", half, full],
    ["the rival's", full, half],
    ["both", half, half],
  ])(
    "does not start when %s Confringo is short of a full Charge: they cancel in a burst",
    (_who, hero, rival) => {
      const duel = fight();
      const events = bothRelease(duel, hero, rival);

      expect(ofType(events, "clash-start")).toStrictEqual([]);
      expect(ofType(events, "spells-cancelled")).toHaveLength(1);
      expect(duel.snapshot().clash).toBeNull();
    }
  );

  it("does not start when two full Confringos cross rather than meet head-on: they cancel", () => {
    // The hero shoots straight down the Arena (-z); the rival, off to the
    // side, shoots across it (-x): the Spells cross at right angles.
    const duel = fight({ x: 6, z: -0.5 }, withoutAimAssist);
    turnTo(duel, "hero", 0);
    turnTo(duel, "rival", -Math.PI / 2);

    const events = bothRelease(duel, full, full);

    expect(ofType(events, "clash-start")).toStrictEqual([]);
    expect(ofType(events, "spells-cancelled")).toHaveLength(1);
  });

  it("does not start from a Confringo meeting a Stupefy", () => {
    const duel = fight();

    const events = [
      ...run(duel, secondsToTicks(full), { hero: chargeHeavy }),
      ...run(duel, 1, { rival: intent({ lightSpell: true }) }),
      ...run(duel, secondsToTicks(1)),
    ];

    expect(ofType(events, "clash-start")).toStrictEqual([]);
    expect(ofType(events, "spells-cancelled")).toHaveLength(1);
  });
});

/** How far the Clash's meeting point is from `who`'s Wand, metres. */
const fromWand = (duel: Duel, who: string) => {
  const locked = duel.snapshot().clash;
  const side = locked?.sides.find((each) => each.duelistId === who);

  if (!locked || !side) {
    throw new Error(`${who} is in no Clash`);
  }

  const { point } = locked;
  const { wand } = side;

  return Math.hypot(point.x - wand.x, point.y - wand.y, point.z - wand.z);
};

/** The length of the Clash's beam, Wand to Wand. */
const beamLength = (duel: Duel) => {
  const [first, second] = duel.snapshot().clash?.sides ?? [];

  return first && second
    ? Math.hypot(
        first.wand.x - second.wand.x,
        first.wand.y - second.wand.y,
        first.wand.z - second.wand.z
      )
    : 0;
};

describe("During a Clash", () => {
  it("roots both Duelists: they neither move, cast, Shield, Dodge nor jump", () => {
    const duel = clashing();
    const before = duel.snapshot().duelists;

    const everything = intent({
      dodge: true,
      heavySpell: true,
      jump: true,
      lightSpell: true,
      move: { x: 0.5, y: 1 },
      shield: true,
      spellSlots: { held: true, press: "triangle" },
      sprint: true,
    });

    const events = run(duel, secondsToTicks(1), {
      hero: everything,
      rival: everything,
    });

    expect(duel.snapshot().clash).not.toBeNull();
    expect(duel.snapshot().duelists.map((each) => each.position)).toStrictEqual(
      before.map((each) => each.position)
    );
    expect(
      events.filter((event) =>
        ["dodge", "jump", "spell-cast"].includes(event.type)
      )
    ).toStrictEqual([]);

    for (const id of ["hero", "rival"]) {
      expect(duelist(duel, id)).toMatchObject({
        chargeSeconds: 0,
        elevation: 0,
        shielding: false,
        spellSlotsHeld: false,
      });
    }
  });

  it("faces each Duelist toward the other down the beam", () => {
    const duel = clashing();
    const hero = duelist(duel, "hero");
    const rival = duelist(duel, "rival");

    expect(hero.facing.z).toBeCloseTo(-1);
    expect(rival.facing.z).toBeCloseTo(1);
  });

  it("pushes the meeting point toward the opponent with every pump", () => {
    const duel = clashing();
    const start = fromWand(duel, "rival");

    const events = pumpTimes(duel, "hero", 3);

    expect(ofType(events, "clash-pump")).toHaveLength(3);
    expect(start - fromWand(duel, "rival")).toBeCloseTo(
      3 * clash.pumpShare * beamLength(duel)
    );
  });

  it("counts a pump once per press: holding R2 pushes only once", () => {
    const duel = clashing();
    const start = fromWand(duel, "hero");

    run(duel, secondsToTicks(1), { rival: pump });

    expect(start - fromWand(duel, "hero")).toBeCloseTo(
      clash.pumpShare * beamLength(duel)
    );
  });

  it("holds the meeting point where it is when both pump together", () => {
    const duel = clashing();
    const start = fromWand(duel, "hero");

    for (let press = 0; press < 5; press += 1) {
      run(duel, 1, { hero: pump, rival: pump });
      run(duel, 1);
    }

    expect(fromWand(duel, "hero")).toBeCloseTo(start);
  });
});

describe("Winning a Clash", () => {
  it.each(["hero", "rival"])(
    "goes to %s once the meeting point reaches the opponent's Wand: their Confringo hits empowered",
    (winner) => {
      const loser = winner === "hero" ? "rival" : "hero";
      const duel = clashing();

      const events = pumpTimes(duel, winner, 100);

      const [ended] = ofType(events, "clash-end");
      expect(ended).toMatchObject({ outcome: "won", winnerId: winner });
      expect(duel.snapshot().clash).toBeNull();

      const [hit] = ofType(events, "spell-hit");
      expect(hit).toMatchObject({
        spell: {
          casterId: winner,
          charge: 1,
          empowered: true,
          kind: "confringo",
        },
        targetId: loser,
      });
      // A full Charge's damage, empowered.
      expect(hit?.damage).toBeCloseTo(28 * 1.35);
      expect(duelist(duel, loser).health).toBeCloseTo(100 - 28 * 1.35);
    }
  );

  it("takes 10 pumps from the middle", () => {
    const duel = clashing();
    const events = pumpTimes(duel, "hero", 100);

    expect(ofType(events, "clash-pump")).toHaveLength(10);
  });

  it("earns the winner 40 Focus", () => {
    const duel = clashing();
    pumpTimes(duel, "hero", 100);

    expect(duelist(duel, "hero").focus).toBe(40);
    // The loser only gets the little Focus every hit taken gives.
    expect(duelist(duel, "rival").focus).toBe(tuning.focus.gain.damageTaken);
  });

  it("knocks the loser back and frees both Duelists", () => {
    const duel = clashing();
    pumpTimes(duel, "hero", 100);
    run(duel, secondsToTicks(1));
    const before = duelist(duel, "hero").position;

    run(duel, secondsToTicks(0.5), { hero: intent({ move: { x: 1, y: 0 } }) });

    expect(duelist(duel, "rival").position.z).toBeLessThan(-5.5);
    expect(duelist(duel, "hero").position).not.toStrictEqual(before);
  });
});

describe("A Clash nobody wins", () => {
  it("explodes after about 6 s", () => {
    const duel = clashing();
    const events: DuelEvent[] = [];
    let ticks = 0;

    while (duel.snapshot().clash !== null && ticks < secondsToTicks(10)) {
      events.push(...run(duel, 1));
      ticks += 1;
    }

    expect(ticks / tuning.tickRate).toBeCloseTo(clash.seconds, 1);
    expect(ofType(events, "clash-end")).toMatchObject([
      { outcome: "exploded", winnerId: null },
    ]);
  });

  it("knocks both Duelists back 3 m, away from the beam, without hurting them", () => {
    const duel = clashing();
    run(duel, secondsToTicks(clash.seconds + 1));

    const [hero, rival] = duel.snapshot().duelists;

    expect(hero?.position.z).toBeCloseTo(5 + 3, 1);
    expect(rival?.position.z).toBeCloseTo(-5 - 3, 1);
    // A blast, not a hit: nobody's Health or Focus changes.
    expect(
      duel.snapshot().duelists.map(({ focus, health }) => ({ focus, health }))
    ).toStrictEqual([
      { focus: 0, health: tuning.duelist.health },
      { focus: 0, health: tuning.duelist.health },
    ]);
  });

  it("counts the time down on the snapshot", () => {
    const duel = clashing();
    const start = duel.snapshot().clash?.secondsLeft ?? 0;
    run(duel, secondsToTicks(1));

    expect(start).toBeCloseTo(clash.seconds, 1);
    expect(duel.snapshot().clash?.secondsLeft).toBeCloseTo(start - 1);
  });

  it("ends with neither winning when a Duelist in it is Knocked Out by another Spell", () => {
    // A frail hero against the rival and an ally of theirs off to the side.
    const frail: Tuning = {
      ...tuning,
      duelist: { ...tuning.duelist, health: 5 },
    };

    const duel = createDuel({
      arena: openArena,
      duelists: [
        { id: "hero", spawn: { x: 0, z: 5 }, team: "gryffindor" },
        { id: "rival", spawn: { x: 0, z: -5 }, team: "slytherin" },
        { id: "ally", spawn: { x: -9, z: -4 }, team: "slytherin" },
      ],
      tuning: frail,
    });

    while (duel.snapshot().round.phase === "intro") {
      duel.step({});
    }

    bothRelease(duel, full, full);
    expect(duel.snapshot().clash).not.toBeNull();

    const events = [
      ...run(duel, 1, { ally: intent({ lightSpell: true }) }),
      ...run(duel, secondsToTicks(1)),
    ];

    expect(ofType(events, "knockout")).toMatchObject([{ duelistId: "hero" }]);
    expect(ofType(events, "clash-end")).toMatchObject([
      { outcome: "interrupted", winnerId: null },
    ]);
    expect(duel.snapshot().clash).toBeNull();
  });
});
