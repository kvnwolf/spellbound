/**
 * The AI Controller through the Duel seam: an AI-driven Duelist against a
 * scripted one in a real Duel, many seeded trials per Difficulty, asserting
 * what the snapshots and events show it did.
 */
import { describe, expect, it } from "vitest";

import { sightBlocked } from "../duel/aim";
import type { Difficulty } from "../duel/difficulty";
import { createDuel } from "../duel/duel";
import type {
  ArenaLayout,
  DuelEvent,
  DuelistState,
  DuelSnapshot,
  SpellState,
} from "../duel/duel";
import { distanceBetween } from "../duel/geometry";
import { idleIntent } from "../duel/intent";
import type { Intent } from "../duel/intent";
import { tuning } from "../tuning";
import type { Tuning } from "../tuning";
import { createAiController } from "./ai-controller";
import type { Controller } from "./controller";
import { idleController } from "./controller";
import { createRandom } from "./random";

const openArena: ArenaLayout = {
  bounds: { halfDepth: 14, halfWidth: 11 },
  cover: [],
  obstructions: [],
};

const ticksOf = (seconds: number) => Math.round(seconds * tuning.tickRate);

const seeds = (count: number) => Array.from({ length: count }, (_, i) => i + 1);

/** Everything a Duel between the AI ("ai") and a scripted player ("player") produced. */
interface Played {
  readonly snapshots: readonly DuelSnapshot[];
  readonly events: readonly DuelEvent[];
  /** Tick by tick: the snapshot the Controllers decided from, and the events the tick produced. */
  readonly ticks: readonly {
    readonly seen: DuelSnapshot;
    readonly events: readonly DuelEvent[];
  }[];
}

/**
 * Runs a Duel between an AI of `difficulty` (seeded with `seed`) and a
 * scripted player, past the Round intro, for `seconds` of fighting (or until
 * the Duel is over). The player stands `gap` metres away, the AI `back`
 * metres further from the middle of the Arena.
 */
const play = ({
  arena = openArena,
  back = 0,
  difficulty,
  gap = 10,
  player = idleController,
  seconds,
  seed,
  sturdy = false,
  settings = tuning,
}: {
  readonly arena?: ArenaLayout;
  readonly back?: number;
  readonly difficulty: Difficulty;
  readonly gap?: number;
  readonly player?: Controller;
  readonly seconds: number;
  readonly seed: number;
  /** Lets both Duelists take far more punishment, so a long stretch of fighting stays in one Round. */
  readonly sturdy?: boolean;
  /** The tuning the Duel and the AI run on. */
  readonly settings?: Tuning;
}): Played => {
  const duel = createDuel({
    arena,
    difficulty,
    duelists: [
      { id: "player", spawn: { x: 0, z: gap / 2 - back }, team: "near" },
      { id: "ai", spawn: { x: 0, z: -gap / 2 - back }, team: "far" },
    ],
    tuning: sturdy
      ? { ...settings, duelist: { ...settings.duelist, health: 100_000 } }
      : settings,
  });

  const ai = createAiController({
    arena,
    difficulty,
    random: createRandom(seed),
    tuning: settings,
  });

  const snapshots: DuelSnapshot[] = [];
  const events: DuelEvent[] = [];
  const ticks: Played["ticks"][number][] = [];
  const fightTicks = ticksOf(seconds);
  let fought = 0;

  while (fought < fightTicks && duel.snapshot().winner === null) {
    const snapshot = duel.snapshot();

    const tick = duel.step({
      ai: ai.intent({ self: "ai", snapshot }),
      player: player.intent({ self: "player", snapshot }),
    });

    if (tick.snapshot.round.phase === "fighting") {
      fought += 1;
    }

    snapshots.push(tick.snapshot);
    events.push(...tick.events);
    ticks.push({ events: tick.events, seen: snapshot });
  }

  return { events, snapshots, ticks };
};

const ofType = <T extends DuelEvent["type"]>(
  events: readonly DuelEvent[],
  type: T
) =>
  events.filter(
    (event): event is Extract<DuelEvent, { type: T }> => event.type === type
  );

const byAi = (event: { readonly duelistId: string }) =>
  event.duelistId === "ai";

const find = (snapshot: DuelSnapshot | undefined, id: string): DuelistState => {
  const found = snapshot?.duelists.find((each) => each.id === id);

  if (!found) {
    throw new Error(`No Duelist ${id}`);
  }

  return found;
};

/**
 * A scripted player standing still, Locked On to the AI (pressing R3
 * whenever unlocked) and tapping Stupefy every `everySeconds`.
 */
const steadyCaster = (everySeconds: number): Controller => {
  let tick = 0;
  const every = ticksOf(everySeconds);

  return {
    intent: ({ self, snapshot }): Intent => {
      tick += 1;
      const unlocked = find(snapshot, self).targetId === null;

      return {
        ...idleIntent,
        lightSpell: tick % every === 0,
        lockOn: unlocked && tick % 10 === 0,
      };
    },
  };
};

