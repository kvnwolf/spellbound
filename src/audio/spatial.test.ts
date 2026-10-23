import { describe, expect, it } from "vitest";

import { placement } from "./spatial";
import type { Listener, SpatialSettings } from "./spatial";

/** Round numbers, so expected gains can be worked out by hand. */
const settings: SpatialSettings = {
  maxPan: 0.8,
  minGain: 0.1,
  opponentGain: 0.5,
  refDistance: 2,
  rolloff: 1,
};

/** At the origin, looking down the Arena (-z): +x is to the right. */
const listener: Listener = {
  forward: { x: 0, y: 0, z: -1 },
  position: { x: 0, y: 2, z: 0 },
};

const near = (x: number, z: number) => ({ x, y: 2, z });

describe(placement, () => {
  it("puts the local Duelist's sounds dead centre at full volume", () => {
    expect(placement(null, false, listener, settings)).toStrictEqual({
      gain: 1,
      pan: 0,
    });
  });

  it("keeps full volume within the reference distance and fades beyond it", () => {
    expect(placement(near(0, -2), false, listener, settings)).toStrictEqual({
      gain: 1,
      pan: 0,
    });
    expect(placement(near(0, -4), false, listener, settings).gain).toBeCloseTo(
      0.5
    );
    expect(placement(near(0, -100), false, listener, settings).gain).toBe(0.1);
  });

  it("pans a sound toward the side it comes from", () => {
    expect(placement(near(3, 0), false, listener, settings).pan).toBeCloseTo(
      0.8
    );
    expect(placement(near(-3, 0), false, listener, settings).pan).toBeCloseTo(
      -0.8
    );
    expect(placement(near(1, -1), false, listener, settings).pan).toBeCloseTo(
      0.8 * Math.SQRT1_2
    );

    const facingEast: Listener = { ...listener, forward: { x: 1, y: 0, z: 0 } };

    expect(placement(near(0, 3), false, facingEast, settings).pan).toBeCloseTo(
      0.8
    );
  });

  it("does not pan a sound right above or below the listener", () => {
    expect(placement({ x: 0, y: 6, z: 0 }, false, listener, settings).pan).toBe(
      0
    );
  });

  it("plays the opponent's sounds a touch quieter", () => {
    expect(placement(near(0, -4), true, listener, settings).gain).toBeCloseTo(
      0.25
    );
  });
});
