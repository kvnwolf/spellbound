import { describe, expect, it } from "vitest";

import { courtyard, courtyardSpawns } from "../arena/courtyard";
import { menuSoundFor } from "../audio/cues";
import type { MenuSound } from "../audio/cues";
import { createDuel } from "../duel/duel";
import type {
  ClashState,
  DuelEvent,
  DuelistState,
  DuelSnapshot,
  SpellKind,
  SpellState,
} from "../duel/duel";
import type { Point3 } from "../duel/geometry";
import { reduceScreens } from "../screens/screens";
import type { MenuInput, Screen } from "../screens/screens";
import { tuning } from "../tuning";
import type { Tuning } from "../tuning";
import { createHapticsDirector } from "./haptics";
import type { Rgb } from "./output";

/** Round numbers, so expected outputs can be worked out by hand. */
const haptics: Tuning["haptics"] = {
  cast: { left: 0, right: 0.4, seconds: 0.1 },
  charge: {
    backfire: { left: 1, right: 0.8, seconds: 0.3 },
    overcharge: { left: 0.7, right: 0.9 },
    perfect: { left: 0, right: 1, seconds: 0.05 },
    rumble: { from: { left: 0, right: 0.1 }, to: { left: 0.4, right: 0.5 } },
  },
  clash: {
    end: { left: 1, right: 1, seconds: 0.6 },
    far: { left: 0.1, right: 0.1 },
    near: { left: 0.9, right: 0.5 },
    pump: { left: 0, right: 0.8, seconds: 0.05 },
  },
  depulsoCast: { left: 0.8, right: 0.2, seconds: 0.2 },
  disarmed: {
    left: 0.6,
    right: 0.4,
    seconds: 2,
    tremble: { depth: 0.5, hz: 5 },
  },
  explosion: { pulse: { left: 1, right: 0.2, seconds: 0.5 }, range: 10 },
  fallback: { effectSeconds: 0.1, resendSeconds: 0.05 },
  hitTaken: { left: 0.8, right: 0.6, seconds: 0.4 },
  lightbar: {
    base: { b: 40, g: 20, r: 200 },
    castSeconds: 0.2,
    flashSeconds: 0.5,
    focusPulse: { color: { b: 40, g: 220, r: 240 }, periodSeconds: 2 },
    spells: {
      confringo: { b: 0, g: 128, r: 255 },
      depulso: { b: 255, g: 224, r: 192 },
      expelliarmus: { b: 128, g: 0, r: 255 },
      incendio: { b: 0, g: 64, r: 255 },
      petrificus: { b: 255, g: 128, r: 64 },
      stupefy: { b: 0, g: 0, r: 255 },
    },
  },
  menu: {
    back: { left: 0, right: 0.3, seconds: 0.1 },
    confirm: { left: 0.2, right: 0.6, seconds: 0.1 },
    move: { left: 0, right: 0.2, seconds: 0.05 },
  },
  parry: { left: 0.2, right: 1, seconds: 0.1 },
  petrified: { left: 0, right: 0.3 },
  potionDrunk: { left: 0.3, right: 0.2, seconds: 0.5 },
  strongHitTaken: { left: 1, right: 1, seconds: 0.6 },
};

const colours: Record<SpellKind, Rgb> = {
  confringo: { b: 0, g: 128, r: 255 },
  depulso: { b: 255, g: 224, r: 192 },
  expelliarmus: { b: 128, g: 0, r: 255 },
  incendio: { b: 0, g: 64, r: 255 },
  petrificus: { b: 255, g: 128, r: 64 },
  stupefy: { b: 0, g: 0, r: 255 },
};

/**
 * The real tuning with round-number haptics, and both Slots held past half
 * the trigger's travel. The rest is the game's: the Charge windows (full at
 * 0.5 s, Perfect Release from 0.46 s to 0.56 s, Backfire at 0.6 s) and full
 * Focus at 99.
 */
const settings: Tuning = {
  ...tuning,
  haptics,
};

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

/** A snapshot with the local Duelist changed by `patch`. */
const withLocal = (patch: Partial<DuelistState>): DuelSnapshot => {
  const snapshot = duelSnapshot();

  return {
    ...snapshot,
    duelists: snapshot.duelists.map((each) =>
      each.id === local ? { ...each, ...patch } : each
    ),
  };
};

