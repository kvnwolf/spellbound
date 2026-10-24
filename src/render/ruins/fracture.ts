/**
 * Pre-fractured stone: a solid of revolution (a column, the fountain's spout
 * and rim) cut at build time into fragments that fit together exactly, so
 * the whole piece is drawn from its fragments while it stands and the same
 * fragments fly apart when it breaks. Deterministic: the same seed always
 * cuts the same way.
 *
 * The solid is cut by tilted planes into drums, and each drum by vertical
 * half-planes into wedges (a "cell"). Every cell is closed on its own: its
 * outer (and inner) surface, the two faces of its vertical cuts, and its
 * bottom and top caps. Cuts snap to one shared angular grid and the planes
 * are evaluated by one function on both sides, so neighbouring cells meet
 * along identical vertices and the standing surface has no seams. Fracture
 * faces are jagged (their inner vertices jittered, never their edges, so
 * each fragment stays watertight) and shaded flat; the stone's own surface
 * stays smooth.
 *
 * Each vertex carries its fragment's motion, evaluated on the GPU by
 * `ruin-material.ts`: the rest centroid it turns about, its launch, its
 * spin, the height it settles at, and a short delay; plus what the shading
 * needs (fracture face or stone surface, how far it is from the nearest
 * cut, along the surface: where cracks open).
 *
 * Geometry is non-indexed (flat fracture faces need their own normals),
 * counted in a first pass and written in a second, so the arrays are
 * allocated exactly.
 */
import { BufferAttribute, BufferGeometry, Sphere, Vector3 } from "three/webgpu";

import { createRandom } from "../../controllers/random";
import type { Random } from "../../controllers/random";

/** A tilted plane, y = height + slopeX * x + slopeZ * z, in the piece's own space. */
export interface Plane {
  readonly height: number;
  readonly slopeX: number;
  readonly slopeZ: number;
}

/** Radius of the solid's surface at a height, metres. */
export type Profile = (y: number) => number;

/** How a fragment moves once its piece breaks (see `ruin-material.ts`). */
export interface Fling {
  /** Launch velocity in the piece's own space, m/s, before the blow's push. */
  readonly velocity: Vector3;
  /** Share of the blow's push this fragment takes (0 for a piece that stays). */
  readonly push: number;
  /** Unit spin axis and rate, radians per second. */
  readonly axis: Vector3;
  readonly spin: number;
  /** Seconds after the break before it moves. */
  readonly delay: number;
  /** Never moves: the stump left standing. */
  readonly anchored: boolean;
}

/** One cell: a wedge of a drum, between two planes and two angles on the grid. */
export interface Cell {
  /** Grid steps round the axis: from `from` to `to` (to > from; to - from = steps for a whole drum). */
  readonly from: number;
  readonly to: number;
  readonly lower: Plane;
  readonly upper: Plane;
  /** Whether its lower and upper planes are cuts (cracks open there), not the solid's own ends. */
  readonly lowerCut: boolean;
  readonly upperCut: boolean;
  readonly fling: Fling;
}

export interface Solid {
  readonly outer: Profile;
  /** For a ring (the fountain's rim): the inner surface's radius; none for a solid. */
  readonly inner?: Profile;
  /** Angular grid steps round the axis that every cut snaps to. */
  readonly steps: number;
  /** Rows up each outer surface patch. */
  readonly rows: number;
  /** Rings across each cap and each vertical cut face. */
  readonly rings: number;
  /** How far fracture faces' inner vertices are jittered, metres. */
  readonly roughness: number;
}

/** A box welded to a cell's fragment (the column's abacus), moving with it. */
export interface Block {
  readonly min: Vector3;
  readonly max: Vector3;
}

/** Vertex attributes, per vertex: names as the material reads them, and their sizes. */
const lanes = [
  ["normal", 3],
  ["position", 3],
  ["ruinFling", 4],
  ["ruinPivot", 3],
  ["ruinRest", 4],
  ["ruinSpin", 4],
] as const;

