/**
 * Builds the rigged wizard from the CC0 Quaternius packs, once, on a
 * developer machine (never in CI): `bun scripts/build-models.ts <packs>`,
 * where `<packs>` is the folder the four Standard zips were extracted into
 * (Universal Base Characters, Modular Character Outfits – Fantasy and
 * Universal Animation Library 1 and 2). It writes `public/models/wizard.glb`:
 *
 * - the Ranger outfit (the hood kept apart so a Team can leave it off) on
 *   the outfit's skeleton, with only the head, eyes and brows of the
 *   Superhero base body (the outfit covers the rest);
 * - the animation clips the Duelist view plays, taken from the in-place
 *   (non root-motion) libraries: rotations only, plus the pelvis
 *   translation rescaled to this body, so the clips never stretch its
 *   bones; the one-handed spell clips are mirrored onto the right hand,
 *   which holds the Wand, and `Grip` is the right hand's fist from
 *   `Sword_Idle`;
 * - merged meshes, Meshopt-compressed quantised geometry and animation,
 *   and textures resized and re-encoded as WebP.
 *
 * The packs are data only: this script reads them and never runs anything
 * from them.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { Node, NodeIO } from "@gltf-transform/core";
import type {
  Animation,
  Document,
  GLTF,
  JSONDocument,
  Primitive,
  TypedArray,
} from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import {
  compactPrimitive,
  dedup,
  joinPrimitives,
  mergeDocuments,
  meshopt,
  prune,
  resample,
  simplifyPrimitive,
  textureCompress,
  unpartition,
  weldPrimitive,
} from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
import { Quaternion } from "three";

const [packs, outDir = "public/models"] = process.argv.slice(2);

if (packs === undefined || !existsSync(packs)) {
  throw new Error(
    "Usage: bun scripts/build-models.ts <extracted packs folder>"
  );
}

/** The clips the view plays, from each library; `mirror` moves a left-handed clip to the right hand. */
const clips: readonly {
  library: "ual1" | "ual2";
  name: string;
  mirror?: boolean;
}[] = [
  { library: "ual1", name: "Idle_Loop" },
  { library: "ual1", name: "Walk_Loop" },
  { library: "ual1", name: "Jog_Fwd_Loop" },
  { library: "ual1", name: "Sprint_Loop" },
  { library: "ual1", name: "Roll" },
  { library: "ual1", name: "Jump_Loop" },
  { library: "ual1", name: "Jump_Land" },
  { library: "ual1", mirror: true, name: "Spell_Simple_Idle_Loop" },
  { library: "ual1", mirror: true, name: "Spell_Simple_Shoot" },
  { library: "ual1", name: "Hit_Chest" },
  { library: "ual1", name: "Hit_Head" },
  { library: "ual1", name: "Death01" },
  { library: "ual1", mirror: true, name: "PickUp_Table" },
  { library: "ual1", name: "Push_Loop" },
  { library: "ual1", name: "Crouch_Idle_Loop" },
  { library: "ual2", name: "Consume" },
  { library: "ual2", name: "Hit_Knockback" },
  { library: "ual2", name: "Idle_Shield_Loop" },
  { library: "ual2", name: "Idle_Shield_Break" },
  { library: "ual2", name: "Shield_OneShot" },
  { library: "ual2", name: "OverhandThrow" },
  { library: "ual2", name: "LayToIdle" },
];

/** Meshes simplified (share of vertices kept): dense parts that read the same with fewer triangles. */
const simplified = new Map([
  ["Male_Ranger_Arms_Bracer", 0.5],
  ["Male_Ranger_Feet_Boots", 0.45],
]);

/** Finds a file by name anywhere under the packs folder (the first glTF export of it). */
const find = (name: string): string => {
  const stack = [packs];

  while (stack.length > 0) {
    const folder = stack.pop() ?? "";

    for (const entry of readdirSync(folder)) {
      const file = path.join(folder, entry);

      if (statSync(file).isDirectory()) {
        stack.push(file);
      } else if (entry === name) {
        return file;
      }
    }
  }

  throw new Error(`${name} not found under ${packs}`);
};

await MeshoptEncoder.ready;

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder });

/**
 * Reads a .gltf whose image references may be stale (the packs name some
 * `*_png.png` that ship as `*.png`); an image that cannot be found is left
 * empty and its texture dropped later.
 */
const isGltf = (value: unknown): value is GLTF.IGLTF =>
  typeof value === "object" && value !== null && "asset" in value;

const readGltf = async (file: string) => {
  if (file.endsWith(".glb")) {
    return await io.read(file);
  }

  const folder = path.dirname(file);
  const json: unknown = JSON.parse(readFileSync(file, "utf-8"));

  if (!isGltf(json)) {
    throw new Error(`${file} is not glTF`);
  }

  const resources: JSONDocument["resources"] = {};

  for (const { uri = "" } of json.buffers ?? []) {
    resources[uri] = readFileSync(path.join(folder, decodeURIComponent(uri)));
  }

  for (const { uri = "" } of json.images ?? []) {
    const found = [
      decodeURIComponent(uri),
      decodeURIComponent(uri).replace("_png.png", ".png"),
    ]
      .map((each) => path.join(folder, each))
      .find((each) => existsSync(each));

    resources[uri] =
      found === undefined ? new Uint8Array() : readFileSync(found);
  }

  return await io.readJSON({ json, resources });
};

const byName = (nodes: readonly Node[]) =>
  new Map(nodes.map((node) => [node.getName(), node]));

const outfit = await readGltf(find("Male_Ranger.gltf"));
const base = await readGltf(find("Superhero_Male_FullBody.gltf"));

const libraries = {
  ual1: await readGltf(find("UAL1_Standard.glb")),
  ual2: await readGltf(find("UAL2_Standard.glb")),
};

const doc: Document = outfit;
const root = doc.getRoot();
const [skin] = root.listSkins();
const [scene] = root.listScenes();

if (!skin || !scene) {
  throw new Error("The outfit has no skin or scene");
}

const armature = scene
  .listChildren()
  .find((node) => node.getName() === "Armature");

if (!armature) {
  throw new Error("The outfit has no Armature");
}

const joints = skin.listJoints();

const jointIndex = new Map(
  joints.map((joint, index) => [joint.getName(), index])
);

// The base body's head, eyes and brows join the outfit's skeleton. Both
// skeletons share the spine, neck and head joints exactly, so the base
// meshes bind to the outfit's skin as they are.
const baseNodes = new Set(base.getRoot().listNodes());
const merged = mergeDocuments(doc, base);

for (const node of baseNodes) {
  const copy = merged.get(node);

  if (!(copy instanceof Node) || !copy.getMesh()) {
    continue;
  }

  copy.setSkin(skin);
  armature.addChild(copy);
}

// Only the head (and neck) of the base body: the outfit dresses the rest.
const headJoints = new Set(
  ["Head", "neck_01"].map((name) => jointIndex.get(name))
);

const keepHead = (primitive: Primitive) => {
  const indices = primitive.getIndices();
  const jointsAttribute = primitive.getAttribute("JOINTS_0");
  const weights = primitive.getAttribute("WEIGHTS_0");

  if (!indices || !jointsAttribute || !weights) {
    throw new Error("The base body is not skinned");
  }

  const jointRow: number[] = [];
  const weightRow: number[] = [];

  const onHead = (vertex: number) => {
    jointsAttribute.getElement(vertex, jointRow);
    weights.getElement(vertex, weightRow);

    let share = 0;

    for (let slot = 0; slot < jointRow.length; slot += 1) {
      if (headJoints.has(jointRow[slot])) {
        share += weightRow[slot] ?? 0;
      }
    }

    return share >= 0.5;
  };

  const kept: number[] = [];
  const all = indices.getArray() ?? [];

  for (let at = 0; at < all.length; at += 3) {
    const corner = [all[at] ?? 0, all[at + 1] ?? 0, all[at + 2] ?? 0];

    if (corner.every(onHead)) {
      kept.push(...corner);
    }
  }

  indices.setArray(new Uint32Array(kept));
  compactPrimitive(primitive);
};

for (const mesh of root.listMeshes()) {
  if (mesh.getName().startsWith("Sphere.005")) {
    mesh.setName("Face");

    for (const primitive of mesh.listPrimitives()) {
      keepHead(primitive);
    }
  }
}

