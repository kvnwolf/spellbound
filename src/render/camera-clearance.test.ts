import { describe, expect, it } from "vitest";

import { courtyard } from "../arena/courtyard";
import { distanceBetween } from "../duel/geometry";
import type { GroundPoint } from "../duel/geometry";
import { tuning } from "../tuning";
import { chooseSwing, swingCameraOffset } from "./camera-clearance";

const { margin, minDistance } = tuning.camera.clearance;
const { bounds, cover } = courtyard;

/** True when `point` is outside the walls or inside a column, with the camera's margin. */
const obstructed = (point: GroundPoint) =>
  Math.abs(point.x) > bounds.halfWidth - margin + 1e-6 ||
  Math.abs(point.z) > bounds.halfDepth - margin + 1e-6 ||
  cover.some(
    (column) =>
      distanceBetween(point, column.center) < column.radius + margin - 1e-6
  );

/** True when a wall or column obstructs the straight line from the Duelist to the camera. */
const hidden = (from: GroundPoint, to: GroundPoint) => {
  for (let step = 0; step <= 200; step += 1) {
    const along = step / 200;

    const sample = {
      x: from.x + (to.x - from.x) * along,
      z: from.z + (to.z - from.z) * along,
    };

    if (obstructed(sample)) {
      return true;
    }
  }

  return false;
};

const offsetAt = (angle: number, length: number): GroundPoint => ({
  x: Math.sin(angle) * length,
  z: Math.cos(angle) * length,
});

/** Duelist positions the Arena allows, on a grid of 1 m. */
const standingPoints = (): GroundPoint[] => {
  const reach = tuning.duelist.bodyRadius;
  const points: GroundPoint[] = [];

  for (
    let x = -bounds.halfWidth + reach;
    x <= bounds.halfWidth - reach;
    x += 1
  ) {
    for (
      let z = -bounds.halfDepth + reach;
      z <= bounds.halfDepth - reach;
      z += 1
    ) {
      const point = { x, z };

      if (
        cover.every(
          (column) =>
            distanceBetween(point, column.center) >= column.radius + reach
        )
      ) {
        points.push(point);
      }
    }
  }

  return points;
};

/** The camera offset the rig would publish for a wanted offset: choose the swing, apply it. */
const settled = (
  origin: GroundPoint,
  wanted: GroundPoint,
  previousSwing = 0
) => {
  const swing = chooseSwing(
    origin,
    wanted,
    courtyard,
    tuning.camera.clearance,
    previousSwing
  );

  return {
    offset: swingCameraOffset(
      origin,
      wanted,
      swing,
      courtyard,
      tuning.camera.clearance
    ),
    swing,
  };
};

describe("keeping the camera clear of the Arena", () => {
  it("leaves the wanted offset alone in open ground", () => {
    const wanted = { x: 0.9, z: 4.6 };

    const { offset, swing } = settled({ x: 0, z: 0 }, wanted);

    expect(swing).toBe(0);
    expect(offset.x).toBeCloseTo(wanted.x);
    expect(offset.z).toBeCloseTo(wanted.z);
  });

  it("never puts the camera outside the walls, inside a column or behind one", () => {
    for (const origin of standingPoints()) {
      for (let step = 0; step < 24; step += 1) {
        const wanted = offsetAt((step / 24) * Math.PI * 2, 4.7);
        const { offset } = settled(origin, wanted);
        const camera = { x: origin.x + offset.x, z: origin.z + offset.z };

        expect(obstructed(camera)).toBeFalsy();
        expect(hidden(origin, camera)).toBeFalsy();
      }
    }
  });

  it("swings round to open ground instead of hugging a Duelist pinned against a wall", () => {
    const origin = { x: 0, z: bounds.halfDepth - tuning.duelist.bodyRadius };

    const { offset, swing } = settled(origin, { x: 0.9, z: 4.6 });

    expect(Math.abs(swing)).toBeGreaterThan(0.5);
    expect(Math.hypot(offset.x, offset.z)).toBeGreaterThanOrEqual(minDistance);
  });

  it("keeps most of the distance when a column only forces a small swing", () => {
    // A Duelist just in front of a column, camera wanted straight behind it.
    const { offset } = settled({ x: 4, z: 2.4 }, { x: 0, z: 4.6 });

    expect(Math.hypot(offset.x, offset.z)).toBeGreaterThan(3.5);
  });

  it("stays on the side it was already swung to when both sides are equally open", () => {
    const origin = { x: 0, z: bounds.halfDepth - tuning.duelist.bodyRadius };
    const wanted = { x: 0, z: 4.6 };

    expect(settled(origin, wanted, 0.8).swing).toBeGreaterThan(0.5);
    expect(settled(origin, wanted, -0.8).swing).toBeLessThan(-0.5);
  });

  it("swings back to straight behind once the way is open again", () => {
    const { swing } = settled({ x: 0, z: 0 }, { x: 0, z: 4.6 }, 1.2);

    expect(swing).toBe(0);
  });

  it("finds open ground for a Duelist wedged in a corner", () => {
    const origin = {
      x: bounds.halfWidth - tuning.duelist.bodyRadius,
      z: -bounds.halfDepth + tuning.duelist.bodyRadius,
    };

    // Wanted straight into the corner.
    const { offset } = settled(origin, { x: 3.5, z: -3 });

    expect(Math.hypot(offset.x, offset.z)).toBeGreaterThanOrEqual(minDistance);
  });

  it("pulls in smoothly as the view sweeps across the edge of a column", () => {
    // Beside a column: as the camera swings round, its line of sight crosses
    // the column's edge. The distance must change gradually, not pop.
    const origin = { x: 4, z: 1.5 };
    const wanted = { x: 0, z: 4.6 };
    let previous: GroundPoint | undefined;
    let largestStep = 0;

    for (let step = -1570; step <= 1570; step += 1) {
      const offset = swingCameraOffset(
        origin,
        wanted,
        step / 1000,
        courtyard,
        tuning.camera.clearance
      );

      if (previous) {
        largestStep = Math.max(
          largestStep,
          Math.hypot(offset.x - previous.x, offset.z - previous.z)
        );
      }

      previous = offset;
    }

    expect(largestStep).toBeLessThan(0.3);
  });
});
