/**
 * Clash VFX: the beam of fire joining two Wands locked in a Clash, and its
 * meeting point. Views only: it reads the Clash from snapshots and reacts to
 * simulation events. The bursts at the start, on every pump and at the end
 * are the Spell VFX's (see `spell-vfx.ts`); this draws what lasts.
 *
 * - Each Duelist's half of the beam runs from their Wand tip to the meeting
 *   point: a white-hot core inside a sheath whose bands of fire flow toward
 *   the meeting point, inside a faint haze. All of it flickers.
 * - The meeting point is a pulsing white-hot ball in a big glow and corona,
 *   swelling on every pump, spraying sparks out sideways and lighting the
 *   courtyard with one point light that only shines during a Clash.
 *
 * Colours are scene-linear HDR above 1, so they feed bloom.
 */
import {
  float,
  length,
  positionGeometry,
  sin,
  smoothstep,
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
  Mesh,
  MeshBasicNodeMaterial,
  PointLight,
  Quaternion,
  SphereGeometry,
  Sprite,
  SpriteNodeMaterial,
  Vector3,
} from "three/webgpu";

import type { ClashState, DuelEvent, DuelistId } from "../duel/duel";
import type { Point3 } from "../duel/geometry";

export interface ClashVfx {
  readonly object: Group;
  /** Swells the meeting point on every pump this frame. */
  readonly handle: (events: readonly DuelEvent[]) => void;
  /**
   * Draws the Clash between two snapshots (nothing when there is none), its
   * beam starting at each Wand tip as drawn (`visibleTip`, falling back to
   * the simulation's), and ages the effects by `seconds` of real time.
   */
  readonly update: (
    previous: ClashState | null,
    current: ClashState | null,
    alpha: number,
    seconds: number,
    visibleTip: (id: DuelistId) => Point3 | undefined
  ) => void;
}

/** Confringo's fire: a deep orange round a pale gold heart. */
const main = new Color("#ff6a12");
const hot = new Color("#ffe2a0");

const look = {
  beam: {
    /** Bands of fire per metre along the beam, and how fast they flow (radians per second). */
    bands: 5,
    /** Radii of the core, the flowing sheath and the haze, metres. */
    core: 0.045,
    flow: 38,
    haze: 0.32,
    sheath: 0.13,
  },
  point: {
    /** The ball's radius, metres, and how much it pulses. */
    core: 0.2,
    corona: 3.2,
    glow: 1.6,
    /** How much a pump swells the meeting point, fading at `kickFade` per second. */
    kick: 0.6,
    kickFade: 7,
    light: { distance: 11, intensity: 40 },
    pulse: 0.18,
  },
  sparks: {
    count: 48,
    gravity: 7,
    life: { max: 0.5, min: 0.2 },
    size: 0.09,
    speed: { max: 7.5, min: 3 },
  },
};

/** A small deterministic random source, so the spray never needs `Math.random`. */
const seededRandom = (seed: number) => {
  let state = seed;

  return () => {
    state = (state * 16_807) % 2_147_483_647;

    return (state - 1) / 2_147_483_646;
  };
};

const lerp = (from: number, to: number, share: number) =>
  from + (to - from) * share;

/** The effects clock, in seconds, that drives the flow and flicker. */
const createClock = () => uniform(0);

/** The core, flowing sheath and haze of one Duelist's half of the beam. */
const createHalf = (clock: ReturnType<typeof createClock>) => {
  const group = new Group();
  // Metres of this half, so the bands keep their spacing as it stretches.
  const span = uniform(1);

  // A tube from y = 0 (the Wand) to y = 1 (the meeting point).
  const tube = new CylinderGeometry(1, 1, 1, 16, 1, true);
  tube.translate(0, 0.5, 0);

  const core = new MeshBasicNodeMaterial();
  core.colorNode = vec3(hot.r, hot.g, hot.b).mul(9);

  const sheath = new MeshBasicNodeMaterial({
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });

  const along = positionGeometry.y;

  const bands = sin(
    along.mul(span).mul(look.beam.bands).sub(clock.mul(look.beam.flow))
  )
    .mul(0.5)
    .add(0.5);

  sheath.colorNode = vec3(main.r, main.g, main.b)
    .mul(3.2)
    .add(vec3(hot.r, hot.g, hot.b).mul(bands));
  // Banded, and brightest toward the meeting point.
  sheath.opacityNode = float(0.35)
    .add(bands.mul(0.45))
    .mul(smoothstep(0, 0.15, along).mul(0.6).add(along.mul(0.4)));

  const haze = new MeshBasicNodeMaterial({
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });

  haze.colorNode = vec3(main.r, main.g, main.b).mul(1.4);
  haze.opacityNode = float(0.16).add(bands.mul(0.08));

  const coreMesh = new Mesh(tube, core);
  const sheathMesh = new Mesh(tube, sheath);
  const hazeMesh = new Mesh(tube, haze);
  group.add(coreMesh, sheathMesh, hazeMesh);

  const up = new Vector3(0, 1, 0);
  const heading = new Vector3();
  const turn = new Quaternion();

  return {
    group,
    /** Stretches this half from `from` to `to`, its width flickering by `flicker`. */
    place: (from: Point3, to: Point3, flicker: number) => {
      heading.set(to.x - from.x, to.y - from.y, to.z - from.z);
      const metres = Math.max(heading.length(), 1e-3);
      heading.divideScalar(metres);
      turn.setFromUnitVectors(up, heading);
      group.position.set(from.x, from.y, from.z);
      group.quaternion.copy(turn);
      span.value = metres;

      const width = (radius: number) => radius * flicker;
      coreMesh.scale.set(width(look.beam.core), metres, width(look.beam.core));
      sheathMesh.scale.set(
        width(look.beam.sheath),
        metres,
        width(look.beam.sheath)
      );
      hazeMesh.scale.set(width(look.beam.haze), metres, width(look.beam.haze));
    },
  };
};

