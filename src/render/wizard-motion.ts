/**
 * The motion maths behind the procedural wizard, free of meshes: easing
 * curves, the dt-correct exponential follow every pose weight eases with,
 * two-bone IK for arms and legs, a fixed-step spring for the cloth's lag,
 * and the gait that keeps planted feet still on the floor.
 *
 * Everything works in the Duelist's body frame: metres, +y up, +z the way
 * the Duelist faces and +x to their left (the right hand is at -x).
 */
import { Vector3 } from "three/webgpu";

import type { Tuning } from "../tuning";

/** Clamps to [0, 1]. */
export const unit = (value: number) => Math.min(Math.max(value, 0), 1);

/** Eases in and out (smoothstep) over [0, 1]. */
export const smooth = (progress: number) => {
  const t = unit(progress);

  return t * t * (3 - 2 * t);
};

/** Eases out: fast at first, settling. */
export const easeOut = (progress: number) => 1 - (1 - unit(progress)) ** 3;

/** Eases in: slow at first, accelerating (like a fall). */
export const easeIn = (progress: number) => unit(progress) ** 2;

/** Smoothstep between two edges. */
export const ramp = (from: number, to: number, value: number) =>
  smooth((value - from) / (to - from));

/**
 * A pulse over a one-shot's progress: up to 1 by `peak` (eased out), back to
 * 0 by the end (eased in and out). 0 outside [0, 1].
 */
export const pulse = (progress: number, peak: number) => {
  if (progress <= 0 || progress >= 1) {
    return 0;
  }

  return progress < peak
    ? easeOut(progress / peak)
    : 1 - smooth((progress - peak) / (1 - peak));
};

/**
 * Moves `value` toward `target` the share a perceptual follow of
 * `sharpness` per second covers in `seconds`, whatever the frame rate.
 */
export const approach = (
  value: number,
  target: number,
  sharpness: number,
  seconds: number
) => value + (target - value) * (1 - Math.exp(-sharpness * seconds));

const scratchAxis = new Vector3();
const scratchBend = new Vector3();
const fallbackBend = new Vector3(0, 0, 1);

/**
 * Two-bone IK: from `root`, with an upper bone of `upper` and a lower bone
 * of `lower` metres, reaches for `target`, bending toward `hint`. Writes the
 * middle joint (elbow or knee) and the reached end; returns how far the end
 * fell short of the target (0 when it was within reach).
 */
export const solveLimb = (
  root: Vector3,
  target: Vector3,
  upper: number,
  lower: number,
  hint: Vector3,
  middle: Vector3,
  end: Vector3
): number => {
  const span = upper + lower;
  // Kept off both ends of the reach, relative to the limb's size.
  const margin = span * 1e-3;
  scratchAxis.subVectors(target, root);
  const wanted = scratchAxis.length();

  if (wanted < 1e-6) {
    scratchAxis.set(0, -1, 0);
  } else {
    scratchAxis.divideScalar(wanted);
  }

  const reach = Math.min(
    Math.max(wanted, Math.abs(upper - lower) + margin),
    span - margin
  );

  const along = (upper * upper - lower * lower + reach * reach) / (2 * reach);
  const out = Math.sqrt(Math.max(upper * upper - along * along, 0));

  // The bend direction, square to the limb (Gram-Schmidt), with a fixed
  // fallback when the hint lies along it.
  scratchBend.copy(hint).addScaledVector(scratchAxis, -hint.dot(scratchAxis));

  if (scratchBend.lengthSq() < 1e-8) {
    scratchBend
      .copy(fallbackBend)
      .addScaledVector(scratchAxis, -fallbackBend.dot(scratchAxis));
  }

  scratchBend.normalize();

  middle
    .copy(root)
    .addScaledVector(scratchAxis, along)
    .addScaledVector(scratchBend, out);
  end.copy(root).addScaledVector(scratchAxis, reach);

  return Math.max(wanted - reach, 0);
};

