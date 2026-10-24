/**
 * What a Spell's energy does where it lands, as the films draw it: a brief
 * flare of light rays at the contact point, a few soft wisps of energy (or
 * fire, or smoke) that swell and fade, and short electric arcs crawling over
 * the hit body, jumping between its bones. The streaks, the light on the
 * surroundings and the body's own flare are the Spell VFX's and the
 * Duelist view's; this module draws the rest.
 *
 * - Flares and wisps are analytic, like the spark ring: spawning one writes
 *   its origin, birth time, colours, size and motion into the next of a ring
 *   of stable slots, and its shape, motion and fade are pure functions of its
 *   age, evaluated in TSL from the effects clock. One instanced sprite draw
 *   each (wisps twice: glowing energy and fire added, smoke laid over), so
 *   the shaders never change and compile at load.
 * - A flare is a hot white core and a fan of thin rays in the Spell's hue,
 *   from angular noise, shooting out and dying within a fifth of a second.
 * - A wisp is a soft blob whose edge is eaten by noise drifting through it
 *   (so it billows instead of reading as a dot), swelling by `grow` as it
 *   fades, drifting with drag and a seeded swirl, rising or sinking with
 *   `gravity`, and stretched upward by `stretch` (a tongue of flame). It
 *   burns from its hot colour to its main one as it ages.
 * - An arc is a thin camera-facing ribbon between two joints of the body,
 *   lifted toward the camera so the body never hides it; a jagged noise path
 *   with a branch, re-rolled every `hop` seconds, so it crackles and jumps.
 *   Every arc shares one material; its seed, strength and colours are
 *   per-object uniforms read as each is drawn.
 *
 * Colours are scene-linear HDR, so they feed bloom.
 */
import {
  atan,
  exp,
  float,
  floor,
  instancedBufferAttribute,
  instancedDynamicBufferAttribute,
  length,
  mix,
  mx_noise_float,
  sin,
  smoothstep,
  step,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { Node, Object3D } from "three/webgpu";
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  Mesh,
  MeshBasicNodeMaterial,
  NormalBlending,
  PlaneGeometry,
  Sprite,
  SpriteNodeMaterial,
  Vector3,
} from "three/webgpu";

import type { Point3 } from "../duel/geometry";
import type { Tuning } from "../tuning";
import { layRibbon } from "./jet";
import { seededRandom } from "./spark-ring";

type SpellLook = Tuning["spellLook"];

/** How one wisp is drawn and moves. */
export interface WispStyle {
  /** Radiance multiplier on the colours (scene-linear HDR); for smoke, its opacity. */
  readonly intensity: number;
  /** Diameter at birth, metres. */
  readonly size: number;
  /** How many times bigger it is when it dies. */
  readonly grow: number;
  /** Launch speed, metres per second (before the slot's own jitter). */
  readonly speed: number;
  readonly life: number;
  /** Gravity scale: 1 falls, 0 floats, negative rises (heat, smoke). */
  readonly gravity?: number;
  /** Where it leans (see the spark ring); no heading is every way. */
  readonly heading?: Point3;
  readonly spread?: number;
  /** How much taller than wide it is: 0 round, 1 twice as tall. */
  readonly stretch?: number;
}

/** How one flare is drawn. */
export interface FlareStyle {
  readonly intensity: number;
  /** Full diameter of its rays, metres. */
  readonly size: number;
  readonly life: number;
}

const lane = (slots: number) =>
  new InstancedBufferAttribute(new Float32Array(slots * 4), 4);

/** A per-slot random vec4 that never changes: a direction on the sphere and a jitter, or four seeds. */
const fixedLane = (slots: number, seed: number, sphere: boolean) => {
  const random = seededRandom(seed);
  const values = new Float32Array(slots * 4);

  for (let slot = 0; slot < slots; slot += 1) {
    if (sphere) {
      const z = random() * 2 - 1;
      const angle = random() * Math.PI * 2;
      const ring = Math.sqrt(1 - z * z);
      values.set(
        [
          ring * Math.cos(angle),
          z,
          ring * Math.sin(angle),
          0.4 + random() * 0.6,
        ],
        slot * 4
      );
    } else {
      values.set([random(), random(), random(), random()], slot * 4);
    }
  }

  return instancedBufferAttribute<"vec4">(
    new InstancedBufferAttribute(values, 4),
    "vec4"
  );
};

