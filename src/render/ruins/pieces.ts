/**
 * How each breakable piece of the courtyard is cut: a column of Cover (its
 * fluted shaft and capital, over a stump that stays standing on its plinth)
 * and the fountain (its spout, and the rim of its basin). Cut heights, tilts
 * and wedges are drawn from the piece's own seed, so every column breaks its
 * own way, and the same way every Duel. Every size is the courtyard's: the
 * column's profile is the one `courtyard-view.ts` drew before it broke.
 */
import { Vector3 } from "three/webgpu";

import { createRandom } from "../../controllers/random";
import type { Random } from "../../controllers/random";
import type { Tuning } from "../../tuning";
import { profileThrough } from "./fracture";
import type { Block, Cell, Fling, Plane, Solid } from "./fracture";

type FlingLook = Tuning["structureLook"]["fling"];

const between = (random: Random, min: number, max: number) =>
  min + (max - min) * random();

/** A unit vector in a random direction. */
const anyAxis = (random: Random) => {
  const y = random() * 2 - 1;
  const angle = random() * Math.PI * 2;
  const across = Math.sqrt(1 - y * y);

  return new Vector3(Math.cos(angle) * across, y, Math.sin(angle) * across);
};

/** A cut plane near `height`, tilted by up to `tilt` each way. */
const cutNear = (
  random: Random,
  height: number,
  jitter: number,
  tilt: number
): Plane => ({
  height: height + between(random, -jitter, jitter),
  slopeX: between(random, -tilt, tilt),
  slopeZ: between(random, -tilt, tilt),
});

const flat = (height: number): Plane => ({ height, slopeX: 0, slopeZ: 0 });

const anchored: Fling = {
  anchored: true,
  axis: new Vector3(0, 1, 0),
  delay: 0,
  push: 0,
  spin: 0,
  velocity: new Vector3(),
};

/**
 * A fragment thrown out from the axis toward `angle` (radians round it),
 * higher pieces harder; `share` scales the whole throw.
 */
const thrown = (
  random: Random,
  look: FlingLook,
  angle: number,
  heightShare: number,
  share = 1
): Fling => {
  const out = between(random, look.out.min, look.out.max) * share;
  const up = between(random, look.up.min, look.up.max) * share;

  return {
    anchored: false,
    axis: anyAxis(random),
    delay: between(random, 0, look.delay),
    push: between(random, look.push.min, look.push.max) * (0.5 + heightShare),
    spin: between(random, look.spin.min, look.spin.max),
    velocity: new Vector3(Math.cos(angle) * out, up, Math.sin(angle) * out),
  };
};

/** Splits a whole drum round the grid into `count` wedges at jittered angles. */
const wedges = (random: Random, steps: number, count: number) => {
  const start = Math.floor(random() * steps);
  const cuts: number[] = [];

  for (let index = 0; index < count; index += 1) {
    const even = (index * steps) / count;
    // The first cut is the start itself, so the last wedge closes on it.
    const jitter = index === 0 ? 0 : (random() - 0.5) * (steps / count) * 0.5;
    cuts.push(start + Math.round(even + jitter));
  }

  return cuts.map((from, index) => ({
    from,
    to: index + 1 < cuts.length ? (cuts[index + 1] ?? from) : start + steps,
  }));
};

const gridAngle = (steps: number, step: number) => (step / steps) * Math.PI * 2;

export interface PieceCuts {
  readonly solid: Solid;
  readonly cells: readonly Cell[];
  readonly welded: ReadonlyMap<number, readonly Block[]>;
  /** How far from its axis a fragment can end up, metres. */
  readonly reach: number;
}

/**
 * A column: its moulded base and the bottom of its shaft stay standing as a
 * stump with a jagged top; the shaft above breaks into drums of two or
 * three wedges; the capital comes away whole with the abacus on it.
 */
export const columnCuts = (
  radius: number,
  seed: number,
  look: Tuning["structureLook"]
): PieceCuts => {
  const random = createRandom(seed);
  const shaft = radius;
  const top = 3.92;

  const outer = profileThrough([
    [radius * 1.12, 0.3],
    [radius * 1.12, 0.38],
    [radius * 1.05, 0.46],
    [shaft, 0.55],
    // A slight swelling (entasis) a third of the way up.
    [shaft * 1.03, 1.6],
    [shaft * 0.92, 3.5],
    [shaft * 1.05, 3.62],
    [radius * 1.3, 3.85],
    [radius * 1.3, top],
  ]);

  const solid: Solid = {
    outer,
    rings: 3,
    roughness: look.roughness,
    rows: 5,
    steps: 40,
  };

  const { column } = look;
  const cuts: Plane[] = [];
  const span = (column.capital - column.stump) / column.drums;

  for (let index = 0; index <= column.drums; index += 1) {
    cuts.push(
      cutNear(
        random,
        column.stump + span * index,
        index === 0 ? column.stumpJitter : span * 0.18,
        column.tilt
      )
    );
  }

  const cells: Cell[] = [];
  const stumpTop = cuts[0] ?? flat(column.stump);

  cells.push({
    fling: anchored,
    from: 0,
    lower: flat(0.3),
    lowerCut: false,
    to: solid.steps,
    upper: stumpTop,
    upperCut: true,
  });

  for (let drum = 0; drum < column.drums; drum += 1) {
    const lower = cuts[drum] ?? stumpTop;
    const upper = cuts[drum + 1] ?? lower;
    const height = (drum + 1) / column.drums;
    const count = random() < 0.5 ? 2 : 3;

    for (const { from, to } of wedges(random, solid.steps, count)) {
      const angle = gridAngle(solid.steps, (from + to) / 2);

      cells.push({
        fling: thrown(random, look.fling, angle, height),
        from,
        lower,
        lowerCut: true,
        to,
        upper,
        upperCut: true,
      });
    }
  }

  // The capital, whole, with the abacus slab welded on top.
  cells.push({
    fling: thrown(random, look.fling, random() * Math.PI * 2, 1.2, 0.7),
    from: 0,
    lower: cuts.at(-1) ?? flat(column.capital),
    lowerCut: true,
    to: solid.steps,
    upper: flat(top),
    upperCut: false,
  });

  const half = radius * 1.4;

  const abacus: Block = {
    max: new Vector3(half, top + 0.2, half),
    min: new Vector3(-half, top, -half),
  };

  return {
    cells,
    reach: look.reach,
    solid,
    welded: new Map([[cells.length - 1, [abacus]]]),
  };
};

