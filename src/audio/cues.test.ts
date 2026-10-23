import { describe, expect, it } from "vitest";

import { courtyard, courtyardSpawns } from "../arena/courtyard";
import type { Difficulty } from "../duel/difficulty";
import { createDuel } from "../duel/duel";
import type {
  DuelEvent,
  DuelistState,
  DuelSnapshot,
  SpellState,
} from "../duel/duel";
import type {
  DuelScreen,
  MenuInput,
  Screen,
  ScreenEvent,
} from "../screens/screens";
import { tuning } from "../tuning";
import { cuesFor, loopsFor, menuSoundFor } from "./cues";

const local = "local";
const opponent = "opponent";

const duelSnapshot = (): DuelSnapshot =>
  createDuel({
    arena: courtyard,
    duelists: [
      { id: local, spawn: courtyardSpawns.near, team: "near" },
      { id: opponent, spawn: courtyardSpawns.far, team: "far" },
    ],
    tuning,
  }).snapshot();

const spell = (
  casterId: string,
  overrides: Partial<SpellState> = {}
): SpellState => ({
  casterId,
  charge: 0,
  empowered: false,
  homing: null,
  id: 1,
  kind: "stupefy",
  position: { x: 0, y: 1.5, z: 0 },
  strong: false,
  team: casterId === local ? "near" : "far",
  velocity: { x: 0, y: 0, z: 1 },
  ...overrides,
});

const withDuelist = (
  snapshot: DuelSnapshot,
  id: string,
  patch: Partial<DuelistState>
): DuelSnapshot => ({
  ...snapshot,
  duelists: snapshot.duelists.map((each) =>
    each.id === id ? { ...each, ...patch } : each
  ),
});

const cues = (events: readonly DuelEvent[], after = duelSnapshot()) =>
  cuesFor({ after, before: after, events, localId: local, settings: tuning });

/** A fresh Duel in its intro, with `secondsLeft` of the countdown to go. */
const introAt = (secondsLeft: number): DuelSnapshot => {
  const snapshot = duelSnapshot();

  return {
    ...snapshot,
    round: { ...snapshot.round, phase: "intro", phaseSecondsLeft: secondsLeft },
  };
};

/** The countdown's sounds between two snapshots. */
const beats = (before: DuelSnapshot | null, after: DuelSnapshot) =>
  cuesFor({ after, before, events: [], localId: local, settings: tuning });

/** The sounds of one Duelist's state changing mid-Round, from `before` to `after`. */
const changes = (
  before: Partial<DuelistState> | null,
  after: Partial<DuelistState>,
  id = opponent
) => {
  const fresh = duelSnapshot();

  const snapshot: DuelSnapshot = {
    ...fresh,
    round: { ...fresh.round, phase: "fighting", phaseSecondsLeft: 0 },
  };

  return cuesFor({
    after: withDuelist(snapshot, id, after),
    before: before && withDuelist(snapshot, id, before),
    events: [],
    localId: local,
    settings: tuning,
  });
};

/** The sounds of the local Duelist's Charge going from `before` to `after` seconds held. */
const chargeSounds = (before: number, after: number) =>
  changes({ chargeSeconds: before }, { chargeSeconds: after }, local).map(
    (cue) => cue.sound
  );

const select = (selected: Difficulty): Screen => ({
  kind: "difficulty",
  practice: false,
  selected,
});

const input = (name: MenuInput): ScreenEvent => ({
  input: name,
  type: "input",
});

/** The held sounds with one Duelist's state patched. */
const loops = (id: string, patch: Partial<DuelistState>) =>
  loopsFor(withDuelist(duelSnapshot(), id, patch), local, tuning);

