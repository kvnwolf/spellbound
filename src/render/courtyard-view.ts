/**
 * The courtyard blockout: night lighting, fog, a flagstone floor, low walls
 * on the Arena bounds and a stone column for every piece of Cover. Built from
 * the same Arena layout the simulation collides with. The premium pass
 * (moon, torches, fountain, shadows, bloom) comes later.
 */
import { checker, color, mix, positionWorld } from "three/tsl";
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshStandardNodeMaterial,
  PlaneGeometry,
  Scene,
} from "three/webgpu";

import type { ArenaLayout } from "../duel/duel";

const nightSky = new Color("#0b1020");
const wallHeight = 1.2;
const wallThickness = 0.6;
const columnHeight = 4;

/** Flagstones: a two-tone stone checker in world space, two metres a tile, so movement reads. */
const createFloorMaterial = () => {
  const material = new MeshStandardNodeMaterial({ roughness: 0.9 });
  material.colorNode = mix(
    color("#3d3f47"),
    color("#4a4c55"),
    checker(positionWorld.xz.mul(0.5))
  );

  return material;
};

const stone = new MeshStandardNodeMaterial({
  color: "#6b6a70",
  roughness: 0.85,
});

const createWalls = (bounds: ArenaLayout["bounds"]): Mesh[] => {
  const width = bounds.halfWidth * 2 + wallThickness * 2;
  const depth = bounds.halfDepth * 2;
  const along = new BoxGeometry(width, wallHeight, wallThickness);
  const across = new BoxGeometry(wallThickness, wallHeight, depth);
  const y = wallHeight / 2;
  const north = new Mesh(along, stone);
  const south = new Mesh(along, stone);
  const west = new Mesh(across, stone);
  const east = new Mesh(across, stone);

  north.position.set(0, y, -bounds.halfDepth - wallThickness / 2);
  south.position.set(0, y, bounds.halfDepth + wallThickness / 2);
  west.position.set(-bounds.halfWidth - wallThickness / 2, y, 0);
  east.position.set(bounds.halfWidth + wallThickness / 2, y, 0);

  return [north, south, west, east];
};

/** Builds the courtyard scene for `layout`. */
export const createCourtyardScene = (layout: ArenaLayout): Scene => {
  const scene = new Scene();
  scene.background = nightSky;
  scene.fog = new Fog(nightSky, 18, 48);

  // Cold moonlight from above plus a dim sky/ground fill.
  scene.add(new HemisphereLight("#5a6a9a", "#1a1712", 0.9));
  const moon = new DirectionalLight("#c4d2ff", 1.6);
  moon.position.set(-8, 16, -6);
  scene.add(moon);

  const floor = new Mesh(
    new PlaneGeometry(
      layout.bounds.halfWidth * 2 + 20,
      layout.bounds.halfDepth * 2 + 20
    ),
    createFloorMaterial()
  );

  floor.rotation.x = -Math.PI / 2;
  scene.add(floor, ...createWalls(layout.bounds));

  for (const cover of layout.cover) {
    const column = new Mesh(
      new CylinderGeometry(cover.radius, cover.radius * 1.1, columnHeight, 20),
      stone
    );

    column.position.set(cover.center.x, columnHeight / 2, cover.center.z);
    scene.add(column);
  }

  return scene;
};
