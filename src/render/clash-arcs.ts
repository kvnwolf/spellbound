/**
 * The Clash's arcs: short, flickering, branching streams of energy shooting
 * out of the meeting point in every direction. One instanced draw over a
 * ring of stable slots: spawning an arc writes its root, heading, length,
 * bend, birth, life, width, colour and seed into its slot once; its path,
 * how far it has shot out, its flicker and its fade are then functions of
 * its age, evaluated in TSL from the effects clock. Each arc is a ribbon
 * turned to the camera along its own path, so it reads as a stream of
 * light from any side.
 *
 * An arc's path is the same function on the CPU (`arcPoint`) and in TSL,
 * so a branch can start exactly on its parent: it is just another arc,
 * rooted partway along the parent and born as the parent's head passes.
 * Roots are relative to the meeting point (`knot`), so the arcs ride it as
 * it is pushed along the beam.
 */
import {
  abs,
  cameraPosition,
  cross,
  exp,
  float,
  instancedDynamicBufferAttribute,
  max,
  mix,
  normalize,
  positionGeometry,
  select,
  sin,
  smoothstep,
  step,
  uniform,
  uv,
  vec3,
  vec4,
} from "three/tsl";
import type { Node } from "three/webgpu";
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  InstancedBufferAttribute,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  Vector3,
} from "three/webgpu";

import type { Point3 } from "../duel/geometry";
import type { Tuning } from "../tuning";

type ArcLook = Tuning["clashLook"]["arcs"];

/** One arc: where it starts (relative to the meeting point), where it heads, and how it looks. */
export interface Arc {
  readonly root: Point3;
  /** Unit heading. */
  readonly heading: Point3;
  readonly length: number;
  /** How far it bends off its heading by its tip, metres per metre of length (a vector). */
  readonly curve: Point3;
  /** Seconds from now until it starts shooting out. */
  readonly delay: number;
  readonly life: number;
  /** Ribbon width at its root, metres. */
  readonly width: number;
  /** Radiance multiplier (scene-linear HDR). */
  readonly intensity: number;
  readonly color: Color;
  /** Any number: picks its wiggle and flicker. */
  readonly seed: number;
}

export interface ClashArcs {
  readonly mesh: Mesh;
  /** The meeting point the arcs are rooted on, world space. */
  readonly knot: Vector3;
  readonly emit: (arc: Arc) => void;
  /** Ages every arc by `seconds`, then uploads what was written. */
  readonly advance: (seconds: number) => void;
}

/** Seconds an arc `length` metres long takes to shoot out: every head flies at the same speed. */
export const growOf = (look: ArcLook, length: number) =>
  Math.max(look.grow * (length / look.length.max), 1e-3);

/** The two wiggle frequencies of an arc's path, radians per unit of its length. */
const wiggles = [9, 23] as const;

/** The two directions square to `heading` an arc wiggles along. */
const basisOf = (heading: Vector3) => {
  const helper =
    Math.abs(heading.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);

  const first = new Vector3().crossVectors(heading, helper).normalize();
  const second = new Vector3().crossVectors(heading, first);

  return [first, second] as const;
};

/** Where an arc is `share` of the way along its length (relative to the meeting point), as the shader draws it but for the writhe. */
export const arcPoint = (arc: Arc, share: number, jag: number): Vector3 => {
  const heading = new Vector3(arc.heading.x, arc.heading.y, arc.heading.z);
  const [first, second] = basisOf(heading);
  const [low, high] = wiggles;
  const s = arc.seed;

  const across =
    0.6 * Math.sin(share * low + s * 1.7) +
    0.4 * Math.sin(share * high + s * 3.1);

  const up =
    0.6 * Math.sin(share * low * 1.3 + s * 2.3) +
    0.4 * Math.sin(share * high * 0.8 + s * 0.7);

  const reach = arc.length * share;
  const swing = arc.length * jag * share;

  return new Vector3(arc.root.x, arc.root.y, arc.root.z)
    .addScaledVector(heading, reach)
    .addScaledVector(first, across * swing)
    .addScaledVector(second, up * swing)
    .add(
      new Vector3(arc.curve.x, arc.curve.y, arc.curve.z).multiplyScalar(
        arc.length * share * share
      )
    );
};

/** A lane of per-arc data as a TSL node. */
const node = (attribute: InstancedBufferAttribute) =>
  instancedDynamicBufferAttribute<"vec4">(attribute, "vec4");

