/**
 * The procedural wizard's body: an articulated figure of closed, rigid
 * segments (tapered capsules for the limbs, a lathed coat for the torso, a
 * head with a face) under cloth that is not rigid at all (a robe skirt and
 * a mantle down the back, open sheets whose vertices the view moves every
 * frame), topped by a pointed hat or a hood. Built once per Duelist; the
 * view only moves its joints and its cloth.
 *
 * Every surface reads one shared set of causes, so its PBR channels agree:
 * the Team's cloth colours, how far the body has turned to stone (colour and
 * roughness both go to stone, never just one), and one rim of light round
 * the silhouette that adds the Team's own edge light, the Lock-on glow, the
 * Petrified rim and any Potion's aura. Everything is dielectric: with no
 * environment map at night, a metal would render black.
 */
import {
  color,
  float,
  fwidth,
  mix,
  mx_noise_float,
  normalView,
  positionLocal,
  positionView,
  positionViewDirection,
  sin,
  smoothstep,
  uniform,
  uv,
  vec3,
} from "three/tsl";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardNodeMaterial,
  Object3D,
  Sphere,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
} from "three/webgpu";
import type { Node } from "three/webgpu";

import type { Tuning } from "../tuning";

type Duelist = Tuning["duelist"];

export type TeamLook = Duelist["teamLooks"]["near"];

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
}

/**
 * A cloth sheet: a grid of `columns` by `rows` vertices whose rest
 * positions the view deforms into `geometry` every frame.
 */
export interface Cloth {
  readonly mesh: Mesh;
  /** The vertex positions the view writes, three numbers a vertex, in the mesh's frame. */
  readonly positions: Float32Array;
  readonly rest: Float32Array;
  readonly columns: number;
  readonly rows: number;
}

/** A segment of a limb: a rigid mesh drawn from one joint toward the next. */
export type Segment = Mesh;

export interface WizardBody {
  /** Everything that moves with the body, so a roll or a fall can turn it as one. */
  readonly body: Group;
  readonly pelvis: Object3D;
  readonly chest: Object3D;
  readonly head: Object3D;
  /** The bendable top of a pointed hat (null under a hood), swayed by the cloth spring. */
  readonly hatTip: Object3D | null;
  readonly shoulders: readonly [Object3D, Object3D];
  readonly hips: readonly [Object3D, Object3D];
  /** Left then right, as `[left, right]`. */
  readonly upperArms: readonly [Segment, Segment];
  readonly forearms: readonly [Segment, Segment];
  readonly hands: readonly [Segment, Segment];
  readonly thighs: readonly [Segment, Segment];
  readonly shins: readonly [Segment, Segment];
  readonly feet: readonly [Segment, Segment];
  /** The Wand: drawn from the right hand along its pointing direction (+y). */
  readonly wand: Group;
  readonly wandStick: Group;
  /** The Wand tip, where Spells leave it. */
  readonly tip: Object3D;
  /** The vial the left hand raises while drinking. */
  readonly vial: Group;
  readonly skirt: Cloth;
  readonly mantle: Cloth;
  readonly uniforms: WizardUniforms;
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

/** Makes a left and a right one. */
const pair = <T>(make: () => T): readonly [T, T] => [make(), make()];

/** Fresnel: 1 where the surface turns away from the camera (the silhouette), sharper with `power`. */
const silhouette = (power: number) =>
  normalView.dot(positionViewDirection).saturate().oneMinus().pow(power);

/** The settings the wizard's surfaces read. */
export interface WizardLookSettings {
  readonly duelist: Duelist;
  readonly glow: Tuning["lockOnGlow"];
  readonly stone: Tuning["petrifiedLook"];
  readonly aura: Tuning["wandAura"];
  readonly potion: Tuning["potionLook"];
}

/** A tapered capsule along +y from 0 to `length`: closed, radius `from` at the bottom and `to` at the top. */
const taperedCapsule = (
  from: number,
  to: number,
  length: number,
  radial = 12
) => {
  const steps = 4;
  const profile: Vector2[] = [];

  for (let step = 0; step <= steps; step += 1) {
    const angle = -Math.PI / 2 + (Math.PI / 2) * (step / steps);
    profile.push(new Vector2(from * Math.cos(angle), from * Math.sin(angle)));
  }

  for (let step = 0; step <= steps; step += 1) {
    const angle = (Math.PI / 2) * (step / steps);
    profile.push(
      new Vector2(to * Math.cos(angle), length + to * Math.sin(angle))
    );
  }

  return new LatheGeometry(profile, radial);
};

/** An open cloth grid: indices and uvs fixed, positions rewritten every frame. */
const clothGeometry = (columns: number, rows: number) => {
  const geometry = new BufferGeometry();
  const positions = new Float32Array(columns * rows * 3);
  const attribute = new BufferAttribute(positions, 3);
  attribute.setUsage(DynamicDrawUsage);
  const uvs = new Float32Array(columns * rows * 2);
  const indices: number[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const at = row * columns + column;
      uvs[at * 2] = column / (columns - 1);
      uvs[at * 2 + 1] = row / (rows - 1);

      if (row < rows - 1 && column < columns - 1) {
        const below = at + columns;
        indices.push(at, below, at + 1, at + 1, below, below + 1);
      }
    }
  }

