import { describe, expect, it } from "vitest";

import { courtyard } from "../arena/courtyard";
import { aimPivot } from "../duel/aim";
import { directionOf } from "../duel/geometry";
import type { GroundPoint, Point3 } from "../duel/geometry";
import { tuning } from "../tuning";
import {
  freeCameraPose,
  knockoutSide,
  knockoutViewpoint,
} from "./camera-framing";

const { bounds } = courtyard;
const { bodyRadius, chestHeight } = tuning.duelist;
const { lift } = tuning.camera.free;

/** The free camera the rig settles on (no easing) for a Duelist at `position`. */
const settledFree = (
  position: GroundPoint,
  yaw: number,
  facing: GroundPoint,
  pitch = 0
) => {
  const aim = { pitch, yaw };

  return freeCameraPose(
    {
      facing,
      look: directionOf(aim),
      pivot: aimPivot(position, yaw, courtyard, tuning.aim.eye),
      position,
    },
    courtyard,
    tuning.camera,
    chestHeight
  );
};

const chestOf = (position: GroundPoint): Point3 => ({
  x: position.x,
  y: chestHeight,
  z: position.z,
});

const distance3 = (a: Point3, b: Point3) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/**
 * Where `point` lands on screen from a camera at `eye` looking along the unit
 * `look` (y up): horizontal and vertical angles off the screen centre, as a
 * share of the half field of view (1 is the edge), at a 16:9 aspect.
 */
const onScreen = (eye: Point3, look: Point3, point: Point3) => {
  const right = { x: -look.z, y: 0, z: look.x };
  const rightLength = Math.hypot(right.x, right.z);
  const r = { x: right.x / rightLength, y: 0, z: right.z / rightLength };

  const up = {
    x: r.y * look.z - r.z * look.y,
    y: r.z * look.x - r.x * look.z,
    z: r.x * look.y - r.y * look.x,
  };

  const to = { x: point.x - eye.x, y: point.y - eye.y, z: point.z - eye.z };
  const depth = to.x * look.x + to.y * look.y + to.z * look.z;
  const across = to.x * r.x + to.y * r.y + to.z * r.z;
  const rise = to.x * up.x + to.y * up.y + to.z * up.z;
  const halfV = Math.tan(((tuning.camera.fov / 2) * Math.PI) / 180);
  const halfH = halfV * (16 / 9);

  return {
    depth,
    x: Math.abs(across / depth) / halfH,
    y: Math.abs(rise / depth) / halfV,
  };
};

const insideWalls = (point: Point3) =>
  Math.abs(point.x) <=
    bounds.halfWidth - tuning.camera.clearance.margin + 1e-6 &&
  Math.abs(point.z) <= bounds.halfDepth - tuning.camera.clearance.margin + 1e-6;

