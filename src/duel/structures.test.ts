/**
 * The destructible Arena through the Duel seam: Cover columns and the
 * fountain (an Obstruction) have structural health, Spells wear it down,
 * and broken Cover stops blocking Spells and sight. Drive `createDuel` with
 * Intents, assert snapshots and events. Same seam as `duel.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { tuning } from "../tuning";
import type { Tuning } from "../tuning";
import { createDuel } from "./duel";
import type { ArenaLayout, Duel, DuelEvent, StructureState } from "./duel";
import { idleIntent } from "./intent";
import type { Intent } from "./intent";
import type { SpellSlot } from "./spell-slots";

const secondsToTicks = (seconds: number) =>
  Math.round(seconds * tuning.tickRate);

/** Round numbers, so every expectation below is worked out by hand. */
const structural: Tuning = {
  ...tuning,
  // A Perfect Release casts a full Charge; unscaled, it takes exactly `full` off.
  confringo: { ...tuning.confringo, perfectScale: 1 },
  structures: {
    ...tuning.structures,
    clash: { damage: 200, radius: 4 },
    cover: { health: 100 },
    crackedShare: 0.6,
    damage: {
      confringo: { full: 50, min: 10 },
      depulso: 30,
      expelliarmus: 2,
      incendio: 55,
      petrificus: 5,
      stupefy: 4,
      stupefyStrong: 8,
    },
    obstruction: { health: 140 },
  },
};

/** One column of Cover halfway between the Duelists, who stand 10 m apart along z. */
const column = { center: { x: 0, z: 0 }, radius: 0.6 };

const columnArena: ArenaLayout = {
  bounds: { halfDepth: 10, halfWidth: 10 },
  cover: [column],
  obstructions: [],
};

/** The fountain (an Obstruction, low enough to cast over) between the Duelists. */
const fountainArena: ArenaLayout = {
  bounds: { halfDepth: 10, halfWidth: 10 },
  cover: [],
  obstructions: [{ center: { x: 0, z: 0 }, radius: 1.6 }],
};

const intent = (overrides: Partial<Intent>): Intent => ({
  ...idleIntent,
  ...overrides,
});

/**
 * A 1v1 past the Round intro: the hero at z = 5 and the rival at z = -5.
 * In a Practice (`focused`) the hero's Focus is kept full for Special Spells.
 */
