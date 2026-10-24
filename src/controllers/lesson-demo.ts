/**
 * The live demo of a Training lesson, beside Entrenamiento's lesson list: a
 * small Practice of the lesson, set up as the lesson sets its learner up
 * and against its own Training Dummy, the learner played by a short script
 * of canned Intents (walk and look, lock on, cast, Charge and release,
 * Shield, Dodge, drink, Clash, go after a lost Wand). The script is timed
 * from the start of the loop in `tuning.lessonDemo`, and where a move has
 * to meet the Duel (a Parry, a Perfect Dodge, a Charge filling, a Wand
 * landing) it reads the snapshot as any Controller would. Pure: no
 * three.js, no DOM.
 */
import { clashOpponentOf } from "../duel/duel";
import type {
  DuelConfig,
  DuelistId,
  DuelistState,
  DuelSnapshot,
} from "../duel/duel";
import { direction, forwardOf, rightOf } from "../duel/geometry";
import type { GroundPoint } from "../duel/geometry";
import { idleIntent } from "../duel/intent";
import type { Intent } from "../duel/intent";
import { potionSlots, potionIn } from "../duel/potions";
import type { PotionKind } from "../duel/potions";
import { boundTo, spellSlots } from "../duel/spell-slots";
import type { SpecialSpellKind } from "../duel/spell-slots";
import { lessonPlans, lessonRules } from "../duel/training";
import type { Lesson } from "../duel/training";
import type { Tuning } from "../tuning";
import type { Controller } from "./controller";
import { createRandom } from "./random";
import { createRival } from "./rival";

/** The learner and the dummy of every demo. */
export const demoLearner: DuelistId = "local";
export const demoRival: DuelistId = "opponent";

/** One tick of the script: how far into the loop, and the Duel as of the last tick. */
interface Moment {
  readonly seconds: number;
  readonly tickSeconds: number;
  readonly me: DuelistState;
  readonly foe: DuelistState;
  readonly snapshot: DuelSnapshot;
}

type Script = (moment: Moment) => Partial<Intent>;

type DemoTuning = Tuning["lessonDemo"];

/** Within [from, until). */
const during = ({ seconds }: Moment, [from, until]: readonly number[]) =>
  seconds >= (from ?? 0) && seconds < (until ?? 0);

/** Held for `hold` seconds from `at`. */
const held = (moment: Moment, at: number, hold: number) =>
  during(moment, [at, at + hold]);

/** Pressed (held a moment) at any of `times`. */
const pressedAt = (moment: Moment, times: readonly number[], hold: number) =>
  times.some((at) => held(moment, at, hold));

/** Seconds until a Spell of someone else's reaches `me`, if one is on its way. */
const secondsToHit = (
  { me, snapshot }: Moment,
  reach: number
): number | undefined => {
  let soonest: number | undefined;

  for (const spell of snapshot.spells) {
    if (spell.casterId === me.id) {
      continue;
    }

    const dx = me.position.x - spell.position.x;
    const dz = me.position.z - spell.position.z;
    const { x: vx, z: vz } = spell.velocity;
    const speed2 = vx * vx + vz * vz;

    if (speed2 === 0) {
      continue;
    }

    const t = (dx * vx + dz * vz) / speed2;
    const miss = Math.hypot(dx - vx * t, dz - vz * t);

    if (t > 0 && miss < reach && (soonest === undefined || t < soonest)) {
      soonest = t;
    }
  }

  return soonest;
};

/** The stick, free-aiming, that walks toward `to`. */
const walkToward = (me: DuelistState, to: GroundPoint) => {
  const heading = direction(me.position, to);
  const forward = forwardOf(me.aim.yaw);
  const right = rightOf(forward);

  return {
    x: heading.x * right.x + heading.z * right.z,
    y: heading.x * forward.x + heading.z * forward.z,
  };
};

