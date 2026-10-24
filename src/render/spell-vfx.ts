/**
 * Spell VFX: how each Spell looks in flight and where it lands, plus the
 * crackle at a Charging Wand and what clings to a Burning or Petrified
 * Duelist. Views only: it reads Spells from snapshots and reacts to
 * simulation events. Every number is in `tuning.spellLook` (Depulso's in
 * `tuning.depulsoLook`).
 *
 * - In flight, every Spell is a jet of light from the Wand to its head, as
 *   the films draw it (`jet.ts`): a white-hot core in a churning halo of its
 *   hue, turned to the camera, with a glow round the head and the Spell's
 *   light on the floor. Each has its own character: Stupefy a red bolt with
 *   twisting filaments, Confringo a thick orange jet of churning flame with
 *   a burning fireball for a head, Incendio a gout of fire widening from the
 *   Wand, Petrificus Totalus a crisp, cold blue-white line, Expelliarmus a
 *   scarlet jet round a white heart. Each sheds a light wake of sparks (fire
 *   rises off the flames, cold motes hang behind Petrificus), spent by
 *   distance flown, so it is the same at any frame rate.
 * - Where a Spell lands on a Duelist, its energy hits the body
 *   (`impact-vfx.ts`): a flare of light rays at the contact point, a few soft
 *   wisps of energy swelling and fading, a few long thin streaks, short
 *   electric arcs crawling over the body between its joints, and a pulse of
 *   the Spell's light on the surroundings; the body's silhouette flares in
 *   the Spell's colour (the Duelist view's). Confringo bursts into fire and
 *   smoke; Incendio explodes into a fireball, a shockwave ring on the floor
 *   as wide as the gameplay blast and embers, and sets the Duelist ablaze:
 *   tongues of flame rise off the body for the whole Burn, with a flickering
 *   warm light (the robe's embers are the view's). Petrificus Totalus lands
 *   in a cold flare and a puff of stone dust (the spreading stone is the
 *   view's), and a Petrified Duelist sheds grit and cold glints. A Disarm
 *   flashes white and scarlet where the Wand leaves the hand.
 * - Casts flare at the Wand tip, the jet starting there on the Spell's first
 *   frame. Mid-air cancels, Spells stopped by Cover or a Shield, Perfect
 *   Releases, Backfires and Wands returning burst in the shared spark ring
 *   (`spark-ring.ts`): a still flash, a shock ring and streaking sparks.
 * - A Charging Wand sheds streaking sparks at a rate that rises with the
 *   Charge, and crackles hotter and wilder as Overcharge nears.
 * - A small fixed pool of point lights follows the brightest Spells, flashes,
 *   Charging Wands and Burns, so the count of lights (and so the shaders)
 *   never changes.
 *
 * Colours are scene-linear HDR above 1, so they feed bloom; intensities are
 * kept low enough that each Spell's hue survives it instead of blowing out
 * to white.
 */
import {
  float,
  length,
  mix,
  mx_noise_float,
  smoothstep,
  uniform,
  uv,
  vec3,
  vec4,
} from "three/tsl";
import type { Object3D } from "three/webgpu";
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  PointLight,
  RingGeometry,
  SphereGeometry,
  Sprite,
  SpriteNodeMaterial,
  Vector3,
} from "three/webgpu";

import { between } from "../controllers/random";
import type {
  DuelEvent,
  DuelistId,
  ProjectileKind,
  SpellKind,
  SpellState,
} from "../duel/duel";
import type { Point3 } from "../duel/geometry";
import type { Tuning } from "../tuning";
import { createDepulsoWaves } from "./depulso-vfx";
import { createImpactVfx } from "./impact-vfx";
import { sampleSpell } from "./interpolate";
import { createJetKind, layRibbon } from "./jet";
import type { JetKind } from "./jet";
import { createSparkRing, seededRandom } from "./spark-ring";
import type { SparkRing, SparkStyle } from "./spark-ring";

/** A Wand that is Charging this frame, as the views see it. */
export interface ChargingWand {
  /** Where the Spell will leave the Wand. */
  readonly tip: Point3;
  /** How full the Charge is, 0 to 1. */
  readonly level: number;
  /** How close a held full Charge is to Backfiring, 0 to 1. */
  readonly overcharge: number;
}

/** A Duelist something clings to: who, and where they stand (their feet). */
export interface AfflictedDuelist {
  readonly id: DuelistId;
  readonly feet: Point3;
}

/** Duelists something clings to this frame. */
export interface AfflictedDuelists {
  /** Every Charging Wand, for its crackle. */
  readonly charging?: readonly ChargingWand[];
  /** Duelists with an Incendio Burn, shedding flames and embers. */
  readonly burning?: readonly AfflictedDuelist[];
  /** Petrified Duelists, shedding grit and cold glints. */
  readonly petrified?: readonly AfflictedDuelist[];
  /**
   * A Duelist's joints as last drawn (`BODY_JOINTS` of them, in the order
   * `impact-vfx.ts` lists), for the arcs and flames on the body.
   */
  readonly bodyOf?: (id: DuelistId) => readonly Point3[] | undefined;
}

