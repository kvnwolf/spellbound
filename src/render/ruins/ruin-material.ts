/**
 * The material a breakable piece is drawn with: the courtyard's own stone,
 * read where each point stood (so fluting and blocks stay on a flying
 * fragment), plus the two things that make it a ruin.
 *
 * - Cracks open as it weakens: along the cuts it will break on (the
 *   geometry tells each point how far it is from one), in patches that
 *   spread with the damage, and as hairline veins across the stone; dark,
 *   rough and sunk into the relief.
 * - Once broken, every fragment moves on its own, a pure function of the
 *   time since the break (`ruinRest`, `ruinFling`, `ruinSpin`, see
 *   `fracture.ts`): thrown out by its launch plus the blow's push, it
 *   spins and falls under gravity until it reaches its resting height,
 *   then slides a little and stops dead. Nothing is simulated per frame;
 *   the same position node moves the shadow.
 *
 * The fracture faces, hidden while the piece stands, are fresh broken
 * stone: paler and rougher.
 */
import {
  Fn,
  attribute,
  color,
  cos,
  exp,
  float,
  max,
  min,
  mix,
  modelWorldMatrix,
  mx_noise_float,
  normalGeometry,
  normalLocal,
  positionGeometry,
  sin,
  smoothstep,
  sqrt,
  step,
  uniform,
  vec3,
  vec4,
} from "three/tsl";
import type { Node } from "three/webgpu";
import { MeshStandardNodeMaterial, Vector2 } from "three/webgpu";

import type { Tuning } from "../../tuning";
import type { StoneSlots } from "../courtyard/materials";
import { bumpNormal } from "../courtyard/surface";

type RuinLook = Tuning["structureLook"];

/** What the material reads of its piece, set by the ruins view every frame. */
export interface RuinState {
  /** Seconds since the piece broke; 0 while it stands (and nothing moves). */
  readonly age: { value: number };
  /** The blow that broke it: a unit vector on the floor (x, z). */
  readonly heading: { value: Vector2 };
  /** How worn it is: 0 whole, 1 broken. */
  readonly damage: { value: number };
}

/** Rodrigues' rotation of `vector` about the unit `axis` by `angle`. */
const rotate = (
  vector: Node<"vec3">,
  axis: Node<"vec3">,
  angle: Node<"float">
): Node<"vec3"> => {
  const c = cos(angle);
  const s = sin(angle);

  return vector
    .mul(c)
    .add(axis.cross(vector).mul(s))
    .add(axis.mul(axis.dot(vector)).mul(float(1).sub(c)));
};

/** Where each point of the piece stood, in its own space and in the world. */
export const standing = () => ({
  local: positionGeometry,
  world: modelWorldMatrix.mul(vec4(positionGeometry, 1)).xyz,
});

/** A ruin's material and the state the ruins view drives it with. */
export interface RuinMaterial {
  readonly material: MeshStandardNodeMaterial;
  readonly state: RuinState;
}

/**
 * The material of a piece of `stone` (its pattern read with `standing()`)
 * as a ruin: cracks, fracture faces and the fragments' flight.
 */
export const createRuinMaterial = (
  stone: StoneSlots,
  look: RuinLook
): RuinMaterial => {
  const base = new MeshStandardNodeMaterial();
  const age = uniform(0);
  const heading = uniform(new Vector2(1, 0));
  const damage = uniform(0);

  const pivot = attribute<"vec3">("ruinPivot", "vec3");
  const fling = attribute<"vec4">("ruinFling", "vec4");
  const spin = attribute<"vec4">("ruinSpin", "vec4");
  const rest = attribute<"vec4">("ruinRest", "vec4");

  const { motion } = look;

  base.positionNode = Fn(() => {
    // An anchored fragment's delay is huge: it never starts.
    const time = max(age.sub(rest.y), 0);

    const velocity = fling.xyz.add(
      vec3(heading.x, 0, heading.y).mul(motion.push).mul(fling.w)
    );

    // Flying until its centroid falls to its resting height...
    const drop = max(pivot.y.sub(rest.x), 0);

    const landing = velocity.y
      .add(sqrt(velocity.y.mul(velocity.y).add(drop.mul(2 * motion.gravity))))
      .div(motion.gravity);

    const flying = min(time, landing);
    // ...then sliding to a stop.
    const after = max(time.sub(landing), 0);

    const slide = float(1)
      .sub(exp(after.div(motion.slideSeconds).negate()))
      .mul(motion.slideSeconds);

    const travel = flying.add(slide.mul(motion.slideShare));

    const centre = vec3(
      pivot.x.add(velocity.x.mul(travel)),
      pivot.y
        .add(velocity.y.mul(flying))
        .sub(flying.mul(flying).mul(0.5 * motion.gravity)),
      pivot.z.add(velocity.z.mul(travel))
    );

    const angle = spin.w.mul(flying.add(slide.mul(motion.rollShare)));

    normalLocal.assign(rotate(normalGeometry, spin.xyz, angle));

    return rotate(positionGeometry.sub(pivot), spin.xyz, angle).add(centre);
  })();

  // Fracture faces: fresh broken stone, paler and rougher.
  const { cracks, fracture } = look;
  const where = standing().world;
  const broken = step(0.5, rest.z);
  const grit = mx_noise_float(where.mul(fracture.gritScale));

  const fresh = mix(
    color(fracture.dark),
    color(fracture.light),
    grit.mul(0.5).add(0.5)
  );

  // Cracks: along the cuts, in patches that spread as it weakens...
  const open = smoothstep(cracks.from, 1, damage);
  const patch = mx_noise_float(where.mul(cracks.patchScale)).mul(0.5).add(0.5);
  const revealed = smoothstep(patch, patch.add(0.15), open);

  const wobble = mx_noise_float(where.mul(cracks.wobbleScale)).mul(
    cracks.wobble
  );

  const width = mix(float(cracks.width.min), float(cracks.width.max), open);
  const seam = rest.w.add(wobble).abs();
  const alongCuts = smoothstep(width, width.mul(0.25), seam).mul(revealed);

  // ...and hairline veins across the stone.
  const vein = mx_noise_float(where.mul(cracks.veinScale)).abs();
  const veinWidth = open.mul(cracks.veinWidth);

  const veins = smoothstep(veinWidth, veinWidth.mul(0.2), vein).mul(
    smoothstep(0.25, 0.7, revealed)
  );

  const crack = max(alongCuts, veins).mul(broken.oneMinus());
  const surface = mix(stone.color, fresh, broken);

  base.colorNode = mix(surface, color(cracks.color), crack);
  base.roughnessNode = mix(
    mix(stone.roughness, float(0.95), broken),
    float(1),
    crack
  );

  // Cracks sink into the relief; fracture faces are rough and flat-shaded.
  const relief = bumpNormal(grit.mul(0.6).sub(crack), cracks.depth);
  base.normalNode = mix(mix(stone.normal, relief, crack), relief, broken);

  return { material: base, state: { age, damage, heading } };
};
