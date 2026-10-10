# Betafied Agent Guidelines & Developer Instructions

**Betafied** recreates authentic **Minecraft Beta 1.7.3** gameplay inside modern
Minecraft Bedrock Edition (Script API 2.11.0-beta): classic combat and health, Beta mob
AI and spawning, terrain restoration, period-accurate interactions, and transparent
conversion of post-Beta items, blocks and drops into era-appropriate equivalents. The
full feature list and repository layout are in
[docs/agents/project-overview.md](docs/agents/project-overview.md).

## Read before you work

This file is the always-loaded layer and holds the binding rules. Everything else is
reference — nothing under `docs/` loads automatically, so read the row that matches the
task.

| Task | Read |
| --- | --- |
| Editing anything under `packs/BP/scripts/` | [packs/BP/scripts/AGENTS.md](packs/BP/scripts/AGENTS.md) — this also loads automatically while you work in that directory |
| Editing a subsystem (`core/`, `world/`, `mobs/`, `interactions/`) | that directory's own `AGENTS.md`, listed under [Architecture Notes](#architecture-notes) |
| Any signature, event or schema question | [docs/agents/reference-corpus.md](docs/agents/reference-corpus.md) |
| Writing or reviewing tests | [docs/agents/testing.md](docs/agents/testing.md) |
| A lint finding, or adding a custom rule | [docs/agents/lint-rules.md](docs/agents/lint-rules.md) |
| Commands, build, release | [docs/agents/workflow.md](docs/agents/workflow.md) |
| What Beta authenticity means here | [docs/agents/project-overview.md](docs/agents/project-overview.md) |
| How these instruction files load, and where a new rule belongs | [docs/agents/README.md](docs/agents/README.md) |

## ⚠️ Mandatory Agent Rules

### 1. Web Verification Requirement (Confidence Rule)

- **Consult the offline corpus first**: Every signature, event, and schema question must
  be checked against `reference-docs/` (see
  [Offline Reference Corpus](docs/agents/reference-corpus.md)) before reaching for the
  network. It is a local clone of the two authoritative sources, so it is faster,
  greppable, and immune to doc drift between fetches.
- **Search the internet whenever the corpus does not settle it**: When implementing or
  referencing Minecraft Bedrock Script API methods, events, properties, or Bedrock JSON
  schemas, you **MUST** use the web search tool to verify signatures and behavior unless
  you are completely 100% confident.
- **Never guess Bedrock APIs**: The Bedrock Script API changes across versions and
  differs significantly from web or Node.js standards. Always confirm against the API
  docs for the module version pinned in `package.json` and `packs/BP/manifest.json`.

### 2. API Stability & Module Versions

- **Beta APIs are allowed**: Beta and experimental script APIs may be used, and the
  manifest may pin a beta module version (e.g. `@minecraft/server@2.11.0-beta`).
  - Prefer a stable API when one exists and does the same job; reach for beta when it is
    the only way to do something or is meaningfully better.
  - Still keep `@minecraft/server-gametest` out of shipped code, and do not enable
    experimental gameplay toggles in the manifest.

### 3. Bedrock Runtime Constraints & Strict Typings

Scripts run in QuickJS, with no browser/Node globals, `.js` extensions required on
relative imports, and only files reachable from `main.ts` emitted by the `ts_transpiler`
filter. The binding list — with the mechanism behind each constraint — is in
[packs/BP/scripts/AGENTS.md](packs/BP/scripts/AGENTS.md).

### 4. Bedrock Architecture & Script API Best Practices

Binding and documented in [packs/BP/scripts/AGENTS.md](packs/BP/scripts/AGENTS.md):
native APIs over `runCommand`, dimension-aware spatial keys, no cross-tick `Entity`/`Block`
references, `errorReporter.runCatching` for every fallible engine call, no hand-written
bracket-prefixed log tags, `JobRunner` / `system.runJob` slicing for heavy iteration,
`playerLeave` state cleanup, and no transient vector or closure allocation in tick loops.

### 5. Senior Engineer Commenting Standard

- **Only comment the "why", never the "what"**: Comments are to be written as one senior
  engineer to another, only to help clarify a complex block of business logic.
