/**
 * How far from the screen centre a point `angle` radians off the camera's
 * view axis lands, in pixels, for a perspective camera of vertical field of
 * view `fovDegrees` on a canvas `heightPixels` tall. The same on any screen
 * axis, since pixels are square. The crosshair's arm tips sit at the Aim
 * Assist angle, so they mark where a rival's body must reach to be assisted.
 */
export const offAxisPixels = (
  angle: number,
  fovDegrees: number,
  heightPixels: number
) =>
  (Math.tan(angle) / Math.tan((fovDegrees * Math.PI) / 360)) *
  (heightPixels / 2);
