/**
 * The central fountain: a low round basin of still, rippling water with a
 * small tiered spout spilling a thin veil into it.
 *
 * It is deliberately low (Spells fly over it at chest height) and is not in
 * the Arena's collision layout, so it is scenery, not Cover. Making it Cover
 * would be one more circle in `courtyard.cover` at the centre, sized to
 * `fountainRadius`.
 */
import {
  color,
  fract,
  mix,
  mx_noise_float,
  positionLocal,
  positionWorld,
  reflectVector,
  smoothstep,
  time,
  vec3,
} from "three/tsl";
import {
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardNodeMaterial,
  Vector2,
} from "three/webgpu";

import type { Tuning } from "../../tuning";
import { fresnel } from "./materials";
import { skyRadiance } from "./sky";
import { bumpNormal } from "./surface";

/** Outer radius of the basin's rim, metres. */
export const fountainRadius = 1.65;

const waterLevel = 0.32;
const innerRadius = 1.38;
const bowlRadius = 0.56;

/** Kept low so the spout hides as little of a Duelist behind the fountain as possible. */
const bowlHeight = 0.7;

const lathe = (points: readonly (readonly [number, number])[]) =>
  new LatheGeometry(
    points.map(([x, y]) => new Vector2(x, y)),
    48
  );

/**
 * Water: a dark, glossy surface whose ripples spread from where the veil
 * lands, reflecting the night sky and the moon (a cheap sky lookup along the
 * reflected view ray, weighted by Fresnel) on top of the lit specular.
 */
const createWaterMaterial = (
  settings: Tuning["courtyard"]
): MeshStandardNodeMaterial => {
  const radial = positionWorld.xz.length();
  const rings = fract(radial.mul(2.2).sub(time.mul(0.45)));

  const ripple = rings
    .mul(Math.PI * 2)
    .sin()
    .mul(smoothstep(innerRadius, bowlRadius, radial));

  const chop = mx_noise_float(vec3(positionWorld.xz.mul(3.5), time.mul(0.6)));

  const material = new MeshStandardNodeMaterial({
    color: "#06121a",
    metalness: 0,
    roughness: 0.05,
  });

  material.normalNode = bumpNormal(ripple.add(chop.mul(0.6)), 0.006);
  material.emissiveNode = skyRadiance(reflectVector, settings, false).mul(
    fresnel()
  );

  return material;
};

/** The veil of water spilling from the upper bowl, streaked and falling. */
const createVeilMaterial = (): MeshStandardNodeMaterial => {
  const angle = positionLocal.x.atan(positionLocal.z);

  const streaks = mx_noise_float(
    vec3(angle.mul(14), positionLocal.y.mul(3).add(time.mul(2.4)), 0)
  );

  const material = new MeshStandardNodeMaterial({
    color: "#9fb4c8",
    depthWrite: false,
    roughness: 0.15,
    side: DoubleSide,
    transparent: true,
  });

  material.opacityNode = smoothstep(-0.1, 0.6, streaks).mul(0.35);
  material.emissiveNode = mix(
    color("#000000"),
    color("#3a4b66"),
    streaks.mul(0.5).add(0.5)
  ).mul(0.08);

  return material;
};

export const createFountain = (
  stone: MeshStandardNodeMaterial,
  settings: Tuning["courtyard"]
): Group => {
  const group = new Group();

  // Basin: plinth, outer wall, rounded rim, inner wall, floor.
  const basin = new Mesh(
    lathe([
      [0, 0.02],
      [fountainRadius + 0.08, 0.02],
      [fountainRadius + 0.08, 0.1],
      [fountainRadius, 0.12],
      [fountainRadius - 0.03, 0.4],
      [fountainRadius + 0.02, 0.44],
      [fountainRadius - 0.02, 0.5],
      [innerRadius + 0.02, 0.5],
      [innerRadius - 0.02, 0.46],
      [innerRadius, 0.14],
      [0, 0.14],
    ]),
    stone
  );

  // Spout: a slender baluster carrying a shallow bowl and a finial.
  const spout = new Mesh(
    lathe([
      [0.34, 0.14],
      [0.3, 0.2],
      [0.2, 0.27],
      [0.14, 0.42],
      [0.12, 0.54],
      [0.2, bowlHeight - 0.1],
      [bowlRadius - 0.06, bowlHeight - 0.04],
      [bowlRadius, bowlHeight],
      [bowlRadius - 0.04, bowlHeight + 0.03],
      [0.1, bowlHeight - 0.02],
      [0.07, bowlHeight + 0.08],
      [0.1, bowlHeight + 0.13],
      [0.04, bowlHeight + 0.24],
      [0, bowlHeight + 0.27],
    ]),
    stone
  );

  const water = new Mesh(
    new CircleGeometry(innerRadius, 48),
    createWaterMaterial(settings)
  );

  const veil = new Mesh(
    new CylinderGeometry(
      bowlRadius,
      bowlRadius + 0.06,
      bowlHeight - waterLevel,
      40,
      1,
      true
    ),
    createVeilMaterial()
  );

  water.rotation.x = -Math.PI / 2;
  water.position.y = waterLevel;
  water.receiveShadow = true;
  veil.position.y = (bowlHeight + waterLevel) / 2;

  for (const mesh of [basin, spout]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }

  group.add(basin, spout, water, veil);

  return group;
};
