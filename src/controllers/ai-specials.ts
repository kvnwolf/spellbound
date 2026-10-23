/**
 * Which Special Spell the AI reaches for, read from the Duel as it stands:
 * the one that fits the moment, as a duellist would pick it. Pure: no
 * three.js, no DOM.
 */
import { sightBlocked } from "../duel/aim";
import type { ArenaLayout, DuelistState } from "../duel/duel";
import { distanceBetween } from "../duel/geometry";
import { boundTo, readiness, spellSlots } from "../duel/spell-slots";
import type { SpecialSpellKind, SpellSlot } from "../duel/spell-slots";
import type { Tuning } from "../tuning";

/** The Spell Slot `kind` sits in, or undefined if no slot holds it. */
export const slotOf = (
  kind: SpecialSpellKind,
  settings: Pick<Tuning, "spellSlots">
): SpellSlot | undefined =>
  spellSlots.find((slot) => boundTo(slot, settings) === kind);

/** The Special Spells `self` could cast right now: bound to a slot, Focus enough, off Cooldown. */
export const readySpecials = (
  self: DuelistState,
  settings: Tuning
): SpecialSpellKind[] =>
  spellSlots.flatMap((slot) => {
    const kind = boundTo(slot, settings);

    return kind !== null && readiness(kind, self, settings) === "ready"
      ? [kind]
      : [];
  });

/** Within Depulso's reach of `self`, with room to spare: its cone would catch them. */
export const withinDepulso = (
  self: DuelistState,
  opponent: DuelistState,
  settings: Tuning
) =>
  distanceBetween(self.position, opponent.position) -
    settings.duelist.bodyRadius <
  settings.depulso.range - settings.ai.specials.depulsoMargin;

/**
 * The Special Spells `self` could cast now that might do anything at all:
 * Depulso only on an opponent within its reach, the rest only on one in
 * sight. What a careless duellist picks from, short of the one that fits.
 */
export const plausibleSpecials = (
  self: DuelistState,
  opponent: DuelistState,
  arena: ArenaLayout,
  settings: Tuning
): SpecialSpellKind[] => {
  const inSight = !sightBlocked(self.position, opponent.position, arena.cover);

  return readySpecials(self, settings).filter((kind) =>
    kind === "depulso"
      ? inSight && withinDepulso(self, opponent, settings)
      : inSight
  );
};

/** Cornered: within `ai.specials.cornered` metres of the Arena's walls. */
const cornered = (
  opponent: DuelistState,
  arena: ArenaLayout,
  settings: Tuning
) => {
  const margin = settings.ai.specials.cornered;
  const { position } = opponent;

  return (
    arena.bounds.halfWidth - Math.abs(position.x) < margin ||
    arena.bounds.halfDepth - Math.abs(position.z) < margin
  );
};

/** Standing where an Incendio bursting on nearby Cover would catch them in its blast. */
const byCover = (
  opponent: DuelistState,
  arena: ArenaLayout,
  settings: Tuning
) =>
  arena.cover.some(
    (column) =>
      distanceBetween(opponent.position, column.center) - column.radius <
      settings.incendio.blastRadius * settings.ai.specials.coverBlastShare
  );

/**
 * The Special Spell that fits this moment, of those `self` can cast, or
 * undefined when none does:
 * - Depulso when the opponent is close enough for its cone (above all when
 *   they Charge or drink, which it interrupts);
 * - Expelliarmus with the Focus meter full and the opponent's Shield down;
 * - Petrificus Totalus when a Charged Confringo (after `reactionSeconds`)
 *   could land before they move again;
 * - Incendio against a Shield (its Burn goes through), or an opponent
 *   cornered or by Cover, where the blast still reaches them.
 * Nothing but Depulso is wasted on an opponent mid-Dodge, and nothing but
 * Incendio on one out of sight.
 */
export const fittingSpecial = ({
  arena,
  opponent,
  reactionSeconds,
  self,
  settings,
}: {
  readonly arena: ArenaLayout;
  readonly opponent: DuelistState;
  /** The longest the AI takes to react, for whether it can follow a Petrificus up. */
  readonly reactionSeconds: number;
  readonly self: DuelistState;
  readonly settings: Tuning;
}): SpecialSpellKind | undefined => {
  const ready = new Set(readySpecials(self, settings));
  const inSight = !sightBlocked(self.position, opponent.position, arena.cover);
  const distance = distanceBetween(self.position, opponent.position);

  if (
    ready.has("depulso") &&
    inSight &&
    withinDepulso(self, opponent, settings)
  ) {
    return "depulso";
  }

  if (opponent.dodgeSeconds > 0) {
    return undefined;
  }

  const exposed = inSight && !opponent.shielding;

  if (
    ready.has("expelliarmus") &&
    exposed &&
    self.focus >= settings.focus.max &&
    opponent.looseWand === null
  ) {
    return "expelliarmus";
  }

  const { confringo, petrificus } = settings;

  const followUp =
    reactionSeconds + confringo.fullSeconds + distance / confringo.speed;

  if (
    ready.has("petrificus") &&
    exposed &&
    opponent.petrifiedSeconds === 0 &&
    followUp <= petrificus.petrifiedSeconds
  ) {
    return "petrificus";
  }

  const incendioFits = inSight
    ? opponent.shielding ||
      cornered(opponent, arena, settings) ||
      byCover(opponent, arena, settings)
    : byCover(opponent, arena, settings);

  if (ready.has("incendio") && incendioFits) {
    return "incendio";
  }

  return undefined;
};
