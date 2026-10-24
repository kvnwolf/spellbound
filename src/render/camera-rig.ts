/**
 * The third-person camera. It is the only writer of the camera, and has two
 * framings it eases between over `lockTransitionSeconds` (a smoothstep in
 * time, both ways, so changing never snaps and is frame-rate independent;
 * the camera swings round the Duelist rather than cutting through them):
 *
 * - **Free** (the default): the camera sits straight behind the aim pivot
 *   over the Duelist's right shoulder, looking along their Aim. The pivot is
 *   the same point the simulation casts the aim ray from, so the screen
 *   centre (the crosshair) always looks down that ray and Spells go to the
 *   point under it. When a wall or column is in the way it pulls in along
 *   the ray rather than swinging, so the crosshair stays true. Pulled in
 *   close to the Duelist while they face it (or right up against them
 *   whichever way they face), it rises and tilts down instead so they stay
 *   in view (see camera-framing); the reticle fades out while it does.
 * - **Lock-on** (and the Knockout shot): the camera sits behind the Duelist,
 *   on the far side from the Target, over the right shoulder, and looks at a
 *   point between the two so both stay framed. A close Target pulls it back
 *   and up; walls and columns make it swing round or pull in (see
 *   camera-clearance). The right stick's nudge turns this framing a little.
 *
 * It follows interpolated presentation samples. The Lock-on framing is
 * smoothed relative to the Duelist (angle, distance, look point) with
 * frame-rate-independent exponential smoothing; the free camera follows the
 * aim directly, since the Controller already smooths the stick, and a lag
 * here would take the crosshair off the aim ray.
 *
 * On top of either framing, a full Charge pushes the field of view wider.
 */
import { MathUtils, PerspectiveCamera } from "three/webgpu";

import { aimPivot } from "../duel/aim";
import type { AimEye } from "../duel/aim";
import type { ArenaLayout } from "../duel/duel";
import {
  clamp,
  direction,
  directionOf,
  distanceBetween,
  lerp,
  rightOf,
  unit3,
  wrapAngle,
} from "../duel/geometry";
import type { Aim, GroundPoint, Point3 } from "../duel/geometry";
import type { Tuning } from "../tuning";
import { chooseSwing, swingCameraOffset } from "./camera-clearance";
import { freeCameraPose, freeReach, liftWanted } from "./camera-framing";
import type { FreeSubject, Pose } from "./camera-framing";
import type { CameraShake } from "./camera-shake";

/** The free camera's subject: the local Duelist, where they look and which way they face. */
export interface FreeView {
  readonly position: GroundPoint;
  readonly aim: Aim;
  readonly facing: GroundPoint;
}

/** The Lock-on framing's subject: frame `self` and `target`, turned by `nudge`. */
export interface Framing {
  readonly self: GroundPoint;
  readonly target: GroundPoint;
  readonly nudge: Aim;
}

export interface CameraRig {
  readonly camera: PerspectiveCamera;
  /**
   * Moves the camera `seconds` after the last frame: the free camera behind
   * `free`, or the Lock-on framing when `framing` is given (also used for the
   * Knockout shot), blending between them.
   */
  readonly follow: (
    free: FreeView,
    framing: Framing | undefined,
    seconds: number
  ) => void;
  readonly resize: (aspect: number) => void;
  /**
   * How far to push the field of view toward its full-Charge widening: 0
   * none, 1 the full push. The rig eases toward it in `follow`.
   */
  readonly chargePush: (share: number) => void;
  /**
   * The free camera has lifted off the aim line to keep the Duelist in view,
   * so the screen centre no longer marks where Spells go: hide the reticle.
   */
  readonly offAimLine: () => boolean;
}

export interface CameraRigSettings {
  readonly camera: Tuning["camera"];
  readonly eye: AimEye;
  readonly chestHeight: number;
}

/** 0 when the Target is farther than `startsAt`, 1 at `fullAt` or nearer, eased in between. */
const closeness = (
  separation: number,
  settings: Tuning["camera"]["closeTarget"]
) => {
  const linear = clamp(
    (settings.startsAt - separation) / (settings.startsAt - settings.fullAt),
    0,
    1
  );

  return linear * linear * (3 - 2 * linear);
};

