/**
 * Maniquí que lanza hechizos through the Duel seam: an idle player, a rival
 * expected to cast its Light Spell on an unbroken beat, in a Practice
 * against it.
 */
import { describe, expect, it } from "vitest";

import { createDuel } from "../duel/duel";
import { practiceRulesFor } from "../duel/practice";
import { tuning } from "../tuning";
import { createCasterDummy } from "./caster-dummy";

const ticksOf = (seconds: number) => Math.round(seconds * tuning.tickRate);

/** The ticks of the fight on which the rival's Light Spells left its Wand over `seconds`. */
const castTicks = (seconds: number) => {
  const duel = createDuel({
    arena: {
      bounds: { halfDepth: 10, halfWidth: 10 },
      cover: [],
      obstructions: [],
    },
    duelists: [
      { id: "player", spawn: { x: 0, z: 5 }, team: "near" },
      { id: "rival", spawn: { x: 0, z: -5 }, team: "far" },
    ],
    practice: practiceRulesFor("casts", "player"),
    tuning,
  });

  const rival = createCasterDummy(
    ticksOf(tuning.practice.dummies.castInterval)
  );

  while (duel.snapshot().round.phase === "intro") {
    duel.step({});
  }

  const ticks: number[] = [];

  for (let tick = 0; tick < ticksOf(seconds); tick += 1) {
    const { events } = duel.step({
      rival: rival.intent({ self: "rival", snapshot: duel.snapshot() }),
    });

    if (
      events.some(
        (event) =>
          event.type === "spell-cast" &&
          event.spell.casterId === "rival" &&
          event.spell.kind === "stupefy"
      )
    ) {
      ticks.push(tick);
    }
  }

  return ticks;
};

describe("Maniquí que lanza hechizos", () => {
  it("keeps its exact beat for 30 seconds, never short of Stamina", () => {
    const interval = ticksOf(tuning.practice.dummies.castInterval);
    const ticks = castTicks(30);

    const first = ticks[0] ?? 0;

    expect(ticks).toHaveLength(Math.floor(ticksOf(30) / interval));
    expect(ticks).toStrictEqual(
      ticks.map((_, index) => first + index * interval)
    );
  });
});
