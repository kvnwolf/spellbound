/**
 * The Arena's breakable pieces, drawn as the Duel reports them: every column
 * of Cover and the fountain, pre-fractured (`pieces.ts`, `fracture.ts`) and
 * drawn whole from their fragments while they stand. Views only.
 *
 * - A Spell striking a piece knocks chips off the struck face, with grit
 *   and a puff of dust: a few for Stupefy, a spray for Confringo.
 * - As a piece wears down its stone cracks (`ruin-material.ts`), and the
 *   moment it cracks chunks fall from it in a roll of dust.
 * - Broken, its fragments fly apart on the blow and settle as rubble round
 *   the stump in a big cloud of dust, rolling out along the floor and
 *   billowing up its height. The rubble stays for the whole Duel.
 * - A new Duel (a fresh snapshot, every piece whole again) rebuilds it.
 *
 * The fragments' flight, the chips and the dust are pure functions of
 * their age on the GPU; per frame the CPU only sets each piece's age,
 * damage and the blow's heading. Every material draws from load (the
 * pieces whole, the pools at zero size), so nothing compiles mid-Duel.
 */
import { float, step } from "three/tsl";
import { BoxGeometry, Color, Group, Mesh } from "three/webgpu";
import type { MeshStandardNodeMaterial } from "three/webgpu";

import { fountainRadius } from "../../arena/courtyard";
import { createRandom } from "../../controllers/random";
import type { ArenaLayout, DuelEvent, StructureState } from "../../duel/duel";
import { distanceBetween } from "../../duel/geometry";
import type { GroundPoint, Point3 } from "../../duel/geometry";
import { raiseStructures } from "../../duel/structures";
import type { Tuning } from "../../tuning";
import { createDustPool } from "../air-cloud";
import { createAirField } from "../air-field";
import { createFountain, fountainInnerRadius } from "../courtyard/fountain";
import {
  ashlarStone,
  columnStone,
  createAshlarMaterial,
} from "../courtyard/materials";
import type { SparkRing } from "../spark-ring";
import { createChipPool } from "./debris";
import { fractureSolid } from "./fracture";
import { columnCuts, rimCuts, spoutCuts } from "./pieces";
import type { PieceCuts } from "./pieces";
import { createRuinMaterial, standing } from "./ruin-material";
import type { RuinState } from "./ruin-material";

export interface RuinsSettings {
  readonly look: Tuning["structureLook"];
  readonly structures: Tuning["structures"];
  readonly courtyard: Tuning["courtyard"];
  /** The shared spark ring the grit is drawn with. */
  readonly sparks: SparkRing;
}

export interface RuinsView {
  readonly object: Group;
  /** Chips, grit and dust for this frame's strikes, cracks and breaks. */
  readonly handle: (events: readonly DuelEvent[]) => void;
  /**
   * Brings the pieces in line with the Duel's `structures` (cracks, broken
   * or whole again for a new Duel) and ages everything by `seconds` of
   * simulation time.
   */
  readonly show: (
    structures: readonly StructureState[],
    seconds: number
  ) => void;
}

/** One breakable piece as drawn. */
interface PieceView {
  readonly structure: StructureState;
  readonly state: RuinState;
  /** How tall it stands, metres: where its dust and chunks come from. */
  readonly height: number;
  /** Its surface's radius: where a crack's chunks fall from. */
  readonly girth: number;
  /** The fountain's veil, gone with the spout. */
  readonly veil?: Mesh;
  broken: boolean;
  age: number;
  /** Its structure points when last shown: more now means a new Duel rebuilt it. */
  health: number;
}

/** Fragments have settled long before this; the clock stops so it never grows. */
const settledAge = 30;

const shadowed = (mesh: Mesh) => {
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  return mesh;
};

/** A ruin mesh of `cuts`, drawn with `material`, standing at `at`. */
const ruinMesh = (
  cuts: PieceCuts,
  seed: number,
  material: MeshStandardNodeMaterial,
  at: GroundPoint
) => {
  const mesh = shadowed(
    new Mesh(
      fractureSolid(cuts.solid, cuts.cells, cuts.welded, seed, cuts.reach),
      material
    )
  );

  mesh.position.set(at.x, 0, at.z);

  return mesh;
};