/** A clock and a ring of slots, born in the far past so they never show. */
const createSlots = (slots: number, lanes: number) => {
  const all = Array.from({ length: lanes }, () => lane(slots));

  for (let slot = 0; slot < slots; slot += 1) {
    all[0]?.setW(slot, -1e6);
  }

  let next = 0;
  let dirty = false;

  return {
    all,
    commit: () => {
      if (!dirty) {
        return;
      }

      for (const each of all) {
        each.needsUpdate = true;
      }

      dirty = false;
    },
    /** The next slot to write; marks the lanes for upload. */
    take: () => {
      const slot = next;
      next = (next + 1) % slots;
      dirty = true;

      return slot;
    },
  };
};

const nodeOf = (attribute: InstancedBufferAttribute) =>
  instancedDynamicBufferAttribute<"vec4">(attribute, "vec4");

/**
 * A pool of wisps: additive (energy, fire) or laid over the scene (smoke).
 * Lanes: origin + birth; hot colour + size; main colour + grow; speed, life,
 * gravity, stretch; heading + spread.
 */
const createWisps = (
  look: SpellLook["wisps"],
  smoke: boolean,
  now: Node<"float">
) => {
  const { drag, slots } = look;
  const ring = createSlots(slots, 5);
  const [spawn, hot, main, motion, lean] = ring.all.map(nodeOf);
  const direction = fixedLane(slots, smoke ? 31 : 29, true);
  const seeds = fixedLane(slots, smoke ? 37 : 41, false);

  if (!spawn || !hot || !main || !motion || !lean) {
    throw new Error("The wisps have no lanes");
  }

  const age = now.sub(spawn.w).max(0);
  const life = age.div(motion.y).clamp(0, 1);
  const alive = step(life, float(0.999));
  const speed = motion.x.mul(direction.w);
  const heading = lean.xyz.add(direction.xyz.mul(lean.w));
  const towards = heading.div(length(heading).max(1e-4));

  const travel = float(1)
    .sub(exp(age.mul(-drag)))
    .div(drag);
  // A slow seeded swirl, so wisps curl as they drift instead of flying straight.

  const phase = seeds.x.mul(Math.PI * 2);

  const swirl = vec3(
    sin(age.mul(look.swirlRate).add(phase)),
    0,
    sin(age.mul(look.swirlRate).add(phase).add(1.57))
  ).mul(travel.mul(look.swirl));

  const material = new SpriteNodeMaterial({
    blending: smoke ? NormalBlending : AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });

  material.positionNode = spawn.xyz
    .add(towards.mul(speed).mul(travel))
    .add(vec3(0, age.mul(age).mul(motion.z.mul(-look.gravity)).mul(0.5), 0))
    .add(swirl);

  // Swells from its birth size toward `grow` times it, fastest at first.
  const swell = mix(float(1), main.w, float(1).sub(float(1).sub(life).pow(2)));
  const size = hot.w.mul(swell).mul(alive);
  material.scaleNode = vec2(size, size.mul(motion.w.add(1)));
  material.rotationNode = seeds.y
    .sub(0.5)
    .mul(motion.w.lessThan(0.01).select(6.28, 0.3));

  // Its shape: a soft blob whose edge noise eats into, the noise drifting
  // through it (upward through a flame), narrower toward a flame's tip.
  const centred = uv().sub(0.5).mul(2);
  const tall = motion.w.div(motion.w.add(1));

  const x = centred.x.mul(
    float(1).add(tall.mul(centred.y.mul(0.5).add(0.5)).mul(1.4))
  );

  // Two octaves of noise drifting through it, so its edge breaks into
  // tendrils rather than a round blob.
  const drift = vec3(
    x.mul(look.churnScale),
    centred.y.mul(look.churnScale).sub(age.mul(look.flow)),
    seeds.z.mul(37)
  );

  const churn = mx_noise_float(drift).add(
    mx_noise_float(drift.mul(2.3).add(5)).mul(0.5)
  );

  const reach = length(vec2(x, centred.y)).add(churn.mul(look.churn));
  const mask = smoothstep(1, 0.15, reach).pow(1.6);

  const fade = smoothstep(0, look.fadeIn, life).mul(
    float(1).sub(life).pow(1.4)
  );
  // Hottest at its dense heart and at birth, burning down to its main colour.

  const heat = smoothstep(0.6, 0, reach).mul(float(1).sub(life).pow(1.5));
  material.colorNode = vec4(mix(main.xyz, hot.xyz, heat), 1);
  // Smoke is laid over the scene, so it is only ever so opaque.
  material.opacityNode = mask
    .mul(fade)
    .mul(alive)
    .mul(smoke ? look.smokeOpacity : 1);

  const sprite = new Sprite(material);
  sprite.count = slots;
  sprite.frustumCulled = false;
  sprite.renderOrder = smoke ? 1 : 2;

  const [spawnLane, hotLane, mainLane, motionLane, leanLane] = ring.all;

  return {
    commit: ring.commit,
    emit: (
      origin: Point3,
      colors: { readonly hot: Color; readonly main: Color },
      style: WispStyle,
      birth: number
    ) => {
      const slot = ring.take();
      const toward = style.heading ?? { x: 0, y: 0, z: 0 };
      const glow = style.intensity;
      spawnLane?.setXYZW(slot, origin.x, origin.y, origin.z, birth);
      hotLane?.setXYZW(
        slot,
        colors.hot.r * glow,
        colors.hot.g * glow,
        colors.hot.b * glow,
        style.size
      );
      mainLane?.setXYZW(
        slot,
        colors.main.r * glow,
        colors.main.g * glow,
        colors.main.b * glow,
        style.grow
      );
      motionLane?.setXYZW(
        slot,
        style.speed,
        style.life,
        style.gravity ?? 0,
        style.stretch ?? 0
      );
      leanLane?.setXYZW(slot, toward.x, toward.y, toward.z, style.spread ?? 1);
    },
    sprite,
  };
};

