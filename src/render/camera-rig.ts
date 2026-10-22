/**
 * The over-the-shoulder camera: it sits behind the local Duelist, on the far
 * side from their Target, offset over the right shoulder, and looks at a point
 * between the two so both stay framed. It is the only writer of the camera.
 *
 * - The soft lock-on stays, but the point it looks at leans toward the aim, so
 *   the framing shifts where the player aims.
 * - A close Target pulls the camera back and up to keep both Duelists in frame.
 * - Arena walls and columns never obstruct it: it swings round the Duelist
 *   or pulls in, easing smoothly (see camera-clearance).
 *
 * It follows interpolated presentation samples. Everything is smoothed
 * relative to the Duelist (the camera's angle and distance around them, and
 * where it looks), with frame-rate-independent exponential smoothing, so the
 * camera swings round the Duelist instead of cutting a chord through them.
 */
import { MathUtils, PerspectiveCamera } from "three/webgpu";

import type { ArenaLayout } from "../duel/duel";
import { clamp, direction, distanceBetween, rightOf } from "../duel/geometry";
import type { GroundPoint, Point3 } from "../duel/geometry";
import type { Tuning } from "../tuning";
import { chooseSwing, swingCameraOffset } from "./camera-clearance";
import type { CameraShake } from "./camera-shake";