const fight = (
  arena: ArenaLayout,
  { focused = false, settings = structural } = {}
): Duel => {
  const duel = createDuel({
    arena,
    duelists: [
      { id: "hero", spawn: { x: 0, z: 5 }, team: "gryffindor" },
      { id: "rival", spawn: { x: 0, z: -5 }, team: "slytherin" },
    ],
    practice: focused
      ? {
          learner: "hero",
          rivalsCastFree: false,
          rivalsTireless: false,
          setup: { focusShare: 1, healthShare: 1, kept: [] },
        }
      : undefined,
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

/** Lets every Spell in flight land. */
const settle = (duel: Duel): DuelEvent[] => run(duel, secondsToTicks(1.5));

const ofType = <T extends DuelEvent["type"]>(
  events: readonly DuelEvent[],
  type: T
) =>
  events.filter(
    (event): event is Extract<DuelEvent, { type: T }> => event.type === type
  );

/** One Stupefy from the hero, landed. */
const stupefy = (duel: Duel) => [
  ...run(duel, 1, { hero: intent({ lightSpell: true }) }),
  ...settle(duel),
];

/** A Confringo from the hero, held `seconds` before the release, landed. */
const confringo = (duel: Duel, seconds: number) => [
  ...run(duel, secondsToTicks(seconds), { hero: intent({ heavySpell: true }) }),
  ...settle(duel),
];

/** The Spell Slots as the tuning binds them: △ Incendio, ✕ Depulso. */
const castFromSlot = (duel: Duel, press: SpellSlot) => [
  ...run(duel, 1, {
    hero: intent({ spellSlots: { held: true, press } }),
  }),
  ...settle(duel),
];

const incendio = (duel: Duel) => castFromSlot(duel, "triangle");

const structure = (duel: Duel, id = 0): StructureState => {
  const found = duel.snapshot().structures.find((each) => each.id === id);

  if (!found) {
    throw new Error(`No structure ${id}`);
  }

  return found;
};

describe("a column of Cover", () => {
  it("starts intact at full structural health", () => {
    const duel = fight(columnArena);

    expect(structure(duel)).toMatchObject({
      center: column.center,
      health: 100,
      role: "cover",
      stage: "intact",
    });
  });

  it("is barely chipped by a Stupefy", () => {
    const duel = fight(columnArena);

    const events = stupefy(duel);

    expect(structure(duel)).toMatchObject({ health: 96, stage: "intact" });
    expect(ofType(events, "structure-hit")).toMatchObject([
      { before: "intact", cause: "stupefy", damage: 4, stage: "intact" },
    ]);
  });

  it("cracks once worn to its cracked share, and a full Confringo then an Incendio break it", () => {
    const duel = fight(columnArena, { focused: true });

    const first = confringo(duel, 0.5);

    expect(structure(duel)).toMatchObject({ health: 50, stage: "cracked" });
    expect(ofType(first, "structure-hit")).toMatchObject([
      { before: "intact", cause: "confringo", damage: 50, stage: "cracked" },
    ]);

    const second = incendio(duel);

    expect(structure(duel)).toMatchObject({ health: 0, stage: "destroyed" });
    expect(ofType(second, "structure-hit")).toMatchObject([
      { before: "cracked", cause: "incendio", damage: 50, stage: "destroyed" },
    ]);
  });

  it("once broken, stops no Spell: the next one flies on to the Duelist behind it", () => {
    const duel = fight(columnArena, { focused: true });
    confringo(duel, 0.5);
    incendio(duel);

    const events = stupefy(duel);

    expect(ofType(events, "structure-hit")).toStrictEqual([]);
    expect(ofType(events, "spell-hit")).toMatchObject([{ targetId: "rival" }]);
  });

  it("once broken, lies as low rubble: no longer Cover, still an Obstruction", () => {
    const duel = fight(columnArena, { focused: true });

    expect(duel.snapshot().arena).toMatchObject({
      cover: [column],
      obstructions: [],
    });

    confringo(duel, 0.5);
    incendio(duel);

    expect(duel.snapshot().arena).toMatchObject({
      cover: [],
      obstructions: [column],
    });
  });

  it("once broken, no longer hides the Duelist behind it from Lock-on", () => {
    const duel = fight(columnArena, { focused: true });
    const lockOn = { hero: intent({ lockOn: true }) };

    expect(ofType(run(duel, 1, lockOn), "lock-on")).toStrictEqual([]);

    run(duel, 1);
    confringo(duel, 0.5);
    incendio(duel);

    expect(ofType(run(duel, 1, lockOn), "lock-on")).toMatchObject([
      { duelistId: "hero", targetId: "rival" },
    ]);
  });

  it("is worn down by an Incendio exploding on the floor beside it", () => {
    const beside: ArenaLayout = {
      ...columnArena,
      cover: [{ center: { x: 1.5, z: -5 }, radius: 0.6 }],
    };

    const duel = fight(beside, { focused: true });

    // Look at the floor at the rival's feet, an arm's length from the column.
    run(duel, secondsToTicks(1), {
      hero: intent({ look: { pitch: -0.12, yaw: 0 } }),
    });
    const events = incendio(duel);

    expect(ofType(events, "structure-hit")).toMatchObject([
      { cause: "incendio", damage: 55, structureId: 0 },
    ]);
  });

  it("is worn down by Depulso's cone", () => {
    const close: ArenaLayout = {
      ...columnArena,
      cover: [{ center: { x: 0, z: 2.5 }, radius: 0.6 }],
    };

    const duel = fight(close, { focused: true });

    const events = castFromSlot(duel, "cross");

    expect(ofType(events, "structure-hit")).toMatchObject([
      { cause: "depulso", damage: 30, structureId: 0 },
    ]);
  });
});

describe("the fountain", () => {
  it("starts intact at its own, sturdier structural health", () => {
    const duel = fight(fountainArena);

    expect(structure(duel)).toMatchObject({
      health: 140,
      role: "obstruction",
      stage: "intact",
    });
  });

  it("lets Spells fly over it untouched", () => {
    const duel = fight(fountainArena);

    const events = stupefy(duel);

    expect(ofType(events, "structure-hit")).toStrictEqual([]);
    expect(ofType(events, "spell-hit")).toMatchObject([{ targetId: "rival" }]);
  });

  it("is chipped by a Spell cast down into it", () => {
    const duel = fight(fountainArena);
    run(duel, secondsToTicks(1), {
      hero: intent({ look: { pitch: -0.4, yaw: 0 } }),
    });

    const events = stupefy(duel);

    expect(ofType(events, "structure-hit")).toMatchObject([
      { cause: "stupefy", damage: 4, stage: "intact" },
    ]);
  });

  it("is broken by a Clash blowing up beside it", () => {
    const duel = fight(fountainArena);

    for (let tick = 0; tick <= secondsToTicks(0.5); tick += 1) {
      const held = tick < secondsToTicks(0.5);
      const charge = intent({ heavySpell: held });
      duel.step({ hero: charge, rival: charge });
    }

    run(duel, secondsToTicks(1));
    expect(duel.snapshot().clash).not.toBeNull();

    const events = run(duel, secondsToTicks(tuning.clash.seconds));

    expect(ofType(events, "structure-hit")).toMatchObject([
      { before: "intact", cause: "clash", damage: 140, stage: "destroyed" },
    ]);
  });
});

describe("destruction", () => {
  /** Columns break to one Stupefy, and Duelists go down to one. */
  const fragile: Tuning = {
    ...structural,
    duelist: { ...structural.duelist, health: 4 },
    structures: { ...structural.structures, cover: { health: 4 } },
  };

  it("lasts the whole Duel: the next Round is fought in the ruins", () => {
    const duel = fight(columnArena, { settings: fragile });
    stupefy(duel);
    stupefy(duel);
    expect(duel.snapshot().round.phase).not.toBe("fighting");

    while (duel.snapshot().round.number === 1) {
      run(duel, 1);
    }

    expect(structure(duel)).toMatchObject({ health: 0, stage: "destroyed" });
    expect(duel.snapshot().arena.cover).toStrictEqual([]);
  });

  it("is rebuilt for a new Duel", () => {
    const duel = fight(columnArena, { settings: fragile });
    stupefy(duel);
    expect(structure(duel).stage).toBe("destroyed");

    const next = fight(columnArena, { settings: fragile });

    expect(structure(next)).toMatchObject({ health: 4, stage: "intact" });
  });
});