export interface SpellVfx {
  readonly object: Group;
  /** The spark ring every effect sprays into (the Clash's too). */
  readonly sparks: SparkRing;
  /** The camera jets of light and arcs turn to face. */
  readonly watchFrom: (camera: Object3D) => void;
  /** Starts bursts and flashes for this frame's simulation events. */
  readonly handle: (events: readonly DuelEvent[]) => void;
  /**
   * Draws the Spells in flight between two snapshots, the crackle of every
   * Charging Wand and what clings to Burning and Petrified Duelists, and
   * ages effects by `seconds` of simulation time (so they slow down with
   * the slow motion).
   */
  readonly update: (
    previous: readonly SpellState[],
    current: readonly SpellState[],
    alpha: number,
    seconds: number,
    afflicted?: AfflictedDuelists
  ) => void;
}

/** A Spell's colours: the main hue and its white-hot heart. */
interface Palette {
  readonly main: Color;
  readonly hot: Color;
}

const paletteFrom = (hex: { readonly hot: string; readonly main: string }) => ({
  hot: new Color(hex.hot),
  main: new Color(hex.main),
});

type SpellLook = Tuning["spellLook"];

type BoltLook = SpellLook["bolts"][ProjectileKind];

type BurstStyle = SpellLook["bursts"]["stop"];

type ImpactStyle = SpellLook["impacts"]["hit"];

/** The flight direction a burst splashes along, when it has one. */
type Splash = Point3 | undefined;

const unit = (vector: Point3): Point3 => {
  const size = Math.hypot(vector.x, vector.y, vector.z) || 1;

  return { x: vector.x / size, y: vector.y / size, z: vector.z / size };
};

/** The way a Spell is flying, as a unit vector. */
const flightOf = (spell: SpellState) => unit(spell.velocity);

/**
 * One Spell kind's materials: the white-hot core, the glow round the head
 * (a burning fireball when its `flame` is above 0: noise licks its edge
 * outward and it cools from white through the hue) and the jet.
 */
const createBoltKind = (palette: Palette, look: BoltLook) => {
  const { hot, main } = palette;
  const core = new MeshBasicNodeMaterial();
  core.colorNode = vec3(hot.r, hot.g, hot.b).mul(look.core.intensity);

  const time = uniform(0);

  const glow = new SpriteNodeMaterial({
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });

  const centred = uv().sub(0.5).mul(2);

  const licks = mx_noise_float(
    vec3(centred.mul(look.glow.flameScale), time.mul(look.glow.flameSpeed)).sub(
      vec3(0, 0, length(centred).mul(2))
    )
  );

  const reach = length(centred).mul(
    float(1).add(licks.mul(look.glow.flame * 0.6))
  );

  glow.colorNode = vec4(
    mix(
      vec3(main.r, main.g, main.b),
      vec3(hot.r, hot.g, hot.b),
      smoothstep(0.6, 0, reach).mul(look.glow.flame)
    ).mul(look.glow.intensity),
    1
  );
  glow.opacityNode = smoothstep(1, 0, reach).pow(2.5);

  return {
    core,
    glow,
    jet: createJetKind(palette, look.jet),
    tick: (clock: number) => {
      time.value = clock;
    },
  };
};

type BoltKind = ReturnType<typeof createBoltKind>;

/** A Spell in flight: core, glow and jet, reused across Spells of one kind. */
const createBolt = (kind: BoltKind, look: BoltLook) => {
  const group = new Group();

  const core = new Mesh(
    new SphereGeometry(look.core.radius, 16, 12),
    kind.core
  );

  const glow = new Sprite(kind.glow);
  glow.scale.setScalar(look.glow.size);
  const jet = kind.jet.create();
  group.add(jet, core, glow);

  return { core, glow, group, jet };
};

type Bolt = ReturnType<typeof createBolt>;

interface Flash {
  readonly position: Vector3;
  readonly peak: number;
  readonly life: number;
  readonly color: Color;
  age: number;
}

/** A light request this frame: the pool lights the brightest. */
interface Glow {
  readonly position: Vector3;
  readonly intensity: number;
  readonly color: Color;
  /** How far the light reaches, metres. */
  readonly distance: number;
}

/** One kind's pool of bolts, grown on demand and reused frame to frame. */
const createBoltPool = (look: BoltLook, palette: Palette, parent: Group) => {
  const kind = createBoltKind(palette, look);
  // One bolt exists (hidden) from the start, so the load-time prewarm
  // compiles this kind's shaders before its first cast; the rest share them.
  const first = createBolt(kind, look);
  first.group.visible = false;
  parent.add(first.group);
  const bolts: Bolt[] = [first];
  let used = 0;

  return {
    /** Starts a frame: every bolt is free again. */
    begin: (clock: number) => {
      used = 0;
      kind.tick(clock);
      kind.jet.tick(clock);
    },
    /** Hides the bolts nobody took this frame. */
    end: () => {
      for (const bolt of bolts.slice(used)) {
        bolt.group.visible = false;
      }
    },
    jet: kind.jet,
    look,
    palette,
    take: (): Bolt => {
      let bolt = bolts[used];

      if (!bolt) {
        bolt = createBolt(kind, look);
        bolts.push(bolt);
        parent.add(bolt.group);
      }

      used += 1;
      bolt.group.visible = true;

      return bolt;
    },
  };
};