type Lane = (typeof lanes)[number][0];

/** The seam distance of a point on no cut: far from any crack. */
const noSeam = 99;

const noSeams = [noSeam, noSeam, noSeam] as const;

/** What a fragment's vertices share. */
interface Fragment {
  pivot: Vector3;
  fling: Fling;
  /** The height its centroid settles at once it lies on the floor. */
  restHeight: number;
}

/** Shading kinds (`ruinRest.z`). */
export const stoneSurface = 0;
export const fractureFace = 1;

interface Writer {
  readonly triangle: (
    a: Vector3,
    b: Vector3,
    c: Vector3,
    /** Which way the face should look: the winding follows it. */
    outward: Vector3,
    kind: number,
    seams?: readonly [number, number, number],
    normals?: readonly [Vector3, Vector3, Vector3]
  ) => void;
  fragment: Fragment;
}

/** A writer that only counts triangles: the capacity pass. */
const counter = () => {
  let triangles = 0;

  const writer: Writer = {
    fragment: {
      fling: {
        anchored: true,
        axis: new Vector3(0, 1, 0),
        delay: 0,
        push: 0,
        spin: 0,
        velocity: new Vector3(),
      },
      pivot: new Vector3(),
      restHeight: 0,
    },
    triangle: () => {
      triangles += 1;
    },
  };

  return { triangles: () => triangles, writer };
};

/** A writer into preallocated arrays for exactly `triangles` triangles. */
const filler = (triangles: number) => {
  const vertices = triangles * 3;

  const arrays = new Map<Lane, { data: Float32Array; size: number }>(
    lanes.map(([name, size]) => [
      name,
      { data: new Float32Array(vertices * size), size },
    ])
  );

  let written = 0;
  const edgeA = new Vector3();
  const edgeB = new Vector3();
  const flat = new Vector3();

  const put = (lane: Lane, values: readonly number[]) => {
    const target = arrays.get(lane);
    target?.data.set(values, written * target.size);
  };

  const vertex = (
    point: Vector3,
    normal: Vector3,
    kind: number,
    seam: number,
    fragment: Fragment
  ) => {
    const { fling, pivot } = fragment;

    put("position", [point.x, point.y, point.z]);
    put("normal", [normal.x, normal.y, normal.z]);
    put("ruinPivot", [pivot.x, pivot.y, pivot.z]);
    put("ruinFling", [
      fling.velocity.x,
      fling.velocity.y,
      fling.velocity.z,
      fling.push,
    ]);
    put("ruinSpin", [fling.axis.x, fling.axis.y, fling.axis.z, fling.spin]);
    put("ruinRest", [
      fragment.restHeight,
      fling.anchored ? 1e6 : fling.delay,
      kind,
      seam,
    ]);
    written += 1;
  };

  const writer: Writer = {
    fragment: {
      fling: {
        anchored: true,
        axis: new Vector3(0, 1, 0),
        delay: 0,
        push: 0,
        spin: 0,
        velocity: new Vector3(),
      },
      pivot: new Vector3(),
      restHeight: 0,
    },
    triangle: (a, b, c, outward, kind, seams, normals) => {
      edgeA.subVectors(b, a);
      edgeB.subVectors(c, a);
      flat.crossVectors(edgeA, edgeB);

      // Degenerate slivers (a cap's corner at the axis) are dropped by area,
      // but still counted: they emit nothing visible.
      const flip = flat.dot(outward) < 0;
      const [p1, p2] = flip ? [c, b] : [b, c];
      const [n0, n1, n2] = normals ?? [];
      const [s0, s1, s2] = seams ?? noSeams;

      if (flip) {
        flat.negate();
      }

      flat.normalize();

      vertex(a, n0 ?? flat, kind, s0, writer.fragment);
      vertex(
        p1,
        (flip ? n2 : n1) ?? flat,
        kind,
        flip ? s2 : s1,
        writer.fragment
      );
      vertex(
        p2,
        (flip ? n1 : n2) ?? flat,
        kind,
        flip ? s1 : s2,
        writer.fragment
      );
    },
  };

  const finish = (): BufferGeometry => {
    if (written !== vertices) {
      throw new Error(
        `Fracture wrote ${written} vertices, planned ${vertices}`
      );
    }

    const geometry = new BufferGeometry();

    for (const [name, { data, size }] of arrays) {
      geometry.setAttribute(name, new BufferAttribute(data, size));
    }

    return geometry;
  };

  return { finish, writer };
};