/**
 * A pool of flares. Lanes: origin + birth; main colour + size; hot colour +
 * life.
 */
const createFlares = (look: SpellLook["flares"], now: Node<"float">) => {
  const { slots } = look;
  const ring = createSlots(slots, 3);
  const [spawn, main, hot] = ring.all.map(nodeOf);
  const seeds = fixedLane(slots, 43, false);

  if (!spawn || !main || !hot) {
    throw new Error("The flares have no lanes");
  }

  const age = now.sub(spawn.w).max(0);
  const life = age.div(hot.w).clamp(0, 1);
  const alive = step(life, float(0.999));

  const material = new SpriteNodeMaterial({
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });

  // The rays shoot out at once and keep reaching a little as they die.
  const shoot = float(1).sub(float(1).sub(life).pow(3));
  material.scaleNode = vec2(main.w, main.w)
    .mul(shoot.mul(0.45).add(0.55))
    .mul(alive);
  material.rotationNode = seeds.x.mul(6.28).add(age.mul(0.6));

  const centred = uv().sub(0.5).mul(2);
  const reach = length(centred);
  const angle = atan(centred.y, centred.x);
  const around = vec2(angle.cos(), angle.sin());

  // A fan of thin rays from angular noise (on the circle, so it has no
  // seam), long ones and fainter fine ones between them.
  const ray = (lobes: number, seed: Node<"float">) =>
    mx_noise_float(vec3(around.mul(lobes), seed))
      .mul(0.5)
      .add(0.5)
      .pow(look.sharpness);

  const rays = ray(look.rays, seeds.y.mul(91))
    .add(ray(look.rays * 2.3, seeds.z.mul(53)).mul(0.5))
    .mul(exp(reach.mul(-look.falloff)))
    .mul(smoothstep(1, 0.6, reach));

  const core = exp(reach.div(look.core).pow(2).negate());

  const bloom = exp(
    reach
      .div(look.core * 3)
      .pow(2)
      .negate()
  ).mul(0.4);

  const fade = float(1).sub(life).pow(2);

  material.colorNode = vec4(
    hot.xyz
      .mul(core)
      .add(main.xyz.mul(rays.mul(look.rayRadiance).add(bloom)))
      .mul(fade),
    1
  );
  material.opacityNode = alive;

  const sprite = new Sprite(material);
  sprite.count = slots;
  sprite.frustumCulled = false;
  sprite.renderOrder = 3;

  const [spawnLane, mainLane, hotLane] = ring.all;

  return {
    commit: ring.commit,
    emit: (
      origin: Point3,
      colors: { readonly hot: Color; readonly main: Color },
      style: FlareStyle,
      birth: number
    ) => {
      const slot = ring.take();
      const glow = style.intensity;
      spawnLane?.setXYZW(slot, origin.x, origin.y, origin.z, birth);
      mainLane?.setXYZW(
        slot,
        colors.main.r * glow,
        colors.main.g * glow,
        colors.main.b * glow,
        style.size
      );
      hotLane?.setXYZW(
        slot,
        colors.hot.r * glow,
        colors.hot.g * glow,
        colors.hot.b * glow,
        style.life
      );
    },
    sprite,
  };
};