/** `vector` turned by `angle` radians round the vertical (positive turns right). */
const turnRight = (vector: GroundPoint, angle: number): GroundPoint => ({
  x: vector.x * Math.cos(angle) - vector.z * Math.sin(angle),
  z: vector.x * Math.sin(angle) + vector.z * Math.cos(angle),
});

/** The unit direction `share` of the way from `from` to `to`, turning the short way in yaw. */
const lookBetween = (from: Point3, to: Point3, share: number): Point3 => {
  const yaw =
    Math.atan2(from.x, -from.z) +
    wrapAngle(Math.atan2(to.x, -to.z) - Math.atan2(from.x, -from.z)) * share;

  const pitch = lerp(Math.asin(from.y), Math.asin(to.y), share);

  return directionOf({ pitch, yaw });
};

/**
 * The camera position `share` of the way from `from` to `to`, going round
 * `centre` (the Duelist): the angle turns the short way and the distance
 * eases, so the camera never cuts through the Duelist on the way.
 */
const eyeBetween = (
  centre: GroundPoint,
  from: Point3,
  to: Point3,
  share: number
): Point3 => {
  const fromX = from.x - centre.x;
  const fromZ = from.z - centre.z;
  const toX = to.x - centre.x;
  const toZ = to.z - centre.z;
  const fromAngle = Math.atan2(fromX, fromZ);
  const angle = fromAngle + wrapAngle(Math.atan2(toX, toZ) - fromAngle) * share;
  const radius = lerp(Math.hypot(fromX, fromZ), Math.hypot(toX, toZ), share);

  return {
    x: centre.x + Math.sin(angle) * radius,
    y: lerp(from.y, to.y, share),
    z: centre.z + Math.cos(angle) * radius,
  };
};

/**
 * Where the Lock-on framing is taken from during a Clash: `sideStep` metres
 * to the right of `self` (facing `target`), so the beam between them runs
 * across the screen at an angle rather than straight away from the camera.
 */
export const clashViewpoint = (
  self: GroundPoint,
  target: GroundPoint,
  sideStep: number
): GroundPoint => {
  const right = rightOf(direction(self, target));

  return { x: self.x + right.x * sideStep, z: self.z + right.z * sideStep };
};

