/**
 * Spell VFX: how Stupefy looks in flight and where it lands. Views only:
 * it reads Spells from snapshots and reacts to simulation events.
 *
 * - In flight, each Spell is a white-hot core, a soft red glow and a tapered
 *   trail. Flight is a straight line from the Wand, so the trail is evaluated
 *   from the cast point instead of kept as a history.
 * - Impacts, mid-air cancels and casts emit bursts of sparks plus a flash.
 *   Sparks are analytic GPU particles: one instanced sprite draw over a ring
 *   of stable slots, each slot holding its birth time and origin, with
 *   position, size and fade computed in TSL from the effects clock.
 * - A small fixed pool of point lights follows the brightest Spells and
 *   flashes, so the count of lights (and so the shaders) never changes.
 *
 * Colours are scene-linear HDR above 1, so they feed bloom when it exists.
 */
import {
  exp,
  float,
  instancedDynamicBufferAttribute,
  instancedBufferAttribute,
  length,
  positionGeometry,
  smoothstep,
  step,
  uniform,
  uv,
  vec3,
  vec4,
} from "three/tsl";
import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  Group,
  InstancedBufferAttribute,
  Mesh,
  MeshBasicNodeMaterial,
  PointLight,
  Quaternion,
  SphereGeometry,
  Sprite,
  SpriteNodeMaterial,
  Vector3,
} from "three/webgpu";

import type { DuelEvent, SpellState } from "../duel/duel";
import type { Point3 } from "../duel/geometry";
import { sampleSpell } from "./interpolate";

export interface SpellVfx {
  readonly object: Group;
  /** Starts bursts and flashes for this frame's simulation events. */
  readonly handle: (events: readonly DuelEvent[]) => void;
  /**
   * Draws the Spells in flight between two snapshots and ages effects by
   * `seconds` of simulation time (so they slow down with the slow motion).
   */
  readonly update: (
    previous: readonly SpellState[],
    current: readonly SpellState[],
    alpha: number,
    seconds: number
  ) => void;
}

/** Stupefy's palette: a red bolt with a white-hot heart. */
const stupefyRed = new Color("#ff2a1f");
const stupefyHot = new Color("#ffd2c4");

const look = {
  core: { intensity: 6, radius: 0.08 },
  glow: { intensity: 2.2, size: 0.75 },
  /** Light carried by a Spell in flight. */
  light: { distance: 7, intensity: 6 },
  /** Strong casts are drawn this much bigger. */
  strongScale: 1.6,
  trail: { intensity: 2.4, length: 2.4, width: 0.07 },
};

/** How a burst of sparks behaves: count, launch speed, lifetime, spark size and the central flash. */
interface BurstStyle {
  readonly sparks: number;
  readonly speed: number;
  readonly life: number;
  readonly size: number;
  readonly flashSize: number;
  readonly flashLife: number;
  readonly light: number;
  readonly lightLife: number;
}

const bursts = {
  cancel: {
    flashLife: 0.18,
    flashSize: 2.4,
    life: 0.55,
    light: 60,
    lightLife: 0.35,
    size: 0.1,
    sparks: 56,
    speed: 9,
  },
  cast: {
    flashLife: 0.08,
    flashSize: 0.5,
    life: 0.22,
    light: 6,
    lightLife: 0.1,
    size: 0.05,
    sparks: 8,
    speed: 3,
  },
  hit: {
    flashLife: 0.14,
    flashSize: 1.5,
    life: 0.45,
    light: 35,
    lightLife: 0.3,
    size: 0.08,
    sparks: 36,
    speed: 7,
  },
  stop: {
    flashLife: 0.12,
    flashSize: 0.9,
    life: 0.35,
    light: 15,
    lightLife: 0.2,
    size: 0.07,
    sparks: 20,
    speed: 5,
  },
  strongHit: {
    flashLife: 0.2,
    flashSize: 2.6,
    life: 0.6,
    light: 70,
    lightLife: 0.4,
    size: 0.12,
    sparks: 64,
    speed: 11,
  },
} satisfies Record<string, BurstStyle>;

/** Spark slots in the ring: enough for several big bursts at once. */
const sparkSlots = 1024;

/** Sparks slow down with this drag (per second) and fall with this gravity. */
const sparkDrag = 4;
const sparkGravity = 6;
const lightPoolSize = 4;

/** A deterministic generator so the spark field is the same every run. */
const seededRandom = (seed: number) => {
  let state = seed;

  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;

    return state / 4_294_967_296;
  };
};

/**
 * The spark ring: one instanced sprite draw. Each slot's launch direction is
 * fixed at start-up; spawning a burst only writes origin, birth time, tint,
 * size and motion into the next slots.
 */
