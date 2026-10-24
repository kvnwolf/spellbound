/** The Potion Slots' bindings, typed so a variant can leave a slot empty (null). */
const potionSlotsOf = (
  slots: Readonly<Record<"down" | "left" | "right" | "up", string | null>>
) => slots;

/**
 * Every tuning number in Spellbound lives here, so balancing never touches
 * logic. Distances are metres, times are seconds, speeds are metres per second.
 */
export const tuning = {
  /**
   * The AI Controller: how it plays, shared by every Difficulty, and one
   * profile per Difficulty. It drives its Duelist only through the Intent a
   * human produces, so these numbers are the AI's "hands": when it presses
   * what, and how well it times it. Ranges are picked uniformly between
   * `min` and `max` each time.
   */
  ai: {
    /** Extra seconds between the Stupefies of a burst, on top of `stupefy.castInterval`: a human rhythm, not a metronome. */
    burstGap: { max: 0.12, min: 0.03 },
    /**
     * Taking Cover: the AI walks to a spot `standOff` metres behind a column
     * (seen from the opponent) no more than `reach` metres away and hides
     * there for `seconds`.
     */
    cover: { reach: 6, seconds: { max: 3, min: 1.5 }, standOff: 0.5 },
    /**
     * An opponent crossing the line of fire faster than this (metres per
     * second) would sidestep a Locked On cast, which never leads; a
     * disciplined AI waits `waitSeconds` for a better moment instead.
     */
    crossingSpeed: 1.5,
    /** A Dodge is pressed this long before a Spell lands: inside the Perfect Dodge window, give or take. */
    dodgeLead: { max: 0.18, min: 0.06 },
    /**
     * A jump is pressed `lead` seconds before a Spell lands, which has the
     * feet above a chest-high Spell when it arrives; with less warning than
     * `minWarning` it is too late to jump, and a Spell coming in higher than
     * `maxHeight` (metres above the feet) cannot be jumped: the AI does something else.
     */
    jump: { lead: 0.3, maxHeight: 1.45, minWarning: 0.2 },
    /**
     * Before Locking On the AI turns its free aim toward the opponent's
     * chest like a right stick: the turn rate is `gain` times the angle left
     * (per second), capped at `maxSpeed` radians per second. It presses R3
     * once the crosshair is within `lockAngle` radians of the chest.
     */
    look: { gain: 8, lockAngle: 0.06, maxSpeed: 5 },
    /**
     * Potions. The AI weighs drinking one every `lookSeconds`. Drinking is
     * safe only with no Spell on its way and the opponent unable to cast, or
     * not Charging, beyond Depulso's reach and out of sight or at least
     * `safeDistance` metres away. Swiftness is worth it to chase a Wand lying
     * more than `chaseDistance` metres off.
     */
    potions: { chaseDistance: 5, lookSeconds: 0.3, safeDistance: 8 },
    profiles: {
      duelista: {
        attackPause: { max: 1.9, min: 0.8 },
        band: { max: 12, min: 7 },
        burst: { max: 3, min: 1 },
        chargeHold: { mean: 0.5, spread: 0.035 },
        clashPumpRate: { max: 5.5, min: 4 },
        coverChance: 0.2,
        defences: { dodge: 0.3, jump: 0.15, shield: 0.55 },
        defendChance: 0.65,
        discipline: 0.4,
        heavyShare: 0.35,
        potions: {
          boost: 0.4,
          chance: 0.6,
          seekCover: 0.4,
          wiggenweldBelow: 0.4,
        },
        punishChance: 0.65,
        reactionSeconds: { max: 0.38, min: 0.22 },
        shieldLead: { max: 0.25, min: 0.05 },
        specials: { bait: 0.2, chance: 0.4, sense: 0.75 },
        strafeChance: 0.7,
        strafeSpeed: 0.75,
      },
      /** Quick, defends almost everything (often with a Parry), times the Charge, punishes. */
      maestro: {
        attackPause: { max: 1.3, min: 0.5 },
        band: { max: 12, min: 7 },
        burst: { max: 3, min: 2 },
        chargeHold: { mean: 0.51, spread: 0.015 },
        clashPumpRate: { max: 9.5, min: 7.5 },
        coverChance: 0.3,
        defences: { dodge: 0.3, jump: 0.1, shield: 0.6 },
        defendChance: 0.88,
        discipline: 0.8,
        heavyShare: 0.4,
        potions: {
          boost: 0.8,
          chance: 0.9,
          seekCover: 0.8,
          wiggenweldBelow: 0.45,
        },
        punishChance: 0.95,
        reactionSeconds: { max: 0.25, min: 0.15 },
        shieldLead: { max: 0.13, min: 0.03 },
        specials: { bait: 0.8, chance: 0.7, sense: 0.95 },
        strafeChance: 0.9,
        strafeSpeed: 1,
      },
      /** Slow to react, rarely defends, mistimes the Charge, presses little. */
      novato: {
        /** Seconds between one attack and the next. */
        attackPause: { max: 2.8, min: 1.3 },
        /** The distance it keeps from its Target, metres. */
        band: { max: 11, min: 6 },
        /** Stupefies in a burst (whole numbers): three in a row make the strong cast that Staggers. */
        burst: { max: 2, min: 1 },
        /** How long it holds a Charge before releasing (seconds since the press): a normal spread around `mean`. */
        chargeHold: { mean: 0.47, spread: 0.07 },
        /** Presses per second it pumps in a Clash, picked afresh for every press: a person mashing △ manages about 6 to 9. */
        clashPumpRate: { max: 3, min: 2.4 },
        /** Chance to take Cover after being hit. */
        coverChance: 0.08,
        /** How it defends, by weight. */
        defences: { dodge: 0.25, jump: 0, shield: 0.75 },
        /** Chance to defend an incoming Spell at all. */
        defendChance: 0.3,
        /** Chance to hold a cast while the Target crosses the line of fire. */
        discipline: 0,
        /** Share of attacks that are a Charged Confringo; the rest are Stupefy bursts. */
        heavyShare: 0.3,
        /**
         * Potions: it drinks Wiggenweld at or below `wiggenweldBelow` of full
         * Health, on `chance` each time it weighs it and it is safe (else, once
         * per stretch of low Health, it heads for Cover to drink on
         * `seekCover`); Strength and Swiftness, when they make sense, on `boost`.
         */
        potions: {
          boost: 0.1,
          chance: 0.35,
          seekCover: 0.1,
          wiggenweldBelow: 0.3,
        },
        /** Chance to punish an opponent left open: Staggered, Petrified, Disarmed or drinking. */
        punishChance: 0.25,
        /** Seconds between noticing something (an incoming Spell, a Staggered opponent, a lost lock) and acting on it. */
        reactionSeconds: { max: 0.65, min: 0.4 },
        /** How long before a Spell lands the Shield goes up: within `defence.shield.parryWindow` it Parries. */
        shieldLead: { max: 0.45, min: 0.12 },
        /**
         * Special Spells: the chance, each time it looks for one, to cast at
         * all; the chance it then picks the one that fits the moment (else
         * any it can pay for); and the chance to bait a Shield with a
         * Stupefy before an Expelliarmus.
         */
        specials: { bait: 0, chance: 0.1, sense: 0.35 },
        /** Chance to strafe (rather than stand) each time it picks, and at what share of full speed. */
        strafeChance: 0.45,
        strafeSpeed: 0.55,
      },
    },
    /** The Shield stays up this long past the moment a Spell was due to land, then drops so the next one can be Parried afresh. */
    shieldHoldSeconds: 0.1,
    /**
     * Special Spells. The AI looks for one to cast every `lookSeconds` (and,
     * after a reaction, as soon as the opponent starts to Charge or drink
     * within Depulso's reach, `depulsoMargin` metres inside its range). An
     * opponent within `cornered` metres of a wall, or whose body is within
     * `coverBlastShare` of Incendio's blast radius of a column, is worth an
     * Incendio. A Shield baited before an Expelliarmus has `baitSeconds` to
     * go up and come down again. No Special Spell follows a Light or Heavy
     * Spell within `afterCastSeconds`: hands take a moment to move to R2.
     */
    specials: {
      afterCastSeconds: 0.3,
      baitSeconds: 1.2,
      cornered: 2.5,
      coverBlastShare: 0.8,
      depulsoMargin: 0.3,
      lookSeconds: 0.4,
    },
    /** Sprints to close the distance when this many metres beyond its band (and Stamina is above half). */
    sprintBeyond: 0.5,
    /** Never raises the Shield with less Stamina than this left, and never Dodges into less than this. */
    staminaReserve: 15,
    /** How long the AI keeps one strafing direction (or standing still) before picking again. */
    strafeSeconds: { max: 2.4, min: 0.8 },
    /**
     * Moving less than `stuckShare` of the stride it asked for, for more
     * than `stuckTicks` ticks in a row, counts as stuck against something:
     * it strafes the other way.
     */
    stuckShare: 0.3,
    stuckTicks: 6,
    /** A Spell whose line passes within this many metres of the body (on top of both radii) is a threat to defend. */
    threatMargin: 0.2,
    waitSeconds: 0.2,
    /**
     * Disarmed, the AI walks for its Wand the short way round Cover,
     * Obstructions and the opponent, keeping `clearance` metres (beyond its
     * body) off each; stuck on the way, it goes round the other side for
     * `detourSeconds`.
     */
    wand: { clearance: 0.3, detourSeconds: { max: 1.2, min: 0.6 } },
  },

  /**
   * Free aim: a human aims with the camera, so the aim is a ray from a pivot
   * over the Duelist's right shoulder (the camera sits straight behind it)
   * along the Duelist's yaw and pitch. Angles are radians.
   */
  aim: {
    /** Where the aim ray starts; the camera rig places the camera behind this same point. */
    eye: {
      height: 2.05,
      /** Kept this far from walls and Cover, pulling the shoulder offset in when there is no room. */
      margin: 0.35,
      shoulder: 0.85,
    },
    pitch: {
      /** Turning eases off over this last stretch before either limit, instead of stopping dead. */
      edgeEase: 0.17,
      /** Never slower than this share of the turn rate near a limit, so the limit is still reached. */
      edgeFloor: 0.2,
      /** Highest the aim looks (about 29 degrees up). */
      max: 0.5,
      /** Lowest the aim looks (about 34 degrees down). */
      min: -0.6,
      /** Where a recentre brings the pitch: just below level. */
      rest: -0.05,
    },
  },

  /**
   * Aim Assist, for a free-aiming Duelist: gentle help toward an opponent near
   * the crosshair (in sight, not behind Cover). The angle is measured at the
   * aim pivot between the crosshair's ray and the nearest point of the
   * opponent's body (its edge, not its centre), so it means the same at any
   * distance. The reticle's circle is drawn with a radius of exactly `bendAngle`.
   */
  aimAssist: {
    /** A cast whose crosshair is within this angle of an opponent's body bends toward them at launch, and turning eases (about 1 degree). */
    bendAngle: 0.0175,
    /** Share of the gap to the opponent's chest the launch direction closes (1 aims dead at the chest). */
    bendStrength: 0.85,
    /** Turn speed multiplier with the crosshair on an opponent's body, easing back to 1 at `bendAngle` off its edge. */
    friction: 0.55,
  },

  /**
   * Sound: the approved samples in `public/audio`, music and ambience
   * included. Volumes are linear gains. Every sound goes through the master
   * volume, a compressor and a soft ceiling, so nothing clips however many
   * play at once.
   */
  audio: {
    /** The ambience fades in and out over this long, seconds. */
    ambienceFade: 2.5,
    /**
     * The Duel's sounds go through `sfx`, with the courtyard's reverb;
     * countdown, call-out stingers and menus through `ui`, dry; the themes
     * and the Duel's fanfares through `music`; the courtyard at night through
     * `ambience`.
     */
    buses: { ambience: 0.8, music: 0.7, sfx: 1, ui: 1 },
    /** The loudest any sample can reach after the soft clip (0.89 is about -1 dBFS). */
    ceiling: 0.89,
    /**
     * A Charging Wand's roar follows its Charge: from `empty` at its start
     * to `full` once it is full; Overcharge opens the filter further and
     * quickens and deepens a tremolo from `calm` to `frantic` as Backfiring nears.
     */
    chargeLoop: {
      /** Volume share at the start of a Charge (all of it once full). */
      emptyGain: 0.35,
      /** Low-pass cutoff, Hz. */
      lowpass: { empty: 700, full: 6000, overcharge: 12_000 },
      /** Playback rate: the roar rises in pitch as it fills. */
      rate: { empty: 0.8, full: 1.25 },
      /** Tremolo rate (Hz) and depth (share of the volume). */
      tremolo: {
        calmDepth: 0.05,
        calmRate: 3,
        franticDepth: 0.5,
        franticRate: 23,
      },
    },
    /** Gentle glue first, then the ceiling: peaks are held under 0 dBFS. */
    compressor: {
      attack: 0.003,
      /** Decibels. */
      knee: 6,
      ratio: 12,
      release: 0.25,
      /** Decibels. */
      threshold: -12,
    },
    /** Under the pause menu (or "Reconecta tu mando") music and ambience drop to `gain` and are muffled below `lowpass` Hz, easing over `seconds`. */
    dim: { gain: 0.35, lowpass: 900, seconds: 0.4 },
    /** The music dips to `gain` under the Knockout and the Round and Duel stingers: in over `attack`, held `hold`, back over `release`, seconds. */
    duck: { attack: 0.08, gain: 0.35, hold: 1.6, release: 0.8 },
    /** How sounds bigger than usual play. */
    emphasis: {
      /** An empowered (Perfect Release) Confringo's extra volume. */
      empoweredGain: 1.2,
      /** Every third Stupefy, and a heavy Spell on a Shield: louder by `gain` and lower by `rate`. */
      heavy: { gain: 1.25, rate: 0.85 },
      /** Confringo's cast and blast at no Charge play at this share, rising to all of it at a full Charge. */
      unchargedGain: 0.6,
    },
    /** Held sounds (Charge, Shield, Burn) follow their state with this time constant, seconds. */
    loopGlide: 0.04,
    /** Held sounds fade out over this long once their state ends, seconds. */
    loopRelease: 0.18,
    /** Overall volume. */
    master: 0.8,
    /** One-shot sounds playing at once; more are dropped until some end. */
    maxVoices: 48,
    /**
     * The themes: a change of theme crossfades over `crossfade` seconds; a
     * theme loops by overlapping its end with its start for `loopOverlap`
     * seconds, each repeat scheduled `scheduleAhead` seconds before it starts.
     */
    music: { crossfade: 2.5, loopOverlap: 3, scheduleAhead: 1 },
    /** Silences everything (the engine still follows the Duel). */
    muted: false,
    /** The courtyard's stone: a synthesised reverb tail. */
    reverb: {
      /** How fast the tail dies (higher is faster). */
      decay: 3.2,
      /** Length of the tail. */
      seconds: 1.9,
      /** Share of every Duel sound sent to the reverb. */
      send: 0.18,
    },
    /** A file's start and end quieter than this (linear) are silence, skipped when it loops. */
    silenceFloor: 0.001,
    /** The soft clip is transparent below this level and rounds off above it. */
    softClipKnee: 0.7,
    /** Where sounds come from, relative to the camera (see `audio/spatial.ts`). */
    spatial: {
      maxPan: 0.75,
      minGain: 0.22,
      opponentGain: 0.8,
      refDistance: 5,
      rolloff: 0.45,
    },
    trimFade: 0.03,
    /** Sounds shorter than their file: played for this many seconds, then faded out over `trimFade`. */
    trims: {
      "clash-pump": 0.4,
      "lock-off": 0.4,
      "lock-on": 0.4,
      "menu-move": 0.3,
    },
    /** Each play of a sound effect varies at random by up to this many cents of pitch and this share of volume, so repeats never sound identical. */
    variation: { cents: 50, gain: 0.1 },
    /**
     * Each sample's own level, by catalog id: loudness-matched across the
     * files (their peaks kept under -1 dBFS), then balanced for the mix.
     */
    volumes: {
      backfire: 0.42,
      "burn-loop": 1.4,
      "clash-beam": 0.89,
      "clash-explode": 0.57,
      "clash-pump": 0.69,
      "clash-start": 1.1,
      "clash-win": 0.77,
      "confringo-blast": 0.82,
      "confringo-cast": 0.39,
      "confringo-charge": 0.62,
      "confringo-perfect": 0.36,
      "confringo-ready": 1.1,
      "countdown-beat": 3.6,
      "courtyard-night": 1.3,
      defeat: 0.6,
      "depulso-blast": 1.1,
      disarm: 0.59,
      "dodge-roll": 0.38,
      "duel-start": 0.81,
      "duel-theme": 0.21,
      "expelliarmus-cast": 0.46,
      "incendio-cast": 0.56,
      "incendio-explosion": 0.54,
      jump: 0.75,
      knockout: 6.6,
      land: 0.32,
      "lock-off": 14,
      "lock-on": 0.27,
      "menu-back": 0.35,
      "menu-confirm": 0.62,
      "menu-move": 1.4,
      "menu-theme": 0.27,
      "overcharge-warning": 2.7,
      parry: 0.56,
      "perfect-dodge": 0.55,
      "petrificus-cast": 0.51,
      petrify: 0.92,
      "petrify-break": 0.65,
      "potion-drink": 0.38,
      "potion-heal": 1.2,
      "potion-interrupted": 0.45,
      "potion-strength": 0.41,
      "potion-swiftness": 0.33,
      "round-lost": 0.45,
      "round-won": 0.34,
      "shield-block": 2,
      "shield-hum": 0.15,
      "shield-raise": 0.66,
      "spell-fizzle": 0.89,
      "spells-cancel": 0.53,
      "stamina-short": 2.9,
      "stupefy-cast": 0.31,
      "stupefy-hit": 0.89,
      "stupefy-hit-strong": 0.47,
      victory: 0.57,
      "wand-land": 2.5,
      "wand-pickup": 0.71,
      "wand-return": 0.68,
    },
  },

  camera: {
    /**
     * At full Charge the field of view widens by `degrees`, easing in and out
     * at `sharpness` (per second): a push that makes the held power felt.
     */
    chargePush: { degrees: 5, sharpness: 7 },
    /**
     * During a Clash the Lock-on framing is taken from a point this many
     * metres to the local Duelist's right, so the beam runs across the
     * screen at an angle instead of straight away from the camera.
     */
    clashSideStep: 2,
    /**
     * Keeping the view clear of Arena geometry. The camera is a disc of radius
     * `margin` that must stay inside the walls and out of every column, and
     * no column may stand between it and the local Duelist.
     */
    clearance: {
      /** A line of sight passing within this many metres outside a column's clearance is eased in rather than cut off, so sweeping past its edge does not pop. */
      columnFeather: 0.8,
      /** How far ahead (seconds) the camera looks along its swing round the Duelist, so it starts pulling in before it sweeps behind a column. */
      lookAhead: 0.15,
      /** Camera never nearer than this to a wall or column. Keep it below the Duelist's body radius so the Duelist always stands in the clear area. */
      margin: 0.35,
      /** Largest swing round the Duelist, from where it is wanted, searched for open ground (radians; PI is all the way round, for corners). */
      maxSwing: 3.1,
      /** The nearest the camera should be to the Duelist: closer than this it prefers to swing round to open ground. */
      minDistance: 1.8,
      /** Exponential rate, per second, at which the camera eases in toward an obstruction it sees coming. */
      pullInSharpness: 14,
      /** Exponential rate, per second, at which a pulled-in camera eases back out once the way is open (pulling in is immediate, since it must never be blocked). */
      releaseSharpness: 4,
      /** Once swung beyond this angle (radians) to one side the camera stays on that side instead of flipping across, e.g. while the Duelist circles a Target next to a wall. */
      sideLock: 0.2,
      /** What a radian of swing costs, in metres of lost camera distance: higher swings less. */
      swingCost: 1.4,
      /** Exponential smoothing rate of the swing itself, per second: how fast the camera slides round to open ground and back. */
      swingSharpness: 12,
      /** Search resolution of that swing (radians). */
      swingStep: 0.1,
      /** Extra cost per metre the camera ends up closer than `minDistance`. */
      tooCloseCost: 3,
      /** Radius the camera treats a torch stand on the parapet as (the stand and its cap, with a little air), so it never clips one. */
      torchRadius: 0.55,
    },
    /**
     * When the Target is close the camera pulls back and rises so both
     * Duelists stay in frame; the effect fades in between `startsAt` and
     * `fullAt` (metres between the two Duelists).
     */
    closeTarget: {
      fullAt: 1.2,
      /** Extra camera height at full effect. */
      lift: 0.9,
      /** Extra distance behind the Duelist at full effect. */
      pullBack: 2.2,
      startsAt: 6,
    },
    /** Distance behind the local Duelist, away from the Target, while Locked On. */
    distance: 4.6,
    /** Where the camera looks, from the Duelist (0) to the Target (1). */
    focusBias: 0.45,
    /** Exponential smoothing rate of the follow (higher is snappier), per second. */
    followSharpness: 7,
    fov: 55,
    /**
     * The free camera: it sits behind the aim pivot (`aim.eye`) along the aim,
     * so the screen centre always looks down the aim ray.
     */
    free: {
      /** Distance behind the aim pivot. */
      distance: 4.6,
      /**
       * When a wall or column pulls the free camera in close to the local
       * Duelist, it rises and tilts down so they stay in view instead of
       * ending up under or inside the camera. Leaving the aim line takes the
       * crosshair off where Spells go, so it only happens while the Duelist
       * faces the camera (walking toward it: not aiming), or when the camera
       * would otherwise come right up against them; the reticle fades out
       * meanwhile. Distances are from the camera to the Duelist's chest.
       */
      lift: {
        /** Facing the camera from this (dot of facing and the way back to the camera, 0 is side-on)... */
        facingFrom: 0,
        /** ...fully at this (0.5 is 60 degrees off straight at the camera). */
        facingFull: 0.5,
        /** Even while aiming, the camera starts leaving the aim line this close... */
        forcedFrom: 1.05,
        /** ...and has fully left it this close. */
        forcedFull: 0.8,
        /** Starts tilting toward the Duelist this close, while they face the camera. */
        from: 2.8,
        /** Steepest the lifted camera looks down (radians, about 77 degrees): never straight down. */
        maxTilt: 1.35,
        /** The lifted camera rises until it is at least this far from the Duelist's chest. */
        nearest: 2,
        /** The reticle fades out once the lift is past this share. */
        reticleHideAt: 0.15,
        /** Exponential rate, per second, of easing into and out of the lift (a lift the camera is forced into is immediate). */
        sharpness: 7,
      },
      /** The camera never drops below this height; looking up pulls it in toward the pivot instead. */
      minHeight: 0.35,
    },
    /** Camera height while Locked On. */
    height: 2.4,
    /**
     * When the camera has swung round to the side (pinned against a wall) the
     * look-at is turned toward the local Duelist as far as needed to keep them
     * inside this share of the horizontal half field of view (0 is dead
     * centre, 1 the edge of the screen). The Target may leave the frame then;
     * the local Duelist never does.
     */
    keepDuelistWithin: 0.65,
    /** How long the camera takes to ease (smoothstep) between the free camera and the Lock-on framing, position and orientation, both ways: never a snap. */
    lockTransitionSeconds: 0.35,
    /** The camera never swings round the Duelist faster than this (radians per second), even when the Target is circled at arm's length. */
    maxYawSpeed: 4,
    /** Sideways offset to the right of the Duelist: the over-the-shoulder view. */
    shoulder: 0.9,
  },

  /** Camera shake on Spell impacts, as trauma in [0, 1] added per hit (felt as trauma squared). */
  cameraShake: {
    /** Trauma added when the local Duelist's Charge Backfires in their hand. */
    backfire: 0.45,
    /** Extra trauma for a Confringo hit, scaled by its Charge (a tap adds little). */
    confringoBonus: 0.4,
    /** Trauma lost per second. */
    decay: 1.8,
    /** Trauma added when the local Duelist casts Depulso: the recoil of the blast. */
    depulsoCast: 0.4,
    /** Trauma added by an Incendio explosion: all of it when the local Duelist is caught in the blast, half otherwise. */
    explosion: 0.5,
    /** Shake frequency in Hz. */
    frequency: 22,
    /** Trauma added when the local Duelist lands a hit. */
    hitDealt: 0.22,
    /** Trauma added when the local Duelist is hit. */
    hitTaken: 0.5,
    /** Camera position offset at full trauma, in metres. */
    maxOffset: 0.14,
    /** Camera roll at full trauma, in radians. */
    maxRoll: 0.035,
    /** Extra trauma when the hit was a strong one (the third Stupefy). */
    strongBonus: 0.25,
  },

  /**
   * The Clash: two fully Charged Confringos from opposing Duelists meeting
   * roughly head-on lock into a beam between their Wands. Both Duelists are
   * rooted; every pump (△) pushes the meeting point along the beam toward
   * the opponent. Reaching their Wand wins: the winner's Confringo hits them
   * empowered. Nobody winning within `seconds` blows it up.
   */
  clash: {
    /** The blast of a Clash nobody won knocks both Duelists back this many metres, sliding to a stop over `seconds`. */
    explosion: { knockback: 3, seconds: 0.45 },
    /** Head-on: one flight at most this many radians off exactly opposite the other (about 34 degrees, generous). */
    maxAngle: 0.6,
    /** Each pump pushes the meeting point this share of the beam (Wand to Wand) toward the opponent. */
    pumpShare: 0.05,
    /**
     * Two eligible Confringos lock when their centres come within this many
     * metres: generous next to the plain meeting of their spheres (their
     * radii summed), so near misses still Clash.
     */
    reach: 1.4,
    /** The cap: nobody won after this long and it explodes. */
    seconds: 6,
    /** Where the meeting point starts, as a share of the beam from one Wand to the other, kept within this range so a late cast is never all but lost. */
    start: { max: 0.65, min: 0.35 },
  },

  /**
   * How the Clash looks: each Duelist's half of the beam is a jet of light
   * in their Spell's colours pushing against the other's, the meeting point
   * a blinding knot of energy spraying branching streams of light in every
   * direction. Sizes and distances in metres, times in seconds, speeds in
   * metres (or radians) per second, radiances scene-linear HDR, the light
   * in candela. Outside the thin white-hot cores radiances stay modest, so
   * bloom haloes the Clash without washing the courtyard white.
   */
  clashLook: {
    /**
     * The streams of energy shooting out of the meeting point: `rate`
     * a second (from calm to full fury), `length` long (`furyLength` longer
     * at full fury), living `life`, shooting out over `grow` seconds for the
     * longest (every head flies at the same speed) and letting go of their
     * root at `letGo` of their life. Each wiggles `jag` of its length
     * sideways, writhes `writhe` at its tip, bends `curve` and droops
     * `droop` (per metre, by its tip), fades with power `fade`, dims
     * `dim` toward its tip and cools from white to its colour by `coolBy`
     * of its length (`hotShare` of them stay white-hot). A ribbon `width`
     * wide at the root tapering `taper`, a white `thread` (`threadIntensity`)
     * inside a coloured `glow`, both as shares of the half-width; soft
     * `headSoft` at both ends; `segments` along. `offBeam` of each heading
     * along the beam is taken out, so they spray off it. They flicker
     * (`flicker`: `rate` radians per second, never below `low`, `bias` up).
     * `branch`: the chance one forks (`second` for a second fork), how
     * far it turns (radians) and how long it is (share of the parent).
     * `fury` rises with the swing of the struggle (shares of the beam per
     * second), each pump (`kick`) and the Clash nearing its blast
     * (`tension`), capped at `max`, settling at `settle` per second. A
     * volley of arcs bursts at the start, with every pump's surge reaching
     * the meeting point and at the end. `slots` arcs are kept.
     */
    arcs: {
      branch: {
        angle: 0.7,
        chance: 0.55,
        length: { max: 0.6, min: 0.3 },
        second: 0.35,
      },
      coolBy: 0.2,
      curve: 0.45,
      dim: 0.6,
      droop: 0.25,
      endVolley: 26,
      fade: 1.4,
      flicker: { bias: 0.5, low: 0.25, rate: 55 },
      fury: {
        base: 0.15,
        kick: 0.45,
        max: 1.4,
        settle: 6,
        swing: 2.5,
        tension: 0.5,
      },
      furyLength: 0.7,
      glow: 0.55,
      grow: 0.1,
      headSoft: 0.12,
      hot: "#fff6ea",
      hotShare: 0.15,
      intensity: 2,
      jag: 0.12,
      length: { max: 1.9, min: 0.5 },
      letGo: 0.45,
      life: { max: 0.3, min: 0.12 },
      offBeam: 0.6,
      pumpVolley: 7,
      rate: { max: 110, min: 30 },
      segments: 20,
      slots: 160,
      startVolley: 18,
      taper: 0.75,
      thread: 0.2,
      threadIntensity: 0.7,
      width: 0.14,
      writhe: 0.08,
      writheSpeed: 30,
    },
    /**
     * Each half of the beam, a ribbon `width` wide turned to the camera
     * (`segments` along): a white-hot `core` and a coloured `halo` (shares
     * of the half-width), the halo churning by `churn` with noise flowing
     * toward the meeting point (`noiseScale` per metre, `flowSpeed`),
     * pulses (`pulse` deep, `pulseRate` per metre, `pulseSpeed`) and three
     * filaments twisting round it (`filamentAmplitude`, `filamentWidth`,
     * `filamentSpeed`). It swells `swell.amount` over the last `swell.reach`
     * of its length, sways `sway.amount` (of its half-width, `sway.waves`
     * along it, at `sway.speed`), softens over `wandSoft` and `knotSoft` at
     * its ends and brightens from `rampFrom` at the Wand to full at the
     * meeting point. A pump's `surge` races down it at `speed`, `width`
     * long, brightening the core and halo by `core` and `halo`.
     */
    beam: {
      churn: 0.6,
      core: 0.06,
      coreIntensity: 2,
      filamentAmplitude: 0.3,
      filamentIntensity: 1.2,
      filamentSpeed: 34,
      filamentWidth: 0.04,
      flowSpeed: 16,
      halo: 0.28,
      haloIntensity: 1.1,
      knotSoft: 0.06,
      noiseScale: 1.4,
      pulse: 0.35,
      pulseRate: 2.4,
      pulseSpeed: 44,
      rampFrom: 0.7,
      segments: 96,
      surge: { core: 1.2, halo: 1.6, speed: 28, width: 0.35 },
      sway: { amount: 0.06, speed: 7, waves: 1.5 },
      swell: { amount: 0.8, reach: 0.35 },
      wandSoft: 0.06,
      width: 0.9,
    },
    /**
     * The knot where the jets meet, a sprite `size` across: a white-hot
     * heart (`core` of its radius, `coreIntensity`), a corona (`corona`
     * of its radius, `coronaIntensity`) churning by `churn` round its rim
     * (`churnScale` round it, `churnSpeed`), split between the two Spells'
     * colours, and flickering `rays` (`count` round it, `speed`, shown
     * above `threshold`, falling off by `falloff`). It pulses `pulse` on
     * its own, swells `kick` on each pump (fading at `kickFade` per
     * second) and `fury` with the arcs' fury. Its light reaches `distance`.
     */
    knot: {
      churn: 0.5,
      churnScale: 1.6,
      churnSpeed: 2.4,
      core: 0.07,
      coreIntensity: 3.5,
      corona: 0.26,
      coronaIntensity: 2.4,
      fury: 0.15,
      hot: "#fff8ee",
      kick: 0.45,
      kickFade: 6,
      light: { distance: 11, intensity: 32 },
      pulse: 0.1,
      rays: {
        count: 4,
        falloff: 2.2,
        intensity: 1.4,
        speed: 6,
        threshold: 0.55,
      },
      size: 2.4,
    },
    /** Sparks sprayed off the meeting point, `rate` a second at calm (doubling at full fury), mostly sideways off the beam. */
    sparks: {
      intensity: 4,
      life: 0.4,
      rate: 60,
      size: 0.04,
      speed: 7,
      spread: 0.35,
      streak: 0.04,
    },
  },

  /**
   * Confringo, the Heavy Spell, and its Charge. Holding the Heavy Spell
   * builds the Charge from 0 to full over `fullSeconds`; releasing casts
   * Confringo with damage and knockback scaled by the Charge (a tap still
   * casts a weak one). A full Charge cannot be held: a very short moment
   * (`backfire.delaySeconds`) after it fills, it Overcharges and Backfires.
   * Damage is in Health points.
   */
  confringo: {
    /**
     * A Backfire casts nothing, hurts the caster for `damage` (it can Knock
     * them Out) and Staggers them for `staggerSeconds`. It comes
     * `delaySeconds` after the Charge fills; that moment is the only warning.
     */
    backfire: { damage: 8, delaySeconds: 0.1, staggerSeconds: 1 },
    /** Movement speed is multiplied by this while Charging: Charging is a commitment. */
    chargeMoveScale: 0.45,
    /** Damage at the smallest Charge (a tap) and at a full Charge. */
    damage: { full: 28, min: 10 },
    /** Seconds of holding to fill the Charge. */
    fullSeconds: 0.5,
    /**
     * A hit pushes the Duelist it lands on back along the Spell's flight by
     * this many metres (smallest Charge to full), sliding to a stop over
     * `seconds`, during which they cannot move or cast.
     */
    knockback: { full: 2.4, min: 0.6, seconds: 0.35 },
    /**
     * The Perfect Release window, right as the Charge fills: releasing from
     * `early` seconds before full until `late` seconds after it counts. It
     * casts a full Charge, empowered. It must end before the Backfire
     * (`late` at most `backfire.delaySeconds`).
     */
    perfectRelease: { early: 0.04, late: 0.06 },
    /** A Perfect Release multiplies damage and knockback by this. */
    perfectScale: 1.35,
    /** The projectile is a sphere of this radius for collisions: a big, slow blast. */
    radius: 0.3,
    /** After a release, no Light Spell can follow for this long. */
    recoverySeconds: 0.35,
    speed: 17,
  },

  /**
   * The night courtyard's look. Colours are hex strings; light intensities are
   * three.js physical units (lux for the moon, candela for torches), and
   * emissive values are scene-linear HDR, before exposure and tone mapping.
   */
  courtyard: {
    fog: {
      /** Fog and the sky's horizon share this colour so geometry melts into the sky. */
      color: "#121a2c",
      /** Exponential-squared distance fog density, per metre. */
      density: 0.03,
      /** ...with this density, per metre. */
      mistDensity: 0.04,
      /** Ground mist: extra fog below this height (metres)... */
      mistHeight: 0.8,
    },
    moon: {
      /** Compass direction of the moon, degrees from the far end (-z) toward -x. */
      azimuth: 12,
      /** Scene-linear radiance of the moon disc (well above the bloom threshold). */
      discRadiance: 6,
      /** Stylised apparent radius of the moon disc in the sky, degrees. */
      discRadius: 2.4,
      /** Height of the moon above the horizon, degrees. */
      elevation: 18,
      lightColor: "#a9bdff",
      lightIntensity: 1.5,
    },
    shadows: {
      /** Depth bias in normalised shadow depth, against acne on lit faces. */
      bias: -0.0004,
      /** Moonlight shadow map edge, texels: the main shadow quality knob. */
      mapSize: 2048,
      /** Extra metres the shadow box reaches past the Arena bounds. */
      margin: 3,
      /** World-space push along the normal, against acne at grazing angles. */
      normalBias: 0.03,
    },
    sky: {
      /** How strongly wispy clouds veil the sky (0 clear .. 1 overcast). */
      cloudCover: 0.55,
      /** Cloud drift speed across the sky. */
      cloudDrift: 0.004,
      horizon: "#1a2440",
      /** Fraction of sky cells that hold a star (0..1). */
      starDensity: 0.012,
      starRadiance: 2.2,
      zenith: "#03050d",
    },
    /** Dim cold fill standing in for the night sky's bounce light. */
    skyFill: { ground: "#1c150f", intensity: 1.2, sky: "#3a4f80" },
    torch: {
      /** Seconds an ember lives as it rises. */
      emberLifetime: 2.6,
      emberRadiance: 9,
      /** Metres an ember rises over its life. */
      emberRise: 2.4,
      /** Ember particles per torch: the main particle-count knob. */
      embersPerTorch: 36,
      /** Flame sprite brightness, scene-linear. */
      flameRadiance: 2.6,
      /** Flicker depth: 0 is a steady light, 0.3 a lively flame. */
      flicker: 0.24,
      /** Peak candela of each torch's light before flicker. */
      intensity: 45,
      lightColor: "#ffa060",
      /** Lights reach no further than this (metres); 0 would be unbounded. */
      range: 22,
    },
    /** Warm lit windows in the castle walls, scene-linear. */
    windowRadiance: 2.6,
  },

  /**
   * Defence: the Dodge (○), the Shield and its Parry (L1), the jump (✕) and
   * the sprint (R1, held), all paid for from the shared Stamina pool.
   * Stamina is in points; costs are points, drains points per second.
   */
  defence: {
    dodge: {
      /** Stamina a Dodge costs; refused with less than this left. */
      cost: 25,
      /** How far the dash carries the Duelist, metres, over `seconds`. */
      distance: 3.6,
      /**
       * A Dodge started when an incoming Spell would hit within this many
       * seconds (had the Duelist stood still) is a Perfect Dodge.
       */
      perfectWindow: 0.2,
      /** How long the dash lasts; the Duelist cannot be hit throughout. */
      seconds: 0.35,
    },
    jump: {
      /** Stamina a jump costs; refused with less than this left. */
      cost: 12,
      /** Downward acceleration while airborne, m/s²: about four times the Earth's, so the jump is snappy, not floaty. */
      gravity: 42,
      /**
       * Upward launch speed, m/s. With `gravity` the feet clear about 1.65 m
       * at the apex after 0.3 s, about 0.58 s in the air: still high enough
       * to let a chest-high bolt pass under, if timed.
       */
      speed: 12.2,
    },
    shield: {
      /** Stamina drained every second the Shield is up. */
      drain: 22,
      /**
       * Raising the Shield no more than this many seconds before a Spell lands
       * on it Parries: the Spell flies back at its caster.
       */
      parryWindow: 0.15,
      /** Walking speed while the Shield is up, as a share of the normal speed. */
      walkScale: 0.5,
    },
    sprint: {
      /** Stamina drained every second spent sprinting (only while moving). */
      drain: 5,
      /** Running speed, as a multiple of the walking speed. */
      speedScale: 2,
    },
    stamina: {
      max: 100,
      /** Stamina only starts regenerating this long after it was last spent. */
      regenDelay: 0.6,
      /** Points regained per second once regenerating. */
      regenRate: 32,
    },
  },

  /**
   * Depulso, a Special Spell: a short cone of force from the caster, not a
   * projectile. Instantly on the cast, every opponent within `range` metres
   * (measured to the edge of their body) and `coneDegrees` (the whole
   * angle, centred on the caster's facing), not Dodging and not behind
   * Cover, takes `damage` and is knocked straight away from the caster,
   * losing any Charge (no Backfire). A Shield facing the caster blocks the
   * damage, not the push.
   */
  depulso: {
    coneDegrees: 70,
    cooldownSeconds: 5,
    /** Health points: little. */
    damage: 6,
    /**
     * The push, metres: `near` point-blank, falling steadily to `far` for a
     * body whose edge is at the end of the range; behind a Shield it is
     * `shieldScale` of that. The slide takes `seconds`, during which they
     * cannot move or act (a Shield stays up through it).
     */
    knockback: { far: 1.8, near: 5, seconds: 0.45, shieldScale: 0.4 },
    range: 4,
    /** After the cast, no Light Spell can follow for this long. */
    recoverySeconds: 0.35,
    /** Focus segments it costs. */
    segments: 1,
  },

  /**
   * How Depulso looks: a gust of force out of the Wand along the caster's
   * facing, as wide as the gameplay cone and `height` metres tall (half
   * above, half below the Wand) at its far end. Mostly invisible: a
   * shapeless cloud of air billowing out and coming apart, the air bending
   * what is behind it, dust and grit torn off the floor, and the force
   * bursting off every Duelist it catches. The air leaves the Wand at full
   * speed and stalls in the still air with time constant `drag` seconds, so
   * the fastest of it reaches the end of the range within a fifth of a
   * second, as the push lands. Sizes and distances in metres, times in
   * seconds, colours hex, radiances scene-linear HDR.
   */
  depulsoLook: {
    /**
     * The cloud of air out of the Wand: `count` puffs, each sent a share of
     * the range between `reach.min` and `reach.max` (raised to `bias`: below
     * 1 sends more of it far), within `spread` of the cone and dipping
     * `droop` radians toward the floor; `size` from birth to the end of a
     * far puff's life; faint (`opacity`), rising and wandering on the curl
     * noise.
     */
    air: {
      bias: 0.6,
      color: "#e4e9ee",
      count: 40,
      droop: 0.05,
      life: { max: 1.15, min: 0.7 },
      opacity: 0.26,
      reach: { max: 1.08, min: 0.15 },
      rise: 0.12,
      size: { from: 0.3, to: 2.1 },
      spread: 1,
      wander: 0.45,
    },
    /**
     * The air bending what is behind it: `count` bend puffs riding out with
     * the cloud, `size` from birth to the far end, bending the scene seen
     * through them by up to `strength` (screen metres per metre away) for
     * `life` seconds.
     */
    bend: {
      count: 10,
      life: 0.5,
      reach: { max: 1, min: 0.3 },
      size: { from: 0.7, to: 2.6 },
      strength: 0.14,
      wander: 0.3,
    },
    /**
     * How every puff looks: billows (`billowScale` repeats of the baked
     * noise across a puff) torn into wisps (`wispScale`), curled by the
     * swirl (`swirl.warp` at birth, `swirl.growth` more by the end of its
     * life), rounded off past `roundness` of its radius and eroded from the
     * thin edges in (the density threshold rises from `erosion.from` to
     * `erosion.to` over its life, `erosion.soft` wide). It fades in over
     * `fadeIn` seconds and out with power `fadeOut`, fades out within
     * `floorFade` metres of the floor, and is lit like a soft ball: `key`
     * light from `light.from`, `fill` all round. `curl` sets the wander's
     * noise (`scale` per metre, `evolve` per second); `bend` the bend
     * puffs' swirl. `slots` puffs are kept in each pool; the baked field is
     * `fieldSize` texels square.
     */
    cloud: {
      bend: { flow: 0.35, scale: 0.4 },
      billowScale: 0.55,
      curl: { evolve: 0.7, scale: 0.55 },
      erosion: { from: 0.18, soft: 0.25, to: 0.62 },
      fadeIn: 0.07,
      fadeOut: 1.1,
      fieldSize: 128,
      floorFade: 0.3,
      light: {
        fill: "#8c8478",
        fillStrength: 0.32,
        from: { x: -0.2, y: 1, z: -0.5 },
        key: "#c4cdf4",
        keyStrength: 0.75,
      },
      roundness: 0.2,
      selfShadow: 0.45,
      slots: { bend: 32, dust: 224 },
      spin: 0.6,
      /** Seconds of motion a puff is stretched over on screen while the blast drives it. */
      streak: 0.03,
      swirl: { growth: 0.25, scale: 0.3, warp: 0.12 },
      wispScale: 1.5,
    },
    /** Seconds for the blast's air to slow by e: the leading air covers 80% of its way in about 1.6 of these. */
    drag: 0.12,
    /**
     * Floor dust torn up under the leading air, `perMetre` puffs per metre
     * it travels: swept on at `speed` (stalling over `drag`), thrown up at
     * `lift`, born `height` off the floor, growing over `life`, `aspect`
     * times wider than tall as it hugs the floor; with `grit`
     * specks per metre skimming the floor (sparks: `lift` up, `gravity`
     * pulling them back down).
     */
    dust: {
      aspect: 1.7,
      color: "#ab9d86",
      drag: 0.35,
      grit: {
        color: "#c9b79a",
        gravity: 0.6,
        intensity: 0.9,
        life: 0.4,
        lift: 0.12,
        perMetre: 9,
        size: 0.022,
        speed: 8,
        spread: 0.25,
        streak: 0.04,
      },
      height: 0.2,
      life: { max: 1.8, min: 1.2 },
      lift: 0.8,
      opacity: 0.4,
      perMetre: 6,
      rise: 0.2,
      size: { from: 0.5, to: 1.9 },
      speed: 4,
      wander: 0.5,
    },
    height: 2.2,
    /**
     * The force bursting off a Duelist it catches, once the leading air
     * reaches them (at most `maxDelay` seconds after the cast): `puffs` of
     * air and dust thrown off their body away from the caster within
     * `spread` radians, at `speed` stalling over `drag`; `bend` puffs
     * bending the air round them; `grit` specks and `dust` puffs kicked
     * from their feet. `slots` puffs are kept for it.
     */
    hit: {
      bend: { count: 2, life: 0.4, size: 2.2, strength: 0.12 },
      drag: 0.25,
      dust: 8,
      grit: 16,
      life: 0.9,
      maxDelay: 0.15,
      opacity: 0.4,
      puffs: 14,
      size: { from: 0.35, to: 1.3 },
      slots: { bend: 8, dust: 96 },
      speed: 5,
      spread: 0.9,
    },
    /**
     * The Spell VFX's burst on a Duelist it catches (see `spell-vfx.ts`): a
     * faint soft flash only, no ring and no sparks; the force itself is the
     * cloud's (`hit`).
     */
    impact: {
      flashLife: 0.08,
      flashSize: 0.35,
      life: 0.3,
      light: 0,
      lightLife: 0.2,
      ring: 0,
      ringLife: 0.2,
      size: 0.04,
      sparks: 0,
      speed: 6,
      splash: 1.4,
      streak: 0.04,
    },
    /** A soft breath of force at the Wand as the blast leaves it, `life` seconds. */
    muzzle: { flash: 0.4, intensity: 1.1, life: 0.12 },
    /** Seconds each blast keeps tearing up dust (the air has stalled by then). */
    seconds: 0.6,
    /**
     * A few faint wind streaks shot through the cone at the cast, at
     * `speed` within `spread` of their line, `size` wide and stretched
     * over `streak` seconds of motion.
     */
    streaks: {
      count: 8,
      intensity: 0.45,
      life: 0.22,
      size: 0.02,
      speed: 24,
      spread: 0.15,
      streak: 0.035,
    },
  },

  duelist: {
    /** A Duelist's body is a circle on the Arena floor for collision. */
    bodyRadius: 0.45,
    /** Height of the chest above the floor; the aim point sits there. */
    chestHeight: 1.3,
    /**
     * How a Training Dummy looks (Practice and Training only; a Duel keeps
     * the wizards): an enchanted wooden practice mannequin on the wizard's
     * own skeleton and clips, in a dark hooded robe with nothing under the
     * hood. The outfit's cloth takes `cloth` (the hood `hood`), its metal
     * fittings `metal` and its leather `leatherShade` of its own colour,
     * except on the forearms, hands, shins and feet, where it is wood, as
     * the hands are. Colours are hex; radiance is scene-linear HDR. The
     * Team's edge light is `rim`.
     *
     * The wood's grain runs along each bone (rest pose): a noise of
     * `grain` cycles per metre across it and `grainAlong` along it, wound
     * into `grainRings` rings a cycle, blending `wood` into `woodLate` by
     * `grainContrast`, and fading to its mean wherever a pixel spans more
     * than `grainFade` (from the first edge to the second) of a ring, so
     * it never shimmers. Every joint between two of
     * the wooden bones is a carved groove (`groove` colour and roughness),
     * `grooveWidth` of the way from one bone to the next either side of it
     * (along the skin's blend between them), filtered by the pixel's span.
     *
     * The hood's inside is a void (`hollow`) holding a faint light
     * (`hollowGlow` at `hollowRadiance`), the enchantment that moves the
     * dummy: it goes out as the dummy falls in a Practice (eased at
     * `lifeSharpness` per second) and flares back up to `surgeRadiance`
     * over `surgeSeconds` as it gets back up.
     */
    dummyLook: {
      cloth: "#2b2632",
      grain: 40,
      grainAlong: 3,
      grainContrast: 0.85,
      grainFade: [0.2, 0.45],
      grainRings: 2.5,
      groove: "#24160c",
      grooveRoughness: 0.9,
      grooveWidth: 0.05,
      hollow: "#020203",
      hollowGlow: "#8fd8ff",
      hollowRadiance: 0.004,
      hood: "#24202b",
      leatherShade: 0.45,
      lifeSharpness: 4,
      metal: "#6b6660",
      rim: "#7ff0ff",
      surgeRadiance: 0.5,
      surgeSeconds: 0.9,
      wood: "#a8743f",
      woodLate: "#5a361b",
      woodRoughness: 0.62,
    },
    /**
     * How the Wand sits in the right fist and the vial in the left: in the
     * palm (`palmAlong` of the way from the wrist to the knuckles,
     * `palmDepth` metres below them), the Wand leaving the fist between
     * thumb and index tipped `tilt` toward the fingers, its butt `butt`
     * metres out of the little-finger side.
     */
    grip: { butt: 0.03, palmAlong: 0.55, palmDepth: 0.035, tilt: 0.6 },
    health: 100,
    /** Spells hit a Duelist anywhere from the floor up to this height. */
    height: 2,
    /**
     * How the wizard is lit and dressed. The Team's colours are in
     * `teamLooks`; this is what both share. The outfit's texture is
     * re-tinted where it is green (`clothMask`: green over red and blue, in
     * linear light, from the first edge to the second), scaled so its mean
     * cloth (`clothLuminance`) and metal (`metalLuminance`) take the Team's
     * colours. Roughness is 0 (mirror) to 1; radiance is scene-linear HDR
     * (above the bloom threshold glows). The Team rim is an edge light whose
     * radiance grows with distance, from `rimNear` at `rimNearDistance`
     * metres from the camera to `rimFar` at `rimFarDistance`, so the far
     * Duelist reads against the dark walls while the near one is not washed
     * out. The rim reads a smoothed normal: `rimSmoothing` of it is the
     * limbs' (out from the bone each vertex hangs on, a bone with no child
     * reaching on `limbTipReach` of its parent's length), the rest the
     * mesh's own, so small, sharply curved parts do not sparkle into pixel
     * dots.
     */
    look: {
      clothLuminance: 0.057,
      clothMask: [0.003, 0.015],
      limbTipReach: 0.5,
      metalLuminance: 0.29,
      metalRoughness: 0.38,
      rimFar: 1.1,
      rimFarDistance: 14,
      rimNear: 0.25,
      rimNearDistance: 4,
      rimPower: 3.4,
      rimSmoothing: 0.85,
      skinRoughness: 0.62,
      stoneMottle: 0.25,
      /** Mottling of the stone, cycles per metre. */
      stoneMottleScale: 7,
      stoneRoughness: 0.92,
      tipRadiance: 3,
      tipSize: 0.012,
      wandGripRadius: 0.014,
      wandTipRadius: 0.007,
      wood: "#8a6038",
      woodRoughness: 0.5,
    },
    /**
     * The rigged wizard (`public/models/wizard.glb`, built from the CC0
     * Quaternius packs by `scripts/build-models.ts`) and how its clips play.
     * Units are metres, seconds and radians in the Duelist's frame (+y up,
     * +z the way it faces, +x to its left, so the Wand hand is at -x).
     */
    motion: {
      /**
       * Breathing laid over the clips: the chest rises `restAmplitude`
       * radians `restRate` times a second at rest, up to `windedAmplitude`
       * at `windedRate` when winded (all the Stamina spent; winded at
       * `windSharpness`, recovering over `recoverSeconds`). Standing, the
       * hips sway `sway` radians `swayRate` times a second.
       */
      breath: {
        recoverSeconds: 3,
        restAmplitude: 0.012,
        restRate: 0.25,
        sway: 0.02,
        swayRate: 0.12,
        windSharpness: 6,
        windedAmplitude: 0.05,
        windedRate: 0.7,
      },
      /** Charging: `OverhandThrow` held at `chargeAt` seconds (the wind-up). A Clash: `Push_Loop` held at `clashAt`, the Wand trembling `tremble` metres `trembleRate` times a second. */
      chargeAt: 0.12,
      /**
       * A Clash, as in the films: the Wand arm thrust out along the beam, the
       * tip `reach` metres further down it than `wandTip`; the chest leans
       * `lean` radians into the push and turns `twist` radians to put the
       * Wand shoulder forward; the free arm braced back and down for
       * balance, the wrist `brace` metres from its shoulder (the Duelist's
       * frame: +x left, +y up, +z ahead), the hand a fist.
       */
      clash: {
        brace: [0.17, -0.38, -0.28],
        lean: 0.12,
        reach: 0.12,
        twist: 0.3,
      },
      clashAt: 0,
      /** Drinking: the left wrist goes to `lips` (metres from the head joint, the Duelist's frame) and the head tips back up to `headBack` radians as the vial empties. */
      drink: { headBack: 0.45, lips: [0.03, -0.02, 0.2] },
      /**
       * Walking and running. The clips' own strides are long and slow (their
       * jog covers 2.9 m a step at 1.5 steps a second at our running
       * speed), so the gait sets its own: a cadence in steps a second of
       * `base + perSpeed × speed` (m/s), `walk` for the walk clip and `run`
       * for the jog and the sprint, and the stride that, at that cadence,
       * covers the ground actually travelled. The clip cycles advance at the
       * cadence and the legs reach by IK to the stride (scaled on the clip's
       * own, between `stride[0]` and `stride[1]` of it), so planted feet stay
       * put at any speed; the pelvis keeps `bob` of the clip's bounce and the
       * upper body `calm` of the standing pose (the clips swing hard). Walk,
       * jog and sprint each play alone, handing over to the next across the
       * `crossovers` speed bands (m/s); the speed eases at `speedSharpness`
       * and the gait fades in at `gaitSharpness` above `minSpeed`. Moving off
       * the facing, the legs turn toward the motion (at most `maxTwist`, or
       * `raisedTwist` with the Wand up, easing at `twistSharpness`); a
       * shortened step raises the pelvis (at most `maxRaise` metres) so the
       * legs keep the clip's straightness, and running it rides `lift` metres
       * higher still. The clips walk and run hips back and stooped: the
       * pelvis tucks under `tuck` radians (the thighs turned back, so the
       * feet stay put) and the spine straightens `upright` more, each by
       * the walk's or the run's share of the gait; the spine turns the chest back at most
       * `counterTwist` (all the way while the Wand is up) and the head looks
       * the rest, at most `headTurn` off the chest, leading a turn by
       * `headLead.seconds` of it (at most `headLead.max`). The body leans
       * into how its motion changes, `lean.share` of the physical angle
       * (atan of acceleration over g, at most `lean.maxForward` speeding up or
       * braking and `lean.maxSide` into a turn), the head keeping
       * `lean.headLevel` of it level, from velocity and
       * acceleration smoothed at their sharpnesses; turning on the spot past
       * `pivot.from` rad/s, the legs step round (fully at `from + full`, up
       * to `pivot.weight` of the walk, a stride per `radiansPerStride`).
       * There is no backwards
       * gait: `maxTwist` of π lets the legs run any way, turning as an angle.
       */
      gait: {
        bob: 0.16,
        cadence: {
          run: { base: 1.75, perSpeed: 0.12 },
          walk: { base: 1.3, perSpeed: 0.62 },
        },
        calm: 0.42,
        counterTwist: 0.45,
        // The run (R1, 7.6 m/s) is the sprint clip: the jog's high heel kicks
        // skip like a cartoon; the jog only bridges the walk to it.
        crossovers: [
          [4, 5],
          [5, 6.2],
        ],
        gaitSharpness: 8,
        headLead: { max: 0.45, seconds: 0.18 },
        headTurn: 1.1,
        /** How much of the clips' bowed head lifts back toward the horizon. */
        horizon: 0.46,
        lean: {
          accelerationSharpness: 10,
          headLevel: 0.7,
          maxForward: 0.2,
          maxSide: 0.21,
          share: 0.08,
          sharpness: 9,
          velocitySharpness: 14,
        },
        lift: 0.06,
        maxRaise: 0.12,
        maxTwist: Math.PI,
        minSpeed: 0.3,
        pivot: {
          from: 0.8,
          full: 3,
          radiansPerStride: 1.2,
          sharpness: 12,
          weight: 0.7,
        },
        raisedTwist: 1.1,
        speedSharpness: 10,
        stride: [0.4, 1.29],
        tuck: { run: 0.11, walk: 0.01 },
        twistSharpness: 10,
        upright: { run: 0.37, walk: 0.25 },
      },
      /** The head looks this share of the aim's pitch. */
      headPitch: 0.5,
      /**
       * When a one-shot starts (a Dodge, a hit, a jump, a landing, a pickup,
       * a knock-back, a Stagger, a Knockout or getting up), the gap from the
       * last drawn pose decays on a spring closing half of it every
       * `halflife` seconds, instead of the pose popping.
       */
      inertialization: { halflife: 0.08 },
      /**
       * A jump: the take-off plays `Jump_Start` from `takeoff.from` to
       * `takeoff.to` seconds of the clip over the first `takeoff.seconds` in
       * the air (the push off the floor and the legs tucking), then the air
       * pose (`Jump_Loop`); falling, the legs reach for the floor
       * (`Jump_Land`'s first pose) over the last `reach` metres. Airborne
       * poses ease at `sharpness`. The landing (`shots.land`) takes
       * `landWeight` of `Jump_Land`'s crouch.
       */
      jump: {
        landWeight: 0.5,
        reach: 0.7,
        sharpness: 30,
        takeoff: { from: 0.04, seconds: 0.26, to: 0.36 },
      },
      /**
       * A Spell landing kicks the upper body back (and `sideShare` of it to
       * the side it struck) at `impulse` radians a second, springing back at
       * `frequency` Hz with `damping` (under 1, so it rebounds once).
       */
      kick: { damping: 0.5, frequency: 4, impulse: 4.5, sideShare: 0.5 },
      /**
       * The Knockout: `Death01` held lying from `lieAt` seconds; getting up
       * (`LayToIdle`) fades out over its last `riseFadeSeconds`. The fall
       * lays the body down behind the feet, so it finds `room` to lie in:
       * the body as it lies is `body`, discs `[x, z, radius]` on the floor
       * of the Duelist's frame (metres, +x left, +z ahead: feet, legs, hips,
       * chest, head and the two flung hands). Every turn of the fall
       * `turnStep` apart is tried, either way up to half a circle, each
       * slid at most `maxShift` metres to keep `clearance` from the walls,
       * Cover and Obstructions; the least turning and sliding wins
       * (`shiftCost` radians a metre). The body eases to that turn and
       * slide at `sharpness` as it falls, and back once it is up again.
       */
      knockout: {
        lieAt: 1.9,
        riseFadeSeconds: 0.35,
        room: {
          body: [
            [0, 0.3, 0.34],
            [0, -0.15, 0.28],
            [0, -0.6, 0.28],
            [0, -0.95, 0.28],
            [0, -1.22, 0.18],
            [0.39, -1.33, 0.1],
            [-0.47, -1.53, 0.1],
          ],
          clearance: 0.05,
          maxShift: 0.6,
          sharpness: 7,
          shiftCost: 4,
          turnStep: Math.PI / 12,
        },
      },
      /**
       * The Dodge roll: `Roll` from `from` to `to` seconds of the clip over
       * the Dodge, then on at its own pace while it fades out over
       * `recoverSeconds`, the body turned toward the Dodge.
       */
      roll: { from: 0.34, recoverSeconds: 0.3, to: 1.08 },
      /** Clip weights ease in and out at `sharpness` per second. */
      sharpness: 12,
      /** How much of the Shield clip (`Idle_Shield_Loop`) the upper body takes: it swings the right shoulder back, out of the Wand arm's reach. */
      shieldUpper: 0.5,
      /**
       * Which stretch of each one-shot clip plays (`from` to `to` seconds of
       * the clip), and over how long (`seconds`; null keeps the clip's own
       * pace), peaking at `peak` of it.
       */
      shots: {
        cast: { from: 0, peak: 0.25, seconds: 0.4, to: 0.5 },
        flinch: { from: 0, peak: 0.2, seconds: 0.36, to: 0.33 },
        knockback: { from: 0.09, peak: 0.3, seconds: 0.35, to: 0.16 },
        land: { from: 0.05, peak: 0.25, seconds: 0.3, to: 0.45 },
        parry: { from: 0.1, peak: 0.3, seconds: 0.4, to: 0.6 },
        pickup: { from: 0, peak: 0.42, seconds: 0.55, to: 0.83 },
        push: { from: 0, peak: 0.25, seconds: 0.32, to: 0 },
        strike: { from: 0.27, peak: 0.15, seconds: 0.42, to: 0.58 },
      },
      /** The armed upper-body stance (`Spell_Simple_Idle_Loop`): its weight standing, and how much of it stays at a run. */
      stance: { moving: 0.35, standing: 1 },
      /** How much of the overhand strike the upper body takes on a Confringo release: in full, its follow-through throws both arms wide. */
      strikeUpper: 0.55,
      tremble: 0.012,
      trembleRate: 17,
      url: "models/wizard.glb",
    },
    teamLooks: {
      far: {
        cloth: "#1f7a52",
        /** The outfit's hood, in this colour; null leaves it off. */
        hood: "#16533a",
        metal: "#cfd8e0",
        rim: "#7ff0ff",
      },
      near: {
        cloth: "#a3222d",
        hood: null,
        metal: "#e3b255",
        rim: "#ffb36b",
      },
    },
    walkSpeed: 3.8,
    /**
     * The visible Wand and the right arm that holds it. At rest, walking or
     * running the arm hangs with the clips, the Wand held low. It rises (by
     * two-bone IK after the clips) to cast, Charge, Shield or Parry and in
     * a Clash, so the Wand tip sits exactly on `wandTip` below, pointing
     * along `rest`, `charge`, `shield` or the aim (a Clash); it snaps up at
     * every cast (so the Spell leaves the drawn tip), eases up at
     * `lockSharpness` per second, stays up `hold` seconds after the last
     * cast or Parry and lowers again at `lowerSharpness`. A Light or Special
     * cast flicks it (`flicks`: `raise` radians up, `inward` across, the hand
     * reaching `reach` metres ahead) over `flickSeconds` from the tip, so
     * the Spell leaves the Wand as it starts. Elbows bend toward
     * `elbowHint`. Disarmed, the empty hand swings with the clips.
     */
    wand: {
      /**
       * A Confringo thrown overhead (body frame, +z ahead, +x left, +y up).
       * Charging, the Wand tip rises from `wandTip` along an arc about the
       * right shoulder (`pivot`, metres up and ahead) to `tip`, the whole arm up above the
       * head and the Wand high, pointing `pointing`. Released, it comes down
       * over the top: the Spell leaves as the tip passes `wandTip`, and the
       * swing follows through to `follow.tip` (pointing `follow.pointing`)
       * over `follow.seconds`, fast at first, and holds there while the
       * strike plays (`motion.shots.strike`); then the arm lowers as usual.
       */
      charge: {
        follow: {
          pointing: [0.05, -0.55, 0.83],
          seconds: 0.26,
          tip: [-0.16, 0.8, 0.66],
        },
        pivot: { forward: -0.05, height: 1.41 },
        pointing: [0.05, 0.8, -0.6],
        tip: [-0.18, 2.16, -0.26],
      },
      elbowHint: [-0.5, -1, -0.6],
      flickSeconds: 0.2,
      flicks: {
        expelliarmus: { inward: 0.55, raise: 0.15, reach: 0.1 },
        incendio: { inward: -0.2, raise: 0.75, reach: 0.06 },
        petrificus: { inward: 0.15, raise: -0.35, reach: 0.12 },
        stupefy: { inward: 0.12, raise: 0.55, reach: 0.05 },
      },
      hold: 0.08,
      /** How long the Wand is, from the grip to the tip. */
      length: 0.4,
      lockSharpness: 14,
      /** Lowered, the way the Wand points in the body's frame (+z ahead, +x left, +y up): relaxed, down and ahead. */
      low: [-0.1, -0.5, 0.85],
      lowerSharpness: 12,
      rest: [0.2, 0.08, 1],
      shield: [0.1, 0.42, 0.9],
    },
    /**
     * Where Spells leave the Wand, relative to the Duelist and their facing:
     * ahead, to the right and up (about shoulder height). The Duelist view
     * draws its Wand with the tip exactly here whenever it is held ready.
     */
    wandTip: { forward: 0.72, height: 1.4, right: 0.32 },
  },

  /**
   * Expelliarmus, a Special Spell on the ○ Spell Slot: no damage, but the
   * Duelist it hits is Disarmed. Their Wand flies off along the hit and lands
   * on the Arena floor, where only they can pick it up by walking over it, or
   * it returns to their hand on its own. A Disarmed Duelist cannot cast or
   * Shield. A Parried Expelliarmus flies back and Disarms its caster.
   */
  expelliarmus: {
    cooldownSeconds: 10,
    radius: 0.2,
    /** After the cast, no Light Spell can follow for this long. */
    recoverySeconds: 0.35,
    /** Focus segments it costs: the whole meter. */
    segments: 3,
    speed: 24,
    /**
     * The Wand knocked loose: it flies `flightDistance` metres along the hit
     * over `flightSeconds`, arcing `flightHeight` metres above the straight
     * line from the hand to the floor, and stops short of Cover, Obstructions
     * (by `clearance` metres) and the Arena's walls. Once it lies on the
     * floor its owner picks it up with their body's centre within
     * `pickupRadius` of it; either way it returns `returnSeconds` after the Disarm.
     */
    wand: {
      clearance: 0.35,
      flightDistance: 4,
      flightHeight: 1.1,
      flightSeconds: 0.6,
      pickupRadius: 0.8,
      returnSeconds: 6,
    },
  },

  /**
   * Which way a Duelist faces, Locked On or not (the lock holds the camera
   * and the aim, not the body). Walking turns them toward where they walk
   * (on a spring: `movement.turnHalflife`), so running toward the camera
   * shows their face; standing still keeps the facing, so the camera can
   * orbit round them.
   * Casting, Charging or raising the Shield turns them to the aim fast
   * enough to finish even a half turn within `aimTurnSeconds`; they keep
   * facing the aim while Charging or Shielding and for `aimHoldSeconds`
   * after a cast, so a burst of casts on the move never swings them about.
   */
  facing: { aimHoldSeconds: 0.5, aimTurnSeconds: 0.1 },

  /**
   * Focus: the three-segment meter a Duelist builds through skilful play and
   * spends on Special Spells. It starts empty every Round and never decays.
   * Points; a Special Spell costs whole segments.
   */
  focus: {
    /** Points gained per deed. */
    gain: {
      /** For winning a Clash. */
      clashWin: 40,
      /** For each Spell that damages the Duelist (a direct hit or an Incendio Burn), once per Spell. */
      damageTaken: 5,
      /** For each Light Spell the Duelist lands. */
      lightSpellHit: 15,
      /** For each Parry. */
      parry: 30,
      /** For each Perfect Dodge. */
      perfectDodge: 20,
    },
    /** The full meter: three segments. */
    max: 99,
    /** Points per segment. */
    segment: 33,
  },

  /**
   * DualSense haptics. Rumble pulses start at these motor strengths (0 to 1;
   * the left motor is the heavy one, the right the light one) and fade out
   * over `seconds`; a `tremble` shakes a pulse `hz` times a second, dipping
   * by `depth` of its strength. Steady rumbles (`{ left, right }`) last as
   * long as their state. Colours are 0-255 RGB for the lightbar; each Spell has
   * its own lightbar colour (`lightbar.spells`), pushed apart in hue because
   * the LED renders colours differently from the screen, so they are not the
   * `spellPalette` the VFX draw in.
   * Trigger positions and forces run from 0 to 1.
   */
  haptics: {
    /** A short, light tick on every cast. */
    cast: { left: 0.08, right: 0.45, seconds: 0.08 },
    /** The Heavy Spell's Charge. */
    charge: {
      /** A sharp jolt when an Overcharge Backfires in the hand. */
      backfire: { left: 1, right: 0.9, seconds: 0.3 },
      /** The steady buzz once the Charge is full and past the Perfect Release window: a Backfire is a moment away. */
      overcharge: { left: 0.55, right: 0.9 },
      /** A crisp tick as the Charge enters the Perfect Release window. */
      perfect: { left: 0.15, right: 1, seconds: 0.05 },
      /** The steady rumble ramps from `from` at the press to `to` at a full Charge. */
      rumble: {
        from: { left: 0, right: 0.06 },
        to: { left: 0.3, right: 0.5 },
      },
    },
    /** The local Duelist's Clash. */
    clash: {
      /** A big thump as it ends, won, lost or exploded. */
      end: { left: 1, right: 1, seconds: 0.6 },
      /** The steady rumble while it lasts grows from `far` (the meeting point at the opponent's Wand)... */
      far: { left: 0.08, right: 0.12 },
      /** ...to `near` (the meeting point at the local Duelist's Wand). */
      near: { left: 0.85, right: 0.6 },
      /** A sharp tick on every △ pump of the local Duelist. */
      pump: { left: 0, right: 0.85, seconds: 0.05 },
    },
    /** A short push on casting Depulso. */
    depulsoCast: { left: 0.75, right: 0.3, seconds: 0.18 },
    /** A long trembling rumble on being Disarmed. */
    disarmed: {
      left: 0.6,
      right: 0.35,
      seconds: 1.1,
      tremble: { depth: 0.75, hz: 9 },
    },
    /**
     * A low thump for each Incendio or Confringo explosion (a Clash blowing
     * up included) near the local Duelist: `pulse` at their feet, fading to
     * nothing `range` metres away.
     */
    explosion: { pulse: { left: 0.9, right: 0.15, seconds: 0.35 }, range: 14 },
    /**
     * Gamepad API dual-rumble, used only without WebHID: it is replayed this
     * often while the rumble changes, each play lasting `effectSeconds`.
     */
    fallback: { effectSeconds: 0.12, resendSeconds: 0.05 },
    /** A heavy thump when the local Duelist is hit. */
    hitTaken: { left: 0.7, right: 0.5, seconds: 0.25 },
    lightbar: {
      /** The local Duelist's crimson, as their robe: dim and bluish, nothing like Stupefy's bright red. */
      base: { b: 22, g: 0, r: 110 },
      /** A cast lights the bar in the Spell's colour, fading back over this long. */
      castSeconds: 0.25,
      /** A hit taken flashes the colour of the Spell that landed, fading back over this long. */
      flashSeconds: 0.35,
      /** Full Focus breathes the bar toward the Wand aura's scarlet and back, once every `periodSeconds`. */
      focusPulse: { color: { b: 110, g: 90, r: 255 }, periodSeconds: 1.6 },
      /** One hue per Spell, as far apart as an LED can show: red, pink, orange, amber, ice blue, pale white-blue. */
      spells: {
        /** Amber: more green than Incendio's orange, short of yellow-white. */
        confringo: { b: 0, g: 170, r: 255 },
        /** Pale white-blue: the only washed-out colour. */
        depulso: { b: 255, g: 215, r: 170 },
        /** Magenta-pink: the only one with blue and no green. */
        expelliarmus: { b: 190, g: 0, r: 255 },
        /** Orange: a touch of green on red. */
        incendio: { b: 0, g: 60, r: 255 },
        /** Ice blue. */
        petrificus: { b: 255, g: 150, r: 20 },
        /** Pure red. */
        stupefy: { b: 0, g: 0, r: 255 },
      },
    },
    /**
     * The menus, kept subtle: a faint tick on the light motor as the
     * highlight moves (once per step, none at either end of the list), a
     * short, firmer pulse as a choice is taken (✕) and a softer one going
     * back (○).
     */
    menu: {
      back: { left: 0, right: 0.32, seconds: 0.06 },
      confirm: { left: 0.08, right: 0.45, seconds: 0.07 },
      /** A Training lesson completed: a full, rounded swell. */
      lesson: { left: 0.35, right: 0.6, seconds: 0.4 },
      move: { left: 0, right: 0.28, seconds: 0.045 },
      /** Training played through: fuller and longer. */
      training: { left: 0.5, right: 0.75, seconds: 0.9 },
    },
    /** A sharp, short pulse on a Parry. */
    parry: { left: 0.2, right: 1, seconds: 0.09 },
    /** A cold, light buzz for as long as the local Duelist is Petrified. */
    petrified: { left: 0, right: 0.22 },
    /** A soft pulse as a Potion goes down. */
    potionDrunk: { left: 0.18, right: 0.22, seconds: 0.3 },
    /** Harder and longer for the strong Stupefy that Staggers. */
    strongHitTaken: { left: 1, right: 0.8, seconds: 0.45 },
  },

  hud: {
    /**
     * The Charge ring round the screen centre. Past the Perfect Release
     * window it pulses ever faster as Overcharge nears, from `warnPulse.from`
     * to `warnPulse.to` pulses per second; a release flies the ring out over
     * `releaseSeconds` (longer for a Perfect Release or a Backfire).
     */
    chargeRing: {
      backfireSeconds: 0.5,
      perfectSeconds: 0.45,
      releaseSeconds: 0.22,
      /** Pulses per second of the red flash between the full Charge and its Backfire. */
      warnPulse: 14,
    },
    /** "¡Clash!" punches in for `calloutSeconds` as the local Duelist's Clash starts; the △ prompt kicks for `pumpKickSeconds` on every pump. */
    clash: { calloutSeconds: 1.1, pumpKickSeconds: 0.14 },
    /**
     * A floating number at the impact point of every hit on an opponent (never
     * on the local Duelist): it rises `risePixels` over `seconds` and fades
     * over the last `fadeShare` of that time. Strong hits (the third Stupefy,
     * an empowered Confringo) are gold and `strongScale` times larger. Hits
     * landing on the same spot step `spreadPixels` sideways in turn, so rapid
     * hits stay readable. `enabled: false` turns them all off.
     */
    damageNumbers: {
      enabled: true,
      fadeShare: 0.45,
      risePixels: 44,
      seconds: 0.8,
      spreadPixels: 14,
      strongScale: 1.4,
    },
    /** How long "¡Desarmado!" stays up after a Disarm the local Duelist was part of. */
    disarmCalloutSeconds: 1.2,
    /** How long "¡Duelo!" stays up once control is given. */
    duelCalloutSeconds: 0.9,
    /**
     * Each opponent's small Health bar floats this many metres above the top
     * of their head; the name of a Special Spell they cast shows above it for
     * `spellSeconds`.
     */
    floatingBar: { headroom: 0.35, spellSeconds: 1.1 },
    /** The pale "damage taken" part of a Health bar lingers this long... */
    healthLagDelay: 0.35,
    /** ...then drains at this many Health points per second. */
    healthLagRate: 60,
    /** How long "¡Parry!" stays up after the local Duelist Parries. */
    parryCalloutSeconds: 0.8,
    /**
     * The Spell Slot and Potion Slot diamonds spread apart (and grow a
     * little) while their trigger is held, and tighten back on release, over
     * this long.
     */
    slotsSpreadSeconds: 0.12,
    /**
     * A Special Spell's name (or "¡Confringo!" on a Perfect Release) punches
     * in under the reticle when the local Duelist casts it, gone after this long.
     */
    spellCalloutSeconds: 0.7,
    /** The Stamina bar flashes this long when a defence is refused for want of Stamina. */
    staminaShortSeconds: 0.35,
  },

  /**
   * Incendio, a Special Spell: a fireball that explodes on impact (a
   * Duelist, a Shield, another Spell, Cover or the floor). The direct hit
   * deals `damage` (a Shield blocks it); every opponent within the blast is
   * left with a Burn, which a Shield does not stop.
   */
  incendio: {
    /** Everyone whose body is within this many metres of the explosion is caught in the blast. */
    blastRadius: 2.4,
    burn: { damagePerSecond: 5, seconds: 3 },
    cooldownSeconds: 7,
    /** Damage of the direct hit, Health points. */
    damage: 18,
    /** The projectile is a sphere of this radius for collisions. */
    radius: 0.26,
    /** After the cast, no Light Spell can follow for this long. */
    recoverySeconds: 0.35,
    /** Focus segments it costs. */
    segments: 2,
    speed: 19,
  },

  input: {
    /**
     * Flicking the right stick switches the Lock-on Target left or right: the
     * stick must travel from near the centre to near full tilt quickly, then
     * come back to the centre before it can flick again.
     */
    flick: {
      /** No second flick sooner than this after the last one, seconds. */
      cooldownSeconds: 0.3,
      /** The stick counts as centred (and the flick re-arms) below this deflection. */
      rest: 0.3,
      /** Deflection that completes a flick. */
      threshold: 0.8,
      /** Seconds from leaving the centre to reaching the threshold, at most. */
      windowSeconds: 0.15,
    },
    /** Clicking R3 often knocks the right stick: it is ignored this long after the press, seconds. */
    lockOnSettleSeconds: 0.12,
    look: {
      /**
       * Response curve: the stick deflection (0 to 1) is raised to this power.
       * 1 is linear; higher is finer near the centre and faster at full tilt.
       */
      curveExponent: 1.8,
      /** Full-tilt pitch rate, radians per second (about 150 degrees per second). */
      maxPitchSpeed: 2.6,
      /** Full-tilt yaw rate, radians per second (about 220 degrees per second). */
      maxYawSpeed: 3.8,
      /**
       * Natural frequency of the spring that chases the shaped stick (rad/s).
       * Higher is snappier; around 30 settles in about 0.15 s.
       */
      springFrequency: 30,
    },
    /**
     * The left stick's response: its deflection (0 to 1, past the dead
     * zone) is raised to this power, so a light touch gives a slow, careful
     * walk and full tilt the full pace.
     */
    moveCurveExponent: 1.5,
    /**
     * How the right stick turns the camera. The deflection is shaped by a
     * response curve, eased by a critically damped spring (light smoothing and
     * a touch of acceleration), then scaled to turn rates. Up looks up.
     */
    /**
     * L2 is the Potion Slots' modifier, read like R2 for the Spell Slots:
     * held once past `hold`, until it comes back under `release` (0 to 1).
     */
    potionSlots: { hold: 0.35, release: 0.15 },
    /**
     * R2 is the Spell Slots' modifier: it counts as held once the trigger
     * travels past `hold` and until it comes back under `release` (0 to 1),
     * so a trigger resting near the line never flickers it. While it is held
     * the face buttons cast from their Spell Slots instead of their usual actions.
     */
    spellSlots: { hold: 0.35, release: 0.15 },
    /** Stick deflection below this radius reads as centred. */
    stickDeadZone: 0.12,
    /** Trigger travel below this value reads as released. */
    triggerDeadZone: 0.04,
  },

  /**
   * The Knockout shot: the camera frames the fallen Duelist from the
   * winner's side, as if standing `standOff` metres from them, swinging
   * round to the most open side when walls or Cover crowd that one. The
   * side is chosen once, when the shot starts.
   */
  knockoutCamera: {
    /** Open ground wanted on the chosen side, metres from the fallen Duelist: room for the whole shot. */
    room: 7,
    /** What a radian away from the winner's side costs, in metres of room lost: higher keeps closer to the winner's side. */
    sideCost: 1.5,
    standOff: 2.5,
  },

  /**
   * The loading screen's progress bar: the share of it done once the
   * renderer is up (`renderer`), once the wizard has downloaded (`wizard`,
   * filling in between by its bytes) and once the courtyard's and the
   * wizards' shaders are compiled (`shaders`); compiling every effect not
   * drawn yet fills the rest.
   */
  loading: { stages: { renderer: 0.1, shaders: 0.9, wizard: 0.8 } },

  /** Lock-on: R3 locks a Duelist onto an opponent, who becomes their Target. */
  lockOn: {
    /**
     * R3 only Locks On to an opponent whose body is within this many
     * reticle radii of the crosshair: the acquire angle is
     * `acquireCrosses * aimAssist.bendAngle` (about 5 degrees), measured
     * like Aim Assist (to the body's edge, as seen from the free camera), on
     * top of range and sight. Tying it to the reticle's circle keeps the two in step.
     */
    acquireCrosses: 5,
    /**
     * Spells cast while Locked On fly at the Target's current chest (no lead)
     * and turn toward it at no more than `turnRate` (radians per second) for
     * their first `seconds`: enough to follow a small step, never a strafe.
     */
    homing: { seconds: 0.35, turnRate: 0.45 },
    /**
     * While Locked On the right stick only nudges the framing, like a spring:
     * its turn rate, scaled by `gain`, pushes the view off the Target up to
     * `maxYaw` / `maxPitch` (radians) while it always pulls back at
     * `returnSharpness` (per second). Full tilt holds about gain x speed /
     * sharpness; letting go springs back.
     */
    nudge: { gain: 0.5, maxPitch: 0.21, maxYaw: 0.35, returnSharpness: 6 },
    /** Only opponents within this many metres can be Locked On to. */
    range: 30,
    /** With nothing to lock on to, R3 brings the pitch back to rest over this long. */
    recentreSeconds: 0.25,
    /** The lock breaks once the Target has been out of sight behind Cover for longer than this. */
    sightGraceSeconds: 1,
  },

  /** How the Lock-on Target is marked: a rim glow round its silhouette. */
  lockOnGlow: {
    color: "#ffcf7a",
    /** Exponential rate, per second, at which the glow fades in and out. */
    fadeSharpness: 10,
    /** Share of the glow that remains while the Target is out of sight behind Cover. */
    hiddenShare: 0.35,
    /** Fresnel exponent: higher hugs the silhouette's edge more tightly. */
    power: 2.4,
    /** Peak scene-linear radiance at the very edge, above the bloom threshold so it glows. */
    radiance: 2.2,
  },

  /**
   * How a loose Wand looks while its owner is Disarmed: the Wand glowing
   * scarlet, tumbling end over end `spinTurns` times a second while it
   * flies, then lying on the floor in a soft ring of light that breathes
   * `pulseSpeed` times a second. Returning on its own, it zips back into
   * the hand over `returnSeconds`. Colours are hex; radiance is
   * scene-linear HDR (above the bloom threshold glows).
   */
  looseWand: {
    color: "#ff3d55",
    /** The glow sprite round the Wand: size in metres, and radiance. */
    glowRadiance: 1.4,
    glowSize: 0.85,
    /** How much of the glow the breathing takes away at its lowest (0 steady). */
    pulseDepth: 0.45,
    pulseSpeed: 1.5,
    /** The Wand's own wood, lit from within. */
    radiance: 2.6,
    returnSeconds: 0.3,
    /** The ring of light on the floor round where it lies: radius in metres, and radiance. */
    ringRadiance: 1.2,
    ringRadius: 0.6,
    spinTurns: 2.5,
  },

  /** Navigating menus with the D-pad and the left stick. */
  menu: {
    /** Seconds a direction must be held before it starts repeating. */
    repeatDelay: 0.4,
    /** Seconds between repeats once a held direction is repeating. */
    repeatInterval: 0.14,
    /** The left stick must tilt past this (0 to 1) to step a menu once. */
    stickPress: 0.6,
    /** It must come back inside this before it can step again: one tilt, one step. */
    stickRelease: 0.35,
  },

  /**
   * How a walking Duelist's velocity follows the stick: a critically damped
   * spring closes half the gap every `speedUpHalflife` seconds (90% in
   * about 3.3 halflives), `slowDownHalflife` when slowing or turning back,
   * so a body never starts, stops or reverses in an instant, nor jolts as
   * it begins to. A walk turns the facing on the same kind of spring,
   * `turnHalflife` (casting still turns to the aim at once: see `facing`).
   */
  movement: {
    slowDownHalflife: 0.03,
    speedUpHalflife: 0.02,
    turnHalflife: 0.08,
  },

  /**
   * Petrificus Totalus, a Special Spell: the Duelist it hits is Petrified,
   * frozen in place and unable to act, for `petrifiedSeconds`. No damage.
   */
  petrificus: {
    cooldownSeconds: 9,
    petrifiedSeconds: 1.5,
    radius: 0.2,
    /** After the cast, no Light Spell can follow for this long. */
    recoverySeconds: 0.35,
    /** Focus segments it costs. */
    segments: 2,
    speed: 24,
  },

  /**
   * How a Petrified Duelist looks: turned to grey stone with a cold, pale
   * rim of light round the silhouette. The stone spreads from where the
   * Spell struck: a front racing out `spreadSpeed` metres a second until it
   * reaches `spreadReach`, its edge `spreadEdge` soft and ragged by
   * `spreadNoise` metres, glowing cold (`frontRadiance`) as it goes.
   * Colours are hex; radiance is scene-linear HDR (above the bloom
   * threshold glows).
   */
  petrifiedLook: {
    /** Exponential rate, per second, at which the stone comes in and fades back out. */
    fadeSharpness: 14,
    frontRadiance: 1.5,
    rimColor: "#bcd4ff",
    /** Fresnel exponent of the rim: higher hugs the silhouette's edge more tightly. */
    rimPower: 3.5,
    rimRadiance: 1,
    spreadEdge: 0.08,
    spreadNoise: 0.12,
    spreadReach: 2.4,
    spreadSpeed: 2.2,
    stoneColor: "#8a8e96",
  },

  /**
   * How an active Potion looks: a subtle aura round the drinker's silhouette
   * in the Potion's colour while its effect lasts, breathing `pulseSpeed`
   * times a second between `low` and full `radiance`, easing in and out at
   * `fadeSharpness` per second; Wiggenweld flashes its colour once over
   * `flashSeconds` as it heals. While drinking, a vial in the Potion's colour
   * glows at the lips. Colours are hex; radiance is scene-linear HDR.
   */
  potionLook: {
    colors: {
      felix: "#ffd24a",
      strength: "#ff4a3a",
      swiftness: "#5fe0d0",
      wiggenweld: "#7fe06a",
    },
    fadeSharpness: 8,
    flashRadiance: 2.2,
    flashSeconds: 0.6,
    low: 0.5,
    /** Fresnel exponent: higher hugs the silhouette's edge more tightly. */
    power: 1.8,
    pulseSpeed: 1.4,
    radiance: 0.9,
    /** The vial's own glow while it is drunk. */
    vialRadiance: 2.4,
  },

  /**
   * The Potion bound to each Potion Slot (one per D-pad arrow), or null for
   * an empty slot.
   */
  potionSlots: potionSlotsOf({
    down: "felix",
    left: "wiggenweld",
    right: "swiftness",
    up: "strength",
  }),

  /**
   * Potions, drunk from the Potion Slots (L2 held and a D-pad arrow). Each
   * Round every Duelist starts with `charges` of each, spent as drinking
   * starts. Drinking takes `drink.seconds`, during which the drinker walks at
   * `drink.moveScale` of their speed and cannot cast, Shield, Charge, Dodge
   * or jump; any Spell landing on them (a direct hit, not a Burn) interrupts
   * it and the Potion is lost. A Disarmed Duelist can drink.
   */
  potions: {
    drink: { moveScale: 0.4, seconds: 1 },
    /** Felix Felicis: grants `segments` Focus segments at once, never past the full meter. */
    felix: { charges: 1, segments: 1 },
    /** Spell damage dealt is multiplied by `damageScale` for `seconds`. */
    strength: { charges: 1, damageScale: 1.25, seconds: 10 },
    /** Stamina is never spent and walking is `speedScale` times faster for `seconds`. */
    swiftness: { charges: 1, seconds: 8, speedScale: 1.3 },
    /** Restores `healShare` of the full Health at once. */
    wiggenweld: { charges: 2, healShare: 0.35 },
  },

  /**
   * Practice: a Duel with nothing at stake against a Training Dummy or the
   * AI. There is never a Knockout or a Round end.
   */
  practice: {
    /** The Training Dummies' rhythms. */
    dummies: {
      /** Maniquí que lanza hechizos presses Stupefy this often (seconds). */
      castInterval: 0.6,
      /** Maniquí de Clash, when the player overcharges, lets go this many seconds past full (before the Backfire, `confringo.backfire.delaySeconds`). */
      clashHoldPastFull: 0.05,
      /**
       * Maniquí de Clash pumps the Clash this many presses per second: well
       * under a person mashing △ (about 6 to 9), so pumping faster wins and
       * not pumping loses.
       */
      clashPumpRate: 4,
      /** Maniquí desarmador's first Expelliarmus comes this many seconds into the Practice. */
      disarmsFirstCast: 2,
      /** Maniquí desarmador casts Expelliarmus at the player this often (seconds). */
      disarmsInterval: 8,
    },
    /**
     * The rival's Health, once at zero, comes back full after this many
     * seconds, the rival down meanwhile; it then takes `getUpSeconds`
     * (the length of the `LayToIdle` clip it gets up with) to stand,
     * still unable to act or be hit.
     */
    getUpSeconds: 1.5,
    recoverySeconds: 2.5,
    /**
     * The practising Duelist's Health, Stamina and Focus each come back full
     * once they have not dropped for this many seconds, so the HUD still
     * shows them being spent and Spell costs still bite. Health and Stamina
     * reaching zero come back full at once: they never run out.
     */
    refillSeconds: 1.5,
  },

  /**
   * How Protego looks: a translucent half-dome in front of the Duelist that
   * shimmers while up, flares where a Spell is blocked, and the bright flash
   * of a Parry. Colours are hex; radiance values are scene-linear HDR, so
   * what is above the bloom threshold glows.
   */
  protego: {
    /** Centre of the dome above the feet, and its radius, metres. */
    centreHeight: 1.05,
    color: "#8fd3ff",
    /** Exponential rate, per second, at which the dome grows in and fades out. */
    fadeSharpness: 18,
    /** Radiance a blocked Spell adds over the whole dome, decaying with time constant `flareSeconds` (a Parry's by `parry.flare` more). */
    flare: 0.5,
    flareSeconds: 0.25,
    parry: {
      color: "#fff1c2",
      /** The flash's sprite grows from `startSize` to `endSize` metres. */
      endSize: 3.4,
      /** How many times brighter than a block a Parry makes the Shield's flare and ripple. */
      flare: 1.4,
      /** Peak candela of the Parry's light, fading over `seconds`... */
      light: 60,
      /** ...reaching this far, metres. */
      lightRange: 12,
      /** Radiance of the flash at its peak. */
      radiance: 7,
      seconds: 0.35,
      startSize: 0.4,
    },
    radius: 0.95,
    /** The dome swells from this share of its size to full as it goes up. */
    raiseScale: 0.6,
    /** Fresnel exponent: higher hugs the dome's rim more tightly. */
    rimPower: 2.2,
    /** Peak radiance at the rim. */
    rimRadiance: 1.6,
    /**
     * Where a Spell strikes the dome, a ring ripples out across it from the
     * point of impact at `speed` metres per second, `width` metres wide, at
     * `radiance` (a Parry's by `parry.flare` more), dying out over `seconds`.
     */
    ripple: { radiance: 2.4, seconds: 0.45, speed: 3.2, width: 0.12 },
    /** The shimmer: bands rippling up the dome at `shimmerSpeed`, `shimmerScale` bands per metre. */
    shimmerRadiance: 0.45,
    shimmerScale: 9,
    shimmerSpeed: 1.6,
  },

  /** The render pipeline: tone, bloom and anti-aliasing quality knobs. */
  render: {
    bloom: {
      /** Spread across the bloom mip chain (0..1). */
      radius: 0.45,
      /** Internal resolution of the bloom chain, relative to the canvas. */
      resolutionScale: 0.5,
      /** Soft knee above the threshold, scene-linear. */
      softKnee: 0.6,
      strength: 0.85,
      /** Scene-linear luminance where bloom starts (moon, flames, Spells, not lit stone). */
      threshold: 0.85,
    },
    /** Exposure multiplier ahead of the tone map. */
    exposure: 1.25,
    /** MSAA samples for the scene pass (1 disables it). */
    msaaSamples: 4,
    /**
     * Dynamic resolution: the scene renders at a scale of the canvas's
     * physical pixels (per axis) and is upscaled. The scale never exceeds
     * what fits `maxPixels`, and drops (to `minScale` at most) only while
     * measured GPU frame time runs over `budgetMs`.
     */
    resolution: {
      /** GPU milliseconds per frame to stay under: 60 fps allows 16.7, the rest is headroom for spikes. */
      budgetMs: 12,
      /** Steps back up after `calmWindows` windows in a row under this share of the budget. */
      calmShare: 0.8,
      calmWindows: 3,
      /** False pins the scale to the pixel cap. */
      dynamic: true,
      /** Most physical pixels the scene pass draws; a 4K frame is 8.3 million. */
      maxPixels: 8_300_000,
      minScale: 0.5,
      /** Which quantile of a window's GPU times is judged against the budget. */
      quantile: 0.75,
      /** Windows ignored right after a change, while new targets settle. */
      settleWindows: 1,
      /** Scales move in steps of this much. */
      step: 0.05,
      /** Frames per judged window. */
      windowFrames: 30,
    },
    /** Darkening of the frame's corners (0 none .. 1 strong). */
    vignette: 0.35,
  },

  /** The aiming reticle's own fade, independent of the camera's Lock-on transition. */
  reticle: {
    /** Seconds to fade fully out on Lock-on, and back in on unlock or a broken lock: near-instant but not abrupt (smoothstep). */
    fadeSeconds: 0.1,
  },

  round: {
    /** The "3, 2, 1" countdown before control is given at the start of every Round. */
    introSeconds: 3,
    /** A Knockout plays this long in real time, slowed down by `timeScale`. */
    knockout: { realSeconds: 1, timeScale: 0.3 },
    /** After the Knockout's slow motion, the result holds this long before the next Round. */
    resultSeconds: 2,
    /** The first Team to win this many Rounds wins the Duel. */
    roundsToWin: 2,
  },

  /** The game flow between the title, the Difficulty select, the Duel and its result. */
  screens: {
    /** A Training lesson's "¡Lección completada!" holds this long, the lesson still playing, before its success scroll. */
    lessonDoneSeconds: 1.2,
    /** The Duel's victory or defeat call-out plays this long before the result screen. */
    resultDelaySeconds: 3,
  },

  /**
   * How the Spells look, in flight and where they land, plus the crackle at a
   * Charging Wand and what clings to a Burning or Petrified Duelist. Sizes in
   * metres, times in seconds, speeds in metres per second; intensities and
   * radiances are scene-linear HDR multipliers on the Spell's colours (above
   * the bloom threshold glows); lights are candela. Colours are hex.
   */
  spellLook: {
    /**
     * The electric arcs crawling over a hit body between its joints: a pool
     * of them, each `width` across with a line `thickness` thick wandering
     * `amplitude` (a share of the half-width) along `jag` turns, jumping to
     * a new path and a new pair of joints every `hop` seconds (dark for a
     * hop `dark` of the time), lifted `lift` toward the camera off the body.
     */
    arcs: {
      amplitude: 0.5,
      dark: 0.2,
      hop: 0.05,
      intensity: 5,
      jag: 4,
      lift: 0.2,
      pool: 10,
      thickness: 0.006,
      width: 0.24,
    },
    /** A Backfire is the same fire gone wrong: smoky red embers. */
    backfire: { hot: "#ffb070", main: "#c8240c" },
    /**
     * Each Spell in flight: a white-hot core, a glow round its head that
     * flickers by `glow.flicker` (a fireball licked by noise when its `flame`
     * is above 0), the jet of light behind it, the light it carries, and a
     * wake of sparks shed `perMetre` along its flight, falling (or rising,
     * below 0) with `gravity` and stretched over `streak` seconds of their
     * motion into lines.
     */
    bolts: {
      confringo: {
        core: { intensity: 2.5, radius: 0.12 },
        glow: {
          flame: 0.9,
          flameScale: 2.2,
          flameSpeed: 3,
          flicker: 0.12,
          intensity: 1,
          size: 1.3,
        },
        jet: {
          churn: 0.8,
          core: 0.07,
          coreIntensity: 1.2,
          edge: "#b0200a",
          filamentAmplitude: 0.25,
          filamentIntensity: 0.7,
          filamentSpeed: 18,
          filamentWidth: 0.05,
          flame: 0.85,
          flameScale: 3.5,
          flowSpeed: 10,
          halo: 0.3,
          haloIntensity: 0.7,
          headSoft: 0.06,
          length: 3.6,
          noiseScale: 1.3,
          pulse: 0.25,
          pulseRate: 1.4,
          pulseSpeed: 25,
          tailSoft: 0.5,
          taper: 0.55,
          width: 1.1,
        },
        light: { distance: 10, intensity: 16 },
        wake: {
          gravity: -0.4,
          intensity: 4,
          life: 0.45,
          perMetre: 9,
          size: 0.04,
          speed: 1.2,
          streak: 0.025,
        },
      },
      expelliarmus: {
        core: { intensity: 8, radius: 0.08 },
        glow: {
          flame: 0,
          flameScale: 2,
          flameSpeed: 3,
          flicker: 0.1,
          intensity: 2.2,
          size: 0.8,
        },
        jet: {
          churn: 0.45,
          core: 0.06,
          coreIntensity: 4.2,
          edge: "#ff1a3c",
          filamentAmplitude: 0.3,
          filamentIntensity: 2.2,
          filamentSpeed: 34,
          filamentWidth: 0.035,
          flame: 0,
          flameScale: 3,
          flowSpeed: 15,
          halo: 0.2,
          haloIntensity: 1,
          headSoft: 0.04,
          length: 4.5,
          noiseScale: 1.6,
          pulse: 0.5,
          pulseRate: 1.6,
          pulseSpeed: 55,
          tailSoft: 0.45,
          taper: 1,
          width: 0.6,
        },
        light: { distance: 8, intensity: 11 },
        wake: {
          gravity: 0.6,
          intensity: 6,
          life: 0.3,
          perMetre: 7,
          size: 0.035,
          speed: 2.2,
          streak: 0.04,
        },
      },
      incendio: {
        core: { intensity: 2.5, radius: 0.1 },
        glow: {
          flame: 1,
          flameScale: 2.6,
          flameSpeed: 3.5,
          flicker: 0.15,
          intensity: 1,
          size: 1.5,
        },
        jet: {
          churn: 1,
          core: 0.06,
          coreIntensity: 0.8,
          edge: "#8a1204",
          filamentAmplitude: 0.2,
          filamentIntensity: 0.3,
          filamentSpeed: 14,
          filamentWidth: 0.06,
          flame: 1,
          flameScale: 4.5,
          flowSpeed: 9,
          halo: 0.32,
          haloIntensity: 0.8,
          headSoft: 0.08,
          length: 3.2,
          noiseScale: 1.4,
          pulse: 0.2,
          pulseRate: 1.2,
          pulseSpeed: 20,
          tailSoft: 0.6,
          taper: 0.3,
          width: 1.5,
        },
        light: { distance: 10, intensity: 18 },
        wake: {
          gravity: -0.6,
          intensity: 4.5,
          life: 0.5,
          perMetre: 11,
          size: 0.045,
          speed: 1,
          streak: 0.025,
        },
      },
      petrificus: {
        core: { intensity: 7, radius: 0.07 },
        glow: {
          flame: 0,
          flameScale: 2,
          flameSpeed: 3,
          flicker: 0.04,
          intensity: 2,
          size: 0.75,
        },
        jet: {
          churn: 0.2,
          core: 0.045,
          coreIntensity: 4,
          edge: "#bcd4ff",
          filamentAmplitude: 0.22,
          filamentIntensity: 1.6,
          filamentSpeed: 14,
          filamentWidth: 0.025,
          flame: 0,
          flameScale: 3,
          flowSpeed: 8,
          halo: 0.16,
          haloIntensity: 0.8,
          headSoft: 0.04,
          length: 4.8,
          noiseScale: 1,
          pulse: 0.15,
          pulseRate: 1.2,
          pulseSpeed: 20,
          tailSoft: 0.4,
          taper: 1,
          width: 0.5,
        },
        light: { distance: 8, intensity: 9 },
        wake: {
          gravity: 0.15,
          intensity: 5,
          life: 0.5,
          perMetre: 6,
          size: 0.04,
          speed: 0.5,
          streak: 0,
        },
      },
      stupefy: {
        core: { intensity: 6, radius: 0.08 },
        glow: {
          flame: 0,
          flameScale: 2,
          flameSpeed: 3,
          flicker: 0.08,
          intensity: 2.1,
          size: 0.7,
        },
        /**
         * The jet of light from the Wand to the head, up to `length` long
         * and `width` across, turned to the camera: a white-hot `core` and a
         * `halo` (shares of the half-width) that churns by `churn` with noise
         * at `noiseScale` per metre flowing at `flowSpeed`, pulses
         * (`pulse` deep, `pulseRate` per metre, `pulseSpeed`) running down
         * it, and two filaments `filamentAmplitude` off the axis twisting at
         * `filamentSpeed`; soft over the tail's `tailSoft` and the head's
         * `headSoft` shares. The halo cools to `edge` at its rim; `flame`
         * (0 to 1) eats tongues into it, `flameScale` per metre, and burns
         * its heart white; `taper` is the tail's width as a share of the
         * head's (below 1 a gout widening from the Wand).
         */
        jet: {
          churn: 0.6,
          core: 0.05,
          coreIntensity: 3.5,
          edge: "#ff2a1f",
          filamentAmplitude: 0.32,
          filamentIntensity: 2.2,
          filamentSpeed: 30,
          filamentWidth: 0.035,
          flame: 0,
          flameScale: 3,
          flowSpeed: 14,
          halo: 0.24,
          haloIntensity: 0.9,
          headSoft: 0.04,
          length: 4.5,
          noiseScale: 1.6,
          pulse: 0.35,
          pulseRate: 2.2,
          pulseSpeed: 40,
          tailSoft: 0.45,
          taper: 1,
          width: 0.6,
        },
        light: { distance: 10, intensity: 16 },
        wake: {
          gravity: 0.8,
          intensity: 5,
          life: 0.22,
          perMetre: 4,
          size: 0.03,
          speed: 1.6,
          streak: 0.03,
        },
      },
    },
    /**
     * A Burning Duelist: embers rising off the body at `embers.rate` a
     * second and tongues of flame (wisps `stretch` taller than wide, shrinking
     * by `grow` as they rise) at `flames.rate`, from its joints or from
     * `from` to `to` metres off the floor and `spread` round the body, with a
     * flickering warm light of `light` candela. The robe glows like embers
     * meanwhile (`robe`, the Duelist view's): noise `scale` per metre rising
     * at `speed`, glowing above `threshold`, flickering by `flicker`, easing
     * in and out at `fadeSharpness` per second.
     */
    burn: {
      embers: { life: 0.85, rate: 30, rise: 0.7, size: 0.045, speed: 0.7 },
      flames: {
        gravity: -1.2,
        grow: 0.55,
        intensity: 1.6,
        life: 0.55,
        rate: 34,
        size: 0.32,
        speed: 0.4,
        stretch: 1.3,
      },
      from: 0.15,
      light: 9,
      robe: {
        color: "#ff4a0c",
        fadeSharpness: 6,
        flicker: 0.35,
        radiance: 2,
        scale: 13,
        speed: 1.2,
        threshold: 0.55,
      },
      spread: 0.3,
      to: 1.6,
    },
    /** The radiance of every burst's flash, ring and sparks, on their colours. */
    burstRadiance: { flash: 2.2, ring: 2.5, sparks: 4 },
    /**
     * Bursts of sparks for what stops a Spell short (Cover, a Shield, a
     * mid-air cancel), Perfect Releases, Backfires and Wands returning:
     * `sparks` of them at `speed`, living `life`, `size` across and stretched
     * over `streak` seconds of motion, round a still flash `flashSize` across
     * for `flashLife`; a ring `ring` across swells out over `ringLife` (0 for
     * none); `splash` leans the sparks along the Spell's flight (0 every way,
     * above 0 splashing on through, below 0 back); the flash lights the scene
     * with `light` candela fading over `lightLife`.
     */
    bursts: {
      backfire: {
        flashLife: 0.22,
        flashSize: 1.3,
        life: 0.8,
        light: 55,
        lightLife: 0.45,
        ring: 1.4,
        ringLife: 0.3,
        size: 0.08,
        sparks: 70,
        speed: 5,
        splash: 0,
        streak: 0.03,
      },
      cancel: {
        flashLife: 0.16,
        flashSize: 1.6,
        life: 0.55,
        light: 60,
        lightLife: 0.35,
        ring: 2.6,
        ringLife: 0.28,
        size: 0.07,
        sparks: 64,
        speed: 10,
        splash: 0,
        streak: 0.035,
      },
      /** Confringo bursting on Cover, a wall or the floor. */
      confringoStop: {
        flashLife: 0.2,
        flashSize: 1.7,
        life: 0.7,
        light: 90,
        lightLife: 0.45,
        ring: 2.6,
        ringLife: 0.3,
        size: 0.09,
        sparks: 100,
        speed: 10,
        splash: -0.6,
        streak: 0.04,
      },
      /** The flare of a Perfect Release at the Wand. */
      perfect: {
        flashLife: 0.16,
        flashSize: 0.9,
        life: 0.35,
        light: 40,
        lightLife: 0.2,
        ring: 1.6,
        ringLife: 0.22,
        size: 0.045,
        sparks: 32,
        speed: 6,
        splash: 0,
        streak: 0.03,
      },
      stop: {
        flashLife: 0.1,
        flashSize: 0.8,
        life: 0.32,
        light: 15,
        lightLife: 0.2,
        ring: 0,
        ringLife: 0,
        size: 0.05,
        sparks: 22,
        speed: 5,
        splash: -0.7,
        streak: 0.03,
      },
      /** A loose Wand picked up or flying home: a soft flare where it lay. */
      wandBack: {
        flashLife: 0.18,
        flashSize: 1,
        life: 0.5,
        light: 25,
        lightLife: 0.3,
        ring: 0.9,
        ringLife: 0.25,
        size: 0.04,
        sparks: 30,
        speed: 3,
        splash: 0,
        streak: 0,
      },
    },
    /**
     * Confringo's size follows its Charge: a tap is `tapScale` of a full
     * Charge's size, and an empowered blast `empoweredScale` bigger still;
     * its fire bursting on a wall is `stopScale` of its burst on a body.
     */
    confringo: { empoweredScale: 1.3, stopScale: 0.8, tapScale: 0.6 },
    /** How far off the body (from its nearest joint), metres, a Spell's energy lands. */
    contact: 0.22,
    /**
     * The crackle at a Charging Wand: sparks per second, size and launch
     * speed while it builds, rising to the `overcharge` values as a held
     * full Charge nears its Backfire, each stretched over `streak` seconds of
     * motion; plus a glow sprite and a light at the tip.
     */
    crackle: {
      building: { rate: 26, size: 0.03, speed: 1.2 },
      /** How hard the tip glow flickers at the brink of Overcharge (0 steady). */
      flicker: 0.6,
      life: 0.28,
      /** Light at the tip at full Charge, and at the brink of Overcharge. */
      light: { full: 9, overcharge: 26 },
      overcharge: { rate: 190, size: 0.06, speed: 5 },
      streak: 0.03,
      /** Glow sprite size at the tip, from an empty to a full Charge. */
      tipGlow: { empty: 0.12, full: 0.5 },
    },
    /** The white of a Disarm's flash. */
    disarmFlash: { hot: "#ffffff", main: "#ffe8ec" },
    /**
     * The flares of light rays where Spells land and leave the Wand: a ring
     * of `slots`; a hot core `core` of the radius across, and `rays` lobes
     * of angular noise sharpened by `sharpness`, fading `falloff` along the
     * radius, at `rayRadiance` times the flare's intensity.
     */
    flares: {
      core: 0.08,
      falloff: 1.6,
      rayRadiance: 2.5,
      rays: 3.5,
      sharpness: 8,
      slots: 32,
    },
    /**
     * How a Duelist's silhouette flares in a Spell's colour as it lands (the
     * Duelist view's): a rim of `radiance` sharpened by `power`, and `fill`
     * of it over the whole body, dying away over `seconds`.
     */
    hitFlare: { fill: 0.05, power: 1.5, radiance: 2.8, seconds: 0.3 },
    /**
     * Where a Spell's energy lands, as the films draw it: a flare of rays
     * (`flare`: radiance, life, full size), soft `wisps` of energy swelling
     * `grow` times as they fade (fire for the fire Spells), `smoke` laid over
     * the scene (stone dust for Petrificus; `intensity` is its brightness),
     * a few long thin `streaks` (sparks, see `sparks`), `arcs` crawling over
     * the body it hit for `life` seconds, and a pulse of `light` (candela
     * fading over `life`). `splash` leans wisps and streaks along the
     * Spell's flight; `gravity` below 0 makes wisps rise.
     */
    impacts: {
      /** The flare at the Wand tip as a Spell leaves it. */
      cast: {
        arcs: { count: 0, life: 0 },
        flare: { intensity: 2.2, life: 0.1, size: 0.8 },
        light: { life: 0.1, peak: 6 },
        smoke: {
          count: 0,
          gravity: 0,
          grow: 1,
          intensity: 1,
          life: 1,
          size: 0.1,
          speed: 0,
        },
        splash: 0.8,
        streaks: {
          count: 4,
          intensity: 4,
          life: 0.18,
          size: 0.02,
          speed: 6,
          streak: 0.03,
        },
        wisps: {
          count: 1,
          gravity: 0,
          grow: 1.8,
          intensity: 1,
          life: 0.16,
          size: 0.22,
          speed: 0.6,
        },
      },
      /** Confringo bursting into fire and smoke, on a Duelist or (scaled by `confringo.stopScale`) on a wall; scaled with its Charge. */
      confringo: {
        arcs: { count: 2, life: 0.25 },
        flare: { intensity: 1.4, life: 0.18, size: 2 },
        light: { life: 0.55, peak: 90 },
        smoke: {
          count: 6,
          gravity: -0.35,
          grow: 2.6,
          intensity: 1,
          life: 1.6,
          size: 0.6,
          speed: 1.4,
        },
        splash: 0.5,
        streaks: {
          count: 10,
          intensity: 5,
          life: 0.5,
          size: 0.028,
          speed: 12,
          streak: 0.04,
        },
        wisps: {
          count: 10,
          gravity: -0.5,
          grow: 2.2,
          intensity: 0.4,
          life: 0.6,
          size: 0.5,
          speed: 3,
        },
      },
      /** The white flash where a Wand leaves the hand (under Expelliarmus's own). */
      disarm: {
        arcs: { count: 0, life: 0 },
        flare: { intensity: 2, life: 0.2, size: 1.6 },
        light: { life: 0.35, peak: 70 },
        smoke: {
          count: 0,
          gravity: 0,
          grow: 1,
          intensity: 1,
          life: 1,
          size: 0.1,
          speed: 0,
        },
        splash: 0,
        streaks: {
          count: 6,
          intensity: 6,
          life: 0.35,
          size: 0.02,
          speed: 10,
          streak: 0.04,
        },
        wisps: {
          count: 2,
          gravity: 0,
          grow: 2.5,
          intensity: 1.2,
          life: 0.3,
          size: 0.3,
          speed: 0.6,
        },
      },
      /** Expelliarmus landing. */
      expelliarmus: {
        arcs: { count: 3, life: 0.3 },
        flare: { intensity: 2.8, life: 0.18, size: 1.8 },
        light: { life: 0.3, peak: 30 },
        smoke: {
          count: 0,
          gravity: 0,
          grow: 1,
          intensity: 1,
          life: 1,
          size: 0.1,
          speed: 0,
        },
        splash: 0.5,
        streaks: {
          count: 7,
          intensity: 5,
          life: 0.3,
          size: 0.02,
          speed: 13,
          streak: 0.045,
        },
        wisps: {
          count: 4,
          gravity: -0.1,
          grow: 2.2,
          intensity: 0.9,
          life: 0.32,
          size: 0.24,
          speed: 1.6,
        },
      },
      /** Stupefy landing. */
      hit: {
        arcs: { count: 3, life: 0.3 },
        flare: { intensity: 2.6, life: 0.16, size: 1.6 },
        light: { life: 0.3, peak: 40 },
        smoke: {
          count: 0,
          gravity: 0,
          grow: 1,
          intensity: 1,
          life: 1,
          size: 0.1,
          speed: 0,
        },
        splash: 0.6,
        streaks: {
          count: 6,
          intensity: 5,
          life: 0.3,
          size: 0.02,
          speed: 13,
          streak: 0.045,
        },
        wisps: {
          count: 4,
          gravity: -0.2,
          grow: 1.8,
          intensity: 0.9,
          life: 0.32,
          size: 0.24,
          speed: 1.6,
        },
      },
      /** Incendio's explosion: a fireball rolling up into smoke (its arcs on the body it struck). */
      incendio: {
        arcs: { count: 3, life: 0.35 },
        flare: { intensity: 1.3, life: 0.22, size: 3.2 },
        light: { life: 0.7, peak: 130 },
        smoke: {
          count: 10,
          gravity: -0.4,
          grow: 3,
          intensity: 1,
          life: 2.2,
          size: 0.9,
          speed: 1.8,
        },
        splash: 0,
        streaks: {
          count: 14,
          intensity: 5,
          life: 0.6,
          size: 0.032,
          speed: 13,
          streak: 0.045,
        },
        wisps: {
          count: 12,
          gravity: -0.6,
          grow: 2.4,
          intensity: 0.3,
          life: 0.75,
          size: 0.8,
          speed: 3.4,
        },
      },
      /** Petrificus Totalus landing: a cold flare and a puff of stone dust. */
      petrify: {
        arcs: { count: 4, life: 0.4 },
        flare: { intensity: 2.8, life: 0.22, size: 2 },
        light: { life: 0.4, peak: 60 },
        smoke: {
          count: 6,
          gravity: 0.15,
          grow: 2.5,
          intensity: 0.3,
          life: 1.1,
          size: 0.45,
          speed: 1.2,
        },
        splash: 0.3,
        streaks: {
          count: 6,
          intensity: 5,
          life: 0.35,
          size: 0.02,
          speed: 9,
          streak: 0.03,
        },
        wisps: {
          count: 4,
          gravity: 0,
          grow: 2,
          intensity: 0.8,
          life: 0.5,
          size: 0.3,
          speed: 1.2,
        },
      },
      /** The strong third Stupefy landing. */
      strongHit: {
        arcs: { count: 5, life: 0.38 },
        flare: { intensity: 3, life: 0.2, size: 2.3 },
        light: { life: 0.4, peak: 70 },
        smoke: {
          count: 0,
          gravity: 0,
          grow: 1,
          intensity: 1,
          life: 1,
          size: 0.1,
          speed: 0,
        },
        splash: 0.5,
        streaks: {
          count: 9,
          intensity: 5,
          life: 0.35,
          size: 0.022,
          speed: 15,
          streak: 0.045,
        },
        wisps: {
          count: 6,
          gravity: -0.2,
          grow: 2.4,
          intensity: 1,
          life: 0.4,
          size: 0.3,
          speed: 2,
        },
      },
    },
    /**
     * Incendio's explosion (its fireball and smoke are `impacts.incendio`): a
     * shockwave ring on the floor as wide as the gameplay blast (reaching it
     * over `ring.life`), and embers scattered over the blast that drift up
     * and die out.
     */
    incendio: {
      embers: { count: 40, life: 1.9, rise: 0.4, size: 0.05, speed: 0.7 },
      ring: { life: 0.4, radiance: 3.4 },
    },
    /** The pool of point lights that follow the brightest Spells and flashes, and how far a flash's light reaches. */
    lights: { flashDistance: 7, pool: 4 },
    /**
     * A Petrified Duelist sheds grit as the stone settles and glints cold:
     * `grit.rate` specks a second falling off the body and `glints.rate`
     * cold sparks a second, from `from` to `to` metres off the floor and
     * `spread` round the body.
     */
    petrified: {
      from: 0.3,
      glints: { intensity: 7, life: 0.3, rate: 7, size: 0.05 },
      grit: {
        color: "#a7adb8",
        gravity: 0.35,
        intensity: 1.2,
        life: 0.9,
        rate: 34,
        size: 0.05,
        speed: 0.25,
      },
      spread: 0.26,
      to: 1.7,
    },
    /** Smoke off fire: warm where the fire lights it at birth, cooling to soot. */
    smoke: { hot: "#6b5446", main: "#2b2724" },
    /**
     * The spark ring every effect draws its sparks from: slots (enough for
     * several big bursts and an Incendio at once), the drag that slows them
     * (per second) and the gravity that pulls them (metres per second squared).
     */
    sparks: { drag: 4, gravity: 6, slots: 4096 },
    /** The puff of stone dust as Petrificus Totalus lands, beside its cold flare. */
    stoneDust: { hot: "#f0f4ff", main: "#8f99ad" },
    /** Strong Stupefies are drawn this much bigger. */
    strongScale: 1.6,
    /** The Wand's own flare when a pickup lights it: a warm gold over the scarlet. */
    wand: { hot: "#fff4f6", main: "#ffb04a" },
    /**
     * The soft wisps of energy, fire, smoke and flame: a ring of `slots`
     * (twice: glowing and smoke), slowed by `drag` per second, pulled by
     * `gravity` (metres per second squared, times each wisp's own), curling
     * `swirl` metres at `swirlRate`; their edge eaten `churn` deep by noise
     * `churnScale` across a wisp drifting through it at `flow`; fading in
     * over `fadeIn` of their life; smoke at most `smokeOpacity` opaque.
     */
    wisps: {
      churn: 0.6,
      churnScale: 2.6,
      drag: 3,
      fadeIn: 0.12,
      flow: 2.5,
      gravity: 2,
      slots: 512,
      smokeOpacity: 0.5,
      swirl: 0.5,
      swirlRate: 3,
    },
  },

  /**
   * Each Spell's colours as hex: the main hue and its white-hot heart. The
   * VFX draw Spells in them (the DualSense lightbar has its own, in `haptics.lightbar`).
   */
  spellPalette: {
    /** Fire: a deep orange with a pale gold heart. */
    confringo: { hot: "#ffe2a0", main: "#ff6a12" },
    /** Depulso's wind: a pale, cool white. */
    depulso: { hot: "#ffffff", main: "#cfe6f5" },
    /** A scarlet disarming bolt round a white heart. */
    expelliarmus: { hot: "#fff4f6", main: "#ff1a3c" },
    /** A fireball: blood-orange flame round a pale yellow heart. */
    incendio: { hot: "#fff1b8", main: "#ff3d0a" },
    /** A cold, pale-blue binding light. */
    petrificus: { hot: "#eef4ff", main: "#5f8fff" },
    /** A red bolt with a white-hot heart. */
    stupefy: { hot: "#ffd2c4", main: "#ff2a1f" },
  },

  /**
   * The Special Spell bound to each Spell Slot (one per face button), or
   * null for an empty slot.
   */
  spellSlots: {
    circle: "expelliarmus",
    cross: "depulso",
    square: "petrificus",
    triangle: "incendio",
  },

  /** Stupefy, the Light Spell. Damage is in Health points. */
  stupefy: {
    /** Fast cadence: the shortest time between two casts. */
    castInterval: 0.25,
    /** Every `chainLength`-th consecutive cast is the strong one that Staggers. */
    chainLength: 3,
    /** Casts more than this far apart start a new chain. */
    chainWindow: 0.8,
    damage: 6,
    /** The projectile is a sphere of this radius for collisions. */
    radius: 0.18,
    speed: 26,
    /** How long the strong cast stops the Duelist it hits from acting. */
    staggerSeconds: 0.7,
    strongDamage: 14,
  },

  /** The Duel simulation advances on a fixed timestep at this rate (Hz). */
  tickRate: 60,

  /**
   * Training: seventeen lessons, each a Practice against the Training Dummy
   * that fits it and one goal after another on screen. Each goal's count is
   * met when the Duel has reported it this many times (or, for walking,
   * looking round and running, this many metres or degrees).
   */
  training: {
    goals: {
      /** Spells stopped on the Shield (L1). */
      block: 3,
      /** Clashes won by pumping △. */
      clash: 1,
      /** Confringos (△, Charged) that land. */
      confringo: 1,
      /** Depulsos that blast the dummy. */
      depulso: 1,
      /** Times Disarmed by the dummy's Expelliarmus. */
      disarmed: 1,
      /** Dodges (○). */
      dodge: 2,
      /** Expelliarmus that Disarm the dummy. */
      expelliarmus: 1,
      /** Felix Felicis drunk all the way down. */
      felix: 1,
      /** Whole Focus segments earned. */
      focusSegment: 1,
      /** Incendio blasts that leave the dummy Burning. */
      incendio: 1,
      /** Lock-on releases (R3). */
      lockOff: 1,
      /** Lock-ons (R3). */
      lockOn: 1,
      /** Degrees the camera turns with the right stick, either way. */
      look: 360,
      /** Parries (L1 just before a Spell lands). */
      parry: 1,
      /** Perfect Dodges. */
      perfectDodge: 1,
      /** Perfect Releases. */
      perfectRelease: 1,
      /** Petrificus Totalus that Petrify the dummy. */
      petrificus: 1,
      /** Wands picked up off the floor by walking over them. */
      pickup: 1,
      /** Metres run holding R1. */
      run: 8,
      /** Special Spells cast (R2 + a face button). */
      special: 1,
      /** Strength Potions drunk all the way down. */
      strength: 1,
      /** Spells that land while the Strength Potion works. */
      strongHit: 2,
      /** Stupefys (□) that land. */
      stupefy: 3,
      /** Metres moved, walking or running, while the Swiftness Potion works. */
      swiftRun: 15,
      /** Swiftness Potions drunk all the way down. */
      swiftness: 1,
      /** Metres walked with the left stick. */
      walk: 5,
      /** Wiggenweld drunk all the way down. */
      wiggenweld: 1,
    },
    /** How lessons set the learner up: Wiggenweld's lesson starts them on this share of full Health. */
    setup: { hurtHealthShare: 0.4 },
  },

  /**
   * Full Focus (Expelliarmus ready): the Wand in hand glows scarlet,
   * breathing `pulseSpeed` times a second between `low` and full
   * `radiance` (scene-linear HDR), easing in and out at `fadeSharpness` per second.
   */
  wandAura: {
    color: "#ff5a6e",
    fadeSharpness: 8,
    low: 0.45,
    pulseSpeed: 1.8,
    radiance: 3.2,
  },
} as const;

/** Literal numbers and strings widened, so a variant (a test's, or a future option's) can hold other values. */
type Widened<T> = T extends number
  ? number
  : T extends string
    ? string
    : { readonly [Key in keyof T]: Widened<T[Key]> };

export type Tuning = Widened<typeof tuning>;
