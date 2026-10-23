/**
 * Potions and the Potion Slots through the Duel seam: drive `createDuel`
 * with Intents, assert snapshots and events. Same seam as `specials.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { tuning } from "../tuning";
import type { Tuning } from "../tuning";
import { createDuel } from "./duel";
import type { ArenaLayout, Duel, DuelEvent, DuelistState } from "./duel";
import { idleIntent } from "./intent";
import type { Intent } from "./intent";
import type { PotionSlot } from "./potions";

const openArena: ArenaLayout = {
  bounds: { halfDepth: 10, halfWidth: 10 },
  cover: [],
  obstructions: [],
};

const { potions, stupefy } = tuning;

const secondsToTicks = (seconds: number) =>
  Math.round(seconds * tuning.tickRate);

const intent = (overrides: Partial<Intent>): Intent => ({
  ...idleIntent,
  ...overrides,
});

/** A 1v1 with the hero facing the rival 10 m away along -z, past the Round intro. */
const fight = (settings: Tuning = tuning): Duel => {
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

/** The Potion Slots as the tuning binds them: □ Wiggenweld, △ Strength, ○ Swiftness, ✕ empty. */
const toWiggenweld: PotionSlot = "square";
const toStrength: PotionSlot = "triangle";
const toSwiftness: PotionSlot = "circle";

/** L2 held this tick, with `press` the slot whose face button went down on it. */
const potionSlot = (press: PotionSlot | null, extra: Partial<Intent> = {}) =>
  intent({ ...extra, potionSlots: { held: true, press } });

/** Holds L2 and presses `press`'s face button for a tick, then lets go of both. */
const drinkFrom = (
  duel: Duel,
  press: PotionSlot,
  extra: Readonly<Record<string, Intent>> = {},
  who = "hero"
): DuelEvent[] => [
  ...run(duel, 1, { ...extra, [who]: potionSlot(press) }),
  ...run(duel, 1, extra),
];

/** Drinks from `press` and waits until the Potion is down. */
const drinkDown = (duel: Duel, press: PotionSlot, who = "hero") => [
  ...drinkFrom(duel, press, {}, who),
  ...run(duel, secondsToTicks(potions.drink.seconds)),
];

/** The rival lands `casts` Stupefies on the hero, one chain after another. */
const hurtHero = (duel: Duel, casts: number) => {
  for (let cast = 0; cast < casts; cast += 1) {
    tap(duel, { lightSpell: true }, "rival");
    run(duel, secondsToTicks(0.6));
  }

  // Let the last bolt land and any Stagger wear off.
  run(duel, secondsToTicks(1.5));
};

/** The damage of the hero's next lone (unchained) Stupefy on the rival. */
const loneStupefyDamage = (duel: Duel) => {
  run(duel, secondsToTicks(1));
  const events = [...tap(duel, { lightSpell: true }), ...run(duel, 40)];
  const [hit] = ofType(events, "spell-hit");

  return hit?.damage;
};

/** How far the hero walks sideways in half a second. */
const stride = (duel: Duel) => {
  const from = duelist(duel, "hero").position;
  run(duel, secondsToTicks(0.5), {
    hero: intent({ move: { x: 1, y: 0 } }),
  });
  const to = duelist(duel, "hero").position;

  return Math.hypot(to.x - from.x, to.z - from.z);
};

describe("Potions", () => {
  it("start each Round with 2 Wiggenweld, 1 Strength Potion and 1 Swiftness Potion, nothing drunk and nothing active", () => {
    const duel = fight();

    expect(duelist(duel, "hero")).toMatchObject({
      drinking: null,
      potionEffects: { strength: 0, swiftness: 0 },
      potions: { strength: 1, swiftness: 1, wiggenweld: 2 },
    });
  });

  it("start drinking from the slot pressed while L2 is held, spending a charge", () => {
    const duel = fight();

    const events = drinkFrom(duel, toWiggenweld);

    expect(ofType(events, "potion-start")).toStrictEqual([
      { duelistId: "hero", kind: "wiggenweld", type: "potion-start" },
    ]);
    expect(duelist(duel, "hero")).toMatchObject({
      drinking: { kind: "wiggenweld" },
      potions: { strength: 1, swiftness: 1, wiggenweld: 1 },
    });
  });

  it("show the Potion Slots' modifier held while L2 is", () => {
    const duel = fight();

    run(duel, 1, { hero: potionSlot(null) });
    const held = duelist(duel, "hero").potionSlotsHeld;
    run(duel, 1);

    expect(held).toBeTruthy();
    expect(duelist(duel, "hero").potionSlotsHeld).toBeFalsy();
  });

  it("drink nothing from the empty ✕ slot, or from L2 alone", () => {
    const duel = fight();

    const events = [
      ...drinkFrom(duel, "cross"),
      ...run(duel, 5, { hero: potionSlot(null) }),
      ...run(duel, secondsToTicks(1.5)),
    ];

    expect(ofType(events, "potion-start")).toStrictEqual([]);
    expect(duelist(duel, "hero").potions).toStrictEqual({
      strength: 1,
      swiftness: 1,
      wiggenweld: 2,
    });
  });

  it("drink nothing once a Potion's charges are spent", () => {
    const duel = fight();

    const first = drinkDown(duel, toStrength);
    const again = drinkDown(duel, toStrength);

    expect(ofType(first, "potion-drunk")).toHaveLength(1);
    expect(ofType(again, "potion-start")).toStrictEqual([]);
    expect(duelist(duel, "hero").potions.strength).toBe(0);
  });

  describe("Wiggenweld", () => {
    it("restores 35% of the full Health at once, once it is down after about a second", () => {
      const duel = fight();
      hurtHero(duel, 6);
      const hurt = duelist(duel, "hero").health;

      drinkFrom(duel, toWiggenweld);
      run(duel, secondsToTicks(potions.drink.seconds - 0.1));
      const almost = duelist(duel, "hero").health;
      const events = run(duel, secondsToTicks(0.15));

      expect(hurt).toBeLessThan(60);
      expect(almost).toBe(hurt);
      expect(ofType(events, "potion-drunk")).toStrictEqual([
        { duelistId: "hero", kind: "wiggenweld", type: "potion-drunk" },
      ]);
      expect(duelist(duel, "hero").health).toBeCloseTo(hurt + 35);
      expect(duelist(duel, "hero").drinking).toBeNull();
    });

    it("never heals past full Health", () => {
      const duel = fight();
      hurtHero(duel, 1);

      drinkDown(duel, toWiggenweld);

      expect(duelist(duel, "hero").health).toBe(tuning.duelist.health);
    });
  });

  describe("the Strength Potion", () => {
    it("raises the drinker's Spell damage by 25% for 10 seconds", () => {
      const duel = fight();
      const before = loneStupefyDamage(duel);

      drinkDown(duel, toStrength);
      const active = duelist(duel, "hero").potionEffects.strength;
      const during = loneStupefyDamage(duel);
      run(duel, secondsToTicks(potions.strength.seconds));
      const after = loneStupefyDamage(duel);

      expect(before).toBe(stupefy.damage);
      expect(active).toBeCloseTo(10, 1);
      expect(during).toBeCloseTo(stupefy.damage * 1.25);
      expect(duelist(duel, "hero").potionEffects.strength).toBe(0);
      expect(after).toBe(stupefy.damage);
    });
  });

  describe("the Swiftness Potion", () => {
    it("leaves Stamina unspent and the drinker faster for 8 seconds", () => {
      const plain = fight();
      const normalStride = stride(plain);
      const duel = fight();

      drinkDown(duel, toSwiftness);
      const active = duelist(duel, "hero").potionEffects.swiftness;
      const swiftStride = stride(duel);

      for (let dodge = 0; dodge < 5; dodge += 1) {
        tap(duel, { dodge: true, move: { x: 1, y: 0 } });
        run(duel, secondsToTicks(0.4));
      }

      const staminaWhileSwift = duelist(duel, "hero").stamina;
      run(duel, secondsToTicks(potions.swiftness.seconds));
      tap(duel, { dodge: true, move: { x: -1, y: 0 } });

      expect(active).toBeCloseTo(8, 1);
      expect(swiftStride).toBeCloseTo(normalStride * 1.3, 1);
      expect(staminaWhileSwift).toBe(tuning.defence.stamina.max);
      expect(duelist(duel, "hero").potionEffects.swiftness).toBe(0);
      expect(duelist(duel, "hero").stamina).toBe(
        tuning.defence.stamina.max - tuning.defence.dodge.cost
      );
    });
  });

  describe("drinking", () => {
    it("lets the drinker walk only slowly, and neither cast, Shield, Charge, Dodge nor jump", () => {
      const plain = fight();
      const duel = fight();
      const walking = intent({ move: { x: 1, y: 0 } });
      const plainFrom = duelist(plain, "hero").position;
      run(plain, secondsToTicks(0.5), { hero: walking });
      const plainTo = duelist(plain, "hero").position;

      drinkFrom(duel, toWiggenweld);
      const from = duelist(duel, "hero").position;
      run(duel, secondsToTicks(0.5), { hero: walking });
      const to = duelist(duel, "hero").position;

      const tried = [
        ...tap(duel, { lightSpell: true }),
        ...tap(duel, { dodge: true, move: { x: 1, y: 0 } }),
        ...tap(duel, { jump: true }),
        ...run(duel, 3, { hero: intent({ heavySpell: true, shield: true }) }),
      ];

      const drinker = duelist(duel, "hero");

      expect(drinker.drinking).not.toBeNull();
      expect(Math.hypot(to.x - from.x, to.z - from.z)).toBeCloseTo(
        Math.hypot(plainTo.x - plainFrom.x, plainTo.z - plainFrom.z) * 0.4,
        1
      );
      expect(tried.map((event) => event.type)).toStrictEqual([]);
      expect(drinker).toMatchObject({
        chargeSeconds: 0,
        elevation: 0,
        shielding: false,
      });
    });

    it("cannot start behind the Shield or in the middle of a Charge", () => {
      const duel = fight();

      const shielded = run(duel, 3, {
        hero: potionSlot(toWiggenweld, { shield: true }),
      });

      run(duel, secondsToTicks(1));
      run(duel, secondsToTicks(0.2), { hero: intent({ heavySpell: true }) });

      const charging = run(duel, 1, {
        hero: potionSlot(toWiggenweld, { heavySpell: true }),
      });

      expect(ofType([...shielded, ...charging], "potion-start")).toStrictEqual(
        []
      );
    });

    it("is interrupted by a Spell landing on the drinker: the Potion is lost and its charge spent", () => {
      const duel = fight();

      // The rival's bolt lands about a third of a second into the drink.
      const events = [
        ...drinkFrom(duel, toStrength, { rival: intent({ lightSpell: true }) }),
        ...run(duel, secondsToTicks(1.5)),
      ];

      expect(ofType(events, "spell-hit")).toMatchObject([{ targetId: "hero" }]);
      expect(ofType(events, "potion-interrupted")).toStrictEqual([
        { duelistId: "hero", kind: "strength", type: "potion-interrupted" },
      ]);
      expect(ofType(events, "potion-drunk")).toStrictEqual([]);
      expect(duelist(duel, "hero")).toMatchObject({
        drinking: null,
        potionEffects: { strength: 0 },
        potions: { strength: 0 },
      });
    });

    it("lets a Disarmed Duelist drink", () => {
      // Expelliarmus free of Focus and Cooldown, so the rival can cast it at once.
      const duel = fight({
        ...tuning,
        expelliarmus: {
          ...tuning.expelliarmus,
          cooldownSeconds: 0,
          segments: 0,
        },
      });

      run(duel, 1, {
        rival: intent({ spellSlots: { held: true, press: "circle" } }),
      });

      while (duelist(duel, "hero").looseWand === null) {
        run(duel, 1);
      }

      const disarmed = duelist(duel, "hero").looseWand !== null;
      const events = drinkDown(duel, toWiggenweld);

      expect(disarmed).toBeTruthy();
      expect(ofType(events, "potion-drunk")).toMatchObject([
        { duelistId: "hero", kind: "wiggenweld" },
      ]);
    });
  });

  it("refill every charge and end every effect when the next Round starts", () => {
    // Fragile Duelists: three Stupefies Knock one Out.
    const duel = fight({
      ...tuning,
      duelist: { ...tuning.duelist, health: 20 },
    });

    drinkDown(duel, toWiggenweld);
    drinkDown(duel, toStrength);
    const spent = duelist(duel, "hero").potions;

    while (duel.snapshot().round.number === 1) {
      tap(duel, { lightSpell: true });
      run(duel, secondsToTicks(0.3));
    }

    expect(spent).toStrictEqual({ strength: 0, swiftness: 1, wiggenweld: 1 });
    expect(duelist(duel, "hero")).toMatchObject({
      drinking: null,
      potionEffects: { strength: 0, swiftness: 0 },
      potions: { strength: 1, swiftness: 1, wiggenweld: 2 },
    });
  });
});
