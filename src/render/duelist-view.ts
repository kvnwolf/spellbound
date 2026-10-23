/**
 * A Duelist drawn as a rigged wizard (`wizard-rig.ts`) animated with real
 * clips through an `AnimationMixer`. It only reads presentation samples and
 * simulation events.
 *
 * The pose is layered. Every clip is split into an upper body and a lower
 * body, so the legs can walk, run or brace while the arms cast, Charge,
 * Shield or drink. In each half a stack of clips blends: locomotion at the
 * bottom (its cycles advanced at a real runner's cadence by the ground
 * actually covered, blended by speed), then each state eased in and out
 * over what is beneath it (the armed stance, Protego, a Charge, drinking, a
 * Clash, a Stagger, the jump's take-off, air and reach for the floor), then
 * one-shots on their own timelines (each Spell's cast, a Parry, a flinch, a
 * knockback, a landing, a Wand pickup, the Dodge roll, the Knockout and
 * getting back up).
 *
 * After the clips, code writes what clips cannot know: moving off the
 * facing (there are no strafe clips) the legs turn toward the motion while
 * the spine turns the chest back; the legs reach by two-bone IK to the
 * gait's own stride (the clips' strides are far too long for their speed)
 * and the pelvis keeps only part of their bounce, so planted feet stay put;
 * the head follows the aim's pitch. At rest and on the move the Wand hangs
 * low in the hand; to cast, Charge, Shield or Parry and in a Clash the
 * right arm rises by two-bone IK so the drawn Wand tip sits exactly on the
 * simulation's `wandTip` (snapping up on the very frame a Spell leaves it,
 * the chest leading the body round to the aim), so Spells visibly leave the
 * Wand, and lowers again shortly after. Disarmed, that hand reaches for the
 * loose Wand instead; in a Clash the free hand grips the Wand too.
 * Petrified, the pose freezes and the body turns to stone.
 *
 * It keeps every cue of the procedural wizard it replaces: the Lock-on rim
 * glow, the full-Focus Wand aura, the empty hand while Disarmed, the vial
 * raised while drinking and the auras of Potions at work.
 */
import {
  AnimationMixer,
  Color,
  Group,
  Quaternion,
  Vector3,
} from "three/webgpu";
import type { AnimationAction, Object3D } from "three/webgpu";

