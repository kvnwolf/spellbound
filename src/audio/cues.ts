/**
 * What the Duel sounds like, as data: which sounds a frame calls for (from
 * the simulation's events and what changed between two snapshots) and where
 * each one is heard from. Pure: no WebAudio, no DOM, no three.js. The audio
 * engine plays what this decides.
 */
import { chargeLevel, chargeStage, overchargeShare } from "../duel/charge";
import type {
  DuelEvent,
  DuelistId,
  DuelistState,
  DuelSnapshot,
  PotionKind,
  SpellState,
  TeamId,
} from "../duel/duel";
import type { Point3 } from "../duel/geometry";
import type { Screen, ScreenEvent } from "../screens/screens";
import type { Tuning } from "../tuning";

/** One sound, named by what it is the sound of. */
export type Sound =
  | { readonly kind: "stupefy-cast"; readonly strong: boolean }
  | {
      readonly kind: "confringo-cast";
      readonly charge: number;
      readonly empowered: boolean;
    }
  | { readonly kind: "expelliarmus-cast" }
  | { readonly kind: "incendio-cast" }
  | { readonly kind: "petrificus-cast" }
  /** Depulso's gust: it lands as it is cast, so its cast is the whole of it. */
  | { readonly kind: "depulso-cast" }
  | { readonly kind: "perfect-release" }
  | { readonly kind: "stupefy-hit"; readonly strong: boolean }
  /** Confringo going off, on a Duelist or anywhere it stops; bigger with its Charge. */
  | {
      readonly kind: "confringo-blast";
      readonly charge: number;
      readonly empowered: boolean;
    }
  /** A Duelist turning to stone under Petrificus Totalus. */
  | { readonly kind: "petrify" }
  /** A small Spell dying on Cover, the floor or the walls. */
  | { readonly kind: "fizzle" }
  /** Two Spells meeting in the air and bursting. */
  | { readonly kind: "spells-cancelled" }
  | { readonly kind: "incendio-explosion" }
  | { readonly kind: "backfire" }
  /** A Shield stopping a Spell; `heavy` for Confringo, Incendio and Depulso. */
  | { readonly kind: "shield-block"; readonly heavy: boolean }
  | { readonly kind: "parry" }
  | { readonly kind: "dodge" }
  | { readonly kind: "perfect-dodge" }
  | { readonly kind: "jump" }
  | { readonly kind: "land" }
  | { readonly kind: "lock-on" }
  | { readonly kind: "lock-off" }
  /** A defence refused for want of Stamina. */
  | { readonly kind: "stamina-short" }
  /** One number of a Round's "3, 2, 1" intro. */
  | { readonly kind: "countdown"; readonly beat: number }
  /** "¡Duelo!": control is given. */
  | { readonly kind: "duel-start" }
  | { readonly kind: "knockout" }
  | { readonly kind: "round-end"; readonly outcome: RoundOutcome }
  /** Victory or defeat. */
  | { readonly kind: "duel-end"; readonly won: boolean }
  | { readonly kind: "shield-raise" }
  /** A Charge reached the Perfect Release window: release now. */
  | { readonly kind: "charge-ready" }
  /** A full Charge left the Perfect Release window: a moment from Backfiring. */
  | { readonly kind: "overcharge-warning" }
  /** A Petrified Duelist breaking out of the stone. */
  | { readonly kind: "petrify-break" }
  /** Expelliarmus knocking a Wand out of a hand. */
  | { readonly kind: "disarm" }
  /** A loose Wand clattering onto the floor. */
  | { readonly kind: "wand-land" }
  /** A Disarmed Duelist grabbing their Wand off the floor. */
  | { readonly kind: "wand-pickup" }
  /** A loose Wand flying back into its owner's hand on its own. */
  | { readonly kind: "wand-return" }
  /** Two full Confringos locking into a Clash. */
  | { readonly kind: "clash-start" }
  /** A pump pushing the Clash's meeting point. */
  | { readonly kind: "clash-pump" }
  /** A Clash won: the beam drives through. */
  | { readonly kind: "clash-win" }
  /** A Clash nobody won blowing up. */
  | { readonly kind: "clash-explode" }
  /** A Potion uncorked and drunk. */
  | { readonly kind: "potion-drink" }
  /** A Potion down and taking effect: Wiggenweld's heal, Strength's surge, Swiftness's rush. */
  | { readonly kind: "potion-effect"; readonly potion: PotionKind }
  /** A Potion lost to a hit: the vial shattering. */
  | { readonly kind: "potion-interrupted" };