const localPosition = () => {
  const self = duelSnapshot().duelists.find((each) => each.id === local);

  if (!self) {
    throw new Error("no local Duelist");
  }

  return self.position;
};

const at = { x: 0, y: 1, z: 0 };

const spell = (
  casterId: string,
  options: { kind?: SpellKind; strong?: boolean } = {}
): SpellState => ({
  casterId,
  charge: 0,
  empowered: false,
  homing: null,
  id: 1,
  kind: options.kind ?? "stupefy",
  position: at,
  strong: options.strong ?? false,
  team: casterId === local ? "near" : "far",
  velocity: { x: 0, y: 0, z: 1 },
});

const cast = (casterId: string, kind: SpellKind = "stupefy"): DuelEvent => ({
  spell: spell(casterId, { kind }),
  type: "spell-cast",
});

const hit = (
  targetId: string,
  options: { kind?: SpellKind; strong?: boolean; position?: Point3 } = {}
): DuelEvent => ({
  damage: options.strong === true ? 14 : 6,
  position: options.position ?? at,
  spell: spell(targetId === local ? opponent : local, options),
  staggered: options.strong ?? false,
  targetId,
  type: "spell-hit",
});

const backfire = (duelistId: string): DuelEvent => ({
  damage: 8,
  duelistId,
  position: at,
  type: "backfire",
});

/** A director for the local Duelist, and a way to play one frame of the Duel through it. */
const direct = () => {
  const director = createHapticsDirector(local, settings);
  const snapshot = duelSnapshot();

  return (
    events: readonly DuelEvent[] = [],
    seconds = 0,
    options: {
      live?: boolean;
      menu?: readonly MenuSound[];
      snapshot?: DuelSnapshot;
    } = {}
  ) =>
    director.frame({
      events,
      live: options.live ?? true,
      menu: options.menu,
      seconds,
      snapshot: options.snapshot ?? snapshot,
    });
};

/** Both triggers free: the director never sets an adaptive trigger effect. */
const free = { l2: { kind: "off" }, r2: { kind: "off" } };

const silence = { left: 0, right: 0 };

/** To three decimals, so worked-out values compare in one go. */
const round = (value: number) => Math.round(value * 1000) / 1000;

const approxRumble = ({ left, right }: { left: number; right: number }) => ({
  left: round(left),
  right: round(right),
});

const approxColour = ({ b, g, r }: Rgb) => ({
  b: round(b),
  g: round(g),
  r: round(r),
});

const charging = (chargeSeconds: number) => ({
  snapshot: withLocal({ chargeSeconds }),
});

/** A Clash between the two Duelists, `first` holding the beam's 0 end; the meeting point `along` the beam. */
const clashOf = (first: string, along: number): ClashState => {
  const side = (duelistId: string) => ({
    duelistId,
    spell: spell(duelistId, { kind: "confringo" }),
    wand: at,
  });

  return {
    along,
    point: at,
    secondsLeft: 4,
    sides: [side(first), side(first === local ? opponent : local)],
  };
};

const clashing = (first: string, along: number) => ({
  snapshot: { ...duelSnapshot(), clash: clashOf(first, along) },
});

const clashEnd = (
  outcome: "exploded" | "won",
  winnerId: string | null
): DuelEvent => ({
  clash: clashOf(local, 0.5),
  outcome,
  position: at,
  type: "clash-end",
  winnerId,
});

const disarm = (duelistId: string): DuelEvent => ({
  casterId: duelistId === local ? opponent : local,
  duelistId,
  landing: { x: 0, z: 0 },
  position: at,
  type: "disarm",
});

const drunk = (duelistId: string): DuelEvent => ({
  duelistId,
  kind: "wiggenweld",
  type: "potion-drunk",
});

/** A point `metres` along the floor from the local Duelist, at chest height. */
const away = (metres: number): Point3 => {
  const { x, z } = localPosition();

  return { x: x + metres, y: 1, z };
};

const incendioBlast = (metres: number): DuelEvent => ({
  burned: [],
  position: away(metres),
  spell: spell(opponent, { kind: "incendio" }),
  type: "explosion",
});

