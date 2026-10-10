import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fogJob } from "../../packs/BP/scripts/world/classicFog.js";
import { resetMocks, world, Player, mockPlayers } from "../mocks/minecraftServer.js";

describe("Classic Fog Player Sweep Batching", () => {
    beforeEach(() => {
        resetMocks();
    });

    it("batches player fog sync and yields every 5 players", () => {
        const overworld = world.getDimension("minecraft:overworld") as any;
        for (let i = 0; i < 12; i++) {
            const player = new Player(`player_${i}`);
            player.dimension = overworld;
            mockPlayers.push(player);
        }

        const job = fogJob();
        assert.ok(typeof job.next === "function", "fogJob is a generator");

        // Batch 1: 5 players
        const step1 = job.next();
        assert.equal(step1.done, false, "yields after 5 players");

        // Batch 2: next 5 players (10 total)
        const step2 = job.next();
        assert.equal(step2.done, false, "yields after 10 players");

        // Remaining 2 players
        const step3 = job.next();
        assert.equal(step3.done, true, "completes after remaining 2 players");
    });

    it("safely skips invalid players without throwing", () => {
        const overworld = world.getDimension("minecraft:overworld") as any;
        const player = new Player("disconnected_player");
        player.dimension = overworld;
        player.isValid = false;
        mockPlayers.push(player);

        const job = fogJob();
        assert.doesNotThrow(() => {
            while (!job.next().done) {}
        });
    });
});
