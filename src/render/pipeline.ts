import { bloom } from "three/addons/tsl/display/BloomNode.js";
/**
 * The final image: one MSAA scene pass in scene-linear HDR, full-scene bloom
 * on top (so the moon, flames, embers and every Spell's emissive glow without
 * a selection pass), a soft vignette, then the renderer's single tone map and
 * sRGB output conversion. It also switches on the moon's shadow map, and
 * warms up: draws a first frame, then compiles every effect not drawn yet.
 *
 * The scene pass and bloom render at the dynamic resolution scale (see
 * `resolution.ts`), driven by the GPU timer, and the output upscales them.
 */
import { pass, screenUV, smoothstep, vec4 } from "three/tsl";
import {
  ACESFilmicToneMapping,
  CanvasTarget,
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
  /**
   * Renders the first frame (which sets the scene pass up), then compiles
   * everything that has not drawn yet, reporting the share done; resolves
   * when nothing is left to compile on first sight.
   */
  readonly warm: (progress?: (share: number) => void) => Promise<void>;
  /** The scene's current resolution scale, 0..1 per axis. */
  readonly scale: () => number;
  /** GPU frame timings, when the GPU has timestamp queries. */
  readonly gpuTimer: GpuTimer | undefined;
}

/**
 * The image graph both the Duel's frame and the lesson preview draw with:
 * the MSAA scene pass in scene-linear HDR, bloom, the vignette, and the
 * renderer's one tone map and output conversion.
 */
const createImage = (
  renderer: WebGPURenderer,
  scene: Scene,
  camera: Camera,
  settings: Tuning["render"]
) => {
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

  return { glare, pipeline, scenePass };
};

export const createFramePipeline = (
  renderer: WebGPURenderer,
  scene: Scene,
  camera: Camera,
  settings: Tuning["render"]
): FramePipeline => {
  const { glare, pipeline, scenePass } = createImage(
    renderer,
    scene,
    camera,
    settings
  );

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

  const render = () => {
    const scale = applyScale();
    pipeline.render();
    drawnAt.set(renderer.info.frame, scale);

    if (drawnAt.size > 600) {
      drawnAt.clear();
    }

    gpuTimer?.frameEnd();
  };

  return {
    gpuTimer,
    render,
    scale: () => applied,
    warm: async (progress) => {
      render();
      await prewarm(renderer, scene, camera, scenePass.renderTarget, progress);
    },
  };
};

export interface PreviewPipeline {
  /**
   * Sizes the preview's canvas to its laid-out box, CSS pixels, at
   * `pixelRatio` (held under the scene's pixel cap); its targets follow on
   * the next render.
   */
  readonly fit: (width: number, height: number, pixelRatio: number) => void;
  /** Renders one frame of `scene` through the preview's camera into its canvas. */
  readonly render: () => void;
  /** Renders a first frame, then compiles everything not drawn yet, as `FramePipeline.warm`. */
  readonly warm: (progress?: (share: number) => void) => Promise<void>;
}

/**
 * The lesson preview's image, drawn by the game's own renderer into a
 * canvas of its own in the menu (a second `CanvasTarget`): its own scene
 * pass and bloom, sized to the panel rather than the window, so the cost
 * goes with the panel's pixels, the Duel's frame targets are never
 * reallocated by it, and the opaque menu needs no hole cut in it. The
 * renderer is switched to the preview's canvas only for the length of a
 * render and handed back to the main one straight after. GPU time goes to
 * the Duel's frame timer (`gpuTimer`), frame by frame.
 */
export const createPreviewPipeline = (
  renderer: WebGPURenderer,
  scene: Scene,
  camera: Camera,
  settings: Tuning["render"],
  canvas: HTMLCanvasElement,
  gpuTimer: GpuTimer | undefined
): PreviewPipeline => {
  const target = new CanvasTarget(canvas);

  const { pipeline, scenePass } = createImage(
    renderer,
    scene,
    camera,
    settings
  );

  /** Runs `draw` with the renderer on the preview's canvas, then hands it back. */
  const onPreview = (draw: () => void) => {
    const main = renderer.getCanvasTarget();
    renderer.setCanvasTarget(target);

    try {
      draw();
    } finally {
      renderer.setCanvasTarget(main);
    }
  };

  const render = () => {
    onPreview(() => {
      pipeline.render();
    });
    gpuTimer?.frameEnd();
  };

  return {
    fit: (width, height, pixelRatio) => {
      const w = Math.max(Math.round(width), 1);
      const h = Math.max(Math.round(height), 1);

      const ratio = Math.min(
        pixelRatio,
        Math.sqrt(settings.resolution.maxPixels / (w * h))
      );

      if (
        target.getPixelRatio() !== ratio ||
        canvas.width !== Math.floor(w * ratio) ||
        canvas.height !== Math.floor(h * ratio)
      ) {
        // On the preview's canvas, so the renderer hears of the resize
        // and remakes that canvas's attachments.
        onPreview(() => {
          target.setPixelRatio(ratio);
          target.setSize(w, h, false);
        });
      }
    },
    render,
    warm: async (progress) => {
      render();
      await prewarm(renderer, scene, camera, scenePass.renderTarget, progress);
    },
  };
};
