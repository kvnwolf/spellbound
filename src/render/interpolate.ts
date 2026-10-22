/**
 * Presentation samples between two fixed simulation ticks. Rendering runs at
 * display rate, so each frame blends the previous and current snapshots by
 * how far the clock is into the next tick (`alpha` in [0, 1]).
 */
import type { DuelistId, DuelistState, SpellState } from "../duel/duel";
import { wrapAngle } from "../duel/geometry";
import type { Aim, GroundPoint, Point3 } from "../duel/geometry";

/** Where a Duelist should be drawn this frame. */
export interface DuelistSample {
  readonly position: GroundPoint;
  readonly facing: GroundPoint;
  /** Where the Duelist looks: the free camera's direction. */
  readonly aim: Aim;
  /** The Lock-on Target, if any, and the framing nudge while Locked On. */
  readonly targetId: DuelistId | null;
  readonly lockNudge: Aim;
  /** The Lock-on Target is out of sight behind Cover. */
  readonly targetHidden: boolean;
  /** States are not blended: they switch on the tick that changes them. */
  readonly knockedOut: boolean;
  readonly staggered: boolean;
}

const lerp = (from: number, to: number, alpha: number) =>
  from + (to - from) * alpha;

/** Blends two angles the short way round. */
const lerpAngle = (from: number, to: number, alpha: number) =>
  wrapAngle(from + wrapAngle(to - from) * alpha);

const lerpAim = (from: Aim, to: Aim, alpha: number): Aim => ({
  pitch: lerp(from.pitch, to.pitch, alpha),
  yaw: lerpAngle(from.yaw, to.yaw, alpha),
});

/** Blends facings and renormalises, which stays well-behaved for a tick's worth of turn. */
const blendDirection = (
  from: GroundPoint,
  to: GroundPoint,
  alpha: number
): GroundPoint => {
  const x = lerp(from.x, to.x, alpha);
  const z = lerp(from.z, to.z, alpha);
  const length = Math.hypot(x, z);

  return length < 1e-6 ? to : { x: x / length, z: z / length };
};

export const sampleDuelist = (
  previous: DuelistState,
  current: DuelistState,
  alpha: number
): DuelistSample => ({
  aim: lerpAim(previous.aim, current.aim, alpha),
  facing: blendDirection(previous.facing, current.facing, alpha),
  knockedOut: current.knockedOut,
  lockNudge: lerpAim(previous.lockNudge, current.lockNudge, alpha),
  position: {
    x: lerp(previous.position.x, current.position.x, alpha),
    z: lerp(previous.position.z, current.position.z, alpha),
  },
  staggered: current.staggerSeconds > 0,
  targetHidden: current.targetHiddenSeconds > 0,
  targetId: current.targetId,
});

/**
 * Where a Spell in flight should be drawn this frame. A Spell cast on the
 * latest tick has no previous position and is drawn where it was cast.
 */
export const sampleSpell = (
  previous: SpellState | undefined,
  current: SpellState,
  alpha: number
): Point3 =>
  previous
    ? {
        x: lerp(previous.position.x, current.position.x, alpha),
        y: lerp(previous.position.y, current.position.y, alpha),
        z: lerp(previous.position.z, current.position.z, alpha),
      }
    : current.position;
