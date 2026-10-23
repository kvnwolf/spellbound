import { describe, expect, it } from "vitest";

import { tuning } from "../tuning";
import type { Tuning } from "../tuning";
import { createDuel } from "./duel";
import type { ArenaLayout, Duel, DuelEvent, DuelistState } from "./duel";
import { forwardOf, rightOf, wrapAngle, yawOf } from "./geometry";
import type { Aim, GroundPoint, Point3 } from "./geometry";
import { idleIntent } from "./intent";
import type { Intent } from "./intent";

const openArena: ArenaLayout = {
  bounds: { halfDepth: 10, halfWidth: 10 },
  cover: [],
  obstructions: [],
};

const secondsToTicks = (seconds: number) =>
  Math.round(seconds * tuning.tickRate);

/** The same tuning with Aim Assist switched off: no friction, no bend. */
const withoutAimAssist: Tuning = {
  ...tuning,
  aimAssist: { ...tuning.aimAssist, bendStrength: 0, friction: 1 },
};

/** A 1v1 with the hero facing the rival 10 m away along -z, still in the Round intro. */
const createOneVsOne = (
  arena: ArenaLayout = openArena,
  settings: Tuning = tuning
): Duel =>
  createDuel({
    arena,
    duelists: [
      { id: "hero", spawn: { x: 0, z: 5 }, team: "gryffindor" },
      { id: "rival", spawn: { x: 0, z: -5 }, team: "slytherin" },
    ],
    tuning: settings,
  });

/** Steps idle ticks until the Round intro's countdown is over and Duelists can act. */
const skipIntro = (duel: Duel) => {
  for (
    let tick = 0;
    tick < secondsToTicks(10) && duel.snapshot().round.phase === "intro";
    tick += 1
  ) {
    duel.step({});
  }
};

/** A 1v1 with control already given: the Round intro has played out. */
const fight = (
  arena: ArenaLayout = openArena,
  settings: Tuning = tuning
): Duel => {
  const duel = createOneVsOne(arena, settings);
  skipIntro(duel);

  return duel;
};

const intent = (overrides: Partial<Intent>): Intent => ({
  ...idleIntent,
  ...overrides,
});

const castLight = intent({ lightSpell: true });
const chargeHeavy = intent({ heavySpell: true });

/** Steps the Duel for `seconds` with the hero holding `heroIntent` and the rival idle. */
const hold = (duel: Duel, heroIntent: Intent, seconds: number) => {
  for (let tick = 0; tick < secondsToTicks(seconds); tick += 1) {
    duel.step({ hero: heroIntent });
  }

  return duel.snapshot();
};

/** Turns the hero's aim by `by` radians, spread over one second of look input. */
const turn = (duel: Duel, by: Aim) => hold(duel, intent({ look: by }), 1);

/**
 * A fight (without Aim Assist) in which the hero has turned to look straight
 * down the Arena, along -z, so walking forward heads down the centre line.
 * At the start the over-the-shoulder aim looks slightly left of that, to put
 * the crosshair on the rival.
 */
const fightLookingDownTheArena = (arena: ArenaLayout = openArena): Duel => {
  const duel = fight(arena, withoutAimAssist);
  const { yaw } = duel.snapshot().duelists[0]?.aim ?? { yaw: 0 };
  turn(duel, { pitch: 0, yaw: -yaw });

  return duel;
};

/**
 * Steps `ticks` ticks with the given Intents (idle for anyone left out) and
 * returns every event emitted along the way.
 */
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

/** Presses the Light Spell for one tick as `who`, then lets go for a tick. */
const tapLight = (duel: Duel, who: string): DuelEvent[] => [
  ...run(duel, 1, { [who]: castLight }),
  ...run(duel, 1),
];

/** Lets every Spell in flight land: 1.5 s covers the longest flight in the test Arena. */
const settle = (duel: Duel): DuelEvent[] => run(duel, secondsToTicks(1.5));

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

describe("Duel ticks", () => {
  it("advances the tick count and reports no events while Duelists only move", () => {
    const duel = fight();
    const before = duel.snapshot().tick;

    const { snapshot, events } = duel.step({
      hero: intent({ move: { x: 1, y: 1 } }),
    });

    expect(snapshot.tick).toBe(before + 1);
    expect(events).toStrictEqual([]);
  });
});

describe("Free aim", () => {
  it("starts each Round looking at the nearest opponent, with the crosshair on their chest", () => {
    const duel = fight();

    const hero = duelist(duel, "hero");

    expect(hero.targetId).toBeNull();
    expect(hero.facing.z).toBeCloseTo(-1);
    // The crosshair lands on the front of the rival's body, at chest height.
    expect(hero.aimPoint.x).toBeCloseTo(0, 1);
    expect(hero.aimPoint.y).toBeCloseTo(tuning.duelist.chestHeight, 1);
    expect(hero.aimPoint.z).toBeCloseTo(-5 + tuning.duelist.bodyRadius, 1);
  });

  it("turns the aim at the look rates", () => {
    const duel = fight(openArena, withoutAimAssist);
    const before = duelist(duel, "hero");

    turn(duel, { pitch: 0.2, yaw: Math.PI / 2 });

    const hero = duelist(duel, "hero");
    expect(hero.aim.yaw - before.aim.yaw).toBeCloseTo(Math.PI / 2);
    expect(hero.aim.pitch - before.aim.pitch).toBeCloseTo(0.2);
  });

  it("keeps the pitch within its limits", () => {
    const duel = fight();

    turn(duel, { pitch: 3, yaw: 0 });
    const up = duelist(duel, "hero").aim.pitch;
    turn(duel, { pitch: -6, yaw: 0 });
    const down = duelist(duel, "hero").aim.pitch;

    expect(up).toBeCloseTo(tuning.aim.pitch.max);
    expect(down).toBeCloseTo(tuning.aim.pitch.min);
  });

  it("walks relative to the camera: forward where it looks, sideways to its right", () => {
    const duel = fight(openArena, withoutAimAssist);
    turn(duel, { pitch: 0, yaw: Math.PI / 2 });
    const start = duelist(duel, "hero");

    hold(duel, intent({ move: { x: 0, y: 1 } }), 0.5);
    const walked = duelist(duel, "hero");
    hold(duel, intent({ move: { x: 1, y: 0 } }), 0.5);
    const strafed = duelist(duel, "hero");

    const stride = tuning.duelist.walkSpeed * 0.5;
    const ahead = forwardOf(start.aim.yaw);
    const right = rightOf(ahead);
    expect(walked.position.x - start.position.x).toBeCloseTo(ahead.x * stride);
    expect(walked.position.z - start.position.z).toBeCloseTo(ahead.z * stride);
    expect(strafed.position.x - walked.position.x).toBeCloseTo(
      right.x * stride
    );
    expect(strafed.position.z - walked.position.z).toBeCloseTo(
      right.z * stride
    );
  });
});

/** The angle, radians, from `facing` round to the ground direction `along`: 0 when they agree. */
const angleOff = (facing: GroundPoint, along: GroundPoint) =>
  Math.abs(wrapAngle(yawOf(along) - yawOf(facing)));

/** Where the hero's aim (the camera) looks, on the floor. */
const aimForward = (duel: Duel) => forwardOf(duelist(duel, "hero").aim.yaw);

const walkBack = intent({ move: { x: 0, y: -1 } });

/**
 * The hero walks toward the camera until they face it, their back to the
 * rival, and stops; the camera still looks down the Arena at the rival.
 */
