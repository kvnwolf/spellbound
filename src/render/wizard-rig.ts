import { clone } from "three/addons/utils/SkeletonUtils.js";
/**
 * One Duelist's wizard: a copy of the rigged CC0 model (`wizard-assets.ts`)
 * dressed for its Team in the outfit's own clothes (the far Team keeps the
 * outfit's hood), with what the packs do not have made in code and
 * attached to the rig's joints: the Wand in the right hand and the vial in
 * the left.
 *
 * A Training Dummy (`dummy-look.ts`) wears the same model re-dressed: the
 * outfit dark as a robe, wood where the forearms, hands, shins and feet
 * are (carved at every joint), and nothing under the hood but a dark void
 * holding the faint light of its enchantment.
 *
 * Every surface reads one shared set of causes, so its PBR channels agree:
 * the model's own texture maps (colour, normals, roughness), the Team's
 * colours (the outfit's cloth re-tinted from its green, its metal fittings
 * gold or silver, leather kept), how far the body has turned to stone
 * (colour and roughness both go to stone, never just one), and one rim of
 * light round the silhouette that adds the Team's own edge light, the
 * Lock-on glow, the Petrified rim, any Potion's aura and the flare of a
 * Spell landing, in its colour. The stone spreads from where Petrificus
 * Totalus struck, a cold glowing front racing over the body; a Burning
 * body's cloth smoulders like embers. Everything is dielectric: with no
 * environment map at night, a metal would render black.
 *
 * The rim is a cue for the body's outline, so it reads a smoothed normal:
 * mostly the limbs' own (out from the bone each vertex hangs on, the way a
 * capsule round that bone would face; the view moves the bones' segments
 * every frame), a little of the mesh's. The model's small, sharply curved
 * parts (straps, buckles, seams, fingers, folds) turn their own normals
 * edge-on within a pixel, and a rim read from them alone sparkles into
 * pixel-sized lines and dots that MSAA cannot smooth (it shades once a
 * pixel); the limbs' normal keeps the edge light on the silhouette.
 */
import {
  attribute,
  cameraPosition,
  color,
  exp,
  float,
  frontFacing,
  max,
  mix,
  mx_noise_float,
  normalWorldGeometry,
  positionGeometry,
  positionView,
  positionWorld,
  sin,
  smoothstep,
  texture,
  time,
  uniform,
  uniformArray,
  varying,
  vec3,
} from "three/tsl";
import {
  Bone,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  MeshPhysicalNodeMaterial,
  MeshStandardMaterial,
  MeshStandardNodeMaterial,
  Object3D,
  Quaternion,
  SkinnedMesh,
  SphereGeometry,
  Vector3,
} from "three/webgpu";
import type { Material, Node, Texture } from "three/webgpu";

import type { Tuning } from "../tuning";
import {
  bakeDummyCauses,
  dummyWood,
  grooveColor,
  hollowColor,
} from "./dummy-look";
import type { DummyLook } from "./dummy-look";
import type { WizardAssets } from "./wizard-assets";

type Duelist = Tuning["duelist"];

export type TeamLook = Duelist["teamLooks"][keyof Duelist["teamLooks"]];

/** The uniforms the view drives every frame, shared by all of a Duelist's surfaces. */
export interface WizardUniforms {
  /** Lock-on rim glow, 0 off to 1 the full mark. */
  readonly glowStrength: { value: number };
  /** How far the body has turned to stone: 0 flesh and cloth, 1 stone. */
  readonly petrify: { value: number };
  readonly potionTint: { value: Color };
  readonly potionGlow: { value: number };
  /** The full-Focus aura in the Wand's wood. */
  readonly auraStrength: { value: number };
  readonly vialTint: { value: Color };
  /** A Training Dummy's light inside its empty hood, scene-linear radiance. */
  readonly hollow: { value: number };
  /** A Spell landing: how hard the silhouette flares (0 to 1), and in what colour. */
  readonly hitGlow: { value: number };
  readonly hitTint: { value: Color };
  /** Where Petrificus Totalus struck (world), and how far the stone has spread from it, metres. */
  readonly stoneFrom: { value: Vector3 };
  readonly stoneFront: { value: number };
  /** How much the body smoulders with an Incendio Burn, 0 to 1. */
  readonly burn: { value: number };
}

