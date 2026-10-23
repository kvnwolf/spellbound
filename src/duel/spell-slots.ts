/**
 * The Spell Slots and what Special Spells cost: the one place the Focus
 * and Cooldown rules are written down, shared by the Duel simulation (which
 * casts) and the HUD (which greys out what cannot be cast), so the two never
 * disagree. Pure: no three.js, no DOM.
 *
 * Special Spells sit in four Spell Slots, one per face button: while R2 is
 * held, pressing a face button casts the Special Spell bound to its slot
 * (`tuning.spellSlots`). A slot can be empty.
 */
import type { Tuning } from "../tuning";

/** The Special Spells cast from the Spell Slots. */
export type SpecialSpellKind = "depulso" | "incendio" | "petrificus";

export const specialSpellKinds: readonly SpecialSpellKind[] = [
  "incendio",
  "petrificus",
  "depulso",
];

/** The four Spell Slots, named after the face button each sits on. */
export type SpellSlot = "circle" | "cross" | "square" | "triangle";

export const spellSlots: readonly SpellSlot[] = [
  "triangle",
  "square",
  "circle",
  "cross",
];

/** The Special Spell bound to `slot` in the tuning, or null for an empty slot. */
export const boundTo = (
  slot: SpellSlot,
  settings: Pick<Tuning, "spellSlots">
): SpecialSpellKind | null => {
  const binding: string | null = settings.spellSlots[slot];

  return specialSpellKinds.find((kind) => kind === binding) ?? null;
};

type CostSettings = Pick<
  Tuning,
  "depulso" | "focus" | "incendio" | "petrificus"
>;

/** The Focus points a Special Spell costs: its segments, whole. */
export const focusCost = (kind: SpecialSpellKind, settings: CostSettings) =>
  settings[kind].segments * settings.focus.segment;

/** Why a Special Spell cannot be cast right now, or `ready`. */
export type SpecialReadiness = "cooldown" | "focus" | "ready";

/** Whether a Duelist with this Focus and these Cooldowns can pay for `kind`. */
export const readiness = (
  kind: SpecialSpellKind,
  duelist: {
    readonly focus: number;
    readonly cooldowns: Readonly<Record<SpecialSpellKind, number>>;
  },
  settings: CostSettings
): SpecialReadiness => {
  if (duelist.cooldowns[kind] > 0) {
    return "cooldown";
  }

  return duelist.focus >= focusCost(kind, settings) ? "ready" : "focus";
};