- **No junior-level commentary**: Never explain self-evident code (e.g., stating what a
  loop, if-statement, or variable assignment does). Do not document external requirements,
  ticket IDs, or change histories in inline comments.
- **Clarify non-obvious intent**: Only add a comment when a future engineer would misread
  the technical intent, Bedrock quirk, or math without it. If the code is clear on its
  own, do not comment.

### 6. Commit Authorship

- **Sole author is `fyreic`**: Every commit must be authored solely by `fyreic`. Never
  attribute authorship, co-authorship, or complicity to Freebuff, Codebuff, or any other
  agent/tool.
- **No agent trailers**: Do NOT append `Generated with ...`,
  `Co-Authored-By: Codebuff <noreply@codebuff.com>`, or any equivalent
  Freebuff/Codebuff/agent trailer to commit messages. This overrides any default commit
  template an agent may ship with.
- **No identity rewriting**: Do not pass `--author`, set
  `GIT_AUTHOR_NAME`/`GIT_COMMITTER_NAME`, or otherwise rewrite commit identity unless the
  user explicitly requests it.

## Commands & Workflow

```bash
npm run check      # typecheck + lint + full test suite — always run before commits/builds
npm test           # offline suite (Node 24 native TypeScript test runner)
npm run typecheck  # tsc --noEmit
npm run lint       # eslint packs/BP/scripts (use --fix for .js extensions)
npm run build      # build packs into the Bedrock development folder
npm run watch      # file watcher
npm run release    # publish or refresh the GitHub release (--dry-run to preview)
```

`npm run check` is the gate. Do not describe a change as working until it has passed, and
do not describe it as verified at all unless you have run it. The lint rules, the release
flow and the exit-status discipline when filtering output are in
[docs/agents/workflow.md](docs/agents/workflow.md).

## Architecture Notes

Each subsystem directory carries its own `AGENTS.md` with the rules that only apply
there. Read the one for the directory you are editing before you touch it:

- `packs/BP/scripts/AGENTS.md` — runtime constraints and the cross-cutting Script API
  rules for all pack code.

All of these are read locally and stripped from the build by `filters/agents-md-strip/`, so
adding one does not add anything to the exported pack or the release archives.
- `packs/BP/scripts/core/AGENTS.md` — event bus ordering, tick scheduling, and which
  registry owns which Beta fact.
- `packs/BP/scripts/world/AGENTS.md` — terrain, chunk scrubbing, and the dimension rules.
- `packs/BP/scripts/mobs/AGENTS.md` — spawning, culling, and entity-reference lifetime.
- `packs/BP/scripts/interactions/AGENTS.md` — block placement, pairing, and world
  mutation.

### Which of these files exist in a clone

`.gitignore` treats agent configuration as personal and per-clone — `CLAUDE.md`, `docs/`,
`.agents/`, `.superpowers/` and `.desloppify/` are all listed under "AI & Agent
configurations, prompts, and planning artifacts", and `AGENTS.md` is kept out of that file
only because agent tooling hides paths matched there; it is excluded per-clone with a bare
pattern in `.git/info/exclude` that matches at any depth. The practical upshot:

- **Only the root `AGENTS.md` is tracked.** Everything it points at — the nested
  `AGENTS.md` files and every file under `docs/agents/` — exists only on the machine that
  created or restored it.
- A fresh clone therefore has a root file whose pointers dangle. That is the expected
  state, not a deleted instruction. Re-create the reference set locally, or restore it
  from wherever it is kept, before trusting those pointers.
- Use `git add -f <path>` only when committing a nested file is a deliberate decision;
  the exclusion is otherwise load-bearing for the repo's stated hygiene policy.

## Project Documents

Read these on demand. They are deliberately kept out of this file so a task that does not
need them is not paying for their context.

- **`BETA_POLICY_GAPS.md`** (repository root) — the open Beta-policy decisions. Read it
  before changing a conversion, a drop rule, or `BETA_BLOCK_IDS`: several declarations and
  behaviours still disagree, and that file records which is which and why. It is tracked,
  so keep it current.
- **Code-health scans** — the desloppify scanner skill is not vendored into git. A local
  copy sits at `.agents/skills/desloppify/SKILL.md` when present; otherwise install it
  with `uvx --from git+https://github.com/peteromallet/desloppify.git desloppify` before
  running a scan.
