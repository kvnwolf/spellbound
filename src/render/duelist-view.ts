/**
 * A blockout Duelist: robe, head, pointed hat and a Wand held out in front,
 * tinted by Team. It only reads presentation samples; the procedural wizard
 * and its poses come later. While it is the local Duelist's Lock-on Target, a
 * fresnel rim glow traces its silhouette.
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

const wood = new MeshStandardNodeMaterial({ color: "#4a2f1d", roughness: 0.6 });

export const createDuelistView = (
  robeColor: string,
  glow: Tuning["lockOnGlow"]
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

  // The Wand points along the model's +z, which `show` turns toward the facing.
  const wand = new Mesh(new BoxGeometry(0.03, 0.03, 0.4), wood);
  wand.position.set(0.28, 1.15, 0.35);

  object.add(robe, head, hat, wand);
  // Heading first, then the tilt in the Duelist's own frame, so leaning and
  // falling are always backward whatever way they face.
  object.rotation.order = "YXZ";
  let tilt = 0;

  return {
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

      const fade = 1 - Math.exp(-glow.fadeSharpness * seconds);
      glowStrength.value += (wantedGlow - glowStrength.value) * fade;
    },
  };
};
