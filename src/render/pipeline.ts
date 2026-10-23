import { bloom } from "three/addons/tsl/display/BloomNode.js";
/**
 * The final image: one MSAA scene pass in scene-linear HDR, full-scene bloom
 * on top (so the moon, flames, embers and every Spell's emissive glow without
 * a selection pass), a soft vignette, then the renderer's single tone map and
 * sRGB output conversion. It also switches on the moon's shadow map, and
 * after the first frame compiles every effect that has not drawn yet.
 *
 * The scene pass and bloom render at the dynamic resolution scale (see
 * `resolution.ts`), driven by the GPU timer, and the output upscales them.
 */
import { pass, screenUV, smoothstep, vec4 } from "three/tsl";
import {
  ACESFilmicToneMapping,
  PCFShadowMap,
  RenderPipeline,
  Vector2,
} from "three/webgpu";
import type { Camera, Scene, WebGPURenderer } from "three/webgpu";

import type { Tuning } from "../tuning";
import { createGpuTimer } from "./gpu-timer";
import type { GpuTimer } from "./gpu-timer";
import { prewarm } from "./prewarm";
import { createResolutionControl } from "./resolution";

export interface FramePipeline {
  /** Renders one frame of `scene` through the camera given at creation. */
  readonly render: () => void;
  /** The scene's current resolution scale, 0..1 per axis. */
  readonly scale: () => number;
  /** GPU frame timings, when the GPU has timestamp queries. */
  readonly gpuTimer: GpuTimer | undefined;
}

export const createFramePipeline = (
  renderer: WebGPURenderer,
  scene: Scene,
  camera: Camera,
  settings: Tuning["render"]
): FramePipeline => {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = settings.exposure;

  const scenePass = pass(scene, camera, { samples: settings.msaaSamples });
  const hdr = scenePass.getTextureNode("output");

  const glare = bloom(
    hdr,
    settings.bloom.strength,
    settings.bloom.radius,
    settings.bloom.threshold
  );

  glare.smoothWidth.value = settings.bloom.softKnee;
  glare.setResolutionScale(settings.bloom.resolutionScale);

  // Darken toward the corners, in linear light before the tone map.
  const corner = screenUV.sub(0.5).length().mul(Math.SQRT2);

  const vignette = smoothstep(0.45, 1.15, corner)
    .mul(settings.vignette)
    .oneMinus();

  const pipeline = new RenderPipeline(renderer);

  // The pipeline's default output transform applies the renderer's tone
  // mapping and colour space once, after bloom.
  pipeline.outputNode = vec4(hdr.rgb.add(glare.rgb).mul(vignette), 1);

  const resolution = createResolutionControl(settings.resolution);
  const gpuTimer = createGpuTimer(renderer);
  // Which scale each frame (by renderer frame number) was drawn at.
  const drawnAt = new Map<number, number>();

  gpuTimer?.watch(({ frame, total }) => {
    const scale = drawnAt.get(frame);
    drawnAt.delete(frame);

    if (scale !== undefined) {
      resolution.sample(total, scale);
    }
  });

  const size = new Vector2();
  let pixels = 0;
  let applied = 0;
  let warmed = false;

  /** Follows canvas resizes and scale changes; targets resize on the next render. */
  const applyScale = () => {
    renderer.getDrawingBufferSize(size);

    if (size.x * size.y !== pixels) {
      pixels = size.x * size.y;
      resolution.resize(pixels);
    }

    const scale = resolution.scale();

    if (scale !== applied) {
      applied = scale;
      scenePass.setResolutionScale(scale);
      glare.setResolutionScale(settings.bloom.resolutionScale * scale);
    }

    return scale;
  };

  return {
    gpuTimer,
    render: () => {
      const scale = applyScale();
      pipeline.render();
      drawnAt.set(renderer.info.frame, scale);

      if (drawnAt.size > 600) {
        drawnAt.clear();
      }

      gpuTimer?.frameEnd();

      // After the first frame (which sets the scene pass up), compile
      // everything that has not drawn yet, in the background.
      if (!warmed) {
        warmed = true;
        void prewarm(renderer, scene, camera, scenePass.renderTarget);
      }
    },
    scale: () => applied,
  };
};
