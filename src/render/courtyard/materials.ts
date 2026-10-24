/**
 * Stylised procedural stone for the courtyard, all in TSL and laid out in
 * world (or column-local) metres so blocks keep their size on any mesh:
 * irregular flagstones with mortar and wet patches, ashlar walls, fluted
 * columns and slate roofs. Every PBR slot reads the same stone identity (the
 * block it falls in), so colour, roughness and relief agree.
 */
import {
  atan,
  color,
  float,
  fwidth,
  max,
  min,
  mix,
  mx_fractal_noise_float,
  mx_noise_float,
  normalView,
  positionLocal,
  positionViewDirection,
  positionWorld,
  reflectVector,
  smoothstep,
  vec2,
  vec3,
} from "three/tsl";
import { MeshStandardNodeMaterial } from "three/webgpu";
import type { Node } from "three/webgpu";

import type { Tuning } from "../../tuning";
import { skyRadiance } from "./sky";
import { bumpNormal, cellHash, unit } from "./surface";

/**
 * A running-bond block pattern over a 2D surface coordinate in metres.
 * Returns the block's identity, how far inside the block the point is (metres
 * to the nearest joint) and a stone mask that is 0 in the joints and 1 on the
 * stone, antialiased over the pixel footprint so distant joints fade instead of
 * shimmering. A `splitChance` share of blocks is cut in two, so the pattern
 * mixes long and short stones instead of reading as tiles.
 */
const blocks = (
  surface: Node<"vec2">,
  blockSize: Node<"vec2">,
  jointWidth: number,
  rowJitter: number,
  splitChance = 0
) => {
  const grid = surface.div(blockSize);
  const row = grid.y.floor();

  // Each row slides by its own amount so the joints never line up.
  const slide = cellHash(vec3(row, 3.7, 1.3))
    .mul(rowJitter)
    .add(row.mul(0.5));

  const shifted = vec2(grid.x.add(slide), grid.y);
  const cell = shifted.floor();
  const local = shifted.fract();
  const split = cellHash(vec3(cell, 8.2)).lessThan(splitChance);

  const half = split.select(
    local.x.greaterThan(0.5).select(float(1), float(0)),
    float(0)
  );

  const splitJoint = split.select(local.x.sub(0.5).abs(), float(1));

  const inside = min(
    min(min(local.x, local.x.oneMinus()), splitJoint).mul(blockSize.x),
    min(local.y, local.y.oneMinus()).mul(blockSize.y)
  );

  const footprint = fwidth(inside).add(0.002);
  const stone = smoothstep(jointWidth, footprint.add(jointWidth), inside);

  return { id: cellHash(vec3(cell, half)), inside, stone };
};

/** Schlick's Fresnel for water (F0 = 0.02) against the current normal. */
export const fresnel = (): Node<"float"> => {
  const facing = unit(positionViewDirection.dot(normalView));

  return float(0.02).add(float(0.98).mul(facing.oneMinus().pow(5)));
};

/**
 * Flagstones: long and short grey slabs, dark mortar, grime toward the joints
 * and a few shallow puddles that mirror the night sky and the moon.
 */
export const createFlagstoneMaterial = (
  settings: Tuning["courtyard"]
): MeshStandardNodeMaterial => {
  const ground = positionWorld.xz;
  const slab = blocks(ground, vec2(1.3, 0.8), 0.022, 0.9, 0.4);
  const grain = mx_fractal_noise_float(vec3(ground.mul(2.6), 0.5), 4);
  const stain = mx_fractal_noise_float(vec3(ground.mul(0.35), 2.7), 3);

  // Low, broad noise picks out a few shallow puddles.
  const wet = smoothstep(
    0.18,
    0.46,
    mx_noise_float(ground.mul(0.13).add(vec2(11.3, 4.1)))
  );

  const hue = cellHash(vec3(slab.id, 2, 7));
  const slate = mix(color("#46484f"), color("#5b544b"), hue);
  // Grime gathers toward each slab's edges.
  const grime = smoothstep(0, 0.18, slab.inside).mul(0.35).add(0.65);

  const stoneColor = slate
    .mul(slab.id.mul(0.55).add(0.6))
    .mul(grain.mul(0.2).add(1))
    .mul(stain.mul(0.3).add(1))
    .mul(grime);

  const dry = mix(color("#161516"), stoneColor, slab.stone);
  const material = new MeshStandardNodeMaterial();

  material.colorNode = mix(dry, dry.mul(0.4), wet);
  material.roughnessNode = mix(
    mix(float(0.96), grain.mul(0.08).add(0.84), slab.stone),
    float(0.14),
    wet.mul(wet)
  );
  // Slabs sit proud of the mortar with softened edges, each tilted by its own
  // amount.
  const bevel = smoothstep(0, 0.07, slab.inside);
  const relief = bevel.mul(slab.id.mul(0.35).add(0.65)).add(grain.mul(0.12));

  // Blend the normal (not the height) toward flat, so a puddle's edge doesn't
  // become a ridge that catches the light.
  material.normalNode = mix(bumpNormal(relief, 0.012), normalView, wet);
  // Puddles mirror the sky along the reflected view ray, weighted by Fresnel.
  material.emissiveNode = skyRadiance(reflectVector, settings, false)
    .mul(fresnel())
    .mul(wet);

  return material;
};

/** A stone's PBR slots, for a material of its own or one that builds on it. */
export interface StoneSlots {
  readonly color: Node<"vec3">;
  readonly roughness: Node<"float">;
  readonly normal: Node<"vec3">;
}

const stoneMaterial = (slots: StoneSlots): MeshStandardNodeMaterial => {
  const material = new MeshStandardNodeMaterial();

  material.colorNode = slots.color;
  material.roughnessNode = slots.roughness;
  material.normalNode = slots.normal;

  return material;
};

