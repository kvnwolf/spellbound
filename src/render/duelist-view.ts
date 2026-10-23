/**
 * A Duelist drawn as a procedural wizard (`wizard-body.ts`): an articulated
 * body under a robe, a mantle and a hat or hood, posed every frame from code.
 * It only reads presentation samples and simulation events.
 *
 * The pose is layered. A gait advanced by the ground actually covered walks
 * and runs the legs with planted feet that do not slide; the pelvis bobs,
 * turns and leans with it and the free arm swings. Over that, each state
 * blends its own pose in and out (Charging, Protego, a Clash, Disarmed,
 * drinking, Staggered, knocked back, airborne), and one-shot motions play
 * their own timelines on top (each Spell's cast, a Backfire, a landing, a
 * flinch, a Wand pickup, the Dodge roll, the Knockout). Hands are targets
 * that two-bone IK reaches for; the Wand hand rests a Wand's length behind
 * the simulation's `wandTip`, so at rest the tip sits exactly there. The
 * cloth lags on a fixed-step spring, tents over the legs and never sinks
 * through the floor. Petrified, the pose freezes and the body turns to stone.
 *
 * It keeps every cue of the blockout it replaces: the Lock-on rim glow, the
 * full-Focus Wand aura, the empty hand while Disarmed, the vial raised while
 * drinking and the auras of Potions at work.
 */
import { Color, Group, Matrix4, Quaternion, Vector3 } from "three/webgpu";
import type { Object3D } from "three/webgpu";

import type { DuelEvent, DuelistId, PotionKind, SpellKind } from "../duel/duel";
import type { Point3 } from "../duel/geometry";
import type { Tuning } from "../tuning";
import type { DuelistSample } from "./interpolate";
import { createWizardBody } from "./wizard-body";
import type { Cloth, TeamLook } from "./wizard-body";
import {
  approach,
  createGait,
  createSpring,
  easeIn,
  pulse,
  ramp,
  smooth,
  solveLimb,
} from "./wizard-motion";
import type { Stride } from "./wizard-motion";

export interface DuelistView {
  readonly object: Group;
  /** Where the Wand tip is on screen right now, as last drawn: poses move it off the simulation's `wandTip`. */
  readonly wandTipPosition: () => Point3;
  /**
   * Reacts to this frame's simulation events about this Duelist: each
   * Spell's cast, a Backfire, a Dodge, a landing, a hit, a Potion down and
   * a Wand picked up off the floor.
   */
  readonly handle: (events: readonly DuelEvent[]) => void;
  /**
   * Draws `sample`, easing poses over the `seconds` since the last frame.
   * `glow` is the rim glow it eases toward: 0 off, 1 the full lock mark of
   * the local Duelist's Lock-on Target.
   */
  readonly show: (sample: DuelistSample, seconds: number, glow: number) => void;
}

/** The full-Focus aura's settings, with the Focus that fills the meter. */
export type WandAuraSettings = Tuning["wandAura"] & {
  readonly focusMax: number;
};

/** How Potions look on a Duelist, with how long one takes to drink. */
export type PotionLookSettings = Tuning["potionLook"] & {
  readonly drinkSeconds: number;
};

export interface DuelistViewSettings {
  readonly duelist: Tuning["duelist"];
  readonly glow: Tuning["lockOnGlow"];
  readonly stone: Tuning["petrifiedLook"];
  readonly aura: WandAuraSettings;
  readonly potion: PotionLookSettings;
  /** How long a Dodge lasts: the roll's length. */
  readonly dodgeSeconds: number;
}

type Triple = readonly [number, number, number];

const vector = ([x, y, z]: Triple) => new Vector3(x, y, z);

/** A Wand-hand pose: where the hand is and which way the Wand points from it. */
interface ArmPose {
  readonly hand: Vector3;
  readonly wand: Vector3;
}

const armPose = (hand: Vector3, wand: Vector3): ArmPose => ({
  hand,
  wand: wand.normalize(),
});

const copyArm = (to: ArmPose, from: ArmPose) => {
  to.hand.copy(from.hand);
  to.wand.copy(from.wand);
};

/** Blends `pose` toward `target` by `weight`: hands straight, Wand directions renormalised. */
const blendArm = (pose: ArmPose, target: ArmPose, weight: number) => {
  if (weight <= 0) {
    return;
  }

  pose.hand.lerp(target.hand, weight);
  pose.wand.lerp(target.wand, weight).normalize();
};

/** Uploads a cloth sheet's new positions and recomputes its normals. */
const finish = (sheet: Cloth) => {
  const { geometry } = sheet.mesh;
  geometry.getAttribute("position").needsUpdate = true;
  geometry.computeVertexNormals();
};

/** Clamps `value` to within `most` either side of zero. */
const limit = (value: number, most: number) =>
  Math.max(-most, Math.min(most, value));

/** A one-shot's age; infinite when it is not playing. */
const idle = Number.POSITIVE_INFINITY;

const up = new Vector3(0, 1, 0);
const scratch = new Vector3();
const basis = new Matrix4();
const axisX = new Vector3();
const axisY = new Vector3();
const axisZ = new Vector3();
const sideways = new Vector3(1, 0, 0);
const forearm = new Vector3();

/** Points a segment's +y from `from` toward `to`. */
const place = (segment: Object3D, from: Vector3, to: Vector3) => {
  segment.position.copy(from);
  scratch.subVectors(to, from).normalize();
  segment.quaternion.setFromUnitVectors(up, scratch);
};

/** Turns a part so its +y runs along `along` with its +z as close to `facing` as it can be, without twisting. */
const orient = (part: Object3D, along: Vector3, facing: Vector3) => {
  axisY.copy(along).normalize();
  axisX.crossVectors(axisY, facing);

  if (axisX.lengthSq() < 1e-6) {
    axisX.crossVectors(axisY, sideways);
  }

  axisX.normalize();
  axisZ.crossVectors(axisX, axisY);
  basis.makeBasis(axisX, axisY, axisZ);
  part.quaternion.setFromRotationMatrix(basis);
};

/** A point `local` in `node`'s frame, in the body frame (`node`'s ancestors up to the body). */
const inBody = (
  node: Object3D,
  local: Vector3,
  body: Object3D,
  out: Vector3
) => {
  out.copy(local);
  let at: Object3D | null = node;

  while (at && at !== body) {
    at.updateMatrix();
    out.applyMatrix4(at.matrix);
    at = at.parent;
  }

  return out;
};

