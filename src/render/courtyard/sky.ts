/**
 * The night sky, as a TSL radiance function of a world direction: a gradient
 * from the fog colour at the horizon to near-black at the zenith, twinkling
 * stars, slow wispy clouds and a bright moon with a soft halo. The moon is
 * scene-linear HDR well above the bloom threshold, so it glows. The same
 * function, without stars and clouds, gives the water its reflection.
 */
import {
  color,
  dot,
  exp,
  float,
  fog,
  max,
  mix,
  mx_fractal_noise_float,
  positionView,
  positionWorld,
  pow,
  smoothstep,
  time,
  vec2,
  vec3,
} from "three/tsl";
import { Vector3 } from "three/webgpu";
import type { Node } from "three/webgpu";

import type { Tuning } from "../../tuning";
import { cellHash, unit } from "./surface";

type SkySettings = Tuning["courtyard"];

const degrees = Math.PI / 180;

/** Unit vector toward the moon; the moonlight shines along its opposite. */
export const moonDirection = (moon: SkySettings["moon"]): Vector3 => {
  const azimuth = moon.azimuth * degrees;
  const elevation = moon.elevation * degrees;

  return new Vector3(
    -Math.cos(elevation) * Math.sin(azimuth),
    Math.sin(elevation),
    -Math.cos(elevation) * Math.cos(azimuth)
  );
};

/** Sky cells per radian: about four pixels each at the game's field of view. */
const starCells = 260;

const stars = (direction: Node<"vec3">, settings: SkySettings["sky"]) => {
  const scaled = direction.mul(starCells);
  const cell = scaled.floor();
  const presence = cellHash(cell);

  const jitter = vec3(
    cellHash(cell.add(17.1)),
    cellHash(cell.add(41.7)),
    cellHash(cell.add(73.3))
  );

  const offset = scaled.sub(cell).sub(jitter.mul(0.5).add(0.25)).length();
  const lit = smoothstep(1 - settings.starDensity, 1, presence).greaterThan(0);

  const twinkle = time
    .mul(jitter.x.mul(4).add(1.5))
    .add(presence.mul(91))
    .sin()
    .mul(0.35)
    .add(0.65);

  const warmth = mix(color("#bcd0ff"), color("#ffe3c0"), jitter.y);

  return warmth
    .mul(smoothstep(0.3, 0, offset))
    .mul(twinkle)
    .mul(jitter.z.mul(0.8).add(0.2))
    .mul(settings.starRadiance)
    .mul(lit.select(float(1), float(0)));
};

/**
 * Sky radiance toward `direction` (unit, world space). With `detail` off it
 * skips stars and clouds, a cheaper version for reflections.
 */
export const skyRadiance = (
  direction: Node<"vec3">,
  settings: SkySettings,
  detail = true
): Node<"vec3"> => {
  const { sky, moon, fog: haze } = settings;
  const up = unit(direction.y);
  const toMoon = moonDirection(moon);
  const moonVector = vec3(toMoon.x, toMoon.y, toMoon.z);
  const alignment = max(dot(direction, moonVector), float(0));

  // Gradient: the fog colour at the horizon, so geometry melts into the sky.
  const gradient = mix(
    mix(color(haze.color), color(sky.horizon), smoothstep(0, 0.12, up)),
    color(sky.zenith),
    pow(up, float(0.55))
  );

  // The moon: a disc with dark maria and limb darkening, in its own 2D frame.
  const right = new Vector3(0, 1, 0).cross(toMoon).normalize();
  const upward = toMoon.clone().cross(right).normalize();
  const discRadius = Math.sin(moon.discRadius * degrees);

  const onDisc = vec2(
    dot(direction, vec3(right.x, right.y, right.z)),
    dot(direction, vec3(upward.x, upward.y, upward.z))
  ).div(discRadius);

  const discDistance = onDisc.length();

  const disc = smoothstep(1, 0.96, discDistance).mul(
    alignment.greaterThan(0).select(float(1), float(0))
  );

  const maria = mx_fractal_noise_float(vec3(onDisc.mul(1.7), 3.3), 3)
    .mul(0.35)
    .add(0.8);

  const limb = unit(discDistance.mul(discDistance).oneMinus()).sqrt();

  const moonDisc = color("#fff3dc")
    .mul(disc)
    .mul(maria)
    .mul(limb.mul(0.35).add(0.65))
    .mul(moon.discRadiance);

  // Halo: a tight corona plus a broad glow lighting the sky around the moon.
  const halo = color("#8fa6dd").mul(
    pow(alignment, float(900))
      .mul(0.5)
      .add(pow(alignment, float(60)).mul(0.07))
      .add(pow(alignment, float(6)).mul(0.025))
  );

  if (!detail) {
    return gradient.add(halo).add(moonDisc);
  }

  // Clouds on a virtual plane overhead, drifting slowly; moonlit near the moon.
  const plane = direction.xz.div(direction.y.add(0.15));
  const drift = time.mul(sky.cloudDrift);

  const density = mx_fractal_noise_float(
    vec3(plane.mul(0.8).add(vec2(drift, drift.mul(0.4))), drift.mul(2)),
    5
  );

  const cloud = smoothstep(
    0.55 - sky.cloudCover,
    1.05 - sky.cloudCover,
    density.mul(0.5).add(0.5)
  ).mul(smoothstep(0.02, 0.25, up));

  const cloudColor = mix(
    color("#141a2a"),
    color("#5d6d99"),
    pow(alignment, float(12)).mul(0.7)
  );

  const clearSky = gradient
    .add(halo)
    .add(stars(direction, sky).mul(smoothstep(0.04, 0.3, up)));

  return mix(clearSky, cloudColor, cloud.mul(0.85)).add(
    moonDisc.mul(cloud.mul(0.55).oneMinus())
  );
};

/**
 * Fog: exponential-squared distance haze plus a layer of ground mist that
 * thickens below `mistHeight`, combined as two independent veils (their
 * optical depths add). Fades toward the sky's horizon colour.
 */
export const nightFog = (settings: SkySettings) => {
  const { fog: haze } = settings;
  const depth = positionView.z.negate();
  const below = max(float(haze.mistHeight).sub(positionWorld.y), float(0));
  const distanceDepth = depth.mul(haze.density);
  const mistDepth = below.mul(depth).mul(haze.mistDensity);

  const veil = exp(
    distanceDepth.mul(distanceDepth).add(mistDepth.mul(mistDepth)).negate()
  ).oneMinus();

  return fog(color(haze.color), veil);
};
