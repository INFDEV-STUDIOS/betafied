import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ItemStack, EntityComponentTypes } from "@minecraft/server";
import { handleSheepPunch, WOOL_DROP_MIN, WOOL_DROP_MAX } from "../../packs/BP/scripts/mobs/betaAnimalAI.js";

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

        handleSheepPunch(fakeSheep as any);

        assert.equal(triggeredEvent, "minecraft:on_sheared", "Sheep should be sheared");
        assert.ok(spawnedItem !== null, "Wool item should be spawned");
        assert.equal((spawnedItem as ItemStack).typeId, "minecraft:red_wool", "Wool color should match sheep red color");
        const amount = (spawnedItem as ItemStack).amount;
        assert.ok(
            amount >= WOOL_DROP_MIN && amount <= WOOL_DROP_MAX,
            `Should drop ${WOOL_DROP_MIN}-${WOOL_DROP_MAX} wool blocks, got ${amount}`
        );
    });

    it("drops the same amount whether the sheep is punched or sheared", () => {
        // Shears run the engine's `minecraft:interact`, which spawns from this loot table, while a punch
        // spawns the stack from the script. The number therefore lives in two files and had already
        // drifted apart — 2-4 by shears against 1-3 by punch — so it is pinned by agreement here.
        const table = JSON.parse(
            readFileSync(resolve(process.cwd(), "packs/BP/loot_tables/entities/sheep_shear.json"), "utf-8")
        );

        const entries = table.pools.flatMap((pool: any) => pool.entries);
        const wool = entries.find((entry: any) => entry.name === "minecraft:wool");
        assert.ok(wool, "the shear table must still yield wool");

        const setCount = wool.functions.find((fn: any) => fn.function === "set_count");
        assert.ok(setCount, "the shear table must still declare a count");

        assert.equal(setCount.count.min, WOOL_DROP_MIN, "the shears drop floor must match the punch path");
        assert.equal(setCount.count.max, WOOL_DROP_MAX, "the shears drop ceiling must match the punch path");
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
