/**
 * The haptics director: turns what happens in the Duel, and the local
 * Duelist's state, into the desired DualSense output state. Pure and
 * stateful across frames (rumble pulses and lightbar flashes fade over
 * time); the caller feeds it one frame at a time and sends the result to the
 * controller, through WebHID or the Gamepad API's dual-rumble fallback.
 * The menus are felt too: a tick as the highlight moves, a pulse as a choice
 * is taken or a step back.
 * Every strength, length and colour comes from `tuning.haptics`, the
 * lightbar's per-Spell colours included: the LED gets its own palette, not the
 * on-screen one.
 */
import type { MenuSound } from "../audio/cues";
import { chargeLevel, chargeStage } from "../duel/charge";
import type { ChargeStage } from "../duel/charge";
import type {
  DuelEvent,
  DuelistId,
  DuelistState,
  DuelSnapshot,
  SpellKind,
} from "../duel/duel";
import type { Point3 } from "../duel/geometry";
import type { Tuning } from "../tuning";
import type { DualSenseOutput, Rgb } from "./output";

/** Two motor strengths, 0 to 1: the left motor is the heavy one, the right the light one. */
export interface Motors {
  readonly left: number;
  readonly right: number;
}

/**
 * A rumble that starts at these motor strengths and fades to nothing over
 * `seconds`; a `tremble` shakes it `hz` times a second, dipping by `depth`.
 */
export interface RumblePulse extends Motors {
  readonly seconds: number;
  readonly tremble?: { readonly hz: number; readonly depth: number };
}

/** The tuning the director reads. */
export type HapticsTuning = Pick<Tuning, "confringo" | "focus" | "haptics">;

