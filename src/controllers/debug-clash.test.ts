/**
 * The debug Clash rival through the Duel seam: a scripted player Charges and
 * releases a Confringo, and the rival is expected to mirror it into a Clash.
 */
import { describe, expect, it } from "vitest";

import { createDuel } from "../duel/duel";
import type { DuelEvent, DuelSnapshot } from "../duel/duel";
import { idleIntent } from "../duel/intent";
import type { Intent } from "../duel/intent";
import { tuning } from "../tuning";
import { createDebugClashController } from "./debug-clash";

const ticksOf = (seconds: number) => Math.round(seconds * tuning.tickRate);

const rivalController = () =>
  createDebugClashController({
    fullSeconds: tuning.confringo.fullSeconds,
    holdPastFullTicks: ticksOf(tuning.debug.rivalClashHoldPastFull),
    pumpEveryTicks: ticksOf(1 / tuning.debug.rivalClashPumpRate),
  });

/**
 * The player holds the Heavy Spell for `holdSeconds` (after `idleTicks`
 * of nothing, so the rival has locked on), then pumps every tick pair if
 * `pump`; runs `seconds` in all. Returns each tick's events.
 */
const play = ({
  holdSeconds,
  pump = false,
  seconds,
}: {
  readonly holdSeconds: number;
  readonly pump?: boolean;
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
    tuning,
  });

  while (duel.snapshot().round.phase === "intro") {
    duel.step({});
  }

  const rival = rivalController();
  const idleTicks = ticksOf(0.3);
  const heldTicks = ticksOf(holdSeconds);

  const perTick: {
    events: readonly DuelEvent[];
    snapshot: DuelSnapshot;
  }[] = [];

  for (let tick = 0; tick < ticksOf(seconds); tick += 1) {
    const holding = tick >= idleTicks && tick < idleTicks + heldTicks;

    const player: Intent = {
      ...idleIntent,
      clashPump: pump && tick % 4 === 0,
      heavySpell: holding,
      lockOn: tick === 0,
    };

    const snapshot = duel.snapshot();

    const result = duel.step({
      player,
      rival: rival.intent({ self: "rival", snapshot }),
    });

    perTick.push({ events: result.events, snapshot: result.snapshot });
  }

  return perTick;
};

const tickOfCast = (
  perTick: readonly { events: readonly DuelEvent[] }[],
  caster: string
) =>
  perTick.findIndex(({ events }) =>
    events.some(
      (event) => event.type === "spell-cast" && event.spell.casterId === caster
    )
  );

describe("the Clash debug rival", () => {
  it("releases a full Charge as the player releases theirs, and the two Clash", () => {
    const perTick = play({ holdSeconds: 0.5, seconds: 2 });

    const player = tickOfCast(perTick, "player");
    const rival = tickOfCast(perTick, "rival");

    expect(player).toBeGreaterThan(-1);
    expect(rival).toBeGreaterThanOrEqual(player);
    expect(rival - player).toBeLessThanOrEqual(3);

    const clashStarts = perTick.flatMap(({ events }) =>
      events.filter((event) => event.type === "clash-start")
    );

    expect(clashStarts).toHaveLength(1);
  });

  it("releases short of a Backfire when the player overcharges, and never Backfires", () => {
    const perTick = play({ holdSeconds: 0.55, seconds: 2 });

    const rival = tickOfCast(perTick, "rival");
    const events = perTick.flatMap((each) => each.events);

    expect(rival).toBeGreaterThan(-1);
    expect(events.some((event) => event.type === "backfire")).toBeFalsy();
  });

  it("pumps the Clash it is in at a steady rate", () => {
    const perTick = play({ holdSeconds: 0.5, seconds: 3 });

    const pumps = perTick.flatMap(({ events }) =>
      events.filter(
        (event) => event.type === "clash-pump" && event.duelistId === "rival"
      )
    );

    expect(pumps.length).toBeGreaterThanOrEqual(3);
  });
});
