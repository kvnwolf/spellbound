/**
 * Room to fall: where a Knocked Out body can lie inside the Arena. The fall
 * (`Death01`) lays the body down behind the feet, so a Duelist knocked out
 * with a wall, a column or the fountain behind them would lie through it.
 * This finds the smallest turn of the falling body (and, failing that, a
 * short slide inward) that keeps the whole body on open floor. Pure: no
 * three.js, no DOM.
 */
import type { ArenaLayout } from "../duel/duel";
import type { GroundPoint } from "../duel/geometry";
import type { Tuning } from "../tuning";

export type FallRoomSettings = Tuning["duelist"]["motion"]["knockout"]["room"];

/** How the drawn fall is placed: turned `turn` radians off the facing (left +), slid `x`, `z` metres (world). */
export interface FallPlacement {
  readonly turn: number;
  readonly x: number;
  readonly z: number;
}

export const unmoved: FallPlacement = { turn: 0, x: 0, z: 0 };

interface Disc {
  x: number;
  z: number;
  readonly radius: number;
}

/**
 * The slide that pushes every disc of the lying body clear of the Arena's
 * walls, Cover and Obstructions (a few relaxation passes), and how far the
 * body still overlaps them after it.
 */
const slideClear = (
  discs: readonly Disc[],
  arena: ArenaLayout,
  clearance: number
) => {
  const obstacles = [...arena.cover, ...arena.obstructions];
  const { halfDepth, halfWidth } = arena.bounds;
  let x = 0;
  let z = 0;

  const overlap = (disc: Disc, push: boolean) => {
    const limitX = halfWidth - disc.radius - clearance;
    const limitZ = halfDepth - disc.radius - clearance;
    const cx0 = disc.x + x;
    const cz0 = disc.z + z;
    // Past a wall: how far, toward the inside.
    const pastX = Math.max(Math.abs(cx0) - limitX, 0);
    const pastZ = Math.max(Math.abs(cz0) - limitZ, 0);
    let worst = Math.max(pastX, pastZ);

    if (push) {
      x -= Math.sign(cx0) * pastX;
      z -= Math.sign(cz0) * pastZ;
    }

    for (const { center, radius } of obstacles) {
      const dx = disc.x + x - center.x;
      const dz = disc.z + z - center.z;
      const distance = Math.hypot(dx, dz);
      const over = radius + disc.radius + clearance - distance;

      if (over > 0) {
        worst = Math.max(worst, over);

        if (push && distance > 1e-6) {
          x += (dx / distance) * over;
          z += (dz / distance) * over;
        }
      }
    }

    return worst;
  };

  for (let pass = 0; pass < 4; pass += 1) {
    for (const disc of discs) {
      overlap(disc, true);
    }
  }

  const left = Math.max(0, ...discs.map((disc) => overlap(disc, false)));

  return { left, x, z };
};

/**
 * Where a body knocked out at `position`, facing `facingYaw` (radians, 0
 * down +z), lies clear of `arena`: of every turn (`turnStep` apart, either
 * way, up to half a circle) the one that fits with the least turning and
 * sliding (`shiftCost` radians a metre), sliding at most `maxShift` metres.
 * With no room anywhere, the one that overlaps least.
 */
export const fallRoom = (
  position: GroundPoint,
  facingYaw: number,
  arena: ArenaLayout,
  settings: FallRoomSettings
): FallPlacement => {
  const { body, clearance, maxShift, shiftCost, turnStep } = settings;
  const steps = Math.round(Math.PI / turnStep);
  let best = unmoved;
  let bestCost = Number.POSITIVE_INFINITY;

  for (let index = 0; index <= 2 * steps; index += 1) {
    // 0, +1, -1, +2, -2... steps, up to half a circle.
    const turn = (index % 2 === 0 ? -1 : 1) * Math.ceil(index / 2) * turnStep;

    if (Math.abs(turn) > Math.PI + 1e-9) {
      continue;
    }

    const yaw = facingYaw + turn;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);

    // The body's discs (its frame: +x left, +z ahead) on the floor.
    const discs = body.map(([x, z, radius]) => ({
      radius,
      x: position.x + x * cos + z * sin,
      z: position.z - x * sin + z * cos,
    }));

    const slide = slideClear(discs, arena, clearance);
    const shift = Math.hypot(slide.x, slide.z);
    const fits = slide.left < 1e-3 && shift <= maxShift;

    const cost =
      Math.abs(turn) +
      shiftCost * shift +
      (fits ? 0 : 1000 + 100 * (slide.left + Math.max(shift - maxShift, 0)));

    if (cost < bestCost) {
      // Never a long slide, even with no room anywhere.
      const kept = shift > maxShift ? maxShift / shift : 1;
      bestCost = cost;
      best = { turn, x: slide.x * kept, z: slide.z * kept };
    }
  }

  return best;
};
