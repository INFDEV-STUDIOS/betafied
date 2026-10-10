import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { animalJumpJob } from "../../packs/BP/scripts/mobs/betaAnimalAI.js";
import { resetMocks, world, Player, mockPlayers } from "../mocks/minecraftServer.js";

describe("Beta Animal AI Generator Batching", () => {
    beforeEach(() => {
        resetMocks();
    });

    it("batches animal evaluations and yields every 10 animals", () => {
        const overworld = world.getDimension("minecraft:overworld") as any;
        const player = new Player("steve");
        player.dimension = overworld;
        player.location = { x: 0, y: 64, z: 0 };
        mockPlayers.push(player);

        // Spawn 25 passive animals around player
        for (let i = 0; i < 25; i++) {
            overworld.spawnEntity("minecraft:pig", { x: 0, y: 64, z: 0 });
        }

        const job = animalJumpJob();
        assert.ok(typeof job.next === "function", "animalJumpJob is a generator");

        // Batch 1: 10 animals
        const step1 = job.next();
        assert.equal(step1.done, false, "yields after 10 animals");

        // Batch 2: next 10 animals (20 total)
        const step2 = job.next();
        assert.equal(step2.done, false, "yields after 20 animals");

        // Remaining 5 animals
        const step3 = job.next();
        assert.equal(step3.done, true, "generator completes after all animals evaluated");
    });

    it("skips despawned or invalid animals safely", () => {
        const overworld = world.getDimension("minecraft:overworld") as any;
        const player = new Player("steve");
        player.dimension = overworld;
        player.location = { x: 0, y: 64, z: 0 };
        mockPlayers.push(player);

        const pig = overworld.spawnEntity("minecraft:pig", { x: 0, y: 64, z: 0 });
        pig.isValid = false;

        const job = animalJumpJob();
        assert.doesNotThrow(() => {
            while (!job.next().done) {}
        });
    });
});
