/**
 * The approved samples, fetched from `/audio/<id>.mp3` and decoded once the
 * AudioContext exists. Each keeps the span between its leading and trailing
 * silence (MP3 encoder padding included), so one-shots start on their first
 * sound and loops wrap without a gap.
 */
import type { SampleId } from "./samples";

export interface Sample {
  readonly buffer: AudioBuffer;
  /** Seconds into the buffer where the sound starts... */
  readonly start: number;
  /** ...and where it has ended. */
  readonly end: number;
}

/** The first and last moments any channel is louder than `floor`. */
const spanOf = (buffer: AudioBuffer, floor: number) => {
  let first = buffer.length;
  let last = 0;

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    let index = 0;

    while (index < first && Math.abs(data[index] ?? 0) <= floor) {
      index += 1;
    }

    first = Math.min(first, index);
    index = data.length - 1;

    while (index > last && Math.abs(data[index] ?? 0) <= floor) {
      index -= 1;
    }

    last = Math.max(last, index + 1);
  }

  return last > first
    ? { end: last / buffer.sampleRate, start: first / buffer.sampleRate }
    : { end: buffer.duration, start: 0 };
};

export interface SampleBank {
  /** The sample, once decoded. */
  readonly get: (id: SampleId) => Sample | undefined;
  /** Settles once every sample has loaded or failed; resolves to the ids that failed. */
  readonly ready: Promise<SampleId[]>;
}

const urlOf = (id: SampleId) => `${import.meta.env.BASE_URL}audio/${id}.mp3`;

/** Starts fetching and decoding every one of `ids`; each is playable as soon as it is decoded. */
export const loadSamples = (
  ctx: BaseAudioContext,
  ids: readonly SampleId[],
  silenceFloor: number
): SampleBank => {
  const samples = new Map<SampleId, Sample>();

  const load = async (id: SampleId) => {
    const response = await fetch(urlOf(id));

    if (!response.ok) {
      throw new Error(`${id}: HTTP ${response.status}`);
    }

    const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
    samples.set(id, { buffer, ...spanOf(buffer, silenceFloor) });
  };

  const loadAll = async () => {
    const results = await Promise.allSettled(ids.map(load));

    return ids.filter((id, index) => {
      const result = results[index];

      if (result?.status !== "rejected") {
        return false;
      }

      console.error(`Sound sample ${id} failed to load:`, result.reason);

      return true;
    });
  };

  return { get: (id) => samples.get(id), ready: loadAll() };
};
