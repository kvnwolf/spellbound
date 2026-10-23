/**
 * Spell VFX: how each Spell looks in flight and where it lands, plus the
 * crackle at a Charging Wand. Views only: it reads Spells from snapshots and
 * reacts to simulation events.
 *
 * - In flight, each Spell is a white-hot core, a soft glow and a tapered
 *   trail in its own palette: Stupefy a small red bolt, Confringo a big,
 *   slow ball of fire that grows with its Charge. Flight is a straight line
 *   from the Wand (homing only bends it gently), so the trail is evaluated
 *   from the cast point instead of kept as a history.
 * - Impacts, mid-air cancels, casts and Backfires emit bursts of sparks plus a
 *   flash. Sparks are analytic GPU particles: one instanced sprite draw over
 *   a ring of stable slots, each slot holding its birth time, origin, tint
 *   and motion, with position, size and fade computed in TSL from the
 *   effects clock. Confringo's blast is the same mechanism, much bigger.
 * - A Charging Wand sheds sparks from the same ring at a rate that rises with
 *   the Charge, and crackles hotter and wilder as Overcharge nears.
 * - A small fixed pool of point lights follows the brightest Spells, flashes
 *   and Charging Wands, so the count of lights (and so the shaders) never changes.
 *
 * Colours are scene-linear HDR above 1, so they feed bloom.
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

import type { DuelEvent, SpellKind, SpellState } from "../duel/duel";
import type { Point3 } from "../duel/geometry";
import { sampleSpell } from "./interpolate";

/** A Wand that is Charging this frame, as the views see it. */
export interface ChargingWand {
  /** Where the Spell will leave the Wand. */
  readonly tip: Point3;
  /** How full the Charge is, 0 to 1. */
  readonly level: number;
  /** How close a held full Charge is to Backfiring, 0 to 1. */
  readonly overcharge: number;
}

export interface SpellVfx {
  readonly object: Group;
  /** Starts bursts and flashes for this frame's simulation events. */
  readonly handle: (events: readonly DuelEvent[]) => void;
  /**
   * Draws the Spells in flight between two snapshots, the crackle of every
   * Charging Wand, and ages effects by `seconds` of simulation time (so they
   * slow down with the slow motion).
   */
  readonly update: (
    previous: readonly SpellState[],
    current: readonly SpellState[],
    alpha: number,
    seconds: number,
    charging?: readonly ChargingWand[]
  ) => void;
}

/** A Spell's colours: the main hue and its white-hot heart. */
interface Palette {
  readonly main: Color;
  readonly hot: Color;
}

const palettes: Record<SpellKind, Palette> = {
  /** Fire: a deep orange with a pale gold heart. */
  confringo: { hot: new Color("#ffe2a0"), main: new Color("#ff6a12") },
  /** A fireball: blood-orange flame round a pale yellow heart. */
  incendio: { hot: new Color("#fff1b8"), main: new Color("#ff3d0a") },
  /** A cold, pale-blue binding light. */
  petrificus: { hot: new Color("#eef4ff"), main: new Color("#5f8fff") },
  /** A red bolt with a white-hot heart. */
  stupefy: { hot: new Color("#ffd2c4"), main: new Color("#ff2a1f") },
};

/** A Backfire is the same fire gone wrong: smoky red embers. */
const backfirePalette: Palette = {
  hot: new Color("#ffb070"),
  main: new Color("#c8240c"),
};

interface BoltLook {
  readonly core: { readonly intensity: number; readonly radius: number };
  readonly glow: { readonly intensity: number; readonly size: number };
  /** Light carried by a Spell in flight. */
  readonly light: { readonly distance: number; readonly intensity: number };
  readonly trail: {
    readonly intensity: number;
    readonly length: number;
    readonly width: number;
  };
}

const looks: Record<SpellKind, BoltLook> = {
  confringo: {
    core: { intensity: 7, radius: 0.17 },
    glow: { intensity: 2.6, size: 1.7 },
    light: { distance: 10, intensity: 16 },
    trail: { intensity: 2.2, length: 3.4, width: 0.17 },
  },
  incendio: {
    core: { intensity: 8, radius: 0.15 },
    glow: { intensity: 3, size: 1.5 },
    light: { distance: 10, intensity: 18 },
    trail: { intensity: 2.6, length: 3, width: 0.16 },
  },
  petrificus: {
    core: { intensity: 7, radius: 0.09 },
    glow: { intensity: 2.6, size: 1 },
    light: { distance: 8, intensity: 9 },
    trail: { intensity: 2.8, length: 3.4, width: 0.06 },
  },
  stupefy: {
    core: { intensity: 6, radius: 0.08 },
    glow: { intensity: 2.2, size: 0.75 },
    light: { distance: 7, intensity: 6 },
    trail: { intensity: 2.4, length: 2.4, width: 0.07 },
  },
};