import type {
  DuelEvent,
  DuelistId,
  PotionKind,
  SpellState,
} from "../duel/duel";
import type { Point3 } from "../duel/geometry";
import type { Tuning } from "../tuning";
import type { DuelistSample } from "./interpolate";
import { locomotionClips } from "./wizard-assets";
import type { WizardAssets } from "./wizard-assets";
import { approach, pulse, smooth, solveLimb, unit } from "./wizard-motion";
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
  const { motion, wand } = duelist;
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

  // The pose the clips last set, before this view's own turns and IK. The
  // mixer only writes a joint whose clip value changed, so a joint it skips
  // would keep last frame's turns and they would pile up (a spine spinning
  // round): every joint goes back to the clips' pose before the mixer runs.
  const bones: Object3D[] = [];
  rig.model.traverse((node) => {
    if (node.type === "Bone") {
      bones.push(node);
    }
  });

  const clipPose = bones.map((bone) => ({
    position: bone.position.clone(),
    quaternion: bone.quaternion.clone(),
  }));

  /** Hands each layer's weights and times to the mixer and poses the body. */
  const play = () => {
    for (const [index, bone] of bones.entries()) {
      const pose = clipPose[index];

      if (pose) {
        bone.position.copy(pose.position);
        bone.quaternion.copy(pose.quaternion);
      }
    }

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

    for (const [index, bone] of bones.entries()) {
      clipPose[index]?.position.copy(bone.position);
      clipPose[index]?.quaternion.copy(bone.quaternion);
    }
  };

  // Motion, measured from the samples: how fast and which way, in the body frame.
  let speed = 0;
  let gaitWeight = 0;
  let walking = false;
  const heading = new Vector3(0, 0, 1);
  /** `heading` as a yaw in the body frame, eased the short way round. */
  let headingYaw = 0;
  let last: { x: number; z: number; elevation: number } | null = null;
  let phase = 0;
  let twist = 0;
  /** The legs' reach on the clips' own stride (1 their own), so the gait keeps its cadence. */
  let stride = 1;
  /** How fast the feet rise (+) or fall (-), m/s. */
  let climb = 0;

  // Eased state weights.
  const weight = {
    air: 0,
    charge: 0,
    clash: 0,
    disarmed: 0,
    drink: 0,
    knockback: 0,
    lock: 0,
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
  let jumpAge = idle;
  /** Since the last Spell left this Duelist's Wand, and where it left it (world). */
  let spawnAge = idle;
  const spawnAt = new Vector3();
  const spawnOffset = new Vector3();
  /** Seconds since the Wand last had to be up: a cast or a Parry. */
  let raisedAge = idle;
  let pickupAge = idle;
  let rollAge = idle;
  let knockoutAge = idle;
  let riseAge = idle;
  let knockbackAge = idle;
  let staggerAge = idle;
  let rollYaw = 0;
  let petrified = false;
  let clock = 0;

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

  /** How far the body travels over one blended cycle of the clips' own strides, metres. */
  const cycleNow = () =>
    strideWeights().reduce(
      (sum, share, index) =>
        sum +
        share * assets.strides[locomotionClips[index] ?? "Walk_Loop"].cycle,
      0
    ) || 1;

  /**
   * The legs' reach on the clips' own stride at the current speed: the
   * stride that, at the gait's cadence, covers the ground travelled.
   */
  const strideNow = () => {
    if (speed < 1e-3) {
      return 1;
    }

    const { cadence } = gait;

    let steps = 0;

    for (const [index, share] of strideWeights().entries()) {
      const { base, perSpeed } =
        locomotionClips[index] === "Walk_Loop" ? cadence.walk : cadence.run;

      steps += share * (base + perSpeed * speed);
    }

    // Two steps a cycle.
    const wanted = (2 * speed) / (steps * cycleNow());

    return Math.min(Math.max(wanted, gait.stride[0]), gait.stride[1]);
  };

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

    climb = seconds > 0 ? dy / seconds : 0;

    last = { elevation, x: position.x, z: position.z };

    // A jump of position (a new Round lining everyone up) is not motion.
    if (Math.hypot(dx, dz) > 1) {
      dx = 0;
      dz = 0;
    }

    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const localX = dx * cos - dz * sin;
    const localZ = dx * sin + dz * cos;
    const distance = Math.hypot(localX, localZ);
    const rate = seconds > 0 ? 1 / seconds : 0;

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

    // Eased as an angle, not a vector: reversing (right to left) swings
    // one way round instead of collapsing through zero and flipping about.
    if (distance > 1e-5) {
      headingYaw = wrap(
        headingYaw +
          wrap(Math.atan2(localX, localZ) - headingYaw) *
            (1 - Math.exp(-gait.speedSharpness * seconds))
      );
      heading.set(Math.sin(headingYaw), 0, Math.cos(headingYaw));
    }

    walking = travelling && speed > gait.minSpeed;
    gaitWeight = approach(
      gaitWeight,
      walking ? 1 : 0,
      gait.gaitSharpness,
      seconds
    );

    // The legs always run the way the body goes, turning with it as an
    // angle (so circling a Target never flips them about, there being no
    // backwards gait to switch to); with the Wand up they turn to the aim,
    // no further than `raisedTwist` from it.
    const limit =
      gait.maxTwist + (gait.raisedTwist - gait.maxTwist) * weight.lock;

    const legs = walking ? Math.max(-limit, Math.min(limit, headingYaw)) : 0;

    twist = wrap(
      twist +
        wrap(legs - twist) * (1 - Math.exp(-gait.twistSharpness * seconds))
    );

    // The cycle advances by the ground covered over the stride the legs
    // reach to, so planted feet stay put.
    stride = strideNow();

    if (travelling) {
      phase = loopTime(phase + distance / (stride * cycleNow()), 1);
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

    weight.air = ease(
      weight.air,
      sample.elevation > 0.02 && !down,
      motion.jump.sharpness
    );
    weight.charge = ease(weight.charge, sample.charging && !down);
    weight.clash = ease(weight.clash, sample.clashing && !down);
    weight.disarmed = ease(weight.disarmed, sample.disarmed && !down);
    weight.drink = ease(weight.drink, sample.drinking !== null && !down);
    weight.knockback = ease(weight.knockback, sample.knockedBack && !down);
    weight.shield = ease(weight.shield, sample.shielding && !down);
    weight.sprint = ease(weight.sprint, sample.sprinting && walking);
    weight.stagger = ease(weight.stagger, sample.staggered && !down);

    // The Wand is up to cast, Charge, Shield, Parry or Clash, and for a
    // moment after a cast or Parry; otherwise it is held low.
    const raised =
      !handBusy(sample) &&
      (sample.charging ||
        sample.shielding ||
        sample.clashing ||
        raisedAge < wand.hold);

    weight.lock = ease(
      weight.lock,
      raised,
      raised ? wand.lockSharpness : wand.lowerSharpness
    );
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
        weight.lock *
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

    // Airborne: the push off the floor and the legs tucking, then the air
    // pose; falling, the legs reach for the floor.
    const { jump } = motion;
    const airTime = loopTime(clock, durationOf("Jump_Loop"));
    const { takeoff } = jump;
    const launch = unit(jumpAge / takeoff.seconds);
    const launching = jumpAge === idle ? 0 : 1 - smooth((launch - 0.7) / 0.3);

    const reaching = climb < 0 ? 1 - smooth(sample.elevation / jump.reach) : 0;

    for (const [layer, share] of [
      [lower, 1],
      [upper, 0.4],
    ] as const) {
      over(layer, "Jump_Loop", airTime, weight.air * share);
      over(
        layer,
        "Jump_Start",
        takeoff.from + (takeoff.to - takeoff.from) * launch,
        weight.air * launching * share
      );
      over(layer, "Jump_Land", 0, weight.air * reaching * share);
    }

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
    over(lower, "Jump_Land", land.time, land.weight * jump.landWeight);
    over(upper, "Jump_Land", land.time, land.weight * jump.landWeight * 0.5);

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

  /** The share of the lower body the locomotion clips hold this frame. */
  const locomotionShare = () =>
    Math.min(
      locomotionClips.reduce(
        (sum, clip) => sum + (lower.weights.get(clip) ?? 0),
        0
      ),
      1
    );

  /**
   * Two-bone IK on a limb (upper bone, lower bone, end): the end reaches
   * `target` (world), bending toward `hint` (a world direction), and turns
   * to `rotation` (world) if given, all blended over the clip's pose by
   * `amount`. Returns how far the end fell short.
   */
  const solve = (
    upperArm: Object3D,
    lowerArm: Object3D,
    hand: Object3D,
    target: Vector3,
    rotation: Quaternion | null,
    hint: Vector3,
    amount: number
  ) => {
    if (amount <= 1e-3) {
      return 0;
    }

    upperArm.updateWorldMatrix(true, true);
    upperArm.getWorldPosition(shoulder);
    lowerArm.getWorldPosition(elbowAt);
    hand.getWorldPosition(wristAt);
    posedUpper.copy(upperArm.quaternion);
    posedLower.copy(lowerArm.quaternion);
    posedHand.copy(hand.quaternion);

    const upperLength = elbowAt.distanceTo(shoulder);
    const lowerLength = wristAt.distanceTo(elbowAt);

    const short = solveLimb(
      shoulder,
      target,
      upperLength,
      lowerLength,
      hint,
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

  /**
   * Two-bone IK on an arm (0 left, 1 right): the wrist reaches `target`
   * (world), the hand turns to `rotation` (world) if given, the elbow bends
   * toward `elbowHint`, all blended over the clip's pose by `amount`.
   */
  const reach = (
    side: 0 | 1,
    target: Vector3,
    rotation: Quaternion | null,
    amount: number
  ) =>
    solve(
      joints.upperArms[side],
      joints.lowerArms[side],
      joints.hands[side],
      target,
      rotation,
      directionToWorld(
        vector(wand.elbowHint).multiply(scratch.set(side === 0 ? -1 : 1, 1, 1)),
        elbowHint
      ),
      amount
    );

  const motionAxis = new Vector3();
  const lift = new Vector3();
  const hips = [new Vector3(), new Vector3()] as const;
  const ankles = [new Vector3(), new Vector3()] as const;
  const knees = [new Vector3(), new Vector3()] as const;
  const footTurns = [new Quaternion(), new Quaternion()] as const;
  const kneeHint = new Vector3();
  const footTarget = new Vector3();

  /**
   * After the clips, the gait's own stride and bounce: each foot's reach
   * along the motion is scaled by `stride` about its hip (planted feet stay
   * on the floor, the cycle already advances by that stride) and the pelvis
   * keeps `gait.bob` of the clips' bounce, by the share the locomotion
   * clips hold of the lower body. A shorter step than the clip's raises
   * the pelvis so the planted leg stays as straight as the clip has it
   * (short steps fold the knees otherwise: a crouched shuffle).
   */
  const warpGait = () => {
    let share = 0;
    let pelvisMean = 0;

    for (const clip of locomotionClips) {
      const each = lower.weights.get(clip) ?? 0;
      share += each;
      pelvisMean += each * assets.strides[clip].pelvis;
    }

    if (share < 1e-3) {
      return;
    }

    pelvisMean /= share;
    const scale = 1 + (stride - 1) * share;

    directionToWorld(heading, motionAxis);
    motionAxis.y = 0;

    if (motionAxis.lengthSq() < 1e-6) {
      return;
    }

    motionAxis.normalize();
    rig.model.updateMatrixWorld(true);

    for (const side of [0, 1] as const) {
      joints.thighs[side].getWorldPosition(hips[side]);
      joints.calves[side].getWorldPosition(knees[side]);
      joints.feet[side].getWorldPosition(ankles[side]);
      joints.feet[side].getWorldQuaternion(footTurns[side]);
    }

    // How much higher the pelvis rides for each foot to keep its leg's
    // length at the shorter reach, the planted (lower) foot counting most.
    let raise = 0;
    let weights = 0;

    for (const side of [0, 1] as const) {
      const hip = hips[side];
      const ankle = ankles[side];
      const along = scratch.subVectors(ankle, hip).dot(motionAxis);
      const length = ankle.distanceTo(hip);
      const drop = hip.y - ankle.y;
      const level = Math.max(length * length - drop * drop, 0);
      const spread = Math.max(level - along * along * (1 - scale * scale), 0);
      const each = Math.sqrt(Math.max(length * length - spread, 0)) - drop;
      const planted = 1 / (0.02 + Math.max(ankle.y - object.position.y, 0));
      raise += Math.max(each, 0) * planted;
      weights += planted;
    }

    // The pelvis bounces less: moved toward the clips' mean height.
    const { pelvis } = joints;
    pelvis.getWorldPosition(lift);
    const above = lift.y - object.position.y - pelvisMean;
    lift.y -= (1 - gait.bob) * above * share;
    lift.y += (Math.min(raise / weights, gait.maxRaise) + gait.lift) * share;
    pelvis.parent?.worldToLocal(lift);
    pelvis.position.copy(lift);
    pelvis.updateMatrixWorld(true);

    for (const side of [0, 1] as const) {
      const hip = hips[side];
      const ankle = ankles[side];
      const along = scratch.subVectors(ankle, hip).dot(motionAxis);
      footTarget.copy(ankle).addScaledVector(motionAxis, (scale - 1) * along);
      // The knee keeps bending the way the clip bends it.
      kneeHint
        .copy(knees[side])
        .sub(scratch.addVectors(hip, ankle).multiplyScalar(0.5))
        .addScaledVector(motionAxis, 0.02);
      solve(
        joints.thighs[side],
        joints.calves[side],
        joints.feet[side],
        footTarget,
        footTurns[side],
        kneeHint,
        1
      );
    }
  };

  /**
   * The yaw the raised Wand works in: the aim's, as the simulation casts
   * (the body may still be coming round to it); in a Clash, the body's,
   * which already faces down the beam.
   */
  const wandYaw = (sample: DuelistSample) =>
    sample.clashing
      ? object.rotation.y
      : Math.atan2(Math.sin(sample.aim.yaw), -Math.cos(sample.aim.yaw));

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

    const yaw = wandYaw(sample);

    tipTarget.copy(tipLocal).applyAxisAngle(up, yaw).add(object.position);
    wandDirection.copy(pointing).applyAxisAngle(up, yaw);

    // The frame a Spell appears the tip is exactly where it leaves the
    // simulation's Wand (the drawn body lags it by up to a tick); that
    // correction fades over the flick.
    if (spawnAge === 0) {
      spawnOffset.subVectors(spawnAt, tipTarget);
    }

    if (spawnAge < wand.flickSeconds) {
      tipTarget.addScaledVector(
        spawnOffset,
        1 - smooth(spawnAge / wand.flickSeconds)
      );
    }
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

  /**
   * The head looks where the Duelist means to: the facing, or the aim
   * while the Wand is up, whatever the clips and the spine left it at (a
   * cast clip turns it toward the Wand hand).
   */
  const lookAhead = (sample: DuelistSample) => {
    if (
      sample.knockedOut ||
      rollAge < dodgeSeconds ||
      riseAge < durationOf("LayToIdle")
    ) {
      return;
    }

    const wanted =
      object.rotation.y +
      wrap(wandYaw(sample) - object.rotation.y) * weight.lock;

    joints.head.updateWorldMatrix(true, false);
    const e = joints.head.matrixWorld.elements;

    const off = Math.max(
      -gait.headTurn,
      Math.min(gait.headTurn, wrap(wanted - Math.atan2(e[8], e[10])))
    );

    turnAbout(joints.neck, up, off * 0.4);
    turnAbout(joints.head, up, off * 0.6);
  };

  /**
   * Turns the legs toward the motion; the chest turns back to the facing
   * only as far as a spine can (`counterTwist`), all the way while the Wand
   * is up, and the head looks the rest of the way (`headTurn` at most).
   */
  const turnBody = (sample: DuelistSample) => {
    const held = Math.max(
      -gait.counterTwist,
      Math.min(gait.counterTwist, twist)
    );

    const counter = held + (twist - held) * weight.lock;

    if (Math.abs(twist) > 1e-4) {
      turnAbout(joints.pelvis, up, twist);

      for (const spine of joints.spine) {
        turnAbout(spine, up, -counter / joints.spine.length);
      }
    }

    // The run clips stoop: the spine straightens up by `upright` about the
    // hips' own side-to-side axis.
    const upright = gait.upright * locomotionShare();

    if (upright > 1e-4) {
      directionToWorld(leftAxis.set(1, 0, 0), leftAxis).applyAxisAngle(
        up,
        twist
      );

      for (const spine of joints.spine) {
        turnAbout(spine, leftAxis, -upright / joints.spine.length);
      }
    }

    // With the Wand up, the chest leads the body round to the aim.
    const lead =
      Math.max(
        -gait.maxTwist,
        Math.min(gait.maxTwist, wrap(wandYaw(sample) - object.rotation.y))
      ) * weight.lock;

    if (Math.abs(lead) > 1e-4) {
      for (const spine of joints.spine) {
        turnAbout(spine, up, lead / joints.spine.length);
      }
    }

    lookAhead(sample);

    directionToWorld(leftAxis.set(1, 0, 0), leftAxis);
    const pitch = Math.max(-1, Math.min(1, sample.aim.pitch));
    const looking = motion.headPitch * pitch * weight.lock;
    turnAbout(joints.neck, leftAxis, -looking * 0.4);
    turnAbout(joints.head, leftAxis, -looking * 0.6);
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
    warpGait();
    grip(1 - weight.disarmed);
    poseWandArm(sample);
    poseFreeArm(sample);
    rig.model.updateMatrixWorld(true);

    // One-shots age after they are drawn, so each starts from its first
    // pose: a cast's flick leaves from the tip the Spell leaves from.
    castAge += seconds;
    strikeAge += seconds;
    pushAge += seconds;
    parryAge += seconds;
    flinchAge += seconds;
    landAge += seconds;
    jumpAge += seconds;
    raisedAge += seconds;
    spawnAge += seconds;
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

  const cast = ({ kind, position }: SpellState) => {
    spawnAt.set(position.x, position.y, position.z);
    spawnAge = 0;
    castAge = idle;
    pushAge = idle;
    strikeAge = idle;
    // The Spell leaves the Wand: the tip is on its mark this very frame.
    weight.lock = 1;
    raisedAge = 0;

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
    } else if (event.type === "jump") {
      jumpAge = 0;
    } else if (event.type === "land") {
      landAge = 0;
      jumpAge = idle;
    } else if (event.type === "parry") {
      parryAge = 0;
      raisedAge = 0;
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
        cast(event.spell);
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

      // The rim follows the limbs as drawn.
      rig.updateRim();

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
