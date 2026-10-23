/**
 * The Spell Wheel and what Special Spells cost: the one place the wheel's
 * layout and the Focus and Cooldown rules are written down, shared by the
 * Duel simulation (which casts) and the HUD (which draws the wheel and greys
 * out what cannot be cast), so the two never disagree. Pure: no three.js, no DOM.
 */
import type { Tuning } from "../tuning";
import type { Vec2 } from "./intent";

/** The Special Spells cast from the Spell Wheel. */
export type SpecialSpellKind = "incendio" | "petrificus";

export const specialSpellKinds: readonly SpecialSpellKind[] = [
  "incendio",
  "petrificus",
];

/**
 * The wheel's slices, clockwise from the top, each as wide as the others.
 * `null` is a slice for a Special Spell not in the game yet (Expelliarmus,
 * at the top): the HUD shows it locked and picking it picks nothing.
 */
export const spellWheelSlices: readonly (SpecialSpellKind | null)[] = [
  null,
  "incendio",
  "petrificus",
];

/**
 * The slice a stick pushed toward `pick` points at (an index into
 * `spellWheelSlices`), or undefined while it is pushed less than `deflection`.
 */
export const sliceAt = (pick: Vec2, deflection: number): number | undefined => {
  if (Math.hypot(pick.x, pick.y) < deflection) {
    return undefined;
  }

  const count = spellWheelSlices.length;
  // Clockwise from straight up, offset by half a slice so each slice is
  // centred on its own direction.
  const turn = Math.atan2(pick.x, pick.y) / (Math.PI * 2);
  const share = (((turn + 0.5 / count) % 1) + 1) % 1;

  return Math.floor(share * count) % count;
};

/** The Focus points a Special Spell costs: its segments, whole. */
export const focusCost = (
  kind: SpecialSpellKind,
  settings: Pick<Tuning, "focus" | "incendio" | "petrificus">
) => settings[kind].segments * settings.focus.segment;

/** Why a Special Spell cannot be cast right now, or `ready`. */
export type SpecialReadiness = "cooldown" | "focus" | "ready";

/** Whether a Duelist with this Focus and these Cooldowns can pay for `kind`. */
export const readiness = (
  kind: SpecialSpellKind,
  duelist: {
    readonly focus: number;
    readonly cooldowns: Readonly<Record<SpecialSpellKind, number>>;
  },
  settings: Pick<Tuning, "focus" | "incendio" | "petrificus">
): SpecialReadiness => {
  if (duelist.cooldowns[kind] > 0) {
    return "cooldown";
  }

  return duelist.focus >= focusCost(kind, settings) ? "ready" : "focus";
};