const faceTheCamera = (duel: Duel) => hold(duel, walkBack, 0.5);

const { facing: facingTuning } = tuning;

describe("Facing while free-aiming", () => {
  it("turns toward where it walks at the tuned turn rate, the camera staying put", () => {
    const duel = fightLookingDownTheArena();
    const before = duelist(duel, "hero");

    run(duel, 1, { hero: walkBack });
    const firstTick = duelist(duel, "hero");
    faceTheCamera(duel);
    const turned = duelist(duel, "hero");

    expect(
      Math.abs(wrapAngle(yawOf(firstTick.facing) - yawOf(before.facing)))
    ).toBeCloseTo(facingTuning.moveTurnRate / tuning.tickRate);
    // Walking toward the camera: facing it, which shows the face.
    expect(angleOff(turned.facing, { x: 0, z: 1 })).toBeCloseTo(0);
    expect(turned.aim.yaw).toBeCloseTo(before.aim.yaw);
    expect(turned.position.z).toBeGreaterThan(before.position.z);
  });

  it("turns toward a sideways walk, facing where it goes", () => {
    const duel = fightLookingDownTheArena();

    hold(duel, intent({ move: { x: 1, y: 0 } }), 0.5);

    expect(
      angleOff(duelist(duel, "hero").facing, rightOf(aimForward(duel)))
    ).toBeCloseTo(0);
  });

  it("keeps its facing while standing still, however far the camera orbits round it", () => {
    const duel = fight(openArena, withoutAimAssist);
    const before = duelist(duel, "hero");

    turn(duel, { pitch: 0, yaw: Math.PI });
    turn(duel, { pitch: 0, yaw: Math.PI * 0.75 });

    const after = duelist(duel, "hero");
    expect(Math.abs(wrapAngle(after.aim.yaw - before.aim.yaw))).toBeCloseTo(
      Math.PI * 0.25
    );
    expect(after.facing).toStrictEqual(before.facing);
  });

  it("turns to the aim within the tuned time on a Light Spell, which flies to the point under the crosshair", () => {
    const duel = fightLookingDownTheArena();
    faceTheCamera(duel);
    // Look down at the floor a few metres ahead, past the hero's back.
    turn(duel, { pitch: -0.35, yaw: 0 });
    const { aimPoint } = duelist(duel, "hero");

    const cast = run(duel, 1, { hero: castLight });
    const castTick = angleOff(duelist(duel, "hero").facing, aimForward(duel));
    const turning = run(duel, secondsToTicks(facingTuning.aimTurnSeconds) - 1);

    // A quick turn, not a snap: still turning after the cast's tick, done in time.
    expect(castTick).toBeGreaterThan(0.5);
    expect(
      angleOff(duelist(duel, "hero").facing, aimForward(duel))
    ).toBeCloseTo(0);

    const [stopped] = ofType(
      [...cast, ...turning, ...settle(duel)],
      "spell-stopped"
    );

    expect(stopped?.by).toBe("floor");
    expect(stopped?.position.x).toBeCloseTo(aimPoint.x, 1);
    expect(stopped?.position.z).toBeCloseTo(aimPoint.z, 1);
  });

  it("turns to the aim while Charging, and keeps facing it as the camera turns", () => {
    const duel = fightLookingDownTheArena();
    faceTheCamera(duel);

    hold(duel, chargeHeavy, facingTuning.aimTurnSeconds);
    expect(
      angleOff(duelist(duel, "hero").facing, aimForward(duel))
    ).toBeCloseTo(0);

    hold(duel, intent({ heavySpell: true, look: { pitch: 0, yaw: 1.5 } }), 0.2);
    expect(duelist(duel, "hero").chargeSeconds).toBeGreaterThan(0);
    expect(
      angleOff(duelist(duel, "hero").facing, aimForward(duel))
    ).toBeCloseTo(0);
  });

  it("keeps facing the aim for a moment after a cast on the move, then turns back to where it walks", () => {
    const duel = fightLookingDownTheArena();
    const strafe = intent({ move: { x: 1, y: 0 } });
    hold(duel, strafe, 0.5);

    run(duel, 1, { hero: intent({ lightSpell: true, move: { x: 1, y: 0 } }) });
    hold(duel, strafe, facingTuning.aimHoldSeconds - 0.1);
    expect(
      angleOff(duelist(duel, "hero").facing, aimForward(duel))
    ).toBeCloseTo(0);

    hold(duel, strafe, 0.1 + Math.PI / 2 / facingTuning.moveTurnRate + 0.1);
    expect(
      angleOff(duelist(duel, "hero").facing, rightOf(aimForward(duel)))
    ).toBeCloseTo(0);
  });

  describe("the Shield", () => {
    const shieldUp = intent({ shield: true });

    /** The rival casts a Stupefy at the hero, who holds the Shield up until it lands. */
    const rivalCastsAtShield = (duel: Duel) => [
      ...run(duel, 1, { hero: shieldUp, rival: castLight }),
      ...run(duel, secondsToTicks(1.5), { hero: shieldUp }),
    ];

    it("turns the Duelist to the aim when it goes up, and blocks a Spell from the aim side", () => {
      const duel = fightLookingDownTheArena();
      faceTheCamera(duel);

      hold(duel, shieldUp, facingTuning.aimTurnSeconds);
      expect(
        angleOff(duelist(duel, "hero").facing, aimForward(duel))
      ).toBeCloseTo(0);

      const events = rivalCastsAtShield(duel);

      expect(ofType(events, "spell-blocked")).toHaveLength(1);
      expect(ofType(events, "spell-hit")).toStrictEqual([]);
    });

    it("follows the aim while held, leaving the side the camera turned from open", () => {
      const duel = fightLookingDownTheArena();

      // Shield up facing the rival, then the camera turns right round.
      hold(duel, intent({ look: { pitch: 0, yaw: Math.PI }, shield: true }), 1);
      expect(
        angleOff(duelist(duel, "hero").facing, aimForward(duel))
      ).toBeCloseTo(0);

      const events = rivalCastsAtShield(duel);

      expect(ofType(events, "spell-blocked")).toStrictEqual([]);
      expect(ofType(events, "spell-hit")).toMatchObject([{ targetId: "hero" }]);
    });
  });
});

/** Turn speed over the next tick, radians per second, for a look rate of `rate`. */
const turnSpeed = (duel: Duel, rate: number) => {
  const before = duelist(duel, "hero").aim.yaw;
  run(duel, 1, { hero: intent({ look: { pitch: 0, yaw: rate } }) });

  return (duelist(duel, "hero").aim.yaw - before) * tuning.tickRate;
};

const longArena: ArenaLayout = {
  ...openArena,
  bounds: { halfDepth: 30, halfWidth: 10 },
};

/**
 * A fight with the rival `distance` m away, the hero's aim ray passing
 * `beyond` radians outside the edge of the rival's body (seen from the free
 * camera behind the aim pivot, which is what the crosshair shows).
 */
