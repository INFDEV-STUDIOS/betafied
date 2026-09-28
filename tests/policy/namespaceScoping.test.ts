import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    world,
    ItemStack,
    Entity,
    EntityComponentTypes
} from "@minecraft/server";
import { eventBus } from "../../packs/BP/scripts/core/eventBus.js";
import { resetMocks } from "../mocks/minecraftServer.js";

// Imported for its side effect: registering the spawn-time culling handler on the event bus.
import "../../packs/BP/scripts/mobs/entitySpawnHandler.js";

function spawnEntity(typeId: string, itemTypeId?: string, amount = 1): Entity {
    const entity = new Entity();
    entity.typeId = typeId;
    entity.location = { x: 0, y: 64, z: 0 };
    entity.dimension = world.getDimension("minecraft:overworld") as any;

    if (itemTypeId) {
        entity.setComponent(EntityComponentTypes.Item, { itemStack: new ItemStack(itemTypeId, amount) });
    }

    eventBus.dispatch("entitySpawn", { entity });
    return entity;
}

describe("Namespace Scoping of Destructive Gates", () => {
    beforeEach(() => {
        resetMocks();
    });

    describe("Entity Spawn Gatekeeper", () => {
        it("preserves mobs shipped by other addons", () => {
            assert.equal(spawnEntity("gun:turret").isRemoved, false);
            assert.equal(spawnEntity("techmod:sentinel").isRemoved, false);
        });

        it("still culls modern vanilla mobs", () => {
            assert.equal(spawnEntity("minecraft:warden").isRemoved, true);
            assert.equal(spawnEntity("minecraft:drowned").isRemoved, true);
            assert.equal(spawnEntity("minecraft:sulfur_cube").isRemoved, true);
        });
    });

    describe("Item Drop Gatekeeper", () => {
        it("preserves dropped items owned by another addon", () => {
            assert.equal(spawnEntity("minecraft:item", "gun:bullet").isRemoved, false);
            assert.equal(spawnEntity("minecraft:item", "techmod:rotten_flesh").isRemoved, false);
        });

        it("still culls banned vanilla drops and converts modern ores", () => {
            assert.equal(spawnEntity("minecraft:item", "minecraft:rotten_flesh").isRemoved, true);
            assert.equal(spawnEntity("minecraft:item", "minecraft:raw_iron").isRemoved, true);
        });
    });
});
