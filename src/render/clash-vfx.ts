/**
 * Clash VFX: the beam of fire joining two Wands locked in a Clash, and its
 * meeting point. Views only: it reads the Clash from snapshots and reacts to
 * simulation events. The bursts at the start, on every pump and at the end
 * are the Spell VFX's (see `spell-vfx.ts`); this draws what lasts. Every
 * number is in `tuning.clashLook`.
 *
 * - Each Duelist's half of the beam runs from their Wand tip to the meeting
 *   point: a white-hot core inside a sheath whose bands of fire flow toward
 *   the meeting point and whose filaments twist round it, inside a faint
 *   haze, soft where each layer turns edge-on so the beam reads as light
 *   rather than a tube. All of it flickers.
 * - The meeting point is a pulsing white-hot ball in a glow and corona,
 *   swelling on every pump, spraying streaking sparks out sideways (in the
 *   shared spark ring) and lighting the courtyard with one point light that
 *   only shines during a Clash.
 *
 * Colours are scene-linear HDR above 1, so they feed bloom.
 */
import {
  abs,
  float,
  length,
  normalView,
  positionGeometry,
  positionViewDirection,
  sin,
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
  SphereGeometry,
  Sprite,
  SpriteNodeMaterial,
  Vector3,
} from "three/webgpu";

import type { ClashState, DuelEvent, DuelistId } from "../duel/duel";
import type { Point3 } from "../duel/geometry";
import type { Tuning } from "../tuning";
import type { SparkRing } from "./spark-ring";
import { seededRandom } from "./spark-ring";

export interface ClashVfx {
  readonly object: Group;
  /** Swells the meeting point on every pump this frame. */
  readonly handle: (events: readonly DuelEvent[]) => void;
  /**
   * Draws the Clash between two snapshots (nothing when there is none), its
   * beam starting at each Wand tip as drawn (`visibleTip`, falling back to
   * the simulation's), and ages the effects by `seconds` of real time.
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
  /** Confringo's colours: the beam is its fire. */
  readonly palette: Tuning["spellPalette"]["confringo"];
  /** The shared spark ring the meeting point sprays into. */
  readonly sparks: SparkRing;
}

type Look = Tuning["clashLook"];

/** The effects clock, in seconds, that drives the flow and flicker. */
const createClock = () => uniform(0);

const lerp = (from: number, to: number, share: number) =>
  from + (to - from) * share;

/** Additive light, depth tested, never written, both faces in one pass (see prewarm.ts). */
const lightMaterial = () =>
  new MeshBasicNodeMaterial({
    blending: AdditiveBlending,
    depthWrite: false,
    forceSinglePass: true,
    side: DoubleSide,
    transparent: true,
  });

/** The core, flowing sheath and haze of one Duelist's half of the beam. */
const createHalf = (
  beam: Look["beam"],
  clock: ReturnType<typeof createClock>,
  main: Color,
  hot: Color
) => {
  const group = new Group();
  // Metres of this half, so the bands keep their spacing as it stretches.
  const span = uniform(1);

  // A tube from y = 0 (the Wand) to y = 1 (the meeting point).
  const tube = new CylinderGeometry(1, 1, 1, 20, 1, true);
  tube.translate(0, 0.5, 0);

  const fire = vec3(main.r, main.g, main.b);
  const heart = vec3(hot.r, hot.g, hot.b);
  const along = positionGeometry.y;
  const around = uv().x.mul(Math.PI * 2);
  // Soft where the tube turns edge-on: a beam of light, not a pipe.
  const facing = abs(normalView.dot(positionViewDirection));

  const core = new MeshBasicNodeMaterial();
  core.colorNode = heart.mul(beam.core.radiance);

  const bands = sin(along.mul(span).mul(beam.bands).sub(clock.mul(beam.flow)))
    .mul(0.5)
    .add(0.5);

  // Filaments twisting round the beam as they flow to the meeting point.
  const filaments = sin(
    around
      .mul(beam.filaments.count)
      .add(along.mul(span).mul(beam.filaments.pitch * Math.PI * 2))
      .sub(clock.mul(beam.filaments.speed))
  )
    .mul(0.5)
    .add(0.5)
    .pow(6);

  const sheath = lightMaterial();
  sheath.colorNode = fire
    .mul(beam.sheath.radiance)
    .add(heart.mul(bands.mul(0.15).add(filaments.mul(0.45))));
  // Banded, brightest toward the meeting point, soft at its edges.
  sheath.opacityNode = float(0.25)
    .add(bands.mul(0.35))
    .add(filaments.mul(0.4))
    .mul(smoothstep(0, 0.15, along).mul(0.6).add(along.mul(0.4)))
    .mul(facing.pow(0.7))
    .clamp(0, 1);

  const haze = lightMaterial();
  haze.colorNode = fire.mul(beam.haze.radiance);
  haze.opacityNode = float(0.1).add(bands.mul(0.05)).mul(facing.pow(1.5));

  const coreMesh = new Mesh(tube, core);
  const sheathMesh = new Mesh(tube, sheath);
  const hazeMesh = new Mesh(tube, haze);
  group.add(coreMesh, sheathMesh, hazeMesh);

  const up = new Vector3(0, 1, 0);
  const heading = new Vector3();
  const turn = new Quaternion();

  return {
    group,
    /** Stretches this half from `from` to `to`, its width flickering by `flicker`. */
    place: (from: Point3, to: Point3, flicker: number) => {
      heading.set(to.x - from.x, to.y - from.y, to.z - from.z);
      const metres = Math.max(heading.length(), 1e-3);
      heading.divideScalar(metres);
      turn.setFromUnitVectors(up, heading);
      group.position.set(from.x, from.y, from.z);
      group.quaternion.copy(turn);
      span.value = metres;

      const width = (radius: number) => radius * flicker;
      coreMesh.scale.set(
        width(beam.core.radius),
        metres,
        width(beam.core.radius)
      );
      sheathMesh.scale.set(
        width(beam.sheath.radius),
        metres,
        width(beam.sheath.radius)
      );
      hazeMesh.scale.set(
        width(beam.haze.radius),
        metres,
        width(beam.haze.radius)
      );
    },
  };
};