  geometry.setAttribute("position", attribute);
  geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
  geometry.setIndex(indices);

  return { geometry, positions };
};

/**
 * The robe's skirt, hanging from the waist (pelvis frame): rings from the
 * top (row 0) to the hem, each a closed loop (the seam column repeats).
 */
const skirtRest = (skirt: Duelist["cloth"]["skirt"]) => {
  const columns = skirt.segments + 1;
  const rest = new Float32Array(columns * skirt.rings * 3);

  for (let row = 0; row < skirt.rings; row += 1) {
    const t = row / (skirt.rings - 1);

    const radius =
      skirt.topRadius +
      (skirt.hemRadius - skirt.topRadius) * t ** skirt.flareCurve;

    const y = skirt.top + (skirt.hem - skirt.top) * t;

    for (let column = 0; column < columns; column += 1) {
      const angle = (column / skirt.segments) * Math.PI * 2;
      const at = (row * columns + column) * 3;
      rest[at] = radius * Math.sin(angle);
      rest[at + 1] = y;
      rest[at + 2] = radius * Math.cos(angle) * skirt.depthScale;
    }
  }

  return { columns, rest, rows: skirt.rings };
};

/** The mantle down the back, hanging from the shoulders (chest frame), curving round the back. */
const mantleRest = (mantle: Duelist["cloth"]["mantle"]) => {
  const rest = new Float32Array(mantle.columns * mantle.rows * 3);

  for (let row = 0; row < mantle.rows; row += 1) {
    const t = row / (mantle.rows - 1);

    const half =
      mantle.topHalfWidth + (mantle.bottomHalfWidth - mantle.topHalfWidth) * t;

    const back = mantle.topBack + (mantle.bottomBack - mantle.topBack) * t;

    for (let column = 0; column < mantle.columns; column += 1) {
      const across = (column / (mantle.columns - 1)) * 2 - 1;
      const at = (row * mantle.columns + column) * 3;
      rest[at] = across * half;
      rest[at + 1] = mantle.top - t * mantle.length;
      rest[at + 2] = -back + mantle.wrap * across * across;
    }
  }

  return { columns: mantle.columns, rest, rows: mantle.rows };
};

