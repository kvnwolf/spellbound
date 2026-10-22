import { describe, expect, it } from "vitest";

import { courtyard, courtyardSpawns } from "../arena/courtyard";
import { createDuel } from "../duel/duel";
import type { DuelEvent, DuelSnapshot, SpellState } from "../duel/duel";
import { tuning } from "../tuning";
import { createHapticsDirector } from "./haptics";
import type { HapticsSettings } from "./haptics";

/** Round numbers, so expected outputs can be worked out by hand. */
const settings: HapticsSettings = {
  cast: { left: 0, right: 0.4, seconds: 0.1 },
  hitTaken: { left: 0.8, right: 0.6, seconds: 0.4 },
  lightbar: {
    base: { b: 40, g: 20, r: 200 },
    flash: { b: 200, g: 220, r: 255 },
    flashSeconds: 0.5,
  },
  strongHitTaken: { left: 1, right: 1, seconds: 0.6 },
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

const spell = (casterId: string, strong = false): SpellState => ({
  casterId,
  homing: null,
  id: 1,
  kind: "stupefy",
  position: { x: 0, y: 1, z: 0 },
  strong,
  team: casterId === local ? "near" : "far",
  velocity: { x: 0, y: 0, z: 1 },
});

const cast = (casterId: string): DuelEvent => ({
  spell: spell(casterId),
  type: "spell-cast",
});

const hit = (targetId: string, strong = false): DuelEvent => ({
  damage: strong ? 14 : 6,
  position: { x: 0, y: 1, z: 0 },
  spell: spell(targetId === local ? opponent : local, strong),
  staggered: strong,
  targetId,
  type: "spell-hit",
});

/** A director for the local Duelist, and a way to play one frame of the Duel through it. */
const direct = () => {
  const director = createHapticsDirector(local, settings);
  const snapshot = duelSnapshot();

  return (
    events: readonly DuelEvent[] = [],
    seconds = 0,
    options: { live?: boolean; snapshot?: DuelSnapshot } = {}
  ) =>
    director.frame({
      events,
      live: options.live ?? true,
      seconds,
      snapshot: options.snapshot ?? snapshot,
    });
};

describe(createHapticsDirector, () => {
  it("is quiet with nothing happening: no rumble, the base lightbar, no LEDs, free triggers", () => {
    const frame = direct();

    expect(frame()).toStrictEqual({
      lightbar: settings.lightbar.base,
      playerLeds: 0,
      rumble: { left: 0, right: 0 },
      triggers: { l2: { kind: "off" }, r2: { kind: "off" } },
    });
  });

  it("rumbles when the local Duelist casts, fading out over the pulse", () => {
    const frame = direct();

    expect(frame([cast(local)]).rumble).toStrictEqual({ left: 0, right: 0.4 });
    expect(frame([], 0.05).rumble.right).toBeCloseTo(0.2);
    expect(frame([], 0.05).rumble).toStrictEqual({ left: 0, right: 0 });
  });

  it("does not rumble for the opponent's casts or for hits the local Duelist lands", () => {
    const frame = direct();

    expect(frame([cast(opponent), hit(opponent)])).toStrictEqual(frame());
  });

  it("rumbles harder on taking a hit, and harder still on a strong one", () => {
    expect(direct()([hit(local)]).rumble).toStrictEqual({
      left: 0.8,
      right: 0.6,
    });
    expect(direct()([hit(local, true)]).rumble).toStrictEqual({
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

  it("flashes the lightbar on a hit taken, fading back to the base colour", () => {
    const frame = direct();

    expect(frame([hit(local)]).lightbar).toStrictEqual(settings.lightbar.flash);

    const halfway = frame([], 0.25).lightbar;

    expect(halfway.r).toBeCloseTo(227.5);
    expect(halfway.g).toBeCloseTo(120);
    expect(halfway.b).toBeCloseTo(120);
    expect(frame([], 0.25).lightbar).toStrictEqual(settings.lightbar.base);
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

    expect(frame([], 0, { live: false }).rumble).toStrictEqual({
      left: 0,
      right: 0,
    });
    expect(frame([cast(local)], 0, { live: false }).rumble).toStrictEqual({
      left: 0,
      right: 0,
    });
    expect(frame().rumble).toStrictEqual({ left: 0, right: 0 });
  });
});
