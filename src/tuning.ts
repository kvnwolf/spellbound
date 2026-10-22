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

  /** The Duel simulation advances on a fixed timestep at this rate (Hz). */
  tickRate: 60,
} as const;

export type Tuning = typeof tuning;