/** The glow sprites at Charging Wands, a few reused. */
const createTipGlows = (parent: Group, palette: Palette) => {
  const { hot, main } = palette;

  const material = new SpriteNodeMaterial({
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });

  const fromCentre = length(uv().sub(0.5)).mul(2);
  material.colorNode = vec4(
    vec3(main.r, main.g, main.b)
      .mul(2)
      .add(vec3(hot.r, hot.g, hot.b)),
    1
  );
  material.opacityNode = smoothstep(1, 0, fromCentre).pow(2);

  // One glow exists (hidden) from the start, for the load-time prewarm.
  const first = new Sprite(material);
  first.visible = false;
  parent.add(first);
  const sprites: Sprite[] = [first];

  return {
    hideFrom: (index: number) => {
      for (const sprite of sprites.slice(index)) {
        sprite.visible = false;
      }
    },
    show: (index: number, tip: Point3, size: number) => {
      let sprite = sprites[index];

      if (!sprite) {
        sprite = new Sprite(material);
        sprites.push(sprite);
        parent.add(sprite);
      }

      sprite.visible = true;
      sprite.position.set(tip.x, tip.y, tip.z);
      sprite.scale.setScalar(size);
    },
  };
};

/**
 * Incendio's shockwave: a flat ring that races out across the blast and
 * fades, a few reused. Each ring has its own strength uniform, so they fade
 * independently in one shader.
 */
const createShockwaves = (
  parent: Group,
  blastRadius: number,
  palette: Palette,
  ring: SpellLook["incendio"]["ring"]
) => {
  const { main, hot } = palette;
  const geometry = new RingGeometry(ring.inner, 1, 64);
  // Flat on the floor.
  geometry.rotateX(-Math.PI / 2);

  const rings = Array.from({ length: ring.pool }, () => {
    const strength = uniform(0);

    const material = new MeshBasicNodeMaterial({
      blending: AdditiveBlending,
      depthWrite: false,
      // Additive, so drawing the back faces then the front ones (three.js's
      // default for double-sided transparency) adds up to the same as one
      // pass; one pass also compiles ahead with the rest (see prewarm.ts).
      forceSinglePass: true,
      side: DoubleSide,
      transparent: true,
    });

    // Hot on its leading edge, the flame's hue trailing inside it.
    const edge = uv().y;
    material.colorNode = mix(
      vec3(main.r, main.g, main.b).mul(2),
      vec3(hot.r, hot.g, hot.b).mul(2.5),
      edge.pow(3)
    ).mul(strength.mul(ring.radiance));

    const mesh = new Mesh(geometry, material);
    mesh.visible = false;
    parent.add(mesh);

    return { age: ring.life, mesh, strength };
  });

  let next = 0;

  return {
    advance: (seconds: number) => {
      for (const each of rings) {
        each.age += seconds;
        const t = Math.min(each.age / ring.life, 1);
        each.mesh.visible = t < 1;
        // Fast out, easing to the blast's edge, fading as it goes.
        each.mesh.scale.setScalar(blastRadius * (1 - (1 - t) ** 3));
        each.strength.value = (1 - t) ** 2;
      }
    },
    start: (at: Point3) => {
      const each = rings[next];
      next = (next + 1) % rings.length;

      if (each) {
        each.age = 0;
        // On the floor under the blast, wherever it went off, so it marks
        // the ground the blast reaches; just off it, so it never z-fights.
        each.mesh.position.set(at.x, ring.lift, at.z);
      }
    },
  };
};

/** How the Spell VFX is set up: the blast radius comes from the simulation's tuning, so the shockwave shows its true reach. */
export interface SpellVfxSettings {
  readonly blastRadius: number;
  /** Depulso's cone, as the simulation has it, and how its blast looks. */
  readonly depulso: Pick<Tuning["depulso"], "coneDegrees" | "range">;
  readonly depulsoLook: Tuning["depulsoLook"];
  readonly look: SpellLook;
  /** Each Spell's colours, as the DualSense lightbar shares them. */
  readonly palette: Tuning["spellPalette"];
}

