import { idleIntent } from "../duel/intent";
import { boundTo, spellSlots } from "../duel/spell-slots";
import type { SpellSlot } from "../duel/spell-slots";
import type { Tuning } from "../tuning";
import type { Controller } from "./controller";

export interface DisarmsDummySettings {
  /** Ticks of the Round's fight before the first cast. */
  readonly firstCastTicks: number;
  /** Ticks between two casts. */
  readonly intervalTicks: number;
  /** The Spell Slots, to find the one Expelliarmus sits in. */
  readonly spellSlots: Pick<Tuning, "spellSlots">;
}

/**
 * Maniquí desarmador, a Training Dummy for Practice, for trying
 * being Disarmed by hand: a stationary Duelist that keeps itself Locked On to
 * its opponent and casts Expelliarmus at them on a slow beat, but only while
 * they hold their Wand (never while they are Disarmed, so the Wand can be
 * walked over or left to fly home). Free Focus and no Cooldown for it come
 * from the Practice rules (see `duel/practice.ts`), not from this Controller.
 */
export const createDisarmsDummy = (
  settings: DisarmsDummySettings
): Controller => {
  const slot: SpellSlot =
    spellSlots.find(
      (each) => boundTo(each, settings.spellSlots) === "expelliarmus"
    ) ?? "circle";

  // Ticks of fighting seen so far, and the tick the next cast is due.
  let fought = 0;
  let due = settings.firstCastTicks;

  return {
    intent: ({ self, snapshot }) => {
      const me = snapshot.duelists.find((each) => each.id === self);
      const foe = snapshot.duelists.find((each) => each.id !== self);

      if (!me || !foe || snapshot.round.phase !== "fighting") {
        return idleIntent;
      }

      fought += 1;

      const lockOn = me.targetId === null;

      const cast =
        fought >= due && !lockOn && foe.looseWand === null && !foe.knockedOut;

      if (cast) {
        due = fought + settings.intervalTicks;
      }

      return {
        ...idleIntent,
        lockOn,
        spellSlots: { held: cast, press: cast ? slot : null },
      };
    },
  };
};
