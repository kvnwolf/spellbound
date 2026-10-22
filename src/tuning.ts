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
    /**
     * The soft lock-on keeps the Target in frame, but the framing leans toward
     * the aim: the camera turns toward the aim by this share of the aim's angle
     * off the Target (the rest shows as the reticle moving across the screen).
     * 1 would pin the reticle to the screen centre, 0 is the old fixed camera.
     */
    aimFollow: {
      /** Sideways share of the aim's angle the framing follows. */
      horizontal: 0.6,
      /** Vertical share of the aim's angle the framing follows. */
      vertical: 0.5,
    },
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
    /** Distance behind the local Duelist, away from the Target. */
    distance: 4.6,
    /** Where the camera looks, from the Duelist (0) to the Target (1). */
    focusBias: 0.45,
    /** Exponential smoothing rate of the follow (higher is snappier), per second. */
    followSharpness: 7,
    fov: 55,
    height: 2.4,
    /**
     * When the camera has swung round to the side (pinned against a wall) the
     * look-at is turned toward the local Duelist as far as needed to keep them
     * inside this share of the horizontal half field of view (0 is dead
     * centre, 1 the edge of the screen). The Target may leave the frame then;
     * the local Duelist never does.
     */
    keepDuelistWithin: 0.65,
    /** The camera never swings round the Duelist faster than this (radians per second), even when the Target is circled at arm's length. */
    maxYawSpeed: 4,
    /** Sideways offset to the right of the Duelist: the over-the-shoulder view. */
    shoulder: 0.9,
  },

  /** Camera shake on Spell impacts, as trauma in [0, 1] added per hit (felt as trauma squared). */
  cameraShake: {
    /** Trauma lost per second. */
    decay: 1.8,
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

  /** Development aids, switched on from the URL (see `main.ts`). */
  debug: {
    /** With `?rival=casts`, the stationary opponent presses Stupefy this often. */
    rivalCastInterval: 0.6,
  },

  duelist: {
    /** A Duelist's body is a circle on the Arena floor for collision. */
    bodyRadius: 0.45,
    /** Height of the chest above the floor; the aim point sits there. */
    chestHeight: 1.3,
    health: 100,
    /** Spells hit a Duelist anywhere from the floor up to this height. */
    height: 2,
    walkSpeed: 4.5,
    /** Where Spells leave the Wand, relative to the Duelist: ahead, to the right and up. */
    wandTip: { forward: 0.55, height: 1.15, right: 0.28 },
  },

  hud: {
    /** How long "¡Duelo!" stays up once control is given. */
    duelCalloutSeconds: 0.9,
    /** The pale "damage taken" part of a Health bar lingers this long... */
    healthLagDelay: 0.35,
    /** ...then drains at this many Health points per second. */
    healthLagRate: 60,
  },

  input: {
    /**
     * How the right stick drives the aim offset. The raw stick is first shaped
     * by a response curve, then eased by a critically damped spring, so the
     * aim accelerates into a push and glides to rest on release.
     */
    aimResponse: {
      /**
       * Response curve: the stick deflection (0 to 1) is raised to this power.
       * 1 is linear; higher is finer near the centre and faster at full tilt
       * (2 gives a quarter of the aim at half tilt, all of it at full tilt).
       */
      curveExponent: 2,
      /**
       * Natural frequency of the spring that chases the shaped stick (rad/s).
       * Higher is snappier; around 28 settles in about 0.17 s, light enough
       * to feel alive but never a snap.
       */
      springFrequency: 28,
    },
    /** Stick deflection below this radius reads as centred. */
    stickDeadZone: 0.12,
    /** Trigger travel below this value reads as released. */
    triggerDeadZone: 0.04,
  },

  /**
   * The Knockout shot: the camera frames the fallen Duelist from the
   * winner's side, as if standing this far from them.
   */
  knockoutCamera: { standOff: 2.5 },

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
    /** Darkening of the frame's corners (0 none .. 1 strong). */
    vignette: 0.35,
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
} as const;

export type Tuning = typeof tuning;
