/**
 * A Duelist drawn as a rigged wizard (`wizard-rig.ts`) animated with real
 * clips through an `AnimationMixer`. It only reads presentation samples and
 * simulation events.
 *
 * The pose is layered. Every clip is split into an upper body and a lower
 * body, so the legs can walk, run or brace while the arms cast, Charge,
 * Shield or drink. In each half a stack of clips blends: locomotion at the
 * bottom (its cycles advanced by the ground actually covered, blended by
 * speed, so the feet do not slide), then each state eased in and out over
 * what is beneath it (the armed stance, Protego, a Charge, drinking, a
 * Clash, a Stagger, airborne), then one-shots on their own timelines (each
 * Spell's cast, a Parry, a flinch, a knockback, a landing, a Wand pickup,
 * the Dodge roll, the Knockout and getting back up).
 *
 * After the clips, code writes what clips cannot know: moving off the
 * facing (there are no strafe clips) the legs turn toward the motion while
 * the spine turns the chest back; the head follows the aim's pitch; and the
 * right arm reaches by two-bone IK so the drawn Wand tip sits exactly on the
 * simulation's `wandTip` whenever the Wand is held ready, cast from,
 * Charged, Shielded with or locked in a Clash, so Spells visibly leave the
 * Wand. Disarmed, that hand reaches for the loose Wand instead; in a Clash
 * the free hand grips the Wand too. The robe skirt lags on a fixed-step
 * spring, tents over the legs and never sinks through the floor. Petrified,
 * the pose freezes and the body turns to stone.
 *
 * It keeps every cue of the procedural wizard it replaces: the Lock-on rim
 * glow, the full-Focus Wand aura, the empty hand while Disarmed, the vial
 * raised while drinking and the auras of Potions at work.
 */
import {
  AnimationMixer,
  Color,
  Group,
  Matrix4,
  Quaternion,
  Vector3,
} from "three/webgpu";
import type { AnimationAction, Object3D } from "three/webgpu";

import type { DuelEvent, DuelistId, PotionKind, SpellKind } from "../duel/duel";
import type { Point3 } from "../duel/geometry";
import type { Tuning } from "../tuning";
import type { DuelistSample } from "./interpolate";
import { locomotionClips } from "./wizard-assets";
import type { WizardAssets } from "./wizard-assets";
import {
  approach,
  createSpring,
  pulse,
  smooth,
  solveLimb,
  unit,
} from "./wizard-motion";
import { createWizardRig } from "./wizard-rig";
import type { TeamLook } from "./wizard-rig";

