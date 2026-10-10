# Sub-project 3: Spatial & Secondary Systems Time-Slicing Design

## Overview
This specification details the time-slicing, batching, and handle lifecycle improvements for:
1. Spatial job tracking & cancellation in [`nightmares.ts`](file:///Users/fyreic/Documents/projects/betafied/packs/BP/scripts/mobs/nightmares.ts)
2. Sliced entity sweeps in [`boatCollision.ts`](file:///Users/fyreic/Documents/projects/betafied/packs/BP/scripts/interactions/boatCollision.ts)
3. Sliced multi-block session sweeps in [`doubleChest.ts`](file:///Users/fyreic/Documents/projects/betafied/packs/BP/scripts/interactions/doubleChest.ts)
4. AI scan batching in [`betaAnimalAI.ts`](file:///Users/fyreic/Documents/projects/betafied/packs/BP/scripts/mobs/betaAnimalAI.ts)
5. Player iteration batching in [`classicFog.ts`](file:///Users/fyreic/Documents/projects/betafied/packs/BP/scripts/world/classicFog.ts)

Following the scheduler upgrades in Sub-project 1 and core sweeps in Sub-project 2, this sub-project completes the migration of long-running operations to cooperative time-slicing under Bedrock QuickJS runtime constraints.

---

## 1. Tracked Cancellable Spatial Scans (`packs/BP/scripts/mobs/nightmares.ts`)

### Problem
1. **Untracked Generator Spawning**: `nightmares.ts` invokes `system.runJob(lightCheckGenerator(block, bedKey))` without tracking the returned job identifier. If the player leaves the bed (wakes up) or disconnects, the generator continues stepping across ticks for up to ~1,700 block queries.
2. **Long-lived Object References**: The `BedInteraction` record holds live `player: Player` and `block: Block` references across dozens of ticks. If the player leaves or the bed is broken while the job steps, accessing these references can cause stale engine access or runtime errors.

### Architectural Solution
1. **JobRunner Integration**:
   - Instantiate an internal `JobRunner` instance: `const nightmareJobRunner = new JobRunner();`.
   - Store the active job ID in `BedInteraction`:
     ```typescript
     interface BedInteraction {
         count: number;
         playerId: string;
         dimensionId: string;
         bedLocation: Vector3;
         jobId?: number;
         windowExpired: boolean;
         scanComplete: boolean;
         hasLight: boolean | null;
     }
     ```
2. **Explicit Cancellation**:
   - On second interaction (waking/leaving the bed) or `playerLeave`:
     - If `record.jobId !== undefined`, call `nightmareJobRunner.cancel(record.jobId)`.
     - Delete the record from `bedInteractions`.
3. **No Live Handles Across Yields**:
   - Generator `lightCheckGenerator(dimensionId: string, bedLoc: Vector3, bedKey: string)` uses primitive coordinates and queries blocks by coordinate.
   - When triggering `spawnNightmare`: re-resolve the player via `world.getEntity(playerId)` or `world.getAllPlayers().find(...)` and ensure `player.isValid` and in the same dimension. Re-resolve bed block via `world.getDimension(dimId).getBlock(bedLoc)`.

---

## 2. Secondary Systems Batching & Generators

### 2.1 Boat Collision Sweeps (`packs/BP/scripts/interactions/boatCollision.ts`)
- **Problem**: `boatLoopJob()` runs synchronously every 10 ticks, inspecting collisions and water physics for all boats across the overworld in a single tick.
- **Solution**:
  - Add `BOATS_PER_TICK: 10` to `CONFIG`.
  - Convert `boatLoopJob` to a generator: `export function* boatLoopJob(): Generator<void, void, unknown>`.
  - Re-validate `if (!boat.isValid) continue;` before processing each boat.
  - Yield every 10 boats.
  - Provide a synchronous runner wrapper `export function processBoats(): void` (`const job = boatLoopJob(); while (!job.next().done) {}`) for offline testing compatibility.

### 2.2 Double Chest Session Sweeps (`packs/BP/scripts/interactions/doubleChest.ts`)
- **Problem**: `sweepPairs()` runs synchronously every 10 ticks, inspecting all active chest sessions across dimensions.
- **Solution**:
  - Add `CHEST_PAIRS_PER_TICK: 10` to configuration.
  - Convert the sweep logic into a generator: `export function* sweepPairsJob(): Generator<void, void, unknown>`.
  - Yield every `CHEST_PAIRS_PER_TICK` sessions processed.
  - Retain `export function sweepPairs(): void` as a synchronous wrapper (`const job = sweepPairsJob(); while (!job.next().done) {}`) preserving full compatibility with `tests/smoke/doubleChest.test.ts`.
  - Register `sweepPairsJob` with `tickManager`.

### 2.3 Beta Animal AI Cadence (`packs/BP/scripts/mobs/betaAnimalAI.ts`)
- **Problem**: `animalJumpJob()` yields after *every single hop* (`yield;`) and after every player. In dense animal clusters, this prolongs the sweep over dozens of ticks, delaying updates for other entities.
- **Solution**:
  - Add `ANIMALS_PER_TICK: 10` to `CONFIG`.
  - Batch evaluations: increment a counter for evaluated animals and yield every `ANIMALS_PER_TICK` animals instead of after every hop.
  - Re-validate `if (!player.isValid) break;` and `if (!entity.isValid) continue;` across yield points.

### 2.4 Classic Fog Player Sweeps (`packs/BP/scripts/world/classicFog.ts`)
- **Problem**: `fogJob()` yields after every single player (`yield;`). On a server with 20 players, syncing fog takes 20 full ticks.
- **Solution**:
  - Add `PLAYERS_PER_TICK: 5` to `CONFIG`.
  - Check `if (!player.isValid) continue;`.
  - Yield every 5 players processed. On small servers (<=5 players), the job finishes cleanly in a single tick without unnecessary generator stepping overhead.

---

## 3. Testing & Verification Plan

### 3.1 `tests/mobs/nightmares.test.ts`
- Unit test spatial light-check generator batching.
- Verify cancellation: simulating second bed interaction cancels the active job via `nightmareJobRunner.cancel()`.
- Verify `playerLeave` cancels in-flight job and purges state.
- Verify safe abort if player disconnects or bed block is destroyed during stepping.

### 3.2 Secondary Systems Unit Tests
- `tests/interactions/boatCollision.test.ts`: verify generator yields every 10 boats, skips invalid boats safely, and synchronous wrapper functions correctly.
- `tests/interactions/doubleChest.test.ts`: verify `sweepPairsJob()` yields every 10 chest pairs and existing `tests/smoke/doubleChest.test.ts` passes without regressions.
- `tests/mobs/betaAnimalAI.test.ts`: verify `animalJumpJob()` batches 10 animals per tick and survives entity despawns across yields.
- `tests/world/classicFog.test.ts`: verify `fogJob()` batches 5 players per tick and handles player disconnects gracefully.

### 3.3 Full Project Verification Gate
- Run `npm run check` (`tsc --noEmit`, ESLint with `.js` import rules, and full test suite).
- Ensure 0 errors, 0 lint warnings, and 100% test pass rate across all 452+ tests.
