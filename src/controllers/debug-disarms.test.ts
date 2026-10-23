/**
 * The debug Disarm rival through the Duel seam: an idle player, a rival
 * expected to Disarm them on its beat and to wait while their Wand is loose.
 */
import { describe, expect, it } from "vitest";

import { createDuel } from "../duel/duel";
import type { DuelEvent } from "../duel/duel";
import { tuning } from "../tuning";
import type { Tuning } from "../tuning";
import { createDebugDisarmsController } from "./debug-disarms";

const ticksOf = (seconds: number) => Math.round(seconds * tuning.tickRate);

/** Expelliarmus free of Focus and Cooldown, as `?rival=disarms` makes it. */
const freeCasts: Tuning = {
  ...tuning,
  expelliarmus: { ...tuning.expelliarmus, cooldownSeconds: 0, segments: 0 },
};

/** Runs an idle player against the rival for `seconds`; each tick's events. */
const play = ({
  firstCastSeconds,
  intervalSeconds,
  seconds,
}: {
  readonly firstCastSeconds: number;
  readonly intervalSeconds: number;
  readonly seconds: number;
}) => {
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
    tuning: freeCasts,
  });

  const rival = createDebugDisarmsController({
    firstCastTicks: ticksOf(firstCastSeconds),
    intervalTicks: ticksOf(intervalSeconds),
    spellSlots: tuning,
  });

  const perTick: {
    events: readonly DuelEvent[];
    looseWand: boolean;
  }[] = [];

  while (duel.snapshot().round.phase === "intro") {
    duel.step({});
  }

  for (let tick = 0; tick < ticksOf(seconds); tick += 1) {
    const result = duel.step({
      rival: rival.intent({ self: "rival", snapshot: duel.snapshot() }),
    });

    perTick.push({
      events: result.events,
      looseWand:
        result.snapshot.duelists.find((each) => each.id === "player")
          ?.looseWand !== null,
    });
  }

  return perTick;
};

const disarms = (perTick: readonly { events: readonly DuelEvent[] }[]) =>
  perTick.flatMap(({ events }) =>
    events.filter((event) => event.type === "disarm")
  );

const expelliarmusCasts = (
  perTick: readonly { events: readonly DuelEvent[] }[]
) =>
  perTick.flatMap(({ events }) =>
    events.filter(
      (event) =>
        event.type === "spell-cast" && event.spell.kind === "expelliarmus"
    )
  );

describe("the Disarm debug rival", () => {
  it("Disarms the player after the first delay", () => {
    const perTick = play({
      firstCastSeconds: 1,
      intervalSeconds: 8,
      seconds: 2,
    });

    expect(disarms(perTick)).toMatchObject([{ duelistId: "player" }]);
    expect(perTick.at(-1)?.looseWand).toBeTruthy();
  });

  it("does not cast while the player is Disarmed, and casts again once the Wand is home", () => {
    // A beat much shorter than the Wand's trip home: any cast in between
    // would show as a second Spell.
    const homeSeconds = tuning.expelliarmus.wand.returnSeconds;

    const whileDisarmed = play({
      firstCastSeconds: 1,
      intervalSeconds: 1,
      seconds: homeSeconds,
    });

    expect(expelliarmusCasts(whileDisarmed)).toHaveLength(1);

    const afterReturn = play({
      firstCastSeconds: 1,
      intervalSeconds: 1,
      seconds: homeSeconds + 3,
    });

    expect(disarms(afterReturn)).toHaveLength(2);
  });
});
