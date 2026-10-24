import type { Aim } from "./geometry";
import type { PotionSlot } from "./potions";
import type { SpellSlot } from "./spell-slots";

/** A 2D vector in controller space: x is right, y is up/forward. */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/**
 * The Spell Slots (or the Potion Slots) this tick: `held` while the modifier
 * (R2, or L2, for a human) is held, and `press`, the slot whose button (a
 * face button, or a D-pad arrow for a Potion) was pressed this tick (for
 * that single tick), or null. The simulation casts the Special Spell (or
 * drinks the Potion) bound to a pressed slot, if it can.
 */
export interface SlotsIntent<Slot extends string = SpellSlot> {
  readonly held: boolean;
  readonly press: Slot | null;
}

/** A Lock-on Target switch: to the next opponent on the left (-1) or right (1), or none (0). */
export type TargetSwitch = -1 | 0 | 1;

/**
 * What a Controller wants its Duelist to do during one tick. Every Controller,
 * human or AI, produces this same shape; the Duel simulation interprets it and
 * owns the Lock-on state, the facing and where Spells go.
 */
export interface Intent {
  /**
   * Movement relative to the Duelist's aim (the camera, for a human): y walks
   * where they look (toward the Target while Locked On), x strafes right.
   * Length is at most 1.
   */
  readonly move: Vec2;
  /**
   * The camera-relative aim, as turn rates in radians per second: yaw turns
   * right, pitch looks up. Free-aiming it turns the aim; while Locked On it
   * only nudges the framing around the Target.
   */
  readonly look: Aim;
  /**
   * The Light Spell button is down this tick. The simulation casts on the
   * press, not while it is held, and remembers a press made during the
   * recovery of the previous cast so a quick rhythm never drops a cast.
   */
  readonly lightSpell: boolean;
  /**
   * The Heavy Spell button is held this tick. The simulation reads the hold
   * over time: a press starts a Charge, holding builds it, releasing casts
   * Confringo, and holding a full Charge too long Overcharges it into a Backfire.
   */
  readonly heavySpell: boolean;
  /**
   * Toggles Lock-on this tick: true for the single tick of the press. Locks
   * on to the opponent nearest the crosshair, or releases the current Target.
   */
  readonly lockOn: boolean;
  /** While Locked On, switches to the next opponent left or right, for the single tick of the request. */
  readonly switchTarget: TargetSwitch;
  /**
   * The Dodge button is down this tick. The simulation Dodges on the press,
   * in the direction of `move` (straight back with no direction held).
   */
  readonly dodge: boolean;
  /** The jump button is down this tick; the simulation jumps on the press. */
  readonly jump: boolean;
  /**
   * The Shield button is down this tick. The Shield goes up on the press (the
   * moment that times a Parry) and stays up while held, until Stamina runs out.
   */
  readonly shield: boolean;
  /** The sprint button is down this tick: sprinting lasts while it is held and Stamina lasts. */
  readonly sprint: boolean;
  /**
   * The crouch button is down this tick. The simulation reads the press: it
   * crouches, or stands back up; pressed while sprinting, it slides.
   */
  readonly crouch: boolean;
  /** The Spell Slots: the modifier held, and a slot pressed this tick. */
  readonly spellSlots: SlotsIntent;
  /** The Potion Slots: the modifier held, and a slot pressed this tick. */
  readonly potionSlots: SlotsIntent<PotionSlot>;
  /**
   * The Clash pump (△, for a human) is down this tick. Only a Duelist locked
   * in a Clash reads it: each press, not the hold, pushes the meeting point
   * toward the opponent. Outside a Clash it does nothing.
   */
  readonly clashPump: boolean;
}

/** The Intent of a Controller that does nothing. */
export const idleIntent: Intent = {
  clashPump: false,
  crouch: false,
  dodge: false,
  heavySpell: false,
  jump: false,
  lightSpell: false,
  lockOn: false,
  look: { pitch: 0, yaw: 0 },
  move: { x: 0, y: 0 },
  potionSlots: { held: false, press: null },
  shield: false,
  spellSlots: { held: false, press: null },
  sprint: false,
  switchTarget: 0,
};