/**
 * Ashlar stone: squared blocks in running bond, for walls on either axis,
 * read at `world`: the world position, or for stone that breaks and flies
 * apart (see `render/ruins`) where it stood.
 */
export const ashlarStone = (
  tint = "#5f5b57",
  blockSize: readonly [number, number] = [0.95, 0.45],
  world: Node<"vec3"> = positionWorld
): StoneSlots => {
  // x + z runs along any axis-aligned wall face, y climbs it.
  const face = vec2(world.x.add(world.z), world.y);
  const block = blocks(face, vec2(blockSize[0], blockSize[1]), 0.018, 0.4);
  const grain = mx_fractal_noise_float(world.mul(1.9), 4);
  // Damp streaks running down from the top of the wall.
  const streak = mx_noise_float(vec2(face.x.mul(1.4), face.y.mul(0.12)));

  const base = color(tint)
    .mul(block.id.mul(0.35).add(0.78))
    .mul(grain.mul(0.2).add(1))
    .mul(streak.mul(0.14).add(0.95));

  return {
    color: mix(color("#1f1d1c"), base, block.stone),
    normal: bumpNormal(
      smoothstep(0, 0.05, block.inside).add(grain.mul(0.2)),
      0.014
    ),
    roughness: mix(float(0.97), grain.mul(0.06).add(0.86), block.stone),
  };
};

/** Ashlar: squared blocks in running bond, for walls on either axis. */
export const createAshlarMaterial = (
  tint = "#5f5b57",
  blockSize: readonly [number, number] = [0.95, 0.45]
): MeshStandardNodeMaterial => stoneMaterial(ashlarStone(tint, blockSize));

/**
 * Column stone: pale limestone drums with vertical fluting, read in the
 * column's own space so every column flutes the same way. `local` and
 * `world` are where the pattern is read (for stone that breaks and flies
 * apart, where it stood); `fluted` 0 leaves a face unfluted (the abacus).
 */
export const columnStone = ({
  fluted = float(1),
  local = positionLocal,
  world = positionWorld,
}: {
  readonly fluted?: Node<"float">;
  readonly local?: Node<"vec3">;
  readonly world?: Node<"vec3">;
} = {}): StoneSlots => {
  const angle = atan(local.z, local.x);
  const height = local.y;
  const fluteCount = 20;
  const flute = angle.mul(fluteCount).cos().mul(0.5).add(0.5).mul(fluted);
  // Drum joints every 0.8 m up the shaft.
  const drum = height.div(0.8).fract();
  const joint = min(drum, drum.oneMinus()).mul(0.8);
  const jointMask = smoothstep(0.006, fwidth(joint).add(0.012), joint);
  const drumId = cellHash(vec3(height.div(0.8).floor(), 9.1, 2.3));
  const grain = mx_fractal_noise_float(world.mul(2.3), 4);

  const base = color("#7b766c")
    .mul(drumId.mul(0.18).add(0.85))
    .mul(grain.mul(0.18).add(1));

  return {
    color: mix(color("#2c2a27"), base, jointMask).mul(
      flute.mul(0.22).add(0.78)
    ),
    normal: bumpNormal(
      flute.mul(0.6).add(jointMask).add(grain.mul(0.15)),
      0.025
    ),
    roughness: grain.mul(0.06).add(0.8),
  };
};

/** Column stone, as a material of its own. */
export const createColumnMaterial = (): MeshStandardNodeMaterial =>
  stoneMaterial(columnStone());

/** Slate roof tiles: dark, slightly glossy overlapping rows. */
export const createSlateMaterial = (): MeshStandardNodeMaterial => {
  const angle = atan(positionLocal.z, positionLocal.x);
  const tiles = vec2(angle.mul(7), positionLocal.y.mul(3.2));
  const row = tiles.y.fract();
  const id = cellHash(vec3(tiles.floor(), 5));
  const material = new MeshStandardNodeMaterial();

  material.colorNode = color("#262b36").mul(id.mul(0.4).add(0.75));
  material.roughnessNode = id.mul(0.2).add(0.5);
  material.normalNode = bumpNormal(row, 0.04);

  return material;
};

/** Blackened wrought iron for brazier bowls. */
export const iron = new MeshStandardNodeMaterial({
  color: "#1c1a19",
  metalness: 0.75,
  roughness: 0.55,
});

/**
 * Warm candle-lit windows: an arched pane with a lead cross, glowing in
 * scene-linear HDR so bloom softens it. Draw it on a plane facing the courtyard.
 */
export const createWindowMaterial = (
  radiance: number
): MeshStandardNodeMaterial => {
  const material = new MeshStandardNodeMaterial({ color: "#000000" });
  // The plane spans -0.5..0.5; the arch's round top starts 70% of the way up.
  const { x } = positionLocal;
  const y = positionLocal.y.add(0.5);

  const arch = max(
    smoothstep(0.02, 0, x.abs().sub(0.5)).mul(smoothstep(0.72, 0.7, y)),
    smoothstep(0.52, 0.5, vec2(x, y.sub(0.7).mul(1.6)).length())
  );

  const lead = min(
    smoothstep(0.015, 0.035, x.abs()),
    smoothstep(0.015, 0.035, y.sub(0.45).abs())
  );

  // Brighter low in the pane, where the candle sits.
  const glow = unit(y.oneMinus().mul(0.8).add(0.35));

  material.emissiveNode = color("#ffae5c").mul(glow).mul(lead).mul(radiance);
  material.opacityNode = arch;
  material.alphaTest = 0.5;

  return material;
};
