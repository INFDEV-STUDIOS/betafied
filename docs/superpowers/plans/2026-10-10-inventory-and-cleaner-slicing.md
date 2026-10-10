# InventoryManager & EntityCleaner Time-Slicing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement time-sliced player sweeps in `inventoryManager.ts` and 20-entity batching with handle lifetime validation in `entityCleaner.ts`.

**Architecture:** Convert `inventoryManager`'s periodic sweep into a generator task yielding every 2 players while preserving synchronous execution for tests. Refactor `entityCleaner`'s `cleanerJob` to yield every 20 entities and validate entity/player `.isValid` status across yield boundaries.

**Tech Stack:** TypeScript, Node.js 24 Test Runner, Minecraft Bedrock Script API (`@minecraft/server`).

**Spec:** `docs/superpowers/specs/2026-10-10-inventory-and-cleaner-slicing-design.md`

## Global Constraints

- QuickJS single-threaded tick budget: unbounded iterations must be sliced across ticks.
- No live Entity or Block handles held across yield boundaries without `.isValid` re-validation.
- Relative imports must use explicit `.js` extensions.
- All commits authored by `fyreic` with no agent trailers.
- Verification gate: `npm run check` must pass cleanly.

## Review Focus

- Single-player world: `inventorySweepJob` finishes in 1 tick without yielding.
- Multi-player world: `inventorySweepJob` yields every `PLAYERS_PER_TICK = 2` players.
- `entityCleaner` processing >20 entities: yields every 20 entities instead of every 1 entity.
- Player disconnects during multi-tick sweep: generator completes safely without unhandled errors.
- Existing policy tests: continue executing synchronously through `processPlayers()` wrapper.

---

### Task 1: Time-slice `inventoryManager.ts` with Player Batching

**Files:**
- Modify: `tests/policy/inventoryManager.test.ts`
- Modify: `packs/BP/scripts/core/inventoryManager.ts:150-185`
- Test: `tests/policy/inventoryManager.test.ts`

**Interfaces:**
- Consumes: `tickManager` from `../core/tickManager.js`, `system` from `@minecraft/server`
- Produces: `inventorySweepJob(): Generator<void, void, unknown>`, synchronous `processPlayers(): void`

- [ ] **Step 1: Write failing unit test in `tests/policy/inventoryManager.test.ts`**

Add tests for:
1. `inventorySweepJob`: With 3 players online, stepping the generator yields after 2 players (`CONFIG.PLAYERS_PER_TICK = 2`) and completes on next step.
2. `processPlayers()`: Synchronously sweeps all players to completion for existing test compatibility.
3. Player leave: Invalid player handle skipped without error.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --import ./tests/mocks/register.mjs --test "tests/policy/inventoryManager.test.ts"`
Expected: FAIL (inventorySweepJob does not exist yet)

- [ ] **Step 3: Implement `inventorySweepJob` and update registration in `packs/BP/scripts/core/inventoryManager.ts`**

1. Add `PLAYERS_PER_TICK: 2` to `CONFIG`.
2. Implement `export function* inventorySweepJob(): Generator<void, void, unknown>` yielding every `CONFIG.PLAYERS_PER_TICK` players.
3. Re-implement `export function processPlayers(): void` as `for (const _ of inventorySweepJob()) {}`.
4. Register `inventorySweepJob` with `tickManager.register("inventoryManager", CONFIG.CHECK_INTERVAL, inventorySweepJob, 0)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --import ./tests/mocks/register.mjs --test "tests/policy/inventoryManager.test.ts"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packs/BP/scripts/core/inventoryManager.ts tests/policy/inventoryManager.test.ts
git commit -m "feat(inventory): time-slice player inventory sweep across ticks"
```

---

### Task 2: Refactor `entityCleaner.ts` Entity Batching & Lifetime Validation

**Files:**
- Create: `tests/mobs/entityCleaner.test.ts`
- Modify: `packs/BP/scripts/mobs/entityCleaner.ts:1-69`
- Test: `tests/mobs/entityCleaner.test.ts`

**Interfaces:**
- Consumes: `cleanerJob` from `../../packs/BP/scripts/mobs/entityCleaner.js`
- Produces: 20-entity batching in `cleanerJob`, handle validation across yields

- [ ] **Step 1: Write failing unit tests in `tests/mobs/entityCleaner.test.ts`**

Add tests for:
1. Batching cadence: When 45 entities are present, stepping `cleanerJob()` yields at 20 and 40 entities, taking 3 steps total instead of 45.
2. Invalid handle safety: Entities that become invalid (`isValid === false`) during sweep are skipped.
3. Player disconnect safety: Player becoming invalid across a yield breaks from that player's loop without throwing.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --import ./tests/mocks/register.mjs --test "tests/mobs/entityCleaner.test.ts"`
Expected: FAIL (cleanerJob yields 1-by-1 currently)

- [ ] **Step 3: Update `packs/BP/scripts/mobs/entityCleaner.ts`**

1. Add `ENTITIES_PER_TICK: 20` to `CONFIG`.
2. Refactor `cleanerJob` to count `processed++` and yield only every `CONFIG.ENTITIES_PER_TICK` entities.
3. Check `if (!player.isValid) break;` after resuming from yield.
4. Check `if (!ent.isValid) continue;` before each entity.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --import ./tests/mocks/register.mjs --test "tests/mobs/entityCleaner.test.ts"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packs/BP/scripts/mobs/entityCleaner.ts tests/mobs/entityCleaner.test.ts
git commit -m "feat(mobs): batch entity cleaner sweeps into 20-item chunks with handle validation"
```

---

### Task 3: Full Project Verification & Lint Check

**Files:**
- Test: Full repository

- [ ] **Step 1: Run full verification suite**

Run: `npm run check`
Expected: Typecheck clean, lint clean, all tests pass.

- [ ] **Step 2: Verify git status and log**

Run: `git status && git log -3`
Expected: Working tree clean, author `fyreic`, no agent trailers.
