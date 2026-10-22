## Working on Spellbound

- **Stack.** Bun (package manager and script runner), Vite, strict TypeScript 7 (its `tsc` is the native `tsgo` compiler), Ultracite on oxlint and oxfmt, Vitest, `three` r186 with `WebGPURenderer` (import from `three/webgpu` and `three/tsl`).
- **Gate.** A change is done when `bun run typecheck`, `bun run lint`, `bun run test` and `bun run build` all pass. CI (`.github/workflows/ci.yml`) runs the same four on every pull request and every push to `main`. `bun run fix` applies the lint and format autofixes.
- **Tests** live at two seams only: the Duel simulation (`src/duel`) and the DualSense adapter (`src/dualsense`, plus the human Controller's Intent mapping). They drive the seam from outside and assert snapshots, events or mapped output, never internals.
- **Pure logic** (`src/duel`, `src/dualsense/input.ts`, `src/controllers`) never imports three.js or the DOM. Every tuning number lives in `src/tuning.ts`; every player-facing string, in Spanish, in `src/text.ts`.
- **Verification.** Anything a person can see or feel is also checked at runtime in Chrome on the dev server (`bun run dev`), with a DualSense.
- **Commits.** Conventional commits: `<type>(<scope>): <subject>`, imperative, lowercase, no trailing period.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `kvnwolf/spellbound`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
