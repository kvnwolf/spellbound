/**
 * Chips of stone knocked off the Arena's pieces: small lit rocks thrown out
 * where a Spell strikes, bouncing nowhere, coming to rest on the floor and
 * crumbling away a while later.
 *
 * One instanced draw over a ring of stable slots, like the spark ring:
 * spawning a chip writes its origin, birth, launch, size and spin into its
 * slot once; where it is and how it is turned are then pure functions of
 * its age, evaluated in TSL (ballistic until its centre is a radius off the
 * floor, then still), so the CPU never touches a live chip again. Unborn
 * and spent slots draw at zero size.
 */
import {
  Fn,
  cos,
  exp,
  float,
  instancedDynamicBufferAttribute,
  max,
  min,
  mix,
  normalGeometry,
  normalLocal,
  positionGeometry,
  sin,
  smoothstep,
  sqrt,
  step,
  uniform,
  vec3,
} from "three/tsl";
import type { Node } from "three/webgpu";
import {
  Color,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  MeshStandardNodeMaterial,
} from "three/webgpu";

import type { Point3 } from "../../duel/geometry";
import type { Tuning } from "../../tuning";

type ChipLook = Tuning["structureLook"]["chips"];

/** One chip: where it starts, how it is thrown, how big and how it tumbles. */
export interface Chip {
  readonly origin: Point3;
  readonly velocity: Point3;
  /** Radius, metres. */
  readonly size: number;
  /** Unit tumble axis and rate, radians per second. */
  readonly axis: Point3;
  readonly spin: number;
  /** How light its stone is, 0 to 1 (a shade between the look's dark and light). */
  readonly shade: number;
}

export interface ChipPool {
  readonly mesh: Mesh;
  readonly emit: (chip: Chip) => void;
  /** Ages every chip by `seconds`, then uploads what was written. */
  readonly advance: (seconds: number) => void;
  /** Sweeps every chip away (the Arena rebuilt for a new Duel). */
  readonly clear: () => void;
}

const rotate = (
  vector: Node<"vec3">,
  axis: Node<"vec3">,
  angle: Node<"float">
): Node<"vec3"> => {
  const c = cos(angle);
  const s = sin(angle);

  return vector
    .mul(c)
    .add(axis.cross(vector).mul(s))
    .add(axis.mul(axis.dot(vector)).mul(float(1).sub(c)));
};

/** A lane of per-chip data as a TSL node. */
const node = (attribute: InstancedBufferAttribute) =>
  instancedDynamicBufferAttribute<"vec4">(attribute, "vec4");

export const createChipPool = (look: ChipLook): ChipPool => {
  const { slots } = look;

  const lane = () =>
    new InstancedBufferAttribute(new Float32Array(slots * 4), 4);

  // origin xyz + birth; velocity xyz + size; axis xyz + spin; shade.
  const lanes = { flight: lane(), spawn: lane(), tone: lane(), tumble: lane() };

  // Unborn: born in the far past, already crumbled away.
  for (let slot = 0; slot < slots; slot += 1) {
    lanes.spawn.setW(slot, -1e6);
    lanes.tumble.setY(slot, 1);
  }

  const spawn = node(lanes.spawn);
  const flight = node(lanes.flight);
  const tumble = node(lanes.tumble);
  const tone = node(lanes.tone);
  const now = uniform(0);

  const material = new MeshStandardNodeMaterial({ roughness: 0.92 });
  const { gravity } = look;

  material.positionNode = Fn(() => {
    const age = now.sub(spawn.w);
    const born = step(0, age);
    const time = max(age, 0);
    const size = flight.w;
    const drop = max(spawn.y.sub(size), 0);

    // Ballistic until it lies on the floor, then a short skid.
    const landing = flight.y
      .add(sqrt(flight.y.mul(flight.y).add(drop.mul(2 * gravity))))
      .div(gravity);

    const flying = min(time, landing);
    const after = max(time.sub(landing), 0);

    const skid = float(1)
      .sub(exp(after.div(0.08).negate()))
      .mul(0.08);

    const centre = vec3(
      spawn.x.add(flight.x.mul(flying.add(skid))),
      spawn.y
        .add(flight.y.mul(flying))
        .sub(flying.mul(flying).mul(0.5 * gravity)),
      spawn.z.add(flight.z.mul(flying.add(skid)))
    );

    // Crumbles away (shrinks to nothing) at the end of its life.
    const left = float(1).sub(
      smoothstep(look.life - look.crumble, look.life, time)
    );

    const angle = tumble.w.mul(flying.add(skid));
    // Squashed a little, so no two chips read as the same pebble.
    const pebble = positionGeometry.mul(vec3(1, 0.7, 0.85));

    normalLocal.assign(rotate(normalGeometry, tumble.xyz, angle));

    return rotate(pebble.mul(size.mul(born).mul(left)), tumble.xyz, angle).add(
      centre
    );
  })();

  const dark = new Color(look.dark);
  const light = new Color(look.light);

  material.colorNode = mix(
    vec3(dark.r, dark.g, dark.b),
    vec3(light.r, light.g, light.b),
    tone.x
  );

  const rock = new IcosahedronGeometry(1, 0);
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute("position", rock.getAttribute("position"));
  geometry.setAttribute("normal", rock.getAttribute("normal"));
  geometry.instanceCount = slots;

  const mesh = new Mesh(geometry, material);
  // Chips are placed in the shader, so the CPU cannot know their bounds.
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;

  let next = 0;
  let dirty = false;

  return {
    advance: (seconds) => {
      now.value += seconds;

      if (dirty) {
        for (const attribute of Object.values(lanes)) {
          attribute.needsUpdate = true;
        }

        dirty = false;
      }
    },
    clear: () => {
      for (let slot = 0; slot < slots; slot += 1) {
        lanes.spawn.setW(slot, -1e6);
      }

      dirty = true;
    },
    emit: (chip) => {
      lanes.spawn.setXYZW(
        next,
        chip.origin.x,
        chip.origin.y,
        chip.origin.z,
        now.value
      );
      lanes.flight.setXYZW(
        next,
        chip.velocity.x,
        chip.velocity.y,
        chip.velocity.z,
        chip.size
      );
      lanes.tumble.setXYZW(
        next,
        chip.axis.x,
        chip.axis.y,
        chip.axis.z,
        chip.spin
      );
      lanes.tone.setX(next, chip.shade);
      next = (next + 1) % slots;
      dirty = true;
    },
    mesh,
  };
};
