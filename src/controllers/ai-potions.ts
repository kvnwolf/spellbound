/**
 * When the AI reaches for a Potion, read from the Duel as it stands. Pure:
 * no three.js, no DOM.
 */
import { sightBlocked } from "../duel/aim";
import type {
  ArenaLayout,
  DuelistState,
  LastingPotion,
  PotionKind,
} from "../duel/duel";
import { distanceBetween } from "../duel/geometry";
import { potionIn } from "../duel/potions";
import type { PotionSlot } from "../duel/potions";
import { spellSlots } from "../duel/spell-slots";
import type { Tuning } from "../tuning";
import { withinDepulso } from "./ai-specials";

/** The Potion Slot `kind` sits in, or undefined if no slot holds it. */
export const potionSlotOf = (
  kind: PotionKind,
  settings: Pick<Tuning, "potionSlots">
): PotionSlot | undefined =>
  spellSlots.find((slot) => potionIn(slot, settings) === kind);

/** An opponent who cannot cast at all right now: Disarmed, Staggered, Petrified, knocked back or drinking. */
export const helpless = (opponent: DuelistState) =>
  opponent.looseWand !== null ||
  opponent.staggerSeconds > 0 ||
  opponent.petrifiedSeconds > 0 ||
  opponent.knockbackSeconds > 0 ||
  opponent.drinking !== null;

/**
 * Whether `self` could drink without being caught at it, given whether a
 * Spell is already `incoming`: never with one on its way; otherwise, with
 * the opponent unable to cast, or not Charging, beyond Depulso's reach and
 * either out of sight behind Cover or at least `ai.potions.safeDistance` away.
 */
export const safeToDrink = ({
  arena,
  incoming,
  opponent,
  self,
  settings,
}: {
  readonly arena: ArenaLayout;
  readonly incoming: boolean;
  readonly opponent: DuelistState;
  readonly self: DuelistState;
  readonly settings: Tuning;
}) => {
  if (incoming) {
    return false;
  }

  if (helpless(opponent)) {
    return true;
  }

  if (opponent.chargeSeconds > 0 || withinDepulso(opponent, self, settings)) {
    return false;
  }

  return (
    sightBlocked(self.position, opponent.position, arena.cover) ||
    distanceBetween(self.position, opponent.position) >=
      settings.ai.potions.safeDistance
  );
};

/**
 * Which Potion makes sense for `self` to drink now, `hide` when it needs
 * Wiggenweld but it is not safe to drink, or undefined:
 * - Wiggenweld at `low` Health, if it is `safe`;
 * - Swiftness to chase its Wand lying more than `ai.potions.chaseDistance`
 *   off, or to get away at low Health with no Wiggenweld left (safe);
 * - Strength while the opponent is Disarmed or its own Focus is full (safe).
 * Never with a Spell `incoming`. A Potion whose effect is still on is not drunk again.
 */
export const potionToDrink = ({
  incoming,
  low,
  opponent,
  safe,
  self,
  settings,
}: {
  readonly incoming: boolean;
  readonly low: boolean;
  readonly opponent: DuelistState;
  readonly safe: boolean;
  readonly self: DuelistState;
  readonly settings: Tuning;
}): PotionKind | "hide" | undefined => {
  const has = (kind: PotionKind) =>
    self.potions[kind] > 0 && potionSlotOf(kind, settings) !== undefined;

  const lasting = (kind: LastingPotion) =>
    has(kind) && self.potionEffects[kind] === 0;

  if (low && has("wiggenweld")) {
    return safe ? "wiggenweld" : "hide";
  }

  const wandFar =
    self.looseWand !== null &&
    distanceBetween(self.position, self.looseWand.landing) >
      settings.ai.potions.chaseDistance;

  if (lasting("swiftness") && !incoming && (wandFar || (low && safe))) {
    return "swiftness";
  }

  const strong =
    opponent.looseWand !== null || self.focus >= settings.focus.max;

  if (lasting("strength") && safe && self.looseWand === null && strong) {
    return "strength";
  }

  return undefined;
};

/** Whether `self` has its hands free to start drinking: on the floor, not Shielding, Dodging, Charging or already drinking. */
export const handsFree = (self: DuelistState) =>
  self.elevation === 0 &&
  !self.shielding &&
  self.dodgeSeconds === 0 &&
  self.chargeSeconds === 0 &&
  self.drinking === null;
