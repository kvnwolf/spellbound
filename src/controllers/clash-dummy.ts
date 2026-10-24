import { clashOpponentOf } from "../duel/duel";
import { idleIntent } from "../duel/intent";
import type { Controller } from "./controller";

/** Charge time is a whole number of ticks; this absorbs the float error of comparing it with `fullSeconds`. */
const slack = 1e-6;

export interface ClashDummySettings {
  /** Seconds of holding that fill a Confringo's Charge. */
  readonly fullSeconds: number;
  /** Ticks past full it holds when the player overcharges, short of the Backfire. */
  readonly holdPastFullTicks: number;
  /** Ticks between two Clash pumps. */
  readonly pumpEveryTicks: number;
}

/**
 * Maniquí de Clash, a Training Dummy for Practice, for trying the
 * Clash by hand: a stationary Duelist that keeps itself Locked On to its
 * opponent and mirrors their Confringo. When the opponent starts Charging it
 * does too, and it lets go of a full Charge as they let go (a tick behind,
 * since it reads the last tick), or a few ticks past full if they hold on, so
 * it never Backfires; the two Confringos meet head-on. Once locked in a
 * Clash it pumps at a steady rate, so the player wins by pumping faster.
 */
export const createClashDummy = (settings: ClashDummySettings): Controller => {
  // Released this Charge: no new one until the opponent lets go of theirs.
  let spent = false;
  let sinceFull = 0;
  let sincePump = 0;

  return {
    intent: ({ self, snapshot }) => {
      const me = snapshot.duelists.find((each) => each.id === self);
      const foe = snapshot.duelists.find((each) => each.id !== self);

      if (!me || !foe) {
        return idleIntent;
      }

      const lockOn = me.targetId === null;

      if (clashOpponentOf(snapshot.clash, self) !== undefined) {
        sincePump += 1;
        const clashPump = sincePump >= settings.pumpEveryTicks;

        if (clashPump) {
          sincePump = 0;
        }

        return { ...idleIntent, clashPump, lockOn };
      }

      sincePump = 0;

      const foeCharging = foe.chargeSeconds > 0;

      if (!foeCharging) {
        spent = false;
      }

      if (me.chargeSeconds === 0) {
        sinceFull = 0;

        return { ...idleIntent, heavySpell: foeCharging && !spent, lockOn };
      }

      const full = me.chargeSeconds >= settings.fullSeconds - slack;
      sinceFull = full ? sinceFull + 1 : 0;

      const release =
        full && (!foeCharging || sinceFull > settings.holdPastFullTicks);

      if (release) {
        spent = true;
      }

      return { ...idleIntent, heavySpell: !release, lockOn };
    },
  };
};