/** One arc's state, read by the shared material as it is drawn. */
interface ArcState {
  seed: number;
  strength: number;
  readonly hot: Color;
  readonly main: Color;
}

/** The joints arcs jump between, as index pairs into a body's joints (see `BODY_JOINTS`). */
const ARC_EDGES: readonly (readonly [number, number])[] = [
  [2, 5],
  [2, 6],
  [5, 7],
  [6, 8],
  [7, 9],
  [8, 10],
  [2, 7],
  [2, 8],
  [1, 2],
  [0, 1],
  [2, 3],
  [3, 4],
  [5, 6],
  [4, 11],
  [4, 12],
];

/**
 * The body's joints arcs jump between, in the order a Duelist view lists
 * them: head, neck, chest, waist, pelvis, both shoulders, both elbows, both
 * hands, both hips.
 */
export const BODY_JOINTS = 13;

/** A pool of electric arcs crawling over hit bodies. */
const createArcs = (
  look: SpellLook["arcs"],
  now: Node<"float">,
  parent: Object3D
) => {
  const states = new WeakMap<Object3D, ArcState>();

  const read = <T>(object: Object3D | null, pick: (state: ArcState) => T) => {
    const state = object ? states.get(object) : undefined;

    return state ? pick(state) : undefined;
  };

  const seed = uniform(0).onObjectUpdate(({ object }) =>
    read(object, (state) => state.seed)
  );

  const strength = uniform(0).onObjectUpdate(({ object }) =>
    read(object, (state) => state.strength)
  );

  const hotColor = uniform(new Color()).onObjectUpdate(({ object }) =>
    read(object, (state) => state.hot)
  );

  const mainColor = uniform(new Color()).onObjectUpdate(({ object }) =>
    read(object, (state) => state.main)
  );

  // Re-rolled every hop: the arc jumps to a new path.
  const hop = floor(now.div(look.hop));
  const path = seed.add(hop.mul(7.13));
  const along = uv().x;
  const across = uv().y.mul(2).sub(1);
  const pinned = sin(along.mul(Math.PI));

  const wander = (scale: number, offset: number) =>
    mx_noise_float(vec3(along.mul(look.jag * scale), path, offset));

  const offset = wander(1, 0)
    .add(wander(2.7, 3).mul(0.45))
    .mul(look.amplitude)
    .mul(pinned);

  const fork = offset
    .add(
      wander(1.6, 9)
        .mul(look.amplitude)
        .mul(smoothstep(0.4, 1, along))
    )
    .toVar();

  const thin = look.thickness / (look.width / 2);

  const line = (centre: Node<"float">, width: number) =>
    exp(across.sub(centre).div(width).pow(2).negate());

  const branchSpan = smoothstep(0.35, 0.5, along).mul(
    smoothstep(0.95, 0.7, along)
  );
  // Some hops it is dark: it flickers.

  const lit = step(
    look.dark,
    mx_noise_float(vec3(path.mul(1.7), 1, 1))
      .mul(0.5)
      .add(0.5)
  );

  const ends = smoothstep(0, 0.06, along).mul(smoothstep(1, 0.94, along));

  const material = new MeshBasicNodeMaterial({
    blending: AdditiveBlending,
    depthWrite: false,
    forceSinglePass: true,
    side: DoubleSide,
    transparent: true,
  });

  material.colorNode = hotColor
    .mul(line(offset, thin))
    .add(mainColor.mul(line(offset, thin * 4).mul(0.6)))
    .add(mainColor.mul(line(fork, thin * 0.8).mul(branchSpan)))
    .mul(strength.mul(look.intensity).mul(lit).mul(ends));

  const geometry = new PlaneGeometry(1, 1, 24, 1);

  const meshes = Array.from({ length: look.pool }, () => {
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = 3;
    states.set(mesh, {
      hot: new Color(),
      main: new Color(),
      seed: 0,
      strength: 0,
    });
    parent.add(mesh);

    return mesh;
  });

  return { meshes, states };
};

