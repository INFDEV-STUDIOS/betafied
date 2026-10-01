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

        it("replaces modern deepslate terrain blocks", () => {
            const bulkMap = new Map(BLOCK_BULK_REPLACEMENTS);
            assert.equal(bulkMap.get("minecraft:deepslate"), "minecraft:stone");
            assert.equal(bulkMap.get("minecraft:cobbled_deepslate"), "minecraft:cobblestone");
        });

        it("dissolves the Nether's ores but lets the biome own its terrain", () => {
            const bulkMap = new Map(BLOCK_BULK_REPLACEMENTS);
            assert.equal(bulkMap.get("minecraft:quartz_ore"), "minecraft:netherrack");
            assert.equal(bulkMap.get("minecraft:nether_gold_ore"), "minecraft:netherrack");
            assert.equal(bulkMap.get("minecraft:ancient_debris"), "minecraft:netherrack");

            // Modern Nether terrain is never repainted block-by-block — the single biome owns it.
            assert.equal(bulkMap.get("minecraft:blackstone"), undefined);
            assert.equal(bulkMap.get("minecraft:basalt"), undefined);
            assert.equal(ITEM_CONVERSIONS["minecraft:blackstone"], undefined);
            assert.equal(ITEM_CONVERSIONS["minecraft:magma_block"], undefined);
        });

        it("turns the Nether's magma shores into Beta gravel beaches", () => {
            const bulkMap = new Map(BLOCK_BULK_REPLACEMENTS);
            assert.equal(bulkMap.get("minecraft:magma"), "minecraft:gravel");
        });

        it("gives every full-cube modern block a real Beta stand-in", () => {
            // These are the blocks the resource pack stopped masking: the fine pass is what turns
            // them into a Beta material, so the table has to name one for each.
            assert.equal(BLOCK_FINE_REPLACEMENTS["minecraft:sculk"], "minecraft:stone");
            assert.equal(BLOCK_FINE_REPLACEMENTS["minecraft:sculk_catalyst"], "minecraft:stone");
            assert.equal(BLOCK_FINE_REPLACEMENTS["minecraft:sculk_sensor"], "minecraft:stone");
            assert.equal(BLOCK_FINE_REPLACEMENTS["minecraft:sculk_shrieker"], "minecraft:stone");
            assert.equal(BLOCK_FINE_REPLACEMENTS["minecraft:calibrated_sculk_sensor"], "minecraft:stone");
            assert.equal(BLOCK_FINE_REPLACEMENTS["minecraft:beacon"], "minecraft:obsidian");
            assert.equal(BLOCK_FINE_REPLACEMENTS["minecraft:respawn_anchor"], "minecraft:obsidian");
            assert.equal(BLOCK_FINE_REPLACEMENTS["minecraft:conduit"], "minecraft:stone");
            assert.equal(BLOCK_FINE_REPLACEMENTS["minecraft:stonecutter_block"], "minecraft:stone");
            assert.equal(BLOCK_FINE_REPLACEMENTS["minecraft:sea_lantern"], "minecraft:glowstone");
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
