# Sub-project 2: InventoryManager & EntityCleaner Time-Slicing Design

## Overview
This specification details the time-slicing and batching improvements for [`inventoryManager.ts`](file:///Users/fyreic/Documents/projects/betafied/packs/BP/scripts/core/inventoryManager.ts) and [`entityCleaner.ts`](file:///Users/fyreic/Documents/projects/betafied/packs/BP/scripts/mobs/entityCleaner.ts) in Minecraft Bedrock Script API.

Now that [`TickManager`](file:///Users/fyreic/Documents/projects/betafied/packs/BP/scripts/core/tickManager.ts) coordinates generator tasks with cooperative multitasking and overlap suppression, this sub-project addresses the two heaviest background maintenance workloads on the server to prevent Bedrock watchdog tick timeouts (`Script execution exceeded tick timeout`).

---

## 1. InventoryManager Time-Slicing (`packs/BP/scripts/core/inventoryManager.ts`)

### Problem
`processPlayers()` runs synchronously in a single tick. On full sweeps or when inventories are dirty, it iterates over all online players, inspecting equipment and all 36 container slots per player. On a server with 10–30 players, querying and mutating hundreds of slots synchronously causes substantial tick spikes.

### Architectural Solution
1. **Config Update**:
   Add `PLAYERS_PER_TICK: 2` to `CONFIG`.
2. **`inventorySweepJob` Generator**:
   - Iterates through `world.getAllPlayers()`.
   - For each valid player, calls `sweepPlayer(player, fullSweep, equipmentSweep)`.
   - Increments a `processed` counter. Every `CONFIG.PLAYERS_PER_TICK` players, yields control (`yield;`) to step across ticks.
   - Registers with `tickManager`:
     ```typescript
     tickManager.register("inventoryManager", CONFIG.CHECK_INTERVAL, inventorySweepJob, 0);
     ```
3. **Synchronous Compatibility**:
   - Provide `export function processPlayers(): void` as a synchronous wrapper (`for (const _ of inventorySweepJob()) {}`) so existing test harnesses and explicit callers execute synchronously without friction.

---

## 2. EntityCleaner Batching & Handle Lifetime (`packs/BP/scripts/mobs/entityCleaner.ts`)

### Problem
1. **Inefficient Cadence**: Currently yields after *every single entity* (`yield;`), taking 15+ seconds (300 ticks) to clean 300 entities around a player.
2. **Dangling Handles Across Yields**: Live `Entity` and `Player` handles are held in generator state while yielding across ticks. If entities despawn or players disconnect between ticks, accessing these handles can throw or cause invalid states.

### Architectural Solution
1. **Config Update**:
   Add `ENTITIES_PER_TICK: 20` to `CONFIG`.
2. **`cleanerJob` Generator**:
   - Slices nearby entities into chunks of `CONFIG.ENTITIES_PER_TICK = 20`.
   - Checks `if (!ent.isValid) continue;` before operating on each entity.
   - Yields only after every 20 entities processed.
   - Upon resuming from a `yield;`, verifies `if (!player.isValid) break;` to ensure player disconnection aborts that player's sweep cleanly.

---

## Testing & Verification Plan

### 1. `tests/policy/inventoryManager.test.ts`
- Verify `inventorySweepJob()` yields every 2 players when multiple players are online.
- Verify `processPlayers()` continues to work synchronously for all existing item normalization test assertions.
- Verify that player disconnection midway through a multi-tick sweep is handled without throwing.

### 2. `tests/mobs/entityCleaner.test.ts`
- Verify `cleanerJob` yields every 20 entities instead of 1-by-1.
- Verify that invalid/despawned entities are skipped.
- Verify that player disconnection across yield boundaries breaks safely without unhandled errors.

### 3. Full Project Gate
- `npm run check` (typecheck + ESLint + offline test suite) passing 100%.
