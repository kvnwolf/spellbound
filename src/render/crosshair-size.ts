/**
 * How far from the screen centre a point `angle` radians off the camera's
 * view axis lands, in pixels, for a perspective camera of vertical field of
 * view `fovDegrees` on a canvas `heightPixels` tall. The same on any screen
 * axis, since pixels are square. The reticle's circle has the Aim Assist
 * angle as its radius, so it marks where a rival's body must reach to be
 * assisted.
 */
export const offAxisPixels = (
  angle: number,
  fovDegrees: number,
  heightPixels: number
) =>
  (Math.tan(angle) / Math.tan((fovDegrees * Math.PI) / 360)) *
  (heightPixels / 2);