describe(cuesFor, () => {
  it("sounds the local Duelist's Stupefy at the listener", () => {
    expect(cues([{ spell: spell(local), type: "spell-cast" }])).toStrictEqual([
      {
        at: null,
        opponent: false,
        sound: { kind: "stupefy-cast", strong: false },
      },
    ]);
  });

  it("sounds the opponent's casts at their Wand, as the opponent's", () => {
    const wand = { x: 0.3, y: 1.6, z: -7.5 };

    expect(
      cues([
        {
          spell: spell(opponent, { position: wand, strong: true }),
          type: "spell-cast",
        },
      ])
    ).toStrictEqual([
      {
        at: wand,
        opponent: true,
        sound: { kind: "stupefy-cast", strong: true },
      },
    ]);
  });

  it("gives each Spell its own cast, a Confringo's carrying its Charge", () => {
    const sounds = cues([
      {
        spell: spell(local, {
          charge: 0.6,
          empowered: false,
          kind: "confringo",
        }),
        type: "spell-cast",
      },
      { spell: spell(local, { kind: "incendio" }), type: "spell-cast" },
      { spell: spell(local, { kind: "petrificus" }), type: "spell-cast" },
    ]).map((cue) => cue.sound);

    expect(sounds).toStrictEqual([
      { charge: 0.6, empowered: false, kind: "confringo-cast" },
      { kind: "incendio-cast" },
      { kind: "petrificus-cast" },
    ]);
  });

  it("blasts Depulso as it is cast, its hits and blocks adding a thump on the Shield only", () => {
    const blast = spell(local, { kind: "depulso" });
    const at = { x: 0, y: 1.3, z: -2 };

    const sounds = cues([
      { spell: blast, type: "spell-cast" },
      {
        damage: 6,
        position: at,
        spell: blast,
        staggered: false,
        targetId: opponent,
        type: "spell-hit",
      },
      {
        duelistId: opponent,
        position: at,
        spell: blast,
        type: "spell-blocked",
      },
    ]).map((cue) => cue.sound);

    expect(sounds).toStrictEqual([
      { kind: "depulso-cast" },
      { heavy: true, kind: "shield-block" },
    ]);
  });

  it("adds a sting to a Perfect Release", () => {
    const empowered = spell(local, {
      charge: 1,
      empowered: true,
      kind: "confringo",
    });

    const sounds = cues([
      { spell: empowered, type: "spell-cast" },
      { duelistId: local, spell: empowered, type: "perfect-release" },
    ]).map((cue) => cue.sound);

    expect(sounds).toStrictEqual([
      { charge: 1, empowered: true, kind: "confringo-cast" },
      { kind: "perfect-release" },
    ]);
  });

  describe("impacts", () => {
    const at = { x: 0.2, y: 1.4, z: -8 };

    const hit = (
      targetId: string,
      overrides: Partial<SpellState> = {}
    ): DuelEvent => ({
      damage: 6,
      position: at,
      spell: spell(targetId === local ? opponent : local, overrides),
      staggered: false,
      targetId,
      type: "spell-hit",
    });

    it("sounds a hit where it lands, and a hit on the local Duelist at the listener", () => {
      expect(cues([hit(opponent, { strong: true }), hit(local)])).toStrictEqual(
        [
          {
            at,
            opponent: false,
            sound: { kind: "stupefy-hit", strong: true },
          },
          {
            at: null,
            opponent: false,
            sound: { kind: "stupefy-hit", strong: false },
          },
        ]
      );
    });

    it("blasts a Confringo by its Charge, freezes on Petrificus and leaves Incendio to its explosion", () => {
      const sounds = cues([
        hit(opponent, { charge: 0.5, empowered: true, kind: "confringo" }),
        hit(opponent, { kind: "petrificus" }),
        hit(opponent, { kind: "incendio" }),
      ]).map((cue) => cue.sound);

      expect(sounds).toStrictEqual([
        { charge: 0.5, empowered: true, kind: "confringo-blast" },
        { kind: "petrify" },
      ]);
    });

    it("sounds Spells that stop on Cover or burst in the air where they end", () => {
      expect(
        cues([
          {
            by: "cover",
            position: at,
            spell: spell(local, { charge: 1, kind: "confringo" }),
            type: "spell-stopped",
          },
          {
            by: "floor",
            position: at,
            spell: spell(opponent, { kind: "petrificus" }),
            type: "spell-stopped",
          },
          {
            by: "bounds",
            position: at,
            spell: spell(opponent, { kind: "incendio" }),
            type: "spell-stopped",
          },
          {
            position: at,
            spells: [spell(local), spell(opponent)],
            type: "spells-cancelled",
          },
        ])
      ).toStrictEqual([
        {
          at,
          opponent: false,
          sound: { charge: 1, empowered: false, kind: "confringo-blast" },
        },
        { at, opponent: false, sound: { kind: "fizzle" } },
        { at, opponent: false, sound: { kind: "spells-cancelled" } },
      ]);
    });

    it("booms an Incendio explosion where it goes off, in the local Duelist's face when it burns them", () => {
      const explosion = (burned: string[]): DuelEvent => ({
        burned,
        position: at,
        spell: spell(opponent, { kind: "incendio" }),
        type: "explosion",
      });

      expect(cues([explosion([]), explosion([local])])).toStrictEqual([
        { at, opponent: false, sound: { kind: "incendio-explosion" } },
        { at: null, opponent: false, sound: { kind: "incendio-explosion" } },
      ]);
    });
  });

  describe("defence and movement", () => {
    const at = { x: 0, y: 1.3, z: -7.4 };

    it("sounds a Shield's block and Parry where the Spell met it", () => {
      expect(
        cues([
          {
            duelistId: opponent,
            position: at,
            spell: spell(local, { kind: "confringo" }),
            type: "spell-blocked",
          },
          {
            duelistId: local,
            position: at,
            spell: spell(opponent),
            type: "spell-blocked",
          },
          {
            duelistId: local,
            position: at,
            reflected: spell(local),
            spell: spell(opponent),
            type: "parry",
          },
        ])
      ).toStrictEqual([
        { at, opponent: true, sound: { heavy: true, kind: "shield-block" } },
        {
          at: null,
          opponent: false,
          sound: { heavy: false, kind: "shield-block" },
        },
        { at: null, opponent: false, sound: { kind: "parry" } },
      ]);
    });

    it("sounds a Backfire at the Wand that cracked", () => {
      expect(
        cues([
          { damage: 8, duelistId: opponent, position: at, type: "backfire" },
        ])
      ).toStrictEqual([{ at, opponent: true, sound: { kind: "backfire" } }]);
    });

    it("sounds the opponent's Dodges, jumps and landings at their chest", () => {
      const chest = {
        x: courtyardSpawns.far.x,
        y: tuning.duelist.chestHeight,
        z: courtyardSpawns.far.z,
      };

      expect(
        cues([
          { direction: { x: 1, z: 0 }, duelistId: opponent, type: "dodge" },
          { duelistId: opponent, spell: spell(local), type: "perfect-dodge" },
          { duelistId: opponent, type: "jump" },
          { duelistId: opponent, type: "land" },
        ])
      ).toStrictEqual([
        { at: chest, opponent: true, sound: { kind: "dodge" } },
        { at: chest, opponent: true, sound: { kind: "perfect-dodge" } },
        { at: chest, opponent: true, sound: { kind: "jump" } },
        { at: chest, opponent: true, sound: { kind: "land" } },
      ]);
    });

    it("ticks the local Duelist's Lock-on and refused defences, never the opponent's", () => {
      const sounds = cues([
        { duelistId: local, targetId: opponent, type: "lock-on" },
        { duelistId: opponent, targetId: local, type: "lock-on" },
        {
          duelistId: local,
          reason: "toggle",
          targetId: opponent,
          type: "lock-off",
        },
        { action: "dodge", duelistId: local, type: "stamina-short" },
        { action: "dodge", duelistId: opponent, type: "stamina-short" },
      ]).map((cue) => cue.sound);

      expect(sounds).toStrictEqual([
        { kind: "lock-on" },
        { kind: "lock-off" },
        { kind: "stamina-short" },
      ]);
    });
  });

  describe("Disarm and the Wand", () => {
    const hand = { x: 0.3, y: 1.4, z: -7.3 };
    const landing = { x: 0, z: -11 };

    it("whips an Expelliarmus out of the Wand", () => {
      expect(
        cues([
          { spell: spell(local, { kind: "expelliarmus" }), type: "spell-cast" },
        ]).map((cue) => cue.sound)
      ).toStrictEqual([{ kind: "expelliarmus-cast" }]);
    });

    it("snaps the Wand out of the hand it hit, clatters it where it lands and sounds it coming back", () => {
      expect(
        cues([
          {
            casterId: local,
            duelistId: opponent,
            landing,
            position: hand,
            type: "disarm",
          },
          { duelistId: opponent, position: landing, type: "wand-landed" },
          {
            duelistId: opponent,
            how: "pickup",
            position: { ...landing, y: 0 },
            type: "wand-recovered",
          },
          {
            duelistId: local,
            how: "return",
            position: { ...landing, y: 0 },
            type: "wand-recovered",
          },
        ])
      ).toStrictEqual([
        { at: hand, opponent: false, sound: { kind: "disarm" } },
        {
          at: { ...landing, y: 0 },
          opponent: false,
          sound: { kind: "wand-land" },
        },
        {
          at: { ...landing, y: 0 },
          opponent: true,
          sound: { kind: "wand-pickup" },
        },
        { at: null, opponent: false, sound: { kind: "wand-return" } },
      ]);
    });

    it("snaps the local Duelist's own Wand away at the listener", () => {
      expect(
        cues([
          {
            casterId: opponent,
            duelistId: local,
            landing,
            position: hand,
            type: "disarm",
          },
        ])
      ).toStrictEqual([
        { at: null, opponent: false, sound: { kind: "disarm" } },
      ]);
    });
  });

  describe("Potions", () => {
    it("uncorks a Potion as drinking starts, sounds its effect as it is down and shatters one interrupted", () => {
      const snapshot = duelSnapshot();
      const rival = snapshot.duelists.find((each) => each.id === opponent);

      const chest = {
        x: rival?.position.x,
        y: tuning.duelist.chestHeight,
        z: rival?.position.z,
      };

      expect(
        cues([
          { duelistId: local, kind: "wiggenweld", type: "potion-start" },
          { duelistId: local, kind: "wiggenweld", type: "potion-drunk" },
          { duelistId: local, kind: "strength", type: "potion-drunk" },
          { duelistId: local, kind: "swiftness", type: "potion-drunk" },
          { duelistId: opponent, kind: "strength", type: "potion-interrupted" },
        ])
      ).toStrictEqual([
        { at: null, opponent: false, sound: { kind: "potion-drink" } },
        {
          at: null,
          opponent: false,
          sound: { kind: "potion-effect", potion: "wiggenweld" },
        },
        {
          at: null,
          opponent: false,
          sound: { kind: "potion-effect", potion: "strength" },
        },
        {
          at: null,
          opponent: false,
          sound: { kind: "potion-effect", potion: "swiftness" },
        },
        {
          at: chest,
          opponent: true,
          sound: { kind: "potion-interrupted" },
        },
      ]);
    });
  });

  describe("Rounds", () => {
    it("beats the countdown's first number as soon as an intro is heard", () => {
      expect(beats(null, introAt(3))).toStrictEqual([
        { at: null, opponent: false, sound: { beat: 3, kind: "countdown" } },
      ]);
    });

    it("beats each number of the countdown once, as it comes up", () => {
      expect(beats(introAt(2.02), introAt(1.99))).toStrictEqual([
        { at: null, opponent: false, sound: { beat: 2, kind: "countdown" } },
      ]);
      expect(beats(introAt(1.9), introAt(1.5))).toStrictEqual([]);
    });

    it("calls ¡Duelo! as control is given and booms a Knockout", () => {
      const sounds = cues([
        { round: 1, type: "round-start" },
        { duelistId: opponent, position: { x: 0, z: -8 }, type: "knockout" },
      ]).map((cue) => cue.sound);

      expect(sounds).toStrictEqual([
        { kind: "duel-start" },
        { kind: "knockout" },
      ]);
    });

    it("stings each Round's result from the local Duelist's side, and the Duel's instead of the last Round's", () => {
      const sounds = cues([
        { round: 1, type: "round-end", winner: "near" },
        { round: 2, type: "round-end", winner: "far" },
        { round: 3, type: "round-end", winner: null },
      ]).map((cue) => cue.sound);

      expect(sounds).toStrictEqual([
        { kind: "round-end", outcome: "won" },
        { kind: "round-end", outcome: "lost" },
        { kind: "round-end", outcome: "draw" },
      ]);

      expect(
        cues([
          { round: 3, type: "round-end", winner: "far" },
          { type: "duel-end", winner: "far" },
        ]).map((cue) => cue.sound)
      ).toStrictEqual([{ kind: "duel-end", won: false }]);
    });
  });

  describe("changes between frames", () => {
    const { fullSeconds, perfectRelease } = tuning.confringo;

    it("sounds a Shield going up, not one held up", () => {
      expect(changes({ shielding: false }, { shielding: true })).toStrictEqual([
        {
          at: { ...courtyardSpawns.far, y: tuning.duelist.chestHeight },
          opponent: true,
          sound: { kind: "shield-raise" },
        },
      ]);
      expect(changes({ shielding: true }, { shielding: true })).toStrictEqual(
        []
      );
      expect(changes(null, { shielding: true })).toStrictEqual([]);
    });

    it("chimes as a Charge reaches the Perfect Release window, and warns as it leaves it full", () => {
      expect(
        chargeSounds(0.1, fullSeconds - perfectRelease.early)
      ).toStrictEqual([{ kind: "charge-ready" }]);
      expect(
        chargeSounds(fullSeconds, fullSeconds + perfectRelease.late + 0.02)
      ).toStrictEqual([{ kind: "overcharge-warning" }]);
      expect(chargeSounds(0.1, 0.2)).toStrictEqual([]);
    });

    it("cracks the stone as a Petrified Duelist breaks free", () => {
      expect(
        changes({ petrifiedSeconds: 0.02 }, { petrifiedSeconds: 0 }).map(
          (cue) => cue.sound
        )
      ).toStrictEqual([{ kind: "petrify-break" }]);
    });
  });
});