const duelAimedBeyondEdge = (
  distance: number,
  beyond: number,
  settings: Tuning
) => {
  const rivalZ = 5 - distance;

  const duel = createDuel({
    arena: longArena,
    duelists: [
      { id: "hero", spawn: { x: 0, z: 5 }, team: "gryffindor" },
      { id: "rival", spawn: { x: 0, z: rivalZ }, team: "slytherin" },
    ],
    tuning: settings,
  });

  skipIntro(duel);

  // The crosshair starts on the rival's chest. The aim ray, turned right
  // about the pivot, passes the body's axis at `away * sin(turn)`: its edge
  // when that is the body radius, and `beyond` more (as seen from the camera,
  // `back` behind the pivot) at the extra gap below.
  const hero = duelist(duel, "hero");
  const right = rightOf(hero.facing);
  const pivotX = hero.position.x + right.x * tuning.aim.eye.shoulder;
  const pivotZ = hero.position.z + right.z * tuning.aim.eye.shoulder;
  const away = Math.hypot(pivotX, pivotZ - rivalZ);

  const gap =
    tuning.duelist.bodyRadius + (away + tuning.camera.free.distance) * beyond;

  turn(duel, { pitch: 0, yaw: Math.asin(gap / away) });

  return duel;
};

/** Casts once with the aim `beyond` radians outside the rival's body edge; reports whether the Spell hit and its launch velocity. */
const castsBeyondEdge = (
  distance: number,
  beyond: number,
  settings: Tuning
) => {
  const duel = duelAimedBeyondEdge(distance, beyond, settings);

  const cast = tapLight(duel, "hero");
  const velocity = ofType(cast, "spell-cast")[0]?.spell.velocity;
  const hit = ofType([...cast, ...settle(duel)], "spell-hit").length > 0;

  return { hit, velocity };
};

describe("Aim Assist", () => {
  it("eases the turn speed while the crosshair is over an opponent", () => {
    const duel = fight();

    const overRival = turnSpeed(duel, 0.5);
    turn(duel, { pitch: 0, yaw: 1 });
    const clear = turnSpeed(duel, 0.5);

    expect(overRival).toBeLessThan(0.4);
    expect(overRival).toBeGreaterThan(0.2);
    expect(clear).toBeCloseTo(0.5);
  });

  describe.each([14, 22])("with the rival %i m away", (distance) => {
    const bendOnly: Tuning = {
      ...tuning,
      aimAssist: { ...tuning.aimAssist, friction: 1 },
    };

    it("bends a cast whose aim passes just within the angle of the body, and it hits", () => {
      const plain = castsBeyondEdge(distance, 0.015, withoutAimAssist);
      const assisted = castsBeyondEdge(distance, 0.015, bendOnly);

      expect(assisted.hit).toBeTruthy();
      expect(assisted.velocity).not.toStrictEqual(plain.velocity);
    });

    it("does not bend a cast whose aim passes just outside the angle", () => {
      const plain = castsBeyondEdge(distance, 0.021, withoutAimAssist);
      const assisted = castsBeyondEdge(distance, 0.021, bendOnly);

      expect(assisted.hit).toBe(plain.hit);
      expect(assisted.velocity).toStrictEqual(plain.velocity);
    });
  });

  it("flies straight after launch: the bend is no homing", () => {
    const duel = fight();
    tapLight(duel, "hero");
    const [launched] = duel.snapshot().spells;

    run(duel, 3, { rival: intent({ move: { x: 1, y: 0 } }) });

    expect(duel.snapshot().spells[0]?.velocity).toStrictEqual(
      launched?.velocity
    );
  });
});

describe("Duel collision", () => {
  it("stops the Duelist at the Arena bounds", () => {
    const duel = fightLookingDownTheArena();

    hold(duel, intent({ move: { x: 0, y: -1 } }), 3);

    const { position } = duelist(duel, "hero");
    expect(position.x).toBeCloseTo(0);
    expect(position.z).toBe(10 - tuning.duelist.bodyRadius);
  });

  it("stops the Duelist against a column of Cover standing in the way", () => {
    const duel = fightLookingDownTheArena({
      ...openArena,
      cover: [{ center: { x: 0, z: 0 }, radius: 1 }],
    });

    hold(duel, intent({ move: { x: 0, y: 1 } }), 2);

    const { position } = duelist(duel, "hero");
    expect(position.x).toBeCloseTo(0);
    expect(position.z).toBeCloseTo(1 + tuning.duelist.bodyRadius);
  });

  it("slides the Duelist around a column it walks into off-centre", () => {
    const duel = fightLookingDownTheArena({
      ...openArena,
      cover: [{ center: { x: 0.3, z: 0 }, radius: 1 }],
    });

    hold(duel, intent({ move: { x: 0, y: 1 } }), 3);

    expect(duelist(duel, "hero").position.z).toBeLessThan(0);
  });

  it("stops the Duelist against an Obstruction standing in the way", () => {
    const duel = fightLookingDownTheArena({
      ...openArena,
      obstructions: [{ center: { x: 0, z: 0 }, radius: 1 }],
    });

    hold(duel, intent({ move: { x: 0, y: 1 } }), 2);

    const { position } = duelist(duel, "hero");
    expect(position.x).toBeCloseTo(0);
    expect(position.z).toBeCloseTo(1 + tuning.duelist.bodyRadius);
  });

  it("slides the Duelist around an Obstruction it walks into off-centre", () => {
    const duel = fightLookingDownTheArena({
      ...openArena,
      obstructions: [{ center: { x: 0.3, z: 0 }, radius: 1 }],
    });

    hold(duel, intent({ move: { x: 0, y: 1 } }), 3);

    expect(duelist(duel, "hero").position.z).toBeLessThan(0);
  });

  it("does not let a Duelist walk through another Duelist", () => {
    const duel = fightLookingDownTheArena();

    hold(duel, intent({ move: { x: 0, y: 1 } }), 4);

    const hero = duelist(duel, "hero");
    const rival = duelist(duel, "rival");
    expect(rival.position).toStrictEqual({ x: 0, z: -5 });
    expect(hero.position.z - rival.position.z).toBeCloseTo(
      2 * tuning.duelist.bodyRadius
    );
  });
});

/** Where a right hand holding the Wand forward puts its tip, from tuning: ahead and to the right of the Duelist along their facing. */
const wandTipOf = ({ facing, position, elevation }: DuelistState): Point3 => {
  const { forward, height, right } = tuning.duelist.wandTip;
  const side = rightOf(facing);

  return {
    x: position.x + facing.x * forward + side.x * right,
    y: height + elevation,
    z: position.z + facing.z * forward + side.z * right,
  };
};

describe("The Wand", () => {
  it("is held forward at about shoulder height, to the right of the body", () => {
    const { forward, height, right } = tuning.duelist.wandTip;

    expect(forward).toBeGreaterThan(tuning.duelist.bodyRadius);
    expect(right).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(1.2);
    expect(height).toBeLessThan(tuning.duelist.height);
  });

  describe.each(["stupefy", "confringo"] as const)("a cast %s", (kind) => {
    it.each([0, 1, -2.3])(
      "leaves the Wand tip with the aim turned by %s rad",
      (yaw) => {
        const duel = fight();
        turn(duel, { pitch: 0, yaw });

        const events =
          kind === "stupefy"
            ? run(duel, 1, { hero: castLight })
            : [
                ...run(duel, secondsToTicks(0.3), { hero: chargeHeavy }),
                ...run(duel, 1),
              ];

        const [cast] = ofType(events, "spell-cast");
        // The Wand of a Duelist turned to their aim, as every cast turns them.
        const hero = duelist(duel, "hero");
        const tip = wandTipOf({ ...hero, facing: forwardOf(hero.aim.yaw) });

        expect(cast?.spell.kind).toBe(kind);
        expect(cast?.spell.position.x).toBeCloseTo(tip.x);
        expect(cast?.spell.position.y).toBeCloseTo(tip.y);
        expect(cast?.spell.position.z).toBeCloseTo(tip.z);
      }
    );
  });
});

