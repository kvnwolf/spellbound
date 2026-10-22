/**
 * The castle courtyard at night. The Arena itself is a flagstone floor ringed
 * by a low parapet on its bounds, with a fluted stone column for every piece
 * of Cover, built from the same Arena layout the simulation collides with.
 * Around it rise tall castle walls and corner towers with lit windows, kept
 * well back so the camera never ends up inside them.
 *
 * Light: moonlight is the key (the only shadow-casting light), a dim cold sky
 * fill, and warm flickering torches on the parapet. Fog and low ground mist
 * fade everything into a sky whose horizon shares the fog colour.
 */
import { normalWorldGeometry } from "three/tsl";
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  HemisphereLight,
  InstancedMesh,
  LatheGeometry,
  Mesh,
  Object3D,
  PlaneGeometry,
  Scene,
  Vector2,
  Vector3,
} from "three/webgpu";
import type { MeshStandardNodeMaterial } from "three/webgpu";

import type { ArenaLayout } from "../duel/duel";
import { tuning } from "../tuning";
import { createFountain } from "./courtyard/fountain";
import {
  createAshlarMaterial,
  createColumnMaterial,
  createFlagstoneMaterial,
  createSlateMaterial,
  createWindowMaterial,
} from "./courtyard/materials";
import { moonDirection, nightFog, skyRadiance } from "./courtyard/sky";
import { createTorches } from "./courtyard/torches";

type CourtyardSettings = typeof tuning.courtyard;

const parapetHeight = 1;
const parapetThickness = 0.6;

/** The castle walls stand this far outside the Arena bounds: beyond the camera's reach. */
const outerSetback = 7.5;
const outerWallHeight = 9;
const outerWallThickness = 1.6;
const towerRadius = 2.6;
const towerHeight = 14;

/** Marks a mesh as casting and receiving the moon's shadow. */
const shadowed = <T extends Mesh>(mesh: T, cast = true): T => {
  mesh.castShadow = cast;
  mesh.receiveShadow = true;

  return mesh;
};

/** The low wall on the Arena bounds, with a capstone running along its top. */
const createParapet = (
  bounds: ArenaLayout["bounds"],
  stone: MeshStandardNodeMaterial
): Mesh[] => {
  const width = bounds.halfWidth * 2 + parapetThickness * 2;
  const depth = bounds.halfDepth * 2;
  const capLift = parapetHeight + 0.06;
  const offsetX = bounds.halfWidth + parapetThickness / 2;
  const offsetZ = bounds.halfDepth + parapetThickness / 2;

  const sides: [BoxGeometry, BoxGeometry, number, number][] = [
    [
      new BoxGeometry(width, parapetHeight, parapetThickness),
      new BoxGeometry(width + 0.16, 0.12, parapetThickness + 0.16),
      0,
      -offsetZ,
    ],
    [
      new BoxGeometry(width, parapetHeight, parapetThickness),
      new BoxGeometry(width + 0.16, 0.12, parapetThickness + 0.16),
      0,
      offsetZ,
    ],
    [
      new BoxGeometry(parapetThickness, parapetHeight, depth),
      new BoxGeometry(parapetThickness + 0.16, 0.12, depth),
      -offsetX,
      0,
    ],
    [
      new BoxGeometry(parapetThickness, parapetHeight, depth),
      new BoxGeometry(parapetThickness + 0.16, 0.12, depth),
      offsetX,
      0,
    ],
  ];

  return sides.flatMap(([wallGeometry, capGeometry, x, z]) => {
    const wall = shadowed(new Mesh(wallGeometry, stone));
    const cap = shadowed(new Mesh(capGeometry, stone));

    wall.position.set(x, parapetHeight / 2, z);
    cap.position.set(x, capLift, z);

    return [wall, cap];
  });
};