/**
 * The radius at row `row` of `rows` between two meetings: the meetings'
 * own radii at the ends (so neighbours share them exactly), the profile's
 * between.
 */
const rowRadius = (
  row: number,
  rows: number,
  ends: { readonly bottom: number; readonly top: number },
  between: () => number
) => {
  if (row === 0) {
    return ends.bottom;
  }

  return row === rows ? ends.top : between();
};

const angleOf = (solid: Solid, step: number) =>
  (step / solid.steps) * Math.PI * 2;

/**
 * Where `plane` meets the surface `profile` along the angle `angle`: a
 * fixed-point solve (the radius depends on the height, the height on the
 * radius), the same on both sides of every cut.
 */
const meet = (plane: Plane, profile: Profile, angle: number) => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  let radius = profile(plane.height);
  let y = plane.height;

  for (let pass = 0; pass < 4; pass += 1) {
    y = plane.height + radius * (plane.slopeX * cos + plane.slopeZ * sin);
    radius = profile(y);
  }

  return { radius, y };
};

/** The plane's height over the floor point (x, z). */
const heightOn = (plane: Plane, x: number, z: number) =>
  plane.height + plane.slopeX * x + plane.slopeZ * z;

/** A point at `angle`, `radius` from the axis, `y` up. */
const around = (angle: number, radius: number, y: number) =>
  new Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius);

/** The surface normal of `profile` at a height and angle: outward, tilted by the profile's slope. */
const surfaceNormal = (
  profile: Profile,
  angle: number,
  y: number,
  inward: boolean
) => {
  const slope = (profile(y + 0.005) - profile(y - 0.005)) / 0.01;
  const normal = new Vector3(Math.cos(angle), -slope, Math.sin(angle));

  return (inward ? normal.negate() : normal).normalize();
};

/**
 * One surface patch of a cell (outer, or a ring's inner): a grid over the
 * cell's angles and `rows` rows between its planes, with its distance to
 * the nearest cut along the surface for the cracks.
 */
const surfacePatch = (
  writer: Writer,
  solid: Solid,
  cell: Cell,
  profile: Profile,
  inward: boolean
) => {
  const whole = cell.to - cell.from === solid.steps;
  const grid: { point: Vector3; normal: Vector3; seam: number }[][] = [];

  for (let step = cell.from; step <= cell.to; step += 1) {
    const angle = angleOf(solid, step);
    const bottom = meet(cell.lower, profile, angle);
    const top = meet(cell.upper, profile, angle);
    const column = [];

    for (let row = 0; row <= solid.rows; row += 1) {
      const share = row / solid.rows;
      const y = bottom.y + (top.y - bottom.y) * share;

      const radius = rowRadius(
        row,
        solid.rows,
        { bottom: bottom.radius, top: top.radius },
        () => profile(y)
      );

      const sideways = whole
        ? noSeam
        : radius *
          (Math.min(step - cell.from, cell.to - step) / solid.steps) *
          Math.PI *
          2;

      const seam = Math.min(
        sideways,
        cell.lowerCut ? y - bottom.y : noSeam,
        cell.upperCut ? top.y - y : noSeam
      );

      column.push({
        normal: surfaceNormal(profile, angle, y, inward),
        point: around(angle, radius, y),
        seam,
      });
    }

    grid.push(column);
  }

  for (let step = 0; step < grid.length - 1; step += 1) {
    for (let row = 0; row < solid.rows; row += 1) {
      const a = grid[step]?.[row];
      const b = grid[step + 1]?.[row];
      const c = grid[step]?.[row + 1];
      const d = grid[step + 1]?.[row + 1];

      if (!a || !b || !c || !d) {
        continue;
      }

      const outward = a.normal.clone().add(d.normal);

      writer.triangle(
        a.point,
        b.point,
        c.point,
        outward,
        stoneSurface,
        [a.seam, b.seam, c.seam],
        [a.normal, b.normal, c.normal]
      );
      writer.triangle(
        b.point,
        d.point,
        c.point,
        outward,
        stoneSurface,
        [b.seam, d.seam, c.seam],
        [b.normal, d.normal, c.normal]
      );
    }
  }
};