describe(createHapticsDirector, () => {
  it("is quiet with nothing happening: no rumble, the base lightbar, no LEDs", () => {
    const frame = direct();

    expect(frame()).toStrictEqual({
      lightbar: haptics.lightbar.base,
      playerLeds: 0,
      rumble: silence,
      triggers: free,
    });
  });

  it("rumbles when the local Duelist casts, fading out over the pulse", () => {
    const frame = direct();

    expect(frame([cast(local)]).rumble).toStrictEqual({ left: 0, right: 0.4 });
    expect(frame([], 0.05).rumble.right).toBeCloseTo(0.2);
    expect(frame([], 0.05).rumble).toStrictEqual(silence);
  });

  it("does not react to the opponent's casts or to hits the local Duelist lands", () => {
    const frame = direct();

    expect(frame([cast(opponent), hit(opponent)])).toStrictEqual(frame());
  });

  it("rumbles harder on taking a hit, and harder still on a strong one", () => {
    expect(direct()([hit(local)]).rumble).toStrictEqual({
      left: 0.8,
      right: 0.6,
    });
    expect(direct()([hit(local, { strong: true })]).rumble).toStrictEqual({
      left: 1,
      right: 1,
    });
  });

  it("keeps the stronger of overlapping pulses on each motor", () => {
    const frame = direct();
    frame([hit(local)]);

    // 0.3 s into the hit's 0.4 s pulse it is down to a quarter, below a fresh cast on the right motor.
    const { rumble } = frame([cast(local)], 0.3);

    expect(rumble.left).toBeCloseTo(0.2);
    expect(rumble.right).toBeCloseTo(0.4);
  });

  it("flashes the lightbar in the colour of the Spell that hits, fading back to the base colour", () => {
    const frame = direct();

    expect(frame([hit(local)]).lightbar).toStrictEqual(colours.stupefy);
    expect(approxColour(frame([], 0.25).lightbar)).toStrictEqual({
      b: 20,
      g: 10,
      r: 227.5,
    });
    expect(frame([], 0.25).lightbar).toStrictEqual(haptics.lightbar.base);
    expect(
      direct()([hit(local, { kind: "petrificus" })]).lightbar
    ).toStrictEqual(colours.petrificus);
  });

  it("gives every Spell its own lightbar colour, from the lightbar palette and not the on-screen one", () => {
    const kinds = [
      "confringo",
      "depulso",
      "expelliarmus",
      "incendio",
      "petrificus",
      "stupefy",
    ] as const satisfies readonly SpellKind[];

    for (const kind of kinds) {
      expect(direct()([cast(local, kind)]).lightbar).toStrictEqual(
        colours[kind]
      );
      expect(direct()([hit(local, { kind })]).lightbar).toStrictEqual(
        colours[kind]
      );
    }
  });

  it("lights the lightbar briefly in the colour of the Spell the local Duelist casts", () => {
    const frame = direct();

    expect(frame([cast(local, "confringo")]).lightbar).toStrictEqual(
      colours.confringo
    );

    expect(approxColour(frame([], 0.1).lightbar)).toStrictEqual({
      b: 20,
      g: 74,
      r: 227.5,
    });
    expect(frame([], 0.1).lightbar).toStrictEqual(haptics.lightbar.base);
    expect(direct()([cast(opponent, "confringo")]).lightbar).toStrictEqual(
      haptics.lightbar.base
    );
  });

  it("shows the local Duelist's Rounds won on the player LEDs, centred", () => {
    const frame = direct();
    const snapshot = duelSnapshot();

    const scored = (near: number) => ({
      snapshot: { ...snapshot, score: { far: 1, near } },
    });

    expect(frame([], 0, scored(0)).playerLeds).toBe(0b0_0000);
    expect(frame([], 0, scored(1)).playerLeds).toBe(0b0_0100);
    expect(frame([], 0, scored(2)).playerLeds).toBe(0b0_1010);
  });

  it("stops rumbling when the Duel is not being played, and does not pick up again after", () => {
    const frame = direct();
    frame([hit(local)]);

    expect(frame([], 0, { live: false })).toMatchObject({
      rumble: silence,
      triggers: free,
    });
    expect(frame([cast(local)], 0, { live: false }).rumble).toStrictEqual(
      silence
    );
    expect(frame().rumble).toStrictEqual(silence);
  });
});

