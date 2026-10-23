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
   * How Depulso looks: a pale wave of wind and force filling its cone from
   * the Wand, its front racing out to the range over `seconds` and fading as
   * it goes, kicking up dust from the floor as it passes. The cone is as
   * wide as the gameplay one and `height` metres tall (half above, half
   * below the Wand) at its far end. Colours are hex; radiance is
   * scene-linear HDR (above the bloom threshold glows).
   */
  depulsoLook: {
    color: "#dcefff",
    /** Puffs of floor dust per metre the front travels, their size, life, drift speed and rise (negative gravity). */
    dust: {
      color: "#b9b2a4",
      intensity: 1.1,
      life: 0.9,
      perMetre: 14,
      rise: -0.15,
      size: 0.32,
      speed: 1.4,
    },
    /** How sharp the front's band is, as a share of the cone's length. */
    frontWidth: 0.14,
    height: 2.2,
    radiance: 1.5,
    seconds: 0.42,
    /** Wind streaks round the cone. */
    streaks: 11,
  },

  duelist: {
    /** A Duelist's body is a circle on the Arena floor for collision. */
    bodyRadius: 0.45,
    /** Height of the chest above the floor; the aim point sits there. */
    chestHeight: 1.3,
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
      /** Charging: `OverhandThrow` held at `chargeAt` seconds (the wind-up). A Clash: `Push_Loop` held at `clashAt`, the Wand trembling `tremble` metres `trembleRate` times a second. */
      chargeAt: 0.12,
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
       * higher still and the spine straightens `upright` radians (the run
       * clips crouch and stoop); the spine turns the chest back at most
       * `counterTwist` (all the way while the Wand is up) and the head looks
       * the rest, at most `headTurn` off the chest. There is no backwards
       * gait: `maxTwist` of π lets the legs run any way, turning as an angle.
       */
      gait: {
        bob: 0.3,
        cadence: {
          run: { base: 2.3, perSpeed: 0.12 },
          walk: { base: 1.3, perSpeed: 0.35 },
        },
        calm: 0.35,
        counterTwist: 0.45,
        crossovers: [
          [2.6, 3.4],
          [5.6, 6.8],
        ],
        gaitSharpness: 8,
        headTurn: 1.1,
        lift: 0.06,
        maxRaise: 0.12,
        maxTwist: Math.PI,
        minSpeed: 0.3,
        raisedTwist: 1.1,
        speedSharpness: 10,
        stride: [0.4, 1.3],
        twistSharpness: 10,
        upright: 0.28,
      },
      /** The head looks this share of the aim's pitch. */
      headPitch: 0.5,
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
      /** The Knockout: `Death01` held lying from `lieAt` seconds; getting up (`LayToIdle`) fades out over its last `riseFadeSeconds`. */
      knockout: { lieAt: 1.9, riseFadeSeconds: 0.35 },
      /**
       * The Dodge roll: `Roll` from `from` to `to` seconds of the clip over
       * the Dodge, then on at its own pace while it fades out over
       * `recoverSeconds`, the body turned toward the Dodge.
       */
      roll: { from: 0.1, recoverSeconds: 0.25, to: 0.95 },
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
        strike: { from: 0.27, peak: 0.15, seconds: 0.5, to: 0.75 },
      },
      /** The armed upper-body stance (`Spell_Simple_Idle_Loop`): its weight standing, and how much of it stays at a run. */
      stance: { moving: 0.35, standing: 1 },
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
    walkSpeed: 2.5,
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
     * `elbowHint`. Disarmed, the empty hand reaches `reach` metres toward
     * the loose Wand at `height`, grasping, turning back no further than
     * `behind` (the reach's share pointing ahead, -1 to 1). In a Clash the
     * free hand grips the Wand `clashGrip` metres behind the fist.
     */
    wand: {
      charge: [0.06, 0.62, 0.78],
      clashGrip: 0.11,
      disarmed: {
        behind: -0.3,
        grasp: 0.04,
        graspRate: 3.2,
        height: 1.12,
        reach: 0.5,
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
   * and the aim, not the body). Walking turns them toward where they walk,
   * at `moveTurnRate` radians per second, so running toward the camera shows
   * their face; standing still keeps the facing, so the camera can orbit
   * round them, Locked On or not.
   * Casting, Charging or raising the Shield turns them to the aim fast
   * enough to finish even a half turn within `aimTurnSeconds`; they keep
   * facing the aim while Charging or Shielding and for `aimHoldSeconds`
   * after a cast, so a burst of casts on the move never swings them about.
   */
  facing: { aimHoldSeconds: 0.5, aimTurnSeconds: 0.1, moveTurnRate: 12 },

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
      move: { left: 0, right: 0.28, seconds: 0.045 },
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
    homing: { seconds: 0.35, turnRate: 0.35 },
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
   * How a walking Duelist's velocity follows the stick: it closes
   * `acceleration` of the gap to the stick's velocity per second (an
   * exponential ease: about 95% in 3/acceleration seconds), `deceleration`
   * when slowing or turning back, so a body never starts, stops or reverses
   * in an instant.
   */
  movement: { acceleration: 9, deceleration: 12 },

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
   * rim of light round the silhouette. Colours are hex; radiance is
   * scene-linear HDR (above the bloom threshold glows).
   */
  petrifiedLook: {
    /** Exponential rate, per second, at which the stone spreads in and fades back out. */
    fadeSharpness: 14,
    rimColor: "#bcd4ff",
    /** Fresnel exponent of the rim: higher hugs the silhouette's edge more tightly. */
    rimPower: 2,
    rimRadiance: 1.3,
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
   * The Potion bound to each Potion Slot (one per face button), or null for
   * an empty slot.
   */
  potionSlots: {
    circle: "swiftness",
    cross: null,
    square: "wiggenweld",
    triangle: "strength",
  },

  /**
   * Potions, drunk from the Potion Slots (L2 held and a face button). Each
   * Round every Duelist starts with `charges` of each, spent as drinking
   * starts. Drinking takes `drink.seconds`, during which the drinker walks at
   * `drink.moveScale` of their speed and cannot cast, Shield, Charge, Dodge
   * or jump; any Spell landing on them (a direct hit, not a Burn) interrupts
   * it and the Potion is lost. A Disarmed Duelist can drink.
   */
  potions: {
    drink: { moveScale: 0.4, seconds: 1 },
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
    /** The rival's Health, once at zero, comes back full after this many seconds. */
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
    /** Radiance a blocked Spell adds over the whole dome, decaying with time constant `flareSeconds` (a Parry flares twice as bright). */
    flare: 2.4,
    flareSeconds: 0.3,
    parry: {
      color: "#fff1c2",
      /** The flash's sprite grows from `startSize` to `endSize` metres. */
      endSize: 3.4,
      /** Peak candela of the Parry's light, fading over `seconds`... */
      light: 90,
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
    /** The Duel's victory or defeat call-out plays this long before the result screen. */
    resultDelaySeconds: 3,
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