/**
 * A fracture face over a grid of points (`grid[u][v]`), its inner points
 * pushed along `outward` by up to the solid's roughness: jagged inside, its
 * edges untouched so it still meets the faces around it.
 */
const jaggedFace = (
  writer: Writer,
  grid: Vector3[][],
  outward: Vector3,
  roughness: number,
  random: Random,
  /** Inner points of these grid lines stay put too (a cap's centre line, say). */
  keep: (u: number, v: number) => boolean = () => false
) => {
  const along = outward.clone().normalize();
  const last = grid.length - 1;

  for (const [u, line] of grid.entries()) {
    const lastV = line.length - 1;

    for (const [v, point] of line.entries()) {
      const edge = u === 0 || u === last || v === 0 || v === lastV;

      if (!edge && !keep(u, v)) {
        point.addScaledVector(along, (random() * 2 - 1) * roughness);
      }
    }
  }

  for (let u = 0; u < last; u += 1) {
    const line = grid[u] ?? [];
    const next = grid[u + 1] ?? [];

    for (let v = 0; v < line.length - 1; v += 1) {
      const a = line[v];
      const b = next[v];
      const c = line[v + 1];
      const d = next[v + 1];

      if (a && b && c && d) {
        writer.triangle(a, b, c, outward, fractureFace);
        writer.triangle(b, d, c, outward, fractureFace);
      }
    }
  }
};

/** Points from `from` to `to` in `count` equal steps, both ends included. */
const lerpLine = (from: Vector3, to: Vector3, count: number) =>
  Array.from({ length: count + 1 }, (_, index) =>
    from.clone().lerp(to, index / count)
  );

/** A cap (a cell's bottom or top) on `plane`, from the outer edge in to the axis or the inner surface. */
const cap = (
  writer: Writer,
  solid: Solid,
  cell: Cell,
  plane: Plane,
  facesUp: boolean,
  random: Random
) => {
  const outward = new Vector3(-plane.slopeX, 1, -plane.slopeZ).multiplyScalar(
    facesUp ? 1 : -1
  );

  const grid: Vector3[][] = [];

  for (let step = cell.from; step <= cell.to; step += 1) {
    const angle = angleOf(solid, step);
    const edge = meet(plane, solid.outer, angle);
    const outerPoint = around(angle, edge.radius, edge.y);

    const innerPoint = solid.inner
      ? (() => {
          const inside = meet(plane, solid.inner, angle);

          return around(angle, inside.radius, inside.y);
        })()
      : new Vector3(0, heightOn(plane, 0, 0), 0);

    grid.push(lerpLine(innerPoint, outerPoint, solid.rings));
  }

  const whole = cell.to - cell.from === solid.steps;

  // A whole drum's cap is closed round the axis: its first and last lines
  // are the same line, and the axis point is shared by every line.
  if (whole && !solid.inner) {
    const centre = grid[0]?.[0]?.clone() ?? new Vector3();
    centre.y += (random() * 2 - 1) * solid.roughness;

    for (const line of grid) {
      line[0] = centre;
    }

    const [first] = grid;

    if (first) {
      grid[grid.length - 1] = first;
    }
  }

  jaggedFace(
    writer,
    grid,
    outward,
    solid.roughness,
    random,
    (_u, v) => v === 0
  );
};

