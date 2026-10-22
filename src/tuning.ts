/**
 * Every tuning number in Spellbound lives here, so balancing never touches
 * logic. Distances are metres, times are seconds, speeds are metres per second.
 */
export const tuning = {
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

  camera: {
    /**
     * At full Charge the field of view widens by `degrees`, easing in and out
     * at `sharpness` (per second): a push that makes the held power felt.
     */
    chargePush: { degrees: 5, sharpness: 7 },
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
   * Confringo, the Heavy Spell, and its Charge. Holding the Heavy Spell
   * builds the Charge from 0 to full over `fullSeconds`; releasing casts
   * Confringo with damage and knockback scaled by the Charge (a tap still
   * casts a weak one). A full Charge is safe to hold until `safeSeconds`;
   * held past that it Overcharges and Backfires. Damage is in Health points.
   */
  confringo: {
    /** A Backfire casts nothing and Staggers the caster this long. */
    backfireStaggerSeconds: 1,
    /** Movement speed is multiplied by this while Charging: Charging is a commitment. */
    chargeMoveScale: 0.45,
    /** Damage at the smallest Charge (a tap) and at a full Charge. */
    damage: { full: 28, min: 10 },
    /** Seconds of holding to fill the Charge. */
    fullSeconds: 0.8,
    /**
     * A hit pushes the Duelist it lands on back along the Spell's flight by
     * this many metres (smallest Charge to full), sliding to a stop over
     * `seconds`, during which they cannot move or cast.
     */
    knockback: { full: 2.4, min: 0.6, seconds: 0.35 },
    /**
     * The Perfect Release window, right as the Charge fills: releasing from
     * `early` seconds before full until `late` seconds after it counts. It
     * casts a full Charge, empowered.
     */
    perfectRelease: { early: 0.05, late: 0.1 },
    /** A Perfect Release multiplies damage and knockback by this. */
    perfectScale: 1.35,
    /** The projectile is a sphere of this radius for collisions: a big, slow blast. */
    radius: 0.3,
    /** After a release, no Light Spell can follow for this long. */
    recoverySeconds: 0.35,
    /** A full Charge can be held this long from the press; one tick more Backfires. */
    safeSeconds: 1.5,
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

  /** Development aids, switched on from the URL (see `main.ts`). */
  debug: {
    /** With `?rival=casts`, the stationary opponent presses Stupefy this often. */
    rivalCastInterval: 0.6,
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
      /** Downward acceleration while airborne, m/s². */
      gravity: 18,
      /**
       * Upward launch speed, m/s. With `gravity` the feet clear about 1.8 m
       * at the apex, about 0.9 s in the air: high enough to let a chest-high
       * bolt pass under, if timed.
       */
      speed: 8,
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
      drain: 20,
      /** Running speed, as a multiple of the walking speed. */
      speedScale: 1.6,
    },
    stamina: {
      max: 100,
      /** Stamina only starts regenerating this long after it was last spent. */
      regenDelay: 0.6,
      /** Points regained per second once regenerating. */
      regenRate: 32,
    },
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

  /**
   * DualSense haptics. Rumble pulses start at these motor strengths (0 to 1;
   * the left motor is the heavy one, the right the light one) and fade out
   * over `seconds`. Colours are 0-255 RGB for the lightbar.
   */
  haptics: {
    /** A short, light tick on every cast. */
    cast: { left: 0.08, right: 0.45, seconds: 0.08 },
    /**
     * Gamepad API dual-rumble, used only without WebHID: it is replayed this
     * often while the rumble changes, each play lasting `effectSeconds`.
     */
    fallback: { effectSeconds: 0.12, resendSeconds: 0.05 },
    /** A heavy thump when the local Duelist is hit. */
    hitTaken: { left: 0.7, right: 0.5, seconds: 0.25 },
    lightbar: {
      /** The local Duelist's crimson, as their robe. */
      base: { b: 36, g: 28, r: 138 },
      /** A hit taken flashes a hot white-gold... */
      flash: { b: 180, g: 230, r: 255 },
      /** ...fading back to the base over this long. */
      flashSeconds: 0.35,
    },
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
      warnPulse: { from: 2.5, to: 12 },
    },
    /** How long "¡Duelo!" stays up once control is given. */
    duelCalloutSeconds: 0.9,
    /** The pale "damage taken" part of a Health bar lingers this long... */
    healthLagDelay: 0.35,
    /** ...then drains at this many Health points per second. */
    healthLagRate: 60,
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
    /**
     * How the right stick turns the camera. The deflection is shaped by a
     * response curve, eased by a critically damped spring (light smoothing and
     * a touch of acceleration), then scaled to turn rates. Up looks up.
     */
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

/** Literal numbers and strings widened, so a variant (a test's, or a future option's) can hold other values. */
type Widened<T> = T extends number
  ? number
  : T extends string
    ? string
    : { readonly [Key in keyof T]: Widened<T[Key]> };

export type Tuning = Widened<typeof tuning>;
