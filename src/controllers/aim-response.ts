/**
 * The right stick's response: a curve that is fine near the centre and fast
 * at full tilt, followed by a critically damped spring that gives the aim a
 * little acceleration and smoothing. Pure and stateful per Duelist.
 */
import type { Vec2 } from "../duel/intent";
import type { Tuning } from "../tuning";

export interface AimResponse {
  /** Advances the response by `seconds` toward `stick` and returns the eased aim offset. */
  readonly step: (stick: Vec2, seconds: number) => Vec2;
  /** Drops back to rest, for when the stick stops being read at all. */
  readonly reset: () => void;
}

/** Radial response curve: keeps the stick's direction, reshapes its deflection. */
const applyCurve = (stick: Vec2, exponent: number): Vec2 => {
  const length = Math.hypot(stick.x, stick.y);

  if (length === 0) {
    return { x: 0, y: 0 };
  }

  const curved = Math.min(length, 1) ** exponent;

  return { x: (stick.x / length) * curved, y: (stick.y / length) * curved };
};

export const createAimResponse = (
  settings: Tuning["input"]["aimResponse"]
): AimResponse => {
  let position = { x: 0, y: 0 };
  let velocity = { x: 0, y: 0 };

  // Exact critically damped spring step for one axis: no overshoot of a
  // steady target, and the same result at any frame rate.
  const spring = (
    from: number,
    speed: number,
    to: number,
    seconds: number
  ): [number, number] => {
    const omega = settings.springFrequency;
    const decay = Math.exp(-omega * seconds);
    const gap = from - to;
    const carry = (speed + omega * gap) * seconds;

    return [to + (gap + carry) * decay, (speed - omega * carry) * decay];
  };

  return {
    reset: () => {
      position = { x: 0, y: 0 };
      velocity = { x: 0, y: 0 };
    },
    step: (stick, seconds) => {
      const wanted = applyCurve(stick, settings.curveExponent);
      const [x, vx] = spring(position.x, velocity.x, wanted.x, seconds);
      const [y, vy] = spring(position.y, velocity.y, wanted.y, seconds);
      const length = Math.hypot(x, y);

      // A reversal can carry the spring past the target; the aim stays within full deflection.
      position = length > 1 ? { x: x / length, y: y / length } : { x, y };
      velocity = { x: vx, y: vy };

      return position;
    },
  };
};