/** How a Round ended for the local Duelist. */
export type RoundOutcome = "draw" | "lost" | "won";

/** A Spell landing on a Duelist; Incendio's is its explosion, reported on its own, and Depulso's its cast. */
const impactOf = (spell: SpellState): Sound | null => {
  if (spell.kind === "stupefy") {
    return { kind: "stupefy-hit", strong: spell.strong };
  }

  if (spell.kind === "confringo") {
    return {
      charge: spell.charge,
      empowered: spell.empowered,
      kind: "confringo-blast",
    };
  }

  // Expelliarmus's hit is its Disarm, reported on its own.
  return spell.kind === "petrificus" ? { kind: "petrify" } : null;
};

/** A Spell ending on Cover, the floor or the walls; Incendio's is its explosion. */
const stopOf = (spell: SpellState): Sound | null => {
  if (spell.kind === "confringo") {
    return impactOf(spell);
  }

  return spell.kind === "incendio" ? null : { kind: "fizzle" };
};

const castOf = (spell: SpellState): Sound => {
  if (spell.kind === "confringo") {
    return {
      charge: spell.charge,
      empowered: spell.empowered,
      kind: "confringo-cast",
    };
  }

  if (spell.kind === "stupefy") {
    return { kind: "stupefy-cast", strong: spell.strong };
  }

  return { kind: `${spell.kind}-cast` };
};

/** A sound to play once, and where it comes from. */
export interface Cue {
  readonly sound: Sound;
  /** Where in the Arena it sounds; null for at the local Duelist (and the HUD), heard dead centre. */
  readonly at: Point3 | null;
  /** Made by the opponent: a touch quieter than the local Duelist's own. */
  readonly opponent: boolean;
}

/** One frame of the Duel, as far as the sounds care. */
export interface CueFrame {
  /** The snapshot the last frame ended on; null right after the Duel was not being played. */
  readonly before: DuelSnapshot | null;
  readonly after: DuelSnapshot;
  /** The Duel's events since the last frame. */
  readonly events: readonly DuelEvent[];
  readonly localId: DuelistId;
  readonly settings: Pick<Tuning, "confringo" | "duelist">;
}

/** Where the sounds of one frame are placed, from the local Duelist's point of view. */
const placer = ({
  after,
  localId,
  settings,
}: Pick<CueFrame, "after" | "localId" | "settings">) => {
  /** A Duelist's chest, where their body's sounds come from. */
  const chestOf = (duelistId: DuelistId): Point3 => {
    const self = after.duelists.find((each) => each.id === duelistId);

    return {
      x: self?.position.x ?? 0,
      y: (self?.elevation ?? 0) + settings.duelist.chestHeight,
      z: self?.position.z ?? 0,
    };
  };

  /** Where a sound a Duelist makes at `point` (their chest by default) is heard from: the local Duelist's at the listener. */
  const origin = (duelistId: DuelistId, point = chestOf(duelistId)) => {
    const mine = duelistId === localId;

    return { at: mine ? null : point, opponent: !mine };
  };

  return {
    /** A sound a Duelist makes at `point` (their chest by default). */
    by: (duelistId: DuelistId, sound: Sound, point?: Point3): Cue => ({
      ...origin(duelistId, point),
      sound,
    }),
    /** Only the local Duelist's: feedback on their own controls, like the HUD's. */
    mine: (duelistId: DuelistId, sound: Sound): Cue[] =>
      duelistId === localId ? [{ at: null, opponent: false, sound }] : [],
    /** A sound landing on a Duelist at `point`: as loud whoever made it. */
    on: (duelistId: DuelistId, sound: Sound, point: Point3): Cue => ({
      at: duelistId === localId ? null : point,
      opponent: false,
      sound,
    }),
    origin,
    /** A sound of the Arena itself, at `point`. */
    world: (point: Point3, sound: Sound): Cue => ({
      at: point,
      opponent: false,
      sound,
    }),
  };
};

