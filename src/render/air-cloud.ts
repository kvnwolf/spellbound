/**
 * The air cloud: soft, shapeless puffs of air and dust, and the air bending
 * what is behind them, for Depulso's blast and the Duelists it catches.
 *
 * Two pools of stable slots, each one instanced sprite draw (like the spark
 * ring): spawning a puff writes its origin, birth, launch velocity, growth,
 * life and look into its slot once; where it is, how big and how faded are
 * then pure functions of its age, evaluated in TSL from the pool's clock, so
 * the CPU never touches a live puff again. A puff may be born in the near
 * future (its slot stays invisible until then), so a burst can wait for the
 * blast to reach it.
 *
 * - A puff is launched hard and stalls in the still air (exponential drag),
 *   swelling as it slows, wandering on curl noise and, for dust, rising.
 * - Dust puffs are noise-shaped: billows warped by the baked swirl, eroded
 *   from the thin edges in as they age so they come apart into wisps rather
 *   than just fading; shaded as soft balls by a key light from above and an
 *   ambient fill (alpha blended, not light: dust is not glowing).
 * - Bend puffs draw nothing of their own: they redraw the scene behind them
 *   shifted along the swirl, so the air ripples and bends it.
 *
 * Both fade out near the floor, so a puff sitting on it never shows the
 * straight line where its sprite cuts through.
 */
import {
  atan,
  cameraViewMatrix,
  cameraWorldMatrix,
  cos,
  exp,
  float,
  instancedDynamicBufferAttribute,
  length,
  max,
  modelViewMatrix,
  positionView,
  screenUV,
  sin,
  smoothstep,
  sqrt,
  step,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
  viewportSharedTexture,
} from "three/tsl";
import type { DataTexture, Node } from "three/webgpu";
import {
  Color,
  InstancedBufferAttribute,
  NormalBlending,
  Sprite,
  SpriteNodeMaterial,
  Vector3,
} from "three/webgpu";

import type { Point3 } from "../duel/geometry";
import type { Tuning } from "../tuning";
import { curlNoise } from "./air-field";

/** One puff: where it starts, how it flies, grows, lives and looks. */
export interface Puff {
  readonly origin: Point3;
  /** Launch velocity, metres per second; drag stalls it. */
  readonly velocity: Point3;
  /** Seconds the drag takes to slow it by e: small stalls fast. */
  readonly drag: number;
  /** Diameter at birth and at the end of its life, metres. */
  readonly size: readonly [number, number];
  readonly life: number;
  /** Seconds from now until it appears (0 at once). */
  readonly delay?: number;
  /** Dust: its colour; bend: ignored. */
  readonly tint?: Color;
  /** Dust: peak opacity; bend: how far it bends, metres on screen per metre away. */
  readonly strength: number;
  /** Metres per second it rises (dust lifting on its own eddies). */
  readonly rise?: number;
  /** Metres it wanders on the curl noise over its life. */
  readonly wander?: number;
  /** How much wider than tall it is drawn (dust hugging the floor is flat). */
  readonly aspect?: number;
}

export interface PuffPool {
  readonly sprite: Sprite;
  readonly emit: (puff: Puff) => void;
  /** Ages every puff by `seconds`, then uploads what was written. */
  readonly advance: (seconds: number) => void;
}

type CloudLook = Tuning["depulsoLook"]["cloud"];

/** Rotates `point` by `angle` radians. */
const turn = (point: Node<"vec2">, angle: Node<"float">) => {
  const c = cos(angle);
  const s = sin(angle);

  return vec2(
    point.x.mul(c).sub(point.y.mul(s)),
    point.x.mul(s).add(point.y.mul(c))
  );
};

/** A lane of per-puff data as a TSL node. */
const node = (attribute: InstancedBufferAttribute) =>
  instancedDynamicBufferAttribute<"vec4">(attribute, "vec4");

const createLanes = (slots: number) => {
  const lane = () =>
    new InstancedBufferAttribute(new Float32Array(slots * 4), 4);

  // origin xyz + birth; velocity xyz + drag; size from, size to, life,
  // seed; tint rgb + strength; rise, wander.
  const lanes = {
    drift: lane(),
    flight: lane(),
    growth: lane(),
    look: lane(),
    spawn: lane(),
  };

  // Unborn slots: born in the far past with a tiny life, so they never show.
  for (let slot = 0; slot < slots; slot += 1) {
    lanes.spawn.setW(slot, -1e6);
    lanes.flight.setW(slot, 1);
    lanes.growth.setZ(slot, 1e-3);
    lanes.drift.setZ(slot, 1);
  }

  return lanes;
};

