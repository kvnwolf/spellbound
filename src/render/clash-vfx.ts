/**
 * Clash VFX: two jets of light pushing against each other between the
 * Duelists' Wands, and the blinding knot of energy where they meet. Views
 * only: it reads the Clash from snapshots and reacts to simulation events.
 * The bursts at the start, on every pump and at the end are the Spell
 * VFX's (see `spell-vfx.ts`); this draws what lasts. Every number is in
 * `tuning.clashLook`.
 *
 * - Each Duelist's half of the beam is a jet of light in their Spell's
 *   colours, as the films draw a Spell: a ribbon from their Wand tip to the
 *   meeting point, turned to the camera, with a white-hot core, a halo that
 *   churns with noise flowing toward the meeting point, pulses running down
 *   it, filaments twisting round it, and soft ends. It swells as it nears
 *   the meeting point, where it pushes, and sways as the two strain against
 *   each other. Every pump sends a surge of light down the pumping side's
 *   jet that bursts as it reaches the meeting point.
 * - The meeting point is a knot of energy: a small white-hot heart in a
 *   churning corona split between the two Spells' colours, shot through
 *   with flickering rays, swelling on every pump, and lighting the
 *   courtyard with one point light that only shines during a Clash.
 * - Out of it shoot short, flickering, branching streams of energy in every
 *   direction (`clash-arcs.ts`), faster, longer and wilder as the struggle
 *   swings back and forth, as pumps land and as the Clash nears its blast;
 *   with a spray of sparks (in the shared spark ring).
 *
 * Colours are scene-linear HDR, kept modest outside the thin white-hot
 * cores so bloom haloes them without washing the scene white, and the
 * colour and filaments still read with bloom off.
 */
import {
  atan,
  cos,
  exp,
  length,
  mix,
  mx_noise_float,
  positionGeometry,
  sin,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { Camera, Node } from "three/webgpu";
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  PointLight,
  Sprite,
  SpriteNodeMaterial,
  Vector2,
  Vector3,
} from "three/webgpu";

import type { ClashState, DuelEvent, DuelistId } from "../duel/duel";
import type { Point3 } from "../duel/geometry";
import type { Tuning } from "../tuning";
import { arcPoint, createClashArcs, growOf } from "./clash-arcs";
import type { Arc } from "./clash-arcs";
import type { SparkRing } from "./spark-ring";
import { seededRandom } from "./spark-ring";

export interface ClashVfx {
  readonly object: Group;
  /** The camera the jets turn to face and the knot splits its colours for. */
  readonly watchFrom: (camera: Camera) => void;
  /** Surges and bursts for this frame's pumps, start and end. */
  readonly handle: (events: readonly DuelEvent[]) => void;
  /**
   * Draws the Clash between two snapshots (nothing when there is none), its
   * beam starting at each Wand tip as drawn (`visibleTip`, falling back to
   * the simulation's), and ages the effects by `seconds`.
   */
  readonly update: (
    previous: ClashState | null,
    current: ClashState | null,
    alpha: number,
    seconds: number,
    visibleTip: (id: DuelistId) => Point3 | undefined
  ) => void;
}

export interface ClashVfxSettings {
  readonly look: Tuning["clashLook"];
  /** Every Spell's colours: each half of the beam is its caster's Spell's. */
  readonly palette: Tuning["spellPalette"];
  /** The shared spark ring the meeting point sprays into. */
  readonly sparks: SparkRing;
}

type Look = Tuning["clashLook"];

const lerp = (from: number, to: number, share: number) =>
  from + (to - from) * share;

const squared = (value: Node<"float">) => value.mul(value);

/** Writes a colour into a vec3 uniform's value. */
const paint = (target: Vector3, color: Color) => {
  target.set(color.r, color.g, color.b);
};

const between = (random: () => number, range: { min: number; max: number }) =>
  range.min + (range.max - range.min) * random();

/**
 * One Duelist's half of the beam: a jet of light from the Wand (along 0) to
 * the meeting point (along 1), on a ribbon the caller turns to the camera.
 * Its own uniforms: how long it is, the clock, a seed, its colours and the
 * surge running down it.
 */
