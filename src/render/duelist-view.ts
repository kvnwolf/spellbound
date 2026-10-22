/**
 * A blockout Duelist: robe, head, pointed hat and a Wand held out in front,
 * tinted by Team. It only reads presentation samples; the procedural wizard
 * and its poses come later.
 */
import {
  BoxGeometry,
  ConeGeometry,
  Group,
  Mesh,
  MeshStandardNodeMaterial,
  SphereGeometry,
} from "three/webgpu";

import type { DuelistSample } from "./interpolate";

export interface DuelistView {
  readonly object: Group;
  readonly show: (sample: DuelistSample) => void;
}

const skin = new MeshStandardNodeMaterial({ color: "#d9b38c", roughness: 0.7 });
const wood = new MeshStandardNodeMaterial({ color: "#4a2f1d", roughness: 0.6 });

export const createDuelistView = (robeColor: string): DuelistView => {
  const robeMaterial = new MeshStandardNodeMaterial({
    color: robeColor,
    roughness: 0.8,
  });

  const object = new Group();

  const robe = new Mesh(new ConeGeometry(0.45, 1.5, 24), robeMaterial);
  robe.position.y = 0.75;

  const head = new Mesh(new SphereGeometry(0.2, 24, 16), skin);
  head.position.y = 1.62;

  const hat = new Mesh(new ConeGeometry(0.24, 0.55, 24), robeMaterial);
  hat.position.y = 1.98;

  // The Wand points along the model's +z, which `show` turns toward the facing.
  const wand = new Mesh(new BoxGeometry(0.03, 0.03, 0.4), wood);
  wand.position.set(0.28, 1.15, 0.35);

  object.add(robe, head, hat, wand);

  return {
    object,
    show: (sample) => {
      object.position.set(sample.position.x, 0, sample.position.z);
      object.rotation.y = Math.atan2(sample.facing.x, sample.facing.z);
    },
  };
};
