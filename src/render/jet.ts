/**
 * A jet of light, as the films draw a Spell: a ribbon from the Wand to the
 * Spell's head, turned to the camera, with a white-hot core, a halo in the
 * Spell's hue that churns with noise flowing toward the head, pulses running
 * down it and two filaments twisting round it, soft at both ends.
 *
 * One look drives every Spell's jet; its numbers give each its character.
 * `flame` turns the halo into fire: tongues of higher-frequency noise eat
 * into its edge, which cools from the Spell's hue to `edge` (a deep red),
 * while its heart burns toward white. `taper` narrows the tail, so a gout of
 * fire widens as it leaves the Wand.
 *
 * Every jet of a kind shares one material (one shader, compiled at load):
 * its length and seed are per-object uniforms read from the jet's own state
 * as each is drawn, and the effects clock is shared.
 *
 * A Clash draws each Duelist's half of its beam as the same jet strained
 * against the other (`createClashJet`): no fire, but swollen where it
 * pushes, swaying, brighter toward the meeting point, with a third filament
 * and a surge of light a pump sends racing down it.
 */
import {
  exp,
  float,
  mix,
  mx_noise_float,
  positionGeometry,
  sin,
  smoothstep,
  uniform,
  uv,
  vec3,
  vec4,
} from "three/tsl";
import type { Node, Object3D } from "three/webgpu";
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  Vector2,
  Vector3,
} from "three/webgpu";

import type { Tuning } from "../tuning";

export type JetLook = Tuning["spellLook"]["bolts"]["stupefy"]["jet"];

/** A Clash's half-beam: the jet's numbers, and how it strains. */
type ClashBeamLook = Tuning["clashLook"]["beam"];

/** The numbers every jet is drawn by, a Spell's or a Clash's. */
type CommonJetLook = Pick<
  JetLook,
  | "churn"
  | "core"
  | "coreIntensity"
  | "filamentAmplitude"
  | "filamentIntensity"
  | "filamentSpeed"
  | "filamentWidth"
  | "flowSpeed"
  | "halo"
  | "haloIntensity"
  | "headSoft"
  | "noiseScale"
  | "pulse"
  | "pulseRate"
  | "pulseSpeed"
  | "tailSoft"
>;

/** A Spell's colours: the main hue and its white-hot heart. */
export interface JetPalette {
  readonly main: Color;
  readonly hot: Color;
}

/** One jet's state, read by the shared material as the jet is drawn. */
interface JetState {
  metres: number;
  seed: number;
}

/**
 * What a jet's shader reads: its look, its length in metres, the effects
 * clock, a seed and its colours. A Spell's jet burns (`fire`); a Clash's
 * strains (`strain`), with the surge running down it (metres from the Wand,
 * strength).
 */
interface JetInputs {
  readonly look: CommonJetLook;
  readonly metresLong: Node<"float">;
  readonly time: Node<"float">;
  readonly seed: Node<"float">;
  readonly main: Node<"vec3">;
  readonly hot: Node<"vec3">;
  readonly fire?: Pick<JetLook, "edge" | "flame" | "flameScale" | "taper">;
  readonly strain?: {
    readonly look: ClashBeamLook;
    readonly surge: Node<"vec2">;
  };
}

/**
 * How far toward white-hot the filaments are: a Spell's, and a Clash's,
 * cooler so each half of the beam keeps its Spell's colour.
 */
const filamentHeat = { clash: 0.3, spell: 0.4 };

const squared = (value: Node<"float">) => value.mul(value);

const vec3Of = (color: Color) => vec3(color.r, color.g, color.b);