// Drop the base's own skeleton, skin and scene.
for (const extra of root.listScenes().slice(1)) {
  extra.dispose();
}

for (const extra of root.listSkins().slice(1)) {
  extra.dispose();
}

for (const node of baseNodes) {
  const copy = merged.get(node);

  if (copy instanceof Node && !copy.getMesh()) {
    copy.dispose();
  }
}

// Unused attributes (extra UV sets, all-white vertex colours).
for (const mesh of root.listMeshes()) {
  for (const primitive of mesh.listPrimitives()) {
    for (const semantic of primitive.listSemantics()) {
      if (/^(?:COLOR_|TEXCOORD_[1-9])/u.test(semantic)) {
        primitive.setAttribute(semantic, null);
      }
    }

    const keep = simplified.get(mesh.getName());

    if (keep !== undefined) {
      weldPrimitive(primitive);
      simplifyPrimitive(primitive, {
        error: 0.002,
        ratio: keep,
        simplifier: MeshoptSimplifier,
      });
    }
  }
}

/**
 * One skinned mesh per material, named for the view: every outfit part
 * but the hood joins into `Outfit` (one draw); the hood stays `Hood` so a
 * Team can leave it off.
 */
const meshNames = new Map([
  ["MI_Eyes", "Eyes"],
  ["MI_Hair_1", "Brows"],
  ["MI_Ranger", "Outfit"],
  ["MI_Regular_Male", "Hands"],
  ["MI_Superhero_Male", "Face"],
]);

const groups = new Map<string, Primitive[]>();

for (const node of armature.listChildren()) {
  const mesh = node.getMesh();

  if (!mesh || node.getSkin() !== skin) {
    continue;
  }

  for (const primitive of mesh.listPrimitives()) {
    const material = primitive.getMaterial()?.getName() ?? "";

    const group =
      node.getName() === "Male_Ranger_Head_Hood"
        ? "Hood"
        : (meshNames.get(material) ?? material);

    groups.set(group, [...(groups.get(group) ?? []), primitive]);
  }
}

const oldNodes = armature.listChildren().filter((node) => node.getMesh());

for (const [name, primitives] of groups) {
  const joined =
    primitives.length === 1 ? primitives[0] : joinPrimitives(primitives);

  if (!joined) {
    continue;
  }

  const mesh = doc.createMesh(name).addPrimitive(joined);
  armature.addChild(doc.createNode(name).setMesh(mesh).setSkin(skin));
}

for (const node of oldNodes) {
  node.getMesh()?.dispose();
  node.dispose();
}

// ---------------------------------------------------------------- clips

/** An accessor's numbers as floats (keyframe times and values are floats in these libraries). */
const floats = (array: TypedArray | null | undefined) =>
  array instanceof Float32Array ? array : undefined;

/** A joint's mirror partner: `hand_l` for `hand_r` and back; the spine is its own. */
const partner = (name: string) => {
  if (name.endsWith("_l")) {
    return `${name.slice(0, -2)}_r`;
  }

  if (name.endsWith("_r")) {
    return `${name.slice(0, -2)}_l`;
  }

  return name;
};

const quaternion = (values: ArrayLike<number>, at: number) =>
  new Quaternion(values[at], values[at + 1], values[at + 2], values[at + 3]);

/**
 * A clip's rotations sampled at its keyframe times (every channel of these
 * libraries shares one timeline), by joint name.
 */
const rotationsOf = (animation: Animation) => {
  const tracks = new Map<string, Float32Array>();
  let times: Float32Array | undefined;

  for (const channel of animation.listChannels()) {
    const target = channel.getTargetNode();
    const sampler = channel.getSampler();

    if (!target || !sampler || channel.getTargetPath() !== "rotation") {
      continue;
    }

    times ??= floats(sampler.getInput()?.getArray());
    const values = floats(sampler.getOutput()?.getArray());

    if (values) {
      tracks.set(target.getName(), values);
    }
  }

  return { times: times ?? new Float32Array([0]), tracks };
};

/**
 * Mirrors a clip left to right: each joint takes its mirror partner's
 * rotation off the rest pose, reflected through the body's midplane (x = 0
 * in the Y-up frame), so the left hand's motion plays on the right.
 */
