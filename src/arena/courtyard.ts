/**
 * The castle courtyard Arena: the collision layout the Duel simulation uses
 * and the courtyard view builds its geometry from, so what you see is what
 * you collide with. Pure data.
 */
import type { ArenaLayout } from "../duel/duel";
import type { GroundPoint } from "../duel/geometry";

const columnRadius = 0.55;

export const courtyard: ArenaLayout = {
  bounds: { halfDepth: 14, halfWidth: 11 },
  // Two rows of columns flanking the centre line, plus one on each side:
  // Cover to duck behind without blocking the opening line of sight.
  cover: [
    { center: { x: -4, z: -4 }, radius: columnRadius },
    { center: { x: 4, z: -4 }, radius: columnRadius },
    { center: { x: -4, z: 4 }, radius: columnRadius },
    { center: { x: 4, z: 4 }, radius: columnRadius },
    { center: { x: -7.5, z: 0 }, radius: columnRadius },
    { center: { x: 7.5, z: 0 }, radius: columnRadius },
  ],
};

/** Where each Team's Duelist starts, facing each other down the courtyard. */
export const courtyardSpawns: Readonly<Record<"near" | "far", GroundPoint>> = {
  far: { x: 0, z: -8 },
  near: { x: 0, z: 8 },
};