/** A pool of puffs drawn by `material`, which `shade` dresses from the shared motion. */
const createPool = (
  slots: number,
  look: CloudLook,
  /** Seconds of motion a puff is stretched over on screen (0: never). */
  streak: number,
  shade: (
    material: SpriteNodeMaterial,
    state: {
      readonly age: Node<"float">;
      readonly life: Node<"float">;
      readonly seed: Node<"float">;
      readonly size: Node<"float">;
      readonly look: Node<"vec4">;
      /** How far the sprite is turned on screen (to lie along its motion), radians. */
      readonly angle: Node<"float">;
    }
  ) => void
): PuffPool => {
  const lanes = createLanes(slots);
  const now = uniform(0);

  const spawn = node(lanes.spawn);
  const flight = node(lanes.flight);
  const growth = node(lanes.growth);
  const lookLane = node(lanes.look);
  const drift = node(lanes.drift);

  const rawAge = now.sub(spawn.w);
  const age = max(rawAge, 0);
  const life = age.div(growth.z);
  // Born (not waiting on a delay) and not yet spent.
  const alive = step(0, rawAge).mul(step(life, float(0.999)));

  // Launched hard, stalled by drag: travel is v * τ * (1 - e^(-t/τ)).
  const stall = float(1)
    .sub(exp(age.div(flight.w).negate()))
    .mul(flight.w);

  const wanderAt = spawn.xyz
    .mul(look.curl.scale)
    .add(vec3(growth.w.mul(13.7), age.mul(look.curl.evolve), growth.w));

  const material = new SpriteNodeMaterial({
    blending: NormalBlending,
    depthWrite: false,
    transparent: true,
  });

  material.positionNode = spawn.xyz
    .add(flight.xyz.mul(stall))
    .add(vec3(0, drift.x.mul(age), 0))
    .add(curlNoise(wanderAt).mul(drift.y.mul(life)));

  // Swells fast while the blast pushes it, then slowly as it drifts.
  const grown = float(1).sub(float(1).sub(life).pow(2.5));
  const size = growth.x.add(growth.y.sub(growth.x).mul(grown)).mul(alive);

  // Stretched along its motion on screen while the blast drives it, so the
  // gust reads as rushing air, relaxing into a round billow as it stalls.
  const velocity = flight.xyz
    .mul(exp(age.div(flight.w).negate()))
    .add(vec3(0, drift.x, 0));

  const onScreen = modelViewMatrix.mul(vec4(velocity, 0)).xy;

  const angle = streak > 0 ? atan(onScreen.y, onScreen.x.add(1e-5)) : float(0);

  if (streak > 0) {
    material.rotationNode = angle;
  }

  material.scaleNode = vec2(
    size.mul(drift.z).add(length(onScreen).mul(streak).mul(alive)),
    size
  );

  shade(material, { age, angle, life, look: lookLane, seed: growth.w, size });

  const sprite = new Sprite(material);
  sprite.count = slots;
  // Puffs are placed in the shader, so the CPU cannot know their bounds.
  sprite.frustumCulled = false;

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
    emit: (puff) => {
      const birth = now.value + (puff.delay ?? 0);
      const { tint } = puff;
      lanes.spawn.setXYZW(
        next,
        puff.origin.x,
        puff.origin.y,
        puff.origin.z,
        birth
      );
      lanes.flight.setXYZW(
        next,
        puff.velocity.x,
        puff.velocity.y,
        puff.velocity.z,
        Math.max(puff.drag, 1e-3)
      );
      lanes.growth.setXYZW(
        next,
        puff.size[0],
        puff.size[1],
        Math.max(puff.life, 1e-3),
        ((next * 0.618034) % 1) * 97 + 3
      );
      lanes.look.setXYZW(
        next,
        tint?.r ?? 1,
        tint?.g ?? 1,
        tint?.b ?? 1,
        puff.strength
      );
      lanes.drift.setXYZW(
        next,
        puff.rise ?? 0,
        puff.wander ?? 0,
        puff.aspect ?? 1,
        0
      );
      next = (next + 1) % slots;
      dirty = true;
    },
    sprite,
  };
};

/** A hex colour as a TSL constant. */
const colourOf = (hex: string) => {
  const colour = new Color(hex);

  return vec3(colour.r, colour.g, colour.b);
};

/** How high above the floor a fragment of a puff is, metres. */
const heightAboveFloor = () => cameraWorldMatrix.mul(vec4(positionView, 1)).y;

/**
 * Dust and air puffs: noise-shaped, eroding, shaded by `look.light`.
 * `field` is the baked air field (see `air-field.ts`).
 */
