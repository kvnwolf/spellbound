/**
 * Depulso's blast: a cone of wind and force bursting out of the Wand along
 * the caster's facing, as wide and as long as the gameplay cone. Views only.
 *
 * - At the Wand, a muzzle flash and a shock ring as the blast leaves it.
 * - A curved shock front, a patch of a sphere round the Wand spanning the
 *   cone, races out to the end of the range in a fifth of a second (so it
 *   lands as the push does), faint face-on and brightest where it turns
 *   edge-on, like a pressure wave, and bends what is seen through it.
 * - Behind it, a faint sleeve of rushing air fills the cone: wind streaks
 *   round it flowing outward, soft where it turns edge-on so it reads as a
 *   volume rather than an outline, and never brightest at its rim, so the
 *   end of the cone is never a disc.
 * - Wind streaks shoot out of the Wand and through the cone, and dust is
 *   swept out along the floor under the front, with grit skimming ahead;
 *   both are sparks in the shared spark ring.
 *
 * A few reused waves, each with its own uniforms, so overlapping blasts fade
 * independently in one shader. Colours are scene-linear HDR.
 */
import {
  abs,
  float,
  normalView,
  positionViewDirection,
  screenUV,
  sin,
  smoothstep,
  uniform,
  uv,
  vec3,
  vec4,
  viewportSharedTexture,
} from "three/tsl";
import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  SphereGeometry,
} from "three/webgpu";
import type { Object3D } from "three/webgpu";

import type { GroundPoint, Point3 } from "../duel/geometry";
import type { Tuning } from "../tuning";
import type { SparkRing } from "./spark-ring";

export interface DepulsoWaves {
  /** Starts a blast at the Wand tip `origin`, along `axis` (a unit vector on the floor). */
  readonly start: (origin: Point3, axis: GroundPoint) => void;
  /** Ages every blast by `seconds`, sweeping dust along the floor under each front as it passes. */
  readonly advance: (seconds: number) => void;
}

export interface DepulsoWaveSettings {
  readonly cone: Pick<Tuning["depulso"], "coneDegrees" | "range">;
  readonly look: Tuning["depulsoLook"];
  /** The shared spark ring the streaks, dust and grit are drawn with. */
  readonly sparks: SparkRing;
  /** Depulso's colours: its wind and its white heart. */
  readonly palette: { readonly main: Color; readonly hot: Color };
  readonly random: () => number;
}

/** How many blasts can be on screen at once: one per Duelist is plenty. */
const poolSize = 3;

/** The front's ease: fast out of the Wand, slowing toward the end of the range. */
const frontOf = (share: number) => 1 - (1 - Math.min(share, 1)) ** 3;

/** Additive, depth tested, never written, one pass for both faces (see prewarm.ts). */
const glowMaterial = () =>
  new MeshBasicNodeMaterial({
    blending: AdditiveBlending,
    depthWrite: false,
    forceSinglePass: true,
    side: DoubleSide,
    transparent: true,
  });

/** A line on the floor `turn` radians off `axis`, as a unit vector. */
const lineOf = (axis: GroundPoint, turn: number): GroundPoint => {
  const cosine = Math.cos(turn);
  const sine = Math.sin(turn);

  return {
    x: axis.x * cosine - axis.z * sine,
    z: axis.x * sine + axis.z * cosine,
  };
};