/**
 * A scripted player who Overcharges a Confringo into a Backfire a few
 * seconds into the fight, then stands there Staggered.
 */
const backfiringPlayer = (): Controller => {
  let tick = 0;
  const from = ticksOf(4.5);
  const until = from + ticksOf(0.8);

  return {
    intent: ({ snapshot }) => {
      if (snapshot.round.phase === "fighting") {
        tick += 1;
      }

      return { ...idleIntent, heavySpell: tick >= from && tick < until };
    },
  };
};

/** Where the AI stood, tick by tick: the same seed must give the same walk. */
const trace = (seed: number) =>
  play({ difficulty: "maestro", seconds: 10, seed })
    .snapshots.map((each) => find(each, "ai").position)
    .map(({ x, z }) => `${x.toFixed(4)},${z.toFixed(4)}`)
    .join(" ");

/**
 * Per Difficulty, over many seeded trials against a steady caster: the share
 * of the player's Spells the AI answered with a defence (raising the Shield,
 * a Dodge or a jump), and the share it Parried.
 */
const defended = (difficulty: Difficulty) => {
  let casts = 0;
  let defences = 0;
  let parries = 0;

  for (const seed of seeds(12)) {
    const { events, snapshots } = play({
      difficulty,
      player: steadyCaster(1.3),
      seconds: 20,
      seed,
      sturdy: true,
    });

    const shieldsRaised = snapshots.filter(
      (each, index) =>
        find(each, "ai").shielding &&
        !find(snapshots[index - 1] ?? each, "ai").shielding
    ).length;

    casts += ofType(events, "spell-cast").filter(
      (event) => event.spell.casterId === "player"
    ).length;
    parries += ofType(events, "parry").filter(byAi).length;
    defences +=
      shieldsRaised +
      ofType(events, "dodge").filter(byAi).length +
      ofType(events, "jump").filter(byAi).length;
  }

  return { defences: defences / casts, parries: parries / casts };
};

const withColumns: ArenaLayout = {
  ...openArena,
  cover: [
    { center: { x: -4, z: -4 }, radius: 0.55 },
    { center: { x: 4, z: -4 }, radius: 0.55 },
    { center: { x: -4, z: 4 }, radius: 0.55 },
    { center: { x: 4, z: 4 }, radius: 0.55 },
    { center: { x: -7.5, z: 0 }, radius: 0.55 },
    { center: { x: 7.5, z: 0 }, radius: 0.55 },
  ],
};

/** Per seeded trial on Duelista, the longest the AI stayed out of the player's sight behind a column, in seconds. */
const longestHidden = (settings: Tuning) =>
  seeds(12).map((seed) => {
    let stretch = 0;
    let longest = 0;

    for (const each of play({
      arena: withColumns,
      difficulty: "duelista",
      player: steadyCaster(0.5),
      seconds: 20,
      seed,
      settings,
      sturdy: true,
    }).snapshots) {
      const hidden = sightBlocked(
        find(each, "ai").position,
        find(each, "player").position,
        withColumns.cover
      );

      stretch = hidden ? stretch + 1 : 0;
      longest = Math.max(longest, stretch);
    }

    return longest / tuning.tickRate;
  });

const backfires = (difficulty: Difficulty) =>
  seeds(10).reduce(
    (sum, seed) =>
      sum +
      ofType(play({ difficulty, seconds: 30, seed }).events, "backfire").length,
    0
  );

/** Share of trials where the AI cast a Confringo while the player was Staggered by its own Backfire. */
const punished = (difficulty: Difficulty) => {
  const trials = seeds(20).map((seed) => {
    const { events, snapshots } = play({
      difficulty,
      player: backfiringPlayer(),
      seconds: 7,
      seed,
      sturdy: true,
    });

    const backfire = ofType(events, "backfire").find(
      (event) => event.duelistId === "player"
    );

    const from = snapshots.findIndex(
      (each) => find(each, "player").staggerSeconds > 0.9
    );

    const window = snapshots.slice(
      from,
      from + ticksOf(tuning.confringo.backfire.staggerSeconds)
    );

    const castDuring = new Set(
      window.flatMap((each) =>
        each.spells
          .filter(
            (spell) => spell.casterId === "ai" && spell.kind === "confringo"
          )
          .map((spell) => spell.id)
      )
    );

    const before = new Set(
      (snapshots[from - 1]?.spells ?? []).map((spell) => spell.id)
    );

    return {
      backfired: backfire !== undefined,
      punished: [...castDuring].some((id) => !before.has(id)),
    };
  });

  const backfired = trials.filter((each) => each.backfired);

  return backfired.filter((each) => each.punished).length / backfired.length;
};

/** Share of seeded Duels a steady Stupefy caster wins against the AI. */
const playerWins = (difficulty: Difficulty) =>
  seeds(10).filter(
    (seed) =>
      play({
        difficulty,
        player: steadyCaster(0.6),
        seconds: 240,
        seed,
      }).snapshots.at(-1)?.winner === "near"
  ).length / 10;