describe("Stupefy", () => {
  it("casts a Stupefy from the Wand toward the aim point when the Light Spell is pressed", () => {
    const duel = fight();

    const events = run(duel, 1, { hero: castLight });

    expect(ofType(events, "spell-cast")).toMatchObject([
      { spell: { casterId: "hero", kind: "stupefy", strong: false } },
    ]);

    const [spell] = duel.snapshot().spells;
    // Flying down the Arena toward the rival at Stupefy's speed.
    expect(spell?.casterId).toBe("hero");
    expect(spell?.velocity.z).toBeCloseTo(-tuning.stupefy.speed, 0);
  });

  it("flies to the point under the crosshair", () => {
    const duel = fight(openArena, withoutAimAssist);
    // Look down at the floor a few metres ahead.
    turn(duel, { pitch: -0.35, yaw: 0 });
    const { aimPoint } = duelist(duel, "hero");

    const events = [...tapLight(duel, "hero"), ...settle(duel)];

    const [stopped] = ofType(events, "spell-stopped");
    expect(stopped?.by).toBe("floor");
    expect(aimPoint.y).toBeCloseTo(0);
    expect(stopped?.position.x).toBeCloseTo(aimPoint.x, 1);
    expect(stopped?.position.z).toBeCloseTo(aimPoint.z, 1);
  });

  it("costs the Duelist it hits Health and reports a Light Spell hit", () => {
    const duel = fight();

    const events = [...tapLight(duel, "hero"), ...settle(duel)];

    expect(ofType(events, "spell-hit")).toMatchObject([
      {
        damage: tuning.stupefy.damage,
        spell: { casterId: "hero", kind: "stupefy" },
        staggered: false,
        targetId: "rival",
      },
    ]);
    expect(duelist(duel, "rival").health).toBe(
      tuning.duelist.health - tuning.stupefy.damage
    );
    expect(duel.snapshot().spells).toStrictEqual([]);
  });

  it("casts once per press at a fast cadence, keeping a press made while recovering", () => {
    const duel = fight();
    const recovery = secondsToTicks(tuning.stupefy.castInterval);

    // Holding the button casts once, not every tick.
    const held = run(duel, 3, { hero: castLight });
    // A second press right away waits for the recovery, then casts.
    const early = [...run(duel, 1), ...run(duel, 1, { hero: castLight })];
    const waiting = run(duel, recovery - 6);
    const recovered = run(duel, 2);

    expect(ofType(held, "spell-cast")).toHaveLength(1);
    expect(ofType([...early, ...waiting], "spell-cast")).toHaveLength(0);
    expect(ofType(recovered, "spell-cast")).toHaveLength(1);
  });

  it("makes every third consecutive cast strong, Staggering the Duelist it hits", () => {
    const duel = fight();
    const recovery = secondsToTicks(tuning.stupefy.castInterval);
    const casts: DuelEvent[] = [];

    for (let cast = 0; cast < 3; cast += 1) {
      casts.push(...tapLight(duel, "hero"), ...run(duel, recovery));
    }

    const events = [...casts, ...settle(duel)];

    expect(
      ofType(events, "spell-cast").map(({ spell }) => spell.strong)
    ).toStrictEqual([false, false, true]);
    expect(
      ofType(events, "spell-hit").map(({ damage, staggered }) => ({
        damage,
        staggered,
      }))
    ).toStrictEqual([
      { damage: tuning.stupefy.damage, staggered: false },
      { damage: tuning.stupefy.damage, staggered: false },
      { damage: tuning.stupefy.strongDamage, staggered: true },
    ]);
  });

  it("starts a new chain when casts are too far apart", () => {
    const duel = fight();
    const pause = secondsToTicks(tuning.stupefy.chainWindow) + 1;
    const events: DuelEvent[] = [];

    for (let cast = 0; cast < 3; cast += 1) {
      events.push(...tapLight(duel, "hero"), ...run(duel, pause));
    }

    expect(
      ofType(events, "spell-cast").some(({ spell }) => spell.strong)
    ).toBeFalsy();
  });
});

/** The hero lands a three-cast chain on the rival; returns right after the strong hit. */
const staggerRival = (duel: Duel) => {
  const recovery = secondsToTicks(tuning.stupefy.castInterval);

  for (let cast = 0; cast < 3; cast += 1) {
    tapLight(duel, "hero");
    run(duel, recovery);
  }

  for (let tick = 0; tick < secondsToTicks(1.5); tick += 1) {
    if (ofType(run(duel, 1), "spell-hit").some((hit) => hit.staggered)) {
      return;
    }
  }
};

/** The rival trying to strafe and cast at once. */
const rivalTries = intent({ lightSpell: true, move: { x: 1, y: 0 } });

describe("Stagger", () => {
  it("stops a Staggered Duelist from moving or casting", () => {
    const duel = fight();
    staggerRival(duel);
    const before = duelist(duel, "rival").position;

    const whileStaggered = run(duel, secondsToTicks(0.5), {
      rival: rivalTries,
    });

    expect(duelist(duel, "rival").staggerSeconds).toBeGreaterThan(0);
    expect(duelist(duel, "rival").position).toStrictEqual(before);
    expect(ofType(whileStaggered, "spell-cast")).toStrictEqual([]);
  });

  it("lets the Duelist act again once the Stagger wears off", () => {
    const duel = fight();
    staggerRival(duel);
    const before = duelist(duel, "rival").position;
    run(duel, secondsToTicks(tuning.stupefy.staggerSeconds));

    const recovered = [
      ...run(duel, 1, { rival: rivalTries }),
      ...run(duel, 1, { rival: rivalTries }),
    ];

    expect(duelist(duel, "rival").staggerSeconds).toBe(0);
    expect(duelist(duel, "rival").position).not.toStrictEqual(before);
    expect(ofType(recovered, "spell-cast")).toMatchObject([
      { spell: { casterId: "rival" } },
    ]);
  });
});

describe("Spell flight", () => {
  it("flies over an Obstruction standing between the Duelists", () => {
    const duel = fight({
      ...openArena,
      obstructions: [{ center: { x: 0, z: 0 }, radius: 0.6 }],
    });

    const events = [...tapLight(duel, "hero"), ...settle(duel)];

    expect(ofType(events, "spell-stopped")).toStrictEqual([]);
    expect(ofType(events, "spell-hit")).toHaveLength(1);
  });

  it("is stopped by Cover standing between the Duelists", () => {
    const duel = fight({
      ...openArena,
      cover: [{ center: { x: 0, z: 0 }, radius: 0.6 }],
    });

    const events = [...tapLight(duel, "hero"), ...settle(duel)];

    expect(ofType(events, "spell-stopped")).toMatchObject([{ by: "cover" }]);
    expect(ofType(events, "spell-hit")).toStrictEqual([]);
    expect(duelist(duel, "rival").health).toBe(tuning.duelist.health);
  });

  it("is stopped by the Arena bounds when it misses", () => {
    const duel = fight();

    // Aim far right of the rival: the Spell sails past and reaches the wall.
    turn(duel, { pitch: 0, yaw: 0.6 });
    const events = [...tapLight(duel, "hero"), ...settle(duel)];

    expect(ofType(events, "spell-hit")).toStrictEqual([]);
    expect(ofType(events, "spell-stopped")).toMatchObject([{ by: "bounds" }]);
    expect(duel.snapshot().spells).toStrictEqual([]);
  });

  it("cancels two Spells from opposing Duelists that meet in the air, in a burst", () => {
    const duel = fight();

    const events = [
      ...run(duel, 1, { hero: castLight, rival: castLight }),
      ...settle(duel),
    ];

    const [burst] = ofType(events, "spells-cancelled");
    expect(
      burst?.spells.map((spell) => spell.casterId).toSorted()
    ).toStrictEqual(["hero", "rival"]);
    // They meet halfway down the Arena.
    expect(burst?.position.z).toBeCloseTo(0, 0);
    expect(ofType(events, "spell-hit")).toStrictEqual([]);
    expect(duelist(duel, "hero").health).toBe(tuning.duelist.health);
    expect(duelist(duel, "rival").health).toBe(tuning.duelist.health);
  });
});