export const createDustPool = (
  slots: number,
  look: CloudLook,
  field: DataTexture
): PuffPool =>
  createPool(
    slots,
    look,
    look.streak,
    (material, { age, angle, life, look: tint, seed }) => {
      const from = uv().mul(2).sub(1);
      // The pattern turns slowly; the sprite itself never does, so the light
      // stays on its top.
      const spun = turn(from, seed.add(age.mul(look.spin)));
      const offset = vec2(seed.mul(0.137), seed.mul(0.291));

      // The swirl curls the billows, more as the puff ages and tears apart.
      const swirl = texture(field, spun.mul(look.swirl.scale).add(offset))
        .yz.mul(2)
        .sub(1);

      const warped = spun.add(
        swirl.mul(life.mul(look.swirl.growth).add(look.swirl.warp))
      );

      const billow = texture(field, warped.mul(look.billowScale).add(offset)).x;

      const wisp = texture(
        field,
        warped
          .mul(look.wispScale)
          .add(offset.yx)
          .add(vec2(0, age.mul(0.15)))
      ).w;

      const round = smoothstep(1, look.roundness, from.length());
      const density = billow.mul(0.65).add(wisp.mul(0.35)).mul(round);

      // Eroded from the thin edges in: a rising threshold.
      const threshold = float(look.erosion.from).add(
        life.mul(look.erosion.to - look.erosion.from)
      );

      const body = smoothstep(
        threshold,
        threshold.add(look.erosion.soft),
        density
      );

      const fadeIn = smoothstep(0, look.fadeIn, age);
      const fadeOut = float(1).sub(life).pow(look.fadeOut);
      const floor = smoothstep(0, look.floorFade, heightAboveFloor());

      // A soft ball facing the camera, lit from above and filled all round.
      const facing = sqrt(max(float(1).sub(from.dot(from)), 0));
      const normal = vec3(from.x, from.y, facing).normalize();

      const lightDir = vec3(
        look.light.from.x,
        look.light.from.y,
        look.light.from.z
      ).normalize();

      const lightView = cameraViewMatrix.mul(vec4(lightDir, 0)).xyz.normalize();
      // Into the sprite's own frame, which turns with its motion.
      const toLight = vec3(turn(lightView.xy, angle.negate()), lightView.z);
      const wrap = normal.dot(toLight).mul(0.5).add(0.5);
      const key = colourOf(look.light.key).mul(look.light.keyStrength);
      const fill = colourOf(look.light.fill).mul(look.light.fillStrength);
      // Thick parts shade themselves a little.
      const shadow = float(1).sub(density.mul(look.selfShadow));

      material.colorNode = vec4(
        tint.xyz.mul(key.mul(wrap).add(fill)).mul(shadow),
        1
      );

      material.opacityNode = body
        .mul(tint.w)
        .mul(fadeIn)
        .mul(fadeOut)
        .mul(floor)
        .clamp(0, 1);
    }
  );

/** Bend puffs: the scene behind them redrawn shifted along the swirl. */
export const createBendPool = (
  slots: number,
  look: CloudLook,
  field: DataTexture
): PuffPool =>
  createPool(
    slots,
    look,
    0,
    (material, { age, life, look: bend, seed, size }) => {
      const from = uv().mul(2).sub(1);
      const offset = vec2(seed.mul(0.173), seed.mul(0.311));
      const flow = vec2(age.mul(look.bend.flow), age.mul(look.bend.flow * 0.6));

      const swirl = texture(
        field,
        from.mul(look.bend.scale).add(offset).add(flow)
      )
        .yz.mul(2)
        .sub(1);

      const round = smoothstep(1, 0.2, from.length());

      // Strong as it is born, easing off as it spreads.
      const fade = smoothstep(0, look.fadeIn, age).mul(
        float(1).sub(life).pow(2)
      );

      const floor = smoothstep(0, look.floorFade, heightAboveFloor());
      // Metres on screen to screen UV: farther air bends a smaller patch.
      const distance = max(positionView.z.negate(), 0.5);

      const shift = swirl
        .mul(bend.w)
        .mul(size)
        .div(distance)
        .mul(round)
        .mul(fade);

      material.colorNode = vec4(
        viewportSharedTexture(screenUV.add(shift)).rgb,
        1
      );
      material.opacityNode = round.mul(fade).mul(floor).clamp(0, 1);
    }
  );

/** A unit vector `yaw` radians round and `pitch` radians up from `axis` on the floor. */
export const coneDirection = (
  axis: { readonly x: number; readonly z: number },
  yaw: number,
  pitch: number
): Vector3 => {
  const cosine = Math.cos(yaw);
  const sine = Math.sin(yaw);
  const x = axis.x * cosine - axis.z * sine;
  const z = axis.x * sine + axis.z * cosine;

  return new Vector3(x * Math.cos(pitch), Math.sin(pitch), z * Math.cos(pitch));
};
