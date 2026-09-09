# Agent Guidelines for kikitori-bench

This repository uses [Effect (v4)](https://effect.website/docs/v4/onboarding) and TypeScript.

## Privacy: what must never be committed

This benchmark is developed against a **private corpus that must never be
published**, together with everything derived from it. Treat the recordings, the
transcripts and every run artefact as unpublishable, and do not describe their
contents in committed files either.

**Never commit, and never quote in code, comments, docs or commit messages:**

1. **Dataset content** - `datasets/**` (audio, `dataset.yaml`, `domain-keywords.txt`).
   The only exception is `datasets/demo/`, which is synthetic.
2. **Run artefacts** - `runs/**` and `reports/**` quote the ground truth and every
   model's hypothesis verbatim. They are ignored for exactly that reason.
3. **Secrets and machine-local paths** - `.env`, API keys, `/Users/<name>/...`,
   Obsidian vault names, iCloud container paths. A personal path must come from an
   argument or an environment variable, never from a default baked into the source.
4. **Phrases taken from the recordings.** This is the leak that actually happens:
   an illustrative example copied into a comment, a README section, or a config
   sample. Invent neutral examples instead - if an example needs a proper noun,
   use a public product name, not one from the corpus.

**Before every commit run `pnpm check:leaks`.** It compares what is *staged* against
the local private material and fails on secrets, personal paths and staged
artefacts; its "review manually" list is expected to contain shared technical
vocabulary and must be read rather than ignored. A non-zero exit means do not commit.

Results may be published only in aggregate: leaderboard numbers, per-axis scores,
token counts, costs. Never publish a sample id together with its text, and never
publish a transcript, hypothesis or judge rationale.

**Repository visibility is the maintainer's decision.** Do not create a public
repository, change visibility, or push to a public remote on their behalf.

## Toolchain

- `pnpm check` runs the full gate: `pnpm typecheck`, `pnpm lint` (oxlint) and
  `pnpm format:check` (oxfmt). Run it before proposing a change.
- Effect diagnostics come from `@effect/tsgo`: `pnpm install` runs
  `effect-tsgo patch`, which patches the local `typescript` and `oxlint`
  binaries. Without that patch the Effect rules silently disappear, so never
  skip lifecycle scripts, and keep `@effect/tsgo`, `oxlint` and
  `oxlint-tsgolint` pinned to the exact versions the patch supports.
- In `tsc` output, Effect suggestions are hidden - the editor still surfaces
  them - while Effect warnings and errors fail the typecheck like any type
  error. The tree is warning-free today; keep it that way rather than muting a
  rule to get a change through.
- `oxfmt` owns formatting for `src/**` and `scripts/**` TypeScript only;
  Markdown, YAML, JSON and the review UI's HTML are left alone on purpose.
- Editors: point them at the workspace TypeScript (`node_modules/typescript`)
  so the patched language service, and with it the Effect refactors and
  quick fixes, is the one that runs.
- Git hooks are managed by lefthook (`lefthook.yml`) and installed by the same
  `prepare` script. The `pre-commit` hook formats the staged TypeScript and
  re-stages it, then runs lint, typecheck and `check:leaks` - the leak check
  runs last, and without a glob, because it inspects the staged content itself.
  `LEFTHOOK=0 git commit ...` skips the hook; do not reach for it to get a
  commit past the leak check.

## Core Rules & Conventions

1. **Strict Type Safety**:
   - Always run `pnpm typecheck` (`tsc --noEmit`) to verify changes.
   - Do not use `any`. Use `unknown` or Effect's typed combinators.

2. **Error Handling**:
   - Never throw raw exceptions.
   - Define domain errors using `Data.TaggedError` or `Schema.TaggedError`.
   - Wrap external async operations in `Effect.tryPromise` with explicit error mapping.

3. **Data Schemas**:
   - Use `effect/Schema` for all data structures (datasets, results, configuration, judge responses).
   - Use `Schema.decodeUnknownSync` or `Schema.decodeUnknownPromise` for parsing and validation.

4. **Service Architecture**:
   - Encapsulate dependencies and external side-effects (ASR services, file repos, Codex client) behind `Context.Service` (or `Context.Tag`).
   - Provide concrete implementations via `Layer`.

5. **Concurrency & Execution**:
   - Use `Effect.gen` for sequential and generator-based workflows.
   - Use `Effect.all` with `{ concurrency: ... }` for batch processing audio files or judge items.
