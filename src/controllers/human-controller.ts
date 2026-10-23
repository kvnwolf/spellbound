import type { DualSenseSnapshot } from "../dualsense/input";
import { clashOpponentOf } from "../duel/duel";
import { idleIntent } from "../duel/intent";
import type { TargetSwitch, Vec2 } from "../duel/intent";
import { spellSlots } from "../duel/spell-slots";
import type { SpellSlot } from "../duel/spell-slots";
import { tuning } from "../tuning";
import type { Tuning } from "../tuning";
import { createAimResponse } from "./aim-response";
import type { Controller } from "./controller";

/**
 * Recognises a right-stick flick, the gesture that switches Lock-on Target:
 * the stick leaves the centre and reaches near full tilt within a short
 * window. One flick per gesture: the stick must come back to the centre
 * before the next, and never sooner than the cooldown. Slow pushes and small
 * nudges are not flicks.
 */
const createFlickDetector = (
  settings: Tuning["input"]["flick"],
  tickSeconds: number
) => {
  // Ticks since the stick last rested at the centre.
  let ticksOut = 0;
  let armed = true;
  let cooldownTicks = 0;

  return {
    /** Ignores the stick until it next rests at the centre. */
    disarm: () => {
      armed = false;
    },
    /** Reads this tick's stick; the switch it asks for, if this tick completes a flick. */
    read: (stick: Vec2): TargetSwitch => {
      cooldownTicks = Math.max(cooldownTicks - 1, 0);
      const deflection = Math.hypot(stick.x, stick.y);

      if (deflection < settings.rest) {
        ticksOut = 0;
        armed = true;

        return 0;
      }

      ticksOut += 1;

      if (!armed || deflection < settings.threshold) {
        return 0;
      }

      armed = false;

      const quick = ticksOut * tickSeconds <= settings.windowSeconds;
      // Only sideways flicks switch; an up or down flick is just a look.
      const sideways = Math.abs(stick.x) >= Math.abs(stick.y);

      if (!quick || !sideways || cooldownTicks > 0) {
        return 0;
      }

      cooldownTicks = Math.round(settings.cooldownSeconds / tickSeconds);

      return stick.x > 0 ? 1 : -1;
    },
  };
};

/**
 * R2 and the face buttons, read for the Spell Slots. R2 is the modifier,
 * held past `hold` until it comes back under `release`. A face button pressed
 * while it is held is a press of that button's Spell Slot (one per tick,
 * △ □ ○ ✕ in that order), and its usual action is withheld until the button
 * is let go, even if R2 is let go first. A face button already held before
 * R2 keeps its usual action, so pulling R2 mid-Charge never releases it.
 */
const createSlotReader = (settings: Tuning["input"]["spellSlots"]) => {
  let held = false;
  const down = { circle: false, cross: false, square: false, triangle: false };

  const toSlot = {
    circle: false,
    cross: false,
    square: false,
    triangle: false,
  };

  return {
    read: (pad: DualSenseSnapshot) => {
      held = pad.triggers.r2 > (held ? settings.release : settings.hold);
      let press: SpellSlot | null = null;

      for (const slot of spellSlots) {
        const now = pad.buttons[slot];

        if (now && !down[slot] && held) {
          toSlot[slot] = true;
          press ??= slot;
        } else if (!now) {
          toSlot[slot] = false;
        }

        down[slot] = now;
      }

      return {
        /** Each face button as its usual action sees it: down, unless it went to a slot. */
        face: {
          circle: down.circle && !toSlot.circle,
          cross: down.cross && !toSlot.cross,
          square: down.square && !toSlot.square,
          triangle: down.triangle && !toSlot.triangle,
        },
        held,
        press,
      };
    },
    reset: () => {
      held = false;

      for (const slot of spellSlots) {
        down[slot] = false;
        toSlot[slot] = false;
      }
    },
  };
};

/** The buttons whose press the simulation or Lock-on reads as an edge: a held one can be a stray press. */
const edgeButtons = ["circle", "cross", "square", "triangle", "r3"] as const;

/**
 * Buttons that were already down when gameplay (re)started, such as the one
 * that closed a menu, are ignored until they are let go. The Duel finds
 * presses by comparing against the last Intent it stepped with, and it does
 * not step behind a menu, so without this a held button would look newly
 * pressed on the first frame back.
 */