/** A soft round additive sprite in the fire's colours, `strength` bright. */
const createGlowMaterial = (
  strength: number,
  falloff: number,
  main: Color,
  hot: Color
) => {
  const material = new SpriteNodeMaterial({
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });

  const fromCentre = length(uv().sub(0.5)).mul(2);
  material.colorNode = vec4(
    vec3(main.r, main.g, main.b)
      .mul(strength)
      .add(vec3(hot.r, hot.g, hot.b).mul(strength * 0.5)),
    1
  );
  material.opacityNode = smoothstep(1, 0, fromCentre).pow(falloff);

  return material;
};

export const createClashVfx = ({
  look,
  palette,
  sparks,
}: ClashVfxSettings): ClashVfx => {
  const main = new Color(palette.main);
  const hot = new Color(palette.hot);
  const object = new Group();
  // What draws only during a Clash; the light stays outside it (see below).
  const effect = new Group();
  effect.visible = false;
  object.add(effect);
  const clock = createClock();
  const random = seededRandom(23);

  const halves = [
    createHalf(look.beam, clock, main, hot),
    createHalf(look.beam, clock, main, hot),
  ] as const;

  effect.add(halves[0].group, halves[1].group);

  const ballMaterial = new MeshBasicNodeMaterial();
  ballMaterial.colorNode = vec3(hot.r, hot.g, hot.b).mul(look.point.radiance);
  const ball = new Mesh(new SphereGeometry(1, 20, 14), ballMaterial);

  const glow = new Sprite(
    createGlowMaterial(look.point.glow.radiance, 2, main, hot)
  );

  const corona = new Sprite(
    createGlowMaterial(look.point.corona.radiance, 3, main, hot)
  );

  effect.add(ball, glow, corona);

  // Shines only during a Clash, but is always in the scene and never hidden
  // (a hidden light leaves the renderer's light list), so the count of lights
  // never changes: a change would recompile every lit material mid-Duel.
  const light = new PointLight(main, 0, look.point.light.distance, 2);
  object.add(light);

  let time = 0;
  let kick = 0;
  // Sparks owed to the spray: fractional counts carried frame to frame.
  let owed = 0;
  const beamAxis = new Vector3();
  const side = new Vector3();

  /** Sprays the sparks owed for `seconds`, mostly sideways off the beam. */
  const spray = (at: Point3, seconds: number) => {
    owed += look.sparks.rate * seconds;

    for (let spark = 0; owed >= 1; spark += 1, owed -= 1) {
      side.set(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1);
      // Take most of the beam's direction out, so the spray fans sideways.
      side.addScaledVector(beamAxis, -0.85 * side.dot(beamAxis)).normalize();

      sparks.emit(at, spark % 3 === 0 ? hot : main, {
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

  return {
    handle: (events) => {
      if (events.some((event) => event.type === "clash-pump")) {
        kick = 1;
      }
    },
    object,
    update: (previous, current, alpha, seconds, visibleTip) => {
      time += seconds;
      clock.value = time;
      kick = Math.max(kick - look.point.kickFade * seconds, 0);

      if (!current) {
        effect.visible = false;
        light.intensity = 0;
        owed = 0;

        return;
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

      const point = {
        x: lerp(from.x, to.x, along),
        y: lerp(from.y, to.y, along),
        z: lerp(from.z, to.z, along),
      };

      beamAxis.set(to.x - from.x, to.y - from.y, to.z - from.z).normalize();

      // Two incommensurate flickers, so the beam never visibly loops.
      const flicker =
        1 + 0.12 * Math.sin(time * 47) + 0.08 * Math.sin(time * 83 + 1);

      halves[0].place(from, point, flicker);
      halves[1].place(to, point, flicker);

      const pulse =
        1 + look.point.pulse * Math.sin(time * 31) + look.point.kick * kick;

      ball.position.set(point.x, point.y, point.z);
      ball.scale.setScalar(look.point.core * pulse);
      glow.position.copy(ball.position);
      glow.scale.setScalar(look.point.glow.size * pulse);
      corona.position.copy(ball.position);
      corona.scale.setScalar(look.point.corona.size * (0.9 + 0.1 * pulse));
      light.position.copy(ball.position);
      light.intensity = look.point.light.intensity * pulse * flicker;

      // A pump throws a fresh fan of sparks on top of the steady spray.
      spray(point, seconds * (1 + 3 * kick));
    },
  };
};
