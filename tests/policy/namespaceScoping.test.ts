import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    world,
    ItemStack,
    Entity,
    EntityComponentTypes
} from "@minecraft/server";
import { eventBus } from "../../packs/BP/scripts/core/eventBus.js";
import { mockEntities, mockPlayers, resetMocks } from "../mocks/minecraftServer.js";

// Imported for its side effect: registering the spawn-time culling handler on the event bus.
import "../../packs/BP/scripts/mobs/entitySpawnHandler.js";
import { cleanerJob } from "../../packs/BP/scripts/mobs/entityCleaner.js";

function spawnEntity(typeId: string, itemTypeId?: string, amount = 1, tags: readonly string[] = []): Entity {
    const entity = new Entity();
    entity.typeId = typeId;
    entity.location = { x: 0, y: 64, z: 0 };
    entity.dimension = world.getDimension("minecraft:overworld") as any;

    if (itemTypeId) {
        entity.setComponent(EntityComponentTypes.Item, { itemStack: new ItemStack(itemTypeId, amount) });
    }
    for (const tag of tags) entity.addTag(tag);

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

        it("preserves a decor entity another addon owns", () => {
            // The namespace rule cannot see this one: far.land's item display is a `minecraft:item`
            // holding whatever the player spent, so the drop rewrite would eat it on sight.
            const display = spawnEntity("minecraft:item", "minecraft:smooth_stone", 1, ["far:item_display"]);
            assert.equal(display.isRemoved, false);
        });

        it("still culls that same item when no addon owns it", () => {
            // Smooth stone has no Beta 1.7.3 counterpart, which is exactly what the tag above spares.
            assert.equal(spawnEntity("minecraft:item", "minecraft:smooth_stone").isRemoved, true);
        });
    });

    describe("Periodic Cleaner", () => {
        // Placed straight into the mock world rather than through `spawnEntity`, so the spawn gate
        // cannot be the thing that removes it and each assertion is about the sweep alone.
        function placeItem(id: string, itemTypeId: string, tags: readonly string[] = []): Entity {
            const entity = new Entity();
            entity.id = id;
            entity.typeId = "minecraft:item";
            entity.location = { x: 0, y: 64, z: 0 };
            entity.dimension = world.getDimension("minecraft:overworld") as any;
            entity.setComponent(EntityComponentTypes.Item, { itemStack: new ItemStack(itemTypeId, 1) });
            for (const tag of tags) entity.addTag(tag);
            mockEntities.set(id, entity);
            return entity;
        }

        function sweep(): void {
            // The job yields once per entity, so draining it runs exactly one pass.
            Array.from(cleanerJob());
        }

        beforeEach(() => {
            mockPlayers.push({
                isValid: true,
                dimension: world.getDimension("minecraft:overworld"),
                location: { x: 0, y: 64, z: 0 }
            });
        });

        it("spares a display the spawn gate spared", () => {
            const display = placeItem("farland_display", "minecraft:smooth_stone", ["far:item_display"]);
            sweep();
            assert.equal(display.isRemoved, false);
        });

        it("still scrubs an unowned post-Beta ground item", () => {
            const drop = placeItem("stray_drop", "minecraft:smooth_stone");
            sweep();
            assert.equal(drop.isRemoved, true);
        });
    });
});