type Placer = ReturnType<typeof placer>;

const announce = (sound: Sound): Cue => ({ at: null, opponent: false, sound });

/** The local Duelist's Team in this frame. */
const localTeamOf = ({ after, localId }: CueFrame): TeamId | undefined =>
  after.duelists.find((each) => each.id === localId)?.team;

/** What a Round's end sounds like, from the local Duelist's side. */
const outcomeOf = (
  winner: TeamId | null,
  localTeam: TeamId | undefined
): RoundOutcome => {
  if (winner === null) {
    return "draw";
  }

  return winner === localTeam ? "won" : "lost";
};

/** Each of the simulation's events, by its type. */
type EventOf = {
  readonly [Type in DuelEvent["type"]]: Extract<DuelEvent, { type: Type }>;
};

/** What each kind of event sounds like: every event type has an entry, even a silent one. */
type EventSounds = {
  readonly [Type in keyof EventOf]: (
    event: EventOf[Type],
    frame: CueFrame,
    place: Placer
  ) => Cue[];
};

/** A Duelist's own body sound (a Dodge, a jump), at their chest. */
const bodily = (
  event: {
    readonly duelistId: DuelistId;
    readonly type: "dodge" | "jump" | "land" | "perfect-dodge";
  },
  _frame: CueFrame,
  place: Placer
) => [place.by(event.duelistId, { kind: event.type })];

/** Feedback on the local Duelist's own controls. */
const ownControl = (
  event: {
    readonly duelistId: DuelistId;
    readonly type: "lock-off" | "lock-on" | "stamina-short";
  },
  _frame: CueFrame,
  place: Placer
) => place.mine(event.duelistId, { kind: event.type });