export const createWizardBody = (
  team: TeamLook,
  settings: WizardLookSettings
): WizardBody => {
  const { aura, duelist, glow, potion, stone } = settings;
  const { body: build, look } = duelist;

  const uniforms = {
    auraStrength: uniform(0),
    glowStrength: uniform(0),
    petrify: uniform(0),
    potionGlow: uniform(0),
    potionTint: uniform(new Color(potion.colors.wiggenweld)),
    vialTint: uniform(new Color(potion.colors.wiggenweld)),
  };

  const { petrify } = uniforms;

  // One rim of light for every surface: the Team's own edge light (so the
  // far Duelist reads against the dark walls), the Lock-on glow, the cold
  // Petrified rim and a Potion's aura.
  const rim = color(team.rim)
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
    .mul(petrify.oneMinus())
    .add(
      color(glow.color)
        .mul(silhouette(glow.power))
        .mul(uniforms.glowStrength.mul(glow.radiance))
    )
    .add(
      color(stone.rimColor)
        .mul(silhouette(stone.rimPower))
        .mul(petrify.mul(stone.rimRadiance))
    )
    .add(
      uniforms.potionTint.mul(silhouette(potion.power)).mul(uniforms.potionGlow)
    );

  // Stone, mottled at a low frequency in each part's own frame so it holds
  // still on the figure.
  const mottle = mx_noise_float(positionLocal.mul(look.stoneMottleScale))
    .mul(0.5)
    .add(0.5);

  const stoneColor = rgb(stone.stoneColor).mul(
    mix(float(1 - look.stoneMottle), float(1), mottle)
  );

  /** A dielectric surface whose colour and roughness both turn to stone with the same weight. */
  const surface = (base: Node<"vec3">, roughness: number, twoSided = false) => {
    const material = new MeshStandardNodeMaterial();
    material.colorNode = mix(base, stoneColor, petrify);
    material.roughnessNode = mix(
      float(roughness),
      float(look.stoneRoughness),
      petrify
    );
    material.metalnessNode = float(0);
    material.emissiveNode = rim;

    if (twoSided) {
      material.side = DoubleSide;
    }

    return material;
  };

  /**
   * Cloth with soft vertical folds deepening toward its far edge (uv v = 1)
   * and a trim band along that edge, antialiased over the pixel footprint.
   */
  const trimmedCloth = (
    base: string,
    trimShare: number,
    folds: number,
    roughness: number
  ) => {
    const along = uv().y;
    const edge = float(1 - trimShare);
    const width = fwidth(along).max(1e-4);
    const band = smoothstep(edge.sub(width), edge.add(width), along);

    const fold = sin(uv().x.mul(Math.PI * 2 * folds))
      .mul(0.5)
      .add(0.5)
      .mul(along.mul(look.foldDepth))
      .oneMinus();

    return surface(
      mix(rgb(base), rgb(team.trim), band).mul(fold),
      roughness,
      true
    );
  };

  const robe = surface(rgb(team.robe), look.clothRoughness);

  const skirtCloth = trimmedCloth(
    team.robe,
    look.hemTrimShare,
    look.skirtFolds,
    look.clothRoughness
  );

  const mantleCloth = trimmedCloth(
    team.mantle,
    look.hemTrimShare,
    look.mantleFolds,
    look.clothRoughness
  );

  const sleeveCloth = trimmedCloth(
    team.robe,
    look.cuffTrimShare,
    0,
    look.clothRoughness
  );

  const trim = surface(rgb(team.trim), look.trimRoughness);
  const skin = surface(rgb(look.skin), look.skinRoughness);
  const boots = surface(rgb(look.boots), look.bootsRoughness);
  const eyes = surface(rgb(look.eyes), look.skinRoughness);
  const headwear = surface(rgb(team.headwear), look.clothRoughness, true);

  // The Wand's own wood, glowing scarlet from within while the Focus is full,
  // with a bead of the Team's colour at the tip.
  const wood = surface(rgb(look.wood), look.woodRoughness);
  wood.emissiveNode = rim.add(
    color(aura.color).mul(float(aura.radiance).mul(uniforms.auraStrength))
  );
  const bead = new MeshStandardNodeMaterial({ roughness: 0.3 });
  bead.colorNode = color(team.rim);
  bead.emissiveNode = color(team.rim).mul(
    petrify.oneMinus().mul(look.tipRadiance)
  );

  const body = new Group();
  const pelvis = new Object3D();
  const chest = new Object3D();
  const head = new Object3D();
  pelvis.position.y = build.pelvisHeight;
  chest.position.y = build.waist;
  head.position.y = build.torso + build.neck;
  body.add(pelvis);
  pelvis.add(chest);
  chest.add(head);

  // The torso: a lathed coat from the waist to the base of the neck,
  // flattened front to back, belted at the waist.
  const coat = shadowed(
    new Mesh(
      new LatheGeometry(
        build.coat.map(([radius, y]) => new Vector2(radius, y)),
        20
      ),
      robe
    )
  );

  coat.scale.z = build.torsoDepth;

  const belt = shadowed(
    new Mesh(
      new TorusGeometry(build.belt.radius, build.belt.thickness, 6, 24),
      trim
    )
  );

  belt.rotation.x = Math.PI / 2;
  belt.scale.y = build.torsoDepth;
  belt.position.y = build.belt.height;

  const neck = shadowed(
    new Mesh(
      taperedCapsule(build.neckRadius, build.neckRadius * 0.9, build.neck, 10),
      skin
    )
  );

  neck.position.y = build.torso - build.neckRadius;
  chest.add(coat, belt, neck);

  // Index 0 is the left (+x), 1 the right (-x), as for every pair.
  const shoulderAt = (side: number) => {
    const joint = new Object3D();
    joint.position.set(side * build.shoulderWidth, build.shoulderHeight, 0);

    const pad = shadowed(
      new Mesh(new SphereGeometry(build.shoulderPad, 12, 8), robe)
    );

    joint.add(pad);
    chest.add(joint);

    return joint;
  };

  const hipAt = (side: number) => {
    const joint = new Object3D();
    joint.position.set(side * build.hipWidth, -build.hipDrop, 0);
    pelvis.add(joint);

    return joint;
  };

  const shoulders = [shoulderAt(1), shoulderAt(-1)] as const;
  const hips = [hipAt(1), hipAt(-1)] as const;

  // The head: skin, a nose and two dark eyes so it reads which way it looks.
  const skull = shadowed(
    new Mesh(new SphereGeometry(build.headRadius, 20, 14), skin)
  );

  skull.scale.set(1, build.headStretch, 1.04);

  const nose = shadowed(
    new Mesh(new ConeGeometry(build.nose.radius, build.nose.length, 8), skin)
  );

  nose.rotation.x = Math.PI / 2;
  nose.position.set(
    0,
    build.nose.height,
    build.headRadius + build.nose.length * 0.3
  );
  head.add(skull, nose);

  for (const side of [-1, 1]) {
    const eye = new Mesh(new SphereGeometry(build.eye.radius, 8, 6), eyes);
    eye.position.set(
      side * build.eye.spread,
      build.eye.height,
      build.headRadius * build.eye.depth
    );
    head.add(eye);
  }

  let hatTip: Object3D | null = null;

  if (team.headwearKind === "hood") {
    // An open hood: a shell round the back of the head with the face left
    // clear, peaked at the back.
    const { hood } = build;

    const shell = shadowed(
      new Mesh(
        new SphereGeometry(
          hood.radius,
          20,
          12,
          Math.PI / 2 + hood.opening,
          Math.PI * 2 - hood.opening * 2,
          0,
          hood.reach
        ),
        headwear
      )
    );

    shell.scale.set(1, hood.stretch, 1);
    shell.position.y = hood.lift;

    const peak = shadowed(
      new Mesh(new ConeGeometry(hood.peakRadius, hood.peakLength, 10), headwear)
    );

    peak.position.set(0, hood.lift + hood.radius * 0.55, -hood.radius * 0.55);
    peak.rotation.x = -hood.peakTilt;
    head.add(shell, peak);
  } else {
    const { hat } = build;

    const brim = shadowed(
      new Mesh(
        new CylinderGeometry(
          hat.brimRadius,
          hat.brimRadius,
          hat.brimThickness,
          28
        ),
        headwear
      )
    );

    brim.position.y = hat.height;

    const band = shadowed(
      new Mesh(
        new CylinderGeometry(
          hat.baseRadius,
          hat.baseRadius,
          hat.bandHeight,
          24
        ),
        trim
      )
    );

    band.position.y = hat.height + hat.bandHeight / 2;

    const crown = shadowed(
      new Mesh(
        new CylinderGeometry(
          hat.midRadius,
          hat.baseRadius,
          hat.crown,
          24,
          1,
          true
        ),
        headwear
      )
    );

    crown.position.y = hat.height + hat.crown / 2;
    // The top cone bends back from a pivot on the crown, and sways.
    const bend = new Object3D();
    bend.position.y = hat.height + hat.crown;

    const point = shadowed(
      new Mesh(
        new ConeGeometry(hat.midRadius, hat.point, 20, 1, true),
        headwear
      )
    );

    point.position.y = hat.point / 2;
    bend.add(point);
    head.add(brim, band, crown, bend);
    hatTip = bend;
  }

  // Limbs, drawn joint to joint by the view; each is a closed capsule along +y.
  const limb = (
    from: number,
    to: number,
    length: number,
    material: MeshStandardNodeMaterial
  ) => shadowed(new Mesh(taperedCapsule(from, to, length), material));

  const upperArms = pair(() =>
    limb(build.limbs.upperArm[0], build.limbs.upperArm[1], build.upperArm, robe)
  );

  // Forearms are wide bell sleeves, open at the wrist, with a trimmed cuff
  // and the forearm itself inside.
  const forearms = pair(() => {
    const sleeve = shadowed(
      new Mesh(
        new LatheGeometry(
          [
            new Vector2(build.limbs.sleeve[0], -build.limbs.upperArm[1]),
            new Vector2(build.limbs.sleeve[1], build.forearm),
          ],
          14
        ),
        sleeveCloth
      )
    );

    const arm = limb(
      build.limbs.forearm[0],
      build.limbs.forearm[1],
      build.forearm,
      skin
    );

    sleeve.add(arm);

    return sleeve;
  });

  // A mitten of a hand, longer than wide, along the forearm.
  const hands = pair(() => {
    const hand = shadowed(
      new Mesh(new SphereGeometry(build.handRadius, 12, 8), skin)
    );

    hand.geometry.scale(1, build.handStretch, 0.75);
    hand.geometry.translate(0, build.handRadius * 0.6, 0);

    return hand;
  });

  const thighs = pair(() =>
    limb(build.limbs.thigh[0], build.limbs.thigh[1], build.thigh, boots)
  );

  const shins = pair(() =>
    limb(build.limbs.shin[0], build.limbs.shin[1], build.shin, boots)
  );

  // A boot: a rounded block from the heel to the toe, sole on the floor
  // when the ankle stands at its height.
  const feet = pair(() => {
    const geometry = taperedCapsule(
      build.foot.width * 0.5,
      build.foot.width * 0.55,
      build.foot.length - build.foot.width,
      10
    );

    geometry.rotateX(Math.PI / 2);
    geometry.scale(1, build.foot.height / build.foot.width, 1);
    geometry.translate(
      0,
      build.foot.height * 0.5 - build.ankleHeight,
      -build.foot.back + build.foot.width * 0.5
    );

    return shadowed(new Mesh(geometry, boots));
  });

  // The Wand along +y from the hand: a tapering stick and a glowing bead.
  const { length } = duelist.wand;
  const wand = new Group();
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

  // The vial a drinker raises to the lips: glass glowing in the Potion's colour.
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

  const cloth = (
    grid: { columns: number; rest: Float32Array; rows: number },
    material: MeshStandardNodeMaterial,
    reach: number
  ): Cloth => {
    const { geometry, positions } = clothGeometry(grid.columns, grid.rows);
    // The cloth moves every frame; one generous bound keeps it from being culled.
    geometry.boundingSphere = new Sphere(new Vector3(), reach);
    const mesh = shadowed(new Mesh(geometry, material));

    return {
      columns: grid.columns,
      mesh,
      positions,
      rest: grid.rest,
      rows: grid.rows,
    };
  };

  const skirt = cloth(
    skirtRest(duelist.cloth.skirt),
    skirtCloth,
    duelist.cloth.bound
  );

  const mantle = cloth(
    mantleRest(duelist.cloth.mantle),
    mantleCloth,
    duelist.cloth.bound
  );

  pelvis.add(skirt.mesh);
  chest.add(mantle.mesh);

  body.add(
    ...upperArms,
    ...forearms,
    ...hands,
    ...thighs,
    ...shins,
    ...feet,
    wand,
    vial
  );

  return {
    body,
    chest,
    feet,
    forearms,
    hands,
    hatTip,
    head,
    hips,
    mantle,
    pelvis,
    shins,
    shoulders,
    skirt,
    thighs,
    tip,
    uniforms,
    upperArms,
    vial,
    wand,
    wandStick,
  };
};