const specialSlot = (
  kind: SpecialSpellKind,
  settings: Pick<Tuning, "spellSlots">
) => spellSlots.find((slot) => boundTo(slot, settings) === kind) ?? "cross";

const potionSlot = (kind: PotionKind, settings: Pick<Tuning, "potionSlots">) =>
  potionSlots.find((slot) => potionIn(slot, settings) === kind) ?? "up";

/** The scripts, lesson by lesson. */
const scriptFor = (lesson: Lesson, tuning: Tuning): Script => {
  const { script } = tuning.lessonDemo;
  const press = script.pressSeconds;
  const reach = tuning.duelist.bodyRadius + tuning.stupefy.radius + 0.3;

  /** Locked on to the dummy from `lockAt`, as most lessons are fought. */
  const lockedOn = (moment: Moment) =>
    moment.me.targetId === null &&
    moment.seconds >= script.lockAt &&
    moment.me.looseWand === null;

  /** Holds the Heavy Spell from `at` until the Charge is full, releasing right then: a Perfect Release. */
  const charging = (moment: Moment, at: number) => {
    const full = moment.me.chargeSeconds >= tuning.confringo.fullSeconds - 1e-6;

    return (
      moment.seconds >= at &&
      (moment.me.chargeSeconds > 0 ? !full : moment.seconds < at + press)
    );
  };

  /** Casts the Special Spell `kind`: R2 from `holdAt`, its button at `castAt`. */
  const special = (
    moment: Moment,
    kind: SpecialSpellKind,
    holdAt: number,
    castAt: number
  ) => ({
    spellSlots: {
      held: held(moment, holdAt, castAt - holdAt + press),
      press: held(moment, castAt, press) ? specialSlot(kind, tuning) : null,
    },
  });

  /** Drinks the Potion `kind`. */
  const drink = (moment: Moment, kind: PotionKind) => {
    const { drinkAt, holdAt } = script.potion;

    return {
      potionSlots: {
        held: held(moment, holdAt, drinkAt - holdAt + press),
        press: held(moment, drinkAt, press) ? potionSlot(kind, tuning) : null,
      },
    };
  };

  /** The Shield pressed `lead` before a Spell would land, from `from`, and held a moment. */
  const parry = (moment: Moment, from: number, lead: number) => {
    const soon = secondsToHit(moment, reach);

    return (
      moment.seconds >= from &&
      (moment.me.shielding
        ? soon !== undefined
        : soon !== undefined && soon <= lead)
    );
  };

  // When the Crouch lesson's learner last went down.
  let crouchedAt = Number.NEGATIVE_INFINITY;

  // The Dodge lesson's last Dodge, and how many so far.
  let dodged = { at: Number.NEGATIVE_INFINITY, count: 0 };

  /** Circles the dummy, locked on: left (toward the wall behind the lane), then back. */
  const strafe = (moment: Moment) => {
    if (during(moment, script.lockOn.strafe)) {
      return { x: -1, y: 0 };
    }

    return during(moment, script.lockOn.back)
      ? { x: 1, y: 0 }
      : idleIntent.move;
  };

  const scripts: Readonly<Record<Lesson, Script>> = {
    clash: (moment) => ({
      clashPump:
        clashOpponentOf(moment.snapshot.clash, moment.me.id) !== undefined &&
        Math.floor(moment.seconds * script.clash.pumpRate * 2) % 2 === 0,
      heavySpell:
        moment.snapshot.clash === null &&
        charging(moment, script.clash.chargeAt),
      lockOn: lockedOn(moment),
    }),
    // Crouches as each of the dummy's Stupefies comes and stands once it
    // has passed; then runs at the dummy and slides, and back, and slides
    // again.
    crouch: (moment) => {
      const { back, duck, slideBack, slideToward, toward } = script.crouch;

      if (moment.seconds < duck.until) {
        const soon = secondsToHit(moment, reach);

        if (moment.me.crouching) {
          return { crouch: moment.seconds - crouchedAt >= duck.hold };
        }

        const down = soon !== undefined && soon <= duck.lead;

        if (down) {
          crouchedAt = moment.seconds;
        }

        return { crouch: down };
      }

      let { move } = idleIntent;

      if (during(moment, toward)) {
        move = { x: 0, y: 1 };
      } else if (during(moment, back)) {
        move = { x: 0, y: -1 };
      }

      return {
        crouch: pressedAt(moment, [slideToward, slideBack], press),
        move,
        sprint: move !== idleIntent.move,
      };
    },
    depulso: (moment) => ({
      lockOn: lockedOn(moment),
      ...special(
        moment,
        "depulso",
        script.special.holdAt,
        script.special.castAt
      ),
    }),
    // Waits to be Disarmed, then walks over the Wand once it has landed.
    disarmed: (moment) => {
      const wand = moment.me.looseWand;

      return {
        lockOn: lockedOn(moment),
        move:
          wand !== null && wand.grounded
            ? walkToward(moment.me, wand.landing)
            : idleIntent.move,
      };
    },
    dodge: (moment) => {
      const soon = secondsToHit(moment, reach);
      const { every, from, lead } = script.dodge;

      const dodge =
        moment.seconds >= from &&
        moment.seconds - dodged.at >= every &&
        soon !== undefined &&
        soon <= lead;

      if (dodge) {
        dodged = { at: moment.seconds, count: dodged.count + 1 };
      }

      return {
        dodge,
        lockOn: lockedOn(moment),
        // The stick only on the press, aiming the Dodge: toward the wall
        // behind the lane first (left, locked on), then back, so the
        // learner stays in the lane and in the shot.
        move: dodge
          ? { x: dodged.count % 2 === 1 ? -1 : 1, y: 0 }
          : idleIntent.move,
      };
    },
    expelliarmus: (moment) => ({
      lockOn: lockedOn(moment),
      ...special(
        moment,
        "expelliarmus",
        script.special.holdAt,
        script.special.castAt
      ),
    }),
    felix: (moment) => ({
      ...drink(moment, "felix"),
      lockOn: lockedOn(moment),
      ...special(moment, "depulso", script.felix.holdAt, script.felix.castAt),
    }),
    focus: (moment) => ({
      lightSpell: pressedAt(moment, script.focus.casts, press),
      lockOn: lockedOn(moment),
      shield: parry(moment, script.focus.parryFrom, script.shield.lead),
    }),
    // A quick tap first (a small Confringo, a small push), then a full
    // Charge let go right as it fills.
    heavy: (moment) => ({
      heavySpell:
        held(moment, script.heavy.tapAt, script.heavy.tapSeconds) ||
        charging(moment, script.heavy.chargeAt),
      lockOn: lockedOn(moment),
    }),
    incendio: (moment) => ({
      lockOn: lockedOn(moment),
      ...special(
        moment,
        "incendio",
        script.special.holdAt,
        script.special.castAt
      ),
    }),
    light: (moment) => ({
      lightSpell: pressedAt(moment, script.light.casts, press),
      lockOn: lockedOn(moment),
    }),
    lockOn: (moment) => ({
      lockOn:
        (moment.me.targetId === null && held(moment, script.lockAt, press)) ||
        (moment.me.targetId !== null &&
          held(moment, script.lockOn.unlockAt, press)),
      move: strafe(moment),
    }),
    move: (moment) => {
      const { look, lookRate, run, walk } = script.move;

      // Away from the dummy, which the learner starts facing, then back.
      if (during(moment, walk)) {
        return { move: { x: 0, y: -1 } };
      }

      if (during(moment, look)) {
        return { look: { pitch: 0, yaw: lookRate } };
      }

      return during(moment, run) ? { move: { x: 0, y: 1 }, sprint: true } : {};
    },
    petrificus: (moment) => ({
      lockOn: lockedOn(moment),
      ...special(
        moment,
        "petrificus",
        script.special.holdAt,
        script.special.castAt
      ),
    }),
    shield: (moment) => ({
      lockOn: lockedOn(moment),
      shield:
        during(moment, script.shield.hold) ||
        parry(moment, script.shield.parryFrom, script.shield.lead),
    }),
    strength: (moment) => ({
      ...drink(moment, "strength"),
      lightSpell: pressedAt(moment, script.strength.casts, press),
      lockOn: lockedOn(moment),
    }),
    swiftness: (moment) => {
      const { away, back } = script.swiftness;
      let { move } = idleIntent;

      if (during(moment, away)) {
        move = { x: 0, y: -1 };
      } else if (during(moment, back)) {
        move = { x: 0, y: 1 };
      }

      return {
        ...drink(moment, "swiftness"),
        move,
        sprint: move !== idleIntent.move,
      };
    },
    wiggenweld: (moment) => drink(moment, "wiggenweld"),
  };

  return scripts[lesson];
};