describe("the Heavy Spell's Charge", () => {
  it("ramps the rumble with the Charge level", () => {
    const frame = direct();

    // A fifth of the way (0.1 of 0.5 s): a fifth of the way from `from` to `to`.
    expect(approxRumble(frame([], 0, charging(0.1)).rumble)).toStrictEqual({
      left: 0.08,
      right: 0.18,
    });
    expect(approxRumble(frame([], 0.15, charging(0.25)).rumble)).toStrictEqual({
      left: 0.2,
      right: 0.3,
    });
  });

  it("ticks crisply once, as the Charge enters the Perfect Release window", () => {
    const frame = direct();
    frame([], 0, charging(0.4));

    const entering = frame([], 0.08, charging(0.48)).rumble;

    expect(entering.right).toBe(1);

    // Still in the window after the tick has faded: just the full ramp.
    expect(frame([], 0.06, charging(0.54)).rumble).toStrictEqual({
      left: 0.4,
      right: 0.5,
    });
  });

  it("buzzes hard once full and past the window, a moment from Backfiring", () => {
    expect(direct()([], 0, charging(0.58)).rumble).toStrictEqual({
      left: 0.7,
      right: 0.9,
    });
  });

  it("jolts and flashes the Confringo colour on a Backfire in the local Duelist's hand", () => {
    const felt = direct()([backfire(local)]);

    expect(felt.rumble).toStrictEqual({ left: 1, right: 0.8 });
    expect(felt.lightbar).toStrictEqual(colours.confringo);
    expect(direct()([backfire(opponent)])).toStrictEqual(direct()());
  });

  it("goes still when the Charge ends", () => {
    const frame = direct();
    frame([], 0, charging(0.3));

    expect(frame([], 0.02).rumble).toStrictEqual(silence);
  });
});

/** The steady rumble a Clash shows a fresh director. */
const clashRumble = (first: string, along: number) =>
  approxRumble(direct()([], 0, clashing(first, along)).rumble);

describe("the Clash", () => {
  it("rumbles harder the nearer the meeting point comes to the local Duelist's Wand", () => {
    expect(clashRumble(local, 0.5)).toStrictEqual({ left: 0.5, right: 0.3 });
    // Four fifths of the way to the local Wand, whichever end of the beam it holds.
    expect(clashRumble(local, 0.2)).toStrictEqual({ left: 0.74, right: 0.42 });
    expect(clashRumble(opponent, 0.8)).toStrictEqual({
      left: 0.74,
      right: 0.42,
    });
    // A fifth of the way: four fifths of it toward the opponent's Wand.
    expect(clashRumble(opponent, 0.2)).toStrictEqual({
      left: 0.26,
      right: 0.18,
    });
  });

  it("ticks sharply on each of the local Duelist's △ pumps, not the opponent's", () => {
    const pump = (duelistId: string): DuelEvent => ({
      clash: clashOf(local, 0.5),
      duelistId,
      type: "clash-pump",
    });

    expect(
      direct()([pump(local)], 0, clashing(local, 0.5)).rumble
    ).toStrictEqual({ left: 0.5, right: 0.8 });
    expect(
      direct()([pump(opponent)], 0, clashing(local, 0.5)).rumble.right
    ).toBeCloseTo(0.3);
  });

  it("thumps big when the local Duelist's Clash ends, won, lost or exploded", () => {
    for (const event of [
      clashEnd("won", local),
      clashEnd("won", opponent),
      clashEnd("exploded", null),
    ]) {
      expect(direct()([event]).rumble).toStrictEqual({ left: 1, right: 1 });
    }
  });
});

