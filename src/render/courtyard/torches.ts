/**
 * Torches: stone stands with iron braziers, each holding a flickering warm
 * point light, a procedural flame and a stream of rising embers.
 *
 * Flames and embers are single instanced sprite draws whose motion is a pure
 * function of time and a per-instance seed, evaluated on the GPU (no per-frame
 * CPU work and no state). They are additive HDR and skip fog, so they glow
 * through bloom without dragging the fog colour into the air around them.
 * The lights flicker on the CPU, from the same clock, right before the
 * flames draw.
 */
import {
  color,
  float,
  hash,
  instanceIndex,
  mix,
  mx_noise_float,
  smoothstep,
  time,
  uniformArray,
  uv,
  varying,
  vec2,
  vec3,
} from "three/tsl";
import {
  AdditiveBlending,
  BoxGeometry,
  CircleGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardNodeMaterial,
  PointLight,
  Sprite,
  SpriteNodeMaterial,
  Vector2,
  Vector3,
} from "three/webgpu";

import type { Tuning } from "../../tuning";
import { iron } from "./materials";

type TorchSettings = Tuning["courtyard"]["torch"];

const standHeight = 2;
const standWidth = 0.7;
const capHeight = 0.15;

/** Height of the coals in the brazier, where the flame starts. */
const flameBase = standHeight + capHeight + 0.2;

/**
 * The light floats in the upper flame, nudged toward the Arena: right over the
 * stand it would burn the capstone white and light the wall more than the floor.
 */
const lightLift = 0.75;
const lightInset = 0.6;

/** Flame layers per torch: a wide outer flame and a hot inner core. */
const flameLayers = 2;

const createBrazier = (): Mesh => {
  // A shallow iron bowl, outer wall then inner wall, turned on a lathe.
  const profile = [
    [0.05, 0],
    [0.14, 0.02],
    [0.24, 0.08],
    [0.33, 0.2],
    [0.36, 0.28],
    [0.32, 0.28],
    [0.27, 0.2],
    [0.01, 0.16],
  ].map(([x = 0, y = 0]) => new Vector2(x, y));

  const bowl = new Mesh(new LatheGeometry(profile, 24), iron);

  bowl.castShadow = true;

  return bowl;
};

/** Glowing coals in the bowl: dim emissive embers under the flame. */
const createCoalsMaterial = (): MeshStandardNodeMaterial => {
  const material = new MeshStandardNodeMaterial({
    color: "#120806",
    roughness: 0.9,
  });

  const pulse = mx_noise_float(vec3(uv().mul(9), time.mul(0.8)))
    .mul(0.5)
    .add(0.5);

  material.emissiveNode = color("#ff4a12").mul(pulse.mul(pulse).mul(3.5));

  return material;
};

const createFlames = (
  bases: readonly Vector3[],
  settings: TorchSettings
): Sprite => {
  const positions = uniformArray(
    bases.map((base) => base.clone()),
    "vec3" as const
  );

  const torch = instanceIndex.div(flameLayers);
  const layer = instanceIndex.mod(flameLayers);
  const isCore = layer.equal(1);

  const material = new SpriteNodeMaterial({
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });

  material.fog = false;
  material.positionNode = positions.element(torch);
  // The core is narrower and shorter than the outer flame.
  material.scaleNode = isCore.select(vec2(0.42, 0.75), vec2(0.8, 1.3));

  const seed = varying(hash(torch).mul(10));
  const core = varying(isCore.select(float(1), float(0)));
  const x = uv().x.sub(0.5).mul(2);
  const { y } = uv();

  // Two noise octaves scrolling upward bend the flame, more toward its tip.
  const slow = mx_noise_float(
    vec3(x.mul(1.6), y.mul(2.4).sub(time.mul(3.1)), seed)
  );

  const fast = mx_noise_float(
    vec3(x.mul(3.8), y.mul(5).sub(time.mul(5.7)), seed.add(3))
  );

  const bent = x.add(slow.mul(0.32).add(fast.mul(0.12)).mul(y));

  // Teardrop profile: round at the base, tapering to the tip.
  const halfWidth = y
    .mul(5)
    .clamp(0, 1)
    .sqrt()
    .mul(y.oneMinus().pow(0.85))
    .mul(0.92)
    .add(0.0001);

  const body = smoothstep(halfWidth, halfWidth.mul(0.25), bent.abs());
  const tip = smoothstep(1, 0.5, y.add(fast.mul(0.18)));
  const heat = body.mul(tip).mul(y.oneMinus().pow(0.5));

  const ramp = mix(
    mix(color("#d8260a"), color("#ff8a22"), smoothstep(0.05, 0.4, heat)),
    color("#fff1b8"),
    smoothstep(0.6, 1.05, heat.add(core.mul(0.2)))
  );

  material.colorNode = ramp
    .mul(heat)
    .mul(core.mul(0.6).add(1))
    .mul(settings.flameRadiance);
  material.opacityNode = float(1);

  const flames = new Sprite(material);

  flames.count = bases.length * flameLayers;
  flames.center.set(0.5, 0.05);
  // The sprites move in the shader, so the CPU bounds are meaningless.
  flames.frustumCulled = false;

  return flames;
};

