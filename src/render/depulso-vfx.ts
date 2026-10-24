/**
 * Depulso's blast: a gust of force out of the Wand along the caster's
 * facing, as wide and as long as the gameplay cone. Views only. A blast of
 * air is mostly invisible; what shows is what it drags and what it bends:
 *
 * - A shapeless, turbulent cloud of air billows out of the Wand through the
 *   cone, launched hard and stalling in the still air, swelling and coming
 *   apart into wisps as it goes (soft puffs in `air-cloud.ts`, shaped by
 *   noise and curl noise, lit from above).
 * - The air bends what is behind it: bend puffs ride out with the cloud,
 *   rippling the scene seen through them.
 * - Dust and grit are torn off the floor under the blast as it passes: dust
 *   puffs swept out and up along the cone, grit specks skimming ahead (in
 *   the shared spark ring).
 * - A Duelist it catches bursts with force (`createDepulsoHits`): a puff of
 *   air and dust thrown off their body away from the caster, the air
 *   bending round them and grit kicked from their feet, timed to the
 *   moment the cloud reaches them.
 *
 * The fastest air reaches the end of the gameplay range (and a little
 * past, so a Duelist at the very edge is still swallowed) within a fifth of
 * a second, so it lands as the push does. Every number is in
 * `tuning.depulsoLook`; the cone comes from `tuning.depulso`.
 */
import { Color, Vector3 } from "three/webgpu";
import type { Object3D } from "three/webgpu";

import type { DuelEvent } from "../duel/duel";
import type { GroundPoint, Point3 } from "../duel/geometry";
import type { Tuning } from "../tuning";
import { coneDirection, createBendPool, createDustPool } from "./air-cloud";
import { createAirField } from "./air-field";
import type { SparkRing } from "./spark-ring";
import { seededRandom } from "./spark-ring";

export interface DepulsoWaves {
  /** Starts a blast at the Wand tip `origin`, along `axis` (a unit vector on the floor). */
  readonly start: (origin: Point3, axis: GroundPoint) => void;
  /** Ages every blast by `seconds`, tearing dust off the floor under each as it passes. */
  readonly advance: (seconds: number) => void;
}

export interface DepulsoWaveSettings {
  readonly cone: Pick<Tuning["depulso"], "coneDegrees" | "range">;
  readonly look: Tuning["depulsoLook"];
  /** The shared spark ring the grit and the faint wind streaks are drawn with. */
  readonly sparks: SparkRing;
  /** Depulso's colours: its wind and its white heart. */
  readonly palette: { readonly main: Color; readonly hot: Color };
  readonly random: () => number;
}

type Look = Tuning["depulsoLook"];

/** How many blasts can tear dust up at once: one per Duelist is plenty. */
const poolSize = 3;

const between = (random: () => number, range: { min: number; max: number }) =>
  range.min + (range.max - range.min) * random();

/** The air's two pools, one draw each, sharing the baked field. */
const createCloud = (parent: Object3D, look: Look) => {
  const field = createAirField(look.cloud.fieldSize);
  const dust = createDustPool(look.cloud.slots.dust, look.cloud, field);
  const bend = createBendPool(look.cloud.slots.bend, look.cloud, field);
  // The bent scene first, the dust over it.
  bend.sprite.renderOrder = 1;
  dust.sprite.renderOrder = 2;
  parent.add(bend.sprite, dust.sprite);

  return { bend, dust };
};

/**
 * How far the leading air has gone `seconds` after the cast, as a share of
 * where it stalls: it leaves the Wand at full speed and drag stalls it.
 */
const frontShare = (seconds: number, drag: number) =>
  1 - Math.exp(-seconds / drag);

