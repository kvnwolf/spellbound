/**
 * The haptics director: turns what happens in the Duel, and the local
 * Duelist's state, into the desired DualSense output state. Pure and
 * stateful across frames (rumble pulses and the lightbar flash fade over
 * time); the caller feeds it one frame at a time and sends the result to the
 * controller, through WebHID or the Gamepad API's dual-rumble fallback.
 */
import type { DuelEvent, DuelistId, DuelSnapshot } from "../duel/duel";
import type { DualSenseOutput, Rgb } from "./output";

/** A rumble that starts at these motor strengths (0 to 1) and fades to nothing over `seconds`. */
export interface RumblePulse {
  readonly left: number;
  readonly right: number;
  readonly seconds: number;
}

export interface HapticsSettings {
  /** The local Duelist casts a Spell. */
  readonly cast: RumblePulse;
  /** The local Duelist is hit. */
  readonly hitTaken: RumblePulse;
  /** The local Duelist is hit by a strong Spell (the Stupefy that Staggers). */
  readonly strongHitTaken: RumblePulse;
  readonly lightbar: {
    /** The lightbar's colour when nothing is happening. */
    readonly base: Rgb;
    /** The colour it flashes when the local Duelist is hit... */
    readonly flash: Rgb;
    /** ...fading back to `base` over this long. */
    readonly flashSeconds: number;
  };
}

/** One frame of the game, as far as haptics care. */
export interface HapticsFrame {
  /** The Duel's events since the last frame. */
  readonly events: readonly DuelEvent[];
  readonly snapshot: DuelSnapshot;
  /** The Duel is being played: not behind a menu, the pause or the title. Nothing rumbles otherwise. */
  readonly live: boolean;
  /** Real seconds since the last frame. */
  readonly seconds: number;
}

export interface HapticsDirector {
  readonly frame: (frame: HapticsFrame) => DualSenseOutput;
}

/**
 * Rounds won as lit player LEDs, centred as the PlayStation 5 centres its
 * player numbers: one is the middle LED, two the pair either side of it.
 */
const playerLedPatterns = [
  0b0_0000, 0b0_0100, 0b0_1010, 0b1_0101, 0b1_1011, 0b1_1111,
] as const;

const ledsFor = (roundsWon: number) =>
  playerLedPatterns[Math.min(Math.max(roundsWon, 0), 5)] ?? 0;

const mix = (from: Rgb, to: Rgb, amount: number): Rgb => ({
  b: from.b + (to.b - from.b) * amount,
  g: from.g + (to.g - from.g) * amount,
  r: from.r + (to.r - from.r) * amount,
});

interface ActivePulse {
  readonly pulse: RumblePulse;
  age: number;
}

export const createHapticsDirector = (
  localId: DuelistId,
  settings: HapticsSettings
): HapticsDirector => {
  let pulses: ActivePulse[] = [];
  /** Seconds since the last hit taken; it starts long ago, so nothing flashes. */
  let sinceHit = Number.POSITIVE_INFINITY;

  const pulsesFor = (event: DuelEvent): RumblePulse[] => {
    if (event.type === "spell-cast" && event.spell.casterId === localId) {
      return [settings.cast];
    }

    if (event.type === "spell-hit" && event.targetId === localId) {
      return [event.spell.strong ? settings.strongHitTaken : settings.hitTaken];
    }

    // A Backfire hurts its caster like any hit.
    if (event.type === "backfire" && event.duelistId === localId) {
      return [settings.hitTaken];
    }

    return [];
  };

  const rumble = () => {
    let left = 0;
    let right = 0;

    for (const { age, pulse } of pulses) {
      const strength = 1 - age / pulse.seconds;
      left = Math.max(left, pulse.left * strength);
      right = Math.max(right, pulse.right * strength);
    }

    return { left, right };
  };

  return {
    frame: ({ events, live, seconds, snapshot }) => {
      for (const pulse of pulses) {
        pulse.age += seconds;
      }

      sinceHit += seconds;
      pulses = pulses.filter(({ age, pulse }) => age < pulse.seconds);

      for (const event of events) {
        pulses.push(...pulsesFor(event).map((pulse) => ({ age: 0, pulse })));

        if (
          (event.type === "spell-hit" && event.targetId === localId) ||
          (event.type === "backfire" && event.duelistId === localId)
        ) {
          sinceHit = 0;
        }
      }

      if (!live) {
        pulses = [];
      }

      const { base, flash, flashSeconds } = settings.lightbar;
      const flashLeft = Math.max(1 - sinceHit / flashSeconds, 0);
      const team = snapshot.duelists.find((each) => each.id === localId)?.team;

      return {
        lightbar: flashLeft > 0 ? mix(base, flash, flashLeft) : base,
        playerLeds: ledsFor(
          team === undefined ? 0 : (snapshot.score[team] ?? 0)
        ),
        rumble: rumble(),
        triggers: { l2: { kind: "off" }, r2: { kind: "off" } },
      };
    },
  };
};
