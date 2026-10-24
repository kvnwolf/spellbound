/**
 * The destructible Arena: each column of Cover and each Obstruction (the
 * fountain) has structural health that Spells wear down, cracked partway
 * and broken at zero. Broken Cover no longer stops Spells or sight: it lies
 * as low rubble, an Obstruction of the column's footprint, so Duelists still
 * walk round it. Pure; the Duel simulation decides what strikes what.
 */
import type { Tuning } from "../tuning";
import type { ArenaLayout, CoverColumn } from "./duel";
import { distanceBetween } from "./geometry";
import type { GroundPoint, Point3 } from "./geometry";

/** How broken a piece looks and behaves: whole, cracked, or broken into rubble. */
export type StructureStage = "cracked" | "destroyed" | "intact";

/** One breakable piece of the Arena and how much it can still take. */
export interface StructureState {
  /**
   * Stable for the whole Duel: the piece's index in the Arena layout's
   * Cover, then its Obstructions after them.
   */
  readonly id: number;
  /** What the piece was built as: a column of Cover, or a low Obstruction (the fountain). */
  readonly role: "cover" | "obstruction";
  readonly center: GroundPoint;
  readonly radius: number;
  /** Structure points left, from the role's full health down to 0 (broken). */
  readonly health: number;
  readonly stage: StructureStage;
}

type StructureTuning = Tuning["structures"];

const stageOf = (
  health: number,
  full: number,
  settings: StructureTuning
): StructureStage => {
  if (health <= 0) {
    return "destroyed";
  }

  return health <= full * settings.crackedShare ? "cracked" : "intact";
};

/** Every piece of `arena` whole, as a Duel starts. */
export const raiseStructures = (
  arena: ArenaLayout,
  settings: StructureTuning
): StructureState[] =>
  [
    ...arena.cover.map((piece) => ({ piece, role: "cover" as const })),
    ...arena.obstructions.map((piece) => ({
      piece,
      role: "obstruction" as const,
    })),
  ].map(({ piece, role }, id) => ({
    center: piece.center,
    health: settings[role].health,
    id,
    radius: piece.radius,
    role,
    stage: "intact",
  }));

/** `structure` after taking `amount` structure points; a broken piece takes no more. */
export const wearDown = (
  structure: StructureState,
  amount: number,
  settings: StructureTuning
): StructureState => {
  const health = Math.max(structure.health - amount, 0);

  return {
    ...structure,
    health,
    stage: stageOf(health, settings[structure.role].health, settings),
  };
};

/**
 * The Arena as it stands: broken Cover leaves `cover` and lies as rubble
 * among the Obstructions; a broken Obstruction stays one, as rubble.
 */
export const standingArena = (
  arena: ArenaLayout,
  structures: readonly StructureState[]
): ArenaLayout => {
  const piece = ({ center, radius }: StructureState): CoverColumn => ({
    center,
    radius,
  });

  return {
    bounds: arena.bounds,
    cover: structures.flatMap((each) =>
      each.role === "cover" && each.stage !== "destroyed" ? [piece(each)] : []
    ),
    obstructions: [
      ...structures.filter((each) => each.role === "obstruction"),
      ...structures.filter(
        (each) => each.role === "cover" && each.stage === "destroyed"
      ),
    ].map(piece),
  };
};

/** How far `point` is from the edge of `structure`'s footprint along the floor; 0 inside it. */
export const reachTo = (structure: StructureState, point: GroundPoint) =>
  Math.max(distanceBetween(structure.center, point) - structure.radius, 0);

/**
 * The standing piece a Spell stopped at `position` ran into: the column of
 * Cover whose edge it touches (within `touch` metres), or the Obstruction
 * it came down into.
 */
export const struckAt = (
  structures: readonly StructureState[],
  position: Point3,
  by: "cover" | "floor",
  touch: number
): StructureState | undefined => {
  const role = by === "cover" ? "cover" : "obstruction";
  let best: StructureState | undefined;
  let bestReach = touch;

  for (const each of structures) {
    const reach = reachTo(each, position);

    if (
      each.role === role &&
      each.stage !== "destroyed" &&
      reach <= bestReach
    ) {
      best = each;
      bestReach = reach;
    }
  }

  return best;
};

/** The point of `structure` a blast centred at `centre` reaches first, at the blast's height. */
export const nearestPointOf = (
  structure: StructureState,
  centre: Point3
): Point3 => {
  const away = distanceBetween(structure.center, centre);
  const share = away > structure.radius ? structure.radius / away : 1;

  return {
    x: structure.center.x + (centre.x - structure.center.x) * share,
    y: centre.y,
    z: structure.center.z + (centre.z - structure.center.z) * share,
  };
};