/** A grit speck skimming the floor along `line`, `distance` metres out of `origin`. */
const kickGrit = (
  sparks: SparkRing,
  grit: Look["dust"]["grit"],
  color: Color,
  at: Point3,
  line: Point3,
  random: () => number
) => {
  sparks.emit({ x: at.x, y: 0.03 + random() * 0.1, z: at.z }, color, {
    gravity: grit.gravity,
    heading: { x: line.x, y: grit.lift, z: line.z },
    intensity: grit.intensity,
    life: grit.life * (0.6 + random() * 0.4),
    size: grit.size,
    speed: grit.speed * (0.6 + random() * 0.4),
    spread: grit.spread,
    streak: grit.streak,
  });
};

export const createDepulsoWaves = (
  parent: Object3D,
  { cone, look, palette, random, sparks }: DepulsoWaveSettings
): DepulsoWaves => {
  const { bend, dust } = createCloud(parent, look);
  const halfWide = (cone.coneDegrees * Math.PI) / 360;
  const halfTall = Math.atan(look.height / 2 / cone.range);
  const air = new Color(look.air.color);
  const dustColor = new Color(look.dust.color);
  const gritColor = new Color(look.dust.grit.color);
  // Where the leading air stalls: the end of the range, and a little past.
  const stallAt = cone.range * look.air.reach.max;

  const waves = Array.from({ length: poolSize }, () => ({
    age: Infinity,
    axis: { x: 0, z: -1 },
    origin: { x: 0, y: 0, z: 0 },
    owed: { dust: 0, grit: 0 },
  }));

  let next = 0;

  /** The cloud of air out of the Wand, the air it bends and a few faint wind streaks. */
  const blastOut = (origin: Point3, axis: GroundPoint) => {
    const { muzzle, streaks } = look;

    // A soft breath of force at the Wand, no ring: air has no edge.
    sparks.emit(origin, palette.hot, {
      intensity: muzzle.intensity,
      life: muzzle.life,
      size: muzzle.flash,
      speed: 0,
    });

    for (let puff = 0; puff < look.air.count; puff += 1) {
      // Spread through the cone; most air goes far, some stalls near.
      const share = between(random, look.air.reach) ** look.air.bias;

      const heading = coneDirection(
        axis,
        (random() * 2 - 1) * halfWide * look.air.spread,
        ((random() * 2 - 1) * halfTall - look.air.droop) * look.air.spread
      );

      const metres = share * cone.range;
      const speed = metres / look.drag;

      dust.emit({
        drag: look.drag,
        life: between(random, look.air.life),
        origin,
        rise: look.air.rise,
        size: [
          look.air.size.from,
          look.air.size.from +
            (look.air.size.to - look.air.size.from) * (0.4 + 0.6 * share),
        ],
        strength: look.air.opacity * (0.6 + 0.4 * random()),
        tint: air,
        velocity: heading.multiplyScalar(speed),
        wander: look.air.wander,
      });
    }

    for (let puff = 0; puff < look.bend.count; puff += 1) {
      const share = between(random, look.bend.reach);

      const heading = coneDirection(
        axis,
        (random() * 2 - 1) * halfWide * 0.7,
        (random() * 2 - 1) * halfTall * 0.5
      );

      bend.emit({
        drag: look.drag,
        life: look.bend.life * (0.8 + 0.4 * random()),
        origin,
        size: [
          look.bend.size.from,
          look.bend.size.from +
            (look.bend.size.to - look.bend.size.from) * share,
        ],
        strength: look.bend.strength,
        velocity: heading.multiplyScalar((share * cone.range) / look.drag),
        wander: look.bend.wander,
      });
    }

    for (let streak = 0; streak < streaks.count; streak += 1) {
      const heading = coneDirection(
        axis,
        (random() * 2 - 1) * halfWide * 0.8,
        (random() * 2 - 1) * halfTall * 0.6
      );

      sparks.emit(origin, air, {
        gravity: 0,
        heading: { x: heading.x, y: heading.y, z: heading.z },
        intensity: streaks.intensity,
        life: streaks.life * (0.6 + random() * 0.4),
        size: streaks.size,
        speed: streaks.speed,
        spread: streaks.spread,
        streak: streaks.streak,
      });
    }
  };

  /** Dust torn off the floor at `distance` metres out along a random line through the cone. */
  const tearDust = (wave: (typeof waves)[number], distance: number) => {
    const line = coneDirection(
      wave.axis,
      (random() * 2 - 1) * halfWide * 0.9,
      0
    );

    const at = {
      x: wave.origin.x + line.x * distance,
      y: look.dust.height * (0.5 + random()),
      z: wave.origin.z + line.z * distance,
    };

    // Swept on along the blast and thrown up off the floor.
    const speed = look.dust.speed * (0.6 + random() * 0.6);

    dust.emit({
      aspect: look.dust.aspect,
      drag: look.dust.drag,
      life: between(random, look.dust.life),
      origin: at,
      rise: look.dust.rise,
      size: [look.dust.size.from, look.dust.size.to * (0.7 + random() * 0.5)],
      strength: look.dust.opacity * (0.6 + 0.4 * random()),
      tint: dustColor,
      velocity: {
        x: line.x * speed,
        y: look.dust.lift * (0.5 + random()),
        z: line.z * speed,
      },
      wander: look.dust.wander,
    });
  };

  return {
    advance: (seconds) => {
      for (const wave of waves) {
        if (wave.age >= look.seconds) {
          continue;
        }

        const before = frontShare(wave.age, look.drag) * stallAt;
        wave.age = Math.min(wave.age + seconds, look.seconds);
        const after = frontShare(wave.age, look.drag) * stallAt;
        const swept = Math.max(Math.min(after, cone.range) - before, 0);

        // Dust and grit under the leading air, for every metre it travelled.
        wave.owed.dust += swept * look.dust.perMetre;
        wave.owed.grit += swept * look.dust.grit.perMetre;

        for (; wave.owed.dust >= 1; wave.owed.dust -= 1) {
          tearDust(wave, before + random() * swept);
        }

        for (; wave.owed.grit >= 1; wave.owed.grit -= 1) {
          const distance = before + random() * swept;

          const line = coneDirection(
            wave.axis,
            (random() * 2 - 1) * halfWide,
            0
          );

          kickGrit(
            sparks,
            look.dust.grit,
            gritColor,
            {
              x: wave.origin.x + line.x * distance,
              y: 0,
              z: wave.origin.z + line.z * distance,
            },
            line,
            random
          );
        }
      }

      bend.advance(seconds);
      dust.advance(seconds);
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
      wave.owed = { dust: 0, grit: 0 };
      blastOut(origin, axis);
    },
  };
};

