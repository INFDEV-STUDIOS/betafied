import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ItemStack, EntityComponentTypes } from "@minecraft/server";
import { handleSheepPunch } from "../../packs/BP/scripts/mobs/betaAnimalAI.js";

describe("Beta Animal AI - Sheep Punching", () => {
    it("shears the sheep and drops wool of the sheep's color", () => {
        let triggeredEvent: string | null = null;
        let spawnedItem: ItemStack | null = null;

        const fakeSheep = {
            isValid: true,
            typeId: "minecraft:sheep",
            location: { x: 10, y: 64, z: 20 },
            getComponent(type: string) {
                if (type === EntityComponentTypes.Health) {
                    return { currentValue: 8 };
                }
                if (type === EntityComponentTypes.Color) {
                    return { value: 14 }; // Red wool
                }
                return null;
            },
            hasComponent(type: string) {
                return type === "minecraft:is_sheared" ? false : false;
            },
            triggerEvent(event: string) {
                triggeredEvent = event;
            },
            dimension: {
                spawnItem(item: ItemStack) {
                    spawnedItem = item;
                }
            }
        };

        handleSheepPunch(fakeSheep as any);

        assert.equal(triggeredEvent, "minecraft:on_sheared", "Sheep should be sheared");
        assert.ok(spawnedItem !== null, "Wool item should be spawned");
        assert.equal(spawnedItem?.typeId, "minecraft:red_wool", "Wool color should match sheep red color");
        assert.ok(spawnedItem?.amount >= 1 && spawnedItem?.amount <= 3, "Should drop 1-3 wool blocks");
    });

    it("does not drop extra wool if the sheep died from the hit", () => {
        let triggeredEvent: string | null = null;
        let spawnedItem: ItemStack | null = null;

        const fakeDeadSheep = {
            isValid: true,
            typeId: "minecraft:sheep",
            location: { x: 10, y: 64, z: 20 },
            getComponent(type: string) {
                if (type === EntityComponentTypes.Health) {
                    return { currentValue: 0 };
                }
                return null;
            },
            hasComponent() {
                return false;
            },
            triggerEvent(event: string) {
                triggeredEvent = event;
            },
            dimension: {
                spawnItem(item: ItemStack) {
                    spawnedItem = item;
                }
            }
        };

        handleSheepPunch(fakeDeadSheep as any);

        assert.equal(triggeredEvent, null, "Dead sheep should not trigger on_sheared");
        assert.equal(spawnedItem, null, "Death loot table handles dead sheep, punch should not duplicate drop");
    });
});