/** A damped spring's state on three axes, stepped at a fixed rate. */
export interface Spring {
  /** Where it is now, between its last two fixed steps. */
  readonly position: Vector3;
  /** Steps it toward `target` (held over the interval) by `seconds`. */
  readonly advance: (target: Vector3, seconds: number) => void;
  /** Puts it at rest on `target` at once. */
  readonly reset: (target: Vector3) => void;
}

/**
 * A mass-normalised spring (`stiffness` s⁻², `damping` s⁻¹) advanced on its
 * own fixed step, so the cloth swings the same at any frame rate; it is
 * drawn between its last two steps.
 */
export const createSpring = (
  settings: Tuning["duelist"]["cloth"]["spring"]
) => {
  const { damping, maxSubsteps, step, stiffness } = settings;
  const previous = new Vector3();
  const current = new Vector3();
  const velocity = new Vector3();
  const position = new Vector3();
  const acceleration = new Vector3();
  let owed = 0;

  const spring: Spring = {
    advance: (target, seconds) => {
      owed = Math.min(owed + seconds, step * maxSubsteps);

      while (owed >= step) {
        previous.copy(current);
        acceleration
          .subVectors(target, current)
          .multiplyScalar(stiffness)
          .addScaledVector(velocity, -damping);
        velocity.addScaledVector(acceleration, step);
        current.addScaledVector(velocity, step);
        owed -= step;
      }

      position.lerpVectors(previous, current, owed / step);
    },
    position,
    reset: (target) => {
      previous.copy(target);
      current.copy(target);
      position.copy(target);
      velocity.set(0, 0, 0);
      owed = 0;
    },
  };

  return spring;
};

/** Where one foot is this frame in the gait, relative to its standing home. */
export interface Stride {
  /** Metres along the direction of travel, ahead of home. */
  along: number;
  /** Metres the foot is lifted off the floor. */
  lift: number;
  /** In the air (swinging forward) rather than planted. */
  swinging: boolean;
  /** How far through its swing, 0 to 1 (0 while planted). */
  swing: number;
}

/**
 * The gait: a cycle that advances by the ground actually covered, so a
 * planted foot slides back under the body exactly as fast as the body moves
 * forward and stays put on the floor. Each foot is planted for `stance`
 * of the cycle (less when running, with both feet in the air between
 * steps), sweeping `sweep` metres; then it swings forward, lifted.
 */
export const createGait = (settings: Tuning["duelist"]["gait"]) => {
  let phase = 0;
  let sweep = settings.sweepBase;
  let stance = settings.walkStance;

  const strideOf = (offset: number, out: Stride) => {
    const cycle = (((phase + offset) % 1) + 1) % 1;

    if (cycle < stance) {
      out.along = sweep * (0.5 - cycle / stance);
      out.lift = 0;
      out.swinging = false;
      out.swing = 0;

      return out;
    }

    const swing = (cycle - stance) / (1 - stance);
    out.along = sweep * (smooth(swing) - 0.5);
    // Lifted highest a little before mid-swing: the heel kicks up first.
    out.lift =
      (settings.liftBase + settings.liftPerSweep * sweep) *
      Math.sin(Math.PI * swing ** settings.liftSkew);
    out.swinging = true;
    out.swing = swing;

    return out;
  };

  return {
    /**
     * Advances the cycle by `distance` metres covered at `speed` metres per
     * second (the eased speed sets the stride's length and stance).
     */
    advance: (distance: number, speed: number) => {
      sweep = Math.min(
        settings.maxSweep,
        settings.sweepBase + settings.sweepPerSpeed * speed
      );
      stance =
        settings.walkStance +
        (settings.runStance - settings.walkStance) *
          ramp(settings.runFrom, settings.runAt, speed);
      phase = (phase + (distance * stance) / sweep) % 1;
    },
    /** The cycle, 0 to 1: the left foot touches down at 0, the right at a half. */
    phase: () => phase,
    /** How much of each cycle a foot is planted, this stride. */
    stance: () => stance,
    stride: strideOf,
    /** How far a planted foot travels back under the body, this stride (metres). */
    sweep: () => sweep,
  };
};
