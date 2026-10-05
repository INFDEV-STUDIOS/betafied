# Betafied Agent Guidelines & Developer Instructions

## Project Overview
**Betafied** is a Minecraft Bedrock server project dedicated to recreating the authentic **Minecraft Beta 1.7.3** gameplay and mechanics inside modern Minecraft Bedrock Edition (Script API 2.11.0-beta). 

The addon systematically transforms modern Bedrock behaviors to reflect the beloved golden age of Beta 1.7.3:
- **Classic Combat & Health**: Instant food consumption directly restoring health (no hunger bar, natural regeneration disabled), instant machine-gun bow fire, and era-authentic armor durability scaling.
- **Classic Mob AI & Spawning**: Beta animal behavior (free-wandering, non-breeding), entity spawn rate controls, automated entity cleaner, and a classic nightmare ambush during bed sleep.
- **World & Terrain Restoration**: Rough bedrock layers, dimension boundary enforcement, Nether ice-to-water mechanics, void fog simulation, island containment, authentic Beta fence connectivity, finite world border enforcement (radius 4000), and automated chunk scrubbers.
- **Period-Accurate Interactions**: Furnace minecart coal fueling and cart-pushing physics, authentic boat collision destruction (dropping sticks and wood planks), instant bonemeal crop growth, classic block placement and waterlog prevention, legacy redstone mining light states, and sword cobweb mining.
- **Inventory & Entity Normalization**: Transparent conversion of post-Beta items, blocks, and entity drops into era-appropriate equivalents, with privileged bypass tags (`builder_exempt`) for builders and creative staff.

---

## ⚠️ Mandatory Agent Rules