export const createSpellVfx = (settings: SpellVfxSettings): SpellVfx => {
  const { look } = settings;
  const object = new Group();
  const sparks = createSparkRing(look.sparks);
  const impacts = createImpactVfx(look);
  const random = seededRandom(11);

  const palettes: Record<SpellKind, Palette> = {
    confringo: paletteFrom(settings.palette.confringo),
    depulso: paletteFrom(settings.palette.depulso),
    expelliarmus: paletteFrom(settings.palette.expelliarmus),
    incendio: paletteFrom(settings.palette.incendio),
    petrificus: paletteFrom(settings.palette.petrificus),
    stupefy: paletteFrom(settings.palette.stupefy),
  };

  const backfirePalette = paletteFrom(look.backfire);
  const wandPalette = paletteFrom(look.wand);
  const stoneDust = paletteFrom(look.stoneDust);
  const smokePalette = paletteFrom(look.smoke);
  const whitePalette = paletteFrom(look.disarmFlash);
  const gritColor = new Color(look.petrified.grit.color);

  const shockwaves = createShockwaves(
    object,
    settings.blastRadius,
    palettes.incendio,
    look.incendio.ring
  );

  // Depulso's blast, its streaks and dust in the shared spark ring.
  const waves = createDepulsoWaves(object, {
    cone: settings.depulso,
    look: settings.depulsoLook,
    palette: palettes.depulso,
    random: seededRandom(23),
    sparks,
  });

  const pools: Record<ProjectileKind, ReturnType<typeof createBoltPool>> = {
    confringo: createBoltPool(look.bolts.confringo, palettes.confringo, object),
    expelliarmus: createBoltPool(
      look.bolts.expelliarmus,
      palettes.expelliarmus,
      object
    ),
    incendio: createBoltPool(look.bolts.incendio, palettes.incendio, object),
    petrificus: createBoltPool(
      look.bolts.petrificus,
      palettes.petrificus,
      object
    ),
    stupefy: createBoltPool(look.bolts.stupefy, palettes.stupefy, object),
  };

  const tipGlows = createTipGlows(object, palettes.confringo);
  /** Where each Spell left the Wand, for its jet. */
  const castPoints = new Map<number, Point3>();
  /** Where each Spell last shed its wake, and the sparks it still owes. */
  const wakes = new Map<number, { at: Point3; owed: number }>();
  const flashes: Flash[] = [];
  // Sparks owed to each Charging Wand: fractional counts carried frame to frame.
  let owed: number[] = [];
  // Embers and flames owed to each Burning Duelist, likewise.
  let smouldering: { embers: number; flames: number }[] = [];
  // Grit and glints owed to each Petrified Duelist, likewise.
  let settling: { glints: number; grit: number }[] = [];
  // Drives the flickers.
  let clock = 0;
  // The Duelists' joints as the last frame drew them, for where Spells land.
  let bodies: AfflictedDuelists["bodyOf"];

  const lights = Array.from({ length: look.lights.pool }, () => {
    const light = new PointLight(
      palettes.stupefy.main,
      0,
      look.lights.flashDistance,
      2
    );

    object.add(light);

    return light;
  });

  object.add(sparks.sprite, impacts.object);

  let viewer: Object3D | undefined;
  const eye = new Vector3();
  const jetTail = new Vector3();

  /** Lays a Spell's jet from its tail to its head, turned to face the camera. */
  const layJet = (
    bolt: Bolt,
    jet: JetKind,
    head: Vector3,
    flown: number,
    spell: SpellState,
    scale: number
  ) => {
    const { look: jetLook } = jet;
    const reach = Math.max(Math.min(jetLook.length * scale, flown), 1e-3);
    const state = jet.state(bolt.jet);

    jetTail
      .set(spell.velocity.x, spell.velocity.y, spell.velocity.z)
      .normalize()
      .multiplyScalar(-reach)
      .add(head);

    layRibbon(bolt.jet, jetTail, head, jetLook.width * scale, eye);

    if (state) {
      state.metres = reach;
      state.seed = spell.id * look.jetSeedPerId;
    }
  };

  /** How big a Spell is drawn: strong Stupefies and Charged Confringos are bigger. */
  const sizeOf = (spell: SpellState) => {
    if (spell.kind === "stupefy") {
      return spell.strong ? look.strongScale : 1;
    }

    if (spell.kind !== "confringo") {
      return 1;
    }

    const { empoweredScale, tapScale } = look.confringo;
    const charged = tapScale + (1 - tapScale) * spell.charge;

    return spell.empowered ? charged * empoweredScale : charged;
  };

  const lightUp = (
    position: Point3,
    color: Color,
    peak: number,
    life: number
  ) => {
    flashes.push({
      age: 0,
      color,
      life,
      peak,
      position: new Vector3(position.x, position.y, position.z),
    });
  };

  /**
   * A burst in the spark ring: a still flash, a ring swelling out of it, and
   * sparks streaking out (leaning along `along`, the Spell's flight, by the
   * style's splash), with a flash of light.
   */
  const burst = (
    position: Point3,
    style: BurstStyle,
    palette: Palette,
    scale = 1,
    along?: Splash
  ) => {
    sparks.emit(position, palette.hot, {
      intensity: look.burstRadiance.flash,
      life: style.flashLife,
      size: style.flashSize * scale,
      speed: 0,
    });

    if (style.ring > 0) {
      sparks.emit(position, palette.main, {
        intensity: look.burstRadiance.ring,
        life: style.ringLife,
        ring: true,
        size: style.ring * scale,
        speed: 0,
      });
    }

    const heading =
      along && style.splash !== 0
        ? {
            x: along.x * style.splash,
            y: along.y * style.splash,
            z: along.z * style.splash,
          }
        : undefined;

    const spark: SparkStyle = {
      heading,
      intensity: look.burstRadiance.sparks,
      life: style.life,
      size: style.size * scale,
      speed: style.speed * scale,
      streak: style.streak,
    };

    for (let index = 0; index < Math.round(style.sparks * scale); index += 1) {
      sparks.emit(
        position,
        index % 3 === 0 ? palette.hot : palette.main,
        spark
      );
    }

    lightUp(position, palette.main, style.light * scale, style.lightLife);
  };

  /**
   * A Spell's energy landing, as the films draw it: a flare of rays, a few
   * soft wisps swelling and fading (and smoke, for fire), a few long thin
   * streaks, arcs crawling over `body` when it hit one, and a pulse of its
   * light on the surroundings.
   */
  const impact = (
    at: Point3,
    style: ImpactStyle,
    palette: Palette,
    options: {
      readonly along?: Splash;
      readonly body?: DuelistId;
      readonly scale?: number;
      readonly smoke?: Palette;
    } = {}
  ) => {
    const { along, body, scale = 1, smoke = smokePalette } = options;

    const lean =
      along && style.splash !== 0
        ? {
            x: along.x * style.splash,
            y: along.y * style.splash,
            z: along.z * style.splash,
          }
        : undefined;

    impacts.flare(at, palette, {
      intensity: style.flare.intensity,
      life: style.flare.life,
      size: style.flare.size * scale,
    });

    const { wisps, streaks } = style;
    const jitter = look.impactJitter;

    for (let index = 0; index < Math.round(wisps.count * scale); index += 1) {
      impacts.wisp(at, palette, {
        gravity: wisps.gravity,
        grow: wisps.grow,
        heading: lean,
        intensity: wisps.intensity,
        life: wisps.life * between(random, jitter.life),
        size: wisps.size * scale * between(random, jitter.size),
        speed: wisps.speed * scale,
      });
    }

    for (
      let index = 0;
      index < Math.round(style.smoke.count * scale);
      index += 1
    ) {
      impacts.wisp(
        at,
        smoke,
        {
          gravity: style.smoke.gravity,
          grow: style.smoke.grow,
          heading: lean && {
            x: lean.x * jitter.smokeLean,
            y: jitter.smokeRise,
            z: lean.z * jitter.smokeLean,
          },
          intensity: style.smoke.intensity,
          life: style.smoke.life * between(random, jitter.life),
          size: style.smoke.size * scale * between(random, jitter.size),
          speed: style.smoke.speed * scale,
        },
        true
      );
    }

    for (let index = 0; index < Math.round(streaks.count * scale); index += 1) {
      sparks.emit(at, index % 2 === 0 ? palette.hot : palette.main, {
        heading: lean,
        intensity: streaks.intensity,
        life: streaks.life * between(random, jitter.life),
        size: streaks.size,
        speed: streaks.speed * scale * between(random, jitter.speed),
        streak: streaks.streak,
      });
    }

    if (body !== undefined && style.arcs.count > 0) {
      impacts.arcs(body, palette, style.arcs.count, style.arcs.life);
    }

    lightUp(at, palette.main, style.light.peak * scale, style.light.life);
  };

  /** A point scattered uniformly over a disc of `radius` round `centre`, at height `y`. */
  const scatter = (centre: Point3, radius: number, y: number): Point3 => {
    const angle = random() * Math.PI * 2;
    const reach = Math.sqrt(random()) * radius;

    return {
      x: centre.x + Math.cos(angle) * reach,
      y,
      z: centre.z + Math.sin(angle) * reach,
    };
  };

  /** Incendio's explosion: the fireball and smoke, the shockwave and the embers it leaves. */
  const explode = (at: Point3, body?: DuelistId) => {
    const { hot, main } = palettes.incendio;
    const { embers } = look.incendio;
    impact(at, look.impacts.incendio, palettes.incendio, { body });
    shockwaves.start(at);

    // Embers over the scorched floor of the blast, drifting up on the heat.
    for (let ember = 0; ember < embers.count; ember += 1) {
      sparks.emit(
        scatter(at, settings.blastRadius, random() * embers.height),
        ember % 3 === 0 ? hot : main,
        {
          gravity: -embers.rise,
          intensity: embers.intensity,
          life: embers.life * between(random, embers.lifeShare),
          size: embers.size,
          speed: embers.speed,
        }
      );
    }
  };

  /**
   * A point on the skin of a standing body: about `spread` out from its axis
   * (outside the body, so the depth test never hides it inside), between
   * two heights.
   */
  const roundBody = (
    feet: Point3,
    spread: number,
    from: number,
    to: number
  ): Point3 => {
    const angle = random() * Math.PI * 2;
    const reach = spread * (0.85 + random() * 0.3);

    return {
      x: feet.x + Math.cos(angle) * reach,
      y: feet.y + from + random() * (to - from),
      z: feet.z + Math.sin(angle) * reach,
    };
  };

  /** A point near one of the body's joints, or round the body when they are unknown. */
  const onBody = (
    feet: Point3,
    joints: readonly Point3[] | undefined,
    spread: number,
    from: number,
    to: number
  ): Point3 => {
    const joint = joints?.[Math.floor(random() * joints.length)];

    if (!joint) {
      return roundBody(feet, spread, from, to);
    }

    const angle = random() * Math.PI * 2;
    const reach = spread * random();

    return {
      x: joint.x + Math.cos(angle) * reach,
      y: joint.y + (random() - 0.5) * spread,
      z: joint.z + Math.sin(angle) * reach,
    };
  };

  /** Flames and embers on every Burning Duelist; returns their light requests. */
  const smoulder = (
    burning: readonly AfflictedDuelist[],
    seconds: number,
    bodyOf: AfflictedDuelists["bodyOf"]
  ): Glow[] => {
    const { hot, main } = palettes.incendio;
    const { burn } = look;

    smouldering = burning.map(
      (_, index) => smouldering[index] ?? { embers: 0, flames: 0 }
    );

    return burning.map(({ feet, id }, index) => {
      const debt = smouldering[index] ?? { embers: 0, flames: 0 };
      const joints = bodyOf?.(id);
      debt.embers += burn.embers.rate * seconds;
      debt.flames += burn.flames.rate * seconds;

      for (let ember = 0; debt.embers >= 1; ember += 1, debt.embers -= 1) {
        sparks.emit(
          roundBody(feet, burn.spread, burn.from, burn.to),
          ember % 3 === 0 ? hot : main,
          {
            gravity: -burn.embers.rise,
            intensity: 5,
            life: burn.embers.life,
            size: burn.embers.size,
            speed: burn.embers.speed,
          }
        );
      }

      // Tongues of flame rising off the body, from its joints.
      for (; debt.flames >= 1; debt.flames -= 1) {
        const { flames } = burn;
        impacts.wisp(
          onBody(feet, joints, burn.spread, burn.from, burn.to),
          palettes.incendio,
          {
            gravity: flames.gravity,
            grow: flames.grow,
            heading: { x: 0, y: 1, z: 0 },
            intensity: flames.intensity,
            life: flames.life * (0.6 + random() * 0.4),
            size: flames.size * (0.6 + random() * 0.6),
            speed: flames.speed,
            spread: 0.35,
            stretch: flames.stretch,
          }
        );
      }

      return {
        color: main,
        distance: look.lights.flashDistance,
        // A flickering glow from the flames licking the body.
        intensity:
          burn.light *
          (0.7 +
            0.2 * Math.sin(clock * 23 + index) +
            0.1 * Math.sin(clock * 41)),
        position: new Vector3(feet.x, feet.y + 1, feet.z),
      };
    });
  };

  /** Grit falling off every Petrified Duelist, and cold glints on the stone. */
  const settle = (petrified: readonly AfflictedDuelist[], seconds: number) => {
    const { glints, grit, spread, from, to } = look.petrified;

    settling = petrified.map(
      (_, index) => settling[index] ?? { glints: 0, grit: 0 }
    );

    for (const [index, { feet }] of petrified.entries()) {
      const debt = settling[index] ?? { glints: 0, grit: 0 };
      debt.grit += grit.rate * seconds;
      debt.glints += glints.rate * seconds;

      for (; debt.grit >= 1; debt.grit -= 1) {
        sparks.emit(roundBody(feet, spread, from, to), gritColor, {
          gravity: grit.gravity,
          intensity: grit.intensity,
          life: grit.life,
          size: grit.size,
          speed: grit.speed,
        });
      }

      for (; debt.glints >= 1; debt.glints -= 1) {
        sparks.emit(
          roundBody(feet, spread * 0.8, from, to),
          palettes.petrificus.hot,
          {
            gravity: 0,
            intensity: glints.intensity,
            life: glints.life,
            size: glints.size,
            speed: 0,
          }
        );
      }
    }
  };

  /**
   * The Clash's bursts: two Confringos slamming together, every pump at the
   * meeting point, and the blast when nobody wins it. The beam itself is
   * the Clash VFX's.
   */
  const clashBurst = (event: DuelEvent) => {
    if (event.type === "clash-start" || event.type === "clash-pump") {
      burst(
        event.clash.point,
        event.type === "clash-start"
          ? look.bursts.confringoStop
          : look.bursts.perfect,
        palettes.confringo
      );
    } else if (event.type === "clash-end" && event.outcome === "exploded") {
      explode(event.position);
    }
  };

  /**
   * Where a Spell meets the body it hit: the simulation reports where the
   * Spell was as it touched the body's reach, so the energy lands on the
   * nearest joint's surface instead, at most `look.contact` off it.
   */
  const onContact = (at: Point3, body: DuelistId): Point3 => {
    const joints = bodies?.(body);
    let nearest: Point3 | undefined;
    let best = Number.POSITIVE_INFINITY;

    for (const joint of joints ?? []) {
      const gap = Math.hypot(at.x - joint.x, at.y - joint.y, at.z - joint.z);

      if (gap < best) {
        best = gap;
        nearest = joint;
      }
    }

    if (!nearest || best <= look.contact) {
      return at;
    }

    const share = look.contact / best;

    return {
      x: nearest.x + (at.x - nearest.x) * share,
      y: nearest.y + (at.y - nearest.y) * share,
      z: nearest.z + (at.z - nearest.z) * share,
    };
  };

  /** A Spell landing on a Duelist: its energy hitting the body. */
  const hitBurst = (hit: Extract<DuelEvent, { type: "spell-hit" }>) => {
    const { spell } = hit;
    const along = flightOf(spell);
    const body = hit.targetId;
    const event = { position: onContact(hit.position, body) };

    if (spell.kind === "confringo") {
      // A burst of fire and smoke, scaled with its Charge.
      impact(event.position, look.impacts.confringo, palettes.confringo, {
        along,
        body,
        scale: sizeOf(spell),
      });
    } else if (spell.kind === "petrificus") {
      // A cold flare and a puff of stone dust as the stone takes the body.
      impact(event.position, look.impacts.petrify, palettes.petrificus, {
        along,
        body,
        smoke: stoneDust,
      });
    } else if (spell.kind === "expelliarmus") {
      impact(event.position, look.impacts.expelliarmus, palettes.expelliarmus, {
        along,
        body,
      });
    } else if (spell.kind === "depulso") {
      // The blast's force bursting off the body, away from the caster.
      burst(
        event.position,
        settings.depulsoLook.impact,
        palettes.depulso,
        1,
        along
      );
    } else if (spell.kind === "stupefy") {
      impact(
        event.position,
        spell.strong ? look.impacts.strongHit : look.impacts.hit,
        palettes.stupefy,
        { along, body }
      );
    } else {
      // Incendio's blast is its explosion, reported on its own; here only
      // its energy on the body it struck.
      impacts.arcs(
        body,
        palettes.incendio,
        look.impacts.incendio.arcs.count,
        look.impacts.incendio.arcs.life
      );
    }
  };

  /** A Spell stopped by Cover, a wall or the floor. */
  const stopBurst = (event: Extract<DuelEvent, { type: "spell-stopped" }>) => {
    const { spell } = event;

    if (spell.kind === "confringo") {
      // Fire splashing back off the wall.
      impact(event.position, look.impacts.confringo, palettes.confringo, {
        along: flightOf(spell),
        scale: sizeOf(spell) * look.confringo.stopScale,
      });
    } else {
      burst(
        event.position,
        look.bursts.stop,
        palettes[spell.kind],
        1,
        flightOf(spell)
      );
    }
  };

  const handle = (events: readonly DuelEvent[]) => {
    // Round and Duel events have no Spell look.
    for (const event of events) {
      if (event.type === "spell-cast" && event.spell.kind === "depulso") {
        // Its velocity is its cone's axis; the blast makes its own flash.
        waves.start(event.spell.position, {
          x: event.spell.velocity.x,
          z: event.spell.velocity.z,
        });
      } else if (event.type === "spell-cast") {
        // The jet starts at the Wand tip, where it flares.
        castPoints.set(event.spell.id, event.spell.position);
        impact(
          event.spell.position,
          look.impacts.cast,
          palettes[event.spell.kind],
          { along: flightOf(event.spell), scale: sizeOf(event.spell) }
        );
      } else if (event.type === "perfect-release") {
        burst(event.spell.position, look.bursts.perfect, palettes.confringo);
      } else if (event.type === "backfire") {
        burst(event.position, look.bursts.backfire, backfirePalette);
      } else if (event.type === "spell-hit") {
        hitBurst(event);
      } else if (event.type === "spell-stopped") {
        stopBurst(event);
      } else if (event.type === "explosion") {
        explode(event.position);
      } else if (event.type === "spells-cancelled") {
        const [first, second] = event.spells;
        burst(event.position, look.bursts.cancel, palettes[first.kind]);
        burst(event.position, look.bursts.stop, palettes[second.kind]);
      } else if (event.type === "spell-blocked") {
        const stop =
          event.spell.kind === "confringo"
            ? look.bursts.confringoStop
            : look.bursts.stop;

        burst(
          event.position,
          stop,
          palettes[event.spell.kind],
          1,
          flightOf(event.spell)
        );
      } else if (event.type === "disarm") {
        // A white flash where the Wand leaves the hand (Expelliarmus's own
        // scarlet energy lands with its hit).
        impact(event.position, look.impacts.disarm, whitePalette);
      } else if (event.type === "wand-recovered") {
        burst(event.position, look.bursts.wandBack, wandPalette);
      } else if (event.type === "parry") {
        // The reflected Spell's jet starts from the Shield, not the Wand.
        castPoints.set(event.reflected.id, event.position);
        wakes.delete(event.reflected.id);
        // A gold deflection, the Spell's own sparks splashing back the way
        // it came.
        burst(event.position, look.bursts.perfect, wandPalette);
        burst(
          event.position,
          look.bursts.stop,
          palettes[event.spell.kind],
          1,
          flightOf(event.spell)
        );
      }

      clashBurst(event);
    }
  };

  /** Sparks and glow at every Charging Wand; returns their light requests. */
  const crackleAt = (
    charging: readonly ChargingWand[],
    seconds: number
  ): Glow[] => {
    const glows: Glow[] = [];
    const { hot, main } = palettes.confringo;
    const { crackle } = look;

    owed = charging.map((_, index) => owed[index] ?? 0);

    for (const [index, wand] of charging.entries()) {
      const { building, overcharge: brink } = crackle;
      const danger = wand.overcharge;

      // Building sparks scale with the Charge; past full they escalate with Overcharge.
      const rate =
        building.rate * wand.level +
        (brink.rate - building.rate) * danger * danger;

      const size = building.size + (brink.size - building.size) * danger;
      const speed = building.speed + (brink.speed - building.speed) * danger;

      let due = (owed[index] ?? 0) + rate * seconds;

      for (let spark = 0; due >= 1; spark += 1, due -= 1) {
        // Past full the crackle turns white-hot every other spark.
        const color = danger > 0 && spark % 2 === 0 ? hot : main;
        sparks.emit(wand.tip, color, {
          intensity: 4 + 4 * danger,
          life: crackle.life,
          size,
          speed,
          streak: crackle.streak,
        });
      }

      owed[index] = due;

      // The tip glow swells with the Charge and flickers near the brink.
      const flicker =
        1 -
        crackle.flicker *
          danger *
          (0.5 + 0.5 * Math.sin(clock * (30 + 40 * danger)));

      const glowSize =
        (crackle.tipGlow.empty +
          (crackle.tipGlow.full - crackle.tipGlow.empty) * wand.level) *
        flicker;

      tipGlows.show(index, wand.tip, glowSize);

      glows.push({
        color: danger > 0.5 ? backfirePalette.main : main,
        distance: look.lights.flashDistance,
        intensity:
          (crackle.light.full * wand.level +
            (crackle.light.overcharge - crackle.light.full) * danger) *
          flicker,
        position: new Vector3(wand.tip.x, wand.tip.y, wand.tip.z),
      });
    }

    tipGlows.hideFrom(charging.length);

    return glows;
  };

  /** Sheds a Spell's wake along the stretch it flew since it last did. */
  const shed = (
    spell: SpellState,
    head: Point3,
    from: Point3,
    wake: BoltLook["wake"],
    palette: Palette,
    scale: number
  ) => {
    const last = wakes.get(spell.id) ?? { at: from, owed: 0 };

    const flown = Math.hypot(
      head.x - last.at.x,
      head.y - last.at.y,
      head.z - last.at.z
    );

    let due = last.owed + flown * wake.perMetre * scale;

    const back = unit({
      x: -spell.velocity.x,
      y: -spell.velocity.y,
      z: -spell.velocity.z,
    });

    for (let spark = 0; due >= 1; spark += 1, due -= 1) {
      const share = random();

      sparks.emit(
        {
          x: last.at.x + (head.x - last.at.x) * share,
          y: last.at.y + (head.y - last.at.y) * share,
          z: last.at.z + (head.z - last.at.z) * share,
        },
        spark % 3 === 0 ? palette.hot : palette.main,
        {
          gravity: wake.gravity,
          heading: { x: back.x * 0.5, y: back.y * 0.5, z: back.z * 0.5 },
          intensity: wake.intensity,
          life: wake.life * (0.6 + random() * 0.4),
          size: wake.size * scale * (0.6 + random() * 0.6),
          speed: wake.speed,
          streak: wake.streak,
        }
      );
    }

    wakes.set(spell.id, { at: head, owed: due });
  };

  /** Lights the brightest requests with the pooled lights; the rest go dark. */
  const light = (glows: Glow[]) => {
    glows.sort((a, b) => b.intensity - a.intensity);

    for (const [index, each] of lights.entries()) {
      const glow = glows[index];
      each.intensity = glow?.intensity ?? 0;

      if (glow) {
        each.position.copy(glow.position);
        each.color.copy(glow.color);
        each.distance = glow.distance;
      }
    }
  };

  /** Draws a Spell in flight between two snapshots; returns the light it carries. */
  const drawFlying = (
    spell: SpellState,
    kind: ProjectileKind,
    was: SpellState | undefined,
    alpha: number
  ): Glow => {
    const pool = pools[kind];
    const { look: bolt, palette } = pool;
    const drawn = pool.take();
    const head = sampleSpell(was, spell, alpha);
    const from = castPoints.get(spell.id) ?? spell.position;
    const scale = sizeOf(spell);

    // Each Spell flickers on its own beat.
    const flicker =
      1 +
      bolt.glow.flicker *
        (0.6 * Math.sin(clock * 37 + spell.id * 1.7) +
          0.4 * Math.sin(clock * 61 + spell.id));

    drawn.core.position.set(head.x, head.y, head.z);
    drawn.core.scale.setScalar(scale);
    drawn.glow.position.copy(drawn.core.position);
    drawn.glow.scale.setScalar(bolt.glow.size * scale * flicker);

    // The jet reaches back toward the Wand, never past it.
    const flown = Math.hypot(head.x - from.x, head.y - from.y, head.z - from.z);
    layJet(drawn, pool.jet, drawn.core.position, flown, spell, scale);
    shed(spell, head, from, bolt.wake, palette, scale);

    return {
      color: palette.main,
      distance: bolt.light.distance,
      intensity: bolt.light.intensity * scale * flicker,
      position: drawn.core.position,
    };
  };

  const update = (
    previous: readonly SpellState[],
    current: readonly SpellState[],
    alpha: number,
    seconds: number,
    afflicted: AfflictedDuelists = {}
  ) => {
    const { bodyOf, burning = [], charging = [], petrified = [] } = afflicted;
    bodies = bodyOf;
    sparks.advance(seconds);
    shockwaves.advance(seconds);
    waves.advance(seconds);
    clock += seconds;
    viewer?.getWorldPosition(eye);
    const before = new Map(previous.map((spell) => [spell.id, spell]));

    // Light requests this frame: every flash, Spell in flight, Charging Wand and Burn.
    const glows: Glow[] = [
      ...crackleAt(charging, seconds),
      ...smoulder(burning, seconds, bodyOf),
    ];

    settle(petrified, seconds);

    for (const pool of Object.values(pools)) {
      pool.begin(clock);
    }

    for (const spell of current) {
      // Depulso never flies, so it is never in the air to draw.
      if (spell.kind !== "depulso") {
        glows.push(drawFlying(spell, spell.kind, before.get(spell.id), alpha));
      }
    }

    for (const pool of Object.values(pools)) {
      pool.end();
    }

    // Forget the cast points and wakes of Spells no longer in the air.
    const flying = new Set(current.map((spell) => spell.id));

    for (const id of castPoints.keys()) {
      if (!flying.has(id)) {
        castPoints.delete(id);
      }
    }

    for (const id of wakes.keys()) {
      if (!flying.has(id)) {
        wakes.delete(id);
      }
    }

    // Backward, so removing a spent flash never skips the next one.
    for (let index = flashes.length - 1; index >= 0; index -= 1) {
      const each = flashes[index];

      if (each) {
        each.age += seconds;
      }

      if (each && each.age >= each.life) {
        flashes.splice(index, 1);
      }
    }

    for (const each of flashes) {
      const left = 1 - each.age / each.life;
      glows.push({
        color: each.color,
        distance: look.lights.flashDistance,
        intensity: each.peak * left * left,
        position: each.position,
      });
    }

    impacts.update(seconds, eye, (id) => bodyOf?.(id));
    sparks.commit();
    light(glows);
  };

  const watchFrom = (camera: Object3D) => {
    viewer = camera;
  };

  return { handle, object, sparks, update, watchFrom };
};

/** The settings `main.ts` builds the Spell VFX with. */
export const spellVfxSettings = (settings: Tuning): SpellVfxSettings => ({
  blastRadius: settings.incendio.blastRadius,
  depulso: settings.depulso,
  depulsoLook: settings.depulsoLook,
  look: settings.spellLook,
  palette: settings.spellPalette,
});