describe("defence, Special Spells and Potions", () => {
  it("pulses sharp and short on the local Duelist's Parry", () => {
    const parry = (duelistId: string): DuelEvent => ({
      duelistId,
      position: at,
      reflected: spell(duelistId),
      spell: spell(duelistId === local ? opponent : local),
      type: "parry",
    });

    expect(direct()([parry(local)]).rumble).toStrictEqual({
      left: 0.2,
      right: 1,
    });
    expect(direct()([parry(opponent)]).rumble).toStrictEqual(silence);
  });

  it("trembles long when the local Duelist is Disarmed", () => {
    const frame = direct();

    expect(frame([disarm(local)]).rumble).toStrictEqual({
      left: 0.6,
      right: 0.4,
    });
    // Half a tremble later (5 Hz) it dips by half, on a pulse 5% faded...
    expect(approxRumble(frame([], 0.1).rumble)).toStrictEqual({
      left: 0.285,
      right: 0.19,
    });
    // ...and a whole tremble later it is back up, 10% faded.
    expect(approxRumble(frame([], 0.1).rumble)).toStrictEqual({
      left: 0.54,
      right: 0.36,
    });
    // Still trembling well over a second in.
    expect(frame([], 1.2).rumble.left).toBeGreaterThan(0);
  });

  it("does not tremble when the opponent is Disarmed", () => {
    expect(direct()([disarm(opponent)]).rumble).toStrictEqual(silence);
  });

  it("pushes on casting Depulso, in place of the plain cast tick", () => {
    const felt = direct()([cast(local, "depulso")]);

    expect(felt.rumble).toStrictEqual({ left: 0.8, right: 0.2 });
    expect(felt.lightbar).toStrictEqual(colours.depulso);
  });

  it("buzzes cold for as long as the local Duelist is Petrified", () => {
    const frame = direct();

    expect(
      frame([], 0, { snapshot: withLocal({ petrifiedSeconds: 1.2 }) }).rumble
    ).toStrictEqual({ left: 0, right: 0.3 });
    expect(
      frame([], 1, { snapshot: withLocal({ petrifiedSeconds: 0.2 }) }).rumble
    ).toStrictEqual({ left: 0, right: 0.3 });
    expect(frame([], 0.2).rumble).toStrictEqual(silence);
  });

  it("pulses softly as the local Duelist's Potion goes down", () => {
    expect(direct()([drunk(local)]).rumble).toStrictEqual({
      left: 0.3,
      right: 0.2,
    });
    expect(direct()([drunk(opponent)]).rumble).toStrictEqual(silence);
  });
});

describe("explosions nearby", () => {
  it("thumps low for an Incendio explosion, full at the local Duelist's feet and fading with distance", () => {
    expect(direct()([incendioBlast(0)]).rumble).toStrictEqual({
      left: 1,
      right: 0.2,
    });
    expect(approxRumble(direct()([incendioBlast(5)]).rumble)).toStrictEqual({
      left: 0.5,
      right: 0.1,
    });
    expect(direct()([incendioBlast(12)]).rumble).toStrictEqual(silence);
  });

  it("thumps for a Confringo bursting nearby, wherever it ends", () => {
    const confringo = spell(local, { kind: "confringo" });

    const endings: DuelEvent[] = [
      {
        by: "cover",
        position: away(5),
        spell: confringo,
        type: "spell-stopped",
      },
      {
        duelistId: opponent,
        position: away(5),
        spell: confringo,
        type: "spell-blocked",
      },
      {
        position: away(5),
        spells: [confringo, spell(opponent)],
        type: "spells-cancelled",
      },
      hit(opponent, { kind: "confringo", position: away(5) }),
    ];

    for (const event of endings) {
      expect(direct()([event]).rumble.left).toBeCloseTo(0.5);
    }
  });

  it("does not thump for a Stupefy stopping nearby", () => {
    expect(
      direct()([
        {
          by: "cover",
          position: away(0),
          spell: spell(opponent),
          type: "spell-stopped",
        },
      ]).rumble
    ).toStrictEqual(silence);
  });
});