export const createCameraRig = (
  { camera: settings, chestHeight, eye: aimEye }: CameraRigSettings,
  arena: ArenaLayout,
  /** Impact shake layered on top of the framing, if any. */
  shake?: CameraShake
): CameraRig => {
  const camera = new PerspectiveCamera(settings.fov, 1, 0.1, 200);
  const { clearance } = settings;

  // Lock-on framing state, smoothed relative to the Duelist: where the
  // camera sits (its angle round them, its distance and its height) and where
  // it looks (ground offset and height).
  let yaw = 0;
  let arm = 0;
  let height = 0;
  let lookX = 0;
  let lookY = 0;
  let lookZ = 0;
  // How far the camera has swung round the Duelist to dodge Arena geometry,
  // and how far out it is currently allowed to sit.
  let swing = 0;
  let shown = Number.POSITIVE_INFINITY;
  let placed = false;
  // The last Lock-on framing, kept while blending back out to the free camera.
  let lastFraming: Framing | undefined;
  // How far through the transition: 0 is the free camera, 1 the Lock-on
  // framing. Moves at a steady rate in time; the easing is applied on top.
  let blend = 0;
  // The free camera's share of its full distance it is allowed out to, and
  // how far it has lifted off the aim line to keep the Duelist in view.
  let reachShown = 1;
  let liftEased = 0;
  let liftShown = 0;
  // The aim the free camera had on the last frame before the Lock-on framing
  // took over. Locking turns the aim to the Target at once (within a tick),
  // so the transition has to start from this, not from the new aim.
  let lastFreeAim: Aim | undefined;
  // The aim the free camera holds while the framing is on, or on its way out.
  let heldAim: Aim | undefined;
  // The full-Charge field of view push: wanted, and eased toward.
  let pushWanted = 0;
  let push = 0;

  // Where the camera looks, turned sideways just enough that the local
  // Duelist stays inside the allowed share of the horizontal field of view.
  const framedLook = (
    eye: GroundPoint,
    look: GroundPoint,
    duelist: GroundPoint
  ): GroundPoint => {
    const halfView = Math.atan(
      Math.tan(MathUtils.degToRad(settings.fov / 2)) * camera.aspect
    );

    const limit = halfView * settings.keepDuelistWithin;
    const lookDx = look.x - eye.x;
    const lookDz = look.z - eye.z;
    const duelistDx = duelist.x - eye.x;
    const duelistDz = duelist.z - eye.z;

    // Signed angle from the look direction to the Duelist, in the ground plane.
    const gap = Math.atan2(
      lookDx * duelistDz - lookDz * duelistDx,
      lookDx * duelistDx + lookDz * duelistDz
    );

    const excess = Math.abs(gap) - limit;

    if (excess <= 0) {
      return look;
    }

    const turn = Math.sign(gap) * excess;

    return {
      x: eye.x + lookDx * Math.cos(turn) - lookDz * Math.sin(turn),
      z: eye.z + lookDx * Math.sin(turn) + lookDz * Math.cos(turn),
    };
  };

  /**
   * The free camera: straight behind the aim pivot along the aim, pulled in
   * along that same line when a wall, a column or the floor is in the way,
   * and lifted off it when that brings it close to the Duelist. Pulling in
   * and a forced lift are immediate (the camera must never be blocked or
   * inside the Duelist); easing back out, and a chosen lift, are not.
   */
  const freePose = (view: FreeView, seconds: number): Pose => {
    const subject: FreeSubject = {
      facing: view.facing,
      look: directionOf(view.aim),
      pivot: aimPivot(view.position, view.aim.yaw, arena, aimEye),
      position: view.position,
    };

    const reach = freeReach(subject, arena, settings);

    reachShown = Math.min(
      reach,
      reachShown +
        (reach - reachShown) *
          (1 - Math.exp(-clearance.releaseSharpness * seconds))
    );

    const wanted = liftWanted(subject, reachShown, settings, chestHeight);

    liftEased +=
      (wanted.soft - liftEased) *
      (1 - Math.exp(-settings.free.lift.sharpness * seconds));
    liftShown = Math.max(wanted.forced, liftEased);

    return freeCameraPose(subject, arena, settings, chestHeight, {
      lift: liftShown,
      reach: reachShown,
    });
  };

  /** The Lock-on framing, smoothed toward framing both Duelists. */
  const lockedPose = (framing: Framing, seconds: number): Pose => {
    const { nudge, self, target } = framing;
    // The nudge turns the whole framing round the Duelist.
    const forward = turnRight(direction(self, target), nudge.yaw);
    const right = rightOf(forward);
    const separation = distanceBetween(self, target);
    const near = closeness(separation, settings.closeTarget);
    const distance = settings.distance + near * settings.closeTarget.pullBack;

    // Behind the Duelist, away from the Target, and over the right shoulder.
    const wanted = {
      x: -forward.x * distance + right.x * settings.shoulder,
      z: -forward.z * distance + right.z * settings.shoulder,
    };

    // Look between the Duelist and the Target, turned by the nudge.
    const ahead = {
      x: forward.x * separation * settings.focusBias,
      z: forward.z * separation * settings.focusBias,
    };

    const lookDistance = settings.distance + separation * settings.focusBias;

    const wantedYaw = Math.atan2(wanted.x, wanted.z);
    const wantedArm = Math.hypot(wanted.x, wanted.z);
    const wantedHeight = settings.height + near * settings.closeTarget.lift;
    const wantedLookY = chestHeight + Math.tan(nudge.pitch) * lookDistance;

    if (placed) {
      const ease = 1 - Math.exp(-settings.followSharpness * seconds);

      // Even a Target circled at arm's length never whips the camera round.
      const longest = settings.maxYawSpeed * seconds;

      yaw += clamp(wrapAngle(wantedYaw - yaw) * ease, -longest, longest);
      arm += (wantedArm - arm) * ease;
      height += (wantedHeight - height) * ease;
      lookX += (ahead.x - lookX) * ease;
      lookY += (wantedLookY - lookY) * ease;
      lookZ += (ahead.z - lookZ) * ease;
    } else {
      // Entering the framing: start right on it (the blend eases the cut).
      yaw = wantedYaw;
      arm = wantedArm;
      height = wantedHeight;
      lookX = ahead.x;
      lookY = wantedLookY;
      lookZ = ahead.z;
      swing = 0;
      shown = Number.POSITIVE_INFINITY;
      placed = true;
    }

    // Where the smoothed (unobstructed) camera would be, then how far to
    // swing round the Duelist to dodge walls and columns. The swing is eased
    // like everything else, and the camera is pulled in as far as the
    // Arena needs at the angle it has actually reached.
    const ideal = { x: Math.sin(yaw) * arm, z: Math.cos(yaw) * arm };

    const wantedSwing = chooseSwing(self, ideal, arena, clearance, swing);

    swing +=
      (wantedSwing - swing) *
      (1 - Math.exp(-clearance.swingSharpness * seconds));

    const clear = swingCameraOffset(self, ideal, swing, arena, clearance);

    // Pulling in is what keeps the camera clear, so it can never lag behind
    // the Arena: `reached` is the most it may sit out right now. But the
    // camera also looks a moment ahead along its swing round the Duelist
    // and starts easing in before it sweeps behind a column, so the pull-in
    // is gradual rather than a pop. Pulling back out eases too.
    const reached = Math.hypot(clear.x, clear.z);
    const glance = clearance.lookAhead;

    const yawAhead =
      yaw +
      clamp(
        wrapAngle(wantedYaw - yaw) *
          (1 - Math.exp(-settings.followSharpness * glance)),
        -settings.maxYawSpeed * glance,
        settings.maxYawSpeed * glance
      );

    const clearAhead = swingCameraOffset(
      self,
      { x: Math.sin(yawAhead) * arm, z: Math.cos(yawAhead) * arm },
      swing,
      arena,
      clearance
    );

    const wantedReach = Math.min(
      reached,
      Math.hypot(clearAhead.x, clearAhead.z)
    );

    const from = Math.min(shown, reached);

    const rate =
      wantedReach < from
        ? clearance.pullInSharpness
        : clearance.releaseSharpness;

    shown = Math.min(
      reached,
      from + (wantedReach - from) * (1 - Math.exp(-rate * seconds))
    );

    const offset =
      reached === 0
        ? clear
        : { x: (clear.x / reached) * shown, z: (clear.z / reached) * shown };

    const eye = { x: self.x + offset.x, z: self.z + offset.z };

    const look = framedLook(
      eye,
      { x: self.x + lookX, z: self.z + lookZ },
      self
    );

    return {
      eye: { x: eye.x, y: height, z: eye.z },
      look: unit3({ x: look.x - eye.x, y: lookY - height, z: look.z - eye.z }),
    };
  };

  return {
    camera,
    chargePush: (share) => {
      pushWanted = clamp(share, 0, 1);
    },
    follow: (free, framing, seconds) => {
      lastFraming = framing ?? lastFraming;

      const step = seconds / settings.lockTransitionSeconds;
      blend = clamp(blend + (framing ? step : -step), 0, 1);

      // Fully back on the free camera: the next lock starts a fresh framing.
      if (!framing && blend === 0) {
        placed = false;
        lastFraming = undefined;
      }

      if (!framing) {
        lastFreeAim = free.aim;
      }

      heldAim = framing ? (heldAim ?? lastFreeAim ?? free.aim) : undefined;

      const freeCamera = freePose(
        heldAim ? { ...free, aim: heldAim } : free,
        seconds
      );

      const lockedCamera =
        lastFraming && blend > 0
          ? lockedPose(lastFraming, seconds)
          : freeCamera;

      const share = blend * blend * (3 - 2 * blend);

      // Orientation turns the short way round, and the camera swings round
      // the Duelist (angle and distance) rather than cutting across them.
      const look = lookBetween(freeCamera.look, lockedCamera.look, share);

      const eye = eyeBetween(
        free.position,
        freeCamera.eye,
        lockedCamera.eye,
        share
      );

      camera.position.set(eye.x, eye.y, eye.z);

      // A full Charge widens the view a little: the held power is felt.
      push +=
        (pushWanted - push) *
        (1 - Math.exp(-settings.chargePush.sharpness * seconds));
      const fov = settings.fov + push * settings.chargePush.degrees;

      if (Math.abs(camera.fov - fov) > 1e-4) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }

      camera.lookAt(
        camera.position.x + look.x,
        camera.position.y + look.y,
        camera.position.z + look.z
      );

      shake?.apply(camera, seconds);
    },
    offAimLine: () => liftShown > settings.free.lift.reticleHideAt,
    resize: (aspect) => {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    },
  };
};
