/**
 * The slide's dust: a Duelist sliding out of a run kicks up the floor's
 * dust as they go, a burst where the slide starts and a trail of puffs
 * behind the feet while it lasts, with grit skimming the stone. The puffs
 * are the air cloud's dust (`air-cloud.ts`), in one pool of their own; the
 * grit goes to the shared spark ring.
 */
import { Color } from "three/webgpu";
import type { Object3D } from "three/webgpu";

import type { DuelEvent, DuelistState } from "../duel/duel";
import type { GroundPoint } from "../duel/geometry";
import type { Tuning } from "../tuning";
import { createDustPool } from "./air-cloud";
import { createAirField } from "./air-field";
import type { SparkRing } from "./spark-ring";

export interface SlideDust {
  /** A slide just started: its burst. */
  readonly handle: (events: readonly DuelEvent[]) => void;
  /** Kicks up the trail behind every sliding Duelist, then ages the dust by `seconds`. */
  readonly update: (duelists: readonly DuelistState[], seconds: number) => void;
}

export interface SlideDustSettings {
  readonly look: Tuning["slideDust"];
  /** The puffs' shared look (shape, light, erosion): Depulso's dust cloud. */
  readonly cloud: Tuning["depulsoLook"]["cloud"];
  readonly sparks: SparkRing;
  readonly random: () => number;
}

export const createSlideDust = (
  parent: Object3D,
  { cloud, look, random, sparks }: SlideDustSettings
): SlideDust => {
  const pool = createDustPool(
    look.slots,
    cloud,
    createAirField(cloud.fieldSize)
  );

  pool.sprite.renderOrder = 2;
  parent.add(pool.sprite);

  const tint = new Color(look.color);
  const grit = new Color(look.grit.color);
  /** Puffs owed to each sliding Duelist's trail, by id. */
  const owed = new Map<string, number>();

  const between = ([min, max]: readonly number[]) =>
    (min ?? 0) + ((max ?? 0) - (min ?? 0)) * random();

  /** One puff at the feet of a Duelist at `at` sliding along `heading`, thrown back off it. */
  const puff = (at: GroundPoint, heading: GroundPoint, speed: number) => {
    const side = (random() * 2 - 1) * look.spread;

    pool.emit({
      aspect: look.aspect,
      drag: look.drag,
      life: between(look.life),
      origin: {
        x: at.x + heading.x * look.ahead + heading.z * side * 0.5,
        y: look.height,
        z: at.z + heading.z * look.ahead - heading.x * side * 0.5,
      },
      rise: look.rise,
      size: [between(look.size.from), between(look.size.to)],
      strength: look.opacity * (0.6 + 0.4 * random()),
      tint,
      velocity: {
        x: -heading.x * speed * look.kick + heading.z * side,
        y: look.lift * (0.5 + random()),
        z: -heading.z * speed * look.kick - heading.x * side,
      },
      wander: look.wander,
    });
  };

  const skim = (at: GroundPoint, heading: GroundPoint) => {
    sparks.emit({ x: at.x, y: 0.04, z: at.z }, grit, {
      gravity: look.grit.gravity,
      heading: {
        x: heading.x + (random() * 2 - 1) * 0.6,
        y: look.grit.lift,
        z: heading.z + (random() * 2 - 1) * 0.6,
      },
      intensity: look.grit.intensity,
      life: look.grit.life * (0.6 + 0.4 * random()),
      size: look.grit.size,
      speed: look.grit.speed * (0.5 + 0.5 * random()),
      spread: look.grit.spread,
      streak: look.grit.streak,
    });
  };

  const positions = new Map<string, GroundPoint>();

  return {
    handle: (events) => {
      for (const event of events) {
        const at =
          event.type === "slide" ? positions.get(event.duelistId) : undefined;

        if (event.type === "slide" && at) {
          for (let each = 0; each < look.burst; each += 1) {
            puff(at, event.direction, look.burstSpeed);
          }

          for (let each = 0; each < look.grit.burst; each += 1) {
            skim(at, event.direction);
          }
        }
      }
    },
    update: (duelists, seconds) => {
      for (const self of duelists) {
        positions.set(self.id, self.position);
        const speed = Math.hypot(self.velocity.x, self.velocity.z);

        if (self.slideSeconds <= 0 || speed < 1e-3) {
          owed.delete(self.id);
          continue;
        }

        const heading = {
          x: self.velocity.x / speed,
          z: self.velocity.z / speed,
        };

        // A trail by the ground covered: faster, thicker.
        let due = (owed.get(self.id) ?? 0) + look.perMetre * speed * seconds;

        while (due >= 1) {
          puff(self.position, heading, speed);

          if (random() < look.grit.share) {
            skim(self.position, heading);
          }

          due -= 1;
        }

        owed.set(self.id, due);
      }

      pool.advance(seconds);
    },
  };
};