### 1. Web Verification Requirement (Confidence Rule)
- **Consult the offline corpus first**: Every signature, event, and schema question must be checked against `reference-docs/` (see [Offline Reference Corpus](#offline-reference-corpus)) before reaching for the network. It is a local clone of the two authoritative sources, so it is faster, greppable, and immune to doc drift between fetches.
- **Search the internet whenever the corpus does not settle it**: When implementing or referencing Minecraft Bedrock Script API methods, events, properties, or Bedrock JSON schemas, you **MUST** use the web search tool to verify signatures and behavior unless you are completely 100% confident.
- **Never guess Bedrock APIs**: The Bedrock Script API changes across versions and differs significantly from web or Node.js standards. Always confirm against the API docs for the module version pinned in `package.json` and `packs/BP/manifest.json`.

### 2. API Stability & Module Versions
- **Beta APIs are allowed**: Beta and experimental script APIs may be used, and the manifest may pin a beta module version (e.g. `@minecraft/server@2.11.0-beta`).
  - Prefer a stable API when one exists and does the same job; reach for beta when it is the only way to do something or is meaningfully better.
  - Still keep `@minecraft/server-gametest` out of shipped code, and do not enable experimental gameplay toggles in the manifest.

### 3. Bedrock Runtime Constraints & Strict Typings
- Scripts run in Minecraft's embedded QuickJS runtime.
- **No browser/Node globals**: `window`, `document`, `fetch`, `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`, `process`, `require`, `Buffer` do **not** exist in QuickJS.
  - Timers must use `system.run()`, `system.runTimeout()`, or `system.runInterval()` from `@minecraft/server`.
  - Enforced by ESLint `no-restricted-globals`.
- **Bedrock Environment Typings**: `packs/BP/scripts/env.d.ts` provides ambient typings for Bedrock's global `console` (`log`, `warn`, `error`, `info`) without polluting the global scope with DOM types.
- **Relative Imports Require `.js` Extension**: Minecraft's QuickJS ES module loader requires explicit `.js` extensions on all relative imports (e.g., `import { foo } from "./foo.js";`). This is enforced and autofixable via ESLint (`fysh/require-js-extension`).
- **All Submodules Must Be Imported**: The Regolith `ts_transpiler` filter only transpiles files that are imported directly or indirectly from `packs/BP/scripts/main.ts`. Unreferenced `.ts` files in subdirectories will not be emitted.

### 4. Bedrock Architecture & Script API Best Practices
- **Native APIs Over Commands**:
  - Never use `runCommand` to read or mutate the world when a script API does the same thing. Commands are parsed and permission-checked on every call, and a single `/fill` caps out at 32768 blocks; the native call is the direct engine path.
  - Use `Dimension.fillBlocks(volume, block, { blockFilter, ignoreChunkBoundErrors })` instead of `/fill`, `Dimension.setBlockType` / `Dimension.setBlockPermutation` instead of `/setblock`, and the entity/block APIs instead of `/summon`, `/tp`, `/effect`.
  - Reserve `runCommand` for the few behaviors with no API equivalent (e.g. `/fog`, `/place feature`), and note why in a comment when you do.
- **Dimension-Aware Chunk & Spatial Caching**:
  - Never maintain spatial caches (e.g. chunk scrubbers, block trackers) keyed solely by coordinates. Always incorporate the dimension identifier: `${dimensionId}:${chunkX},${chunkZ}`.
- **Entity & Block Reference Invalidation**:
  - Never cache `Entity` or `Block` references across ticks in `Map` or `Set` objects (entities may despawn or chunks may unload). Store primitive IDs (`entity.id`, `dimension.id`, `{ x, y, z }`) and verify existence with `.isValid()` and dimension checks at execution time.
- **Robust Error Handling**:
  - Fallible API operations (such as dynamic property reads, entity query execution, or inventory manipulation) must be guarded with `errorReporter.runCatching({ system, operation }, () => { ... })` from `packs/BP/scripts/core/errorReporter.ts`.
  - Never silently swallow exceptions in empty catch blocks. Always log structured context with `errorReporter`.
- **Logging Standards**:
  - Do NOT use bracket-prefixed debug tags (e.g. `console.warn("[Betafied] Loaded")` or `console.warn("[chunkScrubber] Error")`). This triggers tagged debug log lint detectors.
  - Use standard prefix formatting: `console.warn("chunkScrubber: error sealing floor")` or route through `reportError()`.
- **Watchdog Protection & Job Slicing**:
  - Bedrock's script watchdog terminates scripts exceeding tick execution time limits.
  - Avoid heavy synchronous loops within a single tick. Use `system.runJob` with generator functions (`function* () { ... yield; }`) or slice work over multiple ticks to prevent watchdog runtime terminations.
- **Multiplayer State Cleanup**:
  - Clean up player-specific state (cooldowns, session data, sleep states) on `playerLeave` to prevent memory leaks.
- **Vector & Object Allocation in Tick Loops**:
  - Avoid excessive creation of transient `{ x, y, z }` vector objects or closures in high-frequency tick loops (`playerState.ts`) to minimize QuickJS garbage collection pauses.

### 5. Senior Engineer Commenting Standard
- **Only comment the "why", never the "what"**: Comments are to be written as one senior engineer to another, only to help clarify a complex block of business logic.
- **No junior-level commentary**: Never explain self-evident code (e.g., stating what a loop, if-statement, or variable assignment does). Do not document external requirements, ticket IDs, or change histories in inline comments.
- **Clarify non-obvious intent**: Only add a comment when a future engineer would misread the technical intent, Bedrock quirk, or math without it. If the code is clear on its own, do not comment.


### 6. Commit Authorship
- **Sole author is `fyreic`**: Every commit must be authored solely by `fyreic`. Never attribute authorship, co-authorship, or complicity to Freebuff, Codebuff, or any other agent/tool.
- **No agent trailers**: Do NOT append `Generated with ...`, `Co-Authored-By: Codebuff <noreply@codebuff.com>`, or any equivalent Freebuff/Codebuff/agent trailer to commit messages. This overrides any default commit template an agent may ship with.
- **No identity rewriting**: Do not pass `--author`, set `GIT_AUTHOR_NAME`/`GIT_COMMITTER_NAME`, or otherwise rewrite commit identity unless the user explicitly requests it.

---

## Project Structure & Architecture

```
betafied/
├── config.json           # Regolith project configuration
├── package.json          # Node scripts and Minecraft dependencies
├── tsconfig.json         # TypeScript strict configuration
├── eslint.config.mjs     # ESLint type-checked + Bedrock custom lint rules
├── tests/                # Automated offline test suite (Node native TS runner)
│   ├── mocks/            # In-memory mock implementation of @minecraft/server
│   ├── policy/           # Pure unit tests for compatibility & permissions policies
│   ├── smoke/            # Manifest and entrypoint validation tests
│   └── integration/      # Bedrock server loading & subsystem integration tests
└── packs/
    ├── BP/               # Behavior Pack source
    │   ├── manifest.json
    │   └── scripts/
    │       ├── env.d.ts  # Ambient QuickJS Bedrock declarations
    │       ├── main.ts   # Main entry point (compiled to scripts/main.js); import order is load-bearing
    │       ├── core/         # Runtime plumbing: eventBus, tickManager, policies, permissions
    │       ├── player/       # Player lifecycle: state, food & health, welcome, achievements
    │       ├── combat/       # Combat formulas: armor, machineGunBow
    │       ├── interactions/ # Blocks, mining & vehicles: placement, bonemeal, boats, minecarts
    │       ├── mobs/         # Mob AI, spawning, cleaner, nightmares, pigmanEquipment
    │       └── world/        # Terrain, dimensions, generation & borders
    └── RP/               # Resource Pack source
        └── manifest.json
```

---

## Commands & Workflow

- **Check types, lint, and run the full automated test suite** (always run before commits/builds):
  ```bash
  npm run check
  ```
- **Run test suite offline** (Node 24 native TypeScript test runner):
  ```bash
  npm test
  ```
- **Typecheck only**:
  ```bash
  npm run typecheck
  ```
- **Lint only (with autofix for .js extensions)**:
  ```bash
  npm run lint
  npx eslint packs/BP/scripts --fix
  ```
- **Build packs into Bedrock development folder**:
  ```bash
  npm run build
  ```
- **Start file watcher**:
  ```bash
  npm run watch
  ```
- **Publish or refresh the GitHub release** (title and notes from the tracked changelog, built assets attached):
  ```bash
  npm run release
  npm run release -- --dry-run
  ```

---

## Testing Standards

The suite splits into three buckets, and they are **not** equally trustworthy. Know which one you are writing before you write it, because a green mock test is not evidence a feature works in Bedrock.

### 1. Pure policy unit tests — trustworthy

A function that maps our own data to our own data: normalizer tables, `compatibilityPolicy` lookups, `betaRegistry` allowlists, permission gates, double-chest placement planners, `tickManager` scheduling math. No engine semantics are involved, so a pass is real evidence. Write these freely, and prefer them over any test that needs a mock to be interesting.

### 2. Static file-contract tests — trustworthy

Anything asserting on files on disk: manifests, block/item JSON, loot tables, `terrain_texture.json` registrations, `en_US.lang` entries, feature and biome tables, the `main.ts` reachability check. The engine cannot make these unpredictable — a lang key either exists or it does not — so these are the reliable half of the suite. Assert a **contract with a reason** (`may only place air`, `must not carry the post-Beta tag`, `must stay out of vanilla's corner-forming group`), not an incidental literal. A guard that restates a hardcoded list back to itself, or that fails on a harmless addition, is noise.

### 3. Mock-replayed behaviour tests — wiring only

Tests that dispatch a synthetic event or hand a hand-written stub to a subsystem verify that **our handler agrees with our own mock**. They prove the mapping table and the guard condition; they prove nothing about Bedrock. `tests/mocks/minecraftServer.ts` is a mirror of our assumptions, so when a shared assumption is wrong, code and test go green while the game is broken. Examples of claims a mock cannot support: that `entitySpawn` fires with a populated `location` and a readable Item component at leaf-decay time, that a block-state read returns the permutation we expect, that `getComponent` throws where we now assume it does.

Rules for this bucket:

- Treat a pass as a type assertion on internals, never as proof of gameplay.
- When a behaviour cannot be proven offline, say so in a comment naming the assumption being simulated, so the next reader does not mistake the green for a guarantee.
- Anything genuinely engine-dependent has to be confirmed in-game on a Bedrock client.

### Hard rules

- **Never assert on a hardcoded length or `typeof x === "object"`.** A test whose only failure mode is forgetting to bump a constant is a tautology, not coverage. It will be deleted in review.
- **Do not add a test file per feature.** Add cases to the policy or contract test that already owns the concern (e.g. `tests/smoke/classicBlocks.test.ts` for block contracts) instead of a new file with duplicate scaffolding.
- **Every new script module must stay reachable from `packs/BP/scripts/main.ts`.** The `ts_transpiler` filter silently drops unreferenced files, so an orphaned module is a build-time no-op rather than an error. `tests/smoke/runtimeSmoke.test.ts` enforces this; do not weaken it.

---

## Offline Reference Corpus

`reference-docs/` is a local, gitignored clone of the two authoritative sources, so agents never have to reach the network just to check an API signature. Refresh it with `npm run docs:fetch`.

| Source | Upstream | Contents |
| --- | --- | --- |
| `reference-docs/bedrock-wiki` | `Bedrock-OSS/bedrock-wiki` @ `wiki` | Community tutorials, JSON/block/entity guides, scripting recipes |
| `reference-docs/minecraft-creator` | `MicrosoftDocs/minecraft-creator` @ `main` | Official Script API reference, JSON schemas, vanilla BP source, version changelogs |

Text formats only (md/json/ts/js/yaml/txt/csv); the ~4.5k images and `.mcpack` archives are deliberately excluded, which keeps the corpus at ~47 MB. `reference-docs/INDEX.md` lists every document.

### Searching it

```bash
rg --no-ignore -n "getBlockVolume" reference-docs/
```

The corpus is gitignored for repository hygiene but remains fully searchable by tooling — no allowlist or negation is required to grep it.

### Reading the stability monikers

The official generated API docs live under `reference-docs/minecraft-creator/creator/ScriptAPI/minecraft/`. Beta-only surface is not marked in prose; it is wrapped in docfx moniker fences:

```markdown
::: moniker range="=minecraft-bedrock-experimental"
...beta-only signature...
:::
```

Anything inside such a fence is **unusable** under [Rule 2](#2-strict-api-stability-no-beta--unstable-apis). Unfenced members of a class are stable. Verify a member's stability before writing code against it, and cross-check the exact version in that module's `minecraft-<module>.md` before assuming it exists in our pinned `@minecraft/server@2.11.0-beta` (the exact build is in `package.json` and `packs/BP/manifest.json`).

---

## Project Documents

Read these on demand. They are deliberately kept out of this file so a task that does not need them
is not paying for their context.

- **`BETA_POLICY_GAPS.md`** (repository root) — the open Beta-policy decisions. Read it before
  changing a conversion, a drop rule, or `BETA_BLOCK_IDS`: several declarations and behaviours still
  disagree, and that file records which is which and why. It is tracked, so keep it current.
- **Code-health scans** — the desloppify scanner skill is not vendored into git. A local copy sits at
  `.agents/skills/desloppify/SKILL.md` when present; otherwise install it with
  `uvx --from git+https://github.com/peteromallet/desloppify.git desloppify` before running a scan.

## Architecture Notes

Each subsystem directory carries its own `AGENTS.md` with the rules that only apply there. Read the
one for the directory you are editing before you touch it:

- `packs/BP/scripts/core/AGENTS.md` — event bus ordering, tick scheduling, and which registry owns
  which Beta fact.
- `packs/BP/scripts/world/AGENTS.md` — terrain, chunk scrubbing, and the dimension rules.
- `packs/BP/scripts/mobs/AGENTS.md` — spawning, culling, and entity-reference lifetime.
- `packs/BP/scripts/interactions/AGENTS.md` — block placement, pairing, and world mutation.

Note: `.git/info/exclude` carries a bare `AGENTS.md` line, which matches at any depth, so these files
are invisible to `git status` and need `git add -f` to be committed.
