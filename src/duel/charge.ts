/**
 * How a Heavy Spell's Charge reads after it has been held for some seconds:
 * the one place the Charge windows are interpreted, shared by the Duel
 * simulation (which decides Perfect Release and Backfire) and the views
 * (the Charge ring, wand sparks and the FOV push), so they never disagree.
 * Pure: no three.js, no DOM.
 */
import type { Tuning } from "../tuning";
import { clamp } from "./geometry";

type ChargeTuning = Tuning["confringo"];

/** Charge time is a whole number of ticks; this absorbs the float error of comparing it with the windows. */
const slack = 1e-6;

/**
 * Where a Charge stands:
 * - `none`: not Charging.
 * - `building`: filling; a release casts a partial Charge.
 * - `perfect`: in the Perfect Release window right as it fills; a release is empowered.
 * - `full`: full and past the Perfect Release window, a moment from
 *   Backfiring (the views flash red as the warning).
 * - `overcharged`: held past the moment after full; it Backfires.
 */
export type ChargeStage =
  | "building"
  | "full"
  | "none"
  | "overcharged"
  | "perfect";

/** When a held Charge Backfires, in seconds since the press: a short moment past full. */
const backfireAt = (settings: ChargeTuning) =>
  settings.fullSeconds + settings.backfire.delaySeconds;

export const chargeStage = (
  seconds: number,
  settings: ChargeTuning
): ChargeStage => {
  const { early, late } = settings.perfectRelease;

  if (seconds <= 0) {
    return "none";
  }

  if (seconds > backfireAt(settings) + slack) {
    return "overcharged";
  }

  if (seconds < settings.fullSeconds - early - slack) {
    return "building";
  }

  return seconds <= settings.fullSeconds + late + slack ? "perfect" : "full";
};

/** How full the Charge is after `seconds`, from 0 to 1. */
export const chargeLevel = (seconds: number, settings: ChargeTuning) =>
  clamp(seconds / settings.fullSeconds, 0, 1);

/**
 * How close a full Charge is to Backfiring: 0 as it fills, rising to 1 at the
 * moment it Backfires. The wand sparks escalate with it.
 */
export const overchargeShare = (seconds: number, settings: ChargeTuning) =>
  clamp(
    (seconds - settings.fullSeconds) / settings.backfire.delaySeconds,
    0,
    1
  );