const createJet = (look: Look["beam"]) => {
  const metresLong = uniform(1);
  const time = uniform(0);
  const seed = uniform(0);
  const main = uniform(new Vector3());
  const hot = uniform(new Vector3());
  // Where the surge's front is (metres from the Wand) and how strong it is.
  const surge = uniform(new Vector2(-100, 0));

  const along = uv().x;
  const across = uv().y.mul(2).sub(1);
  const metres = along.mul(metresLong);
  const flow = metres.mul(look.noiseScale).sub(time.mul(look.flowSpeed));
  const churn = mx_noise_float(vec3(flow, across.mul(1.5), seed));

  // Swollen where it pushes against the other.
  const swell = smoothstep(1 - look.swell.reach, 1, along)
    .pow(2)
    .mul(look.swell.amount)
    .add(1);

  const core = exp(squared(across.div(swell.mul(look.core))).negate());

  const halo = exp(
    squared(
      across.div(churn.mul(look.churn).add(1).mul(look.halo).mul(swell))
    ).negate()
  );

  const pulses = sin(metres.mul(look.pulseRate).sub(time.mul(look.pulseSpeed)))
    .mul(0.5)
    .add(0.5)
    .mul(look.pulse)
    .add(1 - look.pulse);

  const filament = (phase: number, rate: number) => {
    const sway = mx_noise_float(vec3(flow.mul(0.5), seed, phase))
      .mul(0.5)
      .add(0.5);

    const wiggle = sin(
      metres.mul(rate).sub(time.mul(look.filamentSpeed)).add(seed.add(phase))
    )
      .mul(look.filamentAmplitude)
      .mul(sway)
      .mul(swell);

    return exp(squared(across.sub(wiggle).div(look.filamentWidth)).negate());
  };

  const filaments = filament(0, 7).add(filament(2.1, 11)).add(filament(4.3, 5));

  // The surge: a bright knot of light racing down the jet to the meeting point.
  const surgeBand = exp(
    squared(metres.sub(surge.x).div(look.surge.width)).negate()
  ).mul(surge.y);

  const ends = smoothstep(0, look.wandSoft, along).mul(
    smoothstep(1, 1 - look.knotSoft, along)
  );

  // Brighter toward the meeting point, where the energy piles up.
  const ramp = along.mul(1 - look.rampFrom).add(look.rampFrom);

  const material = new MeshBasicNodeMaterial({
    blending: AdditiveBlending,
    depthWrite: false,
    forceSinglePass: true,
    side: DoubleSide,
    transparent: true,
  });

  // The two jets strain against each other: a slow sway, pinned at both ends.
  const sway = sin(along.mul(Math.PI))
    .mul(
      sin(
        along
          .mul(look.sway.waves * Math.PI * 2)
          .sub(time.mul(look.sway.speed))
          .add(seed.mul(3))
      )
    )
    .mul(look.sway.amount);

  material.positionNode = vec3(
    positionGeometry.x,
    positionGeometry.y.add(sway),
    positionGeometry.z
  );

  material.colorNode = vec4(
    hot
      .mul(
        core.mul(surgeBand.mul(look.surge.core).add(1)).mul(look.coreIntensity)
      )
      .add(
        main.mul(
          halo
            .mul(pulses)
            .mul(surgeBand.mul(look.surge.halo).add(1))
            .mul(look.haloIntensity)
        )
      )
      .add(mix(main, hot, 0.3).mul(filaments.mul(look.filamentIntensity)))
      .mul(ends)
      .mul(ramp),
    1
  );

  const mesh = new Mesh(new PlaneGeometry(1, 1, look.segments, 1), material);

  mesh.frustumCulled = false;

  return { hot, main, mesh, metresLong, seed, surge, time };
};

type Jet = ReturnType<typeof createJet>;

/**
 * The knot where the jets meet: a white-hot heart in a churning corona,
 * split between the two Spells' colours (`first` toward the first side's
 * Wand on screen), shot through with flickering rays.
 */
const createKnot = (look: Look["knot"]) => {
  const time = uniform(0);
  const energy = uniform(1);
  const first = uniform(new Vector3());
  const second = uniform(new Vector3());
  const hot = uniform(new Vector3());
  // Toward the first side's Wand, on screen.
  const toward = uniform(new Vector2(1, 0));

  const from = uv().mul(2).sub(1);
  const radius = length(from);
  const angle = atan(from.y, from.x);
  const round = vec2(cos(angle), sin(angle));

  const churn = mx_noise_float(
    vec3(round.mul(look.churnScale), time.mul(look.churnSpeed))
  );

  const corona = exp(
    radius.div(churn.mul(look.churn).add(1).mul(look.corona)).negate()
  ).mul(smoothstep(1, 0.6, radius));

  const rays = smoothstep(
    look.rays.threshold,
    1,
    mx_noise_float(vec3(round.mul(look.rays.count), time.mul(look.rays.speed)))
      .mul(0.5)
      .add(0.5)
  )
    .mul(exp(radius.mul(look.rays.falloff).negate()))
    .mul(smoothstep(1, 0.4, radius));

  const heart = exp(squared(radius.div(look.core)).negate());

  const tint = mix(second, first, smoothstep(-0.5, 0.5, from.dot(toward)));

  const material = new SpriteNodeMaterial({
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });

  material.colorNode = vec4(
    hot
      .mul(heart.mul(look.coreIntensity))
      .add(tint.mul(corona.mul(look.coronaIntensity)))
      .add(mix(tint, hot, 0.25).mul(rays.mul(look.rays.intensity)))
      .mul(energy),
    1
  );

  const sprite = new Sprite(material);

  return { energy, first, hot, second, sprite, time, toward };
};