describe(menuSoundFor, () => {
  const duel: DuelScreen = {
    difficulty: "duelista",
    kind: "duel",
    over: null,
    practice: null,
    run: 1,
  };

  const pause: Screen = { duel, kind: "pause", selected: "continue" };

  it("ticks a highlight that moves, and nothing at the end of the list", () => {
    expect(
      menuSoundFor(select("novato"), select("duelista"), input("down"))
    ).toStrictEqual({ kind: "menu-move" });
    expect(
      menuSoundFor(select("novato"), select("novato"), input("up"))
    ).toBeNull();
  });

  it("confirms what opens or starts something, and steps back out of it", () => {
    expect(
      menuSoundFor(select("novato"), duel, input("confirm"))
    ).toStrictEqual({
      kind: "menu-confirm",
    });
    expect(menuSoundFor(duel, pause, input("options"))).toStrictEqual({
      kind: "menu-confirm",
    });
    expect(menuSoundFor(pause, duel, input("options"))).toStrictEqual({
      kind: "menu-back",
    });
    expect(menuSoundFor(pause, duel, input("back"))).toStrictEqual({
      kind: "menu-back",
    });
  });

  it("stays quiet for what changes no screen", () => {
    expect(menuSoundFor(duel, duel, input("confirm"))).toBeNull();
    expect(menuSoundFor(duel, duel, { type: "press" })).toBeNull();
  });
});