export const createDuelistView = (
  id: DuelistId,
  team: TeamLook,
  settings: DuelistViewSettings
): DuelistView => {
  const { aura, dodgeSeconds, duelist, glow, potion, stone } = settings;
  const { body: build, cloth, gait: walk, poses, wand } = duelist;
  const wizard = createWizardBody(team, settings);
  const { uniforms } = wizard;

  const object = new Group();
  object.add(wizard.body);

  // The resting Wand hand: a Wand's length behind the simulation's tip.
  const { forward, height, right } = duelist.wandTip;
  const restWand = vector(poses.restWand).normalize();

  const rest = armPose(
    new Vector3(-right, height, forward).addScaledVector(
      restWand,
      -wand.length
    ),
    restWand.clone()
  );

  const poseOf = (hand: Triple, pointing: Triple) =>
    armPose(vector(hand), vector(pointing));

  const charge = poseOf(poses.charge.hand, poses.charge.wand);
  const shield = poseOf(poses.shield.hand, poses.shield.wand);
  const drink = poseOf(poses.drink.hand, poses.drink.wand);
  const stagger = poseOf(poses.stagger.hand, poses.stagger.wand);
  const recoil = poseOf(poses.recoil.hand, poses.recoil.wand);
  const knockback = armPose(vector(poses.knockback.hand), restWand.clone());
  const push = armPose(vector(poses.push.hand), restWand.clone());
  const clash = armPose(vector(poses.clash.hand), new Vector3(0, 0, 1));
  const pickup = armPose(vector(poses.pickup.hand), new Vector3(0.1, -0.3, 1));
  const tuck = armPose(vector(poses.rollTuck.hand), new Vector3(0.3, 0.6, 0.6));

  const fallen = armPose(
    vector(poses.knockout.hand),
    new Vector3(-0.5, 0.3, -0.2)
  );

  const strike = armPose(vector(poses.strike.hand), new Vector3(0, 0, 1));
  const reach = armPose(new Vector3(), new Vector3(0, 0, 1));

  const leftRest = vector(poses.leftHand);
  const leftCharge = vector(poses.charge.leftHand);
  const leftShield = vector(poses.shield.leftHand);
  const leftPush = vector(poses.push.leftHand);
  const leftKnockback = vector(poses.knockback.leftHand);
  const leftStagger = vector(poses.stagger.leftHand);
  const leftTuck = vector(poses.rollTuck.leftHand);
  const leftFallen = vector(poses.knockout.leftHand);
  const clashGrip = vector(poses.clash.grip);
  const vialFrom = vector(poses.drink.vialFrom);
  const vialTo = vector(poses.drink.vialTo);

  const elbowHints = [
    vector(poses.elbowHint),
    vector(poses.elbowHint).multiply(new Vector3(-1, 1, 1)),
  ] as const;

  const kneeHint = vector(poses.kneeHint);

  // This frame's pose, the last one drawn (where a swing or recoil starts)
  // and the one a swing or recoil sweeps from.
  const arm = armPose(new Vector3(), new Vector3(0, 0, 1));
  const drawn = armPose(rest.hand.clone(), rest.wand.clone());
  const sweepFrom = armPose(new Vector3(), new Vector3(0, 0, 1));
  const settle = armPose(new Vector3(), new Vector3(0, 0, 1));
  const left = new Vector3();
  const vial = new Vector3();

  // Solved joints, in the body frame; index 0 is the left side.
  const shoulder = [new Vector3(), new Vector3()] as const;
  const elbow = [new Vector3(), new Vector3()] as const;
  const hand = [new Vector3(), new Vector3()] as const;
  const hip = [new Vector3(), new Vector3()] as const;
  const knee = [new Vector3(), new Vector3()] as const;
  const ankle = [new Vector3(), new Vector3()] as const;
  const footAt = [new Vector3(), new Vector3()] as const;
  // Where each foot is off its standing home, and its settling step home.
  const stepOffset = [new Vector3(), new Vector3()] as const;
  const stepFrom = [new Vector3(), new Vector3()] as const;
  const stepAge: [number, number] = [idle, idle];
  // Walking, whether each foot is planted, where on the floor (world), and
  // where it lifted off from (body frame).
  const planted: [boolean, boolean] = [false, false];
  const anchor = [new Vector3(), new Vector3()] as const;
  const liftOff = [new Vector3(), new Vector3()] as const;
  const landingAt = new Vector3();
  const home = new Vector3();
  const footPitch = [0, 0];

  const strides: [Stride, Stride] = [
    { along: 0, lift: 0, swing: 0, swinging: false },
    { along: 0, lift: 0, swing: 0, swinging: false },
  ];

  // Motion, measured from the samples: how fast and which way, in the body frame.
  const gait = createGait(walk);
  let speed = 0;
  let gaitWeight = 0;
  let walking = false;
  const heading = new Vector3(0, 0, 1);
  const velocity = new Vector3();
  let fall = 0;
  let last: { x: number; z: number; elevation: number } | null = null;

  // Eased state weights.
  const weight = {
    air: 0,
    charge: 0,
    clash: 0,
    disarmed: 0,
    drink: 0,
    knockback: 0,
    shield: 0,
    stagger: 0,
  };

  // One-shot motions: their ages in seconds.
  let flickAge = idle;
  let flickKind: keyof typeof poses.flicks = "stupefy";
  let swingAge = idle;
  let recoilAge = idle;
  let pushAge = idle;
  let landAge = idle;
  let flinchAge = idle;
  let pickupAge = idle;
  let rollAge = idle;
  let knockoutAge = idle;
  // The Knockout fall, 0 standing to 1 lying, held while getting back up.
  let toppled = 0;
  const rollWorld = { x: 0, z: 1 };
  let petrified = false;
  let clock = 0;

  const skirtSpring = createSpring(cloth.spring);
  const mantleSpring = createSpring(cloth.spring);
  const springTarget = new Vector3();

  // Full Focus: the Wand in hand breathes its aura.
  let auraClock = 0;

  const breathe = (sample: DuelistSample, seconds: number) => {
    auraClock += seconds;

    const breath =
      aura.low +
      (1 - aura.low) *
        (0.5 + 0.5 * Math.sin(auraClock * aura.pulseSpeed * Math.PI * 2));

    const wanted =
      sample.focus >= aura.focusMax && !sample.disarmed ? breath : 0;

    uniforms.auraStrength.value = approach(
      uniforms.auraStrength.value,
      wanted,
      aura.fadeSharpness,
      seconds
    );
  };

  // The silhouette's flash as a Potion goes down, and the lasting auras.
  let flashAge = idle;
  let flashKind: PotionKind = "wiggenweld";
  let potionClock = 0;
  const lastingTint = new Color();
  const flashTint = new Color();

  const glowPotions = (sample: DuelistSample, seconds: number) => {
    potionClock += seconds;
    flashAge += seconds;
    const { strength, swiftness } = sample.potionEffects;
    const lasting = strength > 0 || swiftness > 0;

    const breath =
      potion.low +
      (1 - potion.low) *
        (0.5 + 0.5 * Math.sin(potionClock * potion.pulseSpeed * Math.PI * 2));

    const wanted = lasting && !sample.knockedOut ? breath * potion.radiance : 0;
    uniforms.potionGlow.value = approach(
      uniforms.potionGlow.value,
      wanted,
      potion.fadeSharpness,
      seconds
    );

    if (strength > 0 && swiftness > 0) {
      lastingTint
        .set(potion.colors.strength)
        .lerp(flashTint.set(potion.colors.swiftness), 0.5);
    } else if (lasting) {
      lastingTint.set(potion.colors[strength > 0 ? "strength" : "swiftness"]);
    }

    if (lasting) {
      uniforms.potionTint.value.copy(lastingTint);
    }

    const flash =
      flashAge < potion.flashSeconds
        ? (1 - flashAge / potion.flashSeconds) ** 2
        : 0;

    if (flash > 0) {
      uniforms.potionTint.value.lerp(
        flashTint.set(potion.colors[flashKind]),
        flash
      );
      uniforms.potionGlow.value = Math.max(
        uniforms.potionGlow.value,
        flash * potion.flashRadiance
      );
    }
  };

  /** How long a step is this way, as a share of a step straight ahead. */
  const stepShare = () => Math.hypot(heading.z, heading.x * walk.sideStep);

  /** Measures the body's motion from the samples and advances the gait. */
  const measure = (sample: DuelistSample, seconds: number) => {
    const { position, elevation } = sample;
    const yaw = Math.atan2(sample.facing.x, sample.facing.z);
    let dx = 0;
    let dz = 0;
    let dy = 0;

    if (last && seconds > 0) {
      dx = position.x - last.x;
      dz = position.z - last.z;
      dy = elevation - last.elevation;
    }

    last = { elevation, x: position.x, z: position.z };

    // A jump of position (a new Round lining everyone up) is not motion.
    if (Math.hypot(dx, dz) > walk.maxSweep * 2) {
      dx = 0;
      dz = 0;
      skirtSpring.reset(springTarget.set(0, 0, 0));
      mantleSpring.reset(springTarget);
    }

    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const localX = dx * cos - dz * sin;
    const localZ = dx * sin + dz * cos;
    const distance = Math.hypot(localX, localZ);
    const rate = seconds > 0 ? 1 / seconds : 0;
    velocity.set(localX * rate, 0, localZ * rate);
    fall = Math.max(-dy * rate, 0);

    const travelling =
      elevation <= 1e-3 &&
      !sample.dodging &&
      !sample.knockedBack &&
      !sample.knockedOut &&
      !sample.clashing;

    speed = approach(
      speed,
      travelling ? distance * rate : 0,
      walk.speedSharpness,
      seconds
    );

    if (distance > 1e-5) {
      heading
        .lerp(
          scratch.set(localX / distance, 0, localZ / distance),
          1 - Math.exp(-walk.speedSharpness * seconds)
        )
        .normalize();
    }

    walking = travelling && speed > walk.minSpeed;
    gaitWeight = approach(
      gaitWeight,
      walking ? 1 : 0,
      walk.weightSharpness,
      seconds
    );

    // A shorter step covers its ground in more of the cycle, so the planted
    // foot still slides back exactly as fast as the body moves.
    if (travelling) {
      gait.advance(distance / stepShare(), speed);
    }
  };

  /** Eases every state's weight toward whether the sample is in it. */
  const easeWeights = (sample: DuelistSample, seconds: number) => {
    const ease = (now: number, on: boolean, sharpness = poses.sharpness) =>
      approach(now, on ? 1 : 0, sharpness, seconds);

    const down = sample.knockedOut;

    weight.air = ease(weight.air, sample.elevation > 0.02 && !down);
    weight.charge = ease(
      weight.charge,
      sample.charging && !down,
      wand.poseSharpness
    );
    weight.clash = ease(weight.clash, sample.clashing && !down);
    weight.disarmed = ease(weight.disarmed, sample.disarmed && !down);
    weight.drink = ease(weight.drink, sample.drinking !== null && !down);
    weight.knockback = ease(weight.knockback, sample.knockedBack && !down);
    weight.shield = ease(weight.shield, sample.shielding && !down);
    weight.stagger = ease(weight.stagger, sample.staggered && !down);
  };

  /** The Dodge's tuck, 0 to 1: in over its first `tuckShare`, out over its last. */
  const tuckOf = () => {
    if (rollAge >= dodgeSeconds) {
      return 0;
    }

    const progress = rollAge / dodgeSeconds;
    const edge = duelist.roll.tuckShare;

    return smooth(progress / edge) * smooth((1 - progress) / edge);
  };

  /** How far into drinking (0 to 1) and how far the vial is lifted (0 to 1). */
  const drinkShare = (sample: DuelistSample) => {
    if (!sample.drinking) {
      return { lift: 0, share: 0 };
    }

    const share = Math.min(
      Math.max(1 - sample.drinking.secondsLeft / potion.drinkSeconds, 0),
      1
    );

    return { lift: smooth(share / 0.25), share };
  };

  /** Where the Wand hand reaches this frame, and where it points. */
  const poseWandArm = (sample: DuelistSample, bob: number) => {
    copyArm(arm, rest);
    arm.hand.y += walk.wandBob * bob * gaitWeight;
    blendArm(arm, charge, weight.charge);
    blendArm(arm, shield, weight.shield);
    blendArm(arm, drink, weight.drink);

    if (sample.looseWand && weight.disarmed > 0) {
      // Disarmed: the empty hand reaches toward the loose Wand, grasping.
      const yaw = Math.atan2(sample.facing.x, sample.facing.z);
      const dx = sample.looseWand.x - sample.position.x;
      const dz = sample.looseWand.z - sample.position.z;
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      reach.wand
        .set(
          dx * cos - dz * sin,
          0,
          Math.max(dx * sin + dz * cos, poses.disarmed.behind)
        )
        .normalize();
      reach.hand
        .set(-build.shoulderWidth, poses.disarmed.height, 0)
        .addScaledVector(reach.wand, poses.disarmed.reach);
      reach.hand.y +=
        poses.disarmed.grasp *
        Math.sin(clock * poses.disarmed.graspRate * Math.PI * 2);
      blendArm(arm, reach, weight.disarmed);
    }

    blendArm(arm, knockback, weight.knockback);
    blendArm(arm, stagger, weight.stagger);

    // A Clash: the Wand along the beam, straight ahead at the opponent, trembling.
    if (weight.clash > 0) {
      const shake =
        poses.clash.tremble *
        Math.sin(clock * poses.clash.trembleRate * Math.PI * 2);

      clash.hand.set(
        poses.clash.hand[0] + shake,
        poses.clash.hand[1] + shake * 0.6,
        poses.clash.hand[2]
      );
      blendArm(arm, clash, weight.clash);
    }

    // A flick for a Light or Special cast: the Wand snaps up and across, and back.
    if (flickAge < wand.flickSeconds) {
      const flick = poses.flicks[flickKind];
      const amount = pulse(flickAge / wand.flickSeconds, 0.35);
      arm.wand.applyAxisAngle(axisX.set(1, 0, 0), -flick.raise * amount);
      arm.wand.applyAxisAngle(up, flick.inward * amount);
      arm.hand.z += flick.reach * amount;
    }

    if (pushAge < wand.pushSeconds) {
      blendArm(arm, push, pulse(pushAge / wand.pushSeconds, 0.25));
    }

    // Confringo: from wherever the Wand was (overhead), accelerating down
    // through the aim and past it, then settling into the pose beneath.
    if (swingAge < wand.swingSeconds) {
      const progress = swingAge / wand.swingSeconds;
      const share = wand.swingStrikeShare;

      const pitch =
        Math.max(-1, Math.min(1, sample.aim.pitch)) - wand.swingFollowThrough;

      strike.wand.set(
        Math.sin(wand.swingInward) * Math.cos(pitch),
        Math.sin(pitch),
        Math.cos(wand.swingInward) * Math.cos(pitch)
      );

      if (progress < share) {
        copyArm(arm, sweepFrom);
        blendArm(arm, strike, easeIn(progress / share));
      } else {
        copyArm(settle, strike);
        blendArm(settle, arm, smooth((progress - share) / (1 - share)));
        copyArm(arm, settle);
      }
    }

    // A Backfire: flung down and away, then settling.
    if (recoilAge < wand.recoilSeconds) {
      const progress = recoilAge / wand.recoilSeconds;
      const share = wand.recoilDropShare;

      if (progress < share) {
        copyArm(arm, sweepFrom);
        blendArm(arm, recoil, 1 - (1 - progress / share) ** 3);
      } else {
        copyArm(settle, recoil);
        blendArm(settle, arm, smooth((progress - share) / (1 - share)));
        copyArm(arm, settle);
      }
    }

    if (pickupAge < poses.pickup.seconds) {
      blendArm(
        arm,
        pickup,
        pulse(pickupAge / poses.pickup.seconds, poses.pickup.peak)
      );
    }
  };

  /** Where the free hand reaches this frame. */
  const poseFreeArm = (sample: DuelistSample, run: number) => {
    left.copy(leftRest);
    // It swings with the opposite foot and comes up bent at a run.
    const [, rightStride] = strides;
    left.z +=
      walk.armSwing * rightStride.along * heading.z * gaitWeight + 0.1 * run;
    left.y += walk.runArmLift * run;
    left.lerp(leftCharge, weight.charge);
    left.lerp(leftShield, weight.shield);

    if (weight.clash > 0) {
      // Both hands on the Wand.
      left.lerp(scratch.copy(arm.hand).add(clashGrip), weight.clash);
    }

    left.lerp(leftKnockback, weight.knockback);
    left.lerp(leftStagger, weight.stagger);

    if (pushAge < wand.pushSeconds) {
      left.lerp(leftPush, pulse(pushAge / wand.pushSeconds, 0.25));
    }

    const { lift } = drinkShare(sample);
    vial.lerpVectors(vialFrom, vialTo, lift);
    left.lerp(vial, weight.drink);
  };

  /** The body frame to the world's floor and back, through the root alone. */
  const toWorld = (local: Vector3, out: Vector3) => {
    const yaw = object.rotation.y;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);

    return out.set(
      object.position.x + local.x * cos + local.z * sin,
      0,
      object.position.z - local.x * sin + local.z * cos
    );
  };

  const toBody = (world: Vector3, out: Vector3) => {
    const yaw = object.rotation.y;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const dx = world.x - object.position.x;
    const dz = world.z - object.position.z;

    return out.set(dx * cos - dz * sin, 0, dx * sin + dz * cos);
  };

  /**
   * Walking: a planted foot is pinned to the spot on the floor where it
   * touched down, so it cannot slide whatever the body does (turning,
   * reversing, slowing); a swinging foot travels from where it lifted off to
   * its next landing ahead along the motion.
   */
  const stepFoot = (side: 0 | 1, stride: Stride) => {
    const offset = stepOffset[side];
    const sign = side === 0 ? 1 : -1;

    if (stride.swinging) {
      if (planted[side]) {
        planted[side] = false;
        liftOff[side].copy(offset).setY(0);
      }

      landingAt.copy(heading).multiplyScalar((gait.sweep() / 2) * stepShare());
      // Side-stepping, the feet pass one a little ahead of the other.
      landingAt.z += sign * walk.footGap * Math.abs(heading.x);
      offset.lerpVectors(liftOff[side], landingAt, smooth(stride.swing));
      offset.y = stride.lift * gaitWeight;

      return;
    }

    if (!planted[side]) {
      planted[side] = true;
      toWorld(scratch.copy(home).add(offset), anchor[side]);
    }

    toBody(anchor[side], offset).sub(home).setY(0);

    // A foot left far behind (a shove, a teleport) is planted afresh.
    if (Math.hypot(offset.x, offset.z) > walk.maxSweep) {
      offset.setLength(walk.maxSweep);
      toWorld(scratch.copy(home).add(offset), anchor[side]);
    }
  };

  /**
   * Stopped, a foot left out of place steps back home (one foot at a time,
   * lifted) rather than sliding there.
   */
  const settleFoot = (side: 0 | 1, seconds: number) => {
    const offset = stepOffset[side];
    const other = side === 0 ? 1 : 0;

    if (stepAge[side] === idle) {
      const away = offset.lengthSq();
      const otherAway = stepOffset[other].lengthSq();

      if (
        away < 1e-6 ||
        stepAge[other] !== idle ||
        (otherAway > away && side === 0)
      ) {
        return;
      }

      stepFrom[side].copy(offset);
      stepAge[side] = 0;
    }

    stepAge[side] += seconds;
    const progress = Math.min(stepAge[side] / walk.settleSeconds, 1);
    const from = stepFrom[side];
    offset.copy(from).multiplyScalar(1 - smooth(progress));
    offset.y +=
      walk.settleLift *
      Math.sin(Math.PI * progress) *
      Math.min(Math.hypot(from.x, from.z) / walk.footSpread, 1);

    if (progress >= 1) {
      offset.set(0, 0, 0);
      stepAge[side] = idle;
    }
  };

  /** Writes the gait's strides and each foot's target. */
  const poseFeet = (spread: number, tuckAmount: number, seconds: number) => {
    const offsets = [0, 0.5] as const;

    for (const side of [0, 1] as const) {
      const sign = side === 0 ? 1 : -1;
      const offset = stepOffset[side];
      home.set(sign * (walk.footSpread + spread), build.ankleHeight, 0);

      if (walking) {
        stepAge[side] = idle;
        stepFoot(side, gait.stride(offsets[side], strides[side]));
      } else {
        settleFoot(side, seconds);
        // Standing, both feet count as planted where they are, so the first
        // step of a walk lifts off from there.
        planted[side] = true;
        toWorld(scratch.copy(home).add(offset), anchor[side]);
      }

      const target = footAt[side];
      target.copy(home).add(offset);
      // The Clash stance: Wand foot forward, the other braced behind.
      target.z +=
        (side === 0 ? poses.clash.back : poses.clash.front) * weight.clash;
      target.x += sign * poses.clash.spread * weight.clash;
      target.y += poses.jump.tuck * weight.air;
      target.z += poses.jump.tuckForward * weight.air;
      target.y += poses.rollTuck.knees[0] * tuckAmount;
      target.z += poses.rollTuck.knees[1] * tuckAmount;
      footPitch[side] =
        walk.footPitch * Math.min(offset.y / 0.15, 1) + 0.5 * weight.air;
    }
  };

  /** Solves the limbs from the spine's pose and draws every segment. */
  const solveLimbs = () => {
    const {
      chest,
      feet,
      forearms,
      hands,
      hips: hipJoints,
      pelvis,
      shins,
      shoulders,
      thighs,
      upperArms,
    } = wizard;

    for (const s of [0, 1] as const) {
      inBody(shoulders[s], scratch.set(0, 0, 0), wizard.body, shoulder[s]);
      solveLimb(
        shoulder[s],
        s === 0 ? left : arm.hand,
        build.upperArm,
        build.forearm,
        elbowHints[s],
        elbow[s],
        hand[s]
      );
      place(upperArms[s], shoulder[s], elbow[s]);
      place(forearms[s], elbow[s], hand[s]);
      hands[s].position.copy(hand[s]);
      orient(
        hands[s],
        forearm.subVectors(hand[s], elbow[s]),
        s === 0 ? scratch.set(0, 0, 1) : arm.wand
      );

      inBody(hipJoints[s], scratch.set(0, 0, 0), wizard.body, hip[s]);
      solveLimb(
        hip[s],
        footAt[s],
        build.thigh,
        build.shin,
        kneeHint,
        knee[s],
        ankle[s]
      );
      place(thighs[s], hip[s], knee[s]);
      place(shins[s], knee[s], ankle[s]);
      feet[s].position.copy(ankle[s]);
      feet[s].rotation.set(footPitch[s] ?? 0, 0, 0);
    }

    // Keep the spine's matrices current for the cloth.
    pelvis.updateMatrix();
    chest.updateMatrix();

    wizard.wand.position.copy(hand[1]);
    wizard.wand.quaternion.setFromUnitVectors(up, arm.wand);
  };

  /** Turns the whole body for the Dodge roll, lifted so it never sinks through the floor. */
  const rollQuaternion = new Quaternion();
  const rollAxis = new Vector3();
  const extent = new Vector3();
  const extremities: Vector3[] = [];
  // The top of the hat (or hood) above the centre of the head.
  const { hat } = build;

  const crown = new Vector3(
    0,
    wizard.hatTip
      ? hat.height + hat.crown + hat.point
      : build.hood.radius * build.hood.stretch,
    0
  );

  const roll = (tuckAmount: number) => {
    const { body } = wizard;
    const progress = rollAge / dodgeSeconds;
    const size = 1 + (duelist.roll.scale - 1) * tuckAmount;
    const angle = duelist.roll.turns * Math.PI * 2 * smooth(progress);
    const yaw = object.rotation.y;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    // The Dodge's direction in the body frame; the roll's axis lies across it.
    const across = rollWorld.x * cos - rollWorld.z * sin;
    const along = rollWorld.x * sin + rollWorld.z * cos;
    rollAxis.set(along, 0, -across).normalize();
    rollQuaternion.setFromAxisAngle(rollAxis, angle);

    const pivot = duelist.roll.pivotHeight;
    let lowest = pivot * size;

    for (const point of extremities) {
      extent
        .set(point.x, point.y - pivot, point.z)
        .multiplyScalar(size)
        .applyQuaternion(rollQuaternion);
      lowest = Math.max(lowest, -extent.y + 0.06 * size);
    }

    body.scale.setScalar(size);
    body.quaternion.copy(rollQuaternion);
    extent.set(0, pivot * size, 0).applyQuaternion(rollQuaternion);
    body.position.set(-extent.x, lowest - extent.y, -extent.z);
  };

  /** The posed body's extremities (body frame): what must clear the floor in a roll. */
  const gatherExtremities = () => {
    extremities.length = 0;
    extremities.push(
      hand[0],
      hand[1],
      elbow[0],
      elbow[1],
      knee[0],
      knee[1],
      ankle[0],
      ankle[1],
      inBody(wizard.head, crown, wizard.body, new Vector3()),
      inBody(wizard.tip, scratch.set(0, 0, 0), wizard.body, new Vector3())
    );
  };

  const worldUp = new Vector3();

  /**
   * Where world-up points in `node`'s frame (scaled by its world scale), and
   * the height of its origin: what keeps cloth above the floor.
   */
  const floorFrame = (node: Object3D) => {
    const e = node.matrixWorld.elements;
    worldUp.set(e[1] ?? 0, e[5] ?? 0, e[9] ?? 1);

    return { floor: e[13] ?? 0, scale: worldUp.lengthSq() };
  };

  /** Lifts a local cloth point to the floor's clearance if it sank below it. */
  const keepAboveFloor = (
    positions: Float32Array,
    at: number,
    frame: { floor: number; scale: number }
  ) => {
    const x = positions[at] ?? 0;
    const y = positions[at + 1] ?? 0;
    const z = positions[at + 2] ?? 0;

    const heightNow =
      worldUp.x * x + worldUp.y * y + worldUp.z * z + frame.floor;

    if (heightNow < cloth.floorClearance) {
      const lift = (cloth.floorClearance - heightNow) / frame.scale;
      positions[at] = x + worldUp.x * lift;
      positions[at + 1] = y + worldUp.y * lift;
      positions[at + 2] = z + worldUp.z * lift;
    }
  };

  const pelvisInverse = new Matrix4();
  const legPoint = new Vector3();

  const legs = [
    { ankle: new Vector3(), hip: new Vector3(), knee: new Vector3() },
    { ankle: new Vector3(), hip: new Vector3(), knee: new Vector3() },
  ] as const;

  /** Where a leg crosses height `y` (pelvis frame), from the hip down to the ankle. */
  const legAt = (leg: (typeof legs)[number], y: number) => {
    const upperSpan = leg.hip.y - leg.knee.y;

    if (upperSpan > 0.05 && y >= leg.knee.y) {
      return legPoint.lerpVectors(
        leg.hip,
        leg.knee,
        Math.min(Math.max((leg.hip.y - y) / upperSpan, 0), 1)
      );
    }

    const lowerSpan = leg.knee.y - leg.ankle.y;

    return lowerSpan > 0.05
      ? legPoint.lerpVectors(
          leg.knee,
          leg.ankle,
          Math.min(Math.max((leg.knee.y - y) / lowerSpan, 0), 1)
        )
      : legPoint.copy(leg.knee);
  };

  /** Drapes the skirt: lagging, flaring, tenting over the legs, above the floor. */
  const drapeSkirt = () => {
    const { skirt } = wizard;
    const { positions } = skirt;
    const sway = skirtSpring.position;
    const flare = cloth.flarePerSpeed * speed + cloth.flarePerFall * fall;
    const { ripple } = cloth;
    const swaying = Math.hypot(sway.x, sway.z);

    pelvisInverse.copy(wizard.pelvis.matrix).invert();

    for (const side of [0, 1] as const) {
      const leg = legs[side];
      leg.hip.copy(wizard.hips[side].position);
      leg.knee.copy(knee[side]).applyMatrix4(pelvisInverse);
      leg.ankle.copy(ankle[side]).applyMatrix4(pelvisInverse);
    }

    const frame = floorFrame(wizard.pelvis);

    for (let row = 0; row < skirt.rows; row += 1) {
      const t = row / (skirt.rows - 1);
      const hang = t * t;

      for (let column = 0; column < skirt.columns; column += 1) {
        const at = (row * skirt.columns + column) * 3;
        const angle = (column / (skirt.columns - 1)) * Math.PI * 2;

        const wave =
          1 +
          flare * hang +
          (ripple.amplitude *
            hang *
            (1 + swaying * 4) *
            Math.sin(angle * ripple.waves + clock * ripple.speed)) /
            cloth.skirt.hemRadius;

        let x = (skirt.rest[at] ?? 0) * wave + sway.x * hang;
        const y = (skirt.rest[at + 1] ?? 0) + swaying * hang * 0.4;
        let z = (skirt.rest[at + 2] ?? 0) * wave + sway.z * hang;

        // Tent over each leg that pushes out past the cloth.
        for (const leg of legs) {
          const reachOut = Math.hypot(x, z);

          if (reachOut < 1e-4) {
            continue;
          }

          const dirX = x / reachOut;
          const dirZ = z / reachOut;
          const point = legAt(leg, y);
          const outward = point.x * dirX + point.z * dirZ;

          const offAxis = Math.hypot(
            point.x - dirX * outward,
            point.z - dirZ * outward
          );

          // Hidden under the coat at the top, the cloth only tents lower down.
          const tent =
            (outward + cloth.legRadius - reachOut) *
            (1 - smooth(offAxis / cloth.legSpan)) *
            smooth(t / cloth.legTentFrom);

          if (tent > 0) {
            x += dirX * tent;
            z += dirZ * tent;
          }
        }

        positions[at] = x;
        positions[at + 1] = y;
        positions[at + 2] = z;
        keepAboveFloor(positions, at, frame);
      }
    }

    finish(skirt);
  };

  /** How far the body's back reaches behind the spine at height `y` in the chest frame. */
  const backAt = (y: number) => {
    const { coat } = build;
    const [bottom] = coat;

    if (y >= bottom[1]) {
      for (let index = 1; index < coat.length; index += 1) {
        const below = coat[index - 1];
        const above = coat[index];

        if (below && above && y <= above[1]) {
          const share = (y - below[1]) / (above[1] - below[1]);

          return (below[0] + (above[0] - below[0]) * share) * build.torsoDepth;
        }
      }

      return 0;
    }

    const { skirt } = cloth;

    const t = Math.min(
      Math.max((skirt.top - (y + build.waist)) / (skirt.top - skirt.hem), 0),
      1
    );

    return (
      (skirt.topRadius +
        (skirt.hemRadius - skirt.topRadius) * t ** skirt.flareCurve) *
      skirt.depthScale
    );
  };

  /** Drapes the mantle: hanging with gravity, streaming back and fluttering, off the back and above the floor. */
  const drapeMantle = () => {
    const { mantle } = wizard;
    const { positions } = mantle;
    const sway = mantleSpring.position;
    const frame = floorFrame(wizard.chest);
    // World down in the chest frame: leaning forward lays the mantle on the back.
    const downScale = 1 / Math.sqrt(frame.scale);
    const downY = -worldUp.y * downScale;
    const downZ = -worldUp.z * downScale;
    const streaming = Math.hypot(sway.x, sway.z);

    const flutter =
      cloth.flutter.amplitude *
      Math.min(speed / duelist.walkSpeed + streaming * 2, 1.5);

    for (let row = 0; row < mantle.rows; row += 1) {
      const t = row / (mantle.rows - 1);
      const drop = t * cloth.mantle.length;

      for (let column = 0; column < mantle.columns; column += 1) {
        const at = (row * mantle.columns + column) * 3;
        const across = column / (mantle.columns - 1);
        const x = (mantle.rest[at] ?? 0) + sway.x * t;

        let y =
          (mantle.rest[at + 1] ?? 0) +
          drop * (1 + downY) +
          (sway.y + streaming * cloth.mantleLift) * t;

        let z =
          (mantle.rest[at + 2] ?? 0) +
          drop * downZ +
          sway.z * t +
          flutter *
            t *
            Math.sin(
              (t * cloth.flutter.waves -
                (clock * cloth.flutter.speed) / (Math.PI * 2) +
                across * 0.3) *
                Math.PI *
                2
            );

        // Never through the back.
        const back = backAt(y) + 0.02;
        const width = back / build.torsoDepth;

        const behind =
          -back * Math.sqrt(Math.max(1 - (x / Math.max(width, 1e-3)) ** 2, 0));

        z = Math.min(z, behind);
        y = Math.min(y, cloth.mantle.top);

        positions[at] = x;
        positions[at + 1] = y;
        positions[at + 2] = z;
        keepAboveFloor(positions, at, frame);
      }
    }

    finish(mantle);
  };

  /** Steps the cloth springs toward the body's lag. */
  const swingCloth = (seconds: number) => {
    springTarget.set(
      limit(-velocity.x * cloth.drag, cloth.maxSway),
      0,
      limit(-velocity.z * cloth.drag, cloth.maxSway)
    );
    skirtSpring.advance(springTarget, seconds);
    springTarget.set(
      limit(-velocity.x * cloth.mantleDrag, cloth.maxSway),
      limit(fall * cloth.flarePerFall, cloth.maxSway * 0.5),
      limit(-velocity.z * cloth.mantleDrag, cloth.maxSway)
    );
    mantleSpring.advance(springTarget, seconds);

    if (wizard.hatTip) {
      const sway = mantleSpring.position;
      wizard.hatTip.rotation.set(
        -cloth.hatBend + sway.z * cloth.hatSway,
        0,
        -sway.x * cloth.hatSway
      );
    }
  };

  /** Poses the whole body for `seconds` (0 while Petrified: frozen). */
  const pose = (sample: DuelistSample, seconds: number) => {
    measure(sample, seconds);
    easeWeights(sample, seconds);

    clock += seconds;

    flickAge += seconds;
    swingAge += seconds;
    recoilAge += seconds;
    pushAge += seconds;
    landAge += seconds;
    flinchAge += seconds;
    pickupAge += seconds;
    rollAge += seconds;

    if (sample.knockedOut) {
      knockoutAge = knockoutAge === idle ? 0 : knockoutAge + seconds;
      rollAge = idle;
    } else {
      knockoutAge = idle;
    }

    const tuckAmount = tuckOf();
    const phase = gait.phase();
    // Lowest twice a cycle, as each foot takes the weight mid-stance.
    const bob = 0.5 + 0.5 * Math.cos(Math.PI * 4 * (phase - gait.stance() / 2));
    const run = gaitWeight * ramp(walk.runFrom, walk.runAt, speed);
    const { breath } = poses;
    const breathing = Math.sin(clock * breath.rate * Math.PI * 2);
    const { lift: vialLift, share: drunk } = drinkShare(sample);

    // The Knockout: buckle, then topple onto the back; getting up eases out of it.
    const { knockout } = poses;
    let buckle = 0;

    if (knockoutAge === idle) {
      toppled = approach(toppled, 0, poses.sharpness, seconds);
    } else {
      buckle = smooth(knockoutAge / knockout.buckleSeconds);
      toppled = easeIn(
        (knockoutAge - knockout.buckleSeconds) / knockout.fallSeconds
      );
    }

    const landing =
      landAge < poses.land.seconds
        ? pulse(landAge / poses.land.seconds, poses.land.peak)
        : 0;

    const flinch =
      flinchAge < poses.flinch.seconds
        ? pulse(flinchAge / poses.flinch.seconds, poses.flinch.peak)
        : 0;

    const scoop =
      pickupAge < poses.pickup.seconds
        ? pulse(pickupAge / poses.pickup.seconds, poses.pickup.peak)
        : 0;

    const shove =
      pushAge < wand.pushSeconds ? pulse(pushAge / wand.pushSeconds, 0.25) : 0;

    const hunch =
      recoilAge < wand.recoilSeconds
        ? pulse(recoilAge / wand.recoilSeconds, wand.recoilDropShare)
        : 0;

    const wobble =
      Math.sin(clock * poses.stagger.wobbleRate * Math.PI * 2) *
      poses.stagger.wobble;

    const limitLean = (value: number) =>
      Math.max(-walk.maxLean, Math.min(walk.maxLean, value));

    const crouch =
      walk.bob * bob * gaitWeight * Math.min(speed / duelist.walkSpeed, 1) +
      poses.shield.crouch * weight.shield +
      poses.clash.crouch * weight.clash +
      poses.knockback.crouch * weight.knockback +
      poses.land.squash * landing +
      poses.pickup.crouch * scoop +
      poses.rollTuck.crouch * tuckAmount +
      knockout.buckle * buckle * (1 - toppled * 0.8);

    const lean =
      limitLean(walk.lean * velocity.z * gaitWeight) +
      breath.pitch * breathing +
      poses.charge.lean * weight.charge +
      poses.clash.lean * weight.clash +
      poses.disarmed.lean * weight.disarmed +
      poses.knockback.lean * weight.knockback +
      (poses.stagger.lean + wobble) * weight.stagger -
      poses.flinch.lean * flinch +
      poses.recoil.hunch * hunch +
      poses.push.lean * shove +
      poses.pickup.lean * scoop +
      poses.rollTuck.lean * tuckAmount +
      0.35 * buckle * (1 - toppled);

    const hipTurn = walk.hipTurn * Math.sin(phase * Math.PI * 2) * gaitWeight;
    const { pelvis, chest, head } = wizard;
    pelvis.position.set(
      breath.sway * Math.sin(clock * breath.swayRate * Math.PI * 2),
      build.pelvisHeight - crouch,
      -0.4 * crouch * Math.max(lean, 0)
    );
    pelvis.rotation.set(
      lean * 0.3,
      hipTurn,
      limitLean(-walk.lean * velocity.x * gaitWeight) * 0.4
    );
    chest.position.y = build.waist + breath.depth * 0.3 * breathing;
    chest.rotation.set(
      lean * 0.7,
      -hipTurn * (1 + walk.counterTwist),
      limitLean(-walk.lean * velocity.x * gaitWeight) * 0.6
    );
    // The head keeps looking along the aim whatever the chest does.
    head.rotation.set(
      -Math.max(-1, Math.min(1, sample.aim.pitch)) * 0.5 -
        lean * 0.6 +
        poses.stagger.head * weight.stagger -
        poses.flinch.head * flinch -
        poses.drink.headBack * smooth(drunk) * vialLift * weight.drink +
        0.4 * buckle * (1 - toppled),
      walk.counterTwist * hipTurn * 0.5,
      0
    );

    poseWandArm(sample, bob);
    blendArm(arm, tuck, tuckAmount);
    blendArm(arm, fallen, toppled);
    poseFreeArm(sample, run);
    left.lerp(leftTuck, tuckAmount);
    left.lerp(leftFallen, toppled);
    left.y += poses.jump.arms * weight.air;
    arm.hand.y += poses.jump.arms * weight.air;
    poseFeet(poses.shield.spread * weight.shield, tuckAmount, seconds);

    solveLimbs();
    copyArm(drawn, arm);

    // Whole-body turns: the Dodge roll, or the Knockout topple about the feet.
    const { body } = wizard;

    if (rollAge < dodgeSeconds) {
      gatherExtremities();
      roll(tuckAmount);
    } else {
      body.scale.setScalar(1);
      body.quaternion.setFromAxisAngle(
        axisX.set(1, 0, 0),
        (-Math.PI / 2) * toppled
      );
      body.position.set(0, knockout.lift * smooth(toppled * 2), 0);
    }

    object.updateMatrixWorld(true);
    swingCloth(seconds);
    drapeSkirt();
    drapeMantle();
  };

  /** Raises the vial while drinking: in the free hand, tipped toward the face. */
  const showVial = (sample: DuelistSample) => {
    const { vial: flask } = wizard;
    flask.visible = sample.drinking !== null && !sample.knockedOut;

    if (!sample.drinking) {
      return;
    }

    uniforms.vialTint.value.set(potion.colors[sample.drinking.kind]);
    const { lift, share } = drinkShare(sample);
    flask.position.copy(hand[0]).add(scratch.set(0, 0.07, 0));
    flask.rotation.set(
      -(0.2 + poses.drink.vialTip * smooth(share)) * lift,
      0,
      0.3 * lift
    );
  };

  const cast = (kind: SpellKind) => {
    flickAge = idle;
    pushAge = idle;
    swingAge = idle;
    recoilAge = idle;

    if (kind === "confringo") {
      copyArm(sweepFrom, drawn);
      swingAge = 0;
      weight.charge = 0;
    } else if (kind === "depulso") {
      pushAge = 0;
    } else {
      flickAge = 0;
      flickKind = kind;
    }
  };

  const react = (event: DuelEvent) => {
    if (event.type === "spell-cast") {
      if (event.spell.casterId === id) {
        cast(event.spell.kind);
      }
    } else if (event.type === "backfire") {
      if (event.duelistId === id) {
        copyArm(sweepFrom, drawn);
        recoilAge = 0;
        swingAge = idle;
        flickAge = idle;
        weight.charge = 0;
      }
    } else if (event.type === "dodge") {
      if (event.duelistId === id) {
        rollAge = 0;
        rollWorld.x = event.direction.x;
        rollWorld.z = event.direction.z;
      }
    } else if (event.type === "land") {
      if (event.duelistId === id) {
        landAge = 0;
      }
    } else if (event.type === "spell-hit") {
      if (event.targetId === id) {
        flinchAge = 0;
      }
    } else if (event.type === "wand-recovered") {
      if (event.duelistId === id && event.how === "pickup") {
        pickupAge = 0;
      }
    } else if (event.type === "potion-drunk" && event.duelistId === id) {
      flashAge = 0;
      flashKind = event.kind;
    }
  };

  const tipWorld = new Vector3();

  return {
    handle: (events) => {
      for (const event of events) {
        // Stone does not move: a Petrified Duelist's casts and Dodges do not play.
        if (!petrified || event.type === "potion-drunk") {
          react(event);
        }
      }
    },
    object,
    show: (sample, seconds, wantedGlow) => {
      ({ petrified } = sample);

      object.position.set(
        sample.position.x,
        sample.elevation,
        sample.position.z
      );
      object.rotation.y = Math.atan2(sample.facing.x, sample.facing.z);

      // Petrified, the pose freezes where it was: stone does not breathe.
      pose(sample, petrified ? 0 : seconds);

      wizard.wandStick.visible = !sample.disarmed;
      showVial(sample);
      breathe(sample, seconds);
      glowPotions(sample, seconds);
      uniforms.glowStrength.value = approach(
        uniforms.glowStrength.value,
        wantedGlow,
        glow.fadeSharpness,
        seconds
      );
      uniforms.petrify.value = approach(
        uniforms.petrify.value,
        sample.petrified ? 1 : 0,
        stone.fadeSharpness,
        seconds
      );
    },
    wandTipPosition: () => {
      wizard.tip.updateWorldMatrix(true, false);
      wizard.tip.getWorldPosition(tipWorld);

      return { x: tipWorld.x, y: tipWorld.y, z: tipWorld.z };
    },
  };
};
