import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    world,
    ItemStack,
    Entity,
    BlockPermutation,
    EntityComponentTypes
} from "@minecraft/server";
import { isTreeAppleDrop } from "../../packs/BP/scripts/mobs/entitySpawnHandler.js";
import { eventBus } from "../../packs/BP/scripts/core/eventBus.js";
import { mockPlayers, resetMocks, Player } from "../mocks/minecraftServer.js";

// Wiring-only: every case replays our own spawn handler through the mock, so this pins the
// predicate's decision table rather than the engine's behaviour. Whether Bedrock really reports a
// leaf-decay apple with a populated location and a readable Item component at entitySpawn time is
// an assumption this file cannot test and has to be confirmed on a client.
describe("Authentic Beta 1.7.3 Leaf Apple Drops Policy", () => {
    const spawnedItems: { typeId: string; amount: number }[] = [];
    const overworld = world.getDimension("minecraft:overworld") as any;

    beforeEach(() => {
        resetMocks();
        spawnedItems.length = 0;
        // The shared overworld mock drops spawned items on the floor; record them so the tests can
        // see the bh:apple a non-tree apple is retyped into.
        overworld.spawnItem = (item: ItemStack) => {
            spawnedItems.push({ typeId: item.typeId, amount: item.amount });
            return { id: "mock_item_entity", typeId: "minecraft:item" };
        };
    });

    it("identifies and prevents apple drops when leaves are broken by a player", () => {
        const dim = world.getDimension("minecraft:overworld") as any;

        // Player breaks an oak leaves block
        eventBus.dispatch("playerBreakBlock", {
            block: { dimension: dim, x: 10, y: 70, z: 20 },
            brokenBlockPermutation: BlockPermutation.resolve("minecraft:oak_leaves")
        });

        const appleEntity = new Entity();
        appleEntity.typeId = "minecraft:item";
        appleEntity.location = { x: 10.5, y: 70.2, z: 20.5 };
        appleEntity.dimension = dim;

        const itemStack = new ItemStack("minecraft:apple", 1);
        appleEntity.setComponent(EntityComponentTypes.Item, { itemStack });

        assert.equal(isTreeAppleDrop(appleEntity), true, "Apple from broken leaf block must be identified as tree drop");

        eventBus.dispatch("entitySpawn", { entity: appleEntity });
        assert.equal(appleEntity.isRemoved, true, "Apple entity from broken leaves must be removed");
    });

    it("identifies and prevents apple drops from natural leaf decay near trees", () => {
        const dim = world.getDimension("minecraft:overworld") as any;

        // Simulate tree canopy blocks (leaves adjacent to decaying leaf)
        dim.setBlock({ x: 50, y: 72, z: 50 }, {
            typeId: "minecraft:oak_leaves",
            permutation: BlockPermutation.resolve("minecraft:oak_leaves")
        });

        const appleEntity = new Entity();
        appleEntity.typeId = "minecraft:item";
        appleEntity.location = { x: 50.5, y: 71.5, z: 50.5 };
        appleEntity.dimension = dim;

        const itemStack = new ItemStack("minecraft:apple", 1);
        appleEntity.setComponent(EntityComponentTypes.Item, { itemStack });

        assert.equal(isTreeAppleDrop(appleEntity), true, "Apple from decaying leaves must be identified as tree drop");

        eventBus.dispatch("entitySpawn", { entity: appleEntity });
        assert.equal(appleEntity.isRemoved, true, "Apple entity from leaf decay must be removed");
    });

    it("preserves apples dropped from broken chests (e.g. dungeon loot chests)", () => {
        const dim = world.getDimension("minecraft:overworld") as any;

        eventBus.dispatch("playerBreakBlock", {
            block: { dimension: dim, x: 100, y: 30, z: 100 },
            brokenBlockPermutation: BlockPermutation.resolve("minecraft:chest")
        });

        const appleEntity = new Entity();
        appleEntity.typeId = "minecraft:item";
        appleEntity.location = { x: 100.5, y: 30.5, z: 100.5 };
        appleEntity.dimension = dim;

        const itemStack = new ItemStack("minecraft:apple", 1);
        appleEntity.setComponent(EntityComponentTypes.Item, { itemStack });

        assert.equal(isTreeAppleDrop(appleEntity), false, "Chest apple drops must NOT be flagged as tree drops");

        eventBus.dispatch("entitySpawn", { entity: appleEntity });
        assert.equal(appleEntity.isRemoved, true, "the vanilla apple entity is replaced, not kept");
        assert.equal(spawnedItems.length, 1, "the chest apple must be respawned so it can merge");
        assert.equal(spawnedItems[0].typeId, "bh:apple", "Apple entity from chest must become the Beta apple");
    });

    it("preserves apples dropped intentionally by players from inventory", () => {
        const dim = world.getDimension("minecraft:overworld") as any;

        const player = new Player();
        player.location = { x: 200, y: 65, z: 200 };
        player.dimension = dim;
        mockPlayers.push(player);

        // Player drops item right in front of them (< 1.5 blocks)
        const appleEntity = new Entity();
        appleEntity.typeId = "minecraft:item";
        appleEntity.location = { x: 200.5, y: 65.2, z: 200.5 };
        appleEntity.dimension = dim;

        const itemStack = new ItemStack("minecraft:apple", 1);
        appleEntity.setComponent(EntityComponentTypes.Item, { itemStack });

        assert.equal(isTreeAppleDrop(appleEntity), false, "Player-dropped apples must NOT be flagged as tree drops");

        eventBus.dispatch("entitySpawn", { entity: appleEntity });
        assert.equal(spawnedItems[0]?.typeId, "bh:apple", "Player-dropped apple must land on the id the inventory keeps");
    });

    it("preserves apples dropped when a player dies", () => {
        const dim = world.getDimension("minecraft:overworld") as any;

        const deadPlayer = new Player();
        deadPlayer.location = { x: 300, y: 64, z: 300 };
        deadPlayer.dimension = dim;

        eventBus.dispatch("entityDie", { deadEntity: deadPlayer });

        const appleEntity = new Entity();
        appleEntity.typeId = "minecraft:item";
        appleEntity.location = { x: 300.2, y: 64.1, z: 300.1 };
        appleEntity.dimension = dim;

        const itemStack = new ItemStack("minecraft:apple", 1);
        appleEntity.setComponent(EntityComponentTypes.Item, { itemStack });

        assert.equal(isTreeAppleDrop(appleEntity), false, "Player death inventory drops must NOT be flagged as tree drops");

        eventBus.dispatch("entitySpawn", { entity: appleEntity });
        assert.equal(spawnedItems[0]?.typeId, "bh:apple", "Player death apple drop must land on the id the inventory keeps");
    });
});
