/**
 * Every Duelist Charging their Heavy Spell, as the Spell VFX draws them: the
 * Wand tip the Spell will leave from (the simulation's own), how full the
 * Charge is and how close it is to Overcharging.
 */
import { chargeLevel, overchargeShare } from "../duel/charge";
import { wandTip } from "../duel/duel";
import type { DuelistState } from "../duel/duel";
import type { Tuning } from "../tuning";
import type { ChargingWand } from "./spell-vfx";

export const chargingWands = (
  duelists: readonly DuelistState[],
  settings: Tuning
): ChargingWand[] =>
  duelists.flatMap((each) =>
    each.chargeSeconds > 0
      ? [
          {
            level: chargeLevel(each.chargeSeconds, settings.confringo),
            overcharge: overchargeShare(each.chargeSeconds, settings.confringo),
            tip: wandTip(each, settings),
          },
        ]
      : []
  );
