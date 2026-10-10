import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    sweepPairsJob,
    sweepPairs,
    sessions,
    CHEST_PAIRS_PER_TICK
} from "../../packs/BP/scripts/interactions/doubleChest.js";
import { resetMocks } from "../mocks/minecraftServer.js";

describe("Double Chest Session Sweep Generator & Batching", () => {
    beforeEach(() => {
        resetMocks();
        sessions.clear();
    });

    it("batches pair session sweeps and yields every CHEST_PAIRS_PER_TICK sessions", () => {
        assert.equal(CHEST_PAIRS_PER_TICK, 10, "CHEST_PAIRS_PER_TICK is 10");

        for (let i = 0; i < 25; i++) {
            sessions.set(`minecraft:overworld:${i},64,0`, {
                dimensionId: "minecraft:overworld",
                master: { x: i, y: 64, z: 0 },
                shadow: { x: i + 1, y: 64, z: 0 },
                masterViewers: new Set(),
                shadowViewers: new Set()
            });
        }

        const job = sweepPairsJob();
        assert.ok(typeof job.next === "function", "sweepPairsJob is a generator");

        // Batch 1 (10 sessions)
        const step1 = job.next();
        assert.equal(step1.done, false, "yields after 10 sessions");

        // Batch 2 (next 10 sessions -> 20 total)
        const step2 = job.next();
        assert.equal(step2.done, false, "yields after 20 sessions");

        // Remaining 5 sessions
        const step3 = job.next();
        assert.equal(step3.done, true, "generator completes after all sessions swept");
    });

    it("sweepPairs synchronous wrapper drains the generator completely", () => {
        for (let i = 0; i < 15; i++) {
            sessions.set(`minecraft:overworld:${i},64,0`, {
                dimensionId: "minecraft:overworld",
                master: { x: i, y: 64, z: 0 },
                shadow: { x: i + 1, y: 64, z: 0 },
                masterViewers: new Set(),
                shadowViewers: new Set()
            });
        }

        assert.doesNotThrow(() => {
            sweepPairs();
        });
    });
});