/** A vertical cut face at grid step `step`, between the outer surface and the axis or the inner surface. */
const cutFace = (
  writer: Writer,
  solid: Solid,
  cell: Cell,
  step: number,
  facing: number,
  random: Random
) => {
  const angle = angleOf(solid, step);

  const outward = new Vector3(
    -Math.sin(angle),
    0,
    Math.cos(angle)
  ).multiplyScalar(facing);

  const bottom = meet(cell.lower, solid.outer, angle);
  const top = meet(cell.upper, solid.outer, angle);
  const lines: Vector3[][] = [];

  for (let row = 0; row <= solid.rows; row += 1) {
    const share = row / solid.rows;
    const y = bottom.y + (top.y - bottom.y) * share;

    const radius = rowRadius(
      row,
      solid.rows,
      { bottom: bottom.radius, top: top.radius },
      () => solid.outer(y)
    );

    const outerPoint = around(angle, radius, y);

    let innerPoint: Vector3;

    if (solid.inner) {
      const low = meet(cell.lower, solid.inner, angle);
      const high = meet(cell.upper, solid.inner, angle);
      const innerY = low.y + (high.y - low.y) * share;

      const { inner } = solid;

      const innerRadius = rowRadius(
        row,
        solid.rows,
        { bottom: low.radius, top: high.radius },
        () => inner(innerY)
      );

      innerPoint = around(angle, innerRadius, innerY);
    } else {
      const low = heightOn(cell.lower, 0, 0);
      const high = heightOn(cell.upper, 0, 0);
      innerPoint = new Vector3(0, low + (high - low) * share, 0);
    }

    lines.push(lerpLine(innerPoint, outerPoint, solid.rings));
  }

  jaggedFace(writer, lines, outward, solid.roughness * 0.7, random);
};

