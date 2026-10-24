/**
 * The central fountain: a low round basin of still, rippling water with a
 * small tiered spout spilling a thin veil into it.
 *
 * It is deliberately low (Spells fly over it at chest height), so the Arena
 * layout makes it an Obstruction, not Cover: Duelists cannot walk through it
 * and Spells are not stopped. Its radius comes from the layout.
 *
 * Its stone breaks under Spells: the basin's rim and the spout are drawn by
 * the ruins (`render/ruins`), pre-fractured. Here is what never breaks: the
 * plinth and the basin's floor, the water, and the veil (which the ruins
 * hide once the spout is gone).
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

import { fountainRadius } from "../../arena/courtyard";
import type { Tuning } from "../../tuning";
import { fresnel } from "./materials";
import { skyRadiance } from "./sky";
import { bumpNormal } from "./surface";

const waterLevel = 0.32;

/** The basin's inner wall, metres from the centre: the rim runs from here out to `fountainRadius`. */
export const fountainInnerRadius = 1.38;
const innerRadius = fountainInnerRadius;
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

/** The fountain's unbreakable parts, and its veil (to hide once the spout breaks). */
export interface FountainBasin {
  readonly object: Group;
  readonly veil: Mesh;
}

export const createFountain = (
  stone: MeshStandardNodeMaterial,
  settings: Tuning["courtyard"]
): FountainBasin => {
  const group = new Group();

  // The plinth and the basin's floor; the rim stands on them.
  const basin = new Mesh(
    lathe([
      [0, 0.02],
      [fountainRadius + 0.08, 0.02],
      [fountainRadius + 0.08, 0.1],
      [fountainRadius, 0.12],
      [innerRadius, 0.12],
      [innerRadius, 0.14],
      [0, 0.14],
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
  basin.castShadow = true;
  basin.receiveShadow = true;

  group.add(basin, water, veil);

  return { object: group, veil };
};
