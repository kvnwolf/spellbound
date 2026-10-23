/**
 * A blockout Duelist: robe, head, pointed hat and a right arm holding a Wand
 * out in front, tinted by Team. The Wand tip is the simulation's own
 * (`tuning.duelist.wandTip`), where Spells leave it. The arm acts out each
 * Spell: Stupefy flicks it up, Charging a Confringo raises it overhead and
 * the cast swings it down at the aim, a Backfire drops it. A Dodge is a
 * roll: tucked, tumbling toward where it goes. It only reads presentation
 * samples; the procedural wizard and its poses come later. While it is the local
 * Duelist's Lock-on Target, a fresnel rim glow traces its silhouette.
 * Petrified, it turns to grey stone with a cold, pale rim of light.
 */
import {
  color,
  mix,
  normalView,
  positionViewDirection,
  uniform,
} from "three/tsl";
import {
  BoxGeometry,
  ConeGeometry,
  Group,
  Mesh,
  MeshStandardNodeMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three/webgpu";

import type { SpellKind } from "../duel/duel";
import type { GroundPoint, Point3 } from "../duel/geometry";
import type { Tuning } from "../tuning";
import type { DuelistSample } from "./interpolate";

export interface DuelistView {
  readonly object: Group;
  /** Where the Wand tip is on screen right now, as last drawn: the raised arm moves it off the simulation's `wandTip`. */
  readonly wandTipPosition: () => Point3;
  /** The Duelist cast a Spell of `kind`: Stupefy flicks the arm up, Confringo swings it down at the aim. */
  readonly cast: (kind: SpellKind) => void;
  /** The Duelist's Charge Backfired: the arm drops back to rest. */
  readonly backfire: () => void;
  /** The Duelist started a Dodge along `direction` (a unit vector on the floor): it rolls that way. */
  readonly dodge: (direction: GroundPoint) => void;
  /**
   * Draws `sample`, easing poses over the `seconds` since the last frame.
   * `glow` is the rim glow it eases toward: 0 off, 1 the full lock mark of
   * the local Duelist's Lock-on Target.
   */
  readonly show: (sample: DuelistSample, seconds: number, glow: number) => void;
}

/** Backward tilts, in radians: lying on the back, and a Stagger's lean. */
const knockedOutTilt = -Math.PI / 2;
const staggerTilt = -0.3;

/** How quickly poses ease toward their tilt, per second. */
const tiltSharpness = 9;

/** Eases out: fast at first, settling. */
const easeOut = (progress: number) => 1 - (1 - progress) ** 3;

/** Eases in and out. */
const smooth = (progress: number) => progress * progress * (3 - 2 * progress);

/** How far a cast flick has raised the arm, 0 to 1 over its progress: a quick snap up, then a smooth settle. */
const flickLift = (progress: number) => {
  const peak = 0.35;

  return progress < peak
    ? easeOut(progress / peak)
    : 1 - smooth((progress - peak) / (1 - peak));
};

/** A Confringo swing or a Backfire recoil in progress. */
interface Drop {
  /** Seconds since it began. */
  age: number;
  /** The arm's pitch when it began, radians up. */
  readonly from: number;
  readonly kind: "recoil" | "swing";
}

const dropSeconds = (drop: Drop, wand: Tuning["duelist"]["wand"]) =>
  drop.kind === "swing" ? wand.swingSeconds : wand.recoilSeconds;

/**
 * The standing body's extremities, as points (metres from the feet) with a
 * radius: what must stay above the floor while it tumbles.
 */
const bodyExtent = (() => {
  const points: { at: Vector3; radius: number }[] = [
    { at: new Vector3(0, 1.62, 0), radius: 0.2 },
    { at: new Vector3(0, 1.5, 0), radius: 0 },
    { at: new Vector3(0, 2.255, 0), radius: 0 },
  ];

  for (let step = 0; step < 8; step += 1) {
    const turn = (step / 8) * Math.PI * 2;
    const [sin, cos] = [Math.sin(turn), Math.cos(turn)];
    points.push(
      { at: new Vector3(0.45 * sin, 0, 0.45 * cos), radius: 0 },
      { at: new Vector3(0.24 * sin, 1.705, 0.24 * cos), radius: 0 }
    );
  }

  for (const side of [-1, 1]) {
    points.push({ at: new Vector3(0.38 * side, 1.4, 0), radius: 0 });
  }

  return points;
})();

const wood = new MeshStandardNodeMaterial({ color: "#8a6038", roughness: 0.5 });

/** Fresnel: 1 where the surface turns away from the camera (the silhouette), sharper with `power`. */
const silhouette = (power: number) =>
  normalView.dot(positionViewDirection).saturate().oneMinus().pow(power);

export const createDuelistView = (
  robeColor: string,
  glow: Tuning["lockOnGlow"],
  stone: Tuning["petrifiedLook"],
  duelist: Tuning["duelist"],
  dodgeSeconds: number
): DuelistView => {
  // The rim glow: brightest where the surface turns away from the camera
  // (the silhouette), scaled by a per-Duelist strength the view eases.
  const glowStrength = uniform(0);
  // How far the Duelist has turned to stone (Petrified): 0 flesh, 1 stone.
  const petrify = uniform(0);

  const rim = color(glow.color)
    .mul(silhouette(glow.power))
    .mul(glowStrength.mul(glow.radiance))
    // Petrified: a cold, pale rim of light round the stone figure.
    .add(
      color(stone.rimColor)
        .mul(silhouette(stone.rimPower))
        .mul(petrify.mul(stone.rimRadiance))
    );

  const robeMaterial = new MeshStandardNodeMaterial({ roughness: 0.8 });
  const skin = new MeshStandardNodeMaterial({ roughness: 0.7 });

  // Robe and skin both fade to the same grey stone while Petrified.
  robeMaterial.colorNode = mix(
    color(robeColor),
    color(stone.stoneColor),
    petrify
  );
  skin.colorNode = mix(color("#d9b38c"), color(stone.stoneColor), petrify);
  robeMaterial.emissiveNode = rim;
  skin.emissiveNode = rim;

  const object = new Group();

  const robe = new Mesh(new ConeGeometry(0.45, 1.5, 24), robeMaterial);
  robe.position.y = 0.75;

  const head = new Mesh(new SphereGeometry(0.2, 24, 16), skin);
  head.position.y = 1.62;

  const hat = new Mesh(new ConeGeometry(0.24, 0.55, 24), robeMaterial);
  hat.position.y = 1.98;

  // The model faces +z with +x to its LEFT, so the right hand is at -x. The
  // arm hangs from a shoulder pivot level with the Wand tip, so at rest the
  // tip sits exactly on the simulation's `wandTip`; turning the pivot raises
  // the whole arm.
  const { forward, height, right } = duelist.wandTip;
  const { length } = duelist.wand;
  const handAt = forward - length;

  const shoulders = new Mesh(
    new BoxGeometry(2 * right + 0.12, 0.14, 0.2),
    robeMaterial
  );

  shoulders.position.y = height;

  const arm = new Group();
  arm.position.set(-right, height, 0);

  const sleeve = new Mesh(new BoxGeometry(0.09, 0.09, handAt), robeMaterial);
  sleeve.position.z = handAt / 2;

  const hand = new Mesh(new SphereGeometry(0.06, 12, 8), skin);
  hand.position.z = handAt;

  const stick = new Mesh(new BoxGeometry(0.03, 0.03, length), wood);
  stick.position.z = handAt + length / 2;

  const tip = new Object3D();
  tip.position.z = handAt + length;
  const tipWorld = new Vector3();
  arm.add(sleeve, hand, stick, tip);

  // Everything that moves with the body, so a roll can turn it as one.
  const body = new Group();
  body.add(robe, head, hat, shoulders, arm);
  object.add(body);
  // Heading first, then the tilt in the Duelist's own frame, so leaning and
  // falling are always backward whatever way they face.
  object.rotation.order = "YXZ";
  let tilt = 0;
  // How raised the arm is from Charging (eased), and how long ago the
  // current flick began.
  let chargeRaise = 0;
  let flickAge = Number.POSITIVE_INFINITY;
  let drop: Drop | null = null;
  // The arm's pitch last frame, radians up: where a swing or recoil starts.
  let armPitch = 0;
  // A Dodge's roll: which way (a unit vector on the floor) and how long ago
  // it began. Petrified Duelists do not roll.
  let rollAge = Number.POSITIVE_INFINITY;
  const rollWorld = { x: 0, z: 1 };
  let petrified = false;
  const rollTurn = new Quaternion();
  const rollAxis = new Vector3();
  const rollPoint = new Vector3();

  return {
    backfire: () => {
      if (petrified) {
        return;
      }

      drop = { age: 0, from: armPitch, kind: "recoil" };
      flickAge = Number.POSITIVE_INFINITY;
      chargeRaise = 0;
    },
    cast: (kind) => {
      if (petrified) {
        return;
      }

      flickAge = Number.POSITIVE_INFINITY;

      if (kind === "confringo") {
        drop = { age: 0, from: armPitch, kind: "swing" };
        chargeRaise = 0;
      } else {
        flickAge = 0;
      }
    },
    dodge: (direction) => {
      if (petrified) {
        return;
      }

      rollAge = 0;
      rollWorld.x = direction.x;
      rollWorld.z = direction.z;
    },
    object,
    show: (sample, seconds, wantedGlow) => {
      ({ petrified } = sample);

      if (petrified) {
        // Stone does not swing, flick or roll: any motion in progress ends.
        drop = null;
        flickAge = Number.POSITIVE_INFINITY;
        rollAge = Number.POSITIVE_INFINITY;
      }

      object.position.set(
        sample.position.x,
        sample.elevation,
        sample.position.z
      );
      object.rotation.y = Math.atan2(sample.facing.x, sample.facing.z);

      // Knocked Out: topple onto the back. Staggered: rock back on the heels.
      let wanted = 0;

      if (sample.knockedOut) {
        wanted = knockedOutTilt;
      } else if (sample.staggered) {
        wanted = staggerTilt;
      }

      tilt += (wanted - tilt) * (1 - Math.exp(-tiltSharpness * seconds));
      object.rotation.x = tilt;

      const { wand } = duelist;

      let pitch: number;
      let yaw: number;

      if (drop && drop.age < dropSeconds(drop, wand)) {
        // A swing strikes through the aim (the camera's pitch, which the
        // Wand follows) and past it; a recoil drops below rest. Both then
        // settle at rest.
        const aimed = drop.kind === "swing";

        const low = aimed
          ? Math.max(-1, Math.min(1, sample.aim.pitch)) -
            wand.swingFollowThrough
          : -wand.recoilKick;

        const share = aimed ? wand.swingStrikeShare : wand.recoilDropShare;
        const progress = drop.age / dropSeconds(drop, wand);
        const falling = progress < share;

        const along = falling
          ? progress / share
          : (progress - share) / (1 - share);

        const dropEase = aimed ? along * along : easeOut(along);

        pitch = falling
          ? drop.from + (low - drop.from) * dropEase
          : low * (1 - smooth(along));

        // The swing turns the tip toward the aim as it strikes, and lets go.
        yaw = aimed
          ? wand.swingInward * (falling ? along : 1 - smooth(along))
          : 0;

        drop.age += seconds;
      } else {
        drop = null;

        chargeRaise +=
          ((sample.charging ? wand.chargeRaise : 0) - chargeRaise) *
          (1 - Math.exp(-wand.poseSharpness * seconds));

        flickAge += seconds;

        const flick =
          flickAge < wand.flickSeconds
            ? flickLift(flickAge / wand.flickSeconds)
            : 0;

        pitch = Math.max(chargeRaise, flick * wand.flickRaise);
        yaw = flick * wand.flickInward;
      }

      // Pitching up is a negative turn about the model's x axis; the inward
      // yaw swings the tip from the right hand toward the aim.
      armPitch = pitch;

      // A Dodge rolls the whole body: tucked in, it somersaults about a
      // point inside it, lowered so its extremities clear the floor.
      const { roll } = duelist;
      const rolling = rollAge < dodgeSeconds;
      let tuck = 0;

      if (rolling) {
        const progress = rollAge / dodgeSeconds;
        const edge = roll.tuckShare;

        tuck =
          smooth(Math.min(progress / edge, 1)) *
          smooth(Math.min((1 - progress) / edge, 1));

        const angle = roll.turns * Math.PI * 2 * smooth(progress);
        const size = 1 + (roll.scale - 1) * tuck;
        const heading = object.rotation.y;

        // The Dodge's direction in the Duelist's own frame; the roll's axis
        // lies across it, so the head leads the way.
        const sin = Math.sin(heading);
        const cos = Math.cos(heading);
        const across = rollWorld.x * cos - rollWorld.z * sin;
        const along = rollWorld.x * sin + rollWorld.z * cos;

        rollAxis.set(along, 0, -across);
        rollTurn.setFromAxisAngle(rollAxis, angle);

        // The lowest an extremity falls below the pivot once tucked and
        // turned is how high the pivot must ride.
        let reach = roll.pivotHeight * size;

        for (const { at, radius } of bodyExtent) {
          rollPoint
            .set(at.x, at.y - roll.pivotHeight, at.z)
            .multiplyScalar(size)
            .applyQuaternion(rollTurn);

          reach = Math.max(reach, -rollPoint.y + radius * size);
        }

        body.scale.setScalar(size);
        body.quaternion.copy(rollTurn);
        rollPoint.set(0, roll.pivotHeight * size, 0).applyQuaternion(rollTurn);
        body.position.set(-rollPoint.x, reach - rollPoint.y, -rollPoint.z);

        rollAge += seconds;
      } else {
        rollAge = Number.POSITIVE_INFINITY;
        body.scale.setScalar(1);
        body.quaternion.identity();
        body.position.set(0, 0, 0);
      }

      arm.rotation.x = -pitch * (1 - tuck) + roll.armTuck * tuck;
      arm.rotation.y = yaw * (1 - tuck);

      const fade = 1 - Math.exp(-glow.fadeSharpness * seconds);
      glowStrength.value += (wantedGlow - glowStrength.value) * fade;

      const turn = 1 - Math.exp(-stone.fadeSharpness * seconds);
      petrify.value += ((sample.petrified ? 1 : 0) - petrify.value) * turn;
    },
    wandTipPosition: () => {
      tip.updateWorldMatrix(true, false);
      tip.getWorldPosition(tipWorld);

      return { x: tipWorld.x, y: tipWorld.y, z: tipWorld.z };
    },
  };
};
