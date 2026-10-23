import { bloom } from "three/addons/tsl/display/BloomNode.js";
/**
 * The final image: one MSAA scene pass in scene-linear HDR, full-scene bloom
 * on top (so the moon, flames, embers and every Spell's emissive glow without
 * a selection pass), a soft vignette, then the renderer's single tone map and
 * sRGB output conversion. It also switches on the moon's shadow map, and
 * after the first frame compiles every effect that has not drawn yet.
 */
import { pass, screenUV, smoothstep, vec4 } from "three/tsl";
import {
  ACESFilmicToneMapping,
  PCFShadowMap,
  RenderPipeline,
} from "three/webgpu";
import type { Camera, Scene, WebGPURenderer } from "three/webgpu";

import type { Tuning } from "../tuning";
import { prewarm } from "./prewarm";

export interface FramePipeline {
  /** Renders one frame of `scene` through the camera given at creation. */
  readonly render: () => void;
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

  let warmed = false;

  return {
    render: () => {
      pipeline.render();

      // After the first frame (which sets the scene pass up), compile
      // everything that has not drawn yet, in the background.
      if (!warmed) {
        warmed = true;
        void prewarm(renderer, scene, camera, scenePass.renderTarget);
      }
    },
  };
};
