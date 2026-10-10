import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    lightCheckGenerator,
    bedInteractions,
    nightmareJobRunner,
    handleBedInteraction,
    handlePlayerLeave,
    tryTriggerNightmare
} from "../../packs/BP/scripts/mobs/nightmares.js";
import { mockPlayers, resetMocks, world, Player } from "../mocks/minecraftServer.js";

describe("Nightmares Spatial Job Tracking & Cancellation", () => {
    beforeEach(() => {
        resetMocks();
        bedInteractions.clear();
        nightmareJobRunner.clear();
    });

    it("batches spatial light checks and yields every 50 blocks", () => {
        const bedKey = "minecraft:overworld:0,64,0";
        bedInteractions.set(bedKey, {
            count: 1,
            playerId: "player_1",
            dimensionId: "minecraft:overworld",
            bedLocation: { x: 0, y: 64, z: 0 },
            windowExpired: false,
            scanComplete: false,
            hasLight: null
        });

        const gen = lightCheckGenerator("minecraft:overworld", { x: 0, y: 64, z: 0 }, bedKey);

        const firstStep = gen.next();
        assert.equal(firstStep.done, false, "generator yields after first batch of 50 checks");

        const record = bedInteractions.get(bedKey);
        assert.ok(record, "record persists across yields");
    });

    it("cancels running spatial job when player interacts with bed a second time", () => {
        const player = new Player("steve");
        player.id = "steve_id";
        mockPlayers.push(player);

        const bedBlock = {
            dimension: world.getDimension("minecraft:overworld"),
            location: { x: 10, y: 64, z: 10 },
            typeId: "minecraft:bed"
        } as any;

        // First interaction starts job
        handleBedInteraction(player, bedBlock);

        const bedKey = "minecraft:overworld:10,64,10";
        const record = bedInteractions.get(bedKey);
        assert.ok(record, "record created");
        assert.ok(record.jobId !== undefined, "jobId tracked");
        const activeJobId = record.jobId;

        // Verify job is running in job runner
        assert.ok(nightmareJobRunner.has(activeJobId), "job registered in nightmareJobRunner");

        // Second interaction (e.g. getting out of bed / interacting again)
        handleBedInteraction(player, bedBlock);

        assert.equal(bedInteractions.has(bedKey), false, "record deleted on second interaction");
        assert.equal(nightmareJobRunner.has(activeJobId), false, "spatial job was cancelled in job runner");
    });

    it("cancels running spatial job and cleans record on playerLeave", () => {
        const player = new Player("alex");
        player.id = "alex_id";
        mockPlayers.push(player);

        const bedBlock = {
            dimension: world.getDimension("minecraft:overworld"),
            location: { x: 20, y: 64, z: 20 },
            typeId: "minecraft:bed"
        } as any;

        handleBedInteraction(player, bedBlock);
        const bedKey = "minecraft:overworld:20,64,20";
        const record = bedInteractions.get(bedKey);
        assert.ok(record);
        const activeJobId = record.jobId!;

        assert.ok(nightmareJobRunner.has(activeJobId));

        handlePlayerLeave({ playerId: "alex_id" } as any);

        assert.equal(bedInteractions.has(bedKey), false, "record cleared on player leave");
        assert.equal(nightmareJobRunner.has(activeJobId), false, "spatial job cancelled on player leave");
    });

    it("aborts nightmare trigger safely if player is invalid/disconnected", () => {
        const bedKey = "minecraft:overworld:30,64,30";
        bedInteractions.set(bedKey, {
            count: 1,
            playerId: "missing_player_id",
            dimensionId: "minecraft:overworld",
            bedLocation: { x: 30, y: 64, z: 30 },
            windowExpired: true,
            scanComplete: true,
            hasLight: false
        });

        assert.doesNotThrow(() => {
            tryTriggerNightmare(bedKey);
        });
        assert.equal(bedInteractions.has(bedKey), false);
    });
});
