/**
 * Compiles the shaders and render pipelines of everything in a scene before
 * it first appears, so no effect stalls the frame it shows up in. Three.js
 * builds a material's shader the first time it draws, and an object that is
 * hidden (a Clash beam, an explosion, a Potion's aura, a Spell nobody has
 * cast yet) does not draw, so it would compile mid-Duel.
 */
import type { Camera, RenderTarget, Scene, WebGPURenderer } from "three/webgpu";

/**
 * Queues every object in `scene` (hidden or off-screen ones too) for
 * asynchronous compilation into `target`, the render target the scene is
 * really drawn into, so the pipelines match (sample count, formats). Lights
 * are left as they are: the set of lights is part of every lit shader.
 *
 * The objects to compile are gathered synchronously, so the scene is only
 * revealed for the length of this call; the compiling itself runs in the
 * background, a few objects per frame, and the promise resolves when it is done.
 *
 * One gap: three.js draws a double-sided transparent material in two passes
 * (back faces, then front) by flipping its `side` for each, and the deferred
 * compile reads `side` after it was flipped back, so those still compile on
 * first use. The effects here are additive and drawn in one pass instead.
 */
export const prewarm = async (
  renderer: WebGPURenderer,
  scene: Scene,
  camera: Camera,
  target: RenderTarget
): Promise<void> => {
  const restore: (() => void)[] = [];

  scene.traverse((object) => {
    if ("isLight" in object && object.isLight === true) {
      return;
    }

    if (!object.visible) {
      object.visible = true;
      restore.push(() => {
        object.visible = false;
      });
    }

    if (object.frustumCulled) {
      object.frustumCulled = false;
      restore.push(() => {
        object.frustumCulled = true;
      });
    }
  });

  const previousTarget = renderer.getRenderTarget();
  const previousMrt = renderer.getMRT();
  let compiled: Promise<void>;

  try {
    renderer.setRenderTarget(target);
    renderer.setMRT(null);
    compiled = renderer.compileAsync(scene, camera);
  } finally {
    renderer.setRenderTarget(previousTarget);
    renderer.setMRT(previousMrt);

    for (const undo of restore) {
      undo();
    }
  }

  await compiled;
};
