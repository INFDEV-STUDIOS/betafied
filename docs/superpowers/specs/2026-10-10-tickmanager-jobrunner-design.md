# TickManager & JobRunner Scheduler Integration Design

## Overview
This design integrates `JobRunner` into `TickManager` to provide unified coroutine time-slicing, error containment, and overlap suppression across Minecraft Bedrock Script API ticks.

Bedrock scripts run inside a single-threaded QuickJS environment sharing a strict per-tick time budget. Unbounded synchronous loops or uncoordinated coroutine generators risk triggering watchdog tick timeouts (`Script execution exceeded tick timeout`). By composing `TickManager` with `JobRunner`, recurring tasks that return a generator will automatically execute as managed, cooperative background jobs without risking cascading concurrency or dangling handles.

---

## Architectural Changes

### 1. `TickManager` (`packs/BP/scripts/core/tickManager.ts`)

#### State Management
- `tasks: Map<string, ScheduledTask>`: Stores registered tasks with intervals and staggered offsets.
- `jobRunner: JobRunner`: Dedicated instance of `JobRunner` responsible for stepping and tracking all coroutines dispatched by `TickManager`.
- `inFlightJobs: Map<string, number>`: Tracks active jobs, mapping `taskId -> jobId`.

#### Execution Flow (`step()`)
For each scheduled task due on `currentTick`:
1. **Overlap Guard**: Check `inFlightJobs.has(task.id)`.
   - If an existing generator job for this task is still executing across ticks, **skip** this tick's invocation.
2. **Task Execution**:
   - Call `task.task()` wrapped within `runCatching({ system: "tickManager", operation: "task:" + task.id })`.
   - If the returned value is an iterable generator (`typeof result[Symbol.iterator] === "function"`):
     - Start the generator via `jobRunner.run(result, { system: "tickManager", operation: "task:" + task.id, onFinally: () => this.inFlightJobs.delete(task.id) })`.
     - If `jobId >= 0`, store `inFlightJobs.set(task.id, jobId)`.

#### Teardown & Deregistration
- **`unregister(id: string)`**:
  - If `inFlightJobs.has(id)`, cancel the active coroutine via `jobRunner.clear(jobId)` and remove from `inFlightJobs`.
  - Remove from `tasks`.
- **`stop()`**:
  - Cancel master interval via `system.clearRun(this.masterIntervalId)`.
  - Cancel all active jobs via `jobRunner.clearAll()`.
  - Clear `inFlightJobs`.
  - Reset `currentTick = 0`.

---

## Error Handling & Watchdog Safety

1. **Step Error Isolation**:
   - The generator is stepped by `JobRunner.wrap`. If any intermediate tick throws an exception, it is caught, reported via `reportError`, and the job halts cleanly.
   - The `onFinally` callback always triggers, removing the task from `inFlightJobs` so the task is not permanently blocked from future intervals.
2. **Watchdog Protection**:
   - Prevents re-entrant jobs from piling up in the engine when an interval is shorter than a generator's stepping duration.

---

## Testing & Verification Plan

### Test File: `tests/core/tickManager.test.ts`
1. **Generator Stepping via Mock**:
   - Register a generator task with `intervalTicks = 1`. Advance ticks and verify it steps across multiple ticks until finished.
2. **Concurrency / Overlap Suppression**:
   - Register a task with `intervalTicks = 2` that takes 4 ticks to complete.
   - Advance tick to 2; verify the generator is still stepping and the task is **not** re-invoked.
   - Advance to completion; verify that the next interval after completion initiates a new run.
3. **Step Error Containment**:
   - Register a generator task that throws an error on step 2.
   - Advance tick; verify the error is reported, the job stops, and `inFlightJobs` is cleared.
4. **Lifecycle Cancellation**:
   - Verify `unregister(id)` cancels the running job via `system.clearJob`.
   - Verify `stop()` cancels all running jobs via `system.clearJob`.
