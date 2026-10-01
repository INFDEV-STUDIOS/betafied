# Betafied Agent Guidelines & Developer Instructions

## Project Overview
**Betafied** is a Minecraft Bedrock server project dedicated to recreating the authentic **Minecraft Beta 1.7.3** gameplay and mechanics inside modern Minecraft Bedrock Edition (Script API 2.10.0+). 

The addon systematically transforms modern Bedrock behaviors to reflect the beloved golden age of Beta 1.7.3:
- **Classic Combat & Health**: Instant food consumption directly restoring health (no hunger bar, natural regeneration disabled), instant machine-gun bow fire, and era-authentic armor durability scaling.
- **Classic Mob AI & Spawning**: Beta animal behavior (free-wandering, non-breeding), entity spawn rate controls, automated entity cleaner, classic nightmare ambush during bed sleep, and random world spawn distribution.
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
  - Do NOT use bracket-prefixed debug tags (e.g. `console.warn("[Betafied] Loaded")` or `console.warn("[worldSpawn] Error")`). This triggers tagged debug log lint detectors.
  - Use standard prefix formatting: `console.warn("worldSpawn: error setting spawn")` or route through `reportError()`.
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

Anything inside such a fence is **unusable** under [Rule 2](#2-strict-api-stability-no-beta--unstable-apis). Unfenced members of a class are stable. Verify a member's stability before writing code against it, and cross-check the exact version in that module's `minecraft-<module>.md` before assuming it exists in our pinned `@minecraft/server@2.10.0`.

---
name: desloppify
description: >
  Multi-language codebase health scanner. Use when the user explicitly asks
  to run desloppify, scan for technical debt, get a health score, or create
  a cleanup plan. Do NOT trigger for general code review, renaming, or
  fixing individual bugs.
---

<!-- desloppify-begin -->
<!-- desloppify-skill-version: 7 -->

# Desloppify

## 1. Your Job

Maximise the **strict score** honestly. Your main cycle: **scan → plan → execute → rescan**. Follow the scan output's **INSTRUCTIONS FOR AGENTS** — don't substitute your own analysis.

**Don't be lazy.** Do large refactors and small detailed fixes with equal energy. If it takes touching 20 files, touch 20 files. If it's a one-line change, make it. No task is too big or too small — fix things properly, not minimally.

## 2. The Workflow

Three phases, repeated as a cycle.

### Monorepos and multi-project directories

If the workspace contains multiple programs (e.g., frontend + backend in sibling folders), scan each one separately — do not scan the parent directory:

```bash
desloppify --lang typescript scan --path ./frontend
desloppify --lang python scan --path ./backend
```

Each `--path` target should be a single coherent project. Scanning a parent that contains multiple programs mixes state and path context, producing unreliable results.

### Phase 1: Scan and review — understand the codebase

```bash
desloppify scan --path .       # analyse the codebase
desloppify status              # check scores — are we at target?
```

After scanning, **always run `desloppify next`** — it tells you exactly what to do, in order. Don't interpret the scan output yourself or ask the user what to do. Just run `next` and follow its instructions.

The scan will tell you if subjective dimensions need review. Follow its instructions. To trigger a review manually:
```bash
desloppify review --prepare    # then follow your runner's review workflow
```

### Phase 2: Plan — decide what to work on

After reviews, triage stages and plan creation appear in the execution queue surfaced by `next`. Complete them in order — `next` tells you what each stage expects in the `--report`:
```bash
desloppify next                                        # shows the next execution workflow step
desloppify plan triage --stage observe --report "themes and root causes..."
desloppify plan triage --stage reflect --report "comparison against completed work..."
desloppify plan triage --stage organize --report "summary of priorities..."
desloppify plan triage --complete --strategy "execution plan..."
```

For automated triage: `desloppify plan triage --run-stages --runner codex` (Codex), `--runner claude` (Claude), or `--runner rovodev` (Rovo Dev). Options: `--only-stages`, `--dry-run`, `--stage-timeout-seconds`.

Then shape the queue. **The plan shapes everything `next` gives you** — `next` is the execution queue, not the full backlog. Don't skip this step.

```bash
desloppify plan                          # see the living plan details
desloppify plan queue                    # compact execution queue view
desloppify plan reorder <pat> top        # reorder — what unblocks the most?
desloppify plan cluster create <name>    # group related issues to batch-fix
desloppify plan focus <cluster>          # scope next to one cluster
desloppify plan skip <pat>              # defer — hide from next
```

### Phase 3: Execute — grind the queue to completion

Trust the plan and execute. Don't rescan mid-queue — finish the queue first.

**Branch first.** Create a dedicated branch — never commit health work directly to main:
```bash
git checkout -b desloppify/code-health    # or desloppify/<focus-area>
desloppify config set commit_pr 42        # link a PR for auto-updated descriptions
```

**The loop:**
```bash
# 1. Get the next item from the execution queue
desloppify next

# 2. Fix the issue in code

# 3. Resolve it (next shows the exact command including required attestation)

# 4. When you have a logical batch, commit and record
git add <files> && git commit -m "desloppify: fix 3 deferred_import findings"
desloppify plan commit-log record      # moves findings uncommitted → committed, updates PR

# 5. Push periodically
git push -u origin desloppify/code-health

# 6. Repeat until the queue is empty
```

Score may temporarily drop after fixes — cascade effects are normal, keep going.
If `next` suggests an auto-fixer, run `desloppify autofix <fixer> --dry-run` to preview, then apply.

**When the queue is clear, go back to Phase 1.** New issues will surface, cascades will have resolved, priorities will have shifted. This is the cycle.

## 3. Reference

### Key concepts

- **Tiers**: T1 auto-fix → T2 quick manual → T3 judgment call → T4 major refactor.
- **Auto-clusters**: related findings are auto-grouped in `next`. Drill in with `next --cluster <name>`.
- **Zones**: production/script (scored), test/config/generated/vendor (not scored). Fix with `zone set`.
- **Wontfix cost**: widens the lenient↔strict gap. Challenge past decisions when the gap grows.

### Scoring

Overall score = **25% mechanical** + **75% subjective**.

- **Mechanical (25%)**: auto-detected issues — duplication, dead code, smells, unused imports, security. Fixed by changing code and rescanning.
- **Subjective (75%)**: design quality review — naming, error handling, abstractions, clarity. Starts at **0%** until reviewed. The scan will prompt you when a review is needed.
- **Strict score** is the north star: wontfix items count as open. The gap between overall and strict is your wontfix debt.
- **Score types**: overall (lenient), strict (wontfix counts), objective (mechanical only), verified (confirmed fixes only).

### Reviews

Four paths to get subjective scores:

- **Local runner (Codex)**: `desloppify review --run-batches --runner codex --parallel --scan-after-import` — automated end-to-end.
- **Local runner (Claude)**: `desloppify review --prepare` → launch parallel subagents → `desloppify review --import merged.json` — see skill doc overlay for details.
- **Local runner (Rovo Dev)**: `desloppify review --run-batches --runner rovodev --parallel --scan-after-import` — automated end-to-end via `acli rovodev run` subprocesses.
- **Cloud/external**: `desloppify review --external-start --external-runner claude` → follow session template → `--external-submit`.
- **Manual path**: `desloppify review --prepare` → review per dimension → `desloppify review --import file.json`.

**Batch output vs import filenames:** Individual batch outputs from subagents must be named `batch-N.raw.txt` (plain text/JSON content, `.raw.txt` extension). The `.json` filenames in `--import merged.json` or `--import findings.json` refer to the final merged import file, not individual batch outputs. Do not name batch outputs with a `.json` extension.

**Subagent parallelism limit:** Do not launch every review batch at once. Run subagents in small waves, usually **3-5 concurrent agents**, and wait for a wave to finish before starting the next. If agents return empty, partial, or rate-limit-shaped results, reduce the wave size and retry only failed batches. Launching 20+ subagents at once can exhaust API quota and produce no usable review output.

- Import first, fix after — import creates tracked state entries for correlation.
- Target-matching scores trigger auto-reset to prevent gaming. Use the blind-review workflow described in your agent overlay doc (e.g. `docs/CLAUDE.md`, `docs/HERMES.md`).
- Even moderate scores (60-80) dramatically improve overall health.
- Stale dimensions auto-surface in `next` — just follow the queue.

**Integrity rules:** Score from evidence only — no prior chat context, score history, or target-threshold anchoring. When evidence is mixed, score lower and explain uncertainty. Assess every requested dimension; never drop one.

#### Review output format

Return machine-readable JSON for review imports. For `--external-submit`, include `session` from the generated template:

```json
{
  "session": {
    "id": "<session_id_from_template>",
    "token": "<session_hmac_from_template>"
  },
  "assessments": {
    "<dimension_from_query>": 0
  },
  "findings": [
    {
      "dimension": "<dimension_from_query>",
      "identifier": "short_id",
      "summary": "one-line defect summary",
      "related_files": ["relative/path/to/file.py"],
      "evidence": ["specific code observation"],
      "suggestion": "concrete fix recommendation",
      "confidence": "high|medium|low"
    }
  ]
}
```

`findings` MUST match `query.system_prompt` exactly (including `related_files`, `evidence`, and `suggestion`). Use `"findings": []` when no defects found. Import is fail-closed: invalid findings abort unless `--allow-partial` is passed. Assessment scores are auto-applied from trusted internal or cloud session imports. Legacy `--attested-external` remains supported.

#### Import paths

- Robust session flow (recommended): `desloppify review --external-start --external-runner claude` → use generated prompt/template → run printed `--external-submit` command.
- Durable scored import (legacy): `desloppify review --import findings.json --attested-external --attest "I validated this review was completed without awareness of overall score and is unbiased."`
- Findings-only fallback: `desloppify review --import findings.json`

#### Reviewer agent prompt

Runners that support agent definitions (Cursor, Copilot, Gemini) can create a dedicated reviewer agent. Use this system prompt:

```
You are a code quality reviewer. You will be given a codebase path, a set of
dimensions to score, and what each dimension means. Read the code, score each
dimension 0-100 from evidence only, and return JSON in the required format.
Do not anchor to target thresholds. When evidence is mixed, score lower and
explain uncertainty.
```

See your editor's overlay section below for the agent config format.

### Plan commands

```bash
desloppify plan reorder <cluster> top       # move all cluster members at once
desloppify plan reorder <a> <b> top        # mix clusters + findings in one reorder
desloppify plan reorder <pat> before -t X  # position relative to another item/cluster
desloppify plan cluster reorder a,b top    # reorder multiple clusters as one block
desloppify plan resolve <pat>              # mark complete
desloppify plan reopen <pat>               # reopen
desloppify backlog                          # broader non-execution backlog
```

### Commit tracking

```bash
desloppify plan commit-log                      # see uncommitted + committed status
desloppify plan commit-log record               # record HEAD commit, update PR description
desloppify plan commit-log record --note "why"  # with rationale
desloppify plan commit-log record --only "smells::*"  # record specific findings only
desloppify plan commit-log history              # show commit records
desloppify plan commit-log pr                   # preview PR body markdown
desloppify config set commit_tracking_enabled false  # disable guidance
```

After resolving findings as `fixed`, the tool shows uncommitted work, committed history, and a suggested commit message. After committing externally, run `record` to move findings from uncommitted to committed and auto-update the linked PR description.

### Agent directives

Directives are messages shown to agents at lifecycle phase transitions — use them to switch models, set constraints, or give context-specific instructions.

```bash
desloppify directives                     # show all configured directives
desloppify directives set execute "Switch to claude-sonnet-4-6. Focus on speed."
desloppify directives set triage "Switch to claude-opus-4-6. Read carefully."
desloppify directives set review "Use blind packet. Do not anchor on previous scores."
desloppify directives unset execute       # remove a directive
```

Available phases: `execute`, `review`, `triage`, `workflow`, `scan` (and fine-grained variants like `review_initial`, `triage_postflight`, etc.).

### Quick reference

```bash
desloppify next --count 5                         # top 5 execution items
desloppify next --cluster <name>                  # drill into a cluster
desloppify backlog --count 5                      # top 5 backlog items outside execution
desloppify show <pattern>                         # filter by file/detector/ID
desloppify show --status open                     # all open findings
desloppify plan skip --permanent "<id>" --note "reason" --attest "..." # accept debt
desloppify exclude <path>                         # exclude a directory from scanning
desloppify config show                            # show all config including excludes
desloppify scan --path . --reset-subjective       # reset subjective baseline to 0
```

## 4. Fix Tool Issues Upstream

When desloppify itself appears wrong or inconsistent — a bug, a bad detection, a crash, confusing output — **fix it and open a PR**. If you can't confidently fix it, file an issue instead.

### Fix and PR (preferred)

Clone the tool repo to a temp directory, make the fix there, and verify it works against the project you're scanning before pushing.

```bash
git clone https://github.com/peteromallet/desloppify.git /tmp/desloppify-fix
cd /tmp/desloppify-fix
git checkout -b fix/<short-description>
```

Make your changes, then run the test suite and verify the fix against the original project:

```bash
python -m pytest desloppify/tests/ -q
python -m desloppify scan --path <project-root>   # the project you were scanning
```

Once it looks good, push and open a PR:

```bash
git add <files> && git commit -m "fix: <what and why>"
git push -u origin fix/<short-description>
gh pr create --title "fix: <short description>" --body "$(cat <<'EOF'
## Problem
<what went wrong — include the command and output>

## Fix
<what you changed and why>
EOF
)"
```

Clean up after: `rm -rf /tmp/desloppify-fix`

### File an issue (fallback)

If the fix is unclear or the change needs discussion, open an issue at `https://github.com/peteromallet/desloppify/issues` with a minimal repro: command, path, expected output, actual output.

## Prerequisite

`command -v desloppify >/dev/null 2>&1 && echo "desloppify: installed" || echo "NOT INSTALLED — run: uvx --from git+https://github.com/peteromallet/desloppify.git desloppify"`

If `uvx` is not available: `pip install desloppify[full] && desloppify setup`

<!-- desloppify-end -->

## Gemini CLI Overlay

Gemini CLI has experimental subagent support, but subagents currently run
sequentially (not in parallel). Review dimensions one at a time.

### Setup

Enable subagents in Gemini CLI settings:
```json
{
  "experimental": {
    "enableAgents": true
  }
}
```

Optionally define a reviewer agent in `.gemini/agents/desloppify-reviewer.md`:

```yaml
---
name: desloppify-reviewer
description: Scores subjective codebase quality dimensions for desloppify
kind: local
tools:
  - read_file
  - search_code
temperature: 0.2
max_turns: 10
---
```

Use the prompt from the "Reviewer agent prompt" section above.

### Review workflow

Invoke the reviewer agent for each group of dimensions sequentially.
Even without parallelism, isolating dimensions across separate agent
invocations prevents score bleed between concerns.

Merge assessments and findings, then import.

When Gemini CLI adds parallel subagent execution, split dimensions across
concurrent agent calls instead.

<!-- desloppify-overlay: gemini -->
<!-- desloppify-end -->