/**
 * The hero keeps casting at the rival until the Round has a winner (giving
 * up after far more casts than a full Health bar needs); returns every event.
 */
const knockOutRival = (duel: Duel): DuelEvent[] => {
  const recovery = secondsToTicks(tuning.stupefy.castInterval);
  const events: DuelEvent[] = [];

  for (
    let cast = 0;
    cast < 100 && duel.snapshot().round.phase === "fighting";
    cast += 1
  ) {
    events.push(...tapLight(duel, "hero"), ...run(duel, recovery));
  }

  return events;
};

/** Steps idle ticks until the next Round's intro starts (or 10 s pass). */
const nextRound = (duel: Duel): DuelEvent[] => {
  const events: DuelEvent[] = [];

  for (
    let tick = 0;
    tick < secondsToTicks(10) && duel.snapshot().round.phase !== "intro";
    tick += 1
  ) {
    events.push(...run(duel, 1));
  }

  return events;
};

const pressLockOn = intent({ lockOn: true });

/** The hero presses R3 for one tick; returns that tick's events. */
const toggleLock = (duel: Duel): DuelEvent[] =>
  run(duel, 1, { hero: pressLockOn });

/**
 * The hero against two rivals on the same Team, 8 m apart across the far
 * end. The hero starts looking at the left one.
 */
const fightTwo = (settings: Tuning = tuning): Duel => {
  const duel = createDuel({
    arena: openArena,
    duelists: [
      { id: "hero", spawn: { x: 0, z: 5 }, team: "gryffindor" },
      { id: "left", spawn: { x: -4, z: -5 }, team: "slytherin" },
      { id: "right", spawn: { x: 4, z: -5 }, team: "slytherin" },
    ],
    tuning: settings,
  });

  skipIntro(duel);

  return duel;
};

/** The rival side-stepping: to its own left, which is the hero's right (+x). */
const rivalStrafes = intent({ move: { x: -1, y: 0 } });