export interface DepulsoHits {
  /** Reacts to this frame's simulation events: a Duelist caught by Depulso. */
  readonly handle: (events: readonly DuelEvent[]) => void;
  /** Ages the bursts by `seconds` of simulation time. */
  readonly advance: (seconds: number) => void;
}

export interface DepulsoHitSettings {
  readonly cone: Pick<Tuning["depulso"], "range">;
  readonly look: Tuning["depulsoLook"];
  /** The shared spark ring the grit is drawn with. */
  readonly sparks: SparkRing;
}

/**
 * The force bursting on every Duelist Depulso catches (Shield or not: the
 * push gets through): air and dust thrown off their body away from the
 * caster, the air bending round them and grit kicked from their feet. It
 * waits for the blast's air to reach them, so it lands with the cloud.
 */
export const createDepulsoHits = (
  parent: Object3D,
  { cone, look, sparks }: DepulsoHitSettings
): DepulsoHits => {
  const { bend, dust } = createCloud(parent, {
    ...look,
    cloud: { ...look.cloud, slots: look.hit.slots },
  });

  const random = seededRandom(59);
  const air = new Color(look.air.color);
  const dustColor = new Color(look.dust.color);
  const gritColor = new Color(look.dust.grit.color);
  const stallAt = cone.range * look.air.reach.max;
  // Grit waiting for the blast to arrive: seconds left, where, which way.
  let pending: { wait: number; feet: Point3; away: Point3 }[] = [];
  const away = new Vector3();

  const burst = (at: Point3, from: Point3) => {
    const { hit } = look;
    away.set(at.x - from.x, 0, at.z - from.z);
    const metres = Math.max(away.length(), 1e-3);
    away.divideScalar(metres);

    // When the leading air gets here: solving its stall for this distance.
    const wait = -look.drag * Math.log(1 - Math.min(metres / stallAt, 0.95));
    const delay = Math.min(wait, hit.maxDelay);

    for (let puff = 0; puff < hit.puffs; puff += 1) {
      // Mostly on away from the caster, some round the body.
      const scatter = coneDirection(
        { x: away.x, z: away.z },
        (random() * 2 - 1) * hit.spread,
        (random() * 2 - 1) * hit.spread * 0.6
      );

      const speed = hit.speed * (0.5 + random() * 0.7);

      dust.emit({
        delay,
        drag: hit.drag,
        life: hit.life * (0.7 + random() * 0.5),
        origin: {
          x: at.x + (random() - 0.5) * 0.3,
          y: at.y * (0.35 + random() * 0.8),
          z: at.z + (random() - 0.5) * 0.3,
        },
        rise: look.dust.rise,
        size: [hit.size.from, hit.size.to * (0.7 + random() * 0.5)],
        strength: hit.opacity * (0.6 + 0.4 * random()),
        tint: puff % 2 === 0 ? air : dustColor,
        velocity: scatter.multiplyScalar(speed),
        wander: look.dust.wander,
      });
    }

    for (let puff = 0; puff < hit.bend.count; puff += 1) {
      bend.emit({
        delay,
        drag: hit.drag,
        life: hit.bend.life,
        origin: { x: at.x, y: at.y * (0.6 + 0.4 * random()), z: at.z },
        size: [hit.bend.size * 0.5, hit.bend.size],
        strength: hit.bend.strength,
        velocity: {
          x: away.x * hit.speed * 0.5,
          y: 0,
          z: away.z * hit.speed * 0.5,
        },
      });
    }

    pending.push({
      away: { x: away.x, y: 0, z: away.z },
      feet: { x: at.x, y: 0, z: at.z },
      wait: delay,
    });
  };

  return {
    advance: (seconds) => {
      const due = pending.filter((each) => each.wait <= seconds);
      pending = pending
        .filter((each) => each.wait > seconds)
        .map((each) => ({ ...each, wait: each.wait - seconds }));

      for (const { away: line, feet } of due) {
        for (let speck = 0; speck < look.hit.grit; speck += 1) {
          const spread = coneDirection(
            { x: line.x, z: line.z },
            (random() * 2 - 1) * 1.2,
            0
          );

          kickGrit(sparks, look.dust.grit, gritColor, feet, spread, random);
        }

        // A skirt of dust kicked up round the feet.
        for (let puff = 0; puff < look.hit.dust; puff += 1) {
          const angle = random() * Math.PI * 2;

          const out = {
            x: Math.cos(angle) + line.x * 1.5,
            z: Math.sin(angle) + line.z * 1.5,
          };

          dust.emit({
            aspect: look.dust.aspect,
            drag: look.dust.drag,
            life: between(random, look.dust.life),
            origin: { x: feet.x, y: look.dust.height, z: feet.z },
            rise: look.dust.rise,
            size: [look.dust.size.from, look.dust.size.to * 0.8],
            strength: look.dust.opacity,
            tint: dustColor,
            velocity: {
              x: out.x * look.dust.speed * 0.6,
              y: look.dust.lift,
              z: out.z * look.dust.speed * 0.6,
            },
            wander: look.dust.wander,
          });
        }
      }

      bend.advance(seconds);
      dust.advance(seconds);
    },
    handle: (events) => {
      for (const event of events) {
        if (
          (event.type === "spell-hit" || event.type === "spell-blocked") &&
          event.spell.kind === "depulso"
        ) {
          burst(event.position, event.spell.position);
        }
      }
    },
  };
};
