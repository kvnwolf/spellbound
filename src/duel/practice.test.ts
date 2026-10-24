/**
 * Practice rules through the Duel seam: a Duel created with `practice` set,
 * stepped with Intents, read back from its snapshots and events.
 */
import { describe, expect, it } from "vitest";

import { tuning } from "../tuning";
import type { Tuning } from "../tuning";
import { createDuel } from "./duel";
import type { Duel, DuelEvent, DuelistState } from "./duel";
import { idleIntent } from "./intent";
import type { Intent } from "./intent";
import { practiceRulesFor } from "./practice";
import type { PracticeRival } from "./practice";
import { boundTo, spellSlots } from "./spell-slots";

const ticksOf = (seconds: number) => Math.round(seconds * tuning.tickRate);

/** Every Duelist down to the last point of Health: one Stupefy empties it. */
const fragile: Tuning = {
  ...tuning,
  duelist: { ...tuning.duelist, health: 1 },
};

/** A 1v1 ten metres apart, each facing the other: a Practice against `rival`, or a plain Duel. */
const create = (rival: PracticeRival | null, settings: Tuning = tuning): Duel =>
  createDuel({
    arena: {
      bounds: { halfDepth: 10, halfWidth: 10 },
      cover: [],
      obstructions: [],
    },
    duelists: [
      { id: "learner", spawn: { x: 0, z: 5 }, team: "near" },
      { id: "rival", spawn: { x: 0, z: -5 }, team: "far" },
    ],
    practice: rival === null ? undefined : practiceRulesFor(rival, "learner"),
    tuning: settings,
  });

const intent = (overrides: Partial<Intent>): Intent => ({
  ...idleIntent,
  ...overrides,
});

const expelliarmusSlot =
  spellSlots.find((slot) => boundTo(slot, tuning) === "expelliarmus") ??
  "circle";

const castExpelliarmus = intent({
  spellSlots: { held: true, press: expelliarmusSlot },
});

/** Steps `ticks` ticks with these Intents; every tick's snapshot and all the events. */
const run = (
  duel: Duel,
  ticks: number,
  intents: (tick: number) => Readonly<Record<string, Intent>> = () => ({})
) => {
  const snapshots = [];
  const events: DuelEvent[] = [];

  for (let tick = 0; tick < ticks; tick += 1) {
    const result = duel.step(intents(tick));
    snapshots.push(result.snapshot);
    events.push(...result.events);
  }

  return { events, snapshots };
};

/** `id` presses on even ticks and lets go on odd ones: a press every other tick. */
const tapping = (id: string, pressed: Intent) => (tick: number) => ({
  [id]: tick % 2 === 0 ? pressed : idleIntent,
});

const learnerOf = (duel: Duel): DuelistState => {
  const found = duel.snapshot().duelists.find((each) => each.id === "learner");

  if (!found) {
    throw new Error("No learner");
  }

  return found;
};

const rivalOf = (duel: Duel): DuelistState => {
  const found = duel.snapshot().duelists.find((each) => each.id === "rival");

  if (!found) {
    throw new Error("No rival");
  }

  return found;
};

const castLight = intent({ lightSpell: true });

/** The Spells cast in `events`, as `caster:kind`. */
const casts = (events: readonly DuelEvent[]) =>
  events.flatMap((event) =>
    event.type === "spell-cast"
      ? [`${event.spell.casterId}:${event.spell.kind}`]
      : []
  );

/**
 * The learner's first Stupefy empties a fragile rival's Health; then both
 * press every other tick for as long as the rival should stay down. Its
 * Health is back on the last of its recovery ticks (as above), and it
 * then spends `getUpSeconds` getting up.
 */
