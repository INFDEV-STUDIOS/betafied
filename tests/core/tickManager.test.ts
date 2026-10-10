import test from "node:test";
import assert from "node:assert/strict";
import { tickManager } from "../../packs/BP/scripts/core/tickManager.js";
import { activeJobs, resetMocks, scheduledIntervals, system } from "../mocks/minecraftServer.js";

test("TickManager Staggered Scheduling & Lifecycle", async (t) => {
    t.beforeEach(() => {
        resetMocks();
        tickManager.stop();
        // Clear any tasks registered in previous tests
        for (const taskId of tickManager.getRegisteredTaskIds()) {
            tickManager.unregister(taskId);
        }
    });

    await t.test("registers tasks and dispatches based on interval and offset", () => {
        let task1Runs = 0;
        let task2Runs = 0;

        // Task 1: every 20 ticks, offset 0 -> runs at tick 0, 20, 40...
        tickManager.register("task1", 20, () => {
            task1Runs++;
        }, 0);

        // Task 2: every 20 ticks, offset 5 -> runs at tick 5, 25, 45...
        tickManager.register("task2", 20, () => {
            task2Runs++;
        }, 5);

        assert.equal(tickManager.isRegistered("task1"), true);
        assert.equal(tickManager.isRegistered("task2"), true);

        // Tick 0
        tickManager.step();
        assert.equal(task1Runs, 1);
        assert.equal(task2Runs, 0);

        // Ticks 1 to 4
        for (let i = 1; i <= 4; i++) {
            tickManager.step();
        }
        assert.equal(task1Runs, 1);
        assert.equal(task2Runs, 0);

        // Tick 5
        tickManager.step();
        assert.equal(task1Runs, 1);
        assert.equal(task2Runs, 1);

        // Advance to Tick 20
        for (let i = 6; i <= 20; i++) {
            tickManager.step();
        }
        assert.equal(task1Runs, 2);
        assert.equal(task2Runs, 1);
    });

    await t.test("dispatches generator tasks to system.runJob", () => {
        let generatorCreated = 0;

        function* heavyJob() {
            generatorCreated++;
            yield;
        }

        tickManager.register("heavyTask", 10, () => heavyJob(), 0);

        assert.equal(activeJobs.length, 0);
        tickManager.step(); // Tick 0 -> task executes, returns generator, queued into runJob

        assert.equal(activeJobs.length, 1);
    });

    await t.test("isolates errors so a crashing task does not halt other tasks in the same tick", () => {
        let task2Ran = false;

        tickManager.register("brokenTask", 1, () => {
            throw new Error("Task crash simulation");
        }, 0);

        tickManager.register("healthyTask", 1, () => {
            task2Ran = true;
        }, 0);

        assert.doesNotThrow(() => {
            tickManager.step();
        });

        assert.equal(task2Ran, true);
    });

    await t.test("controls master loop through start and stop lifecycle", () => {
        assert.equal(scheduledIntervals.length, 0);

        tickManager.start();
        assert.equal(scheduledIntervals.length, 1);
        assert.equal(scheduledIntervals[0].interval, 1);

        // Starting again is idempotent
        tickManager.start();
        assert.equal(scheduledIntervals.length, 1);

        tickManager.stop();
        assert.equal(scheduledIntervals.length, 0);
    });

    await t.test("unregisters tasks correctly", () => {
        let runs = 0;
        tickManager.register("tempTask", 1, () => {
            runs++;
        });

        tickManager.step();
        assert.equal(runs, 1);

        tickManager.unregister("tempTask");
        assert.equal(tickManager.isRegistered("tempTask"), false);

        tickManager.step();
        assert.equal(runs, 1);
    });

    await t.test("suppresses concurrent overlapping generator executions while in flight", () => {
        let runs = 0;
        let stepCount = 0;

        function* longJob() {
            yield;
            stepCount++;
            yield;
            stepCount++;
        }

        tickManager.register("overlapTask", 2, () => {
            runs++;
            return longJob();
        }, 0);

        // Tick 0: starts longJob
        tickManager.step();
        assert.equal(runs, 1);
        assert.equal(activeJobs.length, 1);

        // Step once in engine: advances to first yield (before stepCount++)
        (system as any).advanceTicks(1);
        assert.equal(stepCount, 0);

        // Tick 1 (not due)
        tickManager.step();
        assert.equal(runs, 1);

        // Tick 2: Interval fires, but generator is still in flight -> MUST skip invocation!
        tickManager.step();
        assert.equal(runs, 1, "task must not be re-invoked while previous generator is in flight");

        // Step second time: advances past first yield, executes stepCount++, reaches second yield
        (system as any).advanceTicks(1);
        assert.equal(stepCount, 1);
        assert.equal(activeJobs.length, 1);

        // Step third time: completes generator
        (system as any).advanceTicks(1);
        assert.equal(stepCount, 2);
        assert.equal(activeJobs.length, 0);

        // Tick 3 (not due)
        tickManager.step();
        assert.equal(runs, 1);

        // Tick 4: Interval fires again, generator is now completed -> should start a new run
        tickManager.step();
        assert.equal(runs, 2, "task is invoked on next scheduled tick after generator completes");
        assert.equal(activeJobs.length, 1);
    });

    await t.test("cancels in-flight generator job when task is unregistered", () => {
        function* infiniteJob() {
            while (true) {
                yield;
            }
        }

        tickManager.register("activeGenTask", 1, () => infiniteJob(), 0);
        tickManager.step();
        assert.equal(activeJobs.length, 1);

        tickManager.unregister("activeGenTask");
        assert.equal(activeJobs.length, 0, "unregistering task clears in-flight generator job");
    });

    await t.test("cancels all in-flight generator jobs when tickManager.stop() is called", () => {
        function* infiniteJob() {
            while (true) {
                yield;
            }
        }

        tickManager.register("job1", 1, () => infiniteJob(), 0);
        tickManager.register("job2", 1, () => infiniteJob(), 0);
        tickManager.step();
        assert.equal(activeJobs.length, 2);

        tickManager.stop();
        assert.equal(activeJobs.length, 0, "stop() clears all in-flight generator jobs");
    });

    await t.test("recovers and clears in-flight state when a generator step throws", () => {
        let invocations = 0;

        function* faultyJob() {
            yield;
            throw new Error("Simulated generator step failure");
        }

        tickManager.register("faultyTask", 2, () => {
            invocations++;
            return faultyJob();
        }, 0);

        // Tick 0: starts generator
        tickManager.step();
        assert.equal(invocations, 1);
        assert.equal(activeJobs.length, 1);

        // Engine steps and throws
        (system as any).advanceTicks(1);
        assert.equal(activeJobs.length, 0, "failing job is untracked");

        // Tick 2: scheduled interval fires again -> should run because onFinally cleared in-flight state
        tickManager.step(); // tick 1
        tickManager.step(); // tick 2
        assert.equal(invocations, 2, "task can run again after previous generator error was handled");
    });
});

