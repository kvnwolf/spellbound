/**
 * Small TSL building blocks the courtyard's procedural materials share: a
 * cell hash and a bump-mapped normal from any procedural height.
 */
import { dot, float, normalView, positionView, sin, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";

/** A stable pseudo-random value in [0, 1) for a grid cell (integer coordinates). */
export const cellHash = (cell: Node<"vec3">): Node<"float"> =>
  sin(dot(cell, vec3(127.1, 311.7, 74.7)))
    .mul(43_758.5453)
    .fract();

/**
 * Perturbs the view-space normal by the screen-space slope of a procedural
 * `height` (metres times `strength`), Mikkelsen's surface-gradient bump.
 * Works for any height node, unlike the stock `bumpMap`, which needs a texture.
 */
export const bumpNormal = (
  height: Node<"float">,
  strength: number
): Node<"vec3"> => {
  const dpdx = positionView.dFdx();
  const dpdy = positionView.dFdy();
  const r1 = dpdy.cross(normalView);
  const r2 = normalView.cross(dpdx);
  const det = dpdx.dot(r1);
  const scaled = height.mul(strength);

  const gradient = det
    .sign()
    .mul(scaled.dFdx().mul(r1).add(scaled.dFdy().mul(r2)));

  return det.abs().mul(normalView).sub(gradient).normalize();
};

/** Clamps a float node to [0, 1]. */
export const unit = (value: Node<"float">): Node<"float"> =>
  value.clamp(float(0), float(1));