describe(loopsFor, () => {
  const { fullSeconds, backfire } = tuning.confringo;
  const chest = { ...courtyardSpawns.far, y: tuning.duelist.chestHeight };

  it("holds nothing while nobody Charges, Shields or Burns", () => {
    expect(loopsFor(duelSnapshot(), local, tuning)).toStrictEqual([]);
  });

  it("hums a Charge that rises with its level and shakes as Overcharge nears", () => {
    expect(loops(local, { chargeSeconds: fullSeconds / 2 })).toStrictEqual([
      {
        at: null,
        key: "charge:local",
        opponent: false,
        sound: { kind: "charge", level: 0.5, overcharge: 0 },
      },
    ]);

    const [nearBackfire] = loops(opponent, {
      chargeSeconds: fullSeconds + backfire.delaySeconds / 2,
    });

    expect(nearBackfire).toMatchObject({
      at: chest,
      key: "charge:opponent",
      opponent: true,
      sound: { kind: "charge", level: 1 },
    });
    expect(
      nearBackfire?.sound.kind === "charge" && nearBackfire.sound.overcharge
    ).toBeCloseTo(0.5);
  });

  it("hums a raised Shield and crackles a Burn", () => {
    expect(
      loops(opponent, { burnSeconds: 2, shielding: true }).map((loop) => [
        loop.key,
        loop.sound,
      ])
    ).toStrictEqual([
      ["shield:opponent", { kind: "shield" }],
      ["burn:opponent", { kind: "burn" }],
    ]);
  });

  it("falls silent for a Knocked Out Duelist", () => {
    expect(
      loops(opponent, { burnSeconds: 2, chargeSeconds: 0.3, knockedOut: true })
    ).toStrictEqual([]);
  });
});