export const createClashVfx = ({
  look,
  palette,
  sparks,
}: ClashVfxSettings): ClashVfx => {
  const object = new Group();
  // What draws only during a Clash; the light and the arcs stay outside it
  // (the arcs finish their lives after the Clash ends).
  const effect = new Group();
  effect.visible = false;
  object.add(effect);
  const random = seededRandom(23);

  const jets = [createJet(look.beam), createJet(look.beam)] as const;
  jets[1].seed.value = 3.7;
  effect.add(jets[0].mesh, jets[1].mesh);

  const knot = createKnot(look.knot);
  paint(knot.hot.value, new Color(look.knot.hot));
  effect.add(knot.sprite);

  const arcs = createClashArcs(look.arcs);
  object.add(arcs.mesh);

  // Shines only during a Clash, but is always in the scene and never hidden
  // (a hidden light leaves the renderer's light list), so the count of lights
  // never changes: a change would recompile every lit material mid-Duel.
  const light = new PointLight(0xff_ff_ff, 0, look.knot.light.distance, 2);
  object.add(light);

  const colors = {
    first: { hot: new Color(), main: new Color() },
    second: { hot: new Color(), main: new Color() },
  };

  let viewer: Camera | undefined;
  let time = 0;
  let kick = 0;
  let swing = 0;
  let lastAlong: number | undefined;
  // The Clash's length when it started, for how close it is to blowing up.
  let fullSeconds = 1;
  // Arcs and sparks owed: fractional counts carried frame to frame.
  let owedArcs = 0;
  let owedSparks = 0;

  // Each side's surge: metres from its Wand (negative: none) and strength.
  const surges = [
    { metres: -1, strength: 0 },
    { metres: -1, strength: 0 },
  ];

  const point = new Vector3();
  const beamAxis = new Vector3();
  const eye = new Vector3();
  const axis = new Vector3();
  const side = new Vector3();
  const normal = new Vector3();
  const basis = new Matrix4();
  const screenKnot = new Vector3();
  const screenWand = new Vector3();
  let sideIds: readonly [DuelistId, DuelistId] | undefined;
  let lengths = [1, 1];

  /** Lays a jet from the Wand `from` to the meeting point, turned to face the camera. */
  const layJet = (jet: Jet, from: Point3, to: Vector3) => {
    axis.set(to.x - from.x, to.y - from.y, to.z - from.z);
    const metres = Math.max(axis.length(), 1e-3);
    axis.divideScalar(metres);
    jet.mesh.position.set(
      (from.x + to.x) / 2,
      (from.y + to.y) / 2,
      (from.z + to.z) / 2
    );
    viewer?.getWorldPosition(eye);
    side.copy(axis).cross(eye.sub(jet.mesh.position));

    if (side.lengthSq() < 1e-8) {
      side.set(0, 1, 0).cross(axis);
    }

    side.normalize();
    normal.copy(axis).cross(side);
    basis.makeBasis(axis, side, normal);
    jet.mesh.quaternion.setFromRotationMatrix(basis);
    jet.mesh.scale.set(metres, look.beam.width, 1);
    jet.metresLong.value = metres;
    jet.time.value = time;

    return metres;
  };

  /** A random unit vector, mostly off the beam's line so arcs do not hide in the jets. */
  const sprayHeading = () => {
    const heading = new Vector3(
      random() * 2 - 1,
      random() * 2 - 1,
      random() * 2 - 1
    );

    if (heading.lengthSq() < 1e-6) {
      heading.set(0, 1, 0);
    }

    heading.normalize();
    heading.addScaledVector(
      beamAxis,
      -look.arcs.offBeam * heading.dot(beamAxis)
    );

    return heading.normalize();
  };

  /** A unit vector square to `heading`, picked at random. */
  const squareTo = (heading: Vector3) => {
    const square = new Vector3(
      random() * 2 - 1,
      random() * 2 - 1,
      random() * 2 - 1
    ).cross(heading);

    return square.lengthSq() < 1e-6
      ? new Vector3(0, 1, 0).cross(heading).normalize()
      : square.normalize();
  };

  /** Shoots one arc (and maybe its branches) out of the meeting point, wilder with `fury`. */
  const shoot = (fury: number) => {
    const { arcs: arcLook } = look;
    const heading = sprayHeading();

    const reach =
      between(random, arcLook.length) * (1 + fury * arcLook.furyLength);

    const curve = squareTo(heading)
      .multiplyScalar(arcLook.curve * (random() * 2 - 1))
      .add(new Vector3(0, -arcLook.droop, 0));

    const tones = random() < 0.5 ? colors.first : colors.second;

    const parent: Arc = {
      color: random() < arcLook.hotShare ? tones.hot : tones.main,
      curve,
      delay: 0,
      heading,
      intensity: arcLook.intensity * (0.7 + 0.3 * random()),
      length: reach,
      life: between(random, arcLook.life),
      root: { x: 0, y: 0, z: 0 },
      seed: random() * 100,
      width: arcLook.width * (0.7 + 0.3 * random()) * (1 + fury * 0.3),
    };

    arcs.emit(parent);

    // Branches fork off partway, born as the parent's head passes.
    const forks =
      random() < arcLook.branch.chance * (0.5 + fury)
        ? 1 + (random() < arcLook.branch.second ? 1 : 0)
        : 0;

    for (let fork = 0; fork < forks; fork += 1) {
      const share = 0.25 + 0.45 * random();
      const turn = arcLook.branch.angle * (0.5 + random());

      const branchHeading = heading
        .clone()
        .multiplyScalar(Math.cos(turn))
        .addScaledVector(squareTo(heading), Math.sin(turn))
        .normalize();

      const delay = growOf(arcLook, reach) * share;

      arcs.emit({
        ...parent,
        curve: { x: curve.x * 0.5, y: curve.y, z: curve.z * 0.5 },
        delay,
        heading: branchHeading,
        intensity: parent.intensity * 0.8,
        length: reach * between(random, arcLook.branch.length),
        life: Math.max((parent.life - delay) * 0.85, 0.05),
        root: arcPoint(parent, share, arcLook.jag),
        seed: random() * 100,
        width: parent.width * 0.7,
      });
    }
  };

  /** Sprays streaking sparks off the meeting point, mostly sideways off the beam. */
  const spray = (at: Point3, count: number) => {
    for (let spark = 0; spark < count; spark += 1) {
      side.set(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1);
      side.addScaledVector(beamAxis, -0.85 * side.dot(beamAxis)).normalize();
      const tones = random() < 0.5 ? colors.first : colors.second;

      sparks.emit(at, spark % 3 === 0 ? tones.hot : tones.main, {
        heading: { x: side.x, y: side.y + 0.2, z: side.z },
        intensity: look.sparks.intensity,
        life: look.sparks.life * (0.5 + random() * 0.5),
        size: look.sparks.size,
        speed: look.sparks.speed,
        spread: look.sparks.spread,
        streak: look.sparks.streak,
      });
    }
  };

  /** Takes each side's colours from the Spell they hold the Clash with. */
  const dress = (clash: ClashState) => {
    const [first, second] = clash.sides;
    sideIds = [first.duelistId, second.duelistId];
    colors.first.main.set(palette[first.spell.kind].main);
    colors.first.hot.set(palette[first.spell.kind].hot);
    colors.second.main.set(palette[second.spell.kind].main);
    colors.second.hot.set(palette[second.spell.kind].hot);
    paint(jets[0].main.value, colors.first.main);
    paint(jets[0].hot.value, colors.first.hot);
    paint(jets[1].main.value, colors.second.main);
    paint(jets[1].hot.value, colors.second.hot);
    paint(knot.first.value, colors.first.main);
    paint(knot.second.value, colors.second.main);
    light.color.copy(colors.first.main).lerp(colors.second.main, 0.5);
  };

  /** A volley of arcs and sparks at once. */
  const volley = (count: number, fury: number) => {
    for (let arc = 0; arc < count; arc += 1) {
      shoot(fury);
    }

    spray(point, Math.round(count * 1.5));
  };

  return {
    handle: (events) => {
      for (const event of events) {
        if (event.type === "clash-start") {
          dress(event.clash);
          fullSeconds = Math.max(event.clash.secondsLeft, 1e-3);
          lastAlong = undefined;
          swing = 0;
          point.set(
            event.clash.point.x,
            event.clash.point.y,
            event.clash.point.z
          );
          arcs.knot.copy(point);
          volley(look.arcs.startVolley, 1);
        } else if (event.type === "clash-pump") {
          kick = 1;
          const index = sideIds?.indexOf(event.duelistId) ?? -1;
          const surge = surges[index];

          if (surge) {
            surge.metres = 0;
            surge.strength = 1;
          }
        } else if (event.type === "clash-end") {
          volley(look.arcs.endVolley, 1.2);
        }
      }
    },
    object,
    update: (previous, current, alpha, seconds, visibleTip) => {
      time += seconds;
      kick = Math.max(kick - look.knot.kickFade * seconds, 0);
      arcs.advance(seconds);

      if (!current) {
        effect.visible = false;
        light.intensity = 0;
        owedArcs = 0;
        owedSparks = 0;

        return;
      }

      if (!effect.visible) {
        dress(current);
      }

      effect.visible = true;

      const [first, second] = current.sides;
      const from = visibleTip(first.duelistId) ?? first.wand;
      const to = visibleTip(second.duelistId) ?? second.wand;

      const along = Math.min(
        Math.max(
          lerp(previous?.along ?? current.along, current.along, alpha),
          0
        ),
        1
      );

      // How fast the struggle is swinging, smoothed.
      const moved =
        lastAlong === undefined || seconds <= 0
          ? 0
          : Math.abs(along - lastAlong) / seconds;

      lastAlong = along;
      swing += (moved - swing) * Math.min(seconds * look.arcs.fury.settle, 1);

      point.set(
        lerp(from.x, to.x, along),
        lerp(from.y, to.y, along),
        lerp(from.z, to.z, along)
      );
      arcs.knot.copy(point);
      beamAxis.set(to.x - from.x, to.y - from.y, to.z - from.z).normalize();

      const tension = 1 - current.secondsLeft / fullSeconds;
      const { fury: furyLook } = look.arcs;

      const fury = Math.min(
        furyLook.base +
          swing * furyLook.swing +
          kick * furyLook.kick +
          tension * furyLook.tension,
        furyLook.max
      );

      lengths = [layJet(jets[0], from, point), layJet(jets[1], to, point)];

      // Surges race down their jets and burst as they reach the meeting point.
      for (const [index, surge] of surges.entries()) {
        const jet = jets[index];
        const metres = lengths[index] ?? 1;

        if (!jet) {
          continue;
        }

        if (surge.metres < 0) {
          jet.surge.value.set(-100, 0);
          continue;
        }

        surge.metres += look.beam.surge.speed * seconds;

        if (surge.metres >= metres) {
          surge.metres = -1;
          volley(look.arcs.pumpVolley, fury);
          jet.surge.value.set(-100, 0);
          continue;
        }

        jet.surge.value.set(surge.metres, surge.strength);
      }

      // Two incommensurate flickers, so the knot never visibly loops.
      const flicker =
        1 + 0.1 * Math.sin(time * 47) + 0.07 * Math.sin(time * 83 + 1);

      const pulse =
        1 +
        look.knot.pulse * Math.sin(time * 31) +
        look.knot.kick * kick +
        look.knot.fury * fury;

      knot.time.value = time;
      knot.energy.value = flicker * (1 + look.knot.kick * kick * 0.5);
      knot.sprite.position.copy(point);
      knot.sprite.scale.setScalar(look.knot.size * pulse);

      // Which way the first side's Wand lies from the knot on screen.
      if (viewer) {
        screenKnot.copy(point).project(viewer);
        screenWand.set(from.x, from.y, from.z).project(viewer);
        const dx = screenWand.x - screenKnot.x;
        const dy = screenWand.y - screenKnot.y;
        const size = Math.hypot(dx, dy) || 1;
        knot.toward.value.set(dx / size, dy / size);
      }

      light.position.copy(point);
      light.intensity =
        look.knot.light.intensity * pulse * flicker * (0.85 + 0.15 * fury);

      owedArcs += lerp(look.arcs.rate.min, look.arcs.rate.max, fury) * seconds;

      for (; owedArcs >= 1; owedArcs -= 1) {
        shoot(fury);
      }

      owedSparks += look.sparks.rate * (1 + fury) * seconds;
      const sparksNow = Math.floor(owedSparks);
      owedSparks -= sparksNow;
      spray(point, sparksNow);
    },
    watchFrom: (camera) => {
      viewer = camera;
    },
  };
};