/**
 * The fountain's spout: a short stump stays in the basin; the baluster
 * breaks in two, the bowl in three, and the finial comes off whole. Read as
 * a solid (the bowl's hollow is drawn shut).
 */
export const spoutCuts = (
  seed: number,
  look: Tuning["structureLook"]
): PieceCuts => {
  const random = createRandom(seed);

  const outer = profileThrough([
    [0.34, 0.14],
    [0.3, 0.2],
    [0.2, 0.27],
    [0.14, 0.42],
    [0.12, 0.54],
    [0.2, 0.6],
    [0.5, 0.66],
    [0.56, 0.7],
    [0.52, 0.73],
    [0.12, 0.75],
    [0.07, 0.78],
    [0.1, 0.83],
    [0.04, 0.94],
    [0.005, 0.97],
  ]);

  const solid: Solid = {
    outer,
    rings: 2,
    roughness: look.roughness * 0.5,
    rows: 4,
    steps: 32,
  };

  const stumpTop = cutNear(random, 0.3, 0.04, 0.12);
  const waist = cutNear(random, 0.5, 0.03, 0.1);
  const neck = flat(0.755);

  const cells: Cell[] = [
    {
      fling: anchored,
      from: 0,
      lower: flat(0.14),
      lowerCut: false,
      to: solid.steps,
      upper: stumpTop,
      upperCut: true,
    },
  ];

  const bands: [Plane, Plane, number, boolean][] = [
    [stumpTop, waist, 2, true],
    [waist, neck, 3, true],
  ];

  for (const [lower, upper, count, upperCut] of bands) {
    for (const { from, to } of wedges(random, solid.steps, count)) {
      cells.push({
        fling: thrown(
          random,
          look.fling,
          gridAngle(solid.steps, (from + to) / 2),
          0.6,
          0.6
        ),
        from,
        lower,
        lowerCut: true,
        to,
        upper,
        upperCut,
      });
    }
  }

  cells.push({
    fling: thrown(random, look.fling, random() * Math.PI * 2, 1, 0.6),
    from: 0,
    lower: neck,
    lowerCut: true,
    to: solid.steps,
    upper: flat(0.97),
    upperCut: false,
  });

  return { cells, reach: look.reach, solid, welded: new Map() };
};

/**
 * The fountain's rim: the basin's wall, a ring cut into arcs. Broken, some
 * arcs topple out of the ring and the rest stay where they stood, so the
 * basin is left gap-toothed.
 */
export const rimCuts = (
  outerRadius: number,
  innerRadius: number,
  seed: number,
  look: Tuning["structureLook"]
): PieceCuts => {
  const random = createRandom(seed);

  const outer = profileThrough([
    [outerRadius, 0.12],
    [outerRadius - 0.03, 0.4],
    [outerRadius + 0.02, 0.44],
    [outerRadius - 0.02, 0.5],
  ]);

  const inner = profileThrough([
    [innerRadius, 0.12],
    [innerRadius - 0.02, 0.46],
    [innerRadius + 0.02, 0.5],
  ]);

  const solid: Solid = {
    inner,
    outer,
    rings: 2,
    roughness: look.roughness * 0.5,
    rows: 3,
    steps: 96,
  };

  const cells: Cell[] = [];
  const { arcs } = look.rim;

  for (const { from, to } of wedges(random, solid.steps, arcs)) {
    const angle = gridAngle(solid.steps, (from + to) / 2);
    const falls = random() < look.rim.fallShare;

    cells.push({
      fling: falls
        ? thrown(random, look.fling, angle, 0.2, look.rim.throw)
        : anchored,
      from,
      lower: flat(0.12),
      lowerCut: false,
      to,
      upper: flat(0.5),
      upperCut: false,
    });
  }

  return {
    cells,
    reach: outerRadius + look.reach,
    solid,
    welded: new Map(),
  };
};