describe("Lock-on", () => {
  it("locks on to the opponent with R3", () => {
    const duel = fight();

    const events = toggleLock(duel);

    expect(ofType(events, "lock-on")).toStrictEqual([
      { duelistId: "hero", targetId: "rival", type: "lock-on" },
    ]);
    expect(duelist(duel, "hero").targetId).toBe("rival");
  });

  it("locks on to the opponent nearest the crosshair", () => {
    const duel = fightTwo(withoutAimAssist);
    // From the left rival round to the right one.
    turn(duel, { pitch: 0, yaw: 0.75 });

    toggleLock(duel);

    expect(duelist(duel, "hero").targetId).toBe("right");
  });

  it("locks on through an Obstruction, which Spells fly over", () => {
    const duel = fight({
      ...openArena,
      obstructions: [{ center: { x: 0, z: 0 }, radius: 1 }],
    });

    toggleLock(duel);

    expect(duelist(duel, "hero").targetId).toBe("rival");
  });

  it("does not lock on to an opponent behind Cover, and recentres the camera instead", () => {
    const duel = fight(
      { ...openArena, cover: [{ center: { x: 0, z: 0 }, radius: 0.6 }] },
      withoutAimAssist
    );

    turn(duel, { pitch: -0.4, yaw: 0 });

    const events = [
      ...toggleLock(duel),
      ...run(duel, secondsToTicks(tuning.lockOn.recentreSeconds)),
    ];

    expect(ofType(events, "lock-on")).toStrictEqual([]);
    expect(duelist(duel, "hero").targetId).toBeNull();
    expect(duelist(duel, "hero").aim.pitch).toBeCloseTo(tuning.aim.pitch.rest);
  });

  describe.each([14, 22])("with the rival %i m away", (distance) => {
    // The acquire angle is 5 crosses: 0.0875 rad of body edge.
    it("locks on to an opponent whose body edge is just within 5 times the cross", () => {
      const duel = duelAimedBeyondEdge(distance, 0.08, withoutAimAssist);

      toggleLock(duel);

      expect(duelist(duel, "hero").targetId).toBe("rival");
    });

    it("does not lock on to an opponent just outside it", () => {
      const duel = duelAimedBeyondEdge(distance, 0.095, withoutAimAssist);

      const events = [
        ...toggleLock(duel),
        ...run(duel, secondsToTicks(tuning.lockOn.recentreSeconds)),
      ];

      expect(ofType(events, "lock-on")).toStrictEqual([]);
      expect(duelist(duel, "hero").targetId).toBeNull();
    });
  });

  it("does not lock on to an opponent out of range", () => {
    const duel = createDuel({
      arena: { ...openArena, bounds: { halfDepth: 40, halfWidth: 10 } },
      duelists: [
        { id: "hero", spawn: { x: 0, z: 20 }, team: "gryffindor" },
        { id: "rival", spawn: { x: 0, z: -20 }, team: "slytherin" },
      ],
      tuning,
    });

    skipIntro(duel);

    toggleLock(duel);

    expect(duelist(duel, "hero").targetId).toBeNull();
  });

  it("faces where it walks, even away from the Target: the lock holds the camera, not the body", () => {
    const duel = fight();
    toggleLock(duel);

    hold(duel, intent({ move: { x: 0, y: -1 } }), 0.5);

    const { facing, position, targetId } = duelist(duel, "hero");
    expect(targetId).toBe("rival");
    expect(position.z).toBeGreaterThan(5);
    expect(facing.z).toBeGreaterThan(0.99);
  });

  it("turns to the Target to cast while walking away", () => {
    const duel = fight();
    toggleLock(duel);
    hold(duel, intent({ move: { x: 0, y: -1 } }), 0.5);

    run(duel, 1, { hero: intent({ lightSpell: true, move: { x: 0, y: -1 } }) });
    hold(duel, intent({ move: { x: 0, y: -1 } }), 0.1);
    const casting = duelist(duel, "hero");
    const rival = duelist(duel, "rival").position;

    const toRival = Math.atan2(
      rival.x - casting.position.x,
      rival.z - casting.position.z
    );

    const off = Math.atan2(casting.facing.x, casting.facing.z) - toRival;
    expect(Math.abs(Math.atan2(Math.sin(off), Math.cos(off)))).toBeLessThan(
      0.1
    );
  });

  it("strafes round the Target at a constant distance, facing the way it runs", () => {
    const duel = fight();
    toggleLock(duel);

    hold(duel, intent({ move: { x: 1, y: 0 } }), 1);

    const { facing, position } = duelist(duel, "hero");
    const toRival = { x: 0 - position.x, z: -5 - position.z };
    const distance = Math.hypot(toRival.x, toRival.z);
    expect(position.x).toBeGreaterThan(3);
    expect(distance).toBeCloseTo(10);
    // Round the circle: square to the line to the Target, not along it.
    expect(
      Math.abs(facing.x * toRival.x + facing.z * toRival.z) / distance
    ).toBeLessThan(0.15);
  });

  it("only nudges the framing with the right stick, springing back once it rests", () => {
    const duel = fight();
    toggleLock(duel);

    hold(duel, intent({ look: { pitch: 8, yaw: 8 } }), 1);
    const nudged = duelist(duel, "hero");
    // A released stick eases out, so a trace of turn rate lingers.
    hold(duel, intent({ look: { pitch: 0.01, yaw: 0.01 } }), 1);
    const rested = duelist(duel, "hero");

    expect(nudged.targetId).toBe("rival");
    expect(nudged.facing.z).toBeCloseTo(-1);
    expect(nudged.lockNudge.yaw).toBeCloseTo(tuning.lockOn.nudge.maxYaw);
    expect(nudged.lockNudge.pitch).toBeCloseTo(tuning.lockOn.nudge.maxPitch);
    // Back to rest on both axes.
    expect(
      Math.hypot(rested.lockNudge.yaw, rested.lockNudge.pitch)
    ).toBeCloseTo(0);
  });

  it("switches to the next opponent left or right on a flick", () => {
    const duel = fightTwo();
    toggleLock(duel);
    const locked = duelist(duel, "hero").targetId;

    const switched = run(duel, 1, { hero: intent({ switchTarget: 1 }) });
    const toRight = duelist(duel, "hero").targetId;
    run(duel, 1, { hero: intent({ switchTarget: 1 }) });
    const nothingFurther = duelist(duel, "hero").targetId;
    run(duel, 1, { hero: intent({ switchTarget: -1 }) });
    const back = duelist(duel, "hero").targetId;

    expect([locked, toRight, nothingFurther, back]).toStrictEqual([
      "left",
      "right",
      "right",
      "left",
    ]);
    expect(ofType(switched, "lock-on")).toStrictEqual([
      { duelistId: "hero", targetId: "right", type: "lock-on" },
    ]);
  });

  it("releases the lock on R3 again, keeping the aim where it was", () => {
    const duel = fight();
    toggleLock(duel);
    hold(duel, intent({ move: { x: 1, y: 0 } }), 0.5);
    const locked = duelist(duel, "hero");

    const events = toggleLock(duel);

    expect(ofType(events, "lock-off")).toStrictEqual([
      {
        duelistId: "hero",
        reason: "toggle",
        targetId: "rival",
        type: "lock-off",
      },
    ]);
    expect(duelist(duel, "hero").targetId).toBeNull();
    expect(duelist(duel, "hero").aim).toStrictEqual(locked.aim);
  });

  it("breaks once the Target has stayed out of sight behind Cover for a moment", () => {
    const duel = fight({
      ...openArena,
      cover: [{ center: { x: 2, z: 0 }, radius: 1 }],
    });

    toggleLock(duel);

    // The rival steps out of sight behind the column...
    const stepping = run(duel, secondsToTicks(0.9), { rival: rivalStrafes });
    const hidden = duelist(duel, "hero");
    // ...and stays there.
    const waiting = run(duel, secondsToTicks(tuning.lockOn.sightGraceSeconds));

    expect(ofType(stepping, "lock-off")).toStrictEqual([]);
    expect(hidden.targetId).toBe("rival");
    expect(hidden.targetHiddenSeconds).toBeGreaterThan(0);
    expect(ofType(waiting, "lock-off")).toMatchObject([
      { duelistId: "hero", reason: "sight", targetId: "rival" },
    ]);
    expect(duelist(duel, "hero").targetId).toBeNull();
  });

  it("breaks when the Target is Knocked Out", () => {
    const duel = fight();
    toggleLock(duel);

    const events = knockOutRival(duel);

    expect(ofType(events, "lock-off")).toMatchObject([
      { duelistId: "hero", reason: "knockout", targetId: "rival" },
    ]);
  });

  it("casts at the Target's chest even with the framing nudged", () => {
    const duel = fight();
    toggleLock(duel);
    hold(duel, intent({ look: { pitch: 0, yaw: 4 } }), 0.3);

    const cast = run(duel, 1, {
      hero: intent({ lightSpell: true, look: { pitch: 0, yaw: 4 } }),
    });

    const { lockNudge } = duelist(duel, "hero");
    const events = [...cast, ...settle(duel)];

    expect(lockNudge.yaw).toBeGreaterThan(0.1);
    expect(ofType(events, "spell-hit")).toMatchObject([{ targetId: "rival" }]);
  });

  it("homes in on the Target weakly, turning no faster than its turn rate", () => {
    const duel = fight();
    toggleLock(duel);
    run(duel, 1, { hero: castLight });
    const turns: number[] = [];

    for (let tick = 0; tick < 8; tick += 1) {
      const before = duel.snapshot().spells[0]?.velocity;
      run(duel, 1, { rival: rivalStrafes });
      const after = duel.snapshot().spells[0]?.velocity;

      if (before && after) {
        const dot =
          (before.x * after.x + before.y * after.y + before.z * after.z) /
          (Math.hypot(before.x, before.y, before.z) *
            Math.hypot(after.x, after.y, after.z));

        turns.push(Math.acos(Math.min(dot, 1)));
      }
    }

    const mostPerTick = tuning.lockOn.homing.turnRate / tuning.tickRate;
    expect(turns.length).toBeGreaterThan(4);
    expect(Math.max(...turns)).toBeGreaterThan(0);
    expect(Math.max(...turns)).toBeLessThanOrEqual(mostPerTick + 1e-9);
  });

  it("is not escaped by jogging sideways at mid range", () => {
    const duel = fight();
    toggleLock(duel);

    const events = [
      ...run(duel, 1, { hero: castLight, rival: rivalStrafes }),
      ...run(duel, secondsToTicks(1.5), { rival: rivalStrafes }),
    ];

    expect(ofType(events, "spell-cast")).toHaveLength(1);
    expect(ofType(events, "spell-hit")).toHaveLength(1);
  });

  it("can be escaped by sprinting sideways at mid range", () => {
    const duel = fight();
    toggleLock(duel);
    const sprints = intent({ move: { x: -1, y: 0 }, sprint: true });

    const events = [
      ...run(duel, 1, { hero: castLight, rival: sprints }),
      ...run(duel, secondsToTicks(1.5), { rival: sprints }),
    ];

    expect(ofType(events, "spell-cast")).toHaveLength(1);
    expect(ofType(events, "spell-hit")).toStrictEqual([]);
  });

  it("is let go at the start of every Round", () => {
    const duel = fight();
    toggleLock(duel);
    knockOutRival(duel);

    nextRound(duel);

    expect(duelist(duel, "hero").targetId).toBeNull();
  });
});

