/** A 2D vector in controller space: x is right, y is up/forward. */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/**
 * What a Controller wants its Duelist to do during one tick. Every Controller,
 * human or AI, produces this same shape; the Duel simulation interprets it.
 */
export interface Intent {
  /**
   * Movement relative to the camera, which sits behind the Duelist looking at
   * their Target: y walks toward the Target, x strafes right. Length is at most 1.
   */
  readonly move: Vec2;
  /** Offset of the aim point around the Target, each axis in [-1, 1]: x is right, y is up. */
  readonly aim: Vec2;
}

/** The Intent of a Controller that does nothing. */
export const idleIntent: Intent = {
  aim: { x: 0, y: 0 },
  move: { x: 0, y: 0 },
};
