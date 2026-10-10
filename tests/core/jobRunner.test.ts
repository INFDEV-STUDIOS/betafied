import test from "node:test";
import assert from "node:assert/strict";
import { resetMocks, system } from "../mocks/minecraftServer.js";
import { JobRunner } from "../../packs/BP/scripts/core/jobRunner.js";

test("JobRunner cooperative time-slicing & lifecycle", async (t) => {
    t.beforeEach(() => {
        resetMocks();
    });

    await t.test("steps a generator across ticks until completion", () => {
        const steps: number[] = [];
        function* counter(): Generator<void, void, void> {
            steps.push(1);
            yield;
            steps.push(2);
            yield;
            steps.push(3);
        }

        JobRunner.run(counter());

        assert.deepEqual(steps, [], "job does not run synchronously on registration");

        // Tick 1
        (system as any).advanceTicks(1);
        assert.deepEqual(steps, [1]);

        // Tick 2
        (system as any).advanceTicks(1);
        assert.deepEqual(steps, [1, 2]);

        // Tick 3
        (system as any).advanceTicks(1);
        assert.deepEqual(steps, [1, 2, 3]);

        // Tick 4 - completed, no extra steps
        (system as any).advanceTicks(1);
        assert.deepEqual(steps, [1, 2, 3]);
    });

    await t.test("time-slices items with batchSize in forEach", () => {
        const items = ["a", "b", "c", "d", "e"];
        const processed: string[] = [];

        JobRunner.forEach(
            items,
            (item) => processed.push(item),
            { batchSize: 2 }
        );

        // Tick 1: first batch of 2 items
        (system as any).advanceTicks(1);
        assert.deepEqual(processed, ["a", "b"]);

        // Tick 2: second batch of 2 items
        (system as any).advanceTicks(1);
        assert.deepEqual(processed, ["a", "b", "c", "d"]);

        // Tick 3: remaining item
        (system as any).advanceTicks(1);
        assert.deepEqual(processed, ["a", "b", "c", "d", "e"]);
    });

    await t.test("cancels a running job via clear()", () => {
        const steps: number[] = [];
        function* infinite(): Generator<void, void, void> {
            let count = 0;
            while (true) {
                steps.push(++count);
                yield;
            }
        }

        const runner = new JobRunner();
        const jobId = runner.run(infinite());
        assert.equal(runner.activeCount, 1);

        (system as any).advanceTicks(2);
        assert.deepEqual(steps, [1, 2]);

        runner.clear(jobId);
        assert.equal(runner.activeCount, 0);

        (system as any).advanceTicks(2);
        assert.deepEqual(steps, [1, 2]);
    });

    await t.test("cancels all running jobs via clearAll()", () => {
        const runner = new JobRunner();
        let job1Steps = 0;
        let job2Steps = 0;

        runner.run((function* () {
            while (true) {
                job1Steps++;
                yield;
            }
        })());

        runner.run((function* () {
            while (true) {
                job2Steps++;
                yield;
            }
        })());

        assert.equal(runner.activeCount, 2);
        (system as any).advanceTicks(1);
        assert.equal(job1Steps, 1);
        assert.equal(job2Steps, 1);

        runner.clearAll();
        assert.equal(runner.activeCount, 0);

        (system as any).advanceTicks(2);
        assert.equal(job1Steps, 1);
        assert.equal(job2Steps, 1);
    });

    await t.test("catches generator errors, invokes onError and onFinally, and untracks active job", () => {
        const runner = new JobRunner();
        let caughtError: any = null;
        let finalized = false;

        function* faulty(): Generator<void, void, void> {
            yield;
            throw new Error("Simulated failure in job step");
        }

        runner.run(faulty(), {
            system: "testJob",
            operation: "faultyStep",
            onError: (err) => {
                caughtError = err;
            },
            onFinally: () => {
                finalized = true;
            }
        });

        assert.equal(runner.activeCount, 1);

        // Tick 1
        (system as any).advanceTicks(1);
        assert.equal(caughtError, null);
        assert.equal(finalized, false);

        // Tick 2: throws
        (system as any).advanceTicks(1);
        assert.ok((caughtError as any) instanceof Error);
        assert.equal((caughtError as any).message, "Simulated failure in job step");
        assert.equal(finalized, true);
        assert.equal(runner.activeCount, 0, "failed job is removed from active jobs");
    });
});