describe("the free camera near walls", () => {
  it("keeps the wizard in view and at a distance when they walk toward the camera into a wall", () => {
    // Camera looking down the Arena (-z), so it sits on the +z side; the
    // wizard faces it (+z) and has walked right up to the +z wall.
    const position = { x: 0, z: bounds.halfDepth - bodyRadius };
    const pose = settledFree(position, 0, { x: 0, z: 1 });
    const seen = onScreen(pose.eye, pose.look, chestOf(position));

    expect(distance3(pose.eye, chestOf(position))).toBeGreaterThanOrEqual(
      lift.nearest - 1e-6
    );
    expect(insideWalls(pose.eye)).toBeTruthy();
    expect(seen.depth).toBeGreaterThan(0);
    expect(seen.x).toBeLessThan(0.9);
    expect(seen.y).toBeLessThan(0.9);
  });

  it("stays on the aim line, crosshair true, while the wizard aims with their back to a wall", () => {
    // Same spot, but facing away from the camera: aiming into the Arena.
    const position = { x: 0, z: bounds.halfDepth - bodyRadius };
    const look = directionOf({ pitch: 0, yaw: 0 });
    const pivot = aimPivot(position, 0, courtyard, tuning.aim.eye);
    const pose = settledFree(position, 0, { x: 0, z: -1 });

    // The screen centre looks along the aim, from a point on the aim ray.
    expect(pose.look.x).toBeCloseTo(look.x);
    expect(pose.look.y).toBeCloseTo(look.y);
    expect(pose.look.z).toBeCloseTo(look.z);

    const back = {
      x: pivot.x - pose.eye.x,
      y: pivot.y - pose.eye.y,
      z: pivot.z - pose.eye.z,
    };

    const along = back.x * look.x + back.y * look.y + back.z * look.z;

    expect(
      Math.hypot(
        back.x - look.x * along,
        back.y - look.y * along,
        back.z - look.z * along
      )
    ).toBeCloseTo(0);
  });

  it("never comes right up against the wizard, even while aiming in a corner", () => {
    // Back in the corner with a wall on the right: no room for the shoulder.
    const position = {
      x: bounds.halfWidth - bodyRadius,
      z: bounds.halfDepth - bodyRadius,
    };

    const pose = settledFree(position, 0, { x: 0, z: -1 });

    expect(distance3(pose.eye, chestOf(position))).toBeGreaterThanOrEqual(
      lift.nearest - 1e-6
    );
    expect(insideWalls(pose.eye)).toBeTruthy();
    expect(
      onScreen(pose.eye, pose.look, chestOf(position)).depth
    ).toBeGreaterThan(0);
  });

  it("leaves the wanted free camera alone in open ground", () => {
    const position = { x: 0, z: 6 };
    const pivot = aimPivot(position, 0, courtyard, tuning.aim.eye);
    const pose = settledFree(position, 0, { x: 0, z: 1 });

    expect(pose.eye.x).toBeCloseTo(pivot.x);
    expect(pose.eye.y).toBeCloseTo(pivot.y);
    expect(pose.eye.z).toBeCloseTo(pivot.z + tuning.camera.free.distance);
    expect(pose.look.z).toBeCloseTo(-1);
  });

  it("rises and tilts gradually, never popping, as the wizard walks toward the camera into a wall or a column", () => {
    const walks = [
      // Into the wall behind the camera.
      { from: { x: 0, z: 6 }, to: { x: 0, z: bounds.halfDepth - bodyRadius } },
      // Toward a column the camera backs into, then up to it.
      { from: { x: 3.2, z: -2.9 }, to: { x: 3.2, z: 2.9 } },
      // Diagonally into a corner.
      {
        from: { x: 5, z: 8 },
        to: {
          x: bounds.halfWidth - bodyRadius,
          z: bounds.halfDepth - bodyRadius,
        },
      },
    ];

    for (const { from, to } of walks) {
      let previous: ReturnType<typeof settledFree> | undefined;
      let largestMove = 0;
      let largestTurn = 0;

      for (let step = 0; step <= 1000; step += 1) {
        const along = step / 1000;

        const position = {
          x: from.x + (to.x - from.x) * along,
          z: from.z + (to.z - from.z) * along,
        };

        const pose = settledFree(position, 0, { x: 0, z: 1 });

        expect(distance3(pose.eye, chestOf(position))).toBeGreaterThan(
          tuning.camera.free.lift.forcedFull
        );

        if (previous) {
          largestMove = Math.max(
            largestMove,
            distance3(pose.eye, previous.eye)
          );
          largestTurn = Math.max(
            largestTurn,
            Math.acos(
              Math.min(
                1,
                pose.look.x * previous.look.x +
                  pose.look.y * previous.look.y +
                  pose.look.z * previous.look.z
              )
            )
          );
        }

        previous = pose;
      }

      // Each walk step is under 1 cm; a pop would move the camera far more.
      expect(largestMove).toBeLessThan(0.1);
      expect(largestTurn).toBeLessThan(0.05);
    }
  });

  it("anywhere in the Arena, never leaves the walls or comes right up against the wizard, and keeps a wizard facing it on screen", () => {
    const reach = bodyRadius;

    for (
      let x = -bounds.halfWidth + reach;
      x <= bounds.halfWidth - reach;
      x += 0.5
    ) {
      for (
        let z = -bounds.halfDepth + reach;
        z <= bounds.halfDepth - reach;
        z += 0.5
      ) {
        const position = { x, z };

        if (
          courtyard.cover.some(
            (column) =>
              Math.hypot(x - column.center.x, z - column.center.z) <
              column.radius + reach
          )
        ) {
          continue;
        }

        for (let step = 0; step < 16; step += 1) {
          const yaw = (step / 16) * Math.PI * 2;
          const ahead = { x: Math.sin(yaw), z: -Math.cos(yaw) };

          const aiming = settledFree(position, yaw, ahead);

          const facingCamera = settledFree(position, yaw, {
            x: -ahead.x,
            z: -ahead.z,
          });

          for (const pose of [aiming, facingCamera]) {
            expect(insideWalls(pose.eye)).toBeTruthy();
            expect(distance3(pose.eye, chestOf(position))).toBeGreaterThan(
              tuning.camera.free.lift.forcedFull
            );
          }

          const seen = onScreen(
            facingCamera.eye,
            facingCamera.look,
            chestOf(position)
          );

          expect(seen.depth).toBeGreaterThan(0);
          expect(Math.max(seen.x, seen.y)).toBeLessThan(1);
        }
      }
    }
  });
});

