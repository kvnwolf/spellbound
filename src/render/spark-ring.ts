/**
 * The spark ring: every spark, ember, flame, puff of dust, wind streak and
 * flash ring of the Spell, Clash and defence effects, in one instanced
 * sprite draw over a ring of stable slots. Spawning a spark writes its
 * origin, birth time, tint, size, motion and heading into the next slot; its
 * position, size, shape and fade are then pure functions of its age,
 * evaluated in TSL from the effects clock, so the CPU never touches a live
 * spark again and the draw never changes shape (one shader, compiled at load).
 *
 * Each spark leaves along its slot's fixed random direction, pulled toward
 * an optional heading (a cone of sparks, wind driven along a blast, dust
 * swept along the floor), slows with drag and falls (or rises) with gravity.
 * It is drawn one of three ways: a soft round dot; a streak stretched along
 * its motion on screen by `streak` seconds of travel, so fast sparks read as
 * hot lines; or a thin ring that swells as it fades, a flash's shock front.
 *
 * Colours are scene-linear HDR above 1, so they feed bloom. Additive, depth
 * tested and never written: sparks are light, so their order does not matter.
 */
import {
  atan,
  exp,
  float,
  instancedBufferAttribute,
  instancedDynamicBufferAttribute,
  length,
  max,
  modelViewMatrix,
  smoothstep,
  step,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import {
  AdditiveBlending,
  InstancedBufferAttribute,
  Sprite,
  SpriteNodeMaterial,
} from "three/webgpu";
import type { Color } from "three/webgpu";

import type { Point3 } from "../duel/geometry";
import type { Tuning } from "../tuning";

/** How one spark is drawn and moves. */
export interface SparkStyle {
  /** Radiance multiplier on the colour (scene-linear HDR). */
  readonly intensity: number;
  /** Sprite size, metres: the dot's diameter, the streak's width, the ring's full diameter. */
  readonly size: number;
  /** Launch speed, metres per second (before the slot's own jitter). */
  readonly speed: number;
  /** Lifetime, seconds. */
  readonly life: number;
  /** Gravity scale: 1 falls like a spark, 0 floats, negative rises like an ember. */
  readonly gravity?: number;
  /**
   * Where the spark leans: its direction is `heading` plus the slot's random
   * direction times `spread`, so a unit heading with a small spread is a
   * narrow cone and no heading is a sphere. Need not be unit length.
   */
  readonly heading?: Point3;
  readonly spread?: number;
  /** Seconds of travel a streak is stretched over (0 for a round dot). */
  readonly streak?: number;
  /** A swelling ring instead of a dot (a flash's shock front). */
  readonly ring?: boolean;
}

export interface SparkRing {
  readonly sprite: Sprite;
  /** Ages every spark by `seconds` of simulation time. */
  readonly advance: (seconds: number) => void;
  /** Writes one spark into the next slot. */
  readonly emit: (origin: Point3, color: Color, style: SparkStyle) => void;
  /** Uploads the slots written since the last frame, once. */
  readonly commit: () => void;
}

/** A deterministic generator so the spark field is the same every run. */
export const seededRandom = (seed: number) => {
  let state = seed;

  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;

    return state / 4_294_967_296;
  };
};

/** Marks a ring in the style lane (any negative value). */
const ringStyle = -1;

