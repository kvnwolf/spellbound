/**
 * Defence VFX: Protego and the Parry. Views only: they read presentation
 * samples and react to simulation events.
 *
 * - The Shield is a translucent half-dome over the front of the Duelist (the
 *   same front 180° the simulation blocks with). A fresnel rim traces its
 *   edge and interference bands shimmer up across it; it grows in when
 *   raised, fades when dropped, and flares all over when it blocks a Spell.
 *   One additive draw per Duelist, all in TSL from a clock and two uniforms.
 * - A Parry is a hot white-gold flash where the Spell met the Shield: a
 *   billboard that swells and fades, one pooled point light, and the Shield
 *   flaring at full strength.
 *
 * Colours are scene-linear HDR, so the rim, flares and flash feed the bloom.
 */
import {
  abs,
  color,
  float,
  length,
  normalView,
  positionLocal,
  positionViewDirection,
  sin,
  smoothstep,
  uniform,
  uv,
  vec4,
} from "three/tsl";
import {
  AdditiveBlending,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  PointLight,
  SphereGeometry,
  Sprite,
  SpriteNodeMaterial,
} from "three/webgpu";

import type { DuelEvent, DuelistId } from "../duel/duel";
import type { Tuning } from "../tuning";
import type { DuelistSample } from "./interpolate";

export interface DefenceVfx {
  readonly object: Group;
  /** Starts block flares and Parry flashes for this frame's simulation events. */
  readonly handle: (events: readonly DuelEvent[]) => void;
  /** Places and eases every Duelist's Shield, and ages the flashes, by `seconds` of real time. */
  readonly show: (
    samples: ReadonlyMap<DuelistId, DuelistSample>,
    seconds: number
  ) => void;
}

/** The effects clock, in seconds, that drives the shimmer. */
const createClock = () => uniform(0);

/** One Duelist's Protego dome, with the strengths it eases. */
const createShield = (
  look: Tuning["protego"],
  clock: ReturnType<typeof createClock>
) => {
  // How raised the Shield is (0 down, 1 up) and how much it is flaring.
  const strength = uniform(0);
  const flare = uniform(0);

  // The half of a sphere with z >= 0: the model's front, which the group
  // turns toward the Duelist's facing.
  const geometry = new SphereGeometry(
    look.radius,
    48,
    24,
    0,
    Math.PI,
    0,
    Math.PI
  );

  const material = new MeshBasicNodeMaterial({
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    transparent: true,
  });

  // Brightest where the dome turns edge-on to the camera (both faces).
  const rim = float(1)
    .sub(abs(normalView.dot(positionViewDirection)))
    .pow(look.rimPower)
    .mul(look.rimRadiance);

  // Two crossing wave trains drifting upward: where they agree, bright bands.
  const bands = positionLocal.y
    .mul(look.shimmerScale)
    .sub(clock.mul(look.shimmerSpeed * Math.PI * 2));

  const across = positionLocal.x
    .mul(look.shimmerScale * 0.7)
    .add(clock.mul(look.shimmerSpeed * 2.3));

  const shimmer = sin(bands)
    .mul(sin(across))
    .mul(0.5)
    .add(0.5)
    .pow(3)
    .mul(look.shimmerRadiance);

  // The cut edge at the sides fades out instead of ending in a hard line.
  const edge = smoothstep(0, look.radius * 0.3, positionLocal.z);

  const radiance = color(look.color)
    .mul(rim.add(shimmer).add(flare))
    .mul(edge)
    .mul(strength);

  material.colorNode = vec4(radiance, 1);

  const mesh = new Mesh(geometry, material);
  mesh.position.y = look.centreHeight;
  // Transparent and additive: drawn after the opaque scene, never in shadows.
  mesh.renderOrder = 1;

  const group = new Group();
  group.add(mesh);
  group.visible = false;

  return { flare, group, strength };
};

/** The Parry flash: a soft round billboard that swells as it fades. */
const createParryFlash = (look: Tuning["protego"]["parry"]) => {
  const fade = uniform(0);

  const material = new SpriteNodeMaterial({
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });

  const fromCentre = length(uv().sub(0.5)).mul(2);
  const glow = smoothstep(1, 0, fromCentre).pow(2);
  material.colorNode = vec4(
    color(look.color).mul(glow.mul(fade).mul(look.radiance)),
    1
  );

  const sprite = new Sprite(material);
  sprite.visible = false;
  sprite.renderOrder = 2;

  return { fade, sprite };
};

export const createDefenceVfx = (look: Tuning["protego"]): DefenceVfx => {
  const object = new Group();
  const clock = createClock();
  const shields = new Map<DuelistId, ReturnType<typeof createShield>>();
  const flash = createParryFlash(look.parry);

  const light = new PointLight(look.parry.color, 0, look.parry.lightRange, 2);

  let flashAge = Number.POSITIVE_INFINITY;

  object.add(flash.sprite, light);

  const shieldOf = (id: DuelistId) => {
    let shield = shields.get(id);

    if (!shield) {
      shield = createShield(look, clock);
      shields.set(id, shield);
      object.add(shield.group);
    }

    return shield;
  };

  const handle = (events: readonly DuelEvent[]) => {
    for (const event of events) {
      if (event.type === "spell-blocked") {
        shieldOf(event.duelistId).flare.value = look.flare;
      } else if (event.type === "parry") {
        shieldOf(event.duelistId).flare.value = look.flare * 2;
        flash.sprite.position.set(
          event.position.x,
          event.position.y,
          event.position.z
        );
        light.position.copy(flash.sprite.position);
        flashAge = 0;
      }
    }
  };

  const show = (
    samples: ReadonlyMap<DuelistId, DuelistSample>,
    seconds: number
  ) => {
    clock.value += seconds;
    const ease = 1 - Math.exp(-look.fadeSharpness * seconds);
    const flareFade = Math.exp(-seconds / look.flareSeconds);

    for (const [id, sample] of samples) {
      const shield = shieldOf(id);
      const wanted = sample.shielding && !sample.knockedOut ? 1 : 0;

      shield.strength.value += (wanted - shield.strength.value) * ease;
      shield.flare.value *= flareFade;
      shield.group.visible = shield.strength.value > 0.01;
      shield.group.position.set(
        sample.position.x,
        sample.elevation,
        sample.position.z
      );
      shield.group.rotation.y = Math.atan2(sample.facing.x, sample.facing.z);
      // It swells into place as it goes up.
      shield.group.scale.setScalar(
        look.raiseScale + (1 - look.raiseScale) * shield.strength.value
      );
    }

    flashAge += seconds;
    const left = Math.max(1 - flashAge / look.parry.seconds, 0);
    flash.sprite.visible = left > 0;
    flash.fade.value = left * left;
    flash.sprite.scale.setScalar(
      look.parry.endSize + (look.parry.startSize - look.parry.endSize) * left
    );
    light.intensity = look.parry.light * left * left;
  };

  return { handle, object, show };
};