/** Strong Stupefies are drawn this much bigger. */
const strongScale = 1.6;

/**
 * Confringo's size follows its Charge: a tap is this share of a full
 * Charge's size, and an empowered blast is bigger still.
 */
const confringoTapScale = 0.6;
const empoweredScale = 1.3;

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
  backfire: {
    flashLife: 0.22,
    flashSize: 1.8,
    life: 0.8,
    light: 55,
    lightLife: 0.45,
    size: 0.09,
    sparks: 70,
    speed: 5,
  },
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
  /** Confringo landing on a Duelist: a blast. Scaled up with its Charge. */
  confringoHit: {
    flashLife: 0.28,
    flashSize: 3.6,
    life: 0.85,
    light: 130,
    lightLife: 0.55,
    size: 0.14,
    sparks: 120,
    speed: 13,
  },
  /** Confringo bursting on Cover, a wall or the floor. */
  confringoStop: {
    flashLife: 0.22,
    flashSize: 2.6,
    life: 0.7,
    light: 90,
    lightLife: 0.45,
    size: 0.12,
    sparks: 90,
    speed: 10,
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
  /** The flare of a Perfect Release at the Wand. */
  perfect: {
    flashLife: 0.16,
    flashSize: 1.4,
    life: 0.35,
    light: 40,
    lightLife: 0.2,
    size: 0.06,
    sparks: 28,
    speed: 6,
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

/**
 * The crackle at a Charging Wand: sparks per second, size and launch speed
 * while it builds, rising to the `overcharge` values as a held full Charge
 * nears its Backfire; plus a glow sprite and a light at the tip.
 */
const crackle = {
  building: { rate: 26, size: 0.035, speed: 1.2 },
  /** How hard the tip glow flickers at the brink of Overcharge (0 steady). */
  flicker: 0.6,
  life: 0.28,
  /** Light at the tip at full Charge, and at the brink of Overcharge. */
  light: { full: 9, overcharge: 26 },
  overcharge: { rate: 190, size: 0.07, speed: 5 },
  /** Glow sprite size at the tip, from an empty to a full Charge. */
  tipGlow: { empty: 0.12, full: 0.55 },
};

/** Spark slots in the ring: enough for several big bursts at once. */
const sparkSlots = 2048;

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
 * fixed at start-up; spawning a spark only writes origin, birth time, tint,
 * size and motion into the next slot.
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
  let dirty = false;

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
    dirty = true;
  };

  return {
    advance: (seconds: number) => {
      now.value += seconds;
    },
    burst: (origin: Point3, style: BurstStyle, palette: Palette, scale = 1) => {
      // The flash: one big, still, short-lived spark.
      emit(origin, palette.hot, 3, style.flashSize * scale, 0, style.flashLife);

      for (
        let spark = 0;
        spark < Math.round(style.sparks * scale);
        spark += 1
      ) {
        const color = spark % 3 === 0 ? palette.hot : palette.main;
        emit(
          origin,
          color,
          4,
          style.size * scale,
          style.speed * scale,
          style.life
        );
      }
    },
    /** Uploads the slots written since the last frame, once. */
    commit: () => {
      if (!dirty) {
        return;
      }

      spawn.needsUpdate = true;
      tint.needsUpdate = true;
      motion.needsUpdate = true;
      dirty = false;
    },
    emit,
    sprite,
  };
};