export interface DuelistView {
  readonly object: Group;
  /** Where the Wand tip is on screen right now, as last drawn. */
  readonly wandTipPosition: () => Point3;
  /**
   * Reacts to this frame's simulation events about this Duelist: each
   * Spell's cast, a Backfire, a Dodge, a landing, a hit, a Parry, a
   * Potion down and a Wand picked up off the floor.
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

/** A one-shot's age; infinite when it is not playing. */
const idle = Number.POSITIVE_INFINITY;

/** Wraps an angle to (-π, π]. */
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/** A state's age: 0 as it starts, growing while it lasts, idle once it ends. */
const ageWhile = (on: boolean, age: number, seconds: number) => {
  if (!on) {
    return idle;
  }

  return age === idle ? 0 : age + seconds;
};

/** Where a looping clip of `duration` is after `seconds`. */
const loopTime = (seconds: number, duration: number) =>
  ((seconds % duration) + duration) % duration;

const up = new Vector3(0, 1, 0);

/** One half of the body's clip stack: weights by clip, each with the time it plays at. */
interface Layer {
  readonly weights: Map<string, number>;
  readonly times: Map<string, number>;
}

const createLayer = (): Layer => ({ times: new Map(), weights: new Map() });

/** Puts `clip` under everything in `layer` (the base: weights are raw). */
const lay = (layer: Layer, clip: string, time: number, weight: number) => {
  if (weight <= 0) {
    return;
  }

  layer.weights.set(clip, (layer.weights.get(clip) ?? 0) + weight);
  layer.times.set(clip, time);
};

/** Blends `clip` over everything already in `layer` by `weight` (0 to 1). */
const over = (layer: Layer, clip: string, time: number, weight: number) => {
  const share = unit(weight);

  if (share <= 1e-3) {
    return;
  }

  for (const [name, each] of layer.weights) {
    layer.weights.set(name, each * (1 - share));
  }

  lay(layer, clip, time, share);
};

const scratch = new Vector3();
const scratchQuaternion = new Quaternion();
const parentQuaternion = new Quaternion();

/** Turns `joint` by `angle` about `axis` (a world direction), after whatever posed it. */
const turnAbout = (joint: Object3D, axis: Vector3, angle: number) => {
  if (Math.abs(angle) < 1e-5 || !joint.parent) {
    return;
  }

  joint.parent.updateWorldMatrix(true, false);
  joint.parent.getWorldQuaternion(parentQuaternion);
  scratch.copy(axis).applyQuaternion(parentQuaternion.invert());
  scratchQuaternion.setFromAxisAngle(scratch, angle);
  joint.quaternion.premultiply(scratchQuaternion);
};

export const createDuelistView = (
  id: DuelistId,
  team: TeamLook,
  settings: DuelistViewSettings,
  assets: WizardAssets
): DuelistView => {
  const { aura, dodgeSeconds, duelist, glow, potion, stone } = settings;
  const { cloth, motion, wand } = duelist;
  const { gait, shots } = motion;
  const rig = createWizardRig(assets, team, settings);
  const { joints, uniforms } = rig;

  // The Duelist's frame (position and facing), and inside it the body,
  // which turns on its own for the Dodge roll.
  const object = new Group();
  const turn = new Group();
  turn.add(rig.model);
  object.add(turn);

  // Every clip's two halves, playing at the times and weights set each frame.
  const mixer = new AnimationMixer(rig.model);

  const actions = new Map<
    string,
    { duration: number; lower: AnimationAction; upper: AnimationAction }
  >();

  for (const [name, halves] of assets.clips) {
    const start = (clip: typeof halves.upper) => {
      const action = mixer.clipAction(clip);
      action.play();
      action.enabled = false;

      return action;
    };

    actions.set(name, {
      duration: halves.duration,
      lower: start(halves.lower),
      upper: start(halves.upper),
    });
  }

  const durationOf = (clip: string) => actions.get(clip)?.duration ?? 1;
  const upper = createLayer();
  const lower = createLayer();

  /** Hands each layer's weights and times to the mixer and poses the body. */
  const play = () => {
    for (const [name, action] of actions) {
      for (const [layer, half] of [
        [upper, action.upper],
        [lower, action.lower],
      ] as const) {
        const weight = layer.weights.get(name) ?? 0;
        half.enabled = weight > 1e-3;
        half.weight = weight;
        half.time = Math.min(
          Math.max(layer.times.get(name) ?? 0, 0),
          action.duration - 1e-4
        );
      }
    }

    mixer.update(0);
  };

  // Motion, measured from the samples: how fast and which way, in the body frame.
  let speed = 0;
  let gaitWeight = 0;
  let walking = false;
  const heading = new Vector3(0, 0, 1);
  const velocity = new Vector3();
  let fall = 0;
  let last: { x: number; z: number; elevation: number } | null = null;
  let phase = 0;
  let backward = false;
  let twist = 0;

  // Eased state weights.
  const weight = {
    air: 0,
    charge: 0,
    clash: 0,
    disarmed: 0,
    drink: 0,
    knockback: 0,
    lock: 1,
    shield: 0,
    sprint: 0,
    stagger: 0,
  };

  // One-shots: their ages in seconds.
  let castAge = idle;
  let castKind: keyof typeof wand.flicks = "stupefy";
  let strikeAge = idle;
  let pushAge = idle;
  let parryAge = idle;
  let flinchAge = idle;
  let flinchClip = "Hit_Chest";
  let landAge = idle;
  let pickupAge = idle;
  let rollAge = idle;
  let knockoutAge = idle;
  let riseAge = idle;
  let knockbackAge = idle;
  let staggerAge = idle;
  let rollYaw = 0;
  let petrified = false;
  let clock = 0;

  const skirtSpring = createSpring(cloth.spring);
  const hatSpring = createSpring(cloth.spring);
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

  /** The locomotion clips' weights at the current speed: between neighbours by their own speeds. */
  const strideWeights = () => {
    const weights = locomotionClips.map(() => 0);
    let clip = 0;

    // Each clip alone (played faster or slower) except across the
    // crossover bands, where it hands over to the next one.
    for (const [index, [from, to]] of gait.crossovers.entries()) {
      if (speed >= to) {
        clip = index + 1;
      } else if (speed > from) {
        const share = smooth((speed - from) / (to - from));
        weights[index] = 1 - share;
        weights[index + 1] = share;

        return weights;
      }
    }

    weights[clip] = 1;

    return weights;
  };

  /** How far the body travels over one blended cycle, metres. */
  const cycleNow = () =>
    strideWeights().reduce(
      (sum, share, index) =>
        sum +
        share * assets.strides[locomotionClips[index] ?? "Walk_Loop"].cycle,
      0
    ) || 1;

  /** Measures the body's motion from the samples and advances the gait by the ground covered. */
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
    if (Math.hypot(dx, dz) > 1) {
      dx = 0;
      dz = 0;
      skirtSpring.reset(springTarget.set(0, 0, 0));
      hatSpring.reset(springTarget);
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
      rollAge >= dodgeSeconds &&
      !sample.knockedBack &&
      !sample.knockedOut &&
      !sample.clashing;

    speed = approach(
      speed,
      travelling ? distance * rate : 0,
      gait.speedSharpness,
      seconds
    );

    if (distance > 1e-5) {
      heading
        .lerp(
          scratch.set(localX / distance, 0, localZ / distance),
          1 - Math.exp(-gait.speedSharpness * seconds)
        )
        .normalize();
    }

    walking = travelling && speed > gait.minSpeed;
    gaitWeight = approach(
      gaitWeight,
      walking ? 1 : 0,
      gait.gaitSharpness,
      seconds
    );

    // Off the facing the legs turn toward the motion; far off it they walk backwards.
    const off = Math.atan2(heading.x, heading.z);

    if (
      backward ? Math.abs(off) < gait.backTo : Math.abs(off) > gait.backFrom
    ) {
      backward = !backward;
    }

    const legs = backward ? wrap(off - Math.PI) : off;
    twist = approach(
      twist,
      walking ? Math.max(-gait.maxTwist, Math.min(gait.maxTwist, legs)) : 0,
      gait.twistSharpness,
      seconds
    );

    if (travelling) {
      phase = loopTime(
        phase + ((backward ? -1 : 1) * distance) / cycleNow(),
        1
      );
    }
  };

  /**
   * Whether the Wand hand is busy: thrown about with the body, drinking,
   * following through a strike, picking up, getting up or pumping a
   * sprint. Otherwise the Wand is held ready, its tip on the simulation's.
   */
  const handBusy = (sample: DuelistSample) =>
    sample.disarmed ||
    sample.knockedOut ||
    sample.drinking !== null ||
    sample.knockedBack ||
    sample.staggered ||
    rollAge < dodgeSeconds ||
    (strikeAge > 0 && strikeAge < shots.strike.seconds * 0.6) ||
    pickupAge < shots.pickup.seconds ||
    riseAge < durationOf("LayToIdle") ||
    (sample.sprinting && !sample.charging && !sample.shielding);

  /** Eases every state's weight toward whether the sample is in it. */
  const easeWeights = (sample: DuelistSample, seconds: number) => {
    const ease = (now: number, on: boolean, sharpness = motion.sharpness) =>
      approach(now, on ? 1 : 0, sharpness, seconds);

    const down = sample.knockedOut;

    weight.air = ease(weight.air, sample.elevation > 0.02 && !down);
    weight.charge = ease(weight.charge, sample.charging && !down);
    weight.clash = ease(weight.clash, sample.clashing && !down);
    weight.disarmed = ease(weight.disarmed, sample.disarmed && !down);
    weight.drink = ease(weight.drink, sample.drinking !== null && !down);
    weight.knockback = ease(weight.knockback, sample.knockedBack && !down);
    weight.shield = ease(weight.shield, sample.shielding && !down);
    weight.sprint = ease(weight.sprint, sample.sprinting && walking);
    weight.stagger = ease(weight.stagger, sample.staggered && !down);

    weight.lock = ease(weight.lock, !handBusy(sample), wand.lockSharpness);
  };

  /** A one-shot's clip time and weight at `age`, by its `shots` entry. */
  const shot = (age: number, timing: (typeof shots)["cast"]) => {
    const progress = age / timing.seconds;

    return {
      time: timing.from + (timing.to - timing.from) * unit(progress),
      weight: pulse(progress, timing.peak),
    };
  };

  /** Builds both layers' clip stacks for this frame. */
  const stack = (sample: DuelistSample) => {
    for (const layer of [upper, lower]) {
      layer.weights.clear();
      layer.times.clear();
    }

    // Locomotion, in step: one phase for every clip, each offset so its
    // left foot leads at the same moment.
    const strides = strideWeights();

    for (const layer of [upper, lower]) {
      lay(
        layer,
        "Idle_Loop",
        loopTime(clock, durationOf("Idle_Loop")),
        1 - gaitWeight
      );

      for (const [index, clip] of locomotionClips.entries()) {
        const duration = durationOf(clip);
        lay(
          layer,
          clip,
          loopTime((phase + assets.strides[clip].offset) * duration, duration),
          gaitWeight * (strides[index] ?? 0)
        );
      }
    }

    const armed = 1 - weight.disarmed;
    const { stance } = motion;
    over(
      upper,
      "Spell_Simple_Idle_Loop",
      loopTime(clock, durationOf("Spell_Simple_Idle_Loop")),
      armed *
        (1 - weight.sprint) *
        (stance.standing + (stance.moving - stance.standing) * gaitWeight)
    );

    // Braced behind a Shield; standing, the legs brace too.
    const shieldTime = loopTime(clock, durationOf("Idle_Shield_Loop"));
    over(
      upper,
      "Idle_Shield_Loop",
      shieldTime,
      weight.shield * motion.shieldUpper
    );
    over(
      lower,
      "Idle_Shield_Loop",
      shieldTime,
      weight.shield * (1 - gaitWeight)
    );
    over(upper, "OverhandThrow", motion.chargeAt, weight.charge);

    // Airborne: legs tucked, arms out a little.
    const airTime = loopTime(clock, durationOf("Jump_Loop"));
    over(lower, "Jump_Loop", airTime, weight.air);
    over(upper, "Jump_Loop", airTime, weight.air * 0.4);

    // Drinking: the left hand lifts the vial to the lips.
    if (sample.drinking) {
      const share = unit(1 - sample.drinking.secondsLeft / potion.drinkSeconds);
      over(upper, "Consume", share * durationOf("Consume"), weight.drink);
    }

    const knock = shot(knockbackAge, shots.knockback);
    over(upper, "Hit_Knockback", knock.time, weight.knockback);

    // One-shots on the arms.
    const cast = shot(castAge, shots.cast);
    over(upper, "Spell_Simple_Shoot", cast.time, cast.weight);
    const strike = shot(strikeAge, shots.strike);
    over(upper, "OverhandThrow", strike.time, strike.weight);
    over(lower, "OverhandThrow", strike.time, strike.weight * 0.5);
    const push = shot(pushAge, shots.push);
    over(upper, "Push_Loop", push.time, push.weight);
    const parry = shot(parryAge, shots.parry);
    over(upper, "Shield_OneShot", parry.time, parry.weight);
    const flinch = shot(flinchAge, shots.flinch);
    over(upper, flinchClip, flinch.time, flinch.weight);
    const pickup = shot(pickupAge, shots.pickup);
    over(upper, "PickUp_Table", pickup.time, pickup.weight);
    over(lower, "Crouch_Idle_Loop", 0, pickup.weight);

    // A Clash: lunging into the beam, both hands on the Wand.
    for (const layer of [upper, lower]) {
      over(layer, "Push_Loop", motion.clashAt, weight.clash);
    }

    // A Stagger rocks the whole body.
    const staggerTime = Math.min(staggerAge, durationOf("Idle_Shield_Break"));

    for (const layer of [upper, lower]) {
      over(layer, "Idle_Shield_Break", staggerTime, weight.stagger);
    }

    const land = shot(landAge, shots.land);
    over(lower, "Jump_Land", land.time, land.weight);
    over(upper, "Jump_Land", land.time, land.weight * 0.5);

    // The Dodge roll: the clip's roll over the Dodge, then its recovery fading out.
    const { roll, knockout } = motion;
    let rolling = 0;
    let rollTime = roll.to;

    if (rollAge < dodgeSeconds) {
      rolling = 1;
      rollTime = roll.from + ((roll.to - roll.from) * rollAge) / dodgeSeconds;
    } else if (rollAge < dodgeSeconds + roll.recoverSeconds) {
      rolling = 1 - smooth((rollAge - dodgeSeconds) / roll.recoverSeconds);
      rollTime = roll.to + (rollAge - dodgeSeconds);
    }

    // The Knockout: falling and lying; then getting back up.
    const riseDuration = durationOf("LayToIdle");

    const rising =
      riseAge < riseDuration
        ? 1 -
          smooth(
            (riseAge - (riseDuration - knockout.riseFadeSeconds)) /
              knockout.riseFadeSeconds
          )
        : 0;

    for (const layer of [upper, lower]) {
      over(layer, "Roll", rollTime, rolling);
      over(
        layer,
        "Death01",
        Math.min(knockoutAge, knockout.lieAt),
        knockoutAge === idle ? 0 : smooth(knockoutAge / 0.12)
      );
      over(layer, "LayToIdle", riseAge, rising);
    }

    return rolling;
  };

  // --- After the clips: the body frame, the legs' turn, the head, the arms.

  const leftAxis = new Vector3();
  const tipTarget = new Vector3();
  const wandDirection = new Vector3();
  const handTarget = new Vector3();
  const shoulder = new Vector3();
  const elbowAt = new Vector3();
  const wristAt = new Vector3();
  const solvedElbow = new Vector3();
  const solvedWrist = new Vector3();
  const elbowHint = new Vector3();
  const solvedDirection = new Vector3();
  const inverseUpper = new Quaternion();
  const swing = new Quaternion();
  const handRotation = new Quaternion();
  const posedUpper = new Quaternion();
  const posedLower = new Quaternion();
  const posedHand = new Quaternion();
  const worldUpper = new Quaternion();
  const worldLower = new Quaternion();
  const worldHand = new Quaternion();
  const parentWorld = new Quaternion();

  /** A point in the Duelist's body frame, in the world. */
  const toWorld = (local: Vector3, out: Vector3) =>
    out.copy(local).applyMatrix4(object.matrixWorld);

  /** A direction in the Duelist's body frame, in the world. */
  const directionToWorld = (local: Vector3, out: Vector3) =>
    out.copy(local).transformDirection(object.matrixWorld);

  /**
   * Two-bone IK on an arm (0 left, 1 right): the wrist reaches
   * `target` (world), the hand turns to `rotation` (world) if given, all
   * blended over the clip's pose by `amount`. Returns how far the wrist
   * fell short.
   */
  const reach = (
    side: 0 | 1,
    target: Vector3,
    rotation: Quaternion | null,
    amount: number
  ) => {
    if (amount <= 1e-3) {
      return 0;
    }

    const upperArm = joints.upperArms[side];
    const lowerArm = joints.lowerArms[side];
    const hand = joints.hands[side];
    upperArm.updateWorldMatrix(true, true);
    upperArm.getWorldPosition(shoulder);
    lowerArm.getWorldPosition(elbowAt);
    hand.getWorldPosition(wristAt);
    posedUpper.copy(upperArm.quaternion);
    posedLower.copy(lowerArm.quaternion);
    posedHand.copy(hand.quaternion);

    const upperLength = elbowAt.distanceTo(shoulder);
    const lowerLength = wristAt.distanceTo(elbowAt);
    directionToWorld(
      vector(wand.elbowHint).multiply(scratch.set(side === 0 ? -1 : 1, 1, 1)),
      elbowHint
    );

    const short = solveLimb(
      shoulder,
      target,
      upperLength,
      lowerLength,
      elbowHint,
      solvedElbow,
      solvedWrist
    );

    // The upper arm swings its elbow onto the solved one...
    upperArm.getWorldQuaternion(worldUpper);
    swing.setFromUnitVectors(
      scratch.subVectors(elbowAt, shoulder).normalize(),
      solvedDirection.subVectors(solvedElbow, shoulder).normalize()
    );
    worldUpper.premultiply(swing);
    upperArm.parent?.getWorldQuaternion(parentWorld);
    upperArm.quaternion.copy(parentWorld.invert()).multiply(worldUpper);
    upperArm.updateWorldMatrix(false, true);

    // ...then the forearm its wrist onto the solved wrist.
    lowerArm.getWorldPosition(elbowAt);
    hand.getWorldPosition(wristAt);
    lowerArm.getWorldQuaternion(worldLower);
    swing.setFromUnitVectors(
      scratch.subVectors(wristAt, elbowAt).normalize(),
      solvedDirection.subVectors(solvedWrist, elbowAt).normalize()
    );
    worldLower.premultiply(swing);
    lowerArm.quaternion
      .copy(inverseUpper.copy(worldUpper).invert())
      .multiply(worldLower);

    if (rotation) {
      hand.quaternion.copy(worldLower.invert()).multiply(rotation);
    }

    // Over the clip's pose by `amount` (each slerp starts from the clip's).
    if (amount < 1) {
      upperArm.quaternion.copy(posedUpper.slerp(upperArm.quaternion, amount));
      lowerArm.quaternion.copy(posedLower.slerp(lowerArm.quaternion, amount));
      hand.quaternion.copy(posedHand.slerp(hand.quaternion, amount));
    }

    upperArm.updateWorldMatrix(false, true);

    return short;
  };

  /** Where the Wand tip should be and which way the Wand points (world), with the flick of a cast. */
  const wandAim = (sample: DuelistSample) => {
    const { forward, height, right } = duelist.wandTip;
    const tipLocal = scratch.set(-right, height, forward);
    const pointing = vector(wand.rest).normalize();
    pointing.lerp(vector(wand.charge).normalize(), weight.charge).normalize();
    pointing.lerp(vector(wand.shield).normalize(), weight.shield).normalize();

    // A Clash: along the beam, straight ahead at the opponent, trembling.
    if (weight.clash > 0) {
      const pitch = Math.max(-1, Math.min(1, sample.aim.pitch));
      pointing
        .lerp(new Vector3(0, Math.sin(pitch), Math.cos(pitch)), weight.clash)
        .normalize();

      const shake =
        motion.tremble * Math.sin(clock * motion.trembleRate * Math.PI * 2);

      tipLocal.x += shake * weight.clash;
      tipLocal.y += shake * 0.6 * weight.clash;
    }

    // A flick for a Light or Special cast: the Wand snaps up and across
    // about the hand, which reaches ahead, and back; it starts on the tip.
    if (castAge < wand.flickSeconds) {
      const flick = wand.flicks[castKind];
      const amount = pulse(castAge / wand.flickSeconds, 0.35);
      const hand = tipLocal.clone().addScaledVector(pointing, -wand.length);
      hand.z += flick.reach * amount;
      pointing.applyAxisAngle(new Vector3(1, 0, 0), -flick.raise * amount);
      pointing.applyAxisAngle(up, flick.inward * amount);
      tipLocal.copy(hand).addScaledVector(pointing, wand.length);
    }

    toWorld(tipLocal, tipTarget);
    directionToWorld(pointing, wandDirection);
  };

  /** The right arm holds the Wand tip on its mark, or reaches for the loose Wand. */
  const poseWandArm = (sample: DuelistSample) => {
    const [, hand] = joints.hands;

    if (weight.lock > 1e-3 && !sample.disarmed) {
      wandAim(sample);
      // The hand turns so the Wand points the right way, keeping the clip's twist...
      hand.updateWorldMatrix(true, true);
      rig.wand.getWorldQuaternion(handRotation);
      const pointingNow = up.clone().applyQuaternion(handRotation);
      swing.setFromUnitVectors(pointingNow, wandDirection);
      hand.getWorldQuaternion(worldHand).premultiply(swing);
      // ...and the wrist goes where that puts the tip on its mark.
      handTarget
        .copy(rig.wand.position)
        .applyQuaternion(worldHand)
        .negate()
        .add(tipTarget)
        .addScaledVector(wandDirection, -wand.length);
      reach(1, handTarget, worldHand, weight.lock);
    }

    if (sample.looseWand && weight.disarmed > 1e-3) {
      // Disarmed: the empty hand reaches toward the loose Wand, grasping.
      const yaw = Math.atan2(sample.facing.x, sample.facing.z);
      const dx = sample.looseWand.x - sample.position.x;
      const dz = sample.looseWand.z - sample.position.z;
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      const { disarmed } = wand;

      const toward = new Vector3(
        dx * cos - dz * sin,
        0,
        Math.max(dx * sin + dz * cos, disarmed.behind)
      ).normalize();

      joints.upperArms[1].getWorldPosition(shoulder);
      const local = object.worldToLocal(shoulder.clone());
      local.y =
        disarmed.height +
        disarmed.grasp * Math.sin(clock * disarmed.graspRate * Math.PI * 2);
      local.addScaledVector(toward, disarmed.reach);
      reach(1, toWorld(local, handTarget), null, weight.disarmed);
    }
  };

  /** In a Clash the free hand grips the Wand behind the fist. */
  const poseFreeArm = (sample: DuelistSample) => {
    // Drinking: the vial goes to the lips, the head tipping back as it empties.
    if (sample.drinking && weight.drink > 1e-3) {
      const share = unit(1 - sample.drinking.secondsLeft / potion.drinkSeconds);
      const lifted = smooth(share / 0.3) * smooth((1 - share) / 0.15);
      joints.head.getWorldPosition(handTarget);
      object.worldToLocal(handTarget).add(vector(motion.drink.lips));
      reach(0, toWorld(handTarget, handTarget), null, weight.drink * lifted);
      directionToWorld(leftAxis.set(1, 0, 0), leftAxis);
      turnAbout(joints.head, leftAxis, -motion.drink.headBack * share * lifted);
    }

    if (weight.clash <= 1e-3) {
      return;
    }

    rig.wand.updateWorldMatrix(true, false);
    rig.wand.getWorldPosition(handTarget);
    rig.wand.getWorldQuaternion(handRotation);
    handTarget.addScaledVector(
      up.clone().applyQuaternion(handRotation),
      -wand.clashGrip
    );
    reach(0, handTarget, null, weight.clash);
  };

  /** The right fist closes round the Wand (open while Disarmed). */
  const grip = (amount: number) => {
    for (const finger of joints.fingers) {
      const fist = assets.grip.get(finger.name);

      if (fist) {
        finger.quaternion.slerp(fist, amount);
      }
    }
  };

  /** Turns the legs toward the motion and the chest back to the facing; the head follows the aim. */
  const turnBody = (sample: DuelistSample) => {
    if (Math.abs(twist) > 1e-4) {
      turnAbout(joints.pelvis, up, twist);

      for (const spine of joints.spine) {
        turnAbout(spine, up, -twist / joints.spine.length);
      }
    }

    directionToWorld(leftAxis.set(1, 0, 0), leftAxis);
    const pitch = Math.max(-1, Math.min(1, sample.aim.pitch));
    const looking = motion.headPitch * pitch * weight.lock;
    turnAbout(joints.neck, leftAxis, -looking * 0.4);
    turnAbout(joints.head, leftAxis, -looking * 0.6);
  };

  // --- The robe skirt.

  const skirtInverse = new Matrix4();

  const legs = [
    { ankle: new Vector3(), hip: new Vector3(), knee: new Vector3() },
    { ankle: new Vector3(), hip: new Vector3(), knee: new Vector3() },
  ] as const;

  const legPoint = new Vector3();
  const worldUp = new Vector3();

  /** Where a leg crosses height `y` (skirt frame), from the hip down to the ankle. */
  const legAt = (leg: (typeof legs)[number], y: number) => {
    const upperSpan = leg.hip.y - leg.knee.y;

    if (upperSpan > 0.05 && y >= leg.knee.y) {
      return legPoint.lerpVectors(
        leg.hip,
        leg.knee,
        unit((leg.hip.y - y) / upperSpan)
      );
    }

    const lowerSpan = leg.knee.y - leg.ankle.y;

    return lowerSpan > 0.05
      ? legPoint.lerpVectors(
          leg.knee,
          leg.ankle,
          unit((leg.knee.y - y) / lowerSpan)
        )
      : legPoint.copy(leg.knee);
  };

  /** Drapes the skirt: lagging, flaring, tenting over the legs, above the floor. */
  const drapeSkirt = () => {
    const { skirt } = rig;

    if (!skirt) {
      return;
    }

    const { mesh, positions } = skirt;
    const sway = skirtSpring.position;
    const flare = cloth.flarePerSpeed * speed + cloth.flarePerFall * fall;
    const { ripple } = cloth;
    const swaying = Math.hypot(sway.x, sway.z);

    mesh.updateWorldMatrix(true, false);
    skirtInverse.copy(mesh.matrixWorld).invert();

    for (const side of [0, 1] as const) {
      const leg = legs[side];
      joints.thighs[side].getWorldPosition(leg.hip).applyMatrix4(skirtInverse);
      joints.calves[side].getWorldPosition(leg.knee).applyMatrix4(skirtInverse);
      joints.feet[side].getWorldPosition(leg.ankle).applyMatrix4(skirtInverse);
    }

    // World up in the skirt's frame (scaled by its world scale), and its origin's height.
    const e = mesh.matrixWorld.elements;
    worldUp.set(e[1] ?? 0, e[5] ?? 1, e[9] ?? 0);
    const floor = e[13] ?? 0;
    const scale = worldUp.lengthSq();

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
        let y = (skirt.rest[at + 1] ?? 0) + swaying * hang * 0.4;
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

          // Hidden under the tunic at the top, the cloth only tents lower down.
          const tent =
            (outward + cloth.legRadius - reachOut) *
            (1 - smooth(offAxis / cloth.legSpan)) *
            smooth(t / cloth.legTentFrom);

          if (tent > 0) {
            x += dirX * tent;
            z += dirZ * tent;
          }
        }

        // Never through the floor.
        const heightNow = worldUp.x * x + worldUp.y * y + worldUp.z * z + floor;

        if (heightNow < cloth.floorClearance && scale > 0) {
          const lift = (cloth.floorClearance - heightNow) / scale;
          x += worldUp.x * lift;
          y += worldUp.y * lift;
          z += worldUp.z * lift;
        }

        positions[at] = x;
        positions[at + 1] = y;
        positions[at + 2] = z;
      }
    }

    const { geometry } = mesh;
    geometry.getAttribute("position").needsUpdate = true;
    geometry.computeVertexNormals();
  };

  /** Steps the cloth springs toward the body's lag and sways the hat's point. */
  const swingCloth = (seconds: number) => {
    const limit = (value: number) =>
      Math.max(-cloth.maxSway, Math.min(cloth.maxSway, value));

    springTarget.set(
      limit(-velocity.x * cloth.drag),
      0,
      limit(-velocity.z * cloth.drag)
    );
    skirtSpring.advance(springTarget, seconds);
    springTarget.set(
      limit(-velocity.x * cloth.hatDrag),
      0,
      limit(-velocity.z * cloth.hatDrag)
    );
    hatSpring.advance(springTarget, seconds);

    if (rig.hatTip) {
      const sway = hatSpring.position;
      rig.hatTip.rotation.set(
        -cloth.hatBend + sway.z * cloth.hatSway,
        0,
        -sway.x * cloth.hatSway
      );
    }
  };

  /** Poses the whole body for `seconds`. */
  const pose = (sample: DuelistSample, seconds: number) => {
    clock += seconds;

    knockbackAge = ageWhile(sample.knockedBack, knockbackAge, seconds);
    staggerAge = ageWhile(sample.staggered, staggerAge, seconds);

    if (sample.knockedOut) {
      knockoutAge = knockoutAge === idle ? 0 : knockoutAge + seconds;
      rollAge = idle;
      riseAge = idle;
    } else if (knockoutAge !== idle) {
      // Back on their feet for the next Round: get up from the floor.
      knockoutAge = idle;
      riseAge = 0;
    }

    measure(sample, seconds);
    easeWeights(sample, seconds);
    const rolling = stack(sample);
    play();

    // The body turns toward where the Dodge goes while it rolls.
    const facingYaw = Math.atan2(sample.facing.x, sample.facing.z);
    turn.rotation.y = wrap(rollYaw - facingYaw) * rolling;
    object.updateMatrixWorld(true);

    turnBody(sample);
    grip(1 - weight.disarmed);
    poseWandArm(sample);
    poseFreeArm(sample);
    rig.model.updateMatrixWorld(true);

    swingCloth(seconds);
    drapeSkirt();

    // One-shots age after they are drawn, so each starts from its first
    // pose: a cast's flick leaves from the tip the Spell leaves from.
    castAge += seconds;
    strikeAge += seconds;
    pushAge += seconds;
    parryAge += seconds;
    flinchAge += seconds;
    landAge += seconds;
    pickupAge += seconds;
    rollAge += seconds;
    riseAge += seconds;
  };

  /** Raises the vial while drinking, in the free hand. */
  const showVial = (sample: DuelistSample) => {
    rig.vial.visible = sample.drinking !== null && !sample.knockedOut;

    if (sample.drinking) {
      uniforms.vialTint.value.set(potion.colors[sample.drinking.kind]);
    }
  };

  const cast = (kind: SpellKind) => {
    castAge = idle;
    pushAge = idle;
    strikeAge = idle;
    // The Spell leaves the Wand: the tip is on its mark this very frame.
    weight.lock = 1;

    if (kind === "confringo") {
      strikeAge = 0;
      weight.charge = 0;
    } else if (kind === "depulso") {
      pushAge = 0;
    } else {
      castAge = 0;
      castKind = kind;
    }
  };

  /** This Duelist's own moves: a Dodge, a landing, a Parry, a Wand picked up, a Potion down. */
  const reactToOwn = (event: DuelEvent) => {
    if (event.type === "dodge") {
      rollAge = 0;
      rollYaw = Math.atan2(event.direction.x, event.direction.z);
    } else if (event.type === "land") {
      landAge = 0;
    } else if (event.type === "parry") {
      parryAge = 0;
    } else if (event.type === "wand-recovered" && event.how === "pickup") {
      pickupAge = 0;
    } else if (event.type === "potion-drunk") {
      flashAge = 0;
      flashKind = event.kind;
    } else if (event.type === "backfire") {
      strikeAge = idle;
      castAge = idle;
      weight.charge = 0;
    }
  };

  const react = (event: DuelEvent) => {
    if (event.type === "spell-cast") {
      if (event.spell.casterId === id) {
        cast(event.spell.kind);
      }
    } else if (event.type === "spell-hit") {
      if (event.targetId === id) {
        flinchAge = 0;
        flinchClip =
          event.position.y - (last?.elevation ?? 0) > duelist.chestHeight + 0.15
            ? "Hit_Head"
            : "Hit_Chest";
      }
    } else if ("duelistId" in event && event.duelistId === id) {
      reactToOwn(event);
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
      if (!petrified) {
        pose(sample, seconds);
      }

      rig.wandStick.visible = !sample.disarmed;
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
      rig.tip.updateWorldMatrix(true, false);
      rig.tip.getWorldPosition(tipWorld);

      return { x: tipWorld.x, y: tipWorld.y, z: tipWorld.z };
    },
  };
};