const knockDown = () => {
  const duel = create("casts", fragile);
  const recoveryTicks = ticksOf(tuning.practice.recoverySeconds);
  const getUpTicks = ticksOf(tuning.practice.getUpSeconds);

  const opening = run(duel, ticksOf(1), (tick) => ({
    learner: tick === 0 ? castLight : idleIntent,
  }));

  const zeroAt = opening.snapshots.findIndex(
    (snapshot) =>
      snapshot.duelists.find((each) => each.id === "rival")?.health === 0
  );

  if (zeroAt === -1) {
    throw new Error("The rival never reached zero Health");
  }

  const downTicks = recoveryTicks - 1 + getUpTicks;

  const down = run(
    duel,
    downTicks - (opening.snapshots.length - zeroAt),
    (tick) => ({
      ...tapping("learner", castLight)(tick),
      ...tapping("rival", castLight)(tick),
    })
  );

  const rival = [...opening.snapshots.slice(zeroAt), ...down.snapshots]
    .map((snapshot) => snapshot.duelists.find((each) => each.id === "rival"))
    .map((each) => ({
      down: (each?.downSeconds ?? 0) > 0,
      health: each?.health,
    }));

  return { down, duel, recoveryTicks, rival };
};

describe("Practice", () => {
  it("is fought from the first tick, with no Round intro", () => {
    const duel = create("idle");

    expect(duel.snapshot().round.phase).toBe("fighting");
    expect(run(duel, 1, () => ({ learner: castLight })).events).toContainEqual(
      expect.objectContaining({ type: "spell-cast" })
    );
  });

  it("never Knocks the rival Out nor ends the Round: its Health comes back after the recovery delay", () => {
    const duel = create("idle", fragile);
    const { events } = run(duel, ticksOf(1), tapping("learner", castLight));

    expect(events).toContainEqual(
      expect.objectContaining({ targetId: "rival", type: "spell-hit" })
    );
    expect(
      events.filter(
        (event) => event.type === "knockout" || event.type === "round-end"
      )
    ).toStrictEqual([]);
    expect(rivalOf(duel)).toMatchObject({ health: 0, knockedOut: false });
    expect(duel.snapshot().round.phase).toBe("fighting");

    // Hit at some point in that second: it is back within the delay after it.
    run(duel, ticksOf(tuning.practice.recoverySeconds));

    expect(rivalOf(duel).health).toBe(fragile.duelist.health);
  });

  it("keeps the rival at zero Health until the recovery delay has passed", () => {
    const duel = create("idle", fragile);

    const hits = run(duel, ticksOf(1), (tick) => ({
      learner: tick === 0 ? castLight : idleIntent,
    }));

    const zeroAt = hits.snapshots.findIndex(
      (snapshot) =>
        snapshot.duelists.find((each) => each.id === "rival")?.health === 0
    );

    expect(zeroAt).toBeGreaterThanOrEqual(0);

    const after = run(duel, ticksOf(tuning.practice.recoverySeconds));

    const healths = [...hits.snapshots.slice(zeroAt), ...after.snapshots].map(
      (snapshot) =>
        snapshot.duelists.find((each) => each.id === "rival")?.health
    );

    const backAt = healths.indexOf(fragile.duelist.health);

    expect(backAt).toBe(ticksOf(tuning.practice.recoverySeconds) - 1);
  });

  it("puts the rival down at zero Health: it neither acts nor is hit until it has got back up", () => {
    const { down, recoveryTicks, rival } = knockDown();

    expect(rival.every((each) => each.down)).toBeTruthy();
    // Its Health comes back as before, and it then spends the get-up down.
    expect(rival[recoveryTicks - 1]).toStrictEqual({
      down: true,
      health: fragile.duelist.health,
    });
    expect(casts(down.events)).not.toContain("rival:stupefy");
    expect(down.events).not.toContainEqual(
      expect.objectContaining({ targetId: "rival", type: "spell-hit" })
    );
  });

  it("has the rival back on its feet the tick after it has got up: it casts and is hit again", () => {
    const { duel } = knockDown();

    const up = run(duel, ticksOf(1), (tick) => ({
      learner: tick === 1 ? castLight : idleIntent,
      rival: tick === 1 ? castLight : idleIntent,
    }));

    expect(
      up.snapshots[0]?.duelists.find((each) => each.id === "rival")?.downSeconds
    ).toBe(0);
    expect(casts(up.events)).toContain("rival:stupefy");
    expect(up.events).toContainEqual(
      expect.objectContaining({ targetId: "rival", type: "spell-hit" })
    );
  });

  it("never puts anyone down in a Duel", () => {
    const duel = create(null, fragile);
    const { snapshots } = run(duel, ticksOf(4), tapping("learner", castLight));

    expect(
      snapshots.flatMap((snapshot) =>
        snapshot.duelists.filter((each) => each.downSeconds > 0)
      )
    ).toStrictEqual([]);
  });

  it("never lets the learner's Health run out: no Knockout, back full at once", () => {
    const duel = create("casts", fragile);

    const { events, snapshots } = run(
      duel,
      ticksOf(1),
      tapping("rival", castLight)
    );

    expect(events).toContainEqual(
      expect.objectContaining({ targetId: "learner", type: "spell-hit" })
    );
    expect(events.map((event) => event.type)).not.toContain("knockout");
    expect(
      snapshots.map(
        (snapshot) =>
          snapshot.duelists.find((each) => each.id === "learner")?.health
      )
    ).not.toContain(0);
  });

  it("refills the learner's Health once it has not dropped for the refill delay", () => {
    const duel = create("casts");

    run(duel, 1, () => ({ rival: castLight }));
    run(duel, ticksOf(1), () => ({}));

    const hurt = learnerOf(duel).health;

    expect(hurt).toBeLessThan(tuning.duelist.health);

    run(duel, ticksOf(tuning.practice.refillSeconds));

    expect(learnerOf(duel).health).toBe(tuning.duelist.health);
  });

  it("never lets the learner's Stamina run out behind a long Shield, where a Duel would", () => {
    const shield = intent({ shield: true });

    const long = ticksOf(
      (tuning.defence.stamina.max / tuning.defence.shield.drain) * 2
    );

    const stamina = (rival: PracticeRival | null) => {
      const duel = create(rival);

      // A Duel's Round intro plays out first; a Practice has none.
      while (duel.snapshot().round.phase === "intro") {
        duel.step({});
      }

      return run(duel, long, () => ({ learner: shield })).snapshots.map(
        (snapshot) =>
          snapshot.duelists.find((each) => each.id === "learner")?.stamina ?? 0
      );
    };

    expect(Math.min(...stamina(null))).toBe(0);
    expect(Math.min(...stamina("idle"))).toBeGreaterThan(0);
  });

  it("fills the learner's empty Focus after the refill delay", () => {
    const duel = create("idle");

    expect(learnerOf(duel).focus).toBe(0);

    run(duel, ticksOf(tuning.practice.refillSeconds));

    expect(learnerOf(duel).focus).toBe(tuning.focus.max);
  });

  it("still charges the learner Focus and Cooldown for a Special Spell", () => {
    const duel = create("idle");

    // Too early: the Focus is not there yet, so nothing is cast.
    expect(
      casts(run(duel, 1, () => ({ learner: castExpelliarmus })).events)
    ).toStrictEqual([]);

    run(duel, ticksOf(tuning.practice.refillSeconds));

    expect(
      casts(run(duel, 2, tapping("learner", castExpelliarmus)).events)
    ).toStrictEqual(["learner:expelliarmus"]);
    expect(learnerOf(duel).focus).toBe(0);
    expect(learnerOf(duel).cooldowns.expelliarmus).toBeGreaterThan(0);
  });

  it("brings the learner's spent Focus back while the Cooldown still runs", () => {
    const duel = create("idle");

    run(duel, ticksOf(tuning.practice.refillSeconds));
    run(duel, 2, tapping("learner", castExpelliarmus));
    run(duel, ticksOf(tuning.practice.refillSeconds));

    expect(learnerOf(duel).focus).toBe(tuning.focus.max);
    expect(
      casts(run(duel, 2, tapping("learner", castExpelliarmus)).events)
    ).toStrictEqual([]);
  });

  it("lets Maniquí desarmador cast Expelliarmus free of Focus and Cooldown, but not the learner", () => {
    const duel = create("disarms");
    const both = { learner: castExpelliarmus, rival: castExpelliarmus };

    expect(casts(run(duel, 1, () => both).events)).toStrictEqual([
      "rival:expelliarmus",
    ]);
    expect(rivalOf(duel).cooldowns.expelliarmus).toBe(0);

    run(duel, 1);

    expect(
      casts(run(duel, 1, () => ({ rival: castExpelliarmus })).events)
    ).toStrictEqual(["rival:expelliarmus"]);
  });

  it("charges every other rival as usual", () => {
    const duel = create("ai");

    expect(
      casts(run(duel, 1, () => ({ rival: castExpelliarmus })).events)
    ).toStrictEqual([]);
  });
});