const mirrorRotations = (
  source: Document,
  rotations: ReturnType<typeof rotationsOf>
) => {
  const nodes = byName(source.getRoot().listNodes());

  // Joints parent first, from the skeleton's root.
  const order: Node[] = [];

  const visit = (node: Node) => {
    order.push(node);

    for (const child of node.listChildren()) {
      visit(child);
    }
  };

  const skeletonRoot = nodes.get("root");

  if (!skeletonRoot) {
    throw new Error("The library has no root joint");
  }

  visit(skeletonRoot);

  const restLocal = new Map(
    order.map((node) => [node.getName(), new Quaternion(...node.getRotation())])
  );

  const worldOf = (local: Map<string, Quaternion>) => {
    const world = new Map<string, Quaternion>();

    for (const node of order) {
      const parent = node.getParentNode();
      const parentWorld = parent ? world.get(parent.getName()) : undefined;
      const own = local.get(node.getName()) ?? new Quaternion();
      world.set(
        node.getName(),
        parentWorld ? parentWorld.clone().multiply(own) : own.clone()
      );
    }

    return world;
  };

  const restWorld = worldOf(restLocal);
  const mirrored = new Map<string, Float32Array>();

  for (const name of rotations.tracks.keys()) {
    mirrored.set(name, new Float32Array(rotations.times.length * 4));
  }

  for (let key = 0; key < rotations.times.length; key += 1) {
    const local = new Map(restLocal);

    for (const [name, values] of rotations.tracks) {
      local.set(name, quaternion(values, key * 4));
    }

    const world = worldOf(local);
    const mirroredWorld = new Map<string, Quaternion>();

    for (const node of order) {
      const name = node.getName();
      const other = partner(name);
      const posed = world.get(other) ?? new Quaternion();
      const rest = restWorld.get(other) ?? new Quaternion();
      // The partner's change from rest, reflected: (x, y, z, w) -> (x, -y, -z, w).
      const delta = posed.clone().multiply(rest.clone().invert());
      delta.set(delta.x, -delta.y, -delta.z, delta.w);
      mirroredWorld.set(
        name,
        delta.multiply(restWorld.get(name) ?? new Quaternion())
      );
    }

    for (const node of order) {
      const name = node.getName();
      const values = mirrored.get(name);
      const parent = node.getParentNode();

      const parentWorld = parent
        ? mirroredWorld.get(parent.getName())
        : undefined;

      if (!values) {
        continue;
      }

      const own = (mirroredWorld.get(name) ?? new Quaternion()).clone();

      const result = parentWorld
        ? parentWorld.clone().invert().multiply(own)
        : own;

      result.normalize().toArray(values, key * 4);
    }
  }

  return mirrored;
};

const targets = byName(joints);

const pelvisHeight = (document: Document) =>
  byName(document.getRoot().listNodes()).get("pelvis")?.getTranslation()[2] ??
  1;

/**
 * The keyframe values one channel keeps: every joint's rotations (mirrored
 * if asked) and the pelvis translation rescaled to this body; nothing else.
 */
const channelValues = (
  jointName: string,
  channelPath: string,
  output: Float32Array,
  scale: number,
  mirrored: Map<string, Float32Array> | undefined
) => {
  if (channelPath === "rotation") {
    return mirrored?.get(jointName) ?? new Float32Array(output);
  }

  if (channelPath !== "translation" || jointName !== "pelvis") {
    return null;
  }

  const values = new Float32Array(output).map((value) => value * scale);

  if (mirrored) {
    // The pelvis sways the other way: x in the root frame is the body's left.
    for (let at = 0; at < values.length; at += 3) {
      values[at] = -(values[at] ?? 0);
    }
  }

  return values;
};