export const createDepulsoWaves = (
  parent: Object3D,
  { cone, look, palette, random, sparks }: DepulsoWaveSettings
): DepulsoWaves => {
  const halfWide = (cone.coneDegrees * Math.PI) / 360;
  const halfTall = Math.atan(look.height / 2 / cone.range);
  const tint = new Color(look.color);
  const dustColor = new Color(look.dust.color);
  const air = vec3(tint.r, tint.g, tint.b);

  // The sleeve: an open cone with its apex at the origin, opening along +z
  // to a rim of radius 1 at z = 1; uv.y runs from 0 at the apex to 1 at the rim.
  const sleeveGeometry = new CylinderGeometry(1, 0, 1, 48, 16, true);
  sleeveGeometry.translate(0, 0.5, 0);
  sleeveGeometry.rotateX(Math.PI / 2);

  // The front: the patch of the unit sphere round +z that spans the cone.
  const frontGeometry = new SphereGeometry(
    1,
    40,
    16,
    Math.PI / 2 - halfWide,
    halfWide * 2,
    Math.PI / 2 - halfTall,
    halfTall * 2
  );

  // How directly a surface faces the camera (both faces): 1 face-on, 0 edge-on.
  const facing = abs(normalView.dot(positionViewDirection));

  const waves = Array.from({ length: poolSize }, () => {
    // Seconds since the cast as a share of the blast's life, and how far
    // the front has gone as a share of the range.
    const progress = uniform(1);
    const reach = uniform(1);
    // The front's own strength: up as it leaves, gone soon after it lands.
    const frontStrength = uniform(0);
    const fade = float(1).sub(progress).pow(1.5);

    // --- The sleeve of rushing air behind the front.
    const along = uv().y;
    const around = uv().x.mul(Math.PI * 2);

    // Wind streaks round the cone, bent and flowing outward.
    const streaks = sin(
      around
        .mul(look.sheath.streaks)
        .add(
          sin(along.mul(7).sub(progress.mul(26)).add(around.mul(3))).mul(2.2)
        )
    )
      .mul(0.5)
      .add(0.5)
      .pow(2);

    const behindFront = smoothstep(reach.add(0.03), reach.sub(0.05), along);
    // Densest just behind the front, thinning back toward the Wand.
    const wake = smoothstep(reach.sub(0.8), reach, along);
    const ends = smoothstep(0, 0.12, along).mul(smoothstep(1, 0.75, along));

    const sleeve = glowMaterial();
    sleeve.colorNode = air.mul(look.sheath.radiance);
    sleeve.opacityNode = behindFront
      .mul(wake)
      .mul(streaks.mul(0.75).add(0.25))
      .mul(facing.pow(0.8))
      .mul(ends)
      .mul(fade)
      .clamp(0, 1);

    // --- The shock front.
    const across = uv().x;
    const up = uv().y;

    const patch = smoothstep(0, 0.3, across)
      .mul(smoothstep(1, 0.7, across))
      .mul(smoothstep(0, 0.35, up))
      .mul(smoothstep(1, 0.65, up));

    const rim = float(1).sub(facing).pow(look.front.rimPower);

    const front = glowMaterial();
    front.colorNode = air.mul(look.front.radiance);
    front.opacityNode = patch.mul(rim.add(0.12)).mul(frontStrength).clamp(0, 1);

    // The air bent behind the front: the scene seen through it, shifted
    // along the sheet's normal on screen, strongest where it is edge-on.
    const bend = normalView.xy
      .mul(rim.add(0.3))
      .mul(patch)
      .mul(frontStrength.mul(look.front.refraction));

    const lens = new MeshBasicNodeMaterial({
      depthWrite: false,
      forceSinglePass: true,
      side: DoubleSide,
      transparent: true,
    });

    lens.colorNode = vec4(viewportSharedTexture(screenUV.add(bend)).rgb, 1);
    lens.opacityNode = patch.mul(frontStrength).clamp(0, 1);

    const group = new Group();
    group.visible = false;

    const sleeveMesh = new Mesh(sleeveGeometry, sleeve);
    sleeveMesh.scale.set(
      cone.range * Math.tan(halfWide),
      look.height / 2,
      cone.range
    );

    const lensMesh = new Mesh(frontGeometry, lens);
    const frontMesh = new Mesh(frontGeometry, front);
    // The bent scene first, the glow over it.
    lensMesh.renderOrder = 1;
    frontMesh.renderOrder = 2;
    sleeveMesh.renderOrder = 2;

    for (const mesh of [sleeveMesh, lensMesh, frontMesh]) {
      mesh.frustumCulled = false;
      group.add(mesh);
    }

    parent.add(group);

    return {
      age: look.seconds,
      axis: { x: 0, z: -1 },
      frontStrength,
      fronts: [lensMesh, frontMesh],
      group,
      origin: { x: 0, y: 0, z: 0 },
      progress,
      reach,
    };
  });

  let next = 0;
  // Dust and grit owed to each blast: fractional counts carried frame to frame.
  const owed = waves.map(() => ({ dust: 0, grit: 0 }));

  /** Sweeps a puff of dust (or a speck of grit) out along a random line in the cone, `distance` metres out. */
  const sweep = (
    origin: Point3,
    axis: GroundPoint,
    distance: number,
    grit: boolean
  ) => {
    const line = lineOf(axis, (random() * 2 - 1) * halfWide);
    const { dust } = look;

    const at = {
      x: origin.x + line.x * distance,
      y: grit ? 0.04 + random() * 0.08 : dust.size * (0.35 + random() * 0.4),
      z: origin.z + line.z * distance,
    };

    if (grit) {
      sparks.emit(at, dustColor, {
        gravity: 0,
        heading: { x: line.x, y: 0.05, z: line.z },
        intensity: dust.grit.intensity,
        life: dust.grit.life,
        size: dust.grit.size,
        speed: dust.grit.speed,
        spread: 0.15,
        streak: dust.grit.streak,
      });

      return;
    }

    sparks.emit(at, dustColor, {
      gravity: dust.rise,
      heading: { x: line.x, y: 0.2, z: line.z },
      intensity: dust.intensity,
      life: dust.life * (0.7 + random() * 0.3),
      size: dust.size * (0.6 + random() * 0.6),
      speed: dust.speed,
      spread: dust.spread,
    });
  };

  /** The muzzle flash and ring, and the wind streaks shot through the cone. */
  const blastOut = (origin: Point3, axis: GroundPoint) => {
    const { muzzle, streaks } = look;

    sparks.emit(origin, palette.hot, {
      intensity: muzzle.intensity,
      life: muzzle.life,
      size: muzzle.flash,
      speed: 0,
    });

    sparks.emit(origin, palette.main, {
      intensity: muzzle.intensity,
      life: muzzle.life * 1.6,
      ring: true,
      size: muzzle.ring,
      speed: 0,
    });

    for (let streak = 0; streak < streaks.count; streak += 1) {
      // Some leave the Wand, the rest start a little way down the cone, so
      // the whole cone fills with rushing lines at once.
      const start = streak % 3 === 0 ? 0 : random() * 0.35 * cone.range;
      const line = lineOf(axis, (random() * 2 - 1) * halfWide * 0.8);
      const lift = (random() * 2 - 1) * Math.tan(halfTall) * 0.8;

      sparks.emit(
        {
          x: origin.x + line.x * start,
          y: origin.y + lift * start,
          z: origin.z + line.z * start,
        },
        streak % 4 === 0 ? palette.hot : tint,
        {
          gravity: 0,
          heading: { x: line.x, y: lift, z: line.z },
          intensity: streaks.intensity,
          life: streaks.life * (0.6 + random() * 0.4),
          size: streaks.size,
          speed: streaks.speed,
          spread: streaks.spread * 0.3,
          streak: streaks.streak,
        }
      );
    }
  };

  return {
    advance: (seconds) => {
      for (const [index, wave] of waves.entries()) {
        if (wave.age >= look.seconds) {
          wave.group.visible = false;
          continue;
        }

        const before = frontOf(wave.age / look.frontSeconds) * cone.range;
        wave.age = Math.min(wave.age + seconds, look.seconds);
        const share = wave.age / look.frontSeconds;
        const after = frontOf(share) * cone.range;
        const reach = frontOf(share);

        wave.progress.value = wave.age / look.seconds;
        wave.reach.value = reach;
        wave.group.visible = wave.age < look.seconds;

        // The front swells in as it leaves and fades just after it lands.
        wave.frontStrength.value =
          Math.min(share * 6, 1) * Math.max(1 - (share - 0.8) / 0.6, 0);

        const radius = Math.max(reach * cone.range, 1e-3);

        for (const mesh of wave.fronts) {
          mesh.visible = wave.frontStrength.value > 0.001;
          mesh.scale.setScalar(radius);
        }

        const debt = owed[index];

        if (!debt) {
          continue;
        }

        // Dust and grit under the front, for every metre it travelled.
        debt.dust += (after - before) * look.dust.perMetre;
        debt.grit += (after - before) * look.dust.grit.perMetre;

        for (; debt.dust >= 1; debt.dust -= 1) {
          sweep(
            wave.origin,
            wave.axis,
            before + random() * (after - before),
            false
          );
        }

        for (; debt.grit >= 1; debt.grit -= 1) {
          sweep(
            wave.origin,
            wave.axis,
            before + random() * (after - before),
            true
          );
        }
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
      wave.reach.value = 0;
      wave.frontStrength.value = 0;
      wave.group.visible = true;
      wave.group.position.set(origin.x, origin.y, origin.z);
      wave.group.rotation.set(0, Math.atan2(axis.x, axis.z), 0);
      blastOut(origin, axis);
    },
  };
};
