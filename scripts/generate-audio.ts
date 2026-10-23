/**
 * Generates the audio catalog with ElevenLabs, once, on a developer machine:
 * `bun scripts/generate-audio.ts [--force] [id ...]`. Reads
 * `ELEVENLABS_API_KEY` from `.env.local` (Bun loads it), writes
 * `public/audio/<id>.mp3` and `public/audio/catalog.json` for the listening
 * page. Files that exist are skipped unless `--force` or named by id.
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";

import { audioCatalog } from "./audio-catalog";
import type { AudioEntry } from "./audio-catalog";

const key = process.env.ELEVENLABS_API_KEY;

if (key === undefined || key === "") {
  throw new Error("ELEVENLABS_API_KEY is missing from .env.local");
}

const api = "https://api.elevenlabs.io/v1";
const outDir = "public/audio";

// ponytail: fixed small pool, raise if the account's concurrency allows.
const concurrency = 3;

const args = process.argv.slice(2);
const force = args.includes("--force");
const only = new Set(args.filter((arg) => !arg.startsWith("--")));

const request = (entry: AudioEntry) =>
  entry.kind === "music"
    ? {
        body: {
          force_instrumental: true,
          music_length_ms: Math.round(entry.seconds * 1000),
          prompt: entry.prompt,
        },
        url: `${api}/music?output_format=mp3_44100_128`,
      }
    : {
        body: {
          duration_seconds: entry.seconds,
          loop: entry.loop ?? false,
          prompt_influence: 0.5,
          text: entry.prompt,
        },
        url: `${api}/sound-generation?output_format=mp3_44100_128`,
      };

const generate = async (entry: AudioEntry) => {
  const file = `${outDir}/${entry.id}.mp3`;
  const named = only.has(entry.id);

  if (only.size > 0 && !named) {
    return;
  }

  if (!(force || named) && existsSync(file)) {
    console.log(`skip ${entry.id}`);

    return;
  }

  const { body, url } = request(entry);

  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "xi-api-key": key },
    method: "POST",
  });

  if (!response.ok) {
    console.error(
      `FAIL ${entry.id}: ${response.status} ${await response.text()}`
    );

    return;
  }

  await writeFile(file, new Uint8Array(await response.arrayBuffer()));
  console.log(`ok   ${entry.id}`);
};

await mkdir(outDir, { recursive: true });

const queue = [...audioCatalog];

await Promise.all(
  Array.from({ length: concurrency }, async () => {
    for (let entry = queue.shift(); entry; entry = queue.shift()) {
      // oxlint-disable-next-line no-await-in-loop -- a small worker pool, one request at a time each
      await generate(entry);
    }
  })
);

await writeFile(
  `${outDir}/catalog.json`,
  `${JSON.stringify(
    audioCatalog.map(({ group, id, kind, label, loop, prompt, seconds }) => ({
      file: `/audio/${id}.mp3`,
      group,
      id,
      kind,
      label,
      loop: loop ?? false,
      prompt,
      // The dev server answers missing files with the app page, so the
      // listening page can't probe for them: record what exists here.
      ready: existsSync(`${outDir}/${id}.mp3`),
      seconds,
    })),
    null,
    2
  )}\n`
);