describe("Rounds and the Duel", () => {
  it("counts down an intro at the start of the Duel during which nobody can act", () => {
    const duel = createOneVsOne();

    expect(duel.snapshot().round).toMatchObject({
      number: 1,
      phase: "intro",
      phaseSecondsLeft: tuning.round.introSeconds,
    });

    const during = run(duel, secondsToTicks(tuning.round.introSeconds) - 1, {
      hero: intent({ lightSpell: true, move: { x: 0, y: 1 } }),
    });

    expect(ofType(during, "spell-cast")).toStrictEqual([]);
    expect(duelist(duel, "hero").position).toStrictEqual({ x: 0, z: 5 });

    expect(run(duel, 1)).toStrictEqual([{ round: 1, type: "round-start" }]);
    expect(duel.snapshot().round.phase).toBe("fighting");
  });

  it("knocks out a Duelist at zero Health, which ends the Round for the other Team", () => {
    const duel = fight();

    const events = knockOutRival(duel);

    expect(duelist(duel, "rival")).toMatchObject({
      health: 0,
      knockedOut: true,
    });
    expect(
      events.filter(
        (event) => event.type === "knockout" || event.type === "round-end"
      )
    ).toMatchObject([
      { duelistId: "rival", type: "knockout" },
      { round: 1, type: "round-end", winner: "gryffindor" },
    ]);
    expect(duel.snapshot().round).toMatchObject({
      phase: "knockout",
      winner: "gryffindor",
    });
    expect(duel.snapshot().score).toStrictEqual({
      gryffindor: 1,
      slytherin: 0,
    });
  });

  it("starts the next Round with Health and positions reset, after the Knockout and the result", () => {
    const duel = fight();
    tapLight(duel, "hero");
    hold(duel, intent({ move: { x: 1, y: 0 } }), 1);
    hold(duel, intent({ move: { x: -1, y: 0 } }), 1);
    knockOutRival(duel);

    nextRound(duel);

    expect(duel.snapshot().round).toMatchObject({ number: 2, phase: "intro" });
    expect(duel.snapshot().spells).toStrictEqual([]);
    expect(duelist(duel, "hero")).toMatchObject({
      health: tuning.duelist.health,
      knockedOut: false,
      position: { x: 0, z: 5 },
    });
    expect(duelist(duel, "rival")).toMatchObject({
      health: tuning.duelist.health,
      knockedOut: false,
      position: { x: 0, z: -5 },
    });
    expect(duel.snapshot().score).toStrictEqual({
      gryffindor: 1,
      slytherin: 0,
    });
  });

  it("ends the Duel when a Team wins its second Round", () => {
    const duel = fight();
    knockOutRival(duel);
    nextRound(duel);
    skipIntro(duel);

    const events = knockOutRival(duel);

    expect(ofType(events, "duel-end")).toStrictEqual([
      { type: "duel-end", winner: "gryffindor" },
    ]);
    expect(duel.snapshot().winner).toBe("gryffindor");

    // After the Knockout plays out, the Duel stays over: no third Round.
    run(duel, secondsToTicks(10));
    expect(duel.snapshot().round).toMatchObject({ number: 2, phase: "over" });
  });
});

/**
 * The hero holds the Heavy Spell for `seconds` (whole ticks), then lets go
 * for one tick; returns every event from the press to the release.
 */
const chargeAndRelease = (duel: Duel, seconds: number): DuelEvent[] => [
  ...run(duel, secondsToTicks(seconds), { hero: chargeHeavy }),
  ...run(duel, 1),
];

/** The hero Charges for `seconds` and releases at the rival; returns the cast and its hit. */
const confringoHit = (seconds: number) => {
  const duel = fight();
  const events = [...chargeAndRelease(duel, seconds), ...settle(duel)];

  return {
    cast: ofType(events, "spell-cast")[0],
    duel,
    events,
    hit: ofType(events, "spell-hit")[0],
  };
};

/** How far the rival has been pushed back from their spawn. */
const pushedBack = (duel: Duel) => {
  const { x, z } = duelist(duel, "rival").position;

  return Math.hypot(x, z + 5);
};

/**
 * Whether the rival has only moved from their spawn along the ground
 * direction of `velocity` (a Spell's flight), and forward along it.
 */
const movedAlong = (duel: Duel, velocity: Point3 | undefined) => {
  const { x, z } = duelist(duel, "rival").position;
  const moved = { x, z: z + 5 };
  const flight = { x: velocity?.x ?? 0, z: velocity?.z ?? 0 };
  const cross = moved.x * flight.z - moved.z * flight.x;
  const dot = moved.x * flight.x + moved.z * flight.z;

  return Math.abs(cross) / Math.hypot(flight.x, flight.z) < 1e-9 && dot > 0;
};

/** How long the Charge Backfires after the press: the fill time plus the short moment past full. */
const backfireSeconds =
  tuning.confringo.fullSeconds + tuning.confringo.backfire.delaySeconds;

/** A Charge held full but short of its Backfire, and outside the Perfect Release window. */
const heldFull = 0.58;

/** The hero holds the Heavy Spell one tick past the moment it Backfires; returns those ticks' events. */
const overcharge = (duel: Duel): DuelEvent[] =>
  run(duel, secondsToTicks(backfireSeconds) + 1, { hero: chargeHeavy });

/** The launch velocity of a quick Confringo aimed just outside the edge of a rival 14 m away. */
const confringoLaunch = (settings: Tuning) => {
  const duel = duelAimedBeyondEdge(14, 0.015, settings);
  const [cast] = ofType(chargeAndRelease(duel, 0.3), "spell-cast");

  return cast?.spell.velocity;
};

