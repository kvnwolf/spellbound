/**
 * `?perf`: a development aid that measures every frame. It times the frame
 * loop on the CPU, takes each frame's GPU time per pass from the frame
 * pipeline's GPU timer, counts the render pipelines compiled each frame
 * (a compile mid-Duel is a hitch), and shows a small read-out in the corner.
 * `window.spellboundPerf` exposes the raw samples and a summary for scripted
 * measurement.
 */
import type { Material, Object3D, WebGPURenderer } from "three/webgpu";

import type { GpuTimer } from "./gpu-timer";

/** One frame as the probe saw it. */
export interface ProbeFrame {
  /** `performance.now()` when the frame began, ms. */
  readonly at: number;
  /** Time since the previous frame began, ms. */
  readonly interval: number;
  /** Time the frame loop spent on the CPU, ms. */
  readonly cpu: number;
  /** Render pipelines compiled during the frame. */
  readonly compiled: number;
  /** What they were compiled for: object name or type, and material type. */
  readonly compiledFor: readonly string[];
  /** The scene pass's resolution scale while the frame was drawn. */
  readonly scale: number;
  /** GPU time per pass, ms (filled in a little later). */
  gpu?: Readonly<Record<string, number>>;
}

export interface FrameProbe {
  /** Marks the start of a frame-loop callback. */
  readonly begin: (now: number) => void;
  /** Marks the end of a frame-loop callback, after the frame was rendered. */
  readonly end: (scale: number) => void;
}

/** True when the page was opened with `?perf`. */
export const perfRequested = (): boolean =>
  new URLSearchParams(window.location.search).has("perf");

const percentile = (values: readonly number[], share: number): number => {
  const sorted = values.toSorted((a, b) => a - b);

  return (
    sorted[Math.min(Math.floor(share * sorted.length), sorted.length - 1)] ?? 0
  );
};

const round = (value: number) => Math.round(value * 100) / 100;

const spread = (values: readonly number[]) => ({
  median: round(percentile(values, 0.5)),
  p95: round(percentile(values, 0.95)),
});

const summarise = (frames: readonly ProbeFrame[]) => {
  const intervals = frames.map((frame) => frame.interval);
  const timed = frames.filter((frame) => frame.gpu !== undefined);

  const passes = new Set(
    timed.flatMap((frame) => Object.keys(frame.gpu ?? {}))
  );

  const gpu: Record<string, ReturnType<typeof spread>> = {};

  for (const name of passes) {
    gpu[name] = spread(timed.map((frame) => frame.gpu?.[name] ?? 0));
  }

  return {
    compiled: frames.reduce((sum, frame) => sum + frame.compiled, 0),
    cpu: spread(frames.map((frame) => frame.cpu)),
    frames: frames.length,
    gpu,
    gpuTotal: spread(
      timed.map((frame) =>
        Object.values(frame.gpu ?? {}).reduce((sum, value) => sum + value, 0)
      )
    ),
    interval: { ...spread(intervals), max: round(Math.max(0, ...intervals)) },
    scale: spread(frames.map((frame) => frame.scale)),
  };
};

/** The backend method three.js r186 calls for every new render pipeline. */
interface PipelineHook {
  createRenderPipeline: (
    renderObject: CompiledRenderObject,
    ...rest: readonly unknown[]
  ) => void;
}

/** What three.js r186 hands its backend when compiling a render pipeline. */
interface CompiledRenderObject {
  readonly object: Object3D;
  readonly material: Material;
}

/** Names the object and material a render pipeline is being compiled for. */
const describe = ({ material, object }: CompiledRenderObject): string =>
  `${object.name === "" ? object.type : object.name}/${material.type}`;

const hasPipelineHook = (
  backend: WebGPURenderer["backend"]
): backend is WebGPURenderer["backend"] & PipelineHook =>
  "createRenderPipeline" in backend;

export const createFrameProbe = (
  renderer: WebGPURenderer,
  timer: GpuTimer | undefined
): FrameProbe => {
  const frames: ProbeFrame[] = [];
  // Frames waiting for their GPU timings, by renderer frame number.
  const pending = new Map<number, ProbeFrame>();

  timer?.watch(({ frame, passes }) => {
    const waiting = pending.get(frame);

    if (waiting) {
      waiting.gpu = passes;
      pending.delete(frame);
    }

    for (const number of pending.keys()) {
      if (number < frame - 240) {
        pending.delete(number);
      }
    }
  });

  // Count pipeline compiles, and note what they were for.
  let compiledFor: string[] = [];
  const { backend } = renderer;

  if (hasPipelineHook(backend)) {
    const create = backend.createRenderPipeline.bind(backend);

    backend.createRenderPipeline = (renderObject, ...rest) => {
      compiledFor.push(describe(renderObject));
      create(renderObject, ...rest);
    };
  }

  const readout = document.createElement("pre");
  readout.style.cssText =
    "position:fixed;left:8px;bottom:8px;z-index:99;margin:0;padding:6px 8px;" +
    "font:11px/1.35 ui-monospace,monospace;color:#cfe;background:#0009;" +
    "pointer-events:none;white-space:pre";
  document.body.append(readout);

  let started = 0;
  let at = 0;
  let interval = 0;
  let last: number | undefined;

  Object.assign(window, {
    spellboundPerf: {
      frames,
      /** Forgets every sample so far. */
      reset: () => {
        frames.length = 0;
      },
      /** Median, p95 and worst of the samples since the last reset. */
      summary: () => summarise(frames),
    },
  });

  return {
    begin: (now) => {
      started = performance.now();
      at = now;
      interval = last === undefined ? 0 : now - last;
      last = now;
      compiledFor = [];
    },
    end: (scale) => {
      const frame: ProbeFrame = {
        at,
        compiled: compiledFor.length,
        compiledFor,
        cpu: performance.now() - started,
        interval,
        scale,
      };

      frames.push(frame);

      // Keep the last few minutes only.
      if (frames.length > 20_000) {
        frames.splice(0, 10_000);
      }

      pending.set(renderer.info.frame, frame);

      if (frames.length % 30 === 0) {
        const recent = summarise(frames.slice(-120));
        const { height, width } = renderer.domElement;

        readout.textContent = [
          `frame ${recent.interval.median} ms  p95 ${recent.interval.p95}  max ${recent.interval.max}`,
          `cpu ${recent.cpu.median} ms  gpu ${recent.gpuTotal.median} ms  p95 ${recent.gpuTotal.p95}`,
          ...Object.entries(recent.gpu).map(
            ([name, value]) => `  ${name} ${value.median}`
          ),
          `${width}x${height}  scale ${recent.scale.median}`,
        ].join("\n");
      }
    },
  };
};