describe("AI Controller", () => {
  it("Locks On to its opponent with R3, like a player", () => {
    const { events, snapshots } = play({
      difficulty: "duelista",
      seconds: 1,
      seed: 1,
    });

    expect(ofType(events, "lock-on")).toContainEqual({
      duelistId: "ai",
      targetId: "player",
      type: "lock-on",
    });
    expect(find(snapshots.at(-1), "ai").targetId).toBe("player");
  });

  it.each(["novato", "duelista", "maestro"] as const)(
    "casts Stupefy and Confringo at its Target on %s",
    (difficulty) => {
      const casts = seeds(5).flatMap((seed) =>
        ofType(
          play({ difficulty, seconds: 20, seed }).events,
          "spell-cast"
        ).filter((event) => event.spell.casterId === "ai")
      );

      const kinds = new Set(casts.map((event) => event.spell.kind));

      // Every Spell that flies homes on the player: it was cast Locked On
      // to them (Depulso's cone never flies).
      const homing = new Set(
        casts
          .filter((event) => event.spell.kind !== "depulso")
          .map((event) => event.spell.homing?.targetId)
      );

      expect(kinds).toContain("confringo");
      expect(kinds).toContain("stupefy");
      expect(homing).toStrictEqual(new Set(["player"]));
    }
  );

  it.each(["novato", "duelista", "maestro"] as const)(
    "closes in from afar and backs off up close to keep within its band on %s",
    (difficulty) => {
      const { band } = tuning.ai.profiles[difficulty];
      const settle = ticksOf(4);

      const distances = [3, 22].flatMap((gap) =>
        seeds(5).flatMap((seed) =>
          play({ difficulty, gap, seconds: 15, seed, sturdy: true })
            .snapshots.filter((each) => each.round.phase === "fighting")
            .slice(settle)
            .map((each) =>
              distanceBetween(
                find(each, "ai").position,
                find(each, "player").position
              )
            )
        )
      );

      const kept = distances.filter(
        (distance) => distance >= band.min - 0.5 && distance <= band.max + 0.5
      );

      // Out of it only for a moment, after knocking the player back with a Confringo.
      expect(kept.length / distances.length).toBeGreaterThan(0.85);
    }
  );

  it("strafes round its Target instead of standing like a turret", () => {
    const walked = seeds(5).map((seed) => {
      const fighting = play({
        difficulty: "duelista",
        seconds: 10,
        seed,
        sturdy: true,
      })
        .snapshots.filter((each) => each.round.phase === "fighting")
        .map((each) => find(each, "ai").position);

      return fighting
        .slice(1)
        .reduce(
          (sum, point, index) =>
            sum + distanceBetween(fighting[index] ?? point, point),
          0
        );
    });

    // Already in its band from the start, so all of this is strafing.
    expect(Math.min(...walked)).toBeGreaterThan(5);
  });

  it("replays exactly with the same seed, and differently with another", () => {
    expect(trace(7)).toBe(trace(7));
    expect(trace(7)).not.toBe(trace(8));
  });
});

describe("AI defence", () => {
  it("defends incoming Spells far more often on Maestro than on Novato", () => {
    const novato = defended("novato");
    const duelista = defended("duelista");
    const maestro = defended("maestro");

    expect(novato.defences).toBeLessThan(0.35);
    expect(duelista.defences).toBeGreaterThan(novato.defences);
    expect(maestro.defences).toBeGreaterThan(duelista.defences);
    expect(maestro.defences).toBeGreaterThan(0.7);
  });

  it("Parries far more often on Maestro than on Novato", () => {
    expect(defended("maestro").parries).toBeGreaterThan(
      defended("novato").parries * 3
    );
  });

  it("ducks behind a column for a while in some Duels after being hit, not in most", () => {
    const hiding = longestHidden(tuning).filter(
      (seconds) => seconds >= tuning.ai.cover.seconds.min
    );

    expect(hiding.length).toBeGreaterThan(0);
    expect(hiding.length).toBeLessThan(8);
  });

  it("only passes behind a column for a moment when it never takes Cover", () => {
    const { profiles } = tuning.ai;

    const neverCover: Tuning = {
      ...tuning,
      ai: {
        ...tuning.ai,
        profiles: {
          ...profiles,
          duelista: { ...profiles.duelista, coverChance: 0 },
        },
      },
    };

    expect(Math.max(...longestHidden(neverCover))).toBeLessThan(
      tuning.ai.cover.seconds.min
    );
  });
});