/** A unit vector on the floor from `from` toward `to`, or `fallback` when they meet. */
const outward = (
  from: GroundPoint,
  to: GroundPoint,
  fallback: GroundPoint
): GroundPoint => {
  const length = distanceBetween(from, to);

  return length < 1e-6
    ? fallback
    : { x: (to.x - from.x) / length, z: (to.z - from.z) / length };
};

export const createRuinsView = (
  layout: ArenaLayout,
  { courtyard, look, sparks, structures: structureTuning }: RuinsSettings
): RuinsView => {
  const object = new Group();
  const pieces: PieceView[] = [];
  const plinthStone = createAshlarMaterial();

  for (const structure of raiseStructures(layout, structureTuning)) {
    const { center, id, radius, role } = structure;
    const seed = 101 + id * 7919;

    if (role === "cover") {
      const where = standing();
      // The abacus slab on top is plain, not fluted.
      const fluted = step(where.local.y, float(3.921));
      const stone = columnStone({ fluted, ...where });
      const { material, state } = createRuinMaterial(stone, look);

      const plinth = shadowed(
        new Mesh(new BoxGeometry(radius * 2.3, 0.3, radius * 2.3), plinthStone)
      );

      plinth.position.set(center.x, 0.15, center.z);
      object.add(
        plinth,
        ruinMesh(columnCuts(radius, seed, look), seed, material, center)
      );
      pieces.push({
        age: 0,
        broken: false,
        girth: radius,
        health: structure.health,
        height: 4.1,
        state,
        structure,
      });
    } else {
      const stone = ashlarStone(undefined, undefined, standing().world);

      const { material, state } = createRuinMaterial(stone, look);
      const fountain = createFountain(plinthStone, courtyard);
      // The basin's wall keeps its thickness in proportion.
      const inner = (radius * fountainInnerRadius) / fountainRadius;

      fountain.object.position.set(center.x, 0, center.z);
      object.add(
        fountain.object,
        ruinMesh(rimCuts(radius, inner, seed, look), seed, material, center),
        ruinMesh(spoutCuts(seed + 1, look), seed + 1, material, center)
      );
      pieces.push({
        age: 0,
        broken: false,
        girth: radius,
        health: structure.health,
        height: 0.9,
        state,
        structure,
        veil: fountain.veil,
      });
    }
  }

  // Chips (lit stone, one draw) and dust (the Depulso cloud's puffs, its
  // own pool).
  const chips = createChipPool(look.chips);
  const field = createAirField(look.dust.cloud.fieldSize);

  const dust = createDustPool(
    look.dust.cloud.slots.dust,
    look.dust.cloud,
    field
  );

  dust.sprite.renderOrder = 2;
  object.add(chips.mesh, dust.sprite);

  const random = createRandom(9001);
  const dustColor = new Color(look.dust.color);
  const gritColor = new Color(look.chips.light);

  const between = (range: { readonly min: number; readonly max: number }) =>
    range.min + (range.max - range.min) * random();

  const pieceOf = (id: number) =>
    pieces.find((each) => each.structure.id === id);

  /** A chip thrown off `origin` along `along` (on the floor), within the look's spread, `lift` up. */
  const throwChip = (
    origin: Point3,
    along: GroundPoint,
    size: number,
    speed: number,
    lift: number
  ) => {
    const { spread } = look.chips;
    const sideways = (random() * 2 - 1) * spread;

    const axis = {
      x: random() * 2 - 1,
      y: random() * 2 - 1,
      z: random() * 2 - 1,
    };

    const axisLength = Math.hypot(axis.x, axis.y, axis.z) || 1;

    chips.emit({
      axis: {
        x: axis.x / axisLength,
        y: axis.y / axisLength,
        z: axis.z / axisLength,
      },
      origin,
      shade: random(),
      size,
      spin: 4 + random() * 10,
      velocity: {
        x: (along.x - along.z * sideways) * speed,
        y: lift * speed,
        z: (along.z + along.x * sideways) * speed,
      },
    });
  };

  /** A point on `piece`'s surface facing `along`, `y` up. */
  const onSurface = (piece: PieceView, along: GroundPoint, y: number) => ({
    x: piece.structure.center.x + along.x * piece.girth,
    y,
    z: piece.structure.center.z + along.z * piece.girth,
  });

  /** Chips, grit and a puff off the struck face. */
  const strike = (
    piece: PieceView,
    position: Point3,
    face: GroundPoint,
    damage: number
  ) => {
    const { chips: chipLook } = look;
    const { hit } = look.dust;
    const at = { ...position, y: Math.max(position.y, 0.12) };
    const count = Math.round(chipLook.perHit + chipLook.perDamage * damage);

    for (let index = 0; index < count; index += 1) {
      throwChip(
        at,
        face,
        between(chipLook.size),
        between(chipLook.speed),
        0.2 + random() * 0.7
      );
    }

    const { grit } = look;

    for (let index = 0; index < count + grit.extra; index += 1) {
      sparks.emit(at, gritColor, {
        gravity: grit.gravity,
        heading: { x: face.x, y: grit.lift, z: face.z },
        intensity: grit.intensity,
        life: between(grit.life),
        size: grit.size,
        speed: between(grit.speed),
        spread: grit.spread,
        streak: grit.streak,
      });
    }

    const puffs = Math.round(hit.count + hit.perDamage * damage);

    for (let index = 0; index < puffs; index += 1) {
      dust.emit({
        drag: hit.drag,
        life: hit.life * (0.7 + random() * 0.6),
        origin: at,
        rise: hit.rise,
        size: [hit.size.from, hit.size.to * (0.7 + random() * 0.6)],
        strength: hit.opacity,
        tint: dustColor,
        velocity: {
          x: (face.x + (random() - 0.5)) * hit.speed,
          y: random() * 0.6,
          z: (face.z + (random() - 0.5)) * hit.speed,
        },
        wander: hit.wander,
      });
    }
  };

  /** Chunks falling off a piece as it cracks, in a roll of dust. */
  const crumble = (piece: PieceView) => {
    const { crack } = look.dust;

    for (let index = 0; index < look.chips.crack; index += 1) {
      const angle = random() * Math.PI * 2;
      const along = { x: Math.cos(angle), z: Math.sin(angle) };

      throwChip(
        onSurface(piece, along, piece.height * (0.3 + random() * 0.65)),
        along,
        between({ max: look.chips.size.big, min: look.chips.size.max }),
        0.6 + random(),
        0.3
      );
    }

    for (let index = 0; index < crack.count; index += 1) {
      const angle = random() * Math.PI * 2;
      const along = { x: Math.cos(angle), z: Math.sin(angle) };

      dust.emit({
        drag: crack.drag,
        life: crack.life * (0.7 + random() * 0.6),
        origin: onSurface(piece, along, piece.height * (0.2 + random() * 0.7)),
        rise: crack.rise,
        size: [crack.size.from, crack.size.to],
        strength: crack.opacity,
        tint: dustColor,
        velocity: {
          x: along.x * crack.drift,
          y: -crack.fall,
          z: along.z * crack.drift,
        },
        wander: crack.wander,
      });
    }
  };

  /** The big cloud of a break, and a burst of chips. */
  const collapse = (piece: PieceView, heading: GroundPoint) => {
    const { burst } = look.dust;
    const { column, ring } = burst;
    const { center } = piece.structure;

    for (let index = 0; index < ring.count; index += 1) {
      const angle = (index / ring.count) * Math.PI * 2 + random() * 0.3;
      const along = { x: Math.cos(angle), z: Math.sin(angle) };
      // The cloud leans the way the blow went.
      const lean = 1 + 0.5 * (along.x * heading.x + along.z * heading.z);

      dust.emit({
        aspect: ring.aspect,
        delay: random() * 0.12,
        drag: ring.drag,
        life: between(burst.life),
        origin: onSurface(piece, along, 0.35),
        rise: ring.rise,
        size: [burst.size.from, burst.size.to * (0.8 + random() * 0.4)],
        strength: burst.opacity,
        tint: dustColor,
        velocity: {
          x: along.x * ring.speed * lean,
          y: 0.3,
          z: along.z * ring.speed * lean,
        },
        wander: ring.wander,
      });
    }

    for (let index = 0; index < column.count; index += 1) {
      const angle = random() * Math.PI * 2;
      const along = { x: Math.cos(angle), z: Math.sin(angle) };
      const y = piece.height * (0.15 + 0.85 * (index / column.count));

      dust.emit({
        delay: random() * 0.25,
        drag: column.drag,
        life: between(burst.life),
        origin: { x: center.x, y, z: center.z },
        rise: column.rise,
        size: [burst.size.from, burst.size.to * (0.7 + random() * 0.5)],
        strength: burst.opacity * column.opacity,
        tint: dustColor,
        velocity: {
          x: (along.x * 1.5 + heading.x * 1.2) * (0.6 + random()),
          y: random() * 0.8,
          z: (along.z * 1.5 + heading.z * 1.2) * (0.6 + random()),
        },
        wander: column.wander,
      });
    }

    for (let index = 0; index < look.chips.burst; index += 1) {
      const angle = random() * Math.PI * 2;
      const along = { x: Math.cos(angle), z: Math.sin(angle) };

      const pushed = {
        x: along.x + heading.x * 0.6,
        z: along.z + heading.z * 0.6,
      };

      const length = Math.hypot(pushed.x, pushed.z) || 1;

      throwChip(
        onSurface(piece, along, piece.height * random()),
        { x: pushed.x / length, z: pushed.z / length },
        between({ max: look.chips.size.big, min: look.chips.size.min }),
        between(look.chips.speed),
        0.3 + random() * 0.8
      );
    }
  };

  const breakApart = (piece: PieceView, heading: GroundPoint) => {
    piece.broken = true;
    piece.age = 0;
    piece.state.heading.value.set(heading.x, heading.z);

    if (piece.veil) {
      piece.veil.visible = false;
    }
  };

  const rebuild = (piece: PieceView) => {
    piece.broken = false;
    piece.age = 0;

    if (piece.veil) {
      piece.veil.visible = true;
    }
  };

  return {
    handle: (events) => {
      for (const event of events) {
        if (event.type !== "structure-hit") {
          continue;
        }

        const piece = pieceOf(event.structureId);

        if (!piece) {
          continue;
        }

        const back = { x: -event.heading.x, z: -event.heading.z };
        const face = outward(piece.structure.center, event.position, back);

        strike(piece, event.position, face, event.damage);

        if (event.stage === "cracked" && event.before === "intact") {
          crumble(piece);
        }

        if (event.stage === "destroyed" && !piece.broken) {
          crumble(piece);
          collapse(piece, event.heading);
          breakApart(piece, event.heading);
        }
      }
    },
    object,
    show: (structures, seconds) => {
      for (const piece of pieces) {
        const now = structures.find((each) => each.id === piece.structure.id);

        if (!now) {
          continue;
        }

        const full = structureTuning[now.role].health;
        piece.state.damage.value = 1 - now.health / full;

        // Whole again: a new Duel. The chips lying about go too.
        if (now.health > piece.health) {
          rebuild(piece);
          chips.clear();
        }

        piece.health = now.health;

        if (now.stage === "destroyed" && !piece.broken) {
          // Broken without our seeing the blow: already lying as rubble.
          breakApart(piece, { x: 1, z: 0 });
          piece.age = settledAge;
        }

        if (piece.broken) {
          piece.age = Math.min(piece.age + seconds, settledAge);
        }

        piece.state.age.value = piece.broken ? piece.age : 0;
      }

      chips.advance(seconds);
      dust.advance(seconds);
    },
  };
};