export const createSparkRing = (settings: Tuning["spellLook"]["sparks"]) => {
  const { drag, gravity, slots } = settings;
  const random = seededRandom(7);
  const directions = new Float32Array(slots * 4);

  for (let slot = 0; slot < slots; slot += 1) {
    // Uniform direction on the sphere, with a per-spark speed jitter in w.
    const z = random() * 2 - 1;
    const angle = random() * Math.PI * 2;
    const ring = Math.sqrt(1 - z * z);
    directions.set(
      [
        ring * Math.cos(angle),
        z,
        ring * Math.sin(angle),
        0.35 + random() * 0.65,
      ],
      slot * 4
    );
  }

  const lane = () =>
    new InstancedBufferAttribute(new Float32Array(slots * 4), 4);

  // origin xyz + birth time; tint rgb + size; speed, life, gravity, style;
  // heading xyz + spread.
  const spawn = lane();
  const tint = lane();
  const motion = lane();
  const lean = lane();

  // Unborn slots: born in the far past with a tiny life, so they never show.
  for (let slot = 0; slot < slots; slot += 1) {
    spawn.setW(slot, -1e6);
    motion.setY(slot, 1e-3);
    lean.setW(slot, 1);
  }

  const now = uniform(0);

  const direction = instancedBufferAttribute<"vec4">(
    new InstancedBufferAttribute(directions, 4),
    "vec4"
  );

  const spawnNode = instancedDynamicBufferAttribute<"vec4">(spawn, "vec4");
  const tintNode = instancedDynamicBufferAttribute<"vec4">(tint, "vec4");
  const motionNode = instancedDynamicBufferAttribute<"vec4">(motion, "vec4");
  const leanNode = instancedDynamicBufferAttribute<"vec4">(lean, "vec4");

  const age = now.sub(spawnNode.w).max(0);
  const life = age.div(motionNode.y).clamp(0, 1);
  // 1 until the spark's life is spent (step(edge, x) is x >= edge).
  const alive = step(life, float(0.999));
  const speed = motionNode.x.mul(direction.w);
  const style = motionNode.w;
  const isRing = step(style, float(-0.5));
  const streak = max(style, 0);

  // The slot's random direction leaned toward the heading.
  const heading = leanNode.xyz.add(direction.xyz.mul(leanNode.w));
  const towards = heading.div(length(heading).max(1e-4));

  // Velocity decays with drag and gravity pulls down: analytic, so a spark's
  // position depends only on its age.
  const decay = exp(age.mul(-drag));
  const travel = float(1).sub(decay).div(drag);
  const fall = motionNode.z.mul(-gravity);

  const material = new SpriteNodeMaterial({
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });

  material.positionNode = spawnNode.xyz
    .add(towards.mul(speed).mul(travel))
    .add(vec3(0, age.mul(age).mul(fall).mul(0.5), 0));

  // The velocity on screen: a streak lies along it and stretches with it.
  const velocity = towards
    .mul(speed)
    .mul(decay)
    .add(vec3(0, age.mul(fall), 0));

  const onScreen = modelViewMatrix.mul(vec4(velocity, 0)).xy;
  material.rotationNode = atan(onScreen.y, onScreen.x.add(1e-5)).mul(
    step(float(1e-6), streak)
  );

  // Dots and streaks shrink as they die; a ring swells to its full size.
  const shrink = tintNode.w.mul(float(1).sub(life));
  const swell = tintNode.w.mul(float(1).sub(float(1).sub(life).pow(3)));
  const size = shrink.mul(isRing.oneMinus()).add(swell.mul(isRing)).mul(alive);
  material.scaleNode = vec2(size.add(length(onScreen).mul(streak)), size);

  // A soft round dot (an ellipse once stretched), or a thin bright ring.
  const fromCentre = length(uv().sub(0.5)).mul(2);
  const dot = smoothstep(1, 0, fromCentre).pow(2);
  const band = exp(fromCentre.sub(0.76).div(0.2).pow(2).negate()).mul(0.4);
  const mask = dot.mul(isRing.oneMinus()).add(band.mul(isRing));
  const fade = float(1).sub(life).pow(1.5);
  material.colorNode = vec4(tintNode.xyz.mul(fade), 1);
  material.opacityNode = mask.mul(fade).mul(alive);

  const sprite = new Sprite(material);
  sprite.count = slots;
  // Sparks are placed in the shader, so the CPU cannot know their bounds.
  sprite.frustumCulled = false;

  let next = 0;
  let dirty = false;

  const emit = (origin: Point3, color: Color, spark: SparkStyle) => {
    const { intensity } = spark;
    const toward = spark.heading ?? { x: 0, y: 0, z: 0 };
    spawn.setXYZW(next, origin.x, origin.y, origin.z, now.value);
    tint.setXYZW(
      next,
      color.r * intensity,
      color.g * intensity,
      color.b * intensity,
      spark.size
    );
    motion.setXYZW(
      next,
      spark.speed,
      spark.life,
      spark.gravity ?? 1,
      spark.ring === true ? ringStyle : (spark.streak ?? 0)
    );
    lean.setXYZW(next, toward.x, toward.y, toward.z, spark.spread ?? 1);
    next = (next + 1) % slots;
    dirty = true;
  };

  return {
    advance: (seconds: number) => {
      now.value += seconds;
    },
    commit: () => {
      if (!dirty) {
        return;
      }

      spawn.needsUpdate = true;
      tint.needsUpdate = true;
      motion.needsUpdate = true;
      lean.needsUpdate = true;
      dirty = false;
    },
    emit,
    sprite,
  } satisfies SparkRing;
};