/** The joints the view poses after the clips, by role. */
export interface WizardJoints {
  readonly pelvis: Bone;
  readonly spine: readonly [Bone, Bone, Bone];
  readonly neck: Bone;
  readonly head: Bone;
  /** Left then right, as `[left, right]`, for every pair. */
  readonly upperArms: readonly [Bone, Bone];
  readonly lowerArms: readonly [Bone, Bone];
  readonly hands: readonly [Bone, Bone];
  readonly thighs: readonly [Bone, Bone];
  readonly calves: readonly [Bone, Bone];
  readonly feet: readonly [Bone, Bone];
  /** The right hand's finger joints, which close round the Wand. */
  readonly fingers: readonly Bone[];
}

export interface WizardRig {
  /** The model, +z ahead and +x to its left, feet at its origin. */
  readonly model: Object3D;
  readonly joints: WizardJoints;
  /** The Wand, held in the right hand; its +y points from the grip to the tip. */
  readonly wand: Object3D;
  readonly wandStick: Group;
  /** The Wand tip, where Spells leave it. */
  readonly tip: Object3D;
  /** The vial the left hand raises while drinking. */
  readonly vial: Group;
  readonly uniforms: WizardUniforms;
  /** Moves the rim's limb segments onto the pose just drawn; call after posing. */
  readonly updateRim: () => void;
}

/** The settings the wizard's surfaces read. */
export interface WizardLookSettings {
  readonly duelist: Duelist;
  readonly glow: Tuning["lockOnGlow"];
  readonly stone: Tuning["petrifiedLook"];
  readonly aura: Tuning["wandAura"];
  readonly potion: Tuning["potionLook"];
  /** The flare of a Spell landing on the body. */
  readonly hit: Tuning["spellLook"]["hitFlare"];
  /** The embers on a Burning body's cloth. */
  readonly robe: Tuning["spellLook"]["burn"]["robe"];
}

/** A hex colour as a scene-linear vec3 node (decoded from sRGB once, as `color()` does). */
const rgb = (hex: string): Node<"vec3"> => {
  const { b, g, r } = new Color(hex);

  return vec3(r, g, b);
};

/** Marks a mesh as casting and receiving the moon's shadow. */
const shadowed = <T extends Mesh>(mesh: T): T => {
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  return mesh;
};

const isSkinned = (node: Object3D): node is SkinnedMesh =>
  node instanceof SkinnedMesh;

const isBone = (node: Object3D | undefined): node is Bone =>
  node instanceof Bone;

/** A surface with no cloth or metal in it: all leather, or wood. */
const bare = () => ({ cloth: float(0), metal: float(0) });

const restWorld = new Matrix4();
const wanted = new Matrix4();

/**
 * Attaches `part` to `joint` so that, in the model's rest pose, it sits at
 * `position` turned by `rotation` (both in the model frame); from then on
 * it moves with the joint.
 */
const mount = (
  joint: Object3D,
  part: Object3D,
  position: Vector3,
  rotation = new Quaternion()
) => {
  restWorld.copy(joint.matrixWorld).invert();
  wanted.compose(position, rotation, new Vector3(1, 1, 1));
  wanted.premultiply(restWorld);
  wanted.decompose(part.position, part.quaternion, part.scale);
  joint.add(part);
};

/**
 * Dresses a copy of the wizard for `team`; given `dummy`, as a Training
 * Dummy in that look instead.
 */