const createStartGuard = () => {
  let armed = true;
  const ignored = new Set<(typeof edgeButtons)[number]>();

  return {
    /** The next read ignores whatever is held then, until it is released. */
    arm: () => {
      armed = true;
    },
    /** The snapshot without the buttons still held from before gameplay started. */
    filter: (pad: DualSenseSnapshot): DualSenseSnapshot => {
      for (const button of edgeButtons) {
        if (!pad.buttons[button]) {
          ignored.delete(button);
        } else if (armed) {
          ignored.add(button);
        }
      }

      armed = false;

      if (ignored.size === 0) {
        return pad;
      }

      const buttons = { ...pad.buttons };

      for (const button of ignored) {
        buttons[button] = false;
      }

      return { ...pad, buttons };
    },
  };
};

/**
 * A human holding a DualSense. `readPad` returns this frame's DualSense
 * snapshot, or nothing while no DualSense is connected (the Duelist then idles).
 *
 * - Left stick: moves, relative to the camera.
 * - Right stick: turns the camera, through the response (curve, acceleration
 *   and smoothing), as yaw and pitch rates; up looks up. A flick also asks to
 *   switch Lock-on Target, which the Duel only acts on while Locked On.
 * - R3: toggles Lock-on, once per press. The right stick is ignored for a
 *   moment after the click, which tends to knock it.
 * - □: the Light Spell.
 * - △: the Heavy Spell, held to Charge and released to cast.
 * - ○: Dodge. ✕: jump. L1 (held): the Shield. R1 (held): sprint. L3 is unbound.
 * - R2 (held): the Spell Slots' modifier. While it is held, pressing a face
 *   button casts from its Spell Slot instead of its usual action (R2 alone
 *   casts nothing); the right stick keeps turning the camera as usual.
 * - During a Clash every △ press is a pump (R2 pumps nothing). △ does
 *   nothing else from the Clash on until it has been let go after the Clash
 *   ends, so the △ that Charged the Confringo, or the one that pumped, never
 *   starts a Charge. The simulation counts the presses, and only in a Clash.
 *
 * Everything advances once per Intent, which the Duel asks for every tick.
 */
export const createHumanController = (
  readPad: () => DualSenseSnapshot | undefined,
  settings: Pick<Tuning, "input" | "tickRate"> = tuning
): Controller => {
  const { flick, lockOnSettleSeconds, look } = settings.input;
  const tickSeconds = 1 / settings.tickRate;
  const aimResponse = createAimResponse(look);
  const flicks = createFlickDetector(flick, tickSeconds);
  const slots = createSlotReader(settings.input.spellSlots);
  const startGuard = createStartGuard();
  let r3WasDown = false;
  let settleTicks = 0;
  // △ is spoken for by the Clash (and what it leaves held) until let go.
  let triangleSpoken = false;

  return {
    intent: ({ self, snapshot }) => {
      const raw = readPad();

      if (!raw) {
        aimResponse.reset();
        slots.reset();
        startGuard.arm();
        r3WasDown = false;
        triangleSpoken = false;

        return idleIntent;
      }

      const pad = startGuard.filter(raw);

      const lockOn = pad.buttons.r3 && !r3WasDown;
      r3WasDown = pad.buttons.r3;

      if (lockOn) {
        settleTicks = Math.round(lockOnSettleSeconds / tickSeconds);
      }

      const settling = settleTicks > 0;
      settleTicks = Math.max(settleTicks - 1, 0);

      if (settling) {
        flicks.disarm();
      }

      const stick = settling ? { x: 0, y: 0 } : pad.rightStick;
      const turn = aimResponse.step(stick, tickSeconds);
      const { face, held, press } = slots.read(pad);

      if (clashOpponentOf(snapshot.clash, self) !== undefined) {
        triangleSpoken = true;
      } else if (!pad.buttons.triangle) {
        triangleSpoken = false;
      }

      return {
        // △ is also the Clash pump; the simulation counts the presses, and
        // only during a Clash, so a △ held into one is no press.
        clashPump: pad.buttons.triangle,
        // Buttons are passed on as held; the simulation finds the presses
        // (and reads △'s hold over time to Charge Confringo). A face button
        // pressed while R2 is held went to its Spell Slot instead.
        dodge: face.circle,
        heavySpell: face.triangle && !triangleSpoken,
        jump: face.cross,
        lightSpell: face.square,
        lockOn,
        look: {
          pitch: turn.y * look.maxPitchSpeed,
          yaw: turn.x * look.maxYawSpeed,
        },
        move: pad.leftStick,
        shield: pad.buttons.l1,
        spellSlots: {
          held,
          press: triangleSpoken && press === "triangle" ? null : press,
        },
        sprint: pad.buttons.r1,
        switchTarget: settling ? 0 : flicks.read(stick),
      };
    },
    suspend: startGuard.arm,
  };
};
