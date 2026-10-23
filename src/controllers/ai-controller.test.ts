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
}

/**
 * Runs a Duel between an AI of `difficulty` (seeded with `seed`) and a
 * scripted player, past the Round intro, for `seconds` of fighting (or until
 * the Duel is over). The player stands `gap` metres away.
 */
const play = ({
  arena = openArena,
  difficulty,
  gap = 10,
  player = idleController,
  seconds,
  seed,
  sturdy = false,
  settings = tuning,
}: {
  readonly arena?: ArenaLayout;
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
      { id: "player", spawn: { x: 0, z: gap / 2 }, team: "near" },
      { id: "ai", spawn: { x: 0, z: -gap / 2 }, team: "far" },
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
  }

  return { events, snapshots };
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

      // Every cast homes on the player: it was cast Locked On to them.
      const homing = new Set(
        casts.map((event) => event.spell.homing?.targetId)
      );

      expect(kinds).toStrictEqual(new Set(["confringo", "stupefy"]));
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