describe("AI attack", () => {
  it.each([
    ["maestro", 0.8, 1],
    ["novato", 0, 0.5],
  ] as const)(
    "times its Charge on %s: Perfect Release share between %d and %d",
    (difficulty, atLeast, atMost) => {
      let heavies = 0;
      let perfect = 0;

      for (const seed of seeds(10)) {
        const { events } = play({ difficulty, seconds: 30, seed });

        heavies +=
          ofType(events, "spell-cast").filter(
            (event) =>
              event.spell.casterId === "ai" && event.spell.kind === "confringo"
          ).length + ofType(events, "backfire").length;
        perfect += ofType(events, "perfect-release").length;
      }

      expect(perfect / heavies).toBeGreaterThanOrEqual(atLeast);
      expect(perfect / heavies).toBeLessThanOrEqual(atMost);
    }
  );

  it("Overcharges into a Backfire sometimes on Novato, never on Maestro", () => {
    expect(backfires("novato")).toBeGreaterThan(0);
    expect(backfires("maestro")).toBe(0);
  });

  it("punishes a Backfired opponent with a Confringo, nearly always on Maestro", () => {
    const maestro = punished("maestro");
    const novato = punished("novato");

    expect(maestro).toBeGreaterThan(0.85);
    expect(novato).toBeLessThan(maestro - 0.4);
  });

  it("is clearly beatable on Novato, and much harder on Maestro", () => {
    expect(playerWins("novato")).toBeGreaterThanOrEqual(0.8);
    expect(playerWins("maestro")).toBeLessThanOrEqual(0.3);
  });
});

/** A scripted player who Locks On and casts Expelliarmus (R2 + ○) two seconds into the fight. */
const disarmingPlayer = (): Controller => {
  let tick = 0;

  return {
    intent: ({ self, snapshot }) => {
      if (snapshot.round.phase === "fighting") {
        tick += 1;
      }

      return {
        ...idleIntent,
        lockOn: find(snapshot, self).targetId === null && tick % 10 === 1,
        spellSlots: {
          held: tick === ticksOf(2),
          press: tick === ticksOf(2) ? "circle" : null,
        },
      };
    },
  };
};

/** Expelliarmus for free, so the scripted player can cast it at once. */
const freeExpelliarmus: Tuning = {
  ...tuning,
  expelliarmus: { ...tuning.expelliarmus, segments: 0 },
};

describe("AI Disarmed", () => {
  it("gets its Wand back, holding fire meanwhile, and duels on", () => {
    const trials = seeds(8).map((seed) => {
      const { events } = play({
        difficulty: "novato",
        player: disarmingPlayer(),
        seconds: 14,
        seed,
        settings: freeExpelliarmus,
        sturdy: true,
      });

      const disarmAt = events.findIndex(
        (event) => event.type === "disarm" && event.duelistId === "ai"
      );

      const recoveredAt = events.findIndex(
        (event) => event.type === "wand-recovered" && event.duelistId === "ai"
      );

      const castBy = (from: number, to: number) =>
        ofType(events.slice(from, to), "spell-cast").filter(
          (event) => event.spell.casterId === "ai"
        ).length;

      return {
        castAfter: castBy(recoveredAt, events.length),
        castWhileDisarmed: castBy(disarmAt, recoveredAt),
        disarmed: disarmAt !== -1,
        recovered: recoveredAt > disarmAt,
      };
    });

    const disarmed = trials.filter((each) => each.disarmed);

    expect(disarmed.length).toBeGreaterThan(0);

    for (const trial of disarmed) {
      expect(trial).toMatchObject({ castWhileDisarmed: 0, recovered: true });
      expect(trial.castAfter).toBeGreaterThan(0);
    }
  });
});

/**
 * Locks the AI ("ai") and a scripted player into a Clash (both release a
 * full Confringo at once, head-on), then lets an AI of `difficulty` drive
 * for `seconds` while the player pumps only on the ticks `playerPumps`
 * says. Returns the events from the moment the Clash started.
 */
const clashFor = ({
  difficulty,
  playerPumps = () => false,
  seconds,
  seed,
}: {
  readonly difficulty: Difficulty;
  readonly playerPumps?: (tick: number) => boolean;
  readonly seconds: number;
  readonly seed: number;
}): DuelEvent[] => {
  const duel = createDuel({
    arena: openArena,
    difficulty,
    duelists: [
      { id: "player", spawn: { x: 0, z: 5 }, team: "near" },
      { id: "ai", spawn: { x: 0, z: -5 }, team: "far" },
    ],
    tuning,
  });

  while (duel.snapshot().round.phase === "intro") {
    duel.step({});
  }

  const charge = { ...idleIntent, heavySpell: true };
  const full = ticksOf(tuning.confringo.fullSeconds);

  for (let tick = 0; tick < full + 1; tick += 1) {
    const held = tick < full ? charge : idleIntent;
    duel.step({ ai: held, player: held });
  }

  while (duel.snapshot().clash === null) {
    duel.step({});
  }

  const ai = createAiController({
    arena: openArena,
    difficulty,
    random: createRandom(seed),
    tuning,
  });

  const events: DuelEvent[] = [];

  for (let tick = 0; tick < ticksOf(seconds); tick += 1) {
    const snapshot = duel.snapshot();

    events.push(
      ...duel.step({
        ai: ai.intent({ self: "ai", snapshot }),
        player: { ...idleIntent, clashPump: playerPumps(tick) },
      }).events
    );
  }

  return events;
};

/** How many times the AI pumped. */
const aiPumps = (events: readonly DuelEvent[]) =>
  ofType(events, "clash-pump").filter((event) => event.duelistId === "ai")
    .length;

