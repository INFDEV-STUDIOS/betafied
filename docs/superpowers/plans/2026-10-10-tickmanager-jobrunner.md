# TickManager & JobRunner Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate `JobRunner` into `TickManager` to provide overlap suppression, error containment, and lifecycle teardown for generator-based scheduled tasks.

**Architecture:** Compose `TickManager` with an internal `JobRunner` instance and an `inFlightJobs` map. Tasks returning a generator are dispatched through `jobRunner.run`, skipped if already in flight, and cancelled on unregister or stop.

**Tech Stack:** TypeScript, Node.js 24 Test Runner, Minecraft Bedrock Script API (`@minecraft/server`).

**Spec:** `docs/superpowers/specs/2026-10-10-tickmanager-jobrunner-design.md`

## Global Constraints

- Scripts execute in QuickJS on Minecraft's single-threaded server tick.
- Relative imports must use explicit `.js` extensions.
- All fallible engine operations must remain error-isolated.
- Commits must be authored by `fyreic` with no agent trailers.
- Verification gate: `npm run check` (typecheck + lint + test) must pass cleanly.

## Review Focus

- Task interval firing while a previous generator is stepping: invocation must be skipped without error.
- Task unregistration during active generator stepping: running job must be cleared via `system.clearJob`.
- Server stop during active generator stepping: all running jobs must be cancelled.
- Generator throwing on an intermediate tick: error reported, runner halted, task cleared from in-flight tracking.
- Synchronous (void) task callbacks: unaffected and continue executing synchronously.

---

### Task 1: Write Unit Tests for Generator Overlap & Lifecycle in `tickManager.test.ts`

**Files:**
- Modify: `tests/core/tickManager.test.ts:70-123`
- Test: `tests/core/tickManager.test.ts`

**Interfaces:**
- Consumes: `tickManager` from `../../packs/BP/scripts/core/tickManager.js`
- Produces: New unit tests asserting overlap suppression, teardown on unregister/stop, and error recovery

- [ ] **Step 1: Write failing tests in `tests/core/tickManager.test.ts`**

Add tests for:
1. Overlap suppression: Task with interval 2 returning a 3-tick generator is not reinvoked at tick 2; reinvoked after completion.
2. Unregister cancellation: Unregistering an active generator task cancels its job via `system.clearJob`.
3. Stop cancellation: Calling `stop()` cancels all in-flight jobs.
4. Error recovery: Generator that throws on step 2 does not crash tickManager and clears in-flight state.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/core/tickManager.test.ts`
Expected: FAIL (concurrency suppression and job cancellation not yet implemented in `TickManager`)

- [ ] **Step 3: Commit test additions**

```bash
git add tests/core/tickManager.test.ts
git commit -m "test(core): add tests for TickManager generator overlap and lifecycle"
```

---

### Task 2: Implement `JobRunner` Composition in `TickManager`

**Files:**
- Modify: `packs/BP/scripts/core/tickManager.ts:1-107`
- Test: `tests/core/tickManager.test.ts`

**Interfaces:**
- Consumes: `JobRunner` from `./jobRunner.js`, `ScheduledTask` from `./tickManager.js`
- Produces: Updated `TickManager` class with `jobRunner` and `inFlightJobs` tracking

- [ ] **Step 1: Update `packs/BP/scripts/core/tickManager.ts`**

1. Import `JobRunner` from `./jobRunner.js`.
2. Add fields `private readonly jobRunner = new JobRunner();` and `private readonly inFlightJobs = new Map<string, number>();`.
3. Update `step()`:
   - For each due task, check `if (this.inFlightJobs.has(task.id)) return;` before execution.
   - If `result` is a generator (`result && typeof result[Symbol.iterator] === "function"`):
     - Launch via `this.jobRunner.run(result, { system: "tickManager", operation: "task:" + task.id, onFinally: () => { this.inFlightJobs.delete(task.id); } })`.
     - If returned `jobId >= 0`, record in `this.inFlightJobs.set(task.id, jobId)`.
4. Update `unregister(id: string)`:
   - If `this.inFlightJobs.has(id)`, call `this.jobRunner.clear(this.inFlightJobs.get(id)!)` and delete from `this.inFlightJobs`.
   - Delete from `this.tasks`.
5. Update `stop()`:
   - Clear master interval if running.
   - Call `this.jobRunner.clearAll()`.
   - Clear `this.inFlightJobs`.
   - Reset `this.currentTick = 0`.

- [ ] **Step 2: Run tests to verify they pass**

Run: `node --test tests/core/tickManager.test.ts`
Expected: PASS (all tests including new overlap and teardown tests pass)

- [ ] **Step 3: Commit implementation**

```bash
git add packs/BP/scripts/core/tickManager.ts
git commit -m "feat(core): compose TickManager with JobRunner for overlap suppression and teardown"
```

---

### Task 3: Full Project Verification & Lint Check

**Files:**
- Test: Full repository

- [ ] **Step 1: Run full verification suite**

Run: `npm run check`
Expected: Typecheck clean, lint clean, all tests pass.

- [ ] **Step 2: Verify git status and log**

Run: `git status && git log -2`
Expected: Working tree clean, author `fyreic`, no agent trailers.
