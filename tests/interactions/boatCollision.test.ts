import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { boatLoopJob, processBoats } from "../../packs/BP/scripts/interactions/boatCollision.js";
import { resetMocks, world, mockEntities } from "../mocks/minecraftServer.js";

describe("Boat Collision Batching & Lifetime Safety", () => {
    beforeEach(() => {
        resetMocks();
    });

    it("batches boat processing and yields every 10 boats", () => {
        const overworld = world.getDimension("minecraft:overworld") as any;
        for (let i = 0; i < 25; i++) {
            overworld.spawnEntity("minecraft:boat", { x: i, y: 64, z: 0 });
        }

        const job = boatLoopJob();
        assert.ok(typeof job.next === "function", "boatLoopJob is a generator");

        // Batch 1: processes 10 boats
        const step1 = job.next();
        assert.equal(step1.done, false, "yields after 10 boats");

        // Batch 2: processes next 10 boats (20 total)
        const step2 = job.next();
        assert.equal(step2.done, false, "yields after 20 boats");

        // Remaining 5 boats
        const step3 = job.next();
        assert.equal(step3.done, true, "completes after remaining boats");
    });

    it("safely skips invalid or destroyed boats without throwing", () => {
        const overworld = world.getDimension("minecraft:overworld") as any;
        const boat = overworld.spawnEntity("minecraft:boat", { x: 0, y: 64, z: 0 });
        boat.isValid = false;

        const job = boatLoopJob();
        assert.doesNotThrow(() => {
            while (!job.next().done) {}
        });
    });

    it("re-resolves entities by ID across yield boundaries without holding live references", () => {
        const overworld = world.getDimension("minecraft:overworld") as any;
        const boats: any[] = [];
        for (let i = 0; i < 15; i++) {
            boats.push(overworld.spawnEntity("minecraft:boat", { x: i, y: 64, z: 0 }));
        }

        const job = boatLoopJob();
        job.next(); // First batch of 10

        // Despawn remaining boats from world and detect if stale references are touched
        let staleAccessed = false;
        for (let i = 10; i < 15; i++) {
            mockEntities.delete(boats[i].id);
            Object.defineProperty(boats[i], "location", {
                get() {
                    staleAccessed = true;
                    return { x: 0, y: 64, z: 0 };
                }
            });
        }

        while (!job.next().done) {}
        assert.equal(staleAccessed, false, "stale boat handles from earlier ticks must not be accessed");
    });

    it("processBoats drains generator synchronously", () => {
        const overworld = world.getDimension("minecraft:overworld") as any;
        for (let i = 0; i < 15; i++) {
            overworld.spawnEntity("minecraft:boat", { x: i, y: 64, z: 0 });
        }

        assert.doesNotThrow(() => {
            processBoats();
        });
    });
});
