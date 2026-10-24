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
 */
import {
  exp,
  float,
  mix,
  mx_noise_float,
  sin,
  smoothstep,
  uniform,
  uv,
  vec3,
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
  Vector3,
} from "three/webgpu";

import type { Tuning } from "../tuning";

export type JetLook = Tuning["spellLook"]["bolts"]["stupefy"]["jet"];

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

const squared = (value: Node<"float">) => value.mul(value);

const vec3Of = (color: Color) => vec3(color.r, color.g, color.b);

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

  const hot = vec3Of(palette.hot);
  const main = vec3Of(palette.main);
  const edge = vec3Of(new Color(look.edge));

  // Along the jet from the tail (0) to the head (1); across it from -1 to 1,
  // widened toward the tail by the taper so the halo narrows there.
  const along = uv().x;

  const across = uv()
    .y.mul(2)
    .sub(1)
    .div(mix(float(look.taper), float(1), along));

  const metres = along.mul(metresLong);
  const flow = metres.mul(look.noiseScale).sub(time.mul(look.flowSpeed));
  const churn = mx_noise_float(vec3(flow, across.mul(1.5), seed));
  const core = exp(squared(across.div(look.core)).negate());

  const halo = exp(
    squared(across.div(churn.mul(look.churn).add(1).mul(look.halo))).negate()
  ).toVar();

  // Fire: faster, finer tongues eating into the halo's edge.
  const tongue = mx_noise_float(
    vec3(
      metres.mul(look.flameScale).sub(time.mul(look.flowSpeed * 1.4)),
      across.mul(2.5),
      seed.add(3)
    )
  )
    .mul(0.5)
    .add(0.5);

  const burning = mix(
    float(1),
    smoothstep(0.3, 0.75, tongue.add(halo.sub(0.5).mul(0.9))),
    look.flame
  );

  const heat = halo.mul(burning);

  const pulses = sin(metres.mul(look.pulseRate).sub(time.mul(look.pulseSpeed)))
    .mul(0.5)
    .add(0.5)
    .mul(look.pulse)
    .add(1 - look.pulse);

  const filament = (phase: number, rate: number) => {
    const sway = mx_noise_float(vec3(flow.mul(0.5), seed, phase))
      .mul(0.5)
      .add(0.5);

    const wiggle = sin(
      metres.mul(rate).sub(time.mul(look.filamentSpeed)).add(seed.add(phase))
    )
      .mul(look.filamentAmplitude)
      .mul(sway);

    return exp(squared(across.sub(wiggle).div(look.filamentWidth)).negate());
  };

  const filaments = filament(0, 7).add(filament(2.1, 11));

  const ends = smoothstep(0, look.tailSoft, along).mul(
    smoothstep(1, 1 - look.headSoft, along)
  );

  // The halo cools from the hue at its heart to `edge` at its rim; a
  // burning one glows toward white where it is hottest.
  const haloColor = mix(edge, main, smoothstep(0.05, 0.6, halo)).add(
    hot.mul(smoothstep(0.6, 1, heat).mul(look.flame * 0.3))
  );

  const material = new MeshBasicNodeMaterial({
    blending: AdditiveBlending,
    depthWrite: false,
    forceSinglePass: true,
    side: DoubleSide,
    transparent: true,
  });

  material.colorNode = hot
    .mul(core.mul(look.coreIntensity))
    .add(haloColor.mul(heat.mul(pulses).mul(look.haloIntensity)))
    .add(mix(main, hot, 0.4).mul(filaments.mul(look.filamentIntensity)))
    .mul(ends);

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