/** Where the Knockout shot stands, its side chosen once from `winner`. */
const knockoutShot = (fallen: GroundPoint, winner: GroundPoint) =>
  knockoutViewpoint(
    fallen,
    knockoutSide(fallen, winner, courtyard, tuning),
    courtyard,
    tuning
  );

describe("the Knockout shot", () => {
  it("frames the fallen wizard from the winner's side when they fell facing a wall", () => {
    // Knocked out facing the +z wall, the winner behind them in the open.
    const fallen = { x: 0, z: bounds.halfDepth - 1 };
    const winner = { x: 0, z: 4 };
    const viewpoint = knockoutShot(fallen, winner);

    expect(insideWalls({ ...viewpoint, y: 0 })).toBeTruthy();
    // On the winner's side of the fallen, between them.
    expect(viewpoint.z).toBeLessThan(fallen.z - 1);
    expect(Math.abs(viewpoint.x)).toBeLessThan(0.5);
  });

  it("swings round a column standing between the fallen wizard and the winner", () => {
    const fallen = { x: 4, z: 5.6 };
    const winner = { x: 4, z: -2 };
    const side = knockoutSide(fallen, winner, courtyard, tuning);
    const viewpoint = knockoutShot(fallen, winner);

    // Turned off the blocked line, but still toward the winner's half.
    expect(Math.abs(side.x)).toBeGreaterThan(0.3);
    expect(side.z).toBeLessThan(0);
    expect(
      Math.hypot(viewpoint.x - fallen.x, viewpoint.z - fallen.z)
    ).toBeCloseTo(tuning.knockoutCamera.standOff);
  });

  it("anywhere in the Arena, stands in the clear with nothing between it and the fallen wizard, and room behind for the camera", () => {
    const reach = bodyRadius;
    const { margin } = tuning.camera.clearance;

    const blocked = (point: GroundPoint) =>
      !insideWalls({ ...point, y: 0 }) ||
      courtyard.cover.some(
        (column) =>
          Math.hypot(point.x - column.center.x, point.z - column.center.z) <
          column.radius + margin - 1e-6
      );

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
        const fallen = { x, z };

        if (
          courtyard.cover.some(
            (column) =>
              Math.hypot(x - column.center.x, z - column.center.z) <
              column.radius + reach
          )
        ) {
          continue;
        }

        for (let step = 0; step < 8; step += 1) {
          const angle = (step / 8) * Math.PI * 2;

          const winner = {
            x: x + Math.sin(angle) * 3,
            z: z + Math.cos(angle) * 3,
          };

          const side = knockoutSide(fallen, winner, courtyard, tuning);
          const viewpoint = knockoutShot(fallen, winner);

          for (let along = 0; along <= 1; along += 0.02) {
            expect(
              blocked({
                x: fallen.x + (viewpoint.x - fallen.x) * along,
                z: fallen.z + (viewpoint.z - fallen.z) * along,
              })
            ).toBeFalsy();
          }

          // Open ground runs on past the viewpoint for the camera behind it.
          expect(
            blocked({ x: fallen.x + side.x * 4, z: fallen.z + side.z * 4 })
          ).toBeFalsy();
        }
      }
    }
  });
});
