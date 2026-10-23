/**
 * Depulso's wave: a pale cone of wind and force bursting out of the Wand
 * along the caster's facing, as wide and as long as the gameplay cone. Its
 * bright front races out to the end of the range and fades as it goes, with
 * wind streaks running through it, and it kicks up floor dust under the front
 * as it passes. A few reused meshes, each with its own progress uniform, so
 * overlapping waves fade independently in one shader. Views only.
 */
import {
  exp,
  float,
  sin,
  smoothstep,
  step,
  uniform,
  uv,
  vec3,
} from "three/tsl";
import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DoubleSide,
  Mesh,
  MeshBasicNodeMaterial,
} from "three/webgpu";
import type { Group } from "three/webgpu";

import type { GroundPoint, Point3 } from "../duel/geometry";
import type { Tuning } from "../tuning";

export interface DepulsoWaves {
  /** Starts a wave at the Wand tip `origin`, along `axis` (a unit vector on the floor). */
  readonly start: (origin: Point3, axis: GroundPoint) => void;
  /** Ages every wave by `seconds`, kicking up dust under each front as it passes. */
  readonly advance: (seconds: number) => void;
}

export interface DepulsoWaveSettings {
  readonly cone: Pick<Tuning["depulso"], "coneDegrees" | "range">;
  readonly look: Tuning["depulsoLook"];
  /** Where a puff of dust rises from the floor; the caller owns the particles. */
  readonly kick: (at: Point3) => void;
  readonly random: () => number;
}

/** How many waves can be on screen at once: one per Duelist is plenty. */
const poolSize = 3;

/** The front's ease: fast out of the Wand, slowing toward the end of the range. */
const frontOf = (progress: number) => 1 - (1 - progress) ** 3;

export const createDepulsoWaves = (
  parent: Group,
  { cone, kick, look, random }: DepulsoWaveSettings
): DepulsoWaves => {
  const halfAngle = (cone.coneDegrees * Math.PI) / 360;
  const color = new Color(look.color);

  // An open cone with its apex at the origin, opening along +z to a rim of
  // radius 1 at z = 1; uv.y runs from 0 at the apex to 1 at the rim.
  const geometry = new CylinderGeometry(1, 0, 1, 48, 12, true);
  geometry.translate(0, 0.5, 0);
  geometry.rotateX(Math.PI / 2);

  const waves = Array.from({ length: poolSize }, () => {
    const progress = uniform(1);
    const along = uv().y;
    const front = float(1).sub(float(1).sub(progress).pow(3));

    // The bright band at the front, and a thinner fill of wind behind it.
    const band = exp(along.sub(front).div(look.frontWidth).pow(2).negate());

    const behind = step(along, front).mul(
      smoothstep(front.sub(0.6), front, along).mul(0.35)
    );

    // Streaks of wind running round and along the cone.
    const streaks = sin(
      uv()
        .x.mul(Math.PI * 2 * look.streaks)
        .add(along.mul(9))
        .sub(progress.mul(16))
    )
      .mul(0.45)
      .add(0.55);

    // Soft where it leaves the Wand, fading out as the wave spends itself.
    const fromWand = smoothstep(0, 0.18, along);
    const fade = float(1).sub(progress).pow(1.4);

    const material = new MeshBasicNodeMaterial({
      blending: AdditiveBlending,
      depthWrite: false,
      // Additive, so drawing the back faces then the front ones (three.js's
      // default for double-sided transparency) adds up to the same as one
      // pass; one pass also compiles ahead with the rest (see prewarm.ts).
      forceSinglePass: true,
      side: DoubleSide,
      transparent: true,
    });

    material.colorNode = vec3(color.r, color.g, color.b).mul(look.radiance);
    material.opacityNode = band
      .add(behind)
      .mul(streaks)
      .mul(fromWand)
      .mul(fade)
      .clamp(0, 1);

    const mesh = new Mesh(geometry, material);
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.scale.set(
      cone.range * Math.tan(halfAngle),
      look.height / 2,
      cone.range
    );
    parent.add(mesh);

    return {
      age: look.seconds,
      axis: { x: 0, z: -1 },
      mesh,
      origin: { x: 0, y: 0, z: 0 },
      progress,
    };
  });

  let next = 0;
  // Dust owed to each wave: fractional counts carried frame to frame.
  const owed = waves.map(() => 0);

  /** A puff on the floor `reach` metres out along a random line in the cone. */
  const dustAt = (origin: Point3, axis: GroundPoint, reach: number) => {
    const turn = (random() * 2 - 1) * halfAngle;
    const cos = Math.cos(turn);
    const sinTurn = Math.sin(turn);
    const x = axis.x * cos - axis.z * sinTurn;
    const z = axis.x * sinTurn + axis.z * cos;

    kick({
      x: origin.x + x * reach,
      y: random() * 0.25,
      z: origin.z + z * reach,
    });
  };

  return {
    advance: (seconds) => {
      for (const [index, wave] of waves.entries()) {
        if (wave.age >= look.seconds) {
          wave.mesh.visible = false;
          continue;
        }

        const before = frontOf(wave.age / look.seconds) * cone.range;
        wave.age = Math.min(wave.age + seconds, look.seconds);
        const t = wave.age / look.seconds;
        const after = frontOf(t) * cone.range;
        wave.progress.value = t;
        wave.mesh.visible = t < 1;

        let due = (owed[index] ?? 0) + (after - before) * look.dust.perMetre;

        for (; due >= 1; due -= 1) {
          dustAt(wave.origin, wave.axis, before + random() * (after - before));
        }

        owed[index] = due;
      }
    },
    start: (origin, axis) => {
      const wave = waves[next];
      next = (next + 1) % waves.length;

      if (!wave) {
        return;
      }

      wave.age = 0;
      wave.origin = origin;
      wave.axis = axis;
      wave.progress.value = 0;
      wave.mesh.visible = true;
      wave.mesh.position.set(origin.x, origin.y, origin.z);
      wave.mesh.rotation.set(0, Math.atan2(axis.x, axis.z), 0);
    },
  };
};
