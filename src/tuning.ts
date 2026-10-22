/**
 * Every tuning number in Spellbound lives here, so balancing never touches
 * logic. Distances are metres, times are seconds, speeds are metres per second.
 */
export const tuning = {
  aim: {
    /** How far the right stick can push the aim point sideways from the Target. */
    maxHorizontalOffset: 2.5,
    /** How far the right stick can push the aim point up or down from the Target's chest. */
    maxVerticalOffset: 1.2,
    /** With no Target left, the aim point sits this far straight ahead. */
    untargetedDistance: 8,
  },

  camera: {
    /** Distance behind the local Duelist, away from the Target. */
    distance: 4.6,
    /** Where the camera looks, from the Duelist (0) to the Target (1). */
    focusBias: 0.45,
    /** Exponential smoothing rate of the follow (higher is snappier), per second. */
    followSharpness: 7,
    fov: 55,
    height: 2.4,
    /** Sideways offset to the right of the Duelist: the over-the-shoulder view. */
    shoulder: 0.9,
  },

  duelist: {
    /** A Duelist's body is a circle on the Arena floor for collision. */
    bodyRadius: 0.45,
    /** Height of the chest above the floor; the aim point sits there. */
    chestHeight: 1.3,
    walkSpeed: 4.5,
  },

  input: {
    /** Stick deflection below this radius reads as centred. */
    stickDeadZone: 0.12,
    /** Trigger travel below this value reads as released. */
    triggerDeadZone: 0.04,
  },

  /** The Duel simulation advances on a fixed timestep at this rate (Hz). */
  tickRate: 60,
} as const;

export type Tuning = typeof tuning;