/** A box's six faces, as fracture-free stone. */
const box = (writer: Writer, block: Block) => {
  const { max, min } = block;

  const corner = (x: number, y: number, z: number) =>
    new Vector3(x ? max.x : min.x, y ? max.y : min.y, z ? max.z : min.z);

  const faces: [Vector3, [number, number, number][]][] = [
    [
      new Vector3(1, 0, 0),
      [
        [1, 0, 0],
        [1, 1, 0],
        [1, 0, 1],
        [1, 1, 1],
      ],
    ],
    [
      new Vector3(-1, 0, 0),
      [
        [0, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
        [0, 1, 1],
      ],
    ],
    [
      new Vector3(0, 1, 0),
      [
        [0, 1, 0],
        [1, 1, 0],
        [0, 1, 1],
        [1, 1, 1],
      ],
    ],
    [
      new Vector3(0, -1, 0),
      [
        [0, 0, 0],
        [1, 0, 0],
        [0, 0, 1],
        [1, 0, 1],
      ],
    ],
    [
      new Vector3(0, 0, 1),
      [
        [0, 0, 1],
        [1, 0, 1],
        [0, 1, 1],
        [1, 1, 1],
      ],
    ],
    [
      new Vector3(0, 0, -1),
      [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
        [1, 1, 0],
      ],
    ],
  ];

  for (const [outward, corners] of faces) {
    const [a, b, c, d] = corners.map(([x, y, z]) => corner(x, y, z));

    if (a && b && c && d) {
      const normals = [outward, outward, outward] as const;
      writer.triangle(a, b, c, outward, stoneSurface, noSeams, normals);
      writer.triangle(b, d, c, outward, stoneSurface, noSeams, normals);
    }
  }
};

/** The centroid and resting height of a cell (and any block welded to it). */
const fragmentOf = (solid: Solid, cell: Cell, blocks: readonly Block[]) => {
  const points: Vector3[] = [];
  const middle = (cell.from + cell.to) / 2;

  for (const step of [cell.from, middle, cell.to]) {
    const angle = angleOf(solid, step);

    for (const plane of [cell.lower, cell.upper]) {
      const edge = meet(plane, solid.outer, angle);
      points.push(around(angle, edge.radius, edge.y));

      if (solid.inner) {
        const inside = meet(plane, solid.inner, angle);
        points.push(around(angle, inside.radius, inside.y));
      } else {
        points.push(new Vector3(0, heightOn(plane, 0, 0), 0));
      }
    }
  }

  for (const block of blocks) {
    points.push(block.min.clone(), block.max.clone());
  }

  const pivot = new Vector3();

  for (const point of points) {
    pivot.add(point);
  }

  pivot.divideScalar(points.length);

  // Lying down, it settles with its centroid about a third of its smallest
  // extent off the floor: a little sunk, as rubble lies.
  const low = new Vector3(Infinity, Infinity, Infinity);
  const high = new Vector3(-Infinity, -Infinity, -Infinity);

  for (const point of points) {
    low.min(point);
    high.max(point);
  }

  const size = high.sub(low);
  const restHeight = Math.max(Math.min(size.x, size.y, size.z) * 0.36, 0.04);

  return { pivot, restHeight };
};

/** Emits every cell of `solid` (and its welded blocks) into `writer`. */
const emit = (
  writer: Writer,
  solid: Solid,
  cells: readonly Cell[],
  welded: ReadonlyMap<number, readonly Block[]>,
  seed: number
) => {
  for (const [index, cell] of cells.entries()) {
    // Each cell jitters from its own seed: the same in both passes.
    const random = createRandom(seed * 977 + index * 131 + 7);
    const blocks = welded.get(index) ?? [];
    const { pivot, restHeight } = fragmentOf(solid, cell, blocks);
    writer.fragment = { fling: cell.fling, pivot, restHeight };

    surfacePatch(writer, solid, cell, solid.outer, false);

    if (solid.inner) {
      surfacePatch(writer, solid, cell, solid.inner, true);
    }

    cap(writer, solid, cell, cell.lower, false, random);
    cap(writer, solid, cell, cell.upper, true, random);

    if (cell.to - cell.from !== solid.steps) {
      cutFace(writer, solid, cell, cell.from, -1, random);
      cutFace(writer, solid, cell, cell.to, 1, random);
    }

    for (const block of blocks) {
      box(writer, block);
    }
  }
};

/**
 * The fractured solid as one geometry: every cell, with `welded` blocks
 * moving with the cell of the same index. `reach` is how far from the axis
 * its fragments can fly and settle, for the bounding sphere.
 */
export const fractureSolid = (
  solid: Solid,
  cells: readonly Cell[],
  welded: ReadonlyMap<number, readonly Block[]>,
  seed: number,
  reach: number
): BufferGeometry => {
  const count = counter();
  emit(count.writer, solid, cells, welded, seed);

  const fill = filler(count.triangles());
  emit(fill.writer, solid, cells, welded, seed);

  const geometry = fill.finish();
  geometry.boundingSphere = new Sphere(new Vector3(0, 1, 0), reach);

  return geometry;
};

/** A profile through `points` ([radius, height], heights rising), straight between them. */
export const profileThrough =
  (points: readonly (readonly [number, number])[]): Profile =>
  (y) => {
    const [first] = points;
    const last = points.at(-1);

    if (!first || !last) {
      return 0;
    }

    if (y <= first[1]) {
      return first[0];
    }

    for (let index = 1; index < points.length; index += 1) {
      const low = points[index - 1];
      const high = points[index];

      if (low && high && y <= high[1]) {
        const share = (y - low[1]) / Math.max(high[1] - low[1], 1e-6);

        return low[0] + (high[0] - low[0]) * share;
      }
    }

    return last[0];
  };
