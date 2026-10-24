/**
 * Every Duelist Charging their Heavy Spell, as the Spell VFX draws them: the
 * Wand tip the Charge crackles at (the one on screen when `visibleTip` knows
 * it, since the raised arm moves it; else the simulation's own, where the
 * Spell will leave from), how full the Charge is and how close it is to
 * Overcharging.
 */
import { chargeLevel, overchargeShare } from "../duel/charge";
import { wandTip } from "../duel/duel";
import type { DuelistId, DuelistState } from "../duel/duel";
import type { Point3 } from "../duel/geometry";
import type { Tuning } from "../tuning";
import type { ChargingWand } from "./spell-vfx";

export const chargingWands = (
  duelists: readonly DuelistState[],
  settings: Tuning,
  visibleTip: (id: DuelistId) => Point3 | undefined
): ChargingWand[] =>
  duelists.flatMap((each) =>
    each.chargeSeconds > 0
      ? [
          {
            level: chargeLevel(each.chargeSeconds, settings.confringo),
            overcharge: overchargeShare(each.chargeSeconds, settings.confringo),
            tip: visibleTip(each.id) ?? wandTip(each, settings),
          },
        ]
      : []
  );