/** One Spell kind's materials: core, glow and trail. */
const createBoltMaterials = (palette: Palette, look: BoltLook) => {
  const { hot, main } = palette;
  const core = new MeshBasicNodeMaterial();
  core.colorNode = vec3(hot.r, hot.g, hot.b).mul(look.core.intensity);

  const glow = new SpriteNodeMaterial({
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });

  const fromCentre = length(uv().sub(0.5)).mul(2);
  glow.colorNode = vec4(
    vec3(main.r, main.g, main.b).mul(look.glow.intensity),
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
  trail.colorNode = vec3(main.r, main.g, main.b).mul(look.trail.intensity);
  trail.opacityNode = along.pow(2);

  return { core, glow, trail };
};

type BoltMaterials = ReturnType<typeof createBoltMaterials>;

/** A Spell in flight: core, glow and trail, reused across Spells of one kind. */
const createBolt = (materials: BoltMaterials, look: BoltLook) => {
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

type Bolt = ReturnType<typeof createBolt>;

interface Flash {
  readonly position: Vector3;
  readonly peak: number;
  readonly life: number;
  readonly color: Color;
  age: number;
}

/** A light request this frame: the pool lights the brightest. */
interface Glow {
  readonly position: Vector3;
  readonly intensity: number;
  readonly color: Color;
  /** How far the light reaches, metres. */
  readonly distance: number;
}

/** Reach of flash and Wand lights, metres. */
const flashDistance = 7;

/** How big a Spell is drawn: strong Stupefies and Charged Confringos are bigger. */
const sizeOf = (spell: SpellState) => {
  if (spell.kind === "stupefy") {
    return spell.strong ? strongScale : 1;
  }

  if (spell.kind !== "confringo") {
    return 1;
  }

  const charged = confringoTapScale + (1 - confringoTapScale) * spell.charge;

  return spell.empowered ? charged * empoweredScale : charged;
};

/** One kind's pool of bolts, grown on demand and reused frame to frame. */
const createBoltPool = (kind: SpellKind, parent: Group) => {
  const look = looks[kind];
  const materials = createBoltMaterials(palettes[kind], look);
  const bolts: Bolt[] = [];
  let used = 0;

  return {
    /** Starts a frame: every bolt is free again. */
    begin: () => {
      used = 0;
    },
    /** Hides the bolts nobody took this frame. */
    end: () => {
      for (const bolt of bolts.slice(used)) {
        bolt.group.visible = false;
      }
    },
    look,
    take: (): Bolt => {
      let bolt = bolts[used];

      if (!bolt) {
        bolt = createBolt(materials, look);
        bolts.push(bolt);
        parent.add(bolt.group);
      }

      used += 1;
      bolt.group.visible = true;

      return bolt;
    },
  };
};

/** The glow sprites at Charging Wands, a few reused. */
const createTipGlows = (parent: Group) => {
  const { hot, main } = palettes.confringo;

  const material = new SpriteNodeMaterial({
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });

  const fromCentre = length(uv().sub(0.5)).mul(2);
  material.colorNode = vec4(
    vec3(main.r, main.g, main.b)
      .mul(2)
      .add(vec3(hot.r, hot.g, hot.b)),
    1
  );
  material.opacityNode = smoothstep(1, 0, fromCentre).pow(2);

  const sprites: Sprite[] = [];

  return {
    hideFrom: (index: number) => {
      for (const sprite of sprites.slice(index)) {
        sprite.visible = false;
      }
    },
    show: (index: number, tip: Point3, size: number) => {
      let sprite = sprites[index];

      if (!sprite) {
        sprite = new Sprite(material);
        sprites.push(sprite);
        parent.add(sprite);
      }

      sprite.visible = true;
      sprite.position.set(tip.x, tip.y, tip.z);
      sprite.scale.setScalar(size);
    },
  };
};

export const createSpellVfx = (): SpellVfx => {
  const object = new Group();
  const sparks = createSparkRing();

  const pools: Record<SpellKind, ReturnType<typeof createBoltPool>> = {
    confringo: createBoltPool("confringo", object),
    incendio: createBoltPool("incendio", object),
    petrificus: createBoltPool("petrificus", object),
    stupefy: createBoltPool("stupefy", object),
  };

  const tipGlows = createTipGlows(object);
  /** Where each Spell left the Wand, for its trail. */
  const castPoints = new Map<number, Point3>();
  const flashes: Flash[] = [];
  // Sparks owed to each Charging Wand: fractional counts carried frame to frame.
  let owed: number[] = [];
  // Drives the tip glow's flicker.
  let clock = 0;

  const lights = Array.from({ length: lightPoolSize }, () => {
    const light = new PointLight(palettes.stupefy.main, 0, flashDistance, 2);
    object.add(light);

    return light;
  });

  object.add(sparks.sprite);

  const up = new Vector3(0, 1, 0);
  const backward = new Vector3();
  const turn = new Quaternion();

  const burst = (
    position: Point3,
    style: BurstStyle,
    palette: Palette,
    scale = 1
  ) => {
    sparks.burst(position, style, palette, scale);
    flashes.push({
      age: 0,
      color: palette.main,
      life: style.lightLife,
      peak: style.light * scale,
      position: new Vector3(position.x, position.y, position.z),
    });
  };

  const handle = (events: readonly DuelEvent[]) => {
    // Round and Duel events have no Spell look.
    for (const event of events) {
      if (event.type === "spell-cast") {
        castPoints.set(event.spell.id, event.spell.position);
        burst(
          event.spell.position,
          bursts.cast,
          palettes[event.spell.kind],
          sizeOf(event.spell)
        );
      } else if (event.type === "perfect-release") {
        burst(event.spell.position, bursts.perfect, palettes.confringo);
      } else if (event.type === "backfire") {
        burst(event.position, bursts.backfire, backfirePalette);
      } else if (event.type === "spell-hit") {
        const { spell } = event;

        if (spell.kind === "confringo") {
          burst(
            event.position,
            bursts.confringoHit,
            palettes.confringo,
            sizeOf(spell)
          );
        } else {
          burst(
            event.position,
            spell.strong ? bursts.strongHit : bursts.hit,
            palettes.stupefy
          );
        }
      } else if (event.type === "spell-stopped") {
        const { spell } = event;

        if (spell.kind === "confringo") {
          burst(
            event.position,
            bursts.confringoStop,
            palettes.confringo,
            sizeOf(spell)
          );
        } else {
          burst(event.position, bursts.stop, palettes.stupefy);
        }
      } else if (event.type === "spells-cancelled") {
        const [first] = event.spells;
        burst(event.position, bursts.cancel, palettes[first.kind]);
      } else if (event.type === "spell-blocked") {
        const stop =
          event.spell.kind === "confringo" ? bursts.confringoStop : bursts.stop;

        burst(event.position, stop, palettes[event.spell.kind]);
      } else if (event.type === "parry") {
        // The reflected Spell's trail starts from the Shield, not the Wand.
        castPoints.set(event.reflected.id, event.position);
        burst(event.position, bursts.hit, palettes[event.spell.kind]);
      }
    }
  };

  /** Sparks and glow at every Charging Wand; returns their light requests. */
  const crackleAt = (
    charging: readonly ChargingWand[],
    seconds: number
  ): Glow[] => {
    const glows: Glow[] = [];
    const { hot, main } = palettes.confringo;

    owed = charging.map((_, index) => owed[index] ?? 0);

    for (const [index, wand] of charging.entries()) {
      const { building, overcharge: brink } = crackle;
      const danger = wand.overcharge;

      // Building sparks scale with the Charge; past full they escalate with Overcharge.
      const rate =
        building.rate * wand.level +
        (brink.rate - building.rate) * danger * danger;

      const size = building.size + (brink.size - building.size) * danger;
      const speed = building.speed + (brink.speed - building.speed) * danger;

      let due = (owed[index] ?? 0) + rate * seconds;

      for (let spark = 0; due >= 1; spark += 1, due -= 1) {
        // Past full the crackle turns white-hot every other spark.
        const color = danger > 0 && spark % 2 === 0 ? hot : main;
        sparks.emit(wand.tip, color, 4 + 4 * danger, size, speed, crackle.life);
      }

      owed[index] = due;

      // The tip glow swells with the Charge and flickers near the brink.
      const flicker =
        1 -
        crackle.flicker *
          danger *
          (0.5 + 0.5 * Math.sin(clock * (30 + 40 * danger)));

      const glowSize =
        (crackle.tipGlow.empty +
          (crackle.tipGlow.full - crackle.tipGlow.empty) * wand.level) *
        flicker;

      tipGlows.show(index, wand.tip, glowSize);

      glows.push({
        color: danger > 0.5 ? backfirePalette.main : main,
        distance: flashDistance,
        intensity:
          (crackle.light.full * wand.level +
            (crackle.light.overcharge - crackle.light.full) * danger) *
          flicker,
        position: new Vector3(wand.tip.x, wand.tip.y, wand.tip.z),
      });
    }

    tipGlows.hideFrom(charging.length);

    return glows;
  };

  const update = (
    previous: readonly SpellState[],
    current: readonly SpellState[],
    alpha: number,
    seconds: number,
    charging: readonly ChargingWand[] = []
  ) => {
    sparks.advance(seconds);
    clock += seconds;
    const before = new Map(previous.map((spell) => [spell.id, spell]));

    // Light requests this frame: every flash, Spell in flight and Charging Wand.
    const glows: Glow[] = crackleAt(charging, seconds);

    for (const pool of Object.values(pools)) {
      pool.begin();
    }

    for (const spell of current) {
      const pool = pools[spell.kind];
      const { look } = pool;
      const bolt = pool.take();
      const head = sampleSpell(before.get(spell.id), spell, alpha);
      const from = castPoints.get(spell.id) ?? spell.position;
      const scale = sizeOf(spell);

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
        color: palettes[spell.kind].main,
        distance: look.light.distance,
        intensity: look.light.intensity * scale,
        position: bolt.core.position,
      });
    }

    for (const pool of Object.values(pools)) {
      pool.end();
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
        color: each.color,
        distance: flashDistance,
        intensity: each.peak * left * left,
        position: each.position,
      });
    }

    sparks.commit();

    // The brightest requests get the pooled lights; the rest go dark.
    glows.sort((a, b) => b.intensity - a.intensity);

    for (const [index, light] of lights.entries()) {
      const glow = glows[index];
      light.intensity = glow?.intensity ?? 0;

      if (glow) {
        light.position.copy(glow.position);
        light.color.copy(glow.color);
        light.distance = glow.distance;
      }
    }
  };

  return { handle, object, update };
};