describe("the lightbar's states", () => {
  const looseWand = {
    grounded: true,
    heading: { x: 1, z: 0 },
    landing: { x: 0, z: 0 },
    position: { x: 0, y: 0, z: 0 },
    returnSeconds: 4,
  };

  it("goes dark while the local Duelist is Disarmed, flashes included", () => {
    const disarmed = { snapshot: withLocal({ looseWand }) };
    const frame = direct();

    expect(frame([], 0, disarmed).lightbar).toStrictEqual({ b: 0, g: 0, r: 0 });
    expect(frame([hit(local)], 0, disarmed).lightbar).toStrictEqual({
      b: 0,
      g: 0,
      r: 0,
    });
    expect(frame().lightbar).toStrictEqual(colours.stupefy);
  });

  it("pulses slowly toward the Focus colour and back while Focus is full", () => {
    const full = { snapshot: withLocal({ focus: 99 }) };
    const frame = direct();

    expect(frame([], 0, full).lightbar).toStrictEqual(haptics.lightbar.base);
    // A quarter of the 2 s period in, halfway there; half of it in, all the way.
    expect(approxColour(frame([], 0.5, full).lightbar)).toStrictEqual({
      b: 40,
      g: 120,
      r: 220,
    });
    expect(approxColour(frame([], 0.5, full).lightbar)).toStrictEqual(
      haptics.lightbar.focusPulse.color
    );
    expect(
      frame([], 0.5, { snapshot: withLocal({ focus: 98 }) }).lightbar
    ).toStrictEqual(haptics.lightbar.base);
  });

  it("starts the pulse from the base colour each time Focus fills", () => {
    const frame = direct();
    frame([], 0, { snapshot: withLocal({ focus: 99 }) });
    frame([], 0.7, { snapshot: withLocal({ focus: 99 }) });
    frame([], 0.1, { snapshot: withLocal({ focus: 0 }) });

    expect(
      frame([], 0.1, { snapshot: withLocal({ focus: 99 }) }).lightbar
    ).toStrictEqual(haptics.lightbar.base);
  });
});

describe("adaptive triggers", () => {
  it("leaves L2 and R2 off in a live Duel", () => {
    expect(direct()().triggers).toStrictEqual(free);
  });

  it("leaves L2 and R2 off while the Slots are held", () => {
    const frame = direct();

    expect(
      frame([], 0, { snapshot: withLocal({ spellSlotsHeld: true }) }).triggers
    ).toStrictEqual(free);
    expect(
      frame([], 0, { snapshot: withLocal({ potionSlotsHeld: true }) }).triggers
    ).toStrictEqual(free);
  });

  it("leaves L2 and R2 off behind menus, the pause and the title", () => {
    expect(
      direct()([], 0, {
        live: false,
        snapshot: withLocal({ spellSlotsHeld: true }),
      }).triggers
    ).toStrictEqual(free);
  });
});

/** What one menu input on `screen` is felt as: the screens step, and the menu sound it makes (if any) goes to the director. */
const press = (screen: Screen, input: MenuInput) => {
  const after = reduceScreens(
    { runs: 0, screen },
    { input, type: "input" },
    settings.screens
  ).screen;

  const sound = menuSoundFor(screen, after, { input, type: "input" });

  return direct()([], 0, { live: false, menu: sound ? [sound] : [] });
};

const main = (selected: "duel" | "practice"): Screen => ({
  kind: "main",
  selected,
});

describe("the menus", () => {
  it("ticks lightly as the highlight moves, behind the menus where nothing else rumbles", () => {
    expect(press(main("duel"), "down").rumble).toStrictEqual({
      left: 0,
      right: 0.2,
    });
  });

  it("ticks once per step, each step its own tick", () => {
    const frame = direct();
    const step = { kind: "menu-move" } as const;

    expect(frame([], 0, { live: false, menu: [step] }).rumble.right).toBe(0.2);
    expect(frame([], 0.05, { live: false, menu: [step] }).rumble.right).toBe(
      0.2
    );
  });

  it("does not tick when the highlight is already at the end of the list", () => {
    expect(press(main("duel"), "up").rumble).toStrictEqual(silence);
    // Below Práctica are only entries not available yet: the end, too.
    expect(press(main("practice"), "down").rumble).toStrictEqual(silence);
  });

  it("pulses firmer on a choice taken, softer on a step back", () => {
    expect(press(main("duel"), "confirm").rumble).toStrictEqual({
      left: 0.2,
      right: 0.6,
    });
    expect(
      press({ kind: "rivals", selected: "idle" }, "back").rumble
    ).toStrictEqual({ left: 0, right: 0.3 });
  });

  it("feels nothing for a step back with nowhere to go", () => {
    expect(press(main("duel"), "back").rumble).toStrictEqual(silence);
  });

  it("fades each pulse out over its length, even as the Duel it started begins", () => {
    const frame = direct();
    frame([], 0, { live: false, menu: [{ kind: "menu-confirm" }] });

    expect(frame([], 0.05).rumble).toStrictEqual({ left: 0.1, right: 0.3 });
    expect(frame([], 0.05).rumble).toStrictEqual(silence);
  });
});