/** A soft round additive sprite in Confringo's colours, `strength` bright. */
const createGlowMaterial = (strength: number, falloff: number) => {
  const material = new SpriteNodeMaterial({
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });

  const fromCentre = length(uv().sub(0.5)).mul(2);
  material.colorNode = vec4(
    vec3(main.r, main.g, main.b)
      .mul(strength)
      .add(vec3(hot.r, hot.g, hot.b).mul(strength * 0.5)),
    1
  );
  material.opacityNode = smoothstep(1, 0, fromCentre).pow(falloff);

  return material;
};

interface Spark {
  readonly sprite: Sprite;
  readonly velocity: Vector3;
  age: number;
  life: number;
}

export const createClashVfx = (): ClashVfx => {
  const object = new Group();
  object.visible = false;
  const clock = createClock();
  const random = seededRandom(23);

  const halves = [createHalf(clock), createHalf(clock)] as const;
  object.add(halves[0].group, halves[1].group);

  const ballMaterial = new MeshBasicNodeMaterial();
  ballMaterial.colorNode = vec3(hot.r, hot.g, hot.b).mul(14);
  const ball = new Mesh(new SphereGeometry(1, 20, 14), ballMaterial);

  const glow = new Sprite(createGlowMaterial(3.4, 2));
  const corona = new Sprite(createGlowMaterial(0.9, 3));
  object.add(ball, glow, corona);

  // Shines only during a Clash, but always exists, so the count of lights
  // (and so the shaders) never changes.
  const light = new PointLight(main, 0, look.point.light.distance, 2);
  object.add(light);

  const sparkMaterial = createGlowMaterial(4, 1.5);

  const sparks: Spark[] = Array.from({ length: look.sparks.count }, () => {
    const sprite = new Sprite(sparkMaterial);
    sprite.scale.setScalar(look.sparks.size);
    object.add(sprite);

    // Born spent, so each one is thrown out afresh, staggered, once the Clash starts.
    return { age: random(), life: 0, sprite, velocity: new Vector3() };
  });

  let time = 0;
  let kick = 0;
  const beamAxis = new Vector3();
  const side = new Vector3();

  /** Throws a spark out of the meeting point, mostly sideways off the beam. */
  const throwSpark = (spark: Spark, at: Point3) => {
    side.set(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1);
    // Take most of the beam's direction out, so the spray fans sideways.
    side.addScaledVector(beamAxis, -0.8 * side.dot(beamAxis)).normalize();
    const speed = lerp(look.sparks.speed.min, look.sparks.speed.max, random());
    spark.velocity.copy(side).multiplyScalar(speed);
    spark.age = 0;
    spark.life = lerp(look.sparks.life.min, look.sparks.life.max, random());
    spark.sprite.position.set(at.x, at.y, at.z);
  };

  const spray = (at: Point3, seconds: number) => {
    for (const spark of sparks) {
      spark.age += seconds;

      if (spark.age >= spark.life) {
        throwSpark(spark, at);
      }

      spark.velocity.y -= look.sparks.gravity * seconds;
      spark.sprite.position.addScaledVector(spark.velocity, seconds);
      spark.sprite.scale.setScalar(
        look.sparks.size * (1 - spark.age / Math.max(spark.life, 1e-3))
      );
    }
  };

  return {
    handle: (events) => {
      if (events.some((event) => event.type === "clash-pump")) {
        kick = 1;
      }
    },
    object,
    update: (previous, current, alpha, seconds, visibleTip) => {
      time += seconds;
      clock.value = time;
      kick = Math.max(kick - look.point.kickFade * seconds, 0);

      if (!current) {
        object.visible = false;
        light.intensity = 0;

        return;
      }

      object.visible = true;

      const [first, second] = current.sides;
      const from = visibleTip(first.duelistId) ?? first.wand;
      const to = visibleTip(second.duelistId) ?? second.wand;

      const along = Math.min(
        Math.max(
          lerp(previous?.along ?? current.along, current.along, alpha),
          0
        ),
        1
      );

      const point = {
        x: lerp(from.x, to.x, along),
        y: lerp(from.y, to.y, along),
        z: lerp(from.z, to.z, along),
      };

      beamAxis.set(to.x - from.x, to.y - from.y, to.z - from.z).normalize();

      // Two incommensurate flickers, so the beam never visibly loops.
      const flicker =
        1 + 0.12 * Math.sin(time * 47) + 0.08 * Math.sin(time * 83 + 1);

      halves[0].place(from, point, flicker);
      halves[1].place(to, point, flicker);

      const pulse =
        1 + look.point.pulse * Math.sin(time * 31) + look.point.kick * kick;

      ball.position.set(point.x, point.y, point.z);
      ball.scale.setScalar(look.point.core * pulse);
      glow.position.copy(ball.position);
      glow.scale.setScalar(look.point.glow * pulse);
      corona.position.copy(ball.position);
      corona.scale.setScalar(look.point.corona * (0.9 + 0.1 * pulse));
      light.position.copy(ball.position);
      light.intensity = look.point.light.intensity * pulse * flicker;

      spray(point, seconds);
    },
  };
};
