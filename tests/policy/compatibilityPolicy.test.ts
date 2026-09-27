import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    ORE_ITEM_REPLACEMENTS,
    ITEM_CONVERSIONS,
    BLOCK_BULK_REPLACEMENTS,
    BLOCK_FINE_REPLACEMENTS,
    isAllowedEntityType,
    isBannedItemDrop,
    assessEntityCompatibility
} from "../../packs/BP/scripts/core/compatibilityPolicy.js";

describe("Compatibility Policy - Pure Unit Tests", () => {
    describe("Entity Drop Ore Replacements", () => {
        it("replaces modern raw ore drops with authentic beta ore blocks", () => {
            assert.equal(ORE_ITEM_REPLACEMENTS["minecraft:raw_iron"], "minecraft:iron_ore");
            assert.equal(ORE_ITEM_REPLACEMENTS["minecraft:raw_gold"], "minecraft:gold_ore");
            assert.equal(ORE_ITEM_REPLACEMENTS["minecraft:raw_copper"], "minecraft:iron_ore");
        });
    });

    describe("Player Inventory Conversions", () => {
        it("converts modern stone variants to standard stone", () => {
            assert.equal(ITEM_CONVERSIONS["minecraft:andesite"], "minecraft:stone");
            assert.equal(ITEM_CONVERSIONS["minecraft:diorite"], "minecraft:stone");
            assert.equal(ITEM_CONVERSIONS["minecraft:granite"], "minecraft:stone");
            assert.equal(ITEM_CONVERSIONS["minecraft:tuff"], "minecraft:stone");
            assert.equal(ITEM_CONVERSIONS["minecraft:deepslate"], "minecraft:stone");
            assert.equal(ITEM_CONVERSIONS["minecraft:cobbled_deepslate"], "minecraft:cobblestone");
        });

        it("converts modern copper items to cobblestone/stone", () => {
            assert.equal(ITEM_CONVERSIONS["minecraft:copper_ingot"], "minecraft:cobblestone");
            assert.equal(ITEM_CONVERSIONS["minecraft:raw_copper"], "minecraft:cobblestone");
            assert.equal(ITEM_CONVERSIONS["minecraft:copper_ore"], "minecraft:stone");
        });

        it("converts modern woods, doors, fences, slabs to beta equivalents", () => {
            assert.equal(ITEM_CONVERSIONS["minecraft:cherry_fence"], "bh:fence");
            assert.equal(ITEM_CONVERSIONS["minecraft:oak_fence"], "bh:fence");
            assert.equal(ITEM_CONVERSIONS["minecraft:oak_slab"], "bh:wooden_slab");
            assert.equal(ITEM_CONVERSIONS["minecraft:cherry_slab"], "bh:wooden_slab");
            assert.equal(ITEM_CONVERSIONS["minecraft:mangrove_door"], "minecraft:wooden_door");
            assert.equal(ITEM_CONVERSIONS["minecraft:birch_boat"], "minecraft:oak_boat");
        });

        it("converts modern flowers to rose/poppy and dyes to raw materials", () => {
            assert.equal(ITEM_CONVERSIONS["minecraft:cornflower"], "minecraft:poppy");
            assert.equal(ITEM_CONVERSIONS["minecraft:white_dye"], "minecraft:bone_meal");
            assert.equal(ITEM_CONVERSIONS["minecraft:black_dye"], "minecraft:ink_sac");
            assert.equal(ITEM_CONVERSIONS["minecraft:blue_dye"], "minecraft:lapis_lazuli");
        });

        it("contains non-empty valid target strings for every conversion key", () => {
            for (const [key, target] of Object.entries(ITEM_CONVERSIONS)) {
                assert.ok(key.length > 0, `Empty key found`);
                assert.ok(target.length > 0, `Empty target found for key: ${key}`);
                assert.notEqual(key, target, `Self-referential conversion for ${key}`);
            }
        });
    });

    describe("World Block Replacements", () => {
        it("preserves intentional boundary distinction for tuff and raw copper block", () => {
            const bulkMap = new Map(BLOCK_BULK_REPLACEMENTS);
            // In terrain, tuff becomes gravel to preserve granular pocket feel
            assert.equal(bulkMap.get("minecraft:tuff"), "minecraft:gravel");
            // In inventory, tuff becomes stone for player building utility
            assert.equal(ITEM_CONVERSIONS["minecraft:tuff"], "minecraft:stone");

            // In terrain, raw_copper_block becomes solid stone
            assert.equal(bulkMap.get("minecraft:raw_copper_block"), "minecraft:stone");
            // In inventory, raw_copper_block becomes cobblestone
            assert.equal(ITEM_CONVERSIONS["minecraft:raw_copper_block"], "minecraft:cobblestone");
        });

        it("replaces modern deepslate and nether terrain blocks", () => {
            const bulkMap = new Map(BLOCK_BULK_REPLACEMENTS);
            assert.equal(bulkMap.get("minecraft:deepslate"), "minecraft:stone");
            assert.equal(bulkMap.get("minecraft:cobbled_deepslate"), "minecraft:cobblestone");
            assert.equal(bulkMap.get("minecraft:blackstone"), "minecraft:netherrack");
            assert.equal(bulkMap.get("minecraft:basalt"), "minecraft:netherrack");
            assert.equal(bulkMap.get("minecraft:ancient_debris"), "minecraft:netherrack");
        });

        it("fine replacements clear modern vegetation and non-beta blocks", () => {
            assert.equal(BLOCK_FINE_REPLACEMENTS["minecraft:tall_grass"], "minecraft:air");
            assert.equal(BLOCK_FINE_REPLACEMENTS["minecraft:seagrass"], "minecraft:water");
            assert.equal(BLOCK_FINE_REPLACEMENTS["minecraft:sculk"], "minecraft:stone");
            assert.equal(BLOCK_FINE_REPLACEMENTS["minecraft:azalea_leaves"], "minecraft:leaves");
        });
    });

    describe("Entity Compatibility Predicates & Assessment", () => {
        it("allows classic Beta 1.7.3 entities", () => {
            const classic = [
                "minecraft:player",
                "minecraft:pig",
                "minecraft:cow",
                "minecraft:sheep",
                "minecraft:chicken",
                "minecraft:creeper",
                "minecraft:skeleton",
                "minecraft:zombie",
                "minecraft:spider",
                "minecraft:slime",
                "minecraft:ghast",
                "minecraft:zombie_pigman",
                "minecraft:item",
                "minecraft:arrow",
                "minecraft:boat",
                "minecraft:minecart"
            ];
            for (const typeId of classic) {
                assert.equal(isAllowedEntityType(typeId), true, `Expected ${typeId} to be allowed`);
            }
        });

        it("disallows post-Beta 1.7.3 mobs and entities", () => {
            const modern = [
                "minecraft:villager",
                "minecraft:drowned",
                "minecraft:husk",
                "minecraft:phantom",
                "minecraft:warden",
                "minecraft:pillager",
                "minecraft:iron_golem",
                "minecraft:horse",
                "minecraft:breeze",
                "minecraft:xp_orb"
            ];
            for (const typeId of modern) {
                assert.equal(isAllowedEntityType(typeId), false, `Expected ${typeId} to be disallowed`);
            }
        });

        it("flags banned natural item drops", () => {
            assert.equal(isBannedItemDrop("minecraft:rotten_flesh"), true);
            assert.equal(isBannedItemDrop("minecraft:feather"), false);
            assert.equal(isBannedItemDrop("minecraft:iron_ingot"), false);
        });

        it("trusts entities and item drops owned by other namespaces", () => {
            assert.equal(isAllowedEntityType("gun:turret"), true);
            assert.equal(isAllowedEntityType("techmod:sentinel"), true);
            assert.deepEqual(assessEntityCompatibility("gun:turret"), { allowed: true });
            assert.deepEqual(assessEntityCompatibility("minecraft:item", "gun:bullet"), { allowed: true });
        });

        it("assesses entity compatibility with detailed reasons", () => {
            assert.deepEqual(assessEntityCompatibility("minecraft:zombie"), { allowed: true });
            assert.deepEqual(assessEntityCompatibility("minecraft:drowned"), {
                allowed: false,
                reason: "disallowed_type"
            });
            assert.deepEqual(assessEntityCompatibility("minecraft:item", "minecraft:diamond"), {
                allowed: true
            });
            assert.deepEqual(assessEntityCompatibility("minecraft:item", "minecraft:rotten_flesh"), {
                allowed: false,
                reason: "banned_item_drop"
            });
        });
    });
});
