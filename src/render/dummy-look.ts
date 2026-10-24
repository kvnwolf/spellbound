/**
 * What a Training Dummy is made of: an enchanted wooden practice mannequin
 * worn on the wizard's own skeleton (`wizard-rig.ts` dresses it), so it
 * moves and reacts exactly as a Duelist does.
 *
 * Its surfaces read causes taken from the skeleton itself, baked once per
 * vertex into the dummy's own copy of each geometry, in the rest pose:
 *
 * - where the body is in metres (the model frame), so the wood's grain
 *   holds still on the figure as it moves and keeps one scale everywhere;
 * - which way the bone it hangs on runs, so the grain runs along each limb;
 * - how much of it hangs on the wooden bones (forearms, hands, shins, feet);
 * - how far down the skeleton it hangs (each joint one step further from
 *   the root than its parent, blended as the skin blends them), so every
 *   joint between two wooden bones is where that value crosses a half
 *   step, and is carved there as a groove: the knuckles, wrists, ankles
 *   and toes.
 *
 * The wood's channels share one grain and one groove weight; the grain
 * and the grooves fade to their area average once a pixel spans them,
 * so neither shimmers at a distance.
 */
import {
  abs,
  attribute,
  float,
  fract,
  fwidth,
  max,
  min,
  mix,
  mx_noise_float,
  vec3,
} from "three/tsl";
import { Bone, Color, Float32BufferAttribute, Vector3 } from "three/webgpu";
import type { Node, SkinnedMesh } from "three/webgpu";

import type { Tuning } from "../tuning";

export type DummyLook = Tuning["duelist"]["dummyLook"];

/** The bones whose skin is wood where the outfit is not cloth or metal. */
const wooden =
  /^(?:lowerarm|hand|thumb|index|middle|ring|pinky|calf|foot|ball)_/u;

/** A hex colour as a scene-linear vec3 node. */
const rgb = (hex: string): Node<"vec3"> => {
  const { b, g, r } = new Color(hex);

  return vec3(r, g, b);
};

/**
 * Gives `mesh` its own copy of its geometry carrying the skeleton's causes
 * (see above), as two attributes: `dummyRest` (the rest position in
 * metres, and the share hanging on wooden bones) and `dummyBone` (the
 * bone's direction, and how far down the skeleton it hangs). Call while
 * the model is still in its rest pose.
 */
export const bakeDummyCauses = (mesh: SkinnedMesh): void => {
  const { bones } = mesh.skeleton;
  const at = bones.map((bone) => bone.getWorldPosition(new Vector3()));

  const depths = bones.map((bone) => {
    let depth = 0;

    for (let up = bone.parent; up instanceof Bone; up = up.parent) {
      depth += 1;
    }

    return depth;
  });

  // Each bone's direction: toward its first child joint, or its parent's.
  const directions = bones.map((bone, index) => {
    const child = bone.children.find((each) => each instanceof Bone);
    const from = at[index] ?? new Vector3();

    if (child) {
      return child.getWorldPosition(new Vector3()).sub(from).normalize();
    }

    const parent = bone.parent instanceof Bone ? bone.parent : null;

    return parent
      ? from.clone().sub(parent.getWorldPosition(new Vector3())).normalize()
      : new Vector3(0, 1, 0);
  });

  const isWood = bones.map((bone) => (wooden.test(bone.name) ? 1 : 0));

  const geometry = mesh.geometry.clone();
  mesh.geometry = geometry;

  const position = geometry.getAttribute("position");
  const skinIndex = geometry.getAttribute("skinIndex");
  const skinWeight = geometry.getAttribute("skinWeight");
  const rest = new Float32Array(position.count * 4);
  const bone = new Float32Array(position.count * 4);
  const point = new Vector3();
  const direction = new Vector3();

  mesh.updateMatrixWorld(true);

  for (let vertex = 0; vertex < position.count; vertex += 1) {
    point.fromBufferAttribute(position, vertex);
    mesh.applyBoneTransform(vertex, point);
    point.applyMatrix4(mesh.matrixWorld);

    let total = 0;
    let wood = 0;
    let depth = 0;
    direction.set(0, 0, 0);

    for (let lane = 0; lane < 4; lane += 1) {
      const joint = skinIndex.getComponent(vertex, lane);
      const weight = skinWeight.getComponent(vertex, lane);

      total += weight;
      wood += weight * (isWood[joint] ?? 0);
      depth += weight * (depths[joint] ?? 0);
      direction.addScaledVector(directions[joint] ?? point, weight);
    }

    const share = total > 0 ? 1 / total : 0;

    rest.set([point.x, point.y, point.z, wood * share], vertex * 4);
    bone.set(
      [direction.x, direction.y, direction.z, depth * share],
      vertex * 4
    );
  }

  geometry.setAttribute("dummyRest", new Float32BufferAttribute(rest, 4));
  geometry.setAttribute("dummyBone", new Float32BufferAttribute(bone, 4));
};

/** The wood and its carved joints, as one surface's shared causes. */
export interface DummyWood {
  /** The share (0 to 1) of the surface hanging on the wooden bones. */
  readonly share: Node<"float">;
  /** The wood's colour, grain included, scene-linear. */
  readonly color: Node<"vec3">;
  readonly roughness: Node<"float">;
  /** How much of the pixel is a joint's groove (0 to 1). */
  readonly groove: Node<"float">;
}

/** The wood's nodes, read from the attributes `bakeDummyCauses` added. */
export const dummyWood = (look: DummyLook): DummyWood => {
  const rest = attribute("dummyRest", "vec4");
  const bone = attribute("dummyBone", "vec4");
  const at = rest.xyz;
  const along = bone.xyz.normalize();

  // Grain: streaks along the bone, `grain` cycles a metre across it.
  const reach = at.dot(along);
  const across = at.sub(along.mul(reach));

  const field = mx_noise_float(
    across.mul(look.grain).add(along.mul(reach.mul(look.grainAlong)))
  );

  // Wound into rings, so the grain reads as streaks of early and late wood.
  const streaks = field.mul(look.grainRings * Math.PI * 2).sin();

  // Rings a pixel spans across the grain; past `grainFade` they fade to their mean.
  const span = fwidth(at)
    .length()
    .mul(look.grain * look.grainRings);

  const keep = span.smoothstep(look.grainFade[0], look.grainFade[1]).oneMinus();

  const tone = streaks
    .mul(keep.mul(look.grainContrast * 0.5))
    .add(0.5)
    .saturate();

  // Grooves: where the skin is half on one bone and half on the next, box
  // filtered over the pixel's span so the line keeps its weight when thin.
  const depth = bone.w;
  const fromJoint = abs(fract(depth).sub(0.5));
  const step = max(fwidth(depth), 1e-5);
  const half = float(look.grooveWidth);

  const covered = min(fromJoint.add(step.mul(0.5)), half).sub(
    max(fromJoint.sub(step.mul(0.5)), half.negate())
  );

  return {
    color: mix(rgb(look.wood), rgb(look.woodLate), tone),
    groove: covered.div(step).saturate(),
    roughness: float(look.woodRoughness),
    share: rest.w,
  };
};

/** The groove's colour, as a scene-linear vec3 node. */
export const grooveColor = (look: DummyLook): Node<"vec3"> => rgb(look.groove);

/** The hood's empty inside, as a scene-linear vec3 node. */
export const hollowColor = (look: DummyLook): Node<"vec3"> => rgb(look.hollow);