/** The AI's pumps in the first second of a Clash, averaged over 10 seeds. */
const pumpRate = (difficulty: Difficulty) =>
  seeds(10).reduce(
    (sum, seed) => sum + aiPumps(clashFor({ difficulty, seconds: 1, seed })),
    0
  ) / 10;

/** A player pressing R2 every 12 ticks: 5 pumps a second. */
const steadyPumps = (tick: number) => tick % 12 < 6;

/** Who wins a Clash between the AI and a player pumping 5 times a second. */
const clashWinner = (difficulty: Difficulty, seed: number) =>
  ofType(
    clashFor({ difficulty, playerPumps: steadyPumps, seconds: 7, seed }),
    "clash-end"
  )[0]?.winnerId;

describe("AI in a Clash", () => {
  it.each(["novato", "duelista", "maestro"] as const)(
    "pumps on %s and wins against an opponent who does not",
    (difficulty) => {
      for (const seed of seeds(5)) {
        const events = clashFor({
          difficulty,
          seconds: tuning.clash.seconds,
          seed,
        });

        expect(ofType(events, "clash-end")).toMatchObject([
          { outcome: "won", winnerId: "ai" },
        ]);
      }
    }
  );

  it("pumps far faster on Maestro than on Novato", () => {
    expect(pumpRate("maestro")).toBeGreaterThan(pumpRate("duelista"));
    expect(pumpRate("duelista")).toBeGreaterThan(pumpRate("novato"));
    expect(pumpRate("maestro")).toBeGreaterThan(pumpRate("novato") * 1.8);
  });

  it("beats a player pumping 5 times a second on Maestro, and loses to them on Novato", () => {
    for (const seed of seeds(5)) {
      expect(clashWinner("maestro", seed)).toBe("ai");
      expect(clashWinner("novato", seed)).toBe("player");
    }
  });
});

/** The courtyard's layout: columns of Cover and the fountain, an Obstruction, in the middle. */
const courtyardLike: ArenaLayout = {
  ...withColumns,
  obstructions: [{ center: { x: 0, z: 0 }, radius: 1.65 }],
};

/** Expelliarmus for free and with no Cooldown, so the scripted player can keep casting it. */
const spamExpelliarmus: Tuning = {
  ...tuning,
  expelliarmus: { ...tuning.expelliarmus, cooldownSeconds: 0, segments: 0 },
};

/**
 * A scripted player who Locks On and keeps casting Expelliarmus (R2 + ○)
 * 1.5 seconds after the last one, from two seconds into the fight, while it
 * holds its own Wand and the AI holds theirs.
 */
const keepsDisarming = (): Controller => {
  let tick = 0;
  let due = ticksOf(2);

  return {
    intent: ({ self, snapshot }) => {
      if (snapshot.round.phase === "fighting") {
        tick += 1;
      }

      const me = find(snapshot, self);

      if (
        snapshot.spells.some(
          (spell) => spell.casterId === self && spell.kind === "expelliarmus"
        )
      ) {
        due = tick + ticksOf(1.5);
      }

      const cast =
        tick >= due &&
        me.looseWand === null &&
        find(snapshot, "ai").looseWand === null;

      return {
        ...idleIntent,
        lockOn: me.targetId === null && tick % 10 === 1,
        spellSlots: { held: cast, press: cast ? "circle" : null },
      };
    },
  };
};

const aiDisarmed = (each: DuelSnapshot) => find(each, "ai").looseWand !== null;

/** Seconds from the AI's first Disarm until it held its Wand again, and how it got it back; null if never Disarmed and back. */
const firstRecovery = (played: Played) => {
  const from = played.snapshots.findIndex(aiDisarmed);

  const back = played.snapshots.findIndex(
    (each, index) => index > from && !aiDisarmed(each)
  );

  if (from === -1 || back === -1) {
    return null;
  }

  const disarmAt = played.events.findIndex(
    (event) => event.type === "disarm" && event.duelistId === "ai"
  );

  return {
    how: ofType(played.events.slice(disarmAt), "wand-recovered").find(byAi)
      ?.how,
    seconds: (back - from) / tuning.tickRate,
  };
};

describe("AI recovering its Wand", () => {
  it.each(["novato", "duelista", "maestro"] as const)(
    "walks to its Wand and picks it up well before it would return on its own on %s",
    (difficulty) => {
      const recoveries = [openArena, courtyardLike].flatMap((arena) =>
        seeds(24).map((seed) =>
          firstRecovery(
            play({
              arena,
              difficulty,
              player: keepsDisarming(),
              seconds: 14,
              seed,
              settings: spamExpelliarmus,
              sturdy: true,
            })
          )
        )
      );

      const disarmed = recoveries.filter((each) => each !== null);

      expect(disarmed.length).toBeGreaterThanOrEqual(4);

      for (const recovery of disarmed) {
        expect(recovery.how).toBe("pickup");
        expect(recovery.seconds).toBeLessThan(
          tuning.expelliarmus.wand.returnSeconds / 2
        );
      }
    }
  );
});

