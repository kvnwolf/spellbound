/**
 * A blockout Duelist: robe, head, pointed hat and a right arm holding a Wand
 * out in front, tinted by Team. The Wand tip is the simulation's own
 * (`tuning.duelist.wandTip`), where Spells leave it; a cast flicks the arm up
 * and Charging keeps it raised. It only reads presentation samples; the
 * procedural wizard and its poses come later. While it is the local
 * Duelist's Lock-on Target, a fresnel rim glow traces its silhouette.
 */
import { color, normalView, positionViewDirection, uniform } from "three/tsl";
import {
  BoxGeometry,
  ConeGeometry,
  Group,
  Mesh,
  MeshStandardNodeMaterial,
  SphereGeometry,
} from "three/webgpu";

import type { Tuning } from "../tuning";
import type { DuelistSample } from "./interpolate";

export interface DuelistView {
  readonly object: Group;
  /** The Duelist cast a Spell: the arm flicks up and settles. */
  readonly flick: () => void;
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

const wood = new MeshStandardNodeMaterial({ color: "#8a6038", roughness: 0.5 });

export const createDuelistView = (
  robeColor: string,
  glow: Tuning["lockOnGlow"],
  duelist: Tuning["duelist"]
): DuelistView => {
  // The rim glow: brightest where the surface turns away from the camera
  // (the silhouette), scaled by a per-Duelist strength the view eases.
  const glowStrength = uniform(0);

  const rim = color(glow.color)
    .mul(
      normalView
        .dot(positionViewDirection)
        .saturate()
        .oneMinus()
        .pow(glow.power)
    )
    .mul(glowStrength.mul(glow.radiance));

  const robeMaterial = new MeshStandardNodeMaterial({
    color: robeColor,
    roughness: 0.8,
  });

  const skin = new MeshStandardNodeMaterial({
    color: "#d9b38c",
    roughness: 0.7,
  });

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

  const wand = new Mesh(new BoxGeometry(0.03, 0.03, length), wood);
  wand.position.z = handAt + length / 2;

  arm.add(sleeve, hand, wand);

  object.add(robe, head, hat, shoulders, arm);
  // Heading first, then the tilt in the Duelist's own frame, so leaning and
  // falling are always backward whatever way they face.
  object.rotation.order = "YXZ";
  let tilt = 0;
  // How raised the arm is from Charging (eased), and how long ago the
  // current flick began.
  let chargeRaise = 0;
  let flickAge = Number.POSITIVE_INFINITY;

  return {
    flick: () => {
      flickAge = 0;
    },
    object,
    show: (sample, seconds, wantedGlow) => {
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

      const { flickInward, flickRaise, flickSeconds, poseSharpness } =
        duelist.wand;

      chargeRaise +=
        ((sample.charging ? duelist.wand.chargeRaise : 0) - chargeRaise) *
        (1 - Math.exp(-poseSharpness * seconds));

      flickAge += seconds;

      const flick =
        flickAge < flickSeconds ? flickLift(flickAge / flickSeconds) : 0;

      // Pitching up is a negative turn about the model's x axis; the inward
      // yaw swings the tip from the right hand toward the aim.
      arm.rotation.x = -Math.max(chargeRaise, flick * flickRaise);
      arm.rotation.y = flick * flickInward;

      const fade = 1 - Math.exp(-glow.fadeSharpness * seconds);
      glowStrength.value += (wantedGlow - glowStrength.value) * fade;
    },
  };
};