const createEmbers = (
  bases: readonly Vector3[],
  settings: TorchSettings
): Sprite => {
  const positions = uniformArray(
    bases.map((base) => base.clone()),
    "vec3" as const
  );

  const perTorch = settings.embersPerTorch;
  const torch = instanceIndex.div(perTorch);
  const seed = hash(instanceIndex);
  const spread = hash(instanceIndex.add(7919));
  const speed = hash(instanceIndex.add(15_401)).mul(0.6).add(0.7);
  // Each ember loops through its life, offset by its seed: age 0 at the coals, 1 gone.
  const age = time.div(settings.emberLifetime).mul(speed).add(seed).fract();
  const angle = seed.mul(Math.PI * 2);
  const wobble = time.mul(spread.mul(2).add(1.2)).add(seed.mul(40));

  const offset = vec3(
    angle.cos().mul(spread.mul(0.18)).add(wobble.sin().mul(0.22).mul(age)),
    age.mul(settings.emberRise).mul(spread.mul(0.6).add(0.7)),
    angle.sin().mul(spread.mul(0.18)).add(wobble.cos().mul(0.22).mul(age))
  );

  const material = new SpriteNodeMaterial({
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });

  material.fog = false;
  material.positionNode = positions.element(torch).add(offset);
  material.scaleNode = vec2(
    age.oneMinus().sqrt().mul(spread.mul(0.05).add(0.04))
  );

  const life = varying(age);

  const sparkle = varying(
    time.mul(spread.mul(14).add(8)).add(seed.mul(60)).sin().mul(0.35).add(0.65)
  );

  const dot = smoothstep(0.5, 0, uv().sub(0.5).length());

  const fade = life
    .oneMinus()
    .pow(1.6)
    .mul(smoothstep(0, 0.06, life));

  material.colorNode = mix(color("#ffc070"), color("#ff3c0c"), life)
    .mul(dot.mul(dot))
    .mul(fade)
    .mul(sparkle)
    .mul(settings.emberRadiance);
  material.opacityNode = float(1);

  const embers = new Sprite(material);

  embers.count = bases.length * perTorch;
  embers.frustumCulled = false;

  return embers;
};

/**
 * A flicker value around 1 for torch `seed` at `seconds`: three
 * incommensurate sine waves, so no two torches pulse together and the
 * pattern never visibly repeats.
 */
const flicker = (seconds: number, seed: number, depth: number): number => {
  const wave =
    0.5 * Math.sin(seconds * 9.3 + seed) +
    0.3 * Math.sin(seconds * 15.7 + seed * 2.1) +
    0.2 * Math.sin(seconds * 31.1 + seed * 3.7);

  return 1 + depth * wave;
};

/**
 * Builds a torch stand at every ground point in `spots` (each stand is centred
 * there), sharing `stone` with the walls they stand in.
 */
export const createTorches = (
  spots: readonly Vector3[],
  stone: MeshStandardNodeMaterial,
  settings: TorchSettings
): Group => {
  const group = new Group();
  const standGeometry = new BoxGeometry(standWidth, standHeight, standWidth);

  const capGeometry = new BoxGeometry(
    standWidth + 0.16,
    capHeight,
    standWidth + 0.16
  );

  const coalsGeometry = new CircleGeometry(0.27, 20);
  const coals = createCoalsMaterial();
  const lights: { light: PointLight; seed: number }[] = [];
  const bases: Vector3[] = [];

  for (const [index, spot] of spots.entries()) {
    const stand = new Mesh(standGeometry, stone);
    const cap = new Mesh(capGeometry, stone);
    const brazier = createBrazier();
    const coalBed = new Mesh(coalsGeometry, coals);

    stand.position.set(spot.x, standHeight / 2, spot.z);
    cap.position.set(spot.x, standHeight + capHeight / 2, spot.z);
    brazier.position.set(spot.x, standHeight + capHeight, spot.z);
    coalBed.position.set(spot.x, flameBase - 0.02, spot.z);
    coalBed.rotation.x = -Math.PI / 2;

    for (const mesh of [stand, cap]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }

    const light = new PointLight(
      settings.lightColor,
      settings.intensity,
      settings.range,
      2
    );

    const inward = new Vector3(-spot.x, 0, -spot.z).setLength(lightInset);

    light.position.set(
      spot.x + inward.x,
      flameBase + lightLift,
      spot.z + inward.z
    );
    lights.push({ light, seed: index * 12.9898 });
    bases.push(new Vector3(spot.x, flameBase, spot.z));
    group.add(stand, cap, brazier, coalBed, light);
  }

  const flames = createFlames(bases, settings);

  // Flicker the lights right before the flames draw, once per frame.
  flames.onBeforeRender = () => {
    const seconds = performance.now() / 1000;

    for (const { light, seed } of lights) {
      light.intensity =
        settings.intensity * flicker(seconds, seed, settings.flicker);
    }
  };

  group.add(flames, createEmbers(bases, settings));

  return group;
};
