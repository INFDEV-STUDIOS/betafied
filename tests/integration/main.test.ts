import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    registeredBeforeEvents,
    registeredAfterEvents,
    scheduledIntervals
} from "../mocks/minecraftServer.js";

describe("Main Integration Harness - Bedrock Server Script Loading", () => {
    it("imports main.ts and initializes all subsystems without throwing", async () => {
        // Dynamic import to execute main.ts within the mocked environment
        await import("../../packs/BP/scripts/main.js");

        // Verify event subscriptions were registered
        assert.ok(
            registeredBeforeEvents.size > 0,
            "Expected beforeEvents to have registered handlers"
        );
        assert.ok(
            registeredAfterEvents.size > 0,
            "Expected afterEvents to have registered handlers"
        );

        // Verify specific critical events
        assert.ok(
            registeredAfterEvents.has("entitySpawn"),
            "Expected entitySpawn listener from entitySpawnHandler"
        );
        assert.ok(
            registeredAfterEvents.has("entityDie"),
            "Expected entityDie listener for legacy feather drops"
        );
        assert.ok(
            registeredBeforeEvents.has("playerInteractWithBlock"),
            "Expected playerInteractWithBlock listener for instant bonemeal / placement rules"
        );
        assert.ok(
            registeredBeforeEvents.has("playerInteractWithEntity"),
            "Expected playerInteractWithEntity listener for furnace minecart fueling"
        );
        assert.ok(
            registeredAfterEvents.has("blockContainerOpened") && registeredAfterEvents.has("blockContainerClosed"),
            "Expected container access listeners so the double chest can mirror its halves"
        );

        // Verify recurring background jobs were scheduled
        assert.ok(
            scheduledIntervals.length >= 1,
            `Expected master tickManager interval, got ${scheduledIntervals.length}`
        );

        // Verify key subsystems registered with central tickManager
        const { tickManager } = await import("../../packs/BP/scripts/core/tickManager.js");
        assert.equal(tickManager.isRegistered("inventoryManager"), true, "inventoryManager must be registered with tickManager");
        assert.equal(tickManager.isRegistered("entityCleaner"), true, "entityCleaner must be registered with tickManager");
        assert.equal(tickManager.isRegistered("chunkScrubber"), true, "chunkScrubber must be registered with tickManager");
        assert.equal(tickManager.isRegistered("betaAnimalAI:jump"), true, "betaAnimalAI:jump must be registered with tickManager");
        assert.equal(tickManager.isRegistered("underwaterOverlay"), true, "underwaterOverlay must be registered with tickManager");
    });

    it("verifies scheduled intervals contain valid callbacks and positive interval rates", () => {
        for (const item of scheduledIntervals) {
            assert.equal(typeof item.callback, "function", `Scheduled item ${item.id} callback must be a function`);
            assert.ok(item.interval > 0, `Scheduled item ${item.id} interval must be > 0 ticks`);
        }
    });
});