/** A Spell of the player's in the air, flying toward the AI. */
const incoming = (snapshot: DuelSnapshot) => {
  const ai = find(snapshot, "ai").position;

  return snapshot.spells.some(
    (spell) =>
      spell.casterId === "player" &&
      (ai.x - spell.position.x) * spell.velocity.x +
        (ai.z - spell.position.z) * spell.velocity.z >
        0
  );
};

/** Depulso for free, so the AI can cast it without first earning Focus. */
const freeDepulso: Tuning = {
  ...tuning,
  depulso: { ...tuning.depulso, segments: 0 },
};

/**
 * Free Depulso, no Focus earned for Light Spell hits and no Stagger from the
 * strong Stupefy: Depulso is the only Special Spell in play, and the AI
 * cannot keep a player stepping in on it Staggered at bay.
 */
const onlyDepulso: Tuning = {
  ...freeDepulso,
  focus: { ...tuning.focus, gain: { ...tuning.focus.gain, lightSpellHit: 0 } },
  stupefy: { ...tuning.stupefy, staggerSeconds: 0 },
};

/**
 * A scripted player who Locks On and sprints at the AI, and once within 3 m
 * Charges Confringo over and over (held 0.45 s, released for a tick).
 */
const chargingInClose = (): Controller => {
  let tick = 0;

  return {
    intent: ({ self, snapshot }) => {
      if (snapshot.round.phase === "fighting") {
        tick += 1;
      }

      const me = find(snapshot, self);
      const gap = distanceBetween(me.position, find(snapshot, "ai").position);
      const close = gap <= 3 || me.chargeSeconds > 0;

      return {
        ...idleIntent,
        heavySpell: close && tick % ticksOf(0.45) !== 0,
        lockOn: me.targetId === null && tick % 10 === 1,
        move: { x: 0, y: gap > 2.5 ? 1 : 0 },
        sprint: !close,
      };
    },
  };
};

/** The AI's casts of `kind`, each with the snapshot the AI decided it from. */
const castsOf = ({ ticks }: Played, kind: string) =>
  ticks.flatMap(({ events, seen }) =>
    ofType(events, "spell-cast")
      .filter(
        (event) => event.spell.casterId === "ai" && event.spell.kind === kind
      )
      .map(() => seen)
  );

/**
 * A scripted player who Locks On and, every 2.4 seconds, holds the Shield up
 * for 1.2 s, then lowers it and taps Stupefy every 0.4 s.
 */
const shieldsAndCasts = (): Controller => {
  let tick = 0;

  return {
    intent: ({ self, snapshot }) => {
      if (snapshot.round.phase === "fighting") {
        tick += 1;
      }

      const shielding = tick % ticksOf(2.4) < ticksOf(1.2);

      return {
        ...idleIntent,
        lightSpell: !shielding && tick % ticksOf(0.4) === 0,
        lockOn: find(snapshot, self).targetId === null && tick % 10 === 1,
        shield: shielding,
      };
    },
  };
};

const specialKinds = new Set([
  "depulso",
  "expelliarmus",
  "incendio",
  "petrificus",
]);

/** Events tick by tick, from the tick a Spell was cast on. */
type EventsFrom = readonly (readonly DuelEvent[])[];

/**
 * Whether the AI's Special Spell `spell` paid off, from the events of the
 * ticks from its cast on: Depulso hurt the player, Incendio burned them,
 * Expelliarmus Disarmed them, or Petrificus froze them and another Spell of
 * the AI's hit them before they could move again.
 */
const paidOff = (spell: SpellState, from: EventsFrom) => {
  const within = (start: number, seconds: number) =>
    from.slice(start, start + ticksOf(seconds)).flat();

  const flight = within(0, 2);

  if (spell.kind === "expelliarmus") {
    return ofType(flight, "disarm").some(
      (event) => event.casterId === "ai" && event.duelistId === "player"
    );
  }

  if (spell.kind === "incendio") {
    return ofType(flight, "explosion").some(
      (event) => event.spell.id === spell.id && event.burned.includes("player")
    );
  }

  const hitAt = from.findIndex((events) =>
    ofType(events, "spell-hit").some(
      (event) => event.spell.id === spell.id && event.targetId === "player"
    )
  );

  if (hitAt === -1 || hitAt > ticksOf(2) || spell.kind !== "petrificus") {
    return hitAt !== -1 && hitAt <= ticksOf(2);
  }

  // Frozen, then a little more for the follow-up's flight.
  const frozen = within(hitAt + 1, tuning.petrificus.petrifiedSeconds + 0.3);

  return ofType(frozen, "spell-hit").some(
    (event) => event.spell.casterId === "ai" && event.targetId === "player"
  );
};