/** The jet's additive material, burning or straining as its inputs ask. */
const jetMaterial = ({
  fire,
  hot,
  look,
  main,
  metresLong,
  seed,
  strain,
  time,
}: JetInputs) => {
  // Along the jet from the tail (0) to the head (1); across it from -1 to 1,
  // widened toward the tail by a fire's taper so its halo narrows there.
  const along = uv().x;
  const straight = uv().y.mul(2).sub(1);

  const across = fire
    ? straight.div(mix(float(fire.taper), float(1), along))
    : straight;

  // A Clash's jet swells where it pushes against the other.
  const swell =
    strain &&
    smoothstep(1 - strain.look.swell.reach, 1, along)
      .pow(2)
      .mul(strain.look.swell.amount)
      .add(1);

  const swollen = (width: Node<"float">) => (swell ? width.mul(swell) : width);

  const metres = along.mul(metresLong);
  const flow = metres.mul(look.noiseScale).sub(time.mul(look.flowSpeed));
  const churn = mx_noise_float(vec3(flow, across.mul(1.5), seed));
  const core = exp(squared(across.div(swollen(float(look.core)))).negate());

  const halo = exp(
    squared(
      across.div(swollen(churn.mul(look.churn).add(1).mul(look.halo)))
    ).negate()
  ).toVar();

  // Fire: faster, finer tongues eating into the halo's edge.
  const tongue =
    fire &&
    mx_noise_float(
      vec3(
        metres.mul(fire.flameScale).sub(time.mul(look.flowSpeed * 1.4)),
        across.mul(2.5),
        seed.add(3)
      )
    )
      .mul(0.5)
      .add(0.5);

  const heat =
    fire && tongue
      ? halo.mul(
          mix(
            float(1),
            smoothstep(0.3, 0.75, tongue.add(halo.sub(0.5).mul(0.9))),
            fire.flame
          )
        )
      : halo;

  const pulses = sin(metres.mul(look.pulseRate).sub(time.mul(look.pulseSpeed)))
    .mul(0.5)
    .add(0.5)
    .mul(look.pulse)
    .add(1 - look.pulse);

  const filament = (phase: number, rate: number) => {
    const sway = mx_noise_float(vec3(flow.mul(0.5), seed, phase))
      .mul(0.5)
      .add(0.5);

    const wiggle = swollen(
      sin(
        metres.mul(rate).sub(time.mul(look.filamentSpeed)).add(seed.add(phase))
      )
        .mul(look.filamentAmplitude)
        .mul(sway)
    );

    return exp(squared(across.sub(wiggle).div(look.filamentWidth)).negate());
  };

  const twisted = filament(0, 7).add(filament(2.1, 11));
  const filaments = strain ? twisted.add(filament(4.3, 5)) : twisted;

  // A Clash's surge: a bright knot of light racing down the jet.
  const surgeBand =
    strain &&
    exp(
      squared(metres.sub(strain.surge.x).div(strain.look.surge.width)).negate()
    ).mul(strain.surge.y);

  const surged = (value: Node<"float">, gain: number) =>
    surgeBand ? value.mul(surgeBand.mul(gain).add(1)) : value;

  const ends = smoothstep(0, look.tailSoft, along).mul(
    smoothstep(1, 1 - look.headSoft, along)
  );

  // A fire's halo cools from the hue at its heart to `edge` at its rim, and
  // glows toward white where it is hottest.
  const haloColor = fire
    ? mix(vec3Of(new Color(fire.edge)), main, smoothstep(0.05, 0.6, halo)).add(
        hot.mul(smoothstep(0.6, 1, heat).mul(fire.flame * 0.3))
      )
    : main;

  const glow = hot
    .mul(surged(core, strain?.look.surge.core ?? 0).mul(look.coreIntensity))
    .add(
      haloColor.mul(
        surged(heat.mul(pulses), strain?.look.surge.halo ?? 0).mul(
          look.haloIntensity
        )
      )
    )
    .add(
      mix(main, hot, strain ? filamentHeat.clash : filamentHeat.spell).mul(
        filaments.mul(look.filamentIntensity)
      )
    )
    .mul(ends);

  const material = new MeshBasicNodeMaterial({
    blending: AdditiveBlending,
    depthWrite: false,
    forceSinglePass: true,
    side: DoubleSide,
    transparent: true,
  });

  if (!strain) {
    material.colorNode = glow;

    return material;
  }

  // Brighter toward the meeting point, where the energy piles up; fully
  // opaque, so the additive blend adds all of it.
  const { look: beam } = strain;
  material.colorNode = vec4(
    glow.mul(along.mul(1 - beam.rampFrom).add(beam.rampFrom)),
    1
  );

  // The two jets strain against each other: a slow sway, pinned at both ends.
  const sway = sin(along.mul(Math.PI))
    .mul(
      sin(
        along
          .mul(beam.sway.waves * Math.PI * 2)
          .sub(time.mul(beam.sway.speed))
          .add(seed.mul(3))
      )
    )
    .mul(beam.sway.amount);

  material.positionNode = vec3(
    positionGeometry.x,
    positionGeometry.y.add(sway),
    positionGeometry.z
  );

  return material;
};