/** Where an arc is crawling: on whom, which edge, until when. */
interface Crawl {
  readonly mesh: Mesh;
  bodyId: string;
  edge: readonly [number, number];
  left: number;
  life: number;
  hopLeft: number;
}

export interface ImpactVfx {
  readonly object: Object3D;
  /** A flare of rays at `at`. */
  readonly flare: (
    at: Point3,
    colors: { readonly hot: Color; readonly main: Color },
    style: FlareStyle
  ) => void;
  /** A wisp of energy or fire (`smoke` lays it over the scene instead). */
  readonly wisp: (
    at: Point3,
    colors: { readonly hot: Color; readonly main: Color },
    style: WispStyle,
    smoke?: boolean
  ) => void;
  /** Starts `count` arcs crawling over `bodyId` for `life` seconds. */
  readonly arcs: (
    bodyId: string,
    colors: { readonly hot: Color; readonly main: Color },
    count: number,
    life: number
  ) => void;
  /**
   * Ages everything by `seconds` and lays the arcs on their bodies' joints
   * (`bodyOf` lists them, see `BODY_JOINTS`), facing `eye`.
   */
  readonly update: (
    seconds: number,
    eye: Vector3,
    bodyOf: (id: string) => readonly Point3[] | undefined
  ) => void;
}

export const createImpactVfx = (look: SpellLook): ImpactVfx => {
  const object = new Group();
  const now = uniform(0);
  const random = seededRandom(53);
  const glow = createWisps(look.wisps, false, now);
  const smoke = createWisps(look.wisps, true, now);
  const flares = createFlares(look.flares, now);
  const { meshes, states } = createArcs(look.arcs, now, object);
  object.add(smoke.sprite, glow.sprite, flares.sprite);

  const crawls: Crawl[] = meshes.map((mesh) => ({
    bodyId: "",
    edge: [0, 0] as const,
    hopLeft: 0,
    left: 0,
    life: 1,
    mesh,
  }));

  const pickEdge = () =>
    ARC_EDGES[Math.floor(random() * ARC_EDGES.length)] ?? ([2, 5] as const);

  const tail = new Vector3();
  const head = new Vector3();
  const lift = new Vector3();

  /** A joint, lifted toward the camera off the body's surface. */
  const lifted = (point: Point3, eye: Vector3, out: Vector3) => {
    out.set(point.x, point.y, point.z);
    lift.copy(eye).sub(out).normalize().multiplyScalar(look.arcs.lift);

    return out.add(lift);
  };

  return {
    arcs: (bodyId, colors, count, life) => {
      // The arcs that are free, or else the ones nearest their end.
      const free = crawls.toSorted((a, b) => a.left - b.left).slice(0, count);

      for (const crawl of free) {
        crawl.bodyId = bodyId;
        crawl.left = life * (0.7 + random() * 0.3);
        crawl.life = crawl.left;
        crawl.hopLeft = 0;
        const state = states.get(crawl.mesh);
        state?.hot.copy(colors.hot);
        state?.main.copy(colors.main);
      }
    },
    flare: (at, colors, style) => {
      flares.emit(at, colors, style, now.value);
    },
    object,
    update: (seconds, eye, bodyOf) => {
      now.value += seconds;

      for (const crawl of crawls) {
        crawl.left -= seconds;
        crawl.hopLeft -= seconds;
        const joints = crawl.left > 0 ? bodyOf(crawl.bodyId) : undefined;
        crawl.mesh.visible = joints !== undefined;

        if (!joints) {
          continue;
        }

        if (crawl.hopLeft <= 0) {
          crawl.edge = pickEdge();
          crawl.hopLeft = look.arcs.hop;
          const state = states.get(crawl.mesh);

          if (state) {
            state.seed = random() * 100;
          }
        }

        const from = joints[crawl.edge[0]];
        const to = joints[crawl.edge[1]];

        if (!from || !to) {
          crawl.mesh.visible = false;
          continue;
        }

        layRibbon(
          crawl.mesh,
          lifted(from, eye, tail),
          lifted(to, eye, head),
          look.arcs.width,
          eye
        );

        const state = states.get(crawl.mesh);

        if (state) {
          // Bright at once, dying away over its life.
          state.strength = (crawl.left / crawl.life) ** 0.7;
        }
      }

      glow.commit();
      smoke.commit();
      flares.commit();
    },
    wisp: (at, colors, style, isSmoke = false) => {
      (isSmoke ? smoke : glow).emit(at, colors, style, now.value);
    },
  };
};