/** Copies one clip into the output: rotations of every used joint, and the pelvis translation rescaled. */
const copyClip = (library: Document, name: string, mirror: boolean) => {
  const source = library
    .getRoot()
    .listAnimations()
    .find((each) => each.getName() === name);

  if (!source) {
    throw new Error(`Clip ${name} not found`);
  }

  const rotations = rotationsOf(source);
  const mirrored = mirror ? mirrorRotations(library, rotations) : undefined;
  const scale = pelvisHeight(doc) / pelvisHeight(library);
  const animation = doc.createAnimation(name);
  const [buffer = null] = root.listBuffers();

  const accessor = (array: Float32Array, type: "SCALAR" | "VEC3" | "VEC4") =>
    doc
      .createAccessor()
      .setArray(new Float32Array(array))
      .setType(type)
      .setBuffer(buffer);

  const input = accessor(new Float32Array(rotations.times), "SCALAR");

  for (const channel of source.listChannels()) {
    const jointName = channel.getTargetNode()?.getName() ?? "";
    const channelPath = channel.getTargetPath();
    const target = targets.get(jointName);
    const output = floats(channel.getSampler()?.getOutput()?.getArray());

    const values =
      target && output && jointName !== "root" && !jointName.includes("leaf")
        ? channelValues(jointName, channelPath ?? "", output, scale, mirrored)
        : undefined;

    if (!target || !values || !channelPath) {
      continue;
    }

    const sampler = doc
      .createAnimationSampler()
      .setInput(input)
      .setOutput(accessor(values, channelPath === "rotation" ? "VEC4" : "VEC3"))
      .setInterpolation("LINEAR");

    animation.addSampler(sampler);
    animation.addChannel(
      doc
        .createAnimationChannel()
        .setTargetNode(target)
        .setTargetPath(channelPath)
        .setSampler(sampler)
    );
  }
};

for (const { library, mirror = false, name } of clips) {
  copyClip(libraries[library], name, mirror);
}

// The right hand's fist round a grip, one key, fingers only.
{
  const sword = libraries.ual1
    .getRoot()
    .listAnimations()
    .find((each) => each.getName() === "Sword_Idle");

  const grip = doc.createAnimation("Grip");
  const [buffer = null] = root.listBuffers();

  const input = doc
    .createAccessor()
    .setArray(new Float32Array([0]))
    .setType("SCALAR")
    .setBuffer(buffer);

  for (const channel of sword?.listChannels() ?? []) {
    const jointName = channel.getTargetNode()?.getName() ?? "";
    const target = targets.get(jointName);
    const output = channel.getSampler()?.getOutput()?.getArray();

    if (
      !target ||
      !output ||
      channel.getTargetPath() !== "rotation" ||
      !/^(?:index|middle|ring|pinky|thumb)_0[1-3]_r$/u.test(jointName)
    ) {
      continue;
    }

    const sampler = doc
      .createAnimationSampler()
      .setInput(input)
      .setOutput(
        doc
          .createAccessor()
          .setArray(new Float32Array([...output].slice(0, 4)))
          .setType("VEC4")
          .setBuffer(buffer)
      )
      .setInterpolation("STEP");

    grip.addSampler(sampler);
    grip.addChannel(
      doc
        .createAnimationChannel()
        .setTargetNode(target)
        .setTargetPath("rotation")
        .setSampler(sampler)
    );
  }
}

// ---------------------------------------------------------------- output

await doc.transform(
  dedup(),
  resample({ tolerance: 1e-4 }),
  prune({ keepLeaves: true }),
  textureCompress({
    encoder: sharp,
    pattern: /Eye|Hair/u,
    quality: 85,
    resize: [256, 256],
    targetFormat: "webp",
  }),
  textureCompress({
    encoder: sharp,
    quality: 90,
    resize: [1024, 1024],
    slots: /normalTexture/u,
    targetFormat: "webp",
  }),
  textureCompress({
    encoder: sharp,
    quality: 82,
    resize: [1024, 1024],
    targetFormat: "webp",
  })
);

await doc.transform(
  unpartition(),
  meshopt({ encoder: MeshoptEncoder, level: "medium" })
);

await mkdir(outDir, { recursive: true });

const out = path.join(outDir, "wizard.glb");

await io.write(out, doc);

const { size } = statSync(out);

console.log(`${path.basename(out)}: ${(size / 1024 / 1024).toFixed(2)} MB`);

for (const mesh of root.listMeshes()) {
  const triangles = mesh
    .listPrimitives()
    .reduce(
      (sum, primitive) => sum + (primitive.getIndices()?.getCount() ?? 0) / 3,
      0
    );

  console.log(`  mesh ${mesh.getName()}: ${triangles} triangles`);
}

console.log(
  `  ${root.listAnimations().length} clips: ${root
    .listAnimations()
    .map((each) => each.getName())
    .join(", ")}`
);