/** Over seeded Duels against a player who Shields and casts by turns: the AI's Special Spells cast, and how many paid off. */
const specialsOf = (difficulty: Difficulty) => {
  let casts = 0;
  let paid = 0;

  for (const seed of seeds(25)) {
    const { ticks } = play({
      difficulty,
      player: shieldsAndCasts(),
      seconds: 30,
      seed,
      sturdy: true,
    });

    const perTick = ticks.map((each) => each.events);

    for (const [index, events] of perTick.entries()) {
      for (const event of ofType(events, "spell-cast")) {
        if (
          event.spell.casterId === "ai" &&
          specialKinds.has(event.spell.kind)
        ) {
          casts += 1;
          paid += paidOff(event.spell, perTick.slice(index)) ? 1 : 0;
        }
      }
    }
  }

  return { casts, paidOff: paid };
};

/** How far apart the AI and the player stood, edge to edge. */
const reachIn = (snapshot: DuelSnapshot) =>
  distanceBetween(
    find(snapshot, "ai").position,
    find(snapshot, "player").position
  ) - tuning.duelist.bodyRadius;

describe("AI Special Spells", () => {
  it.each(["duelista", "maestro"] as const)(
    "blasts a player Charging up close with Depulso on %s",
    (difficulty) => {
      const trials = seeds(10).map((seed) =>
        castsOf(
          play({
            back: 8.5,
            difficulty,
            gap: 5,
            player: chargingInClose(),
            seconds: 11,
            seed,
            settings: onlyDepulso,
            sturdy: true,
          }),
          "depulso"
        )
      );

      expect(trials.filter((casts) => casts.length > 0).length).toBeGreaterThan(
        7
      );

      for (const seen of trials.flat()) {
        expect(reachIn(seen)).toBeLessThan(tuning.depulso.range);
      }
    }
  );

  it.each(["novato", "duelista", "maestro"] as const)(
    "never wastes Depulso on a player out of its reach on %s",
    (difficulty) => {
      for (const seed of seeds(5)) {
        const casts = castsOf(
          play({ difficulty, seconds: 15, seed, settings: freeDepulso }),
          "depulso"
        );

        for (const seen of casts) {
          expect(reachIn(seen)).toBeLessThan(tuning.depulso.range);
        }
      }
    }
  );

  it("leaves a human moment between a Light or Heavy Spell and a Special Spell, and casts no Special into a Spell on its way", () => {
    // Per Special Spell cast: ticks since the AI's last Light or Heavy
    // Spell, and whether it flew into a Spell on its way.
    const specials: { since: number; intoIncoming: boolean }[] = [];

    for (const seed of seeds(10)) {
      const { ticks } = play({
        difficulty: "maestro",
        player: shieldsAndCasts(),
        seconds: 30,
        seed,
        sturdy: true,
      });

      let lastCast = Number.NEGATIVE_INFINITY;

      for (const [index, { events, seen }] of ticks.entries()) {
        for (const { spell } of ofType(events, "spell-cast")) {
          if (spell.casterId === "ai" && specialKinds.has(spell.kind)) {
            specials.push({
              intoIncoming: spell.kind !== "depulso" && incoming(seen),
              since: index - lastCast,
            });
          } else if (spell.casterId === "ai") {
            lastCast = index;
          }
        }
      }
    }

    expect(specials.length).toBeGreaterThan(10);
    expect(
      Math.min(...specials.map((each) => each.since))
    ).toBeGreaterThanOrEqual(ticksOf(tuning.ai.specials.afterCastSeconds));
    expect(specials.map((each) => each.intoIncoming)).not.toContain(true);
  });

  it("casts Special Spells far more often, and to far better effect, on Maestro than on Novato", () => {
    const novato = specialsOf("novato");
    const maestro = specialsOf("maestro");

    expect(maestro.casts).toBeGreaterThan(novato.casts * 2);
    expect(maestro.paidOff / maestro.casts).toBeGreaterThan(
      novato.paidOff / novato.casts + 0.15
    );
    // Plays many whole Duels: slow on a busy machine.
  }, 20_000);
});

/**
 * Hurts the AI first, then hands it the controls: the scripted player Locks
 * On and Stupefies an AI standing idle until its Health is down to
 * `health`, then the AI Controller (of `difficulty`, seeded with `seed`)
 * takes over against `player` for `seconds`. Both stand 10 m apart.
 */
const afterHurt = ({
  difficulty,
  health = 25,
  player,
  seconds,
  seed,
}: {
  readonly difficulty: Difficulty;
  readonly health?: number;
  readonly player: Controller;
  readonly seconds: number;
  readonly seed: number;
}): Played => {
  const duel = createDuel({
    arena: openArena,
    difficulty,
    duelists: [
      { id: "player", spawn: { x: 0, z: 5 }, team: "near" },
      { id: "ai", spawn: { x: 0, z: -5 }, team: "far" },
    ],
    tuning,
  });

  const hurting = steadyCaster(0.3);

  while (find(duel.snapshot(), "ai").health > health) {
    const snapshot = duel.snapshot();

    duel.step({
      ai: idleIntent,
      player: hurting.intent({ self: "player", snapshot }),
    });
  }

  const ai = createAiController({
    arena: openArena,
    difficulty,
    random: createRandom(seed),
    tuning,
  });

  const snapshots: DuelSnapshot[] = [];
  const events: DuelEvent[] = [];
  const ticks: Played["ticks"][number][] = [];

  for (let tick = 0; tick < ticksOf(seconds); tick += 1) {
    const snapshot = duel.snapshot();

    const stepped = duel.step({
      ai: ai.intent({ self: "ai", snapshot }),
      player: player.intent({ self: "player", snapshot }),
    });

    snapshots.push(stepped.snapshot);
    events.push(...stepped.events);
    ticks.push({ events: stepped.events, seen: snapshot });
  }

  return { events, snapshots, ticks };
};

