# Spatial & Secondary Systems Time-Slicing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement cooperative time-slicing, batching, and handle lifetime safety across `nightmares.ts`, `boatCollision.ts`, `doubleChest.ts`, `betaAnimalAI.ts`, and `classicFog.ts` using `JobRunner` and `tickManager`.

**Architecture:** Replace unmetered synchronous sweeps and untracked generator spawning with cooperative time-slicing. Integrate `JobRunner` for spatial query cancellation in `nightmares.ts`, store primitive coordinates across multi-tick intervals instead of live Bedrock handles, and apply bounded batching across secondary sweeps.

**Tech Stack:** TypeScript, Minecraft Bedrock Script API (`@minecraft/server@2.11.0-beta`), QuickJS runtime, Node.js native test runner (`node:test`).

**Spec:** [`docs/superpowers/specs/2026-10-10-spatial-and-secondary-slicing-design.md`](file:///Users/fyreic/Documents/projects/betafied/docs/superpowers/specs/2026-10-10-spatial-and-secondary-slicing-design.md)

## Global Constraints
- Target Minecraft Bedrock Script API: `@minecraft/server@2.11.0-beta`.
- QuickJS runtime: no Node/browser globals, `.js` extensions mandatory on relative imports.
- Never hold live `Entity`, `Player`, `Block`, or `Dimension` handles across generator `yield;` points without re-validating `.isValid`.
- No unused variables in drain loops (use `const job = generator(); while (!job.next().done) {}`).
- Commit author must strictly be `fyreic <333091942+fyreic-dev@users.noreply.github.com>` with zero agent trailers.
- Tracked/untracked files under `docs/` must be staged using `git add -f`.

## Review Focus
- Waking up or leaving bed while nightmare spatial scan is active: job must be cancelled immediately via `jobRunner.cancel` and no mob spawns.
- Player disconnects during multi-tick nightmare or fog sweep: job must terminate cleanly without throwing or memory leaks.
- Boat or animal destroyed/despawned between yield ticks: generator must check `.isValid` and skip without throwing.
- Chest broken mid-sweep across sessions: generator must continue safely without attempting container access on missing block.
- Single-player or small server environments: sweeps under batch thresholds must finish in 1 tick without extra yield overhead.

---

### Task 1: Tracked Cancellable Spatial Scans in `nightmares.ts`

**Files:**
- Modify: `packs/BP/scripts/mobs/nightmares.ts`
- Create: `tests/mobs/nightmares.test.ts`

**Interfaces:**
- Consumes: `JobRunner` from `packs/BP/scripts/core/jobRunner.js`.
- Produces: `activeNightmareScans` map tracking primitive bed records and `jobId`, cancellable via `nightmareJobRunner.cancel(jobId)`.

- [ ] **Step 1: Write the failing tests for nightmares spatial job tracking and cancellation**

Write tests in `tests/mobs/nightmares.test.ts`:
- Test that `lightCheckGenerator` batches queries and yields every 50 blocks.
- Test that second bed interaction cancels the active job via `jobRunner.cancel` and removes the record.
- Test that `playerLeave` cancels the active job and removes the record.
- Test that despawned/invalid player during spawn aborts safely.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/mobs/nightmares.test.ts`
Expected: FAIL (module or export not updated / tests fail).

- [ ] **Step 3: Implement JobRunner tracking and handle-free state in `nightmares.ts`**

Update `packs/BP/scripts/mobs/nightmares.ts`:
- Instantiate `const nightmareJobRunner = new JobRunner();`.
- Update `BedInteraction` interface to store `playerId: string`, `dimensionId: string`, `bedLocation: Vector3`, and optional `jobId?: number`.
- Update `lightCheckGenerator(dimensionId: string, bedLoc: Vector3, bedKey: string)`.
- On bed interact, track `jobId = nightmareJobRunner.run(lightCheckGenerator(...))`.
- On second interact and on `playerLeave`, if `record.jobId !== undefined`, call `nightmareJobRunner.cancel(record.jobId)`.
- When spawning nightmare, re-fetch player and bed block, validating `player.isValid` and dimension match.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/mobs/nightmares.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packs/BP/scripts/mobs/nightmares.ts tests/mobs/nightmares.test.ts
git commit -m "feat: track and cancel nightmare spatial scans with JobRunner"
```

---

### Task 2: Boat Collision Slicing in `boatCollision.ts`

**Files:**
- Modify: `packs/BP/scripts/interactions/boatCollision.ts`
- Create: `tests/interactions/boatCollision.test.ts`

**Interfaces:**
- Consumes: `tickManager` from `packs/BP/scripts/core/tickManager.js`.
- Produces: `boatLoopJob(): Generator<void, void, unknown>`, `processBoats(): void` synchronous wrapper.

- [ ] **Step 1: Write the failing tests for boat collision generator and batching**

Write tests in `tests/interactions/boatCollision.test.ts`:
- Test that `boatLoopJob()` yields every 10 boats (`BOATS_PER_TICK = 10`).
- Test that invalid/destroyed boats across yields are safely skipped (`boat.isValid`).
- Test that synchronous `processBoats()` drains the generator completely.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/interactions/boatCollision.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement boatLoopJob generator and batching in `boatCollision.ts`**

Update `packs/BP/scripts/interactions/boatCollision.ts`:
- Add `BOATS_PER_TICK: 10` to `CONFIG`.
- Convert `export function* boatLoopJob(): Generator<void, void, unknown>`.
- Check `if (!boat.isValid) continue;` before each boat.
- Yield after every 10 boats processed.
- Add `export function processBoats(): void` draining `boatLoopJob()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/interactions/boatCollision.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packs/BP/scripts/interactions/boatCollision.ts tests/interactions/boatCollision.test.ts
git commit -m "feat: time-slice boat collision checks in batches of 10"
```

---

### Task 3: Double Chest Session Sweep Slicing in `doubleChest.ts`

**Files:**
- Modify: `packs/BP/scripts/interactions/doubleChest.ts`
- Create: `tests/interactions/doubleChest.test.ts`
- Verify: `tests/smoke/doubleChest.test.ts`

**Interfaces:**
- Consumes: `tickManager` from `packs/BP/scripts/core/tickManager.js`.
- Produces: `sweepPairsJob(): Generator<void, void, unknown>`, `sweepPairs(): void` synchronous wrapper.

- [ ] **Step 1: Write the failing tests for double chest sweep generator**

Write tests in `tests/interactions/doubleChest.test.ts`:
- Test that `sweepPairsJob()` yields every 10 chest sessions (`CHEST_PAIRS_PER_TICK = 10`).
- Test that `sweepPairs()` runs synchronously and completes without errors.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/interactions/doubleChest.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement sweepPairsJob generator in `doubleChest.ts`**

Update `packs/BP/scripts/interactions/doubleChest.ts`:
- Define `const CHEST_PAIRS_PER_TICK = 10;`.
- Implement `export function* sweepPairsJob(): Generator<void, void, unknown>`.
- Yield every `CHEST_PAIRS_PER_TICK` sessions processed.
- Provide `export function sweepPairs(): void` that drains `sweepPairsJob()`.
- Register `sweepPairsJob` with `tickManager`: `tickManager.register("doubleChest:sweep", SWEEP_INTERVAL_TICKS, sweepPairsJob);`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/interactions/doubleChest.test.ts tests/smoke/doubleChest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packs/BP/scripts/interactions/doubleChest.ts tests/interactions/doubleChest.test.ts
git commit -m "feat: convert double chest sweeps to time-sliced generator"
```

---

### Task 4: Beta Animal AI and Classic Fog Batching

**Files:**
- Modify: `packs/BP/scripts/mobs/betaAnimalAI.ts`
- Modify: `packs/BP/scripts/world/classicFog.ts`
- Create: `tests/mobs/betaAnimalAI.test.ts`
- Create: `tests/world/classicFog.test.ts`

**Interfaces:**
- Consumes: `tickManager` from `packs/BP/scripts/core/tickManager.js`.
- Produces: batched `animalJumpJob` (10 animals/tick) and `fogJob` (5 players/tick).

- [ ] **Step 1: Write the failing tests for animal AI and fog batching**

Write tests in:
- `tests/mobs/betaAnimalAI.test.ts`: verify `animalJumpJob()` yields every 10 animals and skips despawned animals.
- `tests/world/classicFog.test.ts`: verify `fogJob()` yields every 5 players and skips invalid players.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/mobs/betaAnimalAI.test.ts tests/world/classicFog.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement batching in betaAnimalAI.ts and classicFog.ts**

- In `packs/BP/scripts/mobs/betaAnimalAI.ts`:
  - Add `ANIMALS_PER_TICK: 10` to `CONFIG`.
  - Batch evaluations: yield every 10 animals instead of after every hop.
  - Verify `player.isValid` and `entity.isValid` across yields.
- In `packs/BP/scripts/world/classicFog.ts`:
  - Add `PLAYERS_PER_TICK: 5` to `CONFIG`.
  - Check `if (!player.isValid) continue;`.
  - Yield every 5 players instead of every 1 player.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/mobs/betaAnimalAI.test.ts tests/world/classicFog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packs/BP/scripts/mobs/betaAnimalAI.ts packs/BP/scripts/world/classicFog.ts tests/mobs/betaAnimalAI.test.ts tests/world/classicFog.test.ts
git commit -m "feat: batch animal AI and classic fog player sweeps"
```

---

### Task 5: Full Verification Gate & Code Review Dispatch

**Files:**
- Verify all modified files across the branch.

- [ ] **Step 1: Run full verification gate**

Run: `npm run check`
Expected: `tsc --noEmit` clean, ESLint clean, all 455+ tests passing.

- [ ] **Step 2: Dispatch read-only senior code review subagent**

Dispatch code reviewer subagent over the git range for Sub-project 3 to verify conformance with Bedrock constraints and plan goals.