/** One frame of the game, as far as haptics care. */
export interface HapticsFrame {
  /** The Duel's events since the last frame. */
  readonly events: readonly DuelEvent[];
  readonly snapshot: DuelSnapshot;
  /** The Duel is being played: not behind a menu, the pause or the title. Nothing rumbles otherwise. */
  readonly live: boolean;
  /** Real seconds since the last frame. */
  readonly seconds: number;
  /** The menus' sounds this frame (see `menuSoundFor`), felt as well as heard, live or not. */
  readonly menu?: readonly MenuSound[];
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

const dark: Rgb = { b: 0, g: 0, r: 0 };

/** Both triggers free: the director sets no adaptive trigger effect, in any state. */
const free = {
  l2: { kind: "off" },
  r2: { kind: "off" },
} as const satisfies DualSenseOutput["triggers"];

const mixMotors = (from: Motors, to: Motors, amount: number): Motors => ({
  left: from.left + (to.left - from.left) * amount,
  right: from.right + (to.right - from.right) * amount,
});

/**
 * Where `event` blows something up, if it does: an Incendio explosion, a
 * Confringo bursting however it ends (on a Duelist, a Shield, Cover, the
 * floor or another Spell) and a Clash nobody won.
 */
const blastOf = (event: DuelEvent): Point3 | undefined => {
  if (event.type === "explosion") {
    return event.position;
  }

  if (
    (event.type === "spell-hit" ||
      event.type === "spell-stopped" ||
      event.type === "spell-blocked") &&
    event.spell.kind === "confringo"
  ) {
    return event.position;
  }

  if (
    event.type === "spells-cancelled" &&
    event.spells.some((each) => each.kind === "confringo")
  ) {
    return event.position;
  }

  return event.type === "clash-end" && event.outcome === "exploded"
    ? event.position
    : undefined;
};

interface ActivePulse {
  readonly pulse: RumblePulse;
  age: number;
}

/** A lightbar flash: a colour that fades back to what is under it. */
interface Flash {
  readonly color: Rgb;
  readonly seconds: number;
  age: number;
}

const noFlash = (): Flash => ({
  age: Number.POSITIVE_INFINITY,
  color: { b: 0, g: 0, r: 0 },
  seconds: 1,
});

const flashOver = (under: Rgb, flash: Flash) => {
  const left = 1 - flash.age / flash.seconds;

  return left > 0 ? mix(under, flash.color, left) : under;
};

export const createHapticsDirector = (
  localId: DuelistId,
  tuning: HapticsTuning
): HapticsDirector => {
  const settings = tuning.haptics;
  const spellColor = (kind: SpellKind) => settings.lightbar.spells[kind];

  let pulses: ActivePulse[] = [];
  /** The menus' pulses: kept apart, since leaving the Duel does not cut them. */
  let menuPulses: ActivePulse[] = [];
  let castFlash = noFlash();
  let hitFlash = noFlash();
  /** Where the local Duelist's Charge stood last frame. */
  let chargeWas: ChargeStage = "none";
  /** Seconds the local Duelist's Focus has been full; undefined while it is not. */
  let focusFullFor: number | undefined;

  const pulsesFor = (event: DuelEvent): RumblePulse[] => {
    if (event.type === "spell-cast" && event.spell.casterId === localId) {
      return [
        event.spell.kind === "depulso" ? settings.depulsoCast : settings.cast,
      ];
    }

    if (event.type === "spell-hit" && event.targetId === localId) {
      return [event.spell.strong ? settings.strongHitTaken : settings.hitTaken];
    }

    if (event.type === "parry" && event.duelistId === localId) {
      return [settings.parry];
    }

    if (event.type === "disarm" && event.duelistId === localId) {
      return [settings.disarmed];
    }

    if (event.type === "potion-drunk" && event.duelistId === localId) {
      return [settings.potionDrunk];
    }

    if (event.type === "backfire" && event.duelistId === localId) {
      return [settings.charge.backfire];
    }

    if (event.type === "clash-pump" && event.duelistId === localId) {
      return [settings.clash.pump];
    }

    if (
      event.type === "clash-end" &&
      event.clash.sides.some((side) => side.duelistId === localId)
    ) {
      return [settings.clash.end];
    }

    return [];
  };

  /** The explosion's thump, scaled down by its distance from the local Duelist's feet. */
  const thumpFor = (
    event: DuelEvent,
    self: DuelistState | undefined
  ): RumblePulse[] => {
    const at = blastOf(event);

    if (!at || !self) {
      return [];
    }

    const { pulse, range } = settings.explosion;
    const metres = Math.hypot(at.x - self.position.x, at.z - self.position.z);
    const strength = 1 - metres / range;

    return strength > 0
      ? [
          {
            left: pulse.left * strength,
            right: pulse.right * strength,
            seconds: pulse.seconds,
          },
        ]
      : [];
  };

  /** The steady rumble of the local Duelist's state, held for as long as it lasts. */
  const steadyFor = (self: DuelistState, snapshot: DuelSnapshot): Motors[] => {
    const { charge, clash } = settings;

    const side = snapshot.clash?.sides.findIndex(
      (each) => each.duelistId === localId
    );

    if (snapshot.clash && side !== undefined && side >= 0) {
      // The meeting point runs from the first side's Wand (0) to the second's (1).
      const { along } = snapshot.clash;

      return [mixMotors(clash.far, clash.near, side === 0 ? 1 - along : along)];
    }

    if (self.petrifiedSeconds > 0) {
      return [settings.petrified];
    }

    const stage = chargeStage(self.chargeSeconds, tuning.confringo);

    if (stage === "full") {
      return [charge.overcharge];
    }

    if (stage === "building" || stage === "perfect") {
      return [
        mixMotors(
          charge.rumble.from,
          charge.rumble.to,
          chargeLevel(self.chargeSeconds, tuning.confringo)
        ),
      ];
    }

    return [];
  };

  const flashesFor = (event: DuelEvent) => {
    if (event.type === "spell-cast" && event.spell.casterId === localId) {
      castFlash = {
        age: 0,
        color: spellColor(event.spell.kind),
        seconds: settings.lightbar.castSeconds,
      };
    }

    if (event.type === "spell-hit" && event.targetId === localId) {
      hitFlash = {
        age: 0,
        color: spellColor(event.spell.kind),
        seconds: settings.lightbar.flashSeconds,
      };
    }

    // A Backfire is the Confringo going off in the hand.
    if (event.type === "backfire" && event.duelistId === localId) {
      hitFlash = {
        age: 0,
        color: spellColor("confringo"),
        seconds: settings.lightbar.flashSeconds,
      };
    }
  };

  const menuPulseFor = ({ kind }: MenuSound): RumblePulse => {
    if (kind === "menu-move") {
      return settings.menu.move;
    }

    return kind === "menu-back" ? settings.menu.back : settings.menu.confirm;
  };

  /** The stronger of every pulse and steady rumble, on each motor. */
  const rumble = (steady: readonly Motors[]): Motors => {
    let left = 0;
    let right = 0;

    for (const { age, pulse } of [...pulses, ...menuPulses]) {
      const tremble = pulse.tremble
        ? 1 -
          pulse.tremble.depth *
            (0.5 - 0.5 * Math.cos(2 * Math.PI * pulse.tremble.hz * age))
        : 1;

      const strength = (1 - age / pulse.seconds) * tremble;
      left = Math.max(left, pulse.left * strength);
      right = Math.max(right, pulse.right * strength);
    }

    for (const motors of steady) {
      left = Math.max(left, motors.left);
      right = Math.max(right, motors.right);
    }

    return { left, right };
  };

  /** The Perfect Release window opening: a tick, once per Charge. */
  const tickOnPerfect = (self: DuelistState | undefined) => {
    const stage = self
      ? chargeStage(self.chargeSeconds, tuning.confringo)
      : "none";

    if (stage === "perfect" && chargeWas !== "perfect") {
      pulses.push({ age: 0, pulse: settings.charge.perfect });
    }

    chargeWas = stage;
  };

  /**
   * The base colour, breathing toward the Focus colour while Focus is full,
   * under the cast and hit flashes; dark while Disarmed: no Wand, no light.
   */
  const lightbarFor = (self: DuelistState | undefined, seconds: number) => {
    const { base, focusPulse } = settings.lightbar;

    focusFullFor =
      self && self.focus >= tuning.focus.max
        ? (focusFullFor ?? -seconds) + seconds
        : undefined;

    if (self?.looseWand) {
      return dark;
    }

    const breath =
      focusFullFor === undefined
        ? 0
        : 0.5 -
          0.5 *
            Math.cos((2 * Math.PI * focusFullFor) / focusPulse.periodSeconds);

    return flashOver(
      flashOver(mix(base, focusPulse.color, breath), castFlash),
      hitFlash
    );
  };

  return {
    frame: ({ events, live, menu = [], seconds, snapshot }) => {
      for (const pulse of [...pulses, ...menuPulses]) {
        pulse.age += seconds;
      }

      menuPulses = [
        ...menuPulses.filter(({ age, pulse }) => age < pulse.seconds),
        ...menu.map((sound) => ({ age: 0, pulse: menuPulseFor(sound) })),
      ];

      castFlash.age += seconds;
      hitFlash.age += seconds;
      pulses = pulses.filter(({ age, pulse }) => age < pulse.seconds);

      const self = snapshot.duelists.find((each) => each.id === localId);

      for (const event of events) {
        for (const pulse of [...pulsesFor(event), ...thumpFor(event, self)]) {
          pulses.push({ age: 0, pulse });
        }

        flashesFor(event);
      }

      tickOnPerfect(self);

      if (!live) {
        pulses = [];
      }

      return {
        lightbar: lightbarFor(self, seconds),
        playerLeds: ledsFor(self ? (snapshot.score[self.team] ?? 0) : 0),
        rumble: rumble(live && self ? steadyFor(self, snapshot) : []),
        triggers: free,
      };
    },
  };
};
