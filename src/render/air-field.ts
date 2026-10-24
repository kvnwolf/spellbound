/**
 * The air field: the noise and curl noise that shape Depulso's cloud and
 * the air it bends. One field, two consumers:
 *
 * - A small tiling texture, baked once on the CPU at load: two octave sets
 *   of periodic gradient noise (a broad billow and a fine wisp) and the curl
 *   of a third, smoother one, a divergence-free swirl. Puffs read it in the
 *   fragment shader, where the cloud's overdraw makes evaluating noise
 *   directly the expensive choice; a few texture reads per pixel are cheap,
 *   and its mips filter it for distant puffs.
 * - `curlNoise`, the curl of a 3D noise potential evaluated in TSL, which
 *   the vertex shader uses to set puffs wandering on swirls (four noise
 *   samples per vertex, four vertices per puff).
 *
 * Channels (all in 0..1, `NoColorSpace`): r = billow density, g and b = the
 * swirl's x and y (0.5 is still), a = wisp density.
 */
import { mx_noise_vec3, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";
import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  UnsignedByteType,
} from "three/webgpu";

import { seededRandom } from "./spark-ring";

/** Unit gradients on a `period` x `period` lattice that wraps. */
const latticeOf = (period: number, random: () => number) => {
  const gradients = new Float32Array(period * period * 2);

  for (let cell = 0; cell < period * period; cell += 1) {
    const angle = random() * Math.PI * 2;
    gradients[cell * 2] = Math.cos(angle);
    gradients[cell * 2 + 1] = Math.sin(angle);
  }

  return { gradients, period };
};

type Lattice = ReturnType<typeof latticeOf>;

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Gradient noise at (x, y) in lattice cells, wrapping every `period` cells. */
const gradientNoise = (
  { gradients, period }: Lattice,
  x: number,
  y: number
) => {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;

  const corner = (dx: number, dy: number) => {
    const cx = (((x0 + dx) % period) + period) % period;
    const cy = (((y0 + dy) % period) + period) % period;
    const cell = (cy * period + cx) * 2;

    return (
      (gradients[cell] ?? 0) * (fx - dx) +
      (gradients[cell + 1] ?? 0) * (fy - dy)
    );
  };

  const u = fade(fx);
  const v = fade(fy);
  const bottom = corner(0, 0) + (corner(1, 0) - corner(0, 0)) * u;
  const top = corner(0, 1) + (corner(1, 1) - corner(0, 1)) * u;

  return bottom + (top - bottom) * v;
};

/** Octaves of periodic noise over the unit square: each period doubles, each amplitude halves. */
const octaves = (base: number, count: number, random: () => number) => {
  const layers = Array.from({ length: count }, (_, octave) =>
    latticeOf(base * 2 ** octave, random)
  );

  return (u: number, v: number) =>
    layers.reduce(
      (sum, layer, octave) =>
        sum +
        gradientNoise(layer, u * layer.period, v * layer.period) / 2 ** octave,
      0
    );
};

/** Rescales `values` in place to 0..1. */
const normalise = (values: Float32Array) => {
  let low = Infinity;
  let high = -Infinity;

  for (const value of values) {
    low = Math.min(low, value);
    high = Math.max(high, value);
  }

  const span = high - low || 1;

  for (let index = 0; index < values.length; index += 1) {
    values[index] = ((values[index] ?? 0) - low) / span;
  }
};

/** A 0..1 value as a byte. */
const byte = (value: number) =>
  Math.round(Math.min(Math.max(value, 0), 1) * 255);

/** Bakes the air field: `size` texels square, tiling, the same every run. */
export const createAirField = (size: number): DataTexture => {
  const random = seededRandom(41);
  const billow = octaves(3, 4, random);
  const wisp = octaves(8, 3, random);
  const swirl = octaves(2, 3, random);
  const texels = size * size;
  const billows = new Float32Array(texels);
  const wisps = new Float32Array(texels);
  const potential = new Float32Array(texels);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const texel = y * size + x;
      billows[texel] = billow(x / size, y / size);
      wisps[texel] = wisp(x / size, y / size);
      potential[texel] = swirl(x / size, y / size);
    }
  }

  normalise(billows);
  normalise(wisps);

  // The swirl is the curl of the potential, (dψ/dy, -dψ/dx): it never
  // converges or spreads, it only turns, as air does.
  const at = (x: number, y: number) =>
    potential[((y + size) % size) * size + ((x + size) % size)] ?? 0;

  const curl = new Float32Array(texels * 2);
  let strongest = 1e-6;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const texel = y * size + x;
      const along = (at(x, y + 1) - at(x, y - 1)) / 2;
      const across = -(at(x + 1, y) - at(x - 1, y)) / 2;
      curl[texel * 2] = along;
      curl[texel * 2 + 1] = across;
      strongest = Math.max(strongest, Math.abs(along), Math.abs(across));
    }
  }

  const data = new Uint8Array(texels * 4);

  for (let texel = 0; texel < texels; texel += 1) {
    data[texel * 4] = byte(billows[texel] ?? 0);
    data[texel * 4 + 1] = byte(
      0.5 + (0.5 * (curl[texel * 2] ?? 0)) / strongest
    );
    data[texel * 4 + 2] = byte(
      0.5 + (0.5 * (curl[texel * 2 + 1] ?? 0)) / strongest
    );
    data[texel * 4 + 3] = byte(wisps[texel] ?? 0);
  }

  const texture = new DataTexture(
    data,
    size,
    size,
    RGBAFormat,
    UnsignedByteType
  );

  texture.colorSpace = NoColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;

  return texture;
};

/**
 * Curl noise: the curl of a 3D noise potential at `at`, by forward
 * differences `step` apart. Divergence-free, so what it moves swirls
 * without bunching up or thinning out. Roughly unit scale.
 */
export const curlNoise = (at: Node<"vec3">, step = 0.15): Node<"vec3"> => {
  const here = mx_noise_vec3(at);
  const dx = mx_noise_vec3(at.add(vec3(step, 0, 0))).sub(here);
  const dy = mx_noise_vec3(at.add(vec3(0, step, 0))).sub(here);
  const dz = mx_noise_vec3(at.add(vec3(0, 0, step))).sub(here);

  return vec3(dy.z.sub(dz.y), dz.x.sub(dx.z), dx.y.sub(dy.x)).div(step);
};
