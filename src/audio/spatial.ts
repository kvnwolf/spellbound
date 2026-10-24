/**
 * Where a sound is heard from: how loud and how far left or right, from
 * where it happens relative to the camera. Pure: no WebAudio, no three.js.
 */
import type { Point3 } from "../duel/geometry";

/** The ears: the camera's position and the unit direction it looks along. */
export interface Listener {
  readonly position: Point3;
  readonly forward: Point3;
}

export interface SpatialSettings {
  /** Sounds within this many metres play at full volume... */
  readonly refDistance: number;
  /** ...and fade beyond it, faster the higher this is (WebAudio's inverse distance model). */
  readonly rolloff: number;
  /** Never quieter than this share of full volume, so a far sound still reads. */
  readonly minGain: number;
  /** Stereo pan for a sound straight to one side (1 is hard left or right). */
  readonly maxPan: number;
  /** The opponent's sounds play at this share of the local Duelist's. */
  readonly opponentGain: number;
}

export interface Placement {
  /** Volume, 0 to 1. */
  readonly gain: number;
  /** Stereo position, -1 (left) to 1 (right). */
  readonly pan: number;
}

/**
 * How a sound at `at` is heard by `listener`; null for the local Duelist's
 * own (and the HUD's), dead centre at full volume. `opponent` for sounds the
 * opponent makes.
 */
export const placement = (
  at: Point3 | null,
  opponent: boolean,
  listener: Listener,
  settings: SpatialSettings
): Placement => {
  const share = opponent ? settings.opponentGain : 1;

  if (!at) {
    return { gain: share, pan: 0 };
  }

  const dx = at.x - listener.position.x;
  const dz = at.z - listener.position.z;
  const distance = Math.hypot(dx, at.y - listener.position.y, dz);
  const { minGain, refDistance, rolloff } = settings;

  const falloff =
    distance <= refDistance
      ? 1
      : refDistance / (refDistance + rolloff * (distance - refDistance));

  // The listener's right on the floor: the forward direction turned a quarter
  // clockwise seen from above (three.js: x right, z toward the viewer).
  const rightX = -listener.forward.z;
  const rightZ = listener.forward.x;
  const across = Math.hypot(dx, dz) * Math.hypot(rightX, rightZ);
  const side = across > 1e-6 ? (dx * rightX + dz * rightZ) / across : 0;

  return {
    gain: Math.max(falloff, minGain) * share,
    pan: side * settings.maxPan,
  };
};
