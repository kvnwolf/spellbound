/**
 * Crouching through the Duel seam: L3 crouches (or stands back up). Same
 * seam as
 * `duel.test.ts`: drive `createDuel` with Intents, assert snapshots and events.
 */
import { describe, expect, it } from "vitest";

import { tuning } from "../tuning";
import { createDuel } from "./duel";
import type { ArenaLayout, Duel, DuelEvent, DuelistState } from "./duel";
import { idleIntent } from "./intent";
import type { Intent } from "./intent";
import { plainSetup } from "./practice";
import { boundTo, spellSlots } from "./spell-slots";

const openArena: ArenaLayout = {
  bounds: { halfDepth: 20, halfWidth: 20 },
  cover: [],
  obstructions: [],
};

const { crouch, sprint } = tuning.defence;

const secondsToTicks = (seconds: number) =>
  Math.round(seconds * tuning.tickRate);

const intent = (overrides: Partial<Intent>): Intent => ({
  ...idleIntent,
  ...overrides,
});

/** A 1v1 with the hero facing the rival `apart` metres away along -z, past the Round intro. */
const fight = (apart = 10): Duel => {
  const duel = createDuel({
    arena: openArena,
    duelists: [
      { id: "hero", spawn: { x: 0, z: apart / 2 }, team: "gryffindor" },
      { id: "rival", spawn: { x: 0, z: -apart / 2 }, team: "slytherin" },
    ],
    tuning,
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

/** Holds `held` as `who` for one tick, then lets go for a tick: a press. */
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

/** Metres walked along z over `ticks` with the stick pushed forward, and anything else held. */
const walked = (duel: Duel, ticks: number, also: Partial<Intent> = {}) => {
  const from = duelist(duel, "hero").position.z;
  run(duel, ticks, { hero: intent({ move: { x: 0, y: 1 }, ...also }) });

  return Math.abs(duelist(duel, "hero").position.z - from);
};

/**
 * The rival, Locked On to the hero `apart` metres away, casts a Stupefy at
 * them; the hero presses L3 `crouchAfter` seconds after the cast (never,
 * if undefined; before it, if negative). Returns every event until it has
 * long arrived.
 */
const stupefyAtCrouch = (apart: number, crouchAfter?: number) => {
  const duel = fight(apart);
  tap(duel, { lockOn: true }, "rival");

  if (crouchAfter !== undefined && crouchAfter < 0) {
    tap(duel, { crouch: true });
    run(duel, secondsToTicks(-crouchAfter));
  }

  const events = run(duel, 1, { rival: intent({ lightSpell: true }) });

  for (let tick = 1; tick < secondsToTicks(1.5); tick += 1) {
    const now = tick / tuning.tickRate;

    const crouching =
      crouchAfter !== undefined &&
      crouchAfter >= 0 &&
      now >= crouchAfter &&
      now < crouchAfter + 2 / tuning.tickRate;

    events.push(...run(duel, 1, { hero: intent({ crouch: crouching }) }));
  }

  return events;
};

/** Whether the hero, crouched and walking, is still crouched after a tick of also holding `held`. */
const crouchedAfter = (held: Partial<Intent>) => {
  const duel = fight();
  tap(duel, { crouch: true });
  run(duel, 1, { hero: intent({ move: { x: 1, y: 0 }, ...held }) });

  return duelist(duel, "hero").crouching;
};

describe("Crouch", () => {
  it("crouches on L3, lowering the body, for no Stamina", () => {
    const duel = fight();

    tap(duel, { crouch: true });
    run(duel, secondsToTicks(0.5));

    expect(duelist(duel, "hero")).toMatchObject({
      crouching: true,
      height: crouch.height,
      stamina: tuning.defence.stamina.max,
    });
  });

  it("walks slower crouched, and stands back up on L3 again", () => {
    const standing = walked(fight(), secondsToTicks(1));
    const duel = fight();
    tap(duel, { crouch: true });
    const low = walked(duel, secondsToTicks(1));

    tap(duel, { crouch: true });
    run(duel, secondsToTicks(0.5));

    expect(low / standing).toBeCloseTo(crouch.walkScale, 1);
    expect(duelist(duel, "hero")).toMatchObject({
      crouching: false,
      height: tuning.duelist.height,
    });
  });

  it("stays crouched walking", () => {
    expect(crouchedAfter({})).toBeTruthy();
  });

  it.each([
    ["run", { sprint: true }],
    ["jump", { jump: true }],
    ["Dodge", { dodge: true }],
    ["Shield", { shield: true }],
    ["cast", { lightSpell: true }],
    ["Charge", { heavySpell: true }],
  ] as const)("stands up to %s", (_name, held) => {
    expect(crouchedAfter(held)).toBeFalsy();
  });
});

describe("A chest-high Spell and a crouch", () => {
  it("lands on a Duelist who stays standing", () => {
    const events = stupefyAtCrouch(20);

    expect(ofType(events, "spell-hit")).toHaveLength(1);
  });

  it("flies over a Duelist who crouched once its homing was over, reported as ducked", () => {
    const after = tuning.lockOn.homing.seconds + 0.05;
    const events = stupefyAtCrouch(20, after);

    expect(ofType(events, "spell-hit")).toStrictEqual([]);
    expect(
      ofType(events, "ducked").map(({ duelistId, spell }) => ({
        duelistId,
        kind: spell.kind,
      }))
    ).toStrictEqual([{ duelistId: "hero", kind: "stupefy" }]);
  });

  it("still finds a Duelist who crouched while it was homing, from far enough away", () => {
    const events = stupefyAtCrouch(20, 0.05);

    expect(ofType(events, "spell-hit")).toHaveLength(1);
    expect(ofType(events, "ducked")).toStrictEqual([]);
  });

  it("lands on a Duelist already crouched when it was cast: Lock-on aims at the lowered chest", () => {
    const events = stupefyAtCrouch(20, -0.5);

    expect(ofType(events, "spell-hit")).toHaveLength(1);
  });

  it("lands on a Duelist who crouched too late, the body still going down", () => {
    const flight = 20 / tuning.stupefy.speed;
    const events = stupefyAtCrouch(20, flight - 0.05);

    expect(ofType(events, "spell-hit")).toHaveLength(1);
  });
});

/**
 * A Practice in which the rival casts Special Spells free, `apart` metres
 * from the hero, both facing each other: for Depulso's cone on a low body.
 */
const practice = (apart: number): Duel =>
  createDuel({
    arena: openArena,
    duelists: [
      { id: "hero", spawn: { x: 0, z: apart / 2 }, team: "gryffindor" },
      { id: "rival", spawn: { x: 0, z: -apart / 2 }, team: "slytherin" },
    ],
    practice: {
      learner: "hero",
      rivalsCastFree: true,
      rivalsTireless: true,
      setup: plainSetup,
    },
    tuning,
  });

const depulsoSlot =
  spellSlots.find((slot) => boundTo(slot, tuning) === "depulso") ?? "cross";

const castDepulso = (duel: Duel) =>
  tap(duel, { spellSlots: { held: true, press: depulsoSlot } }, "rival");

describe("Low and area hits", () => {
  it("Depulso's cone still catches a crouching Duelist", () => {
    const duel = practice(3);
    tap(duel, { crouch: true });
    run(duel, secondsToTicks(0.3));

    const events = castDepulso(duel);

    expect(
      ofType(events, "spell-hit").map(({ spell, targetId }) => ({
        kind: spell.kind,
        targetId,
      }))
    ).toStrictEqual([{ kind: "depulso", targetId: "hero" }]);
  });
});

/** The hero running forward (toward the rival, -z), R1 held. */
const running = { move: { x: 0, y: 1 }, sprint: true };

describe("L3 while running", () => {
  it("crouches and ends the run, until R1 is pressed again", () => {
    const duel = fight(30);
    run(duel, secondsToTicks(0.6), { hero: intent(running) });
    const before = duelist(duel, "hero").stamina;

    run(duel, 1, { hero: intent({ ...running, crouch: true }) });
    // R1 still held: crouched, walking, not running.
    run(duel, secondsToTicks(0.5), { hero: intent(running) });

    expect(duelist(duel, "hero")).toMatchObject({
      crouching: true,
      height: crouch.height,
      sprinting: false,
    });
    expect(before - duelist(duel, "hero").stamina).toBeLessThan(
      sprint.drain * 0.1
    );
  });
});