const createSparkRing = () => {
  const random = seededRandom(7);
  const directions = new Float32Array(sparkSlots * 4);

  for (let slot = 0; slot < sparkSlots; slot += 1) {
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

  // origin xyz + birth time; tint rgb + size; speed, life, unused, unused.
  const spawn = new InstancedBufferAttribute(
    new Float32Array(sparkSlots * 4),
    4
  );

  const tint = new InstancedBufferAttribute(
    new Float32Array(sparkSlots * 4),
    4
  );

  const motion = new InstancedBufferAttribute(
    new Float32Array(sparkSlots * 4),
    4
  );

  // Unborn slots: born in the far past with a tiny life, so they never show.
  for (let slot = 0; slot < sparkSlots; slot += 1) {
    spawn.setW(slot, -1e6);
    motion.setY(slot, 1e-3);
  }

  const now = uniform(0);

  const direction = instancedBufferAttribute<"vec4">(
    new InstancedBufferAttribute(directions, 4),
    "vec4"
  );

  const spawnNode = instancedDynamicBufferAttribute<"vec4">(spawn, "vec4");
  const tintNode = instancedDynamicBufferAttribute<"vec4">(tint, "vec4");
  const motionNode = instancedDynamicBufferAttribute<"vec4">(motion, "vec4");

  const age = now.sub(spawnNode.w).max(0);
  const life = age.div(motionNode.y).clamp(0, 1);
  // 1 until the spark's life is spent (step(edge, x) is x >= edge).
  const alive = step(life, float(0.999));
  const speed = motionNode.x.mul(direction.w);

  // Velocity decays with drag and gravity pulls down: analytic, so a spark's
  // position depends only on its age.
  const travel = float(1)
    .sub(exp(age.mul(-sparkDrag)))
    .div(sparkDrag);

  const material = new SpriteNodeMaterial({
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });

  material.positionNode = spawnNode.xyz
    .add(direction.xyz.mul(speed).mul(travel))
    .add(vec3(0, age.mul(age).mul(-0.5 * sparkGravity), 0));
  material.scaleNode = tintNode.w.mul(float(1).sub(life)).mul(alive);

  // A soft round spark that fades out over its life.
  const fromCentre = length(uv().sub(0.5)).mul(2);
  const mask = smoothstep(1, 0, fromCentre).pow(2);
  const fade = float(1).sub(life).pow(1.5);
  material.colorNode = vec4(tintNode.xyz.mul(fade), 1);
  material.opacityNode = mask.mul(fade).mul(alive);

  const sprite = new Sprite(material);
  sprite.count = sparkSlots;
  // Sparks are placed in the shader, so the CPU cannot know their bounds.
  sprite.frustumCulled = false;

  let next = 0;

  const emit = (
    origin: Point3,
    color: Color,
    intensity: number,
    size: number,
    speedOf: number,
    lifeOf: number
  ) => {
    spawn.setXYZW(next, origin.x, origin.y, origin.z, now.value);
    tint.setXYZW(
      next,
      color.r * intensity,
      color.g * intensity,
      color.b * intensity,
      size
    );
    motion.setXY(next, speedOf, lifeOf);
    next = (next + 1) % sparkSlots;
  };

  return {
    advance: (seconds: number) => {
      now.value += seconds;
    },
    burst: (origin: Point3, style: BurstStyle, scale = 1) => {
      // The flash: one big, still, short-lived spark.
      emit(origin, stupefyHot, 3, style.flashSize * scale, 0, style.flashLife);

      for (let spark = 0; spark < style.sparks; spark += 1) {
        const color = spark % 3 === 0 ? stupefyHot : stupefyRed;
        emit(
          origin,
          color,
          4,
          style.size * scale,
          style.speed * scale,
          style.life
        );
      }

      spawn.needsUpdate = true;
      tint.needsUpdate = true;
      motion.needsUpdate = true;
    },
    sprite,
  };
};

/** A Spell in flight: core, glow and trail, reused across Spells. */
const createBolt = (materials: ReturnType<typeof createBoltMaterials>) => {
  const group = new Group();

  const core = new Mesh(
    new SphereGeometry(look.core.radius, 16, 12),
    materials.core
  );

  const glow = new Sprite(materials.glow);
  glow.scale.setScalar(look.glow.size);

  // A cone from radius 1 at the head (y = 0) to a point at the tail (y = 1),
  // scaled to the trail's width and length and turned to point backward.
  const trailGeometry = new CylinderGeometry(0, 1, 1, 12, 1, true);
  trailGeometry.translate(0, 0.5, 0);
  const trail = new Mesh(trailGeometry, materials.trail);

  group.add(core, glow, trail);

  return { core, glow, group, trail };
};

const createBoltMaterials = () => {
  const core = new MeshBasicNodeMaterial();
  core.colorNode = vec3(stupefyHot.r, stupefyHot.g, stupefyHot.b).mul(
    look.core.intensity
  );

  const glow = new SpriteNodeMaterial({
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });

  const fromCentre = length(uv().sub(0.5)).mul(2);
  glow.colorNode = vec4(
    vec3(stupefyRed.r, stupefyRed.g, stupefyRed.b).mul(look.glow.intensity),
    1
  );
  glow.opacityNode = smoothstep(1, 0, fromCentre).pow(2.5);

  const trail = new MeshBasicNodeMaterial({
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });

  // Bright at the head, fading to nothing at the tail.
  const along = float(1).sub(positionGeometry.y);
  trail.colorNode = vec3(stupefyRed.r, stupefyRed.g, stupefyRed.b).mul(
    look.trail.intensity
  );
  trail.opacityNode = along.pow(2);

  return { core, glow, trail };
};

interface Flash {
  readonly position: Vector3;
  readonly peak: number;
  readonly life: number;
  age: number;
}

export const createSpellVfx = (): SpellVfx => {
  const object = new Group();
  const sparks = createSparkRing();
  const materials = createBoltMaterials();
  const bolts: ReturnType<typeof createBolt>[] = [];
  /** Where each Spell left the Wand, for its trail. */
  const castPoints = new Map<number, Point3>();
  const flashes: Flash[] = [];

  const lights = Array.from({ length: lightPoolSize }, () => {
    const light = new PointLight(stupefyRed, 0, look.light.distance, 2);
    object.add(light);

    return light;
  });

  object.add(sparks.sprite);

  const up = new Vector3(0, 1, 0);
  const backward = new Vector3();
  const turn = new Quaternion();

  const flash = (position: Point3, style: BurstStyle) => {
    flashes.push({
      age: 0,
      life: style.lightLife,
      peak: style.light,
      position: new Vector3(position.x, position.y, position.z),
    });
  };

  const burst = (position: Point3, style: BurstStyle) => {
    sparks.burst(position, style);
    flash(position, style);
  };

  const handle = (events: readonly DuelEvent[]) => {
    // Round and Duel events have no Spell look.
    for (const event of events) {
      if (event.type === "spell-cast") {
        castPoints.set(event.spell.id, event.spell.position);
        burst(event.spell.position, bursts.cast);
      } else if (event.type === "spell-hit") {
        burst(
          event.position,
          event.spell.strong ? bursts.strongHit : bursts.hit
        );
      } else if (event.type === "spell-stopped") {
        burst(event.position, bursts.stop);
      } else if (event.type === "spells-cancelled") {
        burst(event.position, bursts.cancel);
      }
    }
  };

  const update = (
    previous: readonly SpellState[],
    current: readonly SpellState[],
    alpha: number,
    seconds: number
  ) => {
    sparks.advance(seconds);
    const before = new Map(previous.map((spell) => [spell.id, spell]));

    // Light requests this frame: every flash and every Spell in flight.
    const glows: { position: Vector3; intensity: number }[] = [];

    for (const [index, spell] of current.entries()) {
      let bolt = bolts[index];

      if (!bolt) {
        bolt = createBolt(materials);
        bolts.push(bolt);
        object.add(bolt.group);
      }

      const head = sampleSpell(before.get(spell.id), spell, alpha);
      const from = castPoints.get(spell.id) ?? spell.position;
      const scale = spell.strong ? look.strongScale : 1;

      bolt.group.visible = true;
      bolt.core.position.set(head.x, head.y, head.z);
      bolt.core.scale.setScalar(scale);
      bolt.glow.position.copy(bolt.core.position);
      bolt.glow.scale.setScalar(look.glow.size * scale);

      // The trail reaches back toward the Wand, never past it.
      const flown = Math.hypot(
        head.x - from.x,
        head.y - from.y,
        head.z - from.z
      );

      const trailLength = Math.min(look.trail.length * scale, flown);
      backward
        .set(-spell.velocity.x, -spell.velocity.y, -spell.velocity.z)
        .normalize();
      turn.setFromUnitVectors(up, backward);
      bolt.trail.position.copy(bolt.core.position);
      bolt.trail.quaternion.copy(turn);
      bolt.trail.scale.set(
        look.trail.width * scale,
        Math.max(trailLength, 1e-3),
        look.trail.width * scale
      );

      glows.push({
        intensity: look.light.intensity * scale,
        position: bolt.core.position,
      });
    }

    for (const bolt of bolts.slice(current.length)) {
      bolt.group.visible = false;
    }

    // Forget the cast points of Spells no longer in the air.
    const flying = new Set(current.map((spell) => spell.id));

    for (const id of castPoints.keys()) {
      if (!flying.has(id)) {
        castPoints.delete(id);
      }
    }

    // Backward, so removing a spent flash never skips the next one.
    for (let index = flashes.length - 1; index >= 0; index -= 1) {
      const each = flashes[index];

      if (each) {
        each.age += seconds;
      }

      if (each && each.age >= each.life) {
        flashes.splice(index, 1);
      }
    }

    for (const each of flashes) {
      const left = 1 - each.age / each.life;
      glows.push({
        intensity: each.peak * left * left,
        position: each.position,
      });
    }

    // The brightest requests get the pooled lights; the rest go dark.
    glows.sort((a, b) => b.intensity - a.intensity);

    for (const [index, light] of lights.entries()) {
      const glow = glows[index];
      light.intensity = glow?.intensity ?? 0;

      if (glow) {
        light.position.copy(glow.position);
      }
    }
  };

  return { handle, object, update };
};