/** The learner's Controller for `lesson`'s demo: its script, from the start of the loop. */
export const createDemoController = (
  lesson: Lesson,
  tuning: Tuning
): Controller => {
  const script = scriptFor(lesson, tuning);
  const tickSeconds = 1 / tuning.tickRate;
  let tick = 0;

  return {
    intent: ({ self, snapshot }) => {
      const me = snapshot.duelists.find((each) => each.id === self);
      const foe = snapshot.duelists.find((each) => each.id !== self);
      const seconds = tick * tickSeconds;
      tick += 1;

      return me && foe
        ? {
            ...idleIntent,
            ...script({ foe, me, seconds, snapshot, tickSeconds }),
          }
        : idleIntent;
    },
  };
};

/** Whether `lesson`'s demo frames the learner alone. */
export const demoIsSolo = (lesson: Lesson, settings: DemoTuning) =>
  settings.soloLessons.includes(lesson);

/**
 * The Duel `lesson`'s demo plays: a Practice under the lesson's rules, the
 * learner at the lane's +x end (the left of the shot) and the dummy at the
 * other, facing each other, closer for the lessons fought up close and
 * further apart for those fought from afar.
 */
export const demoDuelConfig = (
  lesson: Lesson,
  arena: DuelConfig["arena"],
  tuning: Tuning
): DuelConfig => {
  const { lane, longLessons, nearLessons } = tuning.lessonDemo;
  let apart = nearLessons.includes(lesson) ? lane.near : lane.far;

  if (longLessons.includes(lesson)) {
    apart = lane.long;
  }

  const half = apart / 2;

  return {
    arena,
    duelists: [
      { id: demoLearner, spawn: { x: lane.x + half, z: lane.z }, team: "near" },
      { id: demoRival, spawn: { x: lane.x - half, z: lane.z }, team: "far" },
    ],
    practice: lessonRules(lesson, demoLearner, tuning),
    tuning,
  };
};

/** The Controllers of `lesson`'s demo: the learner's script, and the lesson's Training Dummy. */
export const createDemoControllers = (
  lesson: Lesson,
  arena: DuelConfig["arena"],
  tuning: Tuning
): ReadonlyMap<DuelistId, Controller> => {
  const { dummies } = tuning.practice;

  // Maniquí desarmador casts sooner here, so the demo need not wait for it.
  const rivalTuning: Tuning = {
    ...tuning,
    practice: {
      ...tuning.practice,
      dummies: {
        ...dummies,
        disarmsFirstCast: tuning.lessonDemo.disarmsFirstCast,
      },
    },
  };

  return new Map([
    [demoLearner, createDemoController(lesson, tuning)],
    [
      demoRival,
      createRival(lessonPlans[lesson].rival, {
        arena,
        difficulty: "duelista",
        random: createRandom(1),
        tuning: rivalTuning,
      }),
    ],
  ]);
};