/** The shared material of one kind's jets, and the jets drawn with it. */
export const createJetKind = (palette: JetPalette, look: JetLook) => {
  const states = new WeakMap<Object3D, JetState>();
  const time = uniform(0);

  const metresLong = uniform(1).onObjectUpdate(
    ({ object }) => (object && states.get(object)?.metres) ?? 1
  );

  const seed = uniform(0).onObjectUpdate(
    ({ object }) => (object && states.get(object)?.seed) ?? 0
  );

  const material = jetMaterial({
    fire: look,
    hot: vec3Of(palette.hot),
    look,
    main: vec3Of(palette.main),
    metresLong,
    seed,
    time,
  });

  const geometry = new PlaneGeometry(1, 1, 64, 1);

  return {
    /** A new jet of this kind: a mesh to add to the scene. */
    create: () => {
      const mesh = new Mesh(geometry, material);
      mesh.frustumCulled = false;
      states.set(mesh, { metres: 1, seed: 0 });

      return mesh;
    },
    look,
    /** Sets a jet's length and seed, as it is laid. */
    state: (mesh: Object3D) => states.get(mesh),
    /** Sets the effects clock every jet of this kind churns by. */
    tick: (seconds: number) => {
      time.value = seconds;
    },
  };
};

export type JetKind = ReturnType<typeof createJetKind>;

/**
 * One Duelist's half of a Clash's beam: a jet from the Wand (along 0) to
 * the meeting point (along 1), on a ribbon laid with `layRibbon`. Its own
 * material and uniforms: how long it is, the clock, a seed, its colours
 * (set as the Clash starts) and the surge running down it (metres from the
 * Wand, strength).
 */
export const createClashJet = (look: ClashBeamLook) => {
  const metresLong = uniform(1);
  const time = uniform(0);
  const seed = uniform(0);
  const main = uniform(new Vector3());
  const hot = uniform(new Vector3());
  const surge = uniform(new Vector2(-100, 0));

  const material = jetMaterial({
    hot,
    look,
    main,
    metresLong,
    seed,
    strain: { look, surge },
    time,
  });

  const mesh = new Mesh(new PlaneGeometry(1, 1, look.segments, 1), material);
  mesh.frustumCulled = false;

  return { hot, main, mesh, metresLong, seed, surge, time };
};

export type ClashJet = ReturnType<typeof createClashJet>;

const side = new Vector3();
const normal = new Vector3();
const basis = new Matrix4();
const toEye = new Vector3();

/**
 * Lays a flat ribbon `mesh` (a unit plane, x along it) from `tail` to `head`,
 * `width` across, turned about its axis to face `eye`.
 */
export const layRibbon = (
  mesh: Object3D,
  tail: Vector3,
  head: Vector3,
  width: number,
  eye: Vector3
) => {
  const axis = toEye.copy(head).sub(tail);
  const length = Math.max(axis.length(), 1e-4);
  axis.divideScalar(length);
  mesh.position.copy(tail).add(head).multiplyScalar(0.5);
  side.copy(axis).cross(normal.copy(eye).sub(mesh.position));

  if (side.lengthSq() < 1e-8) {
    side.set(0, 1, 0).cross(axis);
  }

  side.normalize();
  normal.copy(axis).cross(side);
  basis.makeBasis(axis, side, normal);
  mesh.quaternion.setFromRotationMatrix(basis);
  mesh.scale.set(length, width, 1);
};
