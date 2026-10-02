import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ItemStack, EntityComponentTypes } from "@minecraft/server";
import { eventBus } from "../../packs/BP/scripts/core/eventBus.js";
import { resetMocks } from "../mocks/minecraftServer.js";
// Importing the module registers its entitySpawn handler on the bus.
import "../../packs/BP/scripts/mobs/entitySpawnHandler.js";

interface Spawned {
    typeId: string;
    amount: number;
}

function brokenDrop(typeId: string, amount = 1): { entity: any; spawned: Spawned[]; removed: () => boolean } {
    const spawned: Spawned[] = [];
    let removed = false;

    const entity: any = {
        isValid: true,
        typeId: "minecraft:item",
        location: { x: 4, y: 64, z: 12 },
        dimension: {
            spawnItem(item: ItemStack) {
                spawned.push({ typeId: item.typeId, amount: item.amount });
            }
        },
        getComponent(type: string) {
            if (type === EntityComponentTypes.Item) {
                return { itemStack: new ItemStack(typeId, amount) };
            }
            return undefined;
        },
        remove() {
            removed = true;
            entity.isValid = false;
        }
    };

    return { entity, spawned, removed: () => removed };
}

describe("Drop conversion - picked-up items match their stack", () => {
    beforeEach(() => {
        resetMocks();
    });

    it("drops a broken oak log as bh:oak_log so pickups merge", () => {
        const { entity, spawned } = brokenDrop("minecraft:oak_log");
        eventBus.dispatch("entitySpawn", { entity });

        assert.equal(spawned.length, 1, "the vanilla log drop must be replaced once");
        assert.equal(spawned[0].typeId, "bh:oak_log", "the ground item must be the id the inventory keeps");
        assert.equal(spawned[0].amount, 1, "stack size must be preserved");
    });

    it("keeps species when converting a modern log", () => {
        const { entity, spawned } = brokenDrop("minecraft:birch_log", 3);
        eventBus.dispatch("entitySpawn", { entity });

        assert.equal(spawned[0]?.typeId, "bh:birch_log", "birch must not collapse into oak");
        assert.equal(spawned[0]?.amount, 3, "whole stack rides across the respawn");
    });

    it("leaves an already-normalized bh drop untouched", () => {
        const { entity, spawned, removed } = brokenDrop("bh:oak_log", 2);
        eventBus.dispatch("entitySpawn", { entity });

        assert.equal(spawned.length, 0, "a bh item is already final and needs no respawn");
        assert.equal(removed(), false, "a bh item must not be deleted");
    });

    it("still removes banned drops without respawning them", () => {
        const { entity, spawned, removed } = brokenDrop("minecraft:rotten_flesh");
        eventBus.dispatch("entitySpawn", { entity });

        assert.equal(removed(), true, "rotten flesh is not a Beta drop");
        assert.equal(spawned.length, 0, "a banned drop must not be replaced with anything");
    });

    it("drops a bow as bh:bow so pickups merge", () => {
        const { entity, spawned } = brokenDrop("minecraft:bow");
        eventBus.dispatch("entitySpawn", { entity });

        assert.equal(spawned.length, 1, "the vanilla bow drop must land on the bh id");
        assert.equal(spawned[0].typeId, "bh:bow", "the ground item must be the id the inventory keeps");
    });

    it("retypes a Beta food drop to its instant-eat bh item", () => {
        const { entity, spawned } = brokenDrop("minecraft:porkchop", 4);
        eventBus.dispatch("entitySpawn", { entity });

        assert.equal(spawned[0]?.typeId, "bh:porkchop", "food must match the id the inventory sweeps to");
        assert.equal(spawned[0]?.amount, 4, "whole stack rides across the respawn");
    });

    it("converts a modern fish instead of deleting it", () => {
        const { entity, spawned, removed } = brokenDrop("minecraft:salmon");
        eventBus.dispatch("entitySpawn", { entity });

        assert.equal(removed(), true, "the vanilla salmon entity is replaced, not kept");
        assert.equal(spawned[0]?.typeId, "bh:cod", "salmon collapses to the Beta cod item");
    });

    it("leaves an already-final bh food untouched", () => {
        const { entity, spawned, removed } = brokenDrop("bh:porkchop", 2);
        eventBus.dispatch("entitySpawn", { entity });

        assert.equal(spawned.length, 0, "a bh item needs no respawn");
        assert.equal(removed(), false, "a bh item must not be deleted");
    });
});