/** A fluted column on a square plinth, with a moulded base and capital. */
const createColumn = (
  radius: number,
  material: MeshStandardNodeMaterial,
  plinth: MeshStandardNodeMaterial
): Object3D => {
  const column = new Object3D();
  // The shaft is the Cover circle Spells stop on; the mouldings and plinth
  // barely overhang it, so Duelists brushing the column don't sink into stone.
  const shaft = radius;

  const profile = [
    [radius * 1.12, 0.3],
    [radius * 1.12, 0.38],
    [radius * 1.05, 0.46],
    [shaft, 0.55],
    // A slight swelling (entasis) a third of the way up.
    [shaft * 1.03, 1.6],
    [shaft * 0.92, 3.5],
    [shaft * 1.05, 3.62],
    [radius * 1.3, 3.85],
    [radius * 1.3, 3.92],
    [0, 3.92],
  ].map(([x = 0, y = 0]) => new Vector2(x, y));

  const body = shadowed(new Mesh(new LatheGeometry(profile, 40), material));

  const base = shadowed(
    new Mesh(new BoxGeometry(radius * 2.3, 0.3, radius * 2.3), plinth)
  );

  const abacus = shadowed(
    new Mesh(new BoxGeometry(radius * 2.8, 0.2, radius * 2.8), plinth)
  );

  base.position.y = 0.15;
  abacus.position.y = 4.02;
  column.add(body, base, abacus);

  return column;
};

/**
 * The castle around the courtyard: four tall walls with crenellations, a
 * tower at each corner with a slate roof, and a scatter of lit windows.
 */
const createCastle = (
  bounds: ArenaLayout["bounds"],
  settings: CourtyardSettings
): Object3D => {
  const castle = new Object3D();
  const wallStone = createAshlarMaterial("#4d4a49", [1.3, 0.62]);
  const halfX = bounds.halfWidth + outerSetback;
  const halfZ = bounds.halfDepth + outerSetback;
  const along = halfX * 2 + outerWallThickness;
  const across = halfZ * 2 + outerWallThickness;

  const walls: [number, number, number, number][] = [
    [along, outerWallThickness, 0, -halfZ - outerWallThickness / 2],
    [along, outerWallThickness, 0, halfZ + outerWallThickness / 2],
    [outerWallThickness, across, -halfX - outerWallThickness / 2, 0],
    [outerWallThickness, across, halfX + outerWallThickness / 2, 0],
  ];

  // The castle is backdrop: it receives moonlight but casts no shadow into
  // the Arena, so the moon can sit low without darkening half the floor.
  for (const [width, depth, x, z] of walls) {
    const wall = shadowed(
      new Mesh(new BoxGeometry(width, outerWallHeight, depth), wallStone),
      false
    );

    wall.position.set(x, outerWallHeight / 2, z);
    castle.add(wall);
  }

  // Merlons along the top of every wall, one instanced draw.
  const merlonSpacing = 1.7;
  const merlonSpots: [number, number, number][] = [];

  for (let x = -halfX; x <= halfX; x += merlonSpacing) {
    merlonSpots.push([x, -halfZ - 0.4, 0], [x, halfZ + 0.4, 0]);
  }

  for (let z = -halfZ; z <= halfZ; z += merlonSpacing) {
    merlonSpots.push([-halfX - 0.4, z, 1], [halfX + 0.4, z, 1]);
  }

  const merlons = new InstancedMesh(
    new BoxGeometry(0.9, 1.1, 0.8),
    wallStone,
    merlonSpots.length
  );

  const placement = new Object3D();

  for (const [index, [x, z, turn]] of merlonSpots.entries()) {
    placement.position.set(x, outerWallHeight + 0.55, z);
    placement.rotation.y = (turn * Math.PI) / 2;
    placement.updateMatrix();
    merlons.setMatrixAt(index, placement.matrix);
  }

  merlons.receiveShadow = true;
  castle.add(merlons);

  const slate = createSlateMaterial();

  for (const [x, z] of [
    [-halfX, -halfZ],
    [halfX, -halfZ],
    [-halfX, halfZ],
    [halfX, halfZ],
  ] as const) {
    const tower = shadowed(
      new Mesh(
        new CylinderGeometry(towerRadius, towerRadius * 1.08, towerHeight, 32),
        wallStone
      ),
      false
    );

    const roof = new Mesh(
      new ConeGeometry(towerRadius * 1.25, towerRadius * 2.4, 32),
      slate
    );

    tower.position.set(x, towerHeight / 2, z);
    roof.position.set(x, towerHeight + towerRadius * 1.2, z);
    castle.add(tower, roof);
  }

  // Lit windows on the inner faces of the walls and towers.
  const windowMaterial = createWindowMaterial(settings.windowRadiance);
  const windowGeometry = new PlaneGeometry(1, 1);

  const windows: [number, number, number, number][] = [
    // x, y, z, facing (radians about y)
    [-6, 5.6, -halfZ + 0.01, 0],
    [5, 6.2, -halfZ + 0.01, 0],
    [-halfX + 0.01, 5.4, -6, Math.PI / 2],
    [halfX - 0.01, 6, 3, -Math.PI / 2],
    [halfX - 0.01, 4.8, -9, -Math.PI / 2],
    [2, 5.8, halfZ - 0.01, Math.PI],
    [-halfX + 1.85, 10.5, -halfZ + 1.85, Math.PI / 4],
    [halfX - 1.85, 9.6, -halfZ + 1.85, -Math.PI / 4],
  ];

  for (const [x, y, z, facing] of windows) {
    const pane = new Mesh(windowGeometry, windowMaterial);

    pane.position.set(x, y, z);
    pane.rotation.y = facing;
    pane.scale.set(0.8, 1.5, 1);
    castle.add(pane);
  }

  return castle;
};