export const createClashArcs = (look: ArcLook): ClashArcs => {
  const { slots } = look;

  const lane = () =>
    new InstancedBufferAttribute(new Float32Array(slots * 4), 4);

  // root xyz + birth; heading xyz + length; curve xyz + seed;
  // colour rgb + intensity; life, grow, width.
  const lanes = {
    color: lane(),
    curve: lane(),
    heading: lane(),
    root: lane(),
    timing: lane(),
  };

  // Unborn slots: born in the far past with a tiny life, so they never show.
  for (let slot = 0; slot < slots; slot += 1) {
    lanes.root.setW(slot, -1e6);
    lanes.timing.setX(slot, 1e-3);
    lanes.timing.setY(slot, 1e-3);
    lanes.heading.setY(slot, 1);
  }

  const now = uniform(0);
  const knot = uniform(new Vector3());

  const root = node(lanes.root);
  const heading = node(lanes.heading);
  const curve = node(lanes.curve);
  const color = node(lanes.color);
  const timing = node(lanes.timing);
  const seed = curve.w;

  const rawAge = now.sub(root.w);
  const age = max(rawAge, 0);
  const life = age.div(timing.x);
  const alive = step(0, rawAge).mul(step(life, float(0.999)));

  // Shoots out over `grow` seconds; late in its life its root lets go and
  // the rest of it races out after the head.
  const head = age.div(timing.y).clamp(0, 1);
  const tail = smoothstep(look.letGo, 1, life);

  const direction = normalize(heading.xyz);

  const helper = select(
    abs(direction.y).lessThan(0.9),
    vec3(0, 1, 0),
    vec3(1, 0, 0)
  );

  const first = normalize(cross(direction, helper));
  const second = cross(direction, first);

  /** The arc's path at `share` of its length, world space. */
  const pathAt = (share: Node<"float">) => {
    const [low, high] = wiggles;

    const across = sin(share.mul(low).add(seed.mul(1.7)))
      .mul(0.6)
      .add(sin(share.mul(high).add(seed.mul(3.1))).mul(0.4));

    const up = sin(share.mul(low * 1.3).add(seed.mul(2.3)))
      .mul(0.6)
      .add(sin(share.mul(high * 0.8).add(seed.mul(0.7))).mul(0.4));

    const swing = heading.w.mul(look.jag).mul(share);

    // A writhe that keeps it alive, strongest at the tip.
    const writhe = heading.w
      .mul(look.writhe)
      .mul(share.mul(share))
      .mul(sin(now.mul(look.writheSpeed).add(share.mul(7)).add(seed)));

    return knot
      .add(root.xyz)
      .add(direction.mul(heading.w.mul(share)))
      .add(first.mul(across.mul(swing).add(writhe)))
      .add(second.mul(up.mul(swing)))
      .add(curve.xyz.mul(heading.w.mul(share.mul(share))));
  };

  const along = positionGeometry.x.add(0.5);
  const centre = pathAt(along);
  const ahead = pathAt(along.add(0.02));
  const tangent = normalize(ahead.sub(centre));
  const side = normalize(cross(tangent, cameraPosition.sub(centre)));

  const width = timing.z.mul(float(1).sub(along.mul(look.taper))).mul(alive);

  const material = new MeshBasicNodeMaterial({
    blending: AdditiveBlending,
    depthWrite: false,
    forceSinglePass: true,
    side: DoubleSide,
    transparent: true,
  });

  material.positionNode = centre.add(side.mul(positionGeometry.y.mul(width)));

  // Across the ribbon: a hot thread inside a coloured glow.
  const across = uv().y.mul(2).sub(1);
  const thread = exp(across.div(look.thread).pow(2).negate());
  const glow = exp(across.div(look.glow).pow(2).negate());
  const share = uv().x;

  // Only the part already shot out and not yet let go, soft at both ends.
  const shown = smoothstep(head, head.sub(look.headSoft), share).mul(
    smoothstep(tail, tail.add(look.headSoft), share)
  );

  // A stutter, as electricity does: never quite steady, now and then dark.
  const flicker = sin(now.mul(look.flicker.rate).add(seed.mul(7.3)))
    .add(sin(now.mul(look.flicker.rate * 1.71).add(seed.mul(3.1))).mul(0.6))
    .add(look.flicker.bias)
    .clamp(0, 1)
    .mul(1 - look.flicker.low)
    .add(look.flicker.low);

  const white = new Color(look.hot);
  const hot = vec3(white.r, white.g, white.b);
  const hue = mix(hot, color.xyz, smoothstep(0, look.coolBy, share));
  const fade = float(1).sub(life).pow(look.fade);
  const dim = float(1).sub(share.mul(look.dim));

  material.colorNode = vec4(
    hot
      .mul(thread.mul(look.threadIntensity))
      .add(hue.mul(glow))
      .mul(color.w)
      .mul(shown)
      .mul(flicker)
      .mul(fade)
      .mul(dim)
      .mul(alive),
    1
  );

  const mesh = new Mesh(new PlaneGeometry(1, 1, look.segments, 1), material);
  mesh.count = slots;
  // Arcs are placed in the shader, so the CPU cannot know their bounds.
  mesh.frustumCulled = false;

  let next = 0;
  let dirty = false;

  return {
    advance: (seconds) => {
      now.value += seconds;

      if (dirty) {
        for (const attribute of Object.values(lanes)) {
          attribute.needsUpdate = true;
        }

        dirty = false;
      }
    },
    emit: (arc) => {
      lanes.root.setXYZW(
        next,
        arc.root.x,
        arc.root.y,
        arc.root.z,
        now.value + arc.delay
      );
      lanes.heading.setXYZW(
        next,
        arc.heading.x,
        arc.heading.y,
        arc.heading.z,
        arc.length
      );
      lanes.curve.setXYZW(
        next,
        arc.curve.x,
        arc.curve.y,
        arc.curve.z,
        arc.seed
      );
      lanes.color.setXYZW(
        next,
        arc.color.r,
        arc.color.g,
        arc.color.b,
        arc.intensity
      );
      lanes.timing.setXYZW(
        next,
        Math.max(arc.life, 1e-3),
        growOf(look, arc.length),
        arc.width,
        0
      );
      next = (next + 1) % slots;
      dirty = true;
    },
    knot: knot.value,
    mesh,
  };
};
