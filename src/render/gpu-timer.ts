/**
 * GPU frame timings from WebGPU timestamp queries: how long the GPU spent on
 * each frame, and on each pass in it (shadow map, scene, bloom, output).
 *
 * The renderer stamps a begin and an end on every render pass. On tile-based
 * GPUs (every Apple Silicon Mac) a pass's begin is stamped when its vertex
 * work starts, which can be long before the previous pass's fragments
 * finish, so per-pass durations overlap and their sum, which three.js
 * reports, can be many times the real frame. Ends are completion times, so
 * this charges each pass from the previous pass's end (or its own begin,
 * after an idle gap) to its own end; the frame is the sum.
 *
 * Reading the timestamps back is a GPU-to-CPU copy, so it happens every
 * `resolveEvery` frames, for all of them at once, off the frame's critical path.
 */
import { InspectorBase } from "three/webgpu";
import type { Camera, RenderTarget, Scene, WebGPURenderer } from "three/webgpu";

/** One frame's GPU time, ms: in total and per pass. */
export interface GpuFrame {
  /** The renderer's frame number (`renderer.info.frame`). */
  readonly frame: number;
  readonly total: number;
  readonly passes: Readonly<Record<string, number>>;
}

export interface GpuTimer {
  /** Call once a frame, after it was rendered. */
  readonly frameEnd: () => void;
  /** Calls `listener` with every frame's timings as they are read back. */
  readonly watch: (listener: (frame: GpuFrame) => void) => void;
}

/** The private parts of three.js r186's WebGPU backend the timer reads. */
interface TimestampBackend {
  readonly trackTimestamp: boolean;
  readonly timestampQueryPool: {
    readonly render?: {
      readonly queryOffsets: Map<string, number>;
      readonly resultBuffer: GPUBuffer;
    };
  };
}

const isTimestampBackend = (
  backend: WebGPURenderer["backend"]
): backend is WebGPURenderer["backend"] & TimestampBackend =>
  "trackTimestamp" in backend &&
  backend.trackTimestamp === true &&
  "timestampQueryPool" in backend;

/** Groups a render (by its scene's or target's name) into its pass. */
const passOf = (label: string): string => {
  if (label.startsWith("Shadow")) {
    return "shadow";
  }

  if (label.startsWith("Bloom")) {
    return "bloom";
  }

  if (label === "Render Pipeline") {
    return "output";
  }

  // The scene pass renders into its own target, named after its output.
  return label === "output" ? "scene" : label || "other";
};

interface TimedRender {
  readonly begin: number;
  readonly end: number;
  readonly pass: string;
}

const frameOf = (frame: number, renders: TimedRender[]): GpuFrame => {
  renders.sort((first, second) => first.end - second.end);
  const passes: Record<string, number> = {};
  let finished = Number.NEGATIVE_INFINITY;
  let total = 0;

  for (const render of renders) {
    const cost = Math.max(render.end - Math.max(finished, render.begin), 0);
    passes[render.pass] = (passes[render.pass] ?? 0) + cost;
    total += cost;
    finished = Math.max(finished, render.end);
  }

  return { frame, passes, total };
};

/**
 * Starts timing `renderer`'s frames, or returns nothing when the renderer was
 * not created with `trackTimestamp` or the GPU has no timestamp queries.
 */
export const createGpuTimer = (
  renderer: WebGPURenderer,
  resolveEvery = 30
): GpuTimer | undefined => {
  const { backend } = renderer;

  if (!isTimestampBackend(backend)) {
    return undefined;
  }

  // Which pass each timestamp id belongs to, as the renderer announces it.
  const labels = new Map<string, string>();
  const listeners: ((frame: GpuFrame) => void)[] = [];
  let frames = 0;
  let resolving = false;

  renderer.inspector = Object.assign(new InspectorBase(), {
    beginRender: (
      uid: string,
      scene: Scene,
      _camera: Camera,
      renderTarget: RenderTarget | null
    ) => {
      labels.set(
        uid,
        scene.name === "" ? (renderTarget?.texture.name ?? "") : scene.name
      );
    },
  });

  /** Reads back the raw ticks of every render since the last resolve. */
  const resolve = async () => {
    const pool = backend.timestampQueryPool.render;

    if (!pool) {
      return;
    }

    resolving = true;
    // The pool forgets its offsets as it starts resolving: keep a copy.
    const offsets = new Map(pool.queryOffsets);
    const buffer = pool.resultBuffer;
    const mappedRange = buffer.getMappedRange.bind(buffer);
    let ticks: BigUint64Array | undefined;

    buffer.getMappedRange = (...args) => {
      const range = mappedRange(...args);
      // Copied: the range is gone once the pool unmaps the buffer.
      ticks = BigUint64Array.from(new BigUint64Array(range));

      return range;
    };

    try {
      await renderer.resolveTimestampsAsync("render");
    } finally {
      buffer.getMappedRange = mappedRange;
      resolving = false;
    }

    if (!ticks) {
      return;
    }

    const byFrame = new Map<number, TimedRender[]>();

    for (const [uid, offset] of offsets) {
      const frame = Number(/:f(?<frame>\d+)$/u.exec(uid)?.groups?.frame);
      const begin = ticks[offset];
      const end = ticks[offset + 1];
      const label = labels.get(uid);
      labels.delete(uid);

      if (begin === undefined || end === undefined || label === undefined) {
        continue;
      }

      const renders = byFrame.get(frame) ?? [];
      renders.push({
        begin: Number(begin) / 1e6,
        end: Number(end) / 1e6,
        pass: passOf(label),
      });
      byFrame.set(frame, renders);
    }

    for (const [frame, renders] of byFrame) {
      const timing = frameOf(frame, renders);

      for (const listener of listeners) {
        listener(timing);
      }
    }

    // Ids that were never timed (a skipped resolve) must not pile up.
    if (labels.size > 4096) {
      labels.clear();
    }
  };

  return {
    frameEnd: () => {
      frames += 1;

      if (!resolving && frames % resolveEvery === 0) {
        void resolve();
      }
    },
    watch: (listener) => {
      listeners.push(listener);
    },
  };
};