export interface CameraRig {
  readonly camera: PerspectiveCamera;
  /** Moves the camera toward framing `self` and `target`, `seconds` after the last frame. */
  readonly follow: (
    self: {
      readonly position: GroundPoint;
      readonly facing: GroundPoint;
      /** Where the Duelist aims; left out for a viewpoint that is not a Duelist (the Knockout shot). */
      readonly aimPoint?: Point3;
    },
    target: GroundPoint | undefined,
    seconds: number
  ) => void;
  readonly resize: (aspect: number) => void;
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

/** `angle` wrapped into [-PI, PI]. */
const wrapAngle = (angle: number) =>
  angle - Math.PI * 2 * Math.round(angle / (Math.PI * 2));

export const createCameraRig = (
  settings: Tuning["camera"],
  chestHeight: number,
  arena: ArenaLayout,
  /** Impact shake layered on top of the framing, if any. */
  shake?: CameraShake
): CameraRig => {
  const camera = new PerspectiveCamera(settings.fov, 1, 0.1, 200);

  // Smoothed state, all relative to the Duelist: where the camera sits
  // (its angle round them, its distance and its height) and where it looks
  // (ground offset and height).
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

  return {
    camera,
    follow: (self, target, seconds) => {
      const forward = target ? direction(self.position, target) : self.facing;
      const right = rightOf(forward);

      const separation = target ? distanceBetween(self.position, target) : 0;
      const near = target ? closeness(separation, settings.closeTarget) : 0;

      const distance = settings.distance + near * settings.closeTarget.pullBack;

      // Behind the Duelist, away from the Target, and over the right shoulder.
      const wanted = {
        x: -forward.x * distance + right.x * settings.shoulder,
        z: -forward.z * distance + right.z * settings.shoulder,
      };

      // Look between the Duelist and the Target (or straight ahead without one).
      const ahead = target ?? {
        x: self.position.x + forward.x * settings.distance,
        z: self.position.z + forward.z * settings.distance,
      };

      // Lean the framing toward the aim: the aim point's offset from the Target's chest.
      // The look-at point is nearer than the Target, so the same sideways
      // shift turns the camera further; scaling by the ratio of the two
      // distances makes `aimFollow` a share of the aim's *angle* on screen.
      const lever = target
        ? (settings.distance + settings.focusBias * separation) /
          (settings.distance + separation)
        : 0;

      const aim = target === undefined ? undefined : self.aimPoint;
      const aimX = aim && target ? (aim.x - target.x) * lever : 0;
      const aimY = aim ? (aim.y - chestHeight) * lever : 0;
      const aimZ = aim && target ? (aim.z - target.z) * lever : 0;

      const wantedYaw = Math.atan2(wanted.x, wanted.z);
      const wantedArm = Math.hypot(wanted.x, wanted.z);
      const wantedHeight = settings.height + near * settings.closeTarget.lift;

      const wantedLookX =
        (ahead.x - self.position.x) * settings.focusBias +
        aimX * settings.aimFollow.horizontal;

      const wantedLookY = chestHeight + aimY * settings.aimFollow.vertical;

      const wantedLookZ =
        (ahead.z - self.position.z) * settings.focusBias +
        aimZ * settings.aimFollow.horizontal;

      if (placed) {
        const blend = 1 - Math.exp(-settings.followSharpness * seconds);

        // Even a Target circled at arm's length never whips the camera round.
        const longest = settings.maxYawSpeed * seconds;

        yaw += clamp(wrapAngle(wantedYaw - yaw) * blend, -longest, longest);
        arm += (wantedArm - arm) * blend;
        height += (wantedHeight - height) * blend;
        lookX += (wantedLookX - lookX) * blend;
        lookY += (wantedLookY - lookY) * blend;
        lookZ += (wantedLookZ - lookZ) * blend;
      } else {
        // First frame: cut straight to the framing instead of sweeping in.
        yaw = wantedYaw;
        arm = wantedArm;
        height = wantedHeight;
        lookX = wantedLookX;
        lookY = wantedLookY;
        lookZ = wantedLookZ;
        placed = true;
      }

      // Where the smoothed (unobstructed) camera would be, then how far to
      // swing round the Duelist to dodge walls and columns. The swing is eased
      // like everything else, and the camera is pulled in as far as the
      // Arena needs at the angle it has actually reached.
      const ideal = { x: Math.sin(yaw) * arm, z: Math.cos(yaw) * arm };

      const wantedSwing = chooseSwing(
        self.position,
        ideal,
        arena,
        settings.clearance,
        swing
      );

      swing +=
        (wantedSwing - swing) *
        (1 - Math.exp(-settings.clearance.swingSharpness * seconds));

      const clear = swingCameraOffset(
        self.position,
        ideal,
        swing,
        arena,
        settings.clearance
      );

      // Pulling in is what keeps the camera clear, so it can never lag behind
      // the Arena: `reached` is the most it may sit out right now. But the
      // camera also looks a moment ahead along its swing round the Duelist
      // and starts easing in before it sweeps behind a column, so the pull-in
      // is gradual rather than a pop. Pulling back out eases too.
      const reached = Math.hypot(clear.x, clear.z);
      const glance = settings.clearance.lookAhead;

      const yawAhead =
        yaw +
        clamp(
          wrapAngle(wantedYaw - yaw) *
            (1 - Math.exp(-settings.followSharpness * glance)),
          -settings.maxYawSpeed * glance,
          settings.maxYawSpeed * glance
        );

      const clearAhead = swingCameraOffset(
        self.position,
        { x: Math.sin(yawAhead) * arm, z: Math.cos(yawAhead) * arm },
        swing,
        arena,
        settings.clearance
      );

      const wantedReach = Math.min(
        reached,
        Math.hypot(clearAhead.x, clearAhead.z)
      );

      const from = Math.min(shown, reached);

      const rate =
        wantedReach < from
          ? settings.clearance.pullInSharpness
          : settings.clearance.releaseSharpness;

      shown = Math.min(
        reached,
        from + (wantedReach - from) * (1 - Math.exp(-rate * seconds))
      );

      const offset =
        reached === 0
          ? clear
          : { x: (clear.x / reached) * shown, z: (clear.z / reached) * shown };

      const eye = {
        x: self.position.x + offset.x,
        z: self.position.z + offset.z,
      };

      const look = framedLook(
        eye,
        { x: self.position.x + lookX, z: self.position.z + lookZ },
        self.position
      );

      camera.position.set(eye.x, height, eye.z);
      camera.lookAt(look.x, lookY, look.z);
      shake?.apply(camera, seconds);
    },
    resize: (aspect) => {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    },
  };
};
