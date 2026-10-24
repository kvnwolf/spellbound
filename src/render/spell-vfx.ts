/**
 * Spell VFX: how each Spell looks in flight and where it lands, plus the
 * crackle at a Charging Wand and what clings to a Burning or Petrified
 * Duelist. Views only: it reads Spells from snapshots and reacts to
 * simulation events. Every number is in `tuning.spellLook` (Depulso's in
 * `tuning.depulsoLook`).
 *
 * - In flight, each Spell is a white-hot core, a flickering glow and a
 *   tapered trail in its own palette, hot at the head and soft at its edges
 *   so it reads as a streak of light rather than a solid cone, shedding a
 *   wake of sparks for every metre it flies (fire rises off Confringo and
 *   Incendio, cold motes hang behind Petrificus). Flight is a straight line
 *   from the Wand (homing only bends it gently), so the trail is evaluated
 *   from the cast point instead of kept as a history, and the wake is spent
 *   by distance flown, so it is the same at any frame rate.
 * - Casts, impacts, mid-air cancels and Backfires burst: a still flash, a
 *   shock ring swelling out of it, and sparks streaking out, splashing on
 *   through or back along the Spell's flight. All of it lives in the shared
 *   spark ring (`spark-ring.ts`): one instanced draw, positions computed in
 *   TSL from the effects clock.
 * - Incendio explodes into a big burst, a rolling fireball rising on its own
 *   heat, a shockwave ring on the floor as wide as the gameplay blast and
 *   embers that drift up over it; a Burning Duelist is licked by tongues of
 *   flame, sheds rising embers and casts a flickering warm light.
 *   Petrificus Totalus lands in a cold flash and a puff of stone dust, and a
 *   Petrified Duelist sheds grit and cold glints (the stone itself is the
 *   Duelist view's). Expelliarmus is a scarlet bolt with a white heart; a
 *   Disarm bursts scarlet and white where the Wand leaves the hand, and a
 *   Wand picked up or returned flares where it lay (the Wand itself is
 *   `loose-wand-view.ts`'s). Depulso's blast is `depulso-vfx.ts`'s; a
 *   Duelist it catches bursts with force, splashing away from the caster.
 * - A Charging Wand sheds streaking sparks at a rate that rises with the
 *   Charge, and crackles hotter and wilder as Overcharge nears.
 * - A small fixed pool of point lights follows the brightest Spells, flashes,
 *   Charging Wands and Burns, so the count of lights (and so the shaders)
 *   never changes.
 *
 * Colours are scene-linear HDR above 1, so they feed bloom.
 */
import {
  abs,
  float,
  length,
  mix,
  normalView,
  positionGeometry,
  positionViewDirection,
  smoothstep,
  uniform,
  uv,
  vec3,
  vec4,
} from "three/tsl";
import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicNodeMaterial,
  PointLight,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Sprite,
  SpriteNodeMaterial,
  Vector3,
} from "three/webgpu";

import type {
  DuelEvent,
  ProjectileKind,
  SpellKind,
  SpellState,
} from "../duel/duel";
import type { Point3 } from "../duel/geometry";
import type { Tuning } from "../tuning";
import { createDepulsoWaves } from "./depulso-vfx";
import { sampleSpell } from "./interpolate";
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

/** Duelists something clings to this frame: where each stands (their feet). */
export interface AfflictedDuelists {
  /** Every Charging Wand, for its crackle. */
  readonly charging?: readonly ChargingWand[];
  /** Duelists with an Incendio Burn, shedding flames and embers. */
  readonly burning?: readonly Point3[];
  /** Petrified Duelists, shedding grit and cold glints. */
  readonly petrified?: readonly Point3[];
}

