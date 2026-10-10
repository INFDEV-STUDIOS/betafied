import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { cleanerJob } from "../../packs/BP/scripts/mobs/entityCleaner.js";
import { mockPlayers, resetMocks, world, Player } from "../mocks/minecraftServer.js";

describe("EntityCleaner Batching & Lifetime Safety", () => {
    beforeEach(() => {
        resetMocks();
    });

    it("batches entity processing into 20-item chunks", () => {
        const overworld = world.getDimension("minecraft:overworld") as any;
        const player = new Player("test_player");
        player.dimension = overworld;
        mockPlayers.push(player);

        for (let i = 0; i < 45; i++) {
            overworld.spawnEntity("minecraft:sniffer", { x: 0, y: 64, z: 0 });
        }

        const job = cleanerJob();

        // Batch 1 (20 entities)
        const step1 = job.next();
        assert.equal(step1.done, false, "yields after first batch of 20 entities");

        // Batch 2 (next 20 entities -> 40 total)
        const step2 = job.next();
        assert.equal(step2.done, false, "yields after second batch of 20 entities");

        // Remaining 5 entities + player loop yield
        const step3 = job.next();
        assert.equal(step3.done, false, "yields after player loop");

        const step4 = job.next();
        assert.equal(step4.done, true, "generator completes after all entities cleaned");
    });

    it("safely skips invalid entities without throwing", () => {
        const overworld = world.getDimension("minecraft:overworld") as any;
        const player = new Player("test_player");
        player.dimension = overworld;
        mockPlayers.push(player);

        const ent = overworld.spawnEntity("minecraft:sniffer", { x: 0, y: 64, z: 0 });
        ent.isValid = false;

        const job = cleanerJob();
        assert.doesNotThrow(() => {
            while (!job.next().done) {}
        });
    });

    it("aborts player sweep cleanly if player disconnects across yield boundary", () => {
        const overworld = world.getDimension("minecraft:overworld") as any;
        const player = new Player("test_player");
        player.dimension = overworld;
        mockPlayers.push(player);

        for (let i = 0; i < 40; i++) {
            overworld.spawnEntity("minecraft:sniffer", { x: 0, y: 64, z: 0 });
        }

        const job = cleanerJob();

        // Step 1: processes 20 entities
        const step1 = job.next();
        assert.equal(step1.done, false);

        // Player disconnects while generator is yielded
        player.isValid = false;

        // Step 2: resumes, detects player invalid, breaks out safely
        const step2 = job.next();
        assert.equal(step2.done, false); // outer player yield

        const step3 = job.next();
        assert.equal(step3.done, true); // completes
    });
});