/**
 * Torch stands on the parapet: two on each end and two on each side, spread
 * evenly, so warm pools of light ring the Arena. None sits on the centre line
 * behind a spawn, where the over-the-shoulder camera sits most of the time.
 */
export const torchSpots = (bounds: ArenaLayout["bounds"]): Vector3[] => {
  const x = bounds.halfWidth + parapetThickness / 2;
  const z = bounds.halfDepth + parapetThickness / 2;
  const endOffset = bounds.halfWidth / 2;
  const sideOffset = bounds.halfDepth / 2;

  return [-1, 1].flatMap((side) => [
    new Vector3(side * endOffset, 0, -z),
    new Vector3(side * endOffset, 0, z),
    new Vector3(side * x, 0, -sideOffset),
    new Vector3(side * x, 0, sideOffset),
  ]);
};

/** The moon: the key light and the only shadow caster, its box fitted to the Arena. */
const createMoonlight = (
  bounds: ArenaLayout["bounds"],
  settings: CourtyardSettings
): DirectionalLight => {
  const { moon, shadows } = settings;
  const light = new DirectionalLight(moon.lightColor, moon.lightIntensity);
  // Covers the Arena's bounding circle from any moon direction.
  const reach = Math.hypot(bounds.halfWidth, bounds.halfDepth) + shadows.margin;
  const distance = 40;

  light.position.copy(moonDirection(moon).multiplyScalar(distance));
  light.castShadow = true;
  light.shadow.mapSize.set(shadows.mapSize, shadows.mapSize);
  light.shadow.bias = shadows.bias;
  light.shadow.normalBias = shadows.normalBias;
  Object.assign(light.shadow.camera, {
    bottom: -reach,
    far: distance + reach,
    left: -reach,
    near: distance - reach,
    right: reach,
    top: reach,
  });
  light.shadow.camera.updateProjectionMatrix();

  return light;
};

/** Builds the courtyard scene for `layout`. */
export const createCourtyardScene = (
  layout: ArenaLayout,
  settings: CourtyardSettings = tuning.courtyard
): Scene => {
  const { bounds } = layout;
  const scene = new Scene();

  scene.backgroundNode = skyRadiance(normalWorldGeometry.normalize(), settings);

  scene.fogNode = nightFog(settings);

  const moonlight = createMoonlight(bounds, settings);

  const fill = new HemisphereLight(
    settings.skyFill.sky,
    settings.skyFill.ground,
    settings.skyFill.intensity
  );

  scene.add(moonlight, moonlight.target, fill);

  const floor = shadowed(
    new Mesh(
      new PlaneGeometry(
        (bounds.halfWidth + outerSetback) * 2 + 4,
        (bounds.halfDepth + outerSetback) * 2 + 4
      ),
      createFlagstoneMaterial(settings)
    ),
    false
  );

  floor.rotation.x = -Math.PI / 2;

  const parapetStone = createAshlarMaterial();
  const columnStone = createColumnMaterial();

  scene.add(
    floor,
    ...createParapet(bounds, parapetStone),
    createCastle(bounds, settings),
    createFountain(parapetStone, settings),
    createTorches(torchSpots(bounds), parapetStone, settings.torch)
  );

  for (const cover of layout.cover) {
    const column = createColumn(cover.radius, columnStone, parapetStone);

    column.position.set(cover.center.x, 0, cover.center.z);
    scene.add(column);
  }

  return scene;
};
