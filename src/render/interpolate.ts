/**
 * Presentation samples between two fixed simulation ticks. Rendering runs at
 * display rate, so each frame blends the previous and current snapshots by
 * how far the clock is into the next tick (`alpha` in [0, 1]).
 */
import { clashOpponentOf } from "../duel/duel";
import type {
  ClashState,
  Drinking,
  DuelistId,
  DuelistState,
  LastingPotion,
  SpellState,
} from "../duel/duel";
import { lerp, wrapAngle } from "../duel/geometry";
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
  /** States are not blended: they switch on the tick that changes them. */
  readonly knockedOut: boolean;
  /** In a Practice, seconds left down after reaching zero Health (see `DuelistState`). */
  readonly downSeconds: number;
  /** Staggered by a strong Stupefy or a Backfire. */
  readonly staggered: boolean;
  /** Sliding back from a Confringo or Depulso hit. */
  readonly knockedBack: boolean;
  /** Rooted in a Clash, Wand locked on the beam. */
  readonly clashing: boolean;
  /** Running at sprint speed. */
  readonly sprinting: boolean;
  /** Crouched (or sliding, which ends crouched). */
  readonly crouching: boolean;
  /** Sliding along the floor out of a run. */
  readonly sliding: boolean;
  /** Charging a Heavy Spell: the Wand stays raised. */
  readonly charging: boolean;
  /** Height of the feet off the floor, mid-jump. */
  readonly elevation: number;
  readonly shielding: boolean;
  readonly dodging: boolean;
  /** Frozen by Petrificus Totalus. */
  readonly petrified: boolean;
  /** Burning from an Incendio explosion. */
  readonly burning: boolean;
  /** Disarmed: the Wand is out of the hand. */
  readonly disarmed: boolean;
  /** Where the loose Wand is while Disarmed (flying, then on the floor), or null. */
  readonly looseWand: Point3 | null;
  /** Focus points, for the full-Focus aura on the Wand. */
  readonly focus: number;
  /** Stamina points, for how hard the Duelist breathes. */
  readonly stamina: number;
  /** The Potion being drunk and how long until it is down, for the vial at the lips. */
  readonly drinking: Drinking | null;
  /** Seconds left of each lasting Potion's effect, for its aura. */
  readonly potionEffects: Readonly<Record<LastingPotion, number>>;
}

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
  alpha: number,
  clash: ClashState | null = null
): DuelistSample => ({
  aim: lerpAim(previous.aim, current.aim, alpha),
  burning: current.burnSeconds > 0,
  charging: current.chargeSeconds > 0,
  clashing: clashOpponentOf(clash, current.id) !== undefined,
  crouching: current.crouching,
  disarmed: current.looseWand !== null,
  dodging: current.dodgeSeconds > 0,
  downSeconds: current.downSeconds,
  drinking: current.drinking,
  elevation: lerp(previous.elevation, current.elevation, alpha),
  facing: blendDirection(previous.facing, current.facing, alpha),
  focus: current.focus,
  knockedBack: current.knockbackSeconds > 0,
  knockedOut: current.knockedOut,
  lockNudge: lerpAim(previous.lockNudge, current.lockNudge, alpha),
  looseWand: current.looseWand?.position ?? null,
  petrified: current.petrifiedSeconds > 0,
  position: {
    x: lerp(previous.position.x, current.position.x, alpha),
    z: lerp(previous.position.z, current.position.z, alpha),
  },
  potionEffects: current.potionEffects,
  shielding: current.shielding,
  sliding: current.slideSeconds > 0,
  sprinting: current.sprinting,
  staggered: current.staggerSeconds > 0,
  stamina: lerp(previous.stamina, current.stamina, alpha),
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
