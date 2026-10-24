import { WebGPURenderer } from "three/webgpu";

/**
 * Creates the renderer, or returns nothing when the browser cannot run
 * Spellbound. WebGPU only: `WebGPURenderer` silently falls back to WebGL2,
 * so this checks for a WebGPU adapter before creating it and checks the
 * backend it actually initialised afterwards. GPU timestamp queries are on
 * (where the GPU has them): dynamic resolution runs on measured GPU time.
 */
export const createWebGPURenderer = async (
  canvas: HTMLCanvasElement
): Promise<WebGPURenderer | undefined> => {
  if (!("gpu" in navigator)) {
    return undefined;
  }

  const adapter = await navigator.gpu.requestAdapter().catch(() => null);

  if (adapter === null) {
    return undefined;
  }

  const renderer = new WebGPURenderer({
    antialias: true,
    canvas,
    trackTimestamp: true,
  });

  try {
    await renderer.init();
  } catch {
    return undefined;
  }

  const { backend } = renderer;

  if (!("isWebGPUBackend" in backend) || backend.isWebGPUBackend !== true) {
    void renderer.dispose();

    return undefined;
  }

  renderer.setPixelRatio(window.devicePixelRatio);

  return renderer;
};