export const createWizardRig = (
  assets: WizardAssets,
  team: TeamLook,
  settings: WizardLookSettings,
  dummy?: DummyLook
): WizardRig => {
  const { aura, duelist, glow, hit, potion, robe, stone } = settings;
  const { look } = duelist;

  const uniforms = {
    auraStrength: uniform(0),
    burn: uniform(0),
    glowStrength: uniform(0),
    hitGlow: uniform(0),
    hitTint: uniform(new Color()),
    hollow: uniform(dummy?.hollowRadiance ?? 0),
    petrify: uniform(0),
    potionGlow: uniform(0),
    potionTint: uniform(new Color(potion.colors.wiggenweld)),
    stoneFrom: uniform(new Vector3()),
    stoneFront: uniform(stone.spreadReach),
    vialTint: uniform(new Color(potion.colors.wiggenweld)),
  };

  const { petrify } = uniforms;

  const model = clone(assets.template);
  model.updateMatrixWorld(true);

  const meshes = new Map<string, SkinnedMesh>();

  model.traverse((node) => {
    if (isSkinned(node)) {
      meshes.set(node.name, node);
    }
  });

  // Every mesh is bound to the one skin, so they share its joint order.
  const [first] = meshes.values();

  if (!first) {
    throw new Error("The wizard has no skinned mesh");
  }

  const { bones } = first.skeleton;

  // Each joint's segment in the world, from the joint to its first child
  // joint (a joint with none carries on from its parent), written every frame.
  const segmentStarts = bones.map(() => new Vector3());
  const segmentEnds = bones.map(() => new Vector3());
  const starts = uniformArray<"vec3">(segmentStarts, "vec3");
  const ends = uniformArray<"vec3">(segmentEnds, "vec3");

  const childOf = bones.map(
    (joint) => joint.children.find((child) => isBone(child)) ?? null
  );

  const updateLimbs = () => {
    for (const [index, joint] of bones.entries()) {
      const start = segmentStarts[index];
      const end = segmentEnds[index];
      const child = childOf[index];

      if (!start || !end) {
        continue;
      }

      joint.getWorldPosition(start);

      if (child) {
        child.getWorldPosition(end);
      } else if (joint.parent) {
        joint.parent.getWorldPosition(end);
        end.lerp(start, 1 + look.limbTipReach);
      } else {
        end.copy(start);
      }
    }
  };

  updateLimbs();

  // The limbs' normal, per vertex: out from the closest point on the
  // segment of each joint that moves the vertex, weighted as the skin weighs
  // them, so it is smooth along a limb and across its joints.
  const skinIndex = attribute("skinIndex", "uvec4");
  const skinWeight = attribute("skinWeight", "vec4");
  let limbSum: Node<"vec3"> = vec3(0, 0, 0);

  for (const lane of ["x", "y", "z", "w"] as const) {
    const start = starts.element(skinIndex[lane]);
    const span = ends.element(skinIndex[lane]).sub(start);
    const fromStart = positionWorld.sub(start);

    const along = fromStart.dot(span).div(span.dot(span).max(1e-6)).saturate();

    const radial = fromStart.sub(span.mul(along));
    limbSum = limbSum.add(
      radial.div(radial.length().max(1e-4)).mul(skinWeight[lane])
    );
  }

  const limbNormal = varying(limbSum, "v_limbNormal");
  const toCamera = cameraPosition.sub(positionWorld).normalize();

  // How far the stone has spread: everything within its front, measured from
  // where the Spell struck, the front's edge ragged with noise held still on
  // the figure (the model's rest frame).
  const fromStrike = positionWorld
    .sub(uniforms.stoneFrom)
    .length()
    .add(mx_noise_float(positionGeometry.mul(9)).mul(stone.spreadNoise))
    .toVar();

  const stoneShare = petrify
    .mul(
      smoothstep(
        uniforms.stoneFront.add(stone.spreadEdge),
        uniforms.stoneFront.sub(stone.spreadEdge),
        fromStrike
      )
    )
    .toVar();

  // The front glows cold as it races over the body, dying once it is done.
  const frost = color(stone.rimColor).mul(
    exp(
      fromStrike.sub(uniforms.stoneFront).div(stone.spreadEdge).pow(2).negate()
    )
      .mul(petrify)
      .mul(
        smoothstep(
          stone.spreadReach,
          stone.spreadReach * 0.6,
          uniforms.stoneFront
        )
      )
      .mul(stone.frontRadiance)
  );

  // A Burning body's cloth smoulders: embers of noise rising through it,
  // flickering, never on stone.
  const smoulder = mx_noise_float(
    positionGeometry.mul(robe.scale).sub(vec3(0, time.mul(robe.speed), 0))
  )
    .mul(0.5)
    .add(0.5);

  const embers = color(robe.color)
    .mul(smoothstep(robe.threshold, robe.threshold + 0.3, smoulder))
    .mul(
      sin(time.mul(17).add(positionGeometry.y.mul(5)))
        .mul(0.5)
        .add(0.5)
        .mul(robe.flicker)
        .oneMinus()
    )
    .mul(uniforms.burn.mul(robe.radiance))
    .mul(stoneShare.oneMinus());

  /**
   * The rim of light round a silhouette seen along `normal` (world): the
   * Team's own edge light (so the far Duelist reads against the dark
   * walls), the Lock-on glow, the cold Petrified rim, a Potion's aura and
   * the flare of a Spell landing (a rim in its colour and a little over
   * the whole body).
   */
  const rimOf = (normal: Node<"vec3">) => {
    const edge = normal.dot(toCamera).saturate().oneMinus().toVar();
    /** Fresnel: 1 where the surface turns away from the camera, sharper with `power`. */
    const silhouette = (power: number) => edge.pow(power);

    return color(team.rim)
      .mul(silhouette(look.rimPower))
      .mul(
        mix(
          float(look.rimNear),
          float(look.rimFar),
          smoothstep(
            look.rimNearDistance,
            look.rimFarDistance,
            positionView.length()
          )
        )
      )
      .mul(stoneShare.oneMinus())
      .add(
        color(glow.color)
          .mul(silhouette(glow.power))
          .mul(uniforms.glowStrength.mul(glow.radiance))
      )
      .add(
        color(stone.rimColor)
          .mul(silhouette(stone.rimPower))
          .mul(stoneShare.mul(stone.rimRadiance))
      )
      .add(
        uniforms.potionTint
          .mul(silhouette(potion.power))
          .mul(uniforms.potionGlow)
      )
      .add(
        uniforms.hitTint.mul(
          silhouette(hit.power)
            .mul(hit.radiance)
            .add(hit.fill)
            .mul(uniforms.hitGlow)
        )
      );
  };

  // The body's rim reads the limbs' smooth normal, with a little of the
  // mesh's own; the Wand, a plain stick, reads its own.
  const bodyRim = rimOf(
    mix(
      normalWorldGeometry,
      limbNormal.normalize(),
      look.rimSmoothing
    ).normalize()
  )
    .add(frost)
    .add(embers);

  const stickRim = rimOf(normalWorldGeometry);

  // Stone, mottled at a low frequency in the model's rest frame (the
  // geometry before skinning) so it holds still on the figure.
  const mottle = mx_noise_float(positionGeometry.mul(look.stoneMottleScale))
    .mul(0.5)
    .add(0.5);

  const stoneColor = rgb(stone.stoneColor).mul(
    mix(float(1 - look.stoneMottle), float(1), mottle)
  );

  /**
   * A dielectric surface whose colour and roughness both turn to stone with
   * the same weight. Given `inside`, it is two-sided, its back faces that
   * colour (never stone, and with no specular sheen: an empty dark does not
   * shine) glowing `glow`.
   */
  const surface = (
    base: Node<"vec3">,
    roughness: Node<"float">,
    normals: Texture | null = null,
    inside?: { color: Node<"vec3">; glow: Node<"vec3"> }
  ) => {
    const material = inside
      ? new MeshPhysicalNodeMaterial()
      : new MeshStandardNodeMaterial();

    const outside = mix(base, stoneColor, stoneShare);

    const rough = mix(roughness, float(look.stoneRoughness), stoneShare);

    material.metalnessNode = float(0);
    material.normalMap = normals;

    if (inside && material instanceof MeshPhysicalNodeMaterial) {
      material.side = DoubleSide;
      material.specularIntensityNode = frontFacing.select(float(1), float(0));
      material.colorNode = frontFacing.select(outside, inside.color);
      material.roughnessNode = frontFacing.select(rough, float(1));
      material.emissiveNode = frontFacing.select(bodyRim, inside.glow);
    } else {
      material.colorNode = outside;
      material.roughnessNode = rough;
      material.emissiveNode = bodyRim;
    }

    return material;
  };

  // The model's own texture maps, read before its materials are replaced.
  const loaded = new Map(
    [...meshes].map(([name, mesh]) => {
      const { material } = mesh;

      const standard =
        material instanceof MeshStandardMaterial ? material : null;

      return [
        name,
        {
          map: standard?.map ?? null,
          normal: standard?.normalMap ?? null,
          roughness: standard?.roughnessMap ?? null,
        },
      ] as const;
    })
  );

  const maps = (name: string) =>
    loaded.get(name) ?? { map: null, normal: null, roughness: null };

  /**
   * The outfit: its green cloth re-tinted to `cloth` (keeping the texture's
   * shading), its metal fittings (the ORM map's metal channel) to the
   * Team's metal, leather as it is.
   */
  const outfitMaterial = (cloth: string) => {
    const { map, normal, roughness } = maps("Outfit");

    if (!map || !roughness) {
      throw new Error("The wizard's outfit has no texture maps");
    }

    const base = texture(map).rgb;
    const orm = texture(roughness);
    const shade = base.dot(vec3(0.2126, 0.7152, 0.0722));
    const greenness = base.g.sub(max(base.r, base.b));
    const isCloth = smoothstep(look.clothMask[0], look.clothMask[1], greenness);
    const isMetal = smoothstep(0.3, 0.7, orm.b);
    const tinted = rgb(cloth).mul(shade.div(look.clothLuminance));
    const fitting = rgb(team.metal).mul(shade.div(look.metalLuminance));

    return surface(
      mix(mix(base, tinted, isCloth), fitting, isMetal),
      mix(orm.g, float(look.metalRoughness), isMetal),
      normal
    );
  };

  /** A plain textured surface: skin, eyes, brows. */
  const textured = (name: string, roughness: number) => {
    const { map, normal, roughness: roughnessMap } = maps(name);

    if (!map) {
      throw new Error(`The wizard's ${name} has no colour map`);
    }

    return surface(
      texture(map).rgb,
      roughnessMap ? texture(roughnessMap).g : float(roughness),
      normal
    );
  };

  const { hood } = team;

  /**
   * A Training Dummy's surface over `name`'s own maps: its cloth (weighted
   * `cloth`) re-tinted to `tint`, its metal (weighted `metal`) dull iron,
   * and the rest leather darkened or, on the wooden bones, wood carved at
   * the joints. The identities' weights sum to one by construction; their
   * roughnesses blend as alpha (roughness squared).
   */
  const dummySurface = (
    costume: DummyLook,
    name: string,
    tint: string,
    masks: (
      base: Node<"vec3">,
      orm: Node<"vec4"> | null
    ) => {
      cloth: Node<"float">;
      metal: Node<"float">;
    },
    inside?: { color: Node<"vec3">; glow: Node<"vec3"> }
  ) => {
    const { map, normal, roughness } = maps(name);

    if (!map) {
      throw new Error(`The wizard's ${name} has no colour map`);
    }

    const base = texture(map).rgb;
    const orm = roughness ? texture(roughness) : null;
    const own = orm ? orm.g : float(look.skinRoughness);
    const shade = base.dot(vec3(0.2126, 0.7152, 0.0722));
    const { cloth, metal } = masks(base, orm);
    const wood = dummyWood(costume);

    const clothShare = metal.oneMinus().mul(cloth);
    const rest = metal.oneMinus().mul(cloth.oneMinus());
    const carved = rest.mul(wood.share);
    const groove = carved.mul(wood.groove);
    const grain = carved.sub(groove);
    const leather = rest.sub(carved);

    const colour = rgb(tint)
      .mul(shade.div(look.clothLuminance))
      .mul(clothShare)
      .add(rgb(costume.metal).mul(shade.div(look.metalLuminance)).mul(metal))
      .add(base.mul(costume.leatherShade).mul(leather))
      .add(wood.color.mul(grain))
      .add(grooveColor(costume).mul(groove));

    const alpha = own
      .mul(own)
      .mul(clothShare.add(leather))
      .add(metal.mul(look.metalRoughness ** 2))
      .add(grain.mul(wood.roughness.mul(wood.roughness)))
      .add(groove.mul(costume.grooveRoughness ** 2));

    return surface(colour, alpha.sqrt(), normal, inside);
  };

  /** The outfit's cloth (green in its texture) and metal (its ORM map's metal channel). */
  const outfitMasks = (base: Node<"vec3">, orm: Node<"vec4"> | null) => ({
    cloth: smoothstep(
      look.clothMask[0],
      look.clothMask[1],
      base.g.sub(max(base.r, base.b))
    ),
    metal: orm ? smoothstep(0.3, 0.7, orm.b) : float(0),
  });

  /** The dark under a Training Dummy's hood, and the light it holds. */
  const hollowOf = (costume: DummyLook) => ({
    color: hollowColor(costume),
    glow: rgb(costume.hollowGlow).mul(uniforms.hollow),
  });

  /** Where a Training Dummy's face would be: the same dark, unlit and never stone. */
  const hollowSurface = (costume: DummyLook) => {
    const { color: dark, glow: light } = hollowOf(costume);
    const material = new MeshBasicNodeMaterial();
    material.colorNode = dark.add(light);

    return material;
  };

  /** The hood, two-sided: its outside cloth, its inside the empty dark. */
  const dummyHood = (costume: DummyLook) =>
    dummySurface(
      costume,
      "Outfit",
      costume.hood,
      outfitMasks,
      hollowOf(costume)
    );

  const dress = dummy
    ? new Map<string, () => Material>([
        ["Brows", () => hollowSurface(dummy)],
        ["Eyes", () => hollowSurface(dummy)],
        ["Face", () => hollowSurface(dummy)],
        ["Hands", () => dummySurface(dummy, "Hands", dummy.cloth, bare)],
        ["Hood", () => dummyHood(dummy)],
        [
          "Outfit",
          () => dummySurface(dummy, "Outfit", dummy.cloth, outfitMasks),
        ],
      ])
    : new Map([
        ["Brows", () => textured("Brows", look.skinRoughness)],
        ["Eyes", () => textured("Eyes", 0.3)],
        ["Face", () => textured("Face", look.skinRoughness)],
        ["Hands", () => textured("Hands", look.skinRoughness)],
        ["Hood", () => outfitMaterial(hood ?? team.cloth)],
        ["Outfit", () => outfitMaterial(team.cloth)],
      ]);

  for (const [name, mesh] of meshes) {
    const dressed = dress.get(name);

    if (!dressed) {
      throw new Error(`The wizard's ${name} has no surface`);
    }

    if (dummy && (name === "Hands" || name === "Outfit" || name === "Hood")) {
      bakeDummyCauses(mesh);
    }

    mesh.material = dressed();
    // Posed limbs leave the rest pose's bounds: the two wizards are always drawn.
    mesh.frustumCulled = false;
    shadowed(mesh);

    if (name === "Hood") {
      mesh.visible = dummy !== undefined || hood !== null;
    }

    // Under a Training Dummy's hood there is no face: no eyes, no brows.
    if (dummy && (name === "Eyes" || name === "Brows")) {
      mesh.visible = false;
    }
  }

  const bone = (name: string): Bone => {
    const found = model.getObjectByName(name);

    if (!isBone(found)) {
      throw new Error(`The wizard has no ${name} joint`);
    }

    return found;
  };

  const pair = (name: string) =>
    [bone(`${name}_l`), bone(`${name}_r`)] as const;

  const joints: WizardJoints = {
    calves: pair("calf"),
    feet: pair("foot"),
    fingers: [...assets.grip.keys()].map(bone),
    hands: pair("hand"),
    head: bone("Head"),
    lowerArms: pair("lowerarm"),
    neck: bone("neck_01"),
    pelvis: bone("pelvis"),
    spine: [bone("spine_01"), bone("spine_02"), bone("spine_03")],
    thighs: pair("thigh"),
    upperArms: pair("upperarm"),
  };

  const at = (name: string) => bone(name).getWorldPosition(new Vector3());

  // --- The Wand, in the right fist.

  // The Wand's own wood, glowing scarlet from within while the Focus is full,
  // with a bead of the Team's colour at the tip.
  const wood = surface(rgb(look.wood), float(look.woodRoughness));
  wood.emissiveNode = stickRim.add(
    color(aura.color).mul(float(aura.radiance).mul(uniforms.auraStrength))
  );
  const bead = new MeshStandardNodeMaterial({ roughness: 0.3 });
  bead.colorNode = color(team.rim);
  bead.emissiveNode = color(team.rim).mul(
    petrify.oneMinus().mul(look.tipRadiance)
  );

  const { length } = duelist.wand;
  const wand = new Object3D();
  const wandStick = new Group();

  const stick = shadowed(
    new Mesh(
      new CylinderGeometry(look.wandTipRadius, look.wandGripRadius, length, 8),
      wood
    )
  );

  stick.position.y = length / 2;
  const tipBead = new Mesh(new SphereGeometry(look.tipSize, 8, 6), bead);
  tipBead.position.y = length;
  wandStick.add(stick, tipBead);
  const tip = new Object3D();
  tip.position.y = length;
  wand.add(wandStick, tip);

  /**
   * A fist's frame at rest: `along` the fingers, `across` the knuckles from
   * the little finger to the index, and the palm's centre.
   */
  const fistOf = (side: "l" | "r") => {
    const wrist = at(`hand_${side}`);
    const knuckle = at(`middle_01_${side}`);
    const fingers = knuckle.clone().sub(wrist).normalize();

    const across = at(`index_01_${side}`)
      .sub(at(`pinky_01_${side}`))
      .normalize();

    // The palm faces down in the rest pose (arms out, palms to the floor).
    const palm = wrist
      .clone()
      .lerp(knuckle, duelist.grip.palmAlong)
      .addScaledVector(new Vector3(0, -1, 0), duelist.grip.palmDepth);

    return { across, fingers, palm };
  };

  const rightFist = fistOf("r");

  // The Wand leaves the fist between the thumb and the index, tipped toward the fingers.
  const wandAxis = rightFist.across
    .clone()
    .addScaledVector(rightFist.fingers, duelist.grip.tilt)
    .normalize();

  mount(
    joints.hands[1],
    wand,
    rightFist.palm.clone().addScaledVector(wandAxis, -duelist.grip.butt),
    new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), wandAxis)
  );

  // --- The vial, upright in the left fist.
  const glass = new MeshStandardNodeMaterial({ roughness: 0.2 });
  glass.colorNode = uniforms.vialTint.mul(0.4);
  glass.emissiveNode = uniforms.vialTint.mul(potion.vialRadiance);
  const vial = new Group();
  const flask = new Mesh(new CylinderGeometry(0.045, 0.06, 0.13, 12), glass);

  const flaskNeck = new Mesh(
    new CylinderGeometry(0.018, 0.022, 0.06, 8),
    glass
  );

  flaskNeck.position.y = 0.09;
  vial.add(flask, flaskNeck);
  vial.visible = false;

  const leftFist = fistOf("l");

  mount(
    joints.hands[0],
    vial,
    leftFist.palm,
    new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), leftFist.across)
  );

  return {
    joints,
    model,
    tip,
    uniforms,
    updateRim: updateLimbs,
    vial,
    wand,
    wandStick,
  };
};
