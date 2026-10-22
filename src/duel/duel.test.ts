import { describe, expect, it } from "vitest";

import { tuning } from "../tuning";
import { createDuel } from "./duel";
import type { ArenaLayout, Duel, DuelistState } from "./duel";
import type { Intent } from "./intent";

const openArena: ArenaLayout = {
  bounds: { halfDepth: 10, halfWidth: 10 },
  cover: [],
};

/** A 1v1 with the hero facing the rival 10 m away along -z. */
const createOneVsOne = (arena: ArenaLayout = openArena): Duel =>
  createDuel({
    arena,
    duelists: [
      { id: "hero", spawn: { x: 0, z: 5 }, team: "gryffindor" },
      { id: "rival", spawn: { x: 0, z: -5 }, team: "slytherin" },
    ],
    tuning,
  });

const intent = (overrides: Partial<Intent>): Intent => ({
  aim: { x: 0, y: 0 },
  move: { x: 0, y: 0 },
  ...overrides,
});

/** Steps the Duel for `seconds` with the hero holding `heroIntent` and the rival idle. */
const hold = (duel: Duel, heroIntent: Intent, seconds: number) => {
  const ticks = Math.round(seconds * tuning.tickRate);

  for (let tick = 0; tick < ticks; tick += 1) {
    duel.step({ hero: heroIntent });
  }

  return duel.snapshot();
};

const duelist = (duel: Duel, id: string): DuelistState => {
  const found = duel.snapshot().duelists.find((each) => each.id === id);

  if (!found) {
    throw new Error(`No Duelist ${id}`);
  }

  return found;
};

describe("Duel ticks", () => {
  it("advances the tick count and reports no events while Duelists only move", () => {
    const duel = createOneVsOne();

    const { snapshot, events } = duel.step({
      hero: intent({ move: { x: 1, y: 1 } }),
    });

    expect(snapshot.tick).toBe(1);
    expect(events).toStrictEqual([]);
  });
});

describe("Duel movement", () => {
  it("walks the Duelist toward its Target at walk speed when the stick is pushed forward", () => {
    const duel = createOneVsOne();

    hold(duel, intent({ move: { x: 0, y: 1 } }), 1);

    expect(duelist(duel, "hero").position.x).toBeCloseTo(0);
    expect(duelist(duel, "hero").position.z).toBeCloseTo(
      5 - tuning.duelist.walkSpeed
    );
  });

  it("circles the Target at a constant distance when strafing right", () => {
    const duel = createOneVsOne();

    hold(duel, intent({ move: { x: 1, y: 0 } }), 1);

    const { position } = duelist(duel, "hero");
    expect(position.x).toBeGreaterThan(3);
    expect(Math.hypot(position.x, position.z + 5)).toBeCloseTo(10);
  });
});

describe("Duel collision", () => {
  it("stops the Duelist at the Arena bounds", () => {
    const duel = createOneVsOne();

    hold(duel, intent({ move: { x: 0, y: -1 } }), 3);

    expect(duelist(duel, "hero").position).toStrictEqual({
      x: 0,
      z: 10 - tuning.duelist.bodyRadius,
    });
  });

  it("stops the Duelist against a column of Cover standing in the way", () => {
    const duel = createOneVsOne({
      ...openArena,
      cover: [{ center: { x: 0, z: 0 }, radius: 1 }],
    });

    hold(duel, intent({ move: { x: 0, y: 1 } }), 2);

    const { position } = duelist(duel, "hero");
    expect(position.x).toBeCloseTo(0);
    expect(position.z).toBeCloseTo(1 + tuning.duelist.bodyRadius);
  });

  it("slides the Duelist around a column it walks into off-centre", () => {
    const duel = createOneVsOne({
      ...openArena,
      cover: [{ center: { x: 0.3, z: 0 }, radius: 1 }],
    });

    hold(duel, intent({ move: { x: 0, y: 1 } }), 3);

    expect(duelist(duel, "hero").position.z).toBeLessThan(0);
  });

  it("does not let a Duelist walk through another Duelist", () => {
    const duel = createOneVsOne();

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
    const duel = createOneVsOne();

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
    const duel = createOneVsOne();

    hold(duel, intent({}), 0.1);

    expect(duelist(duel, "hero").aimPoint).toStrictEqual({
      x: 0,
      y: tuning.duelist.chestHeight,
      z: -5,
    });
  });

  it("nudges the aim point right of and above the Target with the right stick", () => {
    const duel = createOneVsOne();

    hold(duel, intent({ aim: { x: 1, y: 1 } }), 0.1);

    const { aimPoint } = duelist(duel, "hero");
    expect(aimPoint.x).toBeCloseTo(tuning.aim.maxHorizontalOffset);
    expect(aimPoint.y).toBeCloseTo(
      tuning.duelist.chestHeight + tuning.aim.maxVerticalOffset
    );
    expect(aimPoint.z).toBeCloseTo(-5);
  });
});