/** The snapshots the AI decided from when it started drinking `kind`. */
const drinksOf = ({ ticks }: Played, kind: string) =>
  ticks.flatMap(({ events, seen }) =>
    ofType(events, "potion-start")
      .filter((event) => event.duelistId === "ai" && event.kind === kind)
      .map(() => seen)
  );

describe("AI Potions", () => {
  it.each(["novato", "duelista", "maestro"] as const)(
    "drinks Wiggenweld at low Health when it is safe on %s",
    (difficulty) => {
      const healed = seeds(10).filter((seed) => {
        const played = afterHurt({
          difficulty,
          player: idleController,
          seconds: 4,
          seed,
        });

        return ofType(played.events, "potion-drunk").some(
          (event) => event.duelistId === "ai" && event.kind === "wiggenweld"
        );
      });

      expect(healed.length).toBeGreaterThanOrEqual(9);
    }
  );

  it.each(["novato", "duelista", "maestro"] as const)(
    "never starts drinking with a Spell on its way on %s",
    (difficulty) => {
      const drinks = seeds(10).flatMap((seed) =>
        drinksOf(
          afterHurt({
            difficulty,
            player: steadyCaster(0.5),
            seconds: 10,
            seed,
          }),
          "wiggenweld"
        )
      );

      // It does drink, between the player's Spells.
      expect(drinks.length).toBeGreaterThan(0);

      for (const seen of drinks) {
        expect(incoming(seen)).toBeFalsy();
      }
    }
  );

  it("keeps its Wiggenweld while its Health is high", () => {
    for (const seed of seeds(5)) {
      const played = afterHurt({
        difficulty: "maestro",
        health: 90,
        player: idleController,
        seconds: 4,
        seed,
      });

      expect(drinksOf(played, "wiggenweld")).toHaveLength(0);
    }
  });
});

/**
 * A scripted player who Locks On and stands behind the Shield, lowering it
 * only to drink Wiggenweld (L2 + □) every 3 seconds of the fight: a drink is
 * the only opening it gives.
 */
const drinksNow = (): Controller => {
  let tick = 0;

  return {
    intent: ({ self, snapshot }) => {
      if (snapshot.round.phase === "fighting") {
        tick += 1;
      }

      const me = find(snapshot, self);
      const due = tick > 0 && tick % ticksOf(3) === 0;

      return {
        ...idleIntent,
        lockOn: me.targetId === null && tick % 10 === 1,
        potionSlots: { held: due, press: due ? "square" : null },
        shield: !due && me.drinking === null,
      };
    },
  };
};

/** A Shield that never tires, so the player can hide behind it all Duel. */
const tirelessShield: Tuning = {
  ...tuning,
  defence: {
    ...tuning.defence,
    shield: { ...tuning.defence.shield, drain: 0 },
  },
};

/**
 * Per Difficulty, over seeded Duels, the share of the player's drinks the
 * AI answered within 0.75 s of the drink starting (a reaction and, for a
 * Confringo, its Charge) with a Spell, or that a Spell already on its way
 * cut short: going for the opening, not a cast that happened to fall there.
 */
const drinksPunished = (difficulty: Difficulty) => {
  let started = 0;
  let answered = 0;

  for (const seed of seeds(15)) {
    const perTick = play({
      difficulty,
      player: drinksNow(),
      seconds: 7,
      seed,
      settings: tirelessShield,
      sturdy: true,
    }).ticks.map((each) => each.events);

    for (const [index, events] of perTick.entries()) {
      if (
        ofType(events, "potion-start").some(
          (event) => event.duelistId === "player"
        )
      ) {
        started += 1;

        const soon = perTick.slice(index, index + ticksOf(0.75)).flat();

        const went =
          ofType(soon, "spell-cast").some(
            (event) => event.spell.casterId === "ai"
          ) ||
          // A Spell already on its way cut it short first.
          ofType(soon, "potion-interrupted").some(
            (event) => event.duelistId === "player"
          );

        answered += went ? 1 : 0;
      }
    }
  }

  return answered / started;
};

describe("AI punishing an opening", () => {
  it("goes for a drinking player at once nearly always on Maestro, far less on Novato", () => {
    const maestro = drinksPunished("maestro");

    expect(maestro).toBeGreaterThan(0.9);
    expect(drinksPunished("novato")).toBeLessThan(maestro - 0.25);
  });
});
