import { describe, expect, it } from "vitest";

import { offAxisPixels } from "./crosshair-size";

describe(offAxisPixels, () => {
  it("is zero on the view axis and the half height at the vertical field of view's edge", () => {
    expect(offAxisPixels(0, 55, 1080)).toBe(0);
    expect(offAxisPixels((55 / 2) * (Math.PI / 180), 55, 1080)).toBeCloseTo(
      540
    );
  });

  it("puts 0.035 rad about 36 px off the centre of a 1080p, 55 degree view", () => {
    // tan(0.035) = 0.035012, tan(27.5 degrees) = 0.52057: 0.067257 * 540.
    expect(offAxisPixels(0.035, 55, 1080)).toBeCloseTo(36.3, 1);
  });

  it("scales with the canvas height", () => {
    expect(offAxisPixels(0.035, 55, 540)).toBeCloseTo(
      offAxisPixels(0.035, 55, 1080) / 2
    );
  });
});