const eventSounds: EventSounds = {
  backfire: (event, _frame, place) => [
    place.by(event.duelistId, { kind: "backfire" }, event.position),
  ],
  "clash-end": (event, _frame, place) => {
    if (event.outcome === "interrupted") {
      return [];
    }

    return [
      place.world(event.position, {
        kind: event.outcome === "won" ? "clash-win" : "clash-explode",
      }),
    ];
  },
  "clash-pump": (event, _frame, place) => [
    place.by(event.duelistId, { kind: "clash-pump" }, event.clash.point),
  ],
  "clash-start": (event, _frame, place) => [
    place.world(event.clash.point, { kind: "clash-start" }),
  ],
  // The Wand snapping out of the hand, as loud whoever cast it.
  disarm: (event, _frame, place) => [
    place.on(event.duelistId, { kind: "disarm" }, event.position),
  ],
  dodge: bodily,
  "duel-end": (event, frame) => [
    announce({ kind: "duel-end", won: event.winner === localTeamOf(frame) }),
  ],
  explosion: (event, { localId }, place) => {
    const sound: Sound = { kind: "incendio-explosion" };

    return [
      event.burned.includes(localId)
        ? place.on(localId, sound, event.position)
        : place.world(event.position, sound),
    ];
  },
  jump: bodily,
  knockout: () => [announce({ kind: "knockout" })],
  land: bodily,
  "lock-off": ownControl,
  "lock-on": ownControl,
  parry: (event, _frame, place) => [
    place.by(event.duelistId, { kind: "parry" }, event.position),
  ],
  "perfect-dodge": bodily,
  "perfect-release": (event, _frame, place) => [
    place.by(
      event.duelistId,
      { kind: "perfect-release" },
      event.spell.position
    ),
  ],
  "potion-drunk": (event, _frame, place) => [
    place.by(event.duelistId, { kind: "potion-effect", potion: event.kind }),
  ],
  "potion-interrupted": (event, _frame, place) => [
    place.by(event.duelistId, { kind: "potion-interrupted" }),
  ],
  "potion-start": (event, _frame, place) => [
    place.by(event.duelistId, { kind: "potion-drink" }),
  ],
  // The Duel's own result stands in for its last Round's.
  "round-end": (event, frame) =>
    frame.events.some((each) => each.type === "duel-end")
      ? []
      : [
          announce({
            kind: "round-end",
            outcome: outcomeOf(event.winner, localTeamOf(frame)),
          }),
        ],
  "round-start": () => [announce({ kind: "duel-start" })],
  "spell-blocked": (event, _frame, place) => {
    const heavy =
      event.spell.kind === "confringo" ||
      event.spell.kind === "incendio" ||
      event.spell.kind === "depulso";

    return [
      place.by(
        event.duelistId,
        { heavy, kind: "shield-block" },
        event.position
      ),
    ];
  },
  "spell-cast": ({ spell }, _frame, place) => [
    place.by(spell.casterId, castOf(spell), spell.position),
  ],
  "spell-hit": (event, _frame, place) => {
    const sound = impactOf(event.spell);

    return sound ? [place.on(event.targetId, sound, event.position)] : [];
  },
  "spell-stopped": (event, _frame, place) => {
    const sound = stopOf(event.spell);

    return sound ? [place.world(event.position, sound)] : [];
  },
  "spells-cancelled": (event, _frame, place) => [
    place.world(event.position, { kind: "spells-cancelled" }),
  ],
  "stamina-short": ownControl,
  "wand-landed": (event, _frame, place) => [
    place.world(
      { x: event.position.x, y: 0, z: event.position.z },
      { kind: "wand-land" }
    ),
  ],
  // Picked up where it lay; returned into the owner's hand.
  "wand-recovered": (event, _frame, place) =>
    event.how === "pickup"
      ? [place.by(event.duelistId, { kind: "wand-pickup" }, event.position)]
      : [place.by(event.duelistId, { kind: "wand-return" })],
};

/** What one of the simulation's events sounds like. */
const eventCues = <Type extends keyof EventOf>(
  type: Type,
  event: EventOf[Type],
  frame: CueFrame,
  place: Placer
): Cue[] => eventSounds[type](event, frame, place);

/** The countdown's number on show during a Round's intro ("3", "2", "1"), or null outside it. */
const countdownOf = (snapshot: DuelSnapshot | null): number | null =>
  snapshot?.round.phase === "intro"
    ? Math.max(Math.ceil(snapshot.round.phaseSecondsLeft), 1)
    : null;

/** A beat for each number of the countdown, as it comes up. */
const countdownCues = ({ after, before }: CueFrame): Cue[] => {
  const beat = countdownOf(after);

  return beat !== null && beat !== countdownOf(before)
    ? [announce({ beat, kind: "countdown" })]
    : [];
};

/** What a Duelist's change of state since the last frame sounds like. */
const changeSounds = (
  before: DuelistState,
  after: DuelistState,
  settings: CueFrame["settings"]
): Sound[] => {
  const sounds: Sound[] = [];

  if (after.shielding && !before.shielding) {
    sounds.push({ kind: "shield-raise" });
  }

  const was = chargeStage(before.chargeSeconds, settings.confringo);
  const is = chargeStage(after.chargeSeconds, settings.confringo);

  if (is === "perfect" && was !== "perfect") {
    sounds.push({ kind: "charge-ready" });
  } else if (is === "full" && was !== "full") {
    sounds.push({ kind: "overcharge-warning" });
  }

  if (
    before.petrifiedSeconds > 0 &&
    after.petrifiedSeconds === 0 &&
    !after.knockedOut
  ) {
    sounds.push({ kind: "petrify-break" });
  }

  return sounds;
};

