/**
 * Dynamic resolution: the share of the canvas's physical pixels the scene is
 * rendered at (then upscaled), kept as high as the GPU can hold at 60 fps.
 *
 * The scale never goes above the pixel cap (`maxPixels`), which alone keeps
 * a typical window at full resolution and only trims very large ones. Under
 * that cap it follows measured GPU frame time: when a window of frames runs
 * over the budget it steps down at once, by as much as the overrun asks
 * (cost goes with pixels, so with the scale squared); when several windows
 * in a row run well under it (judged by an upper quantile, so spikes count),
 * it steps back up one notch at a time. Each
 * change waits a while before the next, so it never oscillates, and frames
 * drawn before a change are not judged after it.
 */
import type { Tuning } from "../tuning";

type ResolutionSettings = Tuning["render"]["resolution"];

export interface ResolutionControl {
  /** The scale to render the scene at now, 0..1 of the canvas's pixels per axis. */
  readonly scale: () => number;
  /** The canvas now has `pixels` physical pixels: re-derives the cap. */
  readonly resize: (pixels: number) => void;
  /** One frame's GPU time, ms, drawn at `scale`. */
  readonly sample: (gpuMs: number, scale: number) => void;
}

/** The highest scale that keeps `pixels` within the cap, quantised down to a step. */
const capFor = (pixels: number, settings: ResolutionSettings) => {
  const fit = Math.sqrt(settings.maxPixels / Math.max(pixels, 1));

  return Math.min(1, Math.floor(fit / settings.step) * settings.step);
};

const quantile = (values: readonly number[], share: number) =>
  values.toSorted((a, b) => a - b)[
    Math.min(Math.floor(values.length * share), values.length - 1)
  ] ?? 0;

export const createResolutionControl = (
  settings: ResolutionSettings
): ResolutionControl => {
  let cap = 1;
  let current = 1;
  let window: number[] = [];
  let calmWindows = 0;
  // Windows to skip after a change, so its own effect is what gets judged.
  let settling = 0;

  const set = (next: number) => {
    const clamped = Math.min(Math.max(next, settings.minScale), cap);

    if (clamped !== current) {
      current = clamped;
      settling = settings.settleWindows;
      calmWindows = 0;
    }
  };

  const judge = (gpuMs: number) => {
    if (settling > 0) {
      settling -= 1;

      return;
    }

    if (gpuMs > settings.budgetMs) {
      // Pixels scale with the square of the scale.
      const wanted = current * Math.sqrt(settings.budgetMs / gpuMs);
      set(Math.floor(wanted / settings.step) * settings.step);

      return;
    }

    calmWindows =
      gpuMs < settings.budgetMs * settings.calmShare ? calmWindows + 1 : 0;

    if (calmWindows >= settings.calmWindows) {
      set(
        Math.round((current + settings.step) / settings.step) * settings.step
      );
    }
  };

  return {
    resize: (pixels) => {
      cap = capFor(pixels, settings);
      current = cap;
      window = [];
      calmWindows = 0;
      settling = settings.settleWindows;
    },
    sample: (gpuMs, scale) => {
      // A frame drawn at another scale says nothing about this one.
      if (!settings.dynamic || scale !== current) {
        return;
      }

      window.push(gpuMs);

      if (window.length >= settings.windowFrames) {
        judge(quantile(window, settings.quantile));
        window = [];
      }
    },
    scale: () => current,
  };
};
