## Working on Spellbound

- **Stack.** Bun (package manager and script runner), Vite, strict TypeScript 7 (its `tsc` is the native `tsgo` compiler), Ultracite on oxlint and oxfmt, Vitest, `three` r186 with `WebGPURenderer` (import from `three/webgpu` and `three/tsl`).
- **Gate.** A change is done when `bun run typecheck`, `bun run lint`, `bun run test` and `bun run build` all pass. CI (`.github/workflows/ci.yml`) runs the same four on every pull request and every push to `main`. `bun run fix` applies the lint and format autofixes.
- **Tests** drive a seam from outside and assert snapshots, events or mapped output, never internals. The seams: the Duel simulation (`src/duel`); the DualSense adapter (`src/dualsense`: input, menu input, haptics and the output report); the Controllers' Intent mapping (`src/controllers`: the human one, the AI, the Training Dummies and the lesson demos, each driven against a Duel or a snapshot); the screen state machine and its view (`src/screens`); and the pure helpers of the render and audio layers, which touch neither the GPU nor Web Audio (camera framing and clearance, the crosshair's size, the sound cue mapping, sample choice and spatial mix, the activation hint).
- **Pure logic** (`src/duel`, `src/dualsense/input.ts`, `src/dualsense/menu-input.ts`, `src/controllers`, `src/screens`) never imports three.js or the DOM. Every tuning number lives in `src/tuning.ts`.
- **Strings.** Every player-facing string lives in two dictionaries of the same shape: Spanish in `src/text.ts`, which sets the shape, and English in `src/text-en.ts`, typed against it, so a string added to one fails to compile until the other has it too (keep both in the same key order). Code reads the language being played from `text`, which Options swaps in place: read it when drawing and never keep a part of it; anything drawn once and kept (a label, a heading) is written through `keepTranslated`, so a change of language redraws it. English keeps the spell names in Latin and gives the Potions their canonical names.
- **Verification.** Anything a person can see or feel is also checked at runtime in Chrome on the dev server (`bun run dev`), with a DualSense.
- **Commits.** Conventional commits: `<type>(<scope>): <subject>`, imperative, lowercase, no trailing period.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `kvnwolf/spellbound`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