describe("Confringo and Charge", () => {
  it("Charges while the Heavy Spell is held and casts Confringo on release", () => {
    const duel = fight();

    const [charging] = hold(duel, chargeHeavy, 0.25).duelists;
    const released = run(duel, 1);

    expect(charging?.chargeSeconds).toBeCloseTo(0.25);
    // Half the time to a full Charge is half a Charge.
    expect(ofType(released, "spell-cast")).toMatchObject([
      {
        spell: {
          casterId: "hero",
          charge: 0.5,
          empowered: false,
          kind: "confringo",
        },
      },
    ]);
    expect(duelist(duel, "hero").chargeSeconds).toBe(0);
  });

  it("fills the Charge in 0.5 s and caps it there", () => {
    const duel = fight();
    const events = chargeAndRelease(duel, heldFull);

    expect(tuning.confringo.fullSeconds).toBe(0.5);
    expect(ofType(events, "spell-cast")[0]?.spell.charge).toBe(1);
    // Short of full, the Charge is the share of the fill time held.
    expect(
      ofType(chargeAndRelease(fight(), 0.4), "spell-cast")[0]?.spell.charge
    ).toBeCloseTo(0.8);
  });

  it("deals heavy damage scaled by the Charge: a tap is weak, a full Charge strong", () => {
    const tap = confringoHit(0.2);
    const full = confringoHit(heldFull);

    expect(tap.hit?.damage).toBeGreaterThan(tuning.confringo.damage.min);
    expect(tap.hit?.damage).toBeLessThan(full.hit?.damage ?? 0);
    expect(full.hit).toMatchObject({
      damage: tuning.confringo.damage.full,
      spell: { kind: "confringo" },
      targetId: "rival",
    });
    expect(duelist(full.duel, "rival").health).toBe(
      tuning.duelist.health - tuning.confringo.damage.full
    );
  });

  it("knocks the Duelist it hits back along its flight, farther with more Charge", () => {
    const tap = confringoHit(0.2);
    const full = confringoHit(heldFull);

    expect(pushedBack(full.duel)).toBeCloseTo(tuning.confringo.knockback.full);
    expect(pushedBack(tap.duel)).toBeGreaterThan(0);
    expect(pushedBack(tap.duel)).toBeLessThan(pushedBack(full.duel));
    expect(movedAlong(full.duel, full.cast?.spell.velocity)).toBeTruthy();
  });

  it("stops the Duelist it knocks back from moving or casting until they come to a stop", () => {
    const duel = fight();
    const events = chargeAndRelease(duel, heldFull);
    const velocity = ofType(events, "spell-cast")[0]?.spell.velocity;

    for (
      let tick = 0;
      tick < secondsToTicks(1.5) && ofType(events, "spell-hit").length === 0;
      tick += 1
    ) {
      events.push(...run(duel, 1));
    }

    const sliding = run(
      duel,
      secondsToTicks(tuning.confringo.knockback.seconds) - 1,
      { rival: rivalTries }
    );

    // Trying to strafe did nothing: the slide alone moved them.
    const slidOnly = movedAlong(duel, velocity);
    run(duel, 1);
    const recovered = run(duel, 2, { rival: rivalTries });

    expect(duelist(duel, "rival").knockbackSeconds).toBe(0);
    expect(ofType(sliding, "spell-cast")).toStrictEqual([]);
    expect(slidOnly).toBeTruthy();
    expect(ofType(recovered, "spell-cast")).toMatchObject([
      { spell: { casterId: "rival" } },
    ]);
  });

  it("slows the Duelist's movement while Charging", () => {
    const walking = fightLookingDownTheArena();
    const charging = fightLookingDownTheArena();
    const forward = { x: 0, y: 1 };

    hold(walking, intent({ move: forward }), 0.5);
    hold(charging, intent({ heavySpell: true, move: forward }), 0.5);

    const walked = 5 - duelist(walking, "hero").position.z;
    const crept = 5 - duelist(charging, "hero").position.z;

    expect(crept / walked).toBeCloseTo(tuning.confringo.chargeMoveScale);
  });

  describe.each([0.47, 0.5, 0.55])("released after %s s", (seconds) => {
    it("is a Perfect Release: a full Charge, empowered, with a Perfect Release event", () => {
      const { cast, events, hit } = confringoHit(seconds);

      expect(ofType(events, "perfect-release")).toStrictEqual([
        { duelistId: "hero", spell: cast?.spell, type: "perfect-release" },
      ]);
      expect(cast?.spell).toMatchObject({
        charge: 1,
        empowered: true,
        kind: "confringo",
      });
      expect(hit?.damage).toBeGreaterThan(tuning.confringo.damage.full);
    });
  });

  describe.each([0.4, 0.58])("released after %s s", (seconds) => {
    it("is no Perfect Release", () => {
      const { cast, events, hit } = confringoHit(seconds);

      expect(ofType(events, "perfect-release")).toStrictEqual([]);
      expect(cast?.spell.empowered).toBeFalsy();
      expect(hit?.damage).toBeLessThanOrEqual(tuning.confringo.damage.full);
    });
  });

  it("knocks back farther after a Perfect Release", () => {
    const perfect = confringoHit(0.5);
    const full = confringoHit(heldFull);

    expect(pushedBack(perfect.duel)).toBeGreaterThan(pushedBack(full.duel));
  });

  it("holds a full Charge for only a moment: it Backfires 0.10 s past full", () => {
    const duel = fight();

    const safe = run(duel, secondsToTicks(backfireSeconds), {
      hero: chargeHeavy,
    });

    expect(tuning.confringo.backfire.delaySeconds).toBe(0.1);
    expect(ofType(safe, "backfire")).toStrictEqual([]);
    expect(duelist(duel, "hero").chargeSeconds).toBeCloseTo(backfireSeconds);
    expect(
      ofType(run(duel, 1, { hero: chargeHeavy }), "backfire")
    ).toHaveLength(1);
  });

  it("Backfires: no Spell, the caster Staggered for about 1 s and hurt", () => {
    const duel = fight();

    const events = [...overcharge(duel), ...run(duel, 1)];
    const [backfire] = ofType(events, "backfire");

    expect(backfire).toMatchObject({
      damage: tuning.confringo.backfire.damage,
      duelistId: "hero",
    });
    expect(ofType(events, "spell-cast")).toStrictEqual([]);
    expect(duelist(duel, "hero").chargeSeconds).toBe(0);
    expect(duelist(duel, "hero").staggerSeconds).toBeCloseTo(
      tuning.confringo.backfire.staggerSeconds,
      1
    );
  });

  it("takes the Backfire damage off the caster's Health, about 8", () => {
    const duel = fight();

    overcharge(duel);

    expect(tuning.confringo.backfire.damage).toBe(8);
    expect(duelist(duel, "hero").health).toBe(
      tuning.duelist.health - tuning.confringo.backfire.damage
    );
    expect(duelist(duel, "rival").health).toBe(tuning.duelist.health);
  });

  it("Knocks Out a caster whose Backfire takes their last Health: the Round goes to the opponent", () => {
    const duel = fight();
    const events: DuelEvent[] = [];

    for (
      let backfires = 0;
      backfires < 30 && duel.snapshot().round.phase === "fighting";
      backfires += 1
    ) {
      events.push(...overcharge(duel), ...run(duel, secondsToTicks(1.2)));
    }

    expect(duelist(duel, "hero")).toMatchObject({
      health: 0,
      knockedOut: true,
    });
    expect(
      events.filter(
        (event) => event.type === "knockout" || event.type === "round-end"
      )
    ).toMatchObject([
      { duelistId: "hero", type: "knockout" },
      { round: 1, type: "round-end", winner: "slytherin" },
    ]);
    expect(duel.snapshot().score).toStrictEqual({
      gryffindor: 0,
      slytherin: 1,
    });
  });

  it("leaves a Backfired caster unable to move or cast for about 1 s", () => {
    const duel = fight();
    const start = duelist(duel, "hero").position;
    const tries = intent({ lightSpell: true, move: { x: 1, y: 0 } });
    overcharge(duel);

    const staggered = run(duel, secondsToTicks(0.9), { hero: tries });
    const moved = duelist(duel, "hero").position;
    run(duel, secondsToTicks(0.2));
    const recovered = run(duel, 2, { hero: tries });

    expect(ofType(staggered, "spell-cast")).toStrictEqual([]);
    expect(moved).toStrictEqual(start);
    expect(ofType(recovered, "spell-cast")).toHaveLength(1);
  });

  it("loses the Charge when knocked back mid-Charge", () => {
    const duel = fight();
    // The rival starts Charging as the hero taps a quick Confringo at them.
    const rivalCharges = intent({ heavySpell: true });

    const events = [
      ...run(duel, secondsToTicks(0.1), {
        hero: chargeHeavy,
        rival: rivalCharges,
      }),
      ...run(duel, secondsToTicks(1), { rival: rivalCharges }),
      ...run(duel, 1),
    ];

    expect(ofType(events, "spell-hit")).toMatchObject([{ targetId: "rival" }]);
    expect(
      ofType(events, "spell-cast").filter(
        ({ spell }) => spell.casterId === "rival"
      )
    ).toStrictEqual([]);
  });

  it("does not cast the Light Spell while Charging", () => {
    const duel = fight();

    const events = run(duel, secondsToTicks(0.5), {
      hero: intent({ heavySpell: true, lightSpell: true }),
    });

    expect(ofType(events, "spell-cast")).toStrictEqual([]);
  });

  it("homes in on the Target while Locked On, like Stupefy", () => {
    const duel = fight();
    toggleLock(duel);

    const events = chargeAndRelease(duel, 0.3);

    expect(ofType(events, "spell-cast")[0]?.spell.homing).toMatchObject({
      targetId: "rival",
    });
  });

  it("bends toward an opponent at the edge of the crosshair, like Stupefy", () => {
    const bendOnly: Tuning = {
      ...tuning,
      aimAssist: { ...tuning.aimAssist, friction: 1 },
    };

    expect(confringoLaunch(bendOnly)).not.toStrictEqual(
      confringoLaunch(withoutAimAssist)
    );
  });
});