const changeCues = (frame: CueFrame, place: Placer): Cue[] => {
  const { after, before } = frame;

  return after.duelists.flatMap((self) => {
    const was = before?.duelists.find((each) => each.id === self.id);

    return was
      ? changeSounds(was, self, frame.settings).map((sound) =>
          place.by(self.id, sound)
        )
      : [];
  });
};

/** The sounds to play once for a frame of the Duel. */
export const cuesFor = (frame: CueFrame): Cue[] => {
  const place = placer(frame);

  return [
    ...countdownCues(frame),
    ...changeCues(frame, place),
    ...frame.events.flatMap((event) =>
      eventCues(event.type, event, frame, place)
    ),
  ];
};

/** A menu's sound: a highlight moving, a choice taken, a step back. */
export interface MenuSound {
  readonly kind: "menu-back" | "menu-confirm" | "menu-move";
}

/** What a menu event that took the screens from `before` to `after` sounds like; null when nothing changed. */
export const menuSoundFor = (
  before: Screen,
  after: Screen,
  event: ScreenEvent
): MenuSound | null => {
  if (JSON.stringify(before) === JSON.stringify(after)) {
    return null;
  }

  if (
    event.type === "input" &&
    (event.input === "up" ||
      event.input === "down" ||
      event.input === "left" ||
      event.input === "right")
  ) {
    return { kind: "menu-move" };
  }

  const leaving =
    event.type === "input" &&
    (event.input === "back" ||
      (event.input === "options" && after.kind !== "pause"));

  return { kind: leaving ? "menu-back" : "menu-confirm" };
};

/** A sound held for as long as a Duelist's state lasts. */
export type LoopSound =
  /** A Charging Wand: `level` from 0 to 1 as it fills, `overcharge` from 0 to 1 as a full Charge nears Backfiring. */
  | {
      readonly kind: "charge";
      readonly level: number;
      readonly overcharge: number;
    }
  /** A raised Shield. */
  | { readonly kind: "shield" }
  /** An Incendio Burn. */
  | { readonly kind: "burn" }
  /** The beam of a Clash, roaring at its meeting point while it lasts. */
  | { readonly kind: "clash-beam" };

/** A held sound, and where it comes from. */
export interface Loop {
  /** Stable while the state lasts, so the engine can follow one sound across frames. */
  readonly key: string;
  readonly sound: LoopSound;
  readonly at: Point3 | null;
  readonly opponent: boolean;
}

const loopSounds = (
  self: DuelistState,
  settings: CueFrame["settings"]
): LoopSound[] => {
  const sounds: LoopSound[] = [];

  if (self.chargeSeconds > 0) {
    sounds.push({
      kind: "charge",
      level: chargeLevel(self.chargeSeconds, settings.confringo),
      overcharge: overchargeShare(self.chargeSeconds, settings.confringo),
    });
  }

  if (self.shielding) {
    sounds.push({ kind: "shield" });
  }

  if (self.burnSeconds > 0) {
    sounds.push({ kind: "burn" });
  }

  return sounds;
};

/** The sounds every Duelist's state holds in this snapshot. */
export const loopsFor = (
  snapshot: DuelSnapshot,
  localId: DuelistId,
  settings: CueFrame["settings"]
): Loop[] => {
  const place = placer({ after: snapshot, localId, settings });

  const beam: Loop[] = snapshot.clash
    ? [
        {
          at: snapshot.clash.point,
          key: "clash-beam",
          opponent: false,
          sound: { kind: "clash-beam" },
        },
      ]
    : [];

  return [
    ...beam,
    ...snapshot.duelists.flatMap((self) =>
      self.knockedOut
        ? []
        : loopSounds(self, settings).map((sound) => ({
            ...place.origin(self.id),
            key: `${sound.kind}:${self.id}`,
            sound,
          }))
    ),
  ];
};
