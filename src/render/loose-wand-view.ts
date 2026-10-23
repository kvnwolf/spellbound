/**
 * The loose Wand of every Disarmed Duelist: knocked out of the hand, it
 * tumbles end over end along the simulation's arc, then lies on the Arena
 * floor glowing scarlet in a soft, breathing ring of light so its owner can
 * find it. When it returns on its own it zips back into the hand. Views
 * only: it reads snapshots and reacts to simulation events.
 *
 * Colours are scene-linear HDR, so the glow feeds the bloom.
 */
import { color, float, length, smoothstep, uniform, uv, vec4 } from "three/tsl";
import {
  AdditiveBlending,
  BoxGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  RingGeometry,
  Sprite,
  SpriteNodeMaterial,
} from "three/webgpu";

import type {
  DuelEvent,
  DuelistId,
  DuelSnapshot,
  LooseWand,
} from "../duel/duel";
import type { Point3 } from "../duel/geometry";
import type { Tuning } from "../tuning";

export interface LooseWandView {
  readonly object: Group;
  /** Starts the flight home of a Wand that returned on its own this frame. */
  readonly handle: (events: readonly DuelEvent[]) => void;
  /**
   * Draws every loose Wand between two snapshots, and ages its effects by
   * `seconds`. `handOf` is where a Duelist's hand (Wand tip) is on screen,
   * for a Wand flying home.
   */
  readonly show: (
    previous: DuelSnapshot,
    current: DuelSnapshot,
    alpha: number,
    seconds: number,
    handOf: (id: DuelistId) => Point3 | undefined
  ) => void;
  /** Whether `id`'s Wand is still flying home: their hand is empty until it lands in it. */
  readonly returning: (id: DuelistId) => boolean;
}

/** A Wand flying back into its owner's hand. */
interface Homecoming {
  readonly from: Point3;
  age: number;
}

const lerp = (from: number, to: number, alpha: number) =>
  from + (to - from) * alpha;

/** Eases in and out. */
const smooth = (progress: number) => progress * progress * (3 - 2 * progress);

/** Where a loose Wand is drawn this frame, between two ticks. */
const sampleWand = (
  previous: LooseWand | null | undefined,
  current: LooseWand
): ((alpha: number) => Point3) => {
  const from = previous?.position ?? current.position;

  return (alpha) => ({
    x: lerp(from.x, current.position.x, alpha),
    y: lerp(from.y, current.position.y, alpha),
    z: lerp(from.z, current.position.z, alpha),
  });
};

export const createLooseWandView = (
  look: Tuning["looseWand"],
  wandLength: number
): LooseWandView => {
  const object = new Group();
  // The breathing of every Wand on the floor, and each one's glow strength.
  const clock = uniform(0);

  const breath = float(1).sub(
    float(look.pulseDepth).mul(
      clock
        .mul(look.pulseSpeed * Math.PI * 2)
        .sin()
        .mul(0.5)
        .add(0.5)
    )
  );

  const glowColor = color(look.color);

  const wood = new MeshStandardNodeMaterial({ roughness: 0.5 });
  wood.colorNode = color("#8a6038");
  wood.emissiveNode = glowColor.mul(breath.mul(look.radiance));

  const fromCentre = length(uv().sub(0.5)).mul(2);

  const halo = new SpriteNodeMaterial({
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });

  halo.colorNode = vec4(glowColor.mul(breath.mul(look.glowRadiance)), 1);
  halo.opacityNode = smoothstep(1, 0, fromCentre).pow(2.2);

  // The ring on the floor: brightest at its rim, fading inward.
  const ringMaterial = new MeshBasicNodeMaterial({
    blending: AdditiveBlending,
    depthWrite: false,
    // Additive, so drawing the back faces then the front ones (three.js's
    // default for double-sided transparency) adds up to the same as one
    // pass; one pass also compiles ahead with the rest (see prewarm.ts).
    forceSinglePass: true,
    side: DoubleSide,
    transparent: true,
  });

  ringMaterial.colorNode = glowColor.mul(breath.mul(look.ringRadiance));

  const stickGeometry = new BoxGeometry(0.03, 0.03, wandLength);
  const ringGeometry = new RingGeometry(0.75, 1, 48);
  ringGeometry.rotateX(-Math.PI / 2);

  /** One Duelist's loose Wand: the stick, its halo and the ring under it. */
  const createWand = () => {
    const group = new Group();
    const spin = new Group();
    const stick = new Mesh(stickGeometry, wood);
    const glow = new Sprite(halo);
    glow.scale.setScalar(look.glowSize);
    spin.add(stick);
    group.add(spin, glow);

    const ring = new Mesh(ringGeometry, ringMaterial);
    ring.scale.setScalar(look.ringRadius);

    object.add(group, ring);
    group.visible = false;
    ring.visible = false;

    return { glow, group, ring, spin, tumble: 0 };
  };

  const wands = new Map<DuelistId, ReturnType<typeof createWand>>();
  const homecomings = new Map<DuelistId, Homecoming>();

  const wandOf = (id: DuelistId) => {
    let found = wands.get(id);

    if (!found) {
      found = createWand();
      wands.set(id, found);
    }

    return found;
  };

  return {
    handle: (events) => {
      for (const event of events) {
        if (event.type === "wand-recovered" && event.how === "return") {
          homecomings.set(event.duelistId, { age: 0, from: event.position });
        } else if (event.type === "disarm") {
          homecomings.delete(event.duelistId);
        }
      }
    },
    object,
    returning: (id) => homecomings.has(id),
    show: (previous, current, alpha, seconds, handOf) => {
      clock.value += seconds;

      for (const self of current.duelists) {
        const wand = wandOf(self.id);
        const before = previous.duelists.find((each) => each.id === self.id);
        const homecoming = homecomings.get(self.id);
        const loose = self.looseWand;
        wand.ring.visible = false;

        if (loose) {
          const at = sampleWand(before?.looseWand, loose)(alpha);
          wand.group.visible = true;
          wand.group.position.set(at.x, at.y, at.z);
          // Pointing the way it was knocked; tumbling end over end in the air.
          wand.group.rotation.y = Math.atan2(loose.heading.x, loose.heading.z);

          if (loose.grounded) {
            // Lying flat, just off the floor so it never z-fights.
            wand.tumble = 0;
            wand.group.position.y = 0.03;
            wand.ring.visible = true;
            wand.ring.position.set(loose.landing.x, 0.02, loose.landing.z);
          } else {
            wand.tumble += seconds * look.spinTurns * Math.PI * 2;
          }

          wand.spin.rotation.x = wand.tumble;
        } else if (homecoming) {
          // Flying home: from where it was to the hand, over a moment.
          homecoming.age += seconds;
          const progress = Math.min(homecoming.age / look.returnSeconds, 1);
          const hand = handOf(self.id) ?? homecoming.from;
          const along = smooth(progress);

          wand.group.visible = progress < 1;
          wand.group.position.set(
            lerp(homecoming.from.x, hand.x, along),
            lerp(homecoming.from.y, hand.y, along),
            lerp(homecoming.from.z, hand.z, along)
          );
          wand.spin.rotation.x = 0;

          if (progress >= 1) {
            homecomings.delete(self.id);
          }
        } else {
          wand.group.visible = false;
        }
      }
    },
  };
};
