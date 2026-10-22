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
 * - `full`: full and safe to hold, waiting for an opening.
 * - `overcharged`: held past the safe window; it Backfires.
 */
export type ChargeStage =
  | "building"
  | "full"
  | "none"
  | "overcharged"
  | "perfect";

export const chargeStage = (
  seconds: number,
  settings: ChargeTuning
): ChargeStage => {
  const { early, late } = settings.perfectRelease;

  if (seconds <= 0) {
    return "none";
  }

  if (seconds > settings.safeSeconds + slack) {
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
 * How close a held full Charge is to Overcharging: 0 until the Perfect
 * Release window closes, rising to 1 at the moment it would Backfire. The
 * views escalate their warnings with it.
 */
export const overchargeShare = (seconds: number, settings: ChargeTuning) => {
  const safeFrom = settings.fullSeconds + settings.perfectRelease.late;

  return clamp((seconds - safeFrom) / (settings.safeSeconds - safeFrom), 0, 1);
};