export interface SpellVfx {
  readonly object: Group;
  /** The spark ring every effect sprays into (the Clash's too). */
  readonly sparks: SparkRing;
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

type BurstStyle = SpellLook["bursts"]["hit"];

/** The flight direction a burst splashes along, when it has one. */
type Splash = Point3 | undefined;

const unit = (vector: Point3): Point3 => {
  const size = Math.hypot(vector.x, vector.y, vector.z) || 1;

  return { x: vector.x / size, y: vector.y / size, z: vector.z / size };
};

/** The way a Spell is flying, as a unit vector. */
const flightOf = (spell: SpellState) => unit(spell.velocity);

/** One Spell kind's materials: core, glow and trail. */
const createBoltMaterials = (palette: Palette, look: BoltLook) => {
  const { hot, main } = palette;
  const core = new MeshBasicNodeMaterial();
  core.colorNode = vec3(hot.r, hot.g, hot.b).mul(look.core.intensity);

  const glow = new SpriteNodeMaterial({
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });

  const fromCentre = length(uv().sub(0.5)).mul(2);
  glow.colorNode = vec4(
    vec3(main.r, main.g, main.b).mul(look.glow.intensity),
    1
  );
  glow.opacityNode = smoothstep(1, 0, fromCentre).pow(2.5);

  const trail = new MeshBasicNodeMaterial({
    blending: AdditiveBlending,
    depthWrite: false,
    // Additive: both faces in one pass add up the same (see prewarm.ts).
    forceSinglePass: true,
    side: DoubleSide,
    transparent: true,
  });

  // Hot at the head, cooling to the Spell's hue and fading out at the tail,
  // and soft where the cone turns edge-on, so it reads as a streak of light.
  const along = float(1).sub(positionGeometry.y);
  const facing = abs(normalView.dot(positionViewDirection));
  trail.colorNode = mix(
    vec3(main.r, main.g, main.b),
    vec3(hot.r, hot.g, hot.b),
    along.pow(6)
  ).mul(look.trail.intensity);
  trail.opacityNode = along.pow(2).mul(facing.pow(1.5)).mul(0.6);

  return { core, glow, trail };
};

type BoltMaterials = ReturnType<typeof createBoltMaterials>;

/** A Spell in flight: core, glow and trail, reused across Spells of one kind. */
const createBolt = (materials: BoltMaterials, look: BoltLook) => {
  const group = new Group();

  const core = new Mesh(
    new SphereGeometry(look.core.radius, 16, 12),
    materials.core
  );

  const glow = new Sprite(materials.glow);
  glow.scale.setScalar(look.glow.size);

  // A cone from radius 1 at the head (y = 0) to a point at the tail (y = 1),
  // scaled to the trail's width and length and turned to point backward.
  const trailGeometry = new CylinderGeometry(0, 1, 1, 12, 1, true);
  trailGeometry.translate(0, 0.5, 0);
  const trail = new Mesh(trailGeometry, materials.trail);

  group.add(core, glow, trail);

  return { core, glow, group, trail };
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
  const materials = createBoltMaterials(palette, look);
  // One bolt exists (hidden) from the start, so the load-time prewarm
  // compiles this kind's shaders before its first cast.
  const first = createBolt(materials, look);
  first.group.visible = false;
  parent.add(first.group);
  const bolts: Bolt[] = [first];
  let used = 0;

  return {
    /** Starts a frame: every bolt is free again. */
    begin: () => {
      used = 0;
    },
    /** Hides the bolts nobody took this frame. */
    end: () => {
      for (const bolt of bolts.slice(used)) {
        bolt.group.visible = false;
      }
    },
    look,
    palette,
    take: (): Bolt => {
      let bolt = bolts[used];

      if (!bolt) {
        bolt = createBolt(materials, look);
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
  const geometry = new RingGeometry(0.82, 1, 64);
  // Flat on the floor.
  geometry.rotateX(-Math.PI / 2);

  const rings = Array.from({ length: 3 }, () => {
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
        each.mesh.position.set(at.x, 0.05, at.z);
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
  /** Where each Spell left the Wand, for its trail. */
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

  object.add(sparks.sprite);

  const up = new Vector3(0, 1, 0);
  const backward = new Vector3();
  const turn = new Quaternion();

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

  /**
   * A burst: a still flash, a ring swelling out of it, and sparks streaking
   * out (leaning along `along`, the Spell's flight, by the style's splash),
   * with a flash of light.
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

    flashes.push({
      age: 0,
      color: palette.main,
      life: style.lightLife,
      peak: style.light * scale,
      position: new Vector3(position.x, position.y, position.z),
    });
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

  /** Incendio's explosion: the blast, the fireball, the shockwave and the embers it leaves. */
  const explode = (at: Point3) => {
    const { hot, main } = palettes.incendio;
    const { burst: blast, embers, fireball } = look.incendio;
    burst(at, blast, palettes.incendio);
    shockwaves.start(at);

    // Big, slow flames rolling out of the centre and rising on their heat.
    for (let flame = 0; flame < fireball.count; flame += 1) {
      sparks.emit(at, flame % 4 === 0 ? hot : main, {
        gravity: -fireball.rise,
        heading: { x: 0, y: 0.35, z: 0 },
        intensity: fireball.intensity,
        life: fireball.life * (0.7 + random() * 0.3),
        size: fireball.size * (0.6 + random() * 0.6),
        speed: fireball.speed,
      });
    }

    // Embers over the scorched floor of the blast, drifting up on the heat.
    for (let ember = 0; ember < embers.count; ember += 1) {
      sparks.emit(
        scatter(at, settings.blastRadius, random() * 0.6),
        ember % 3 === 0 ? hot : main,
        {
          gravity: -embers.rise,
          intensity: 5,
          life: embers.life * (0.6 + random() * 0.4),
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

  /** Flames and embers on every Burning Duelist; returns their light requests. */
  const smoulder = (burning: readonly Point3[], seconds: number): Glow[] => {
    const { hot, main } = palettes.incendio;
    const { burn } = look;

    smouldering = burning.map(
      (_, index) => smouldering[index] ?? { embers: 0, flames: 0 }
    );

    return burning.map((body, index) => {
      const debt = smouldering[index] ?? { embers: 0, flames: 0 };
      debt.embers += burn.embers.rate * seconds;
      debt.flames += burn.flames.rate * seconds;

      for (let ember = 0; debt.embers >= 1; ember += 1, debt.embers -= 1) {
        sparks.emit(
          roundBody(body, burn.spread, burn.from, burn.to),
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

      // Tongues of flame licking up the body, mostly low.
      for (let flame = 0; debt.flames >= 1; flame += 1, debt.flames -= 1) {
        sparks.emit(
          roundBody(
            body,
            burn.spread,
            burn.from,
            burn.from + (burn.to - burn.from) * random()
          ),
          flame % 3 === 0 ? hot : main,
          {
            gravity: -burn.flames.rise,
            heading: { x: 0, y: 1, z: 0 },
            intensity: burn.flames.intensity,
            life: burn.flames.life * (0.6 + random() * 0.4),
            size: burn.flames.size * (0.5 + random() * 0.5),
            speed: burn.flames.speed,
            spread: 0.6,
            streak: burn.flames.streak,
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
        position: new Vector3(body.x, body.y + 1, body.z),
      };
    });
  };

  /** Grit falling off every Petrified Duelist, and cold glints on the stone. */
  const settle = (petrified: readonly Point3[], seconds: number) => {
    const { glints, grit, spread, from, to } = look.petrified;

    settling = petrified.map(
      (_, index) => settling[index] ?? { glints: 0, grit: 0 }
    );

    for (const [index, body] of petrified.entries()) {
      const debt = settling[index] ?? { glints: 0, grit: 0 };
      debt.grit += grit.rate * seconds;
      debt.glints += glints.rate * seconds;

      for (; debt.grit >= 1; debt.grit -= 1) {
        sparks.emit(roundBody(body, spread, from, to), gritColor, {
          gravity: grit.gravity,
          intensity: grit.intensity,
          life: grit.life,
          size: grit.size,
          speed: grit.speed,
        });
      }

      for (; debt.glints >= 1; debt.glints -= 1) {
        sparks.emit(
          roundBody(body, spread * 0.8, from, to),
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

  /** A Spell landing on a Duelist. */
  const hitBurst = (event: Extract<DuelEvent, { type: "spell-hit" }>) => {
    const { spell } = event;

    if (spell.kind === "confringo") {
      burst(
        event.position,
        look.bursts.confringoHit,
        palettes.confringo,
        sizeOf(spell),
        flightOf(spell)
      );
    } else if (spell.kind === "petrificus") {
      // A cold flash and a puff of stone dust as the Duelist turns to stone.
      burst(
        event.position,
        look.bursts.petrify,
        palettes.petrificus,
        1,
        flightOf(spell)
      );
      burst(event.position, look.bursts.petrify, stoneDust, 0.8);
    } else if (spell.kind === "depulso") {
      // The blast's force bursting off the body, away from the caster.
      burst(
        event.position,
        settings.depulsoLook.impact,
        palettes.depulso,
        1,
        flightOf(spell)
      );
    } else if (spell.kind !== "incendio") {
      // Incendio's hit is mostly its explosion, reported on its own.
      burst(
        event.position,
        spell.strong ? look.bursts.strongHit : look.bursts.hit,
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
        castPoints.set(event.spell.id, event.spell.position);
        burst(
          event.spell.position,
          look.bursts.cast,
          palettes[event.spell.kind],
          sizeOf(event.spell),
          flightOf(event.spell)
        );
      } else if (event.type === "perfect-release") {
        burst(event.spell.position, look.bursts.perfect, palettes.confringo);
      } else if (event.type === "backfire") {
        burst(event.position, look.bursts.backfire, backfirePalette);
      } else if (event.type === "spell-hit") {
        hitBurst(event);
      } else if (event.type === "spell-stopped") {
        const { spell } = event;
        const confringo = spell.kind === "confringo";

        burst(
          event.position,
          confringo ? look.bursts.confringoStop : look.bursts.stop,
          palettes[spell.kind],
          confringo ? sizeOf(spell) : 1,
          flightOf(spell)
        );
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
        burst(event.position, look.bursts.disarm, palettes.expelliarmus);
        burst(event.position, look.bursts.disarm, wandPalette, 0.5);
      } else if (event.type === "wand-recovered") {
        burst(event.position, look.bursts.wandBack, wandPalette);
      } else if (event.type === "parry") {
        // The reflected Spell's trail starts from the Shield, not the Wand.
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

  const update = (
    previous: readonly SpellState[],
    current: readonly SpellState[],
    alpha: number,
    seconds: number,
    afflicted: AfflictedDuelists = {}
  ) => {
    const { burning = [], charging = [], petrified = [] } = afflicted;
    sparks.advance(seconds);
    shockwaves.advance(seconds);
    waves.advance(seconds);
    clock += seconds;
    const before = new Map(previous.map((spell) => [spell.id, spell]));

    // Light requests this frame: every flash, Spell in flight, Charging Wand and Burn.
    const glows: Glow[] = [
      ...crackleAt(charging, seconds),
      ...smoulder(burning, seconds),
    ];

    settle(petrified, seconds);

    for (const pool of Object.values(pools)) {
      pool.begin();
    }

    for (const spell of current) {
      // Depulso never flies, so it is never in the air to draw.
      if (spell.kind === "depulso") {
        continue;
      }

      const pool = pools[spell.kind];
      const { look: bolt, palette } = pool;
      const drawn = pool.take();
      const head = sampleSpell(before.get(spell.id), spell, alpha);
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

      // The trail reaches back toward the Wand, never past it.
      const flown = Math.hypot(
        head.x - from.x,
        head.y - from.y,
        head.z - from.z
      );

      const trailLength = Math.min(bolt.trail.length * scale, flown);
      backward
        .set(-spell.velocity.x, -spell.velocity.y, -spell.velocity.z)
        .normalize();
      turn.setFromUnitVectors(up, backward);
      drawn.trail.position.copy(drawn.core.position);
      drawn.trail.quaternion.copy(turn);
      drawn.trail.scale.set(
        bolt.trail.width * scale,
        Math.max(trailLength, 1e-3),
        bolt.trail.width * scale
      );

      shed(spell, head, from, bolt.wake, palette, scale);

      glows.push({
        color: palette.main,
        distance: bolt.light.distance,
        intensity: bolt.light.intensity * scale * flicker,
        position: drawn.core.position,
      });
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

    sparks.commit();
    light(glows);
  };

  return { handle, object, sparks, update };
};

/** The settings `main.ts` builds the Spell VFX with. */
export const spellVfxSettings = (settings: Tuning): SpellVfxSettings => ({
  blastRadius: settings.incendio.blastRadius,
  depulso: settings.depulso,
  depulsoLook: settings.depulsoLook,
  look: settings.spellLook,
  palette: settings.spellPalette,
});
