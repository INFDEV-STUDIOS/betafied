import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    BLOCK_BULK_REPLACEMENTS,
    BLOCK_FINE_REPLACEMENTS,
    isAllowedEntityType,
    isBannedItemDrop,
    assessEntityCompatibility
} from "../../packs/BP/scripts/core/compatibilityPolicy.js";
import { normalizeItem, normalizeEntityDrop } from "../../packs/BP/scripts/core/normalizer.js";
import { BETA_BLOCK_IDS } from "../../packs/BP/scripts/core/betaRegistry.js";

/**
 * These cases describe the behaviour the game actually has. Every assertion goes through the same
 * function the subsystem calls, so a conversion named here is a conversion the player sees — the
 * older version of this file asserted a private table that production never read.
 */

function converted(itemId: string): string | undefined {
    const result = normalizeItem(itemId);
    return result.action === "convert" ? result.targetId : undefined;
}

describe("World block replacement policy", () => {
    const bulkMap = new Map(BLOCK_BULK_REPLACEMENTS);

    it("never scrubs a block that is already authentic Beta terrain", () => {
        // A Beta id in the key column would delete real 1.7.3 terrain, which is the one outcome the
        // scrubber must never produce.
        const alreadyBeta = BLOCK_BULK_REPLACEMENTS
            .map(([modern]) => modern)
            .filter(modern => BETA_BLOCK_IDS.has(modern));

        assert.deepEqual(alreadyBeta, [], `these are authentic Beta blocks and must not be replaced: ${alreadyBeta.join(", ")}`);
    });

    it("replaces modern deepslate terrain blocks", () => {
        assert.equal(bulkMap.get("minecraft:deepslate"), "minecraft:stone");
        assert.equal(bulkMap.get("minecraft:cobbled_deepslate"), "minecraft:cobblestone");
    });

    it("dissolves the Nether's ores but lets the biome own its terrain", () => {
        assert.equal(bulkMap.get("minecraft:quartz_ore"), "minecraft:netherrack");
        assert.equal(bulkMap.get("minecraft:nether_gold_ore"), "minecraft:netherrack");
        assert.equal(bulkMap.get("minecraft:ancient_debris"), "minecraft:netherrack");

        // Modern Nether terrain is owned by the biome override, not repainted block-by-block.
        assert.equal(bulkMap.get("minecraft:blackstone"), undefined);
        assert.equal(bulkMap.get("minecraft:basalt"), undefined);
        assert.equal(normalizeItem("minecraft:blackstone").action, "remove");
    });

    it("turns the Nether's magma shores into Beta gravel beaches", () => {
        assert.equal(bulkMap.get("minecraft:magma"), "minecraft:gravel");
    });

    it("dissolves the ores Beta never had into stone, not holes", () => {
        // Emerald arrived in 1.3 and copper in 1.17. Both still generate on modern terrain, so the
        // scrubber has to repaint them; mapping them to air would leave ore-shaped cavities where the
        // vein was carried by rock the player can see through.
        assert.equal(bulkMap.get("minecraft:emerald_ore"), "minecraft:stone");
        assert.equal(bulkMap.get("minecraft:deepslate_emerald_ore"), "minecraft:stone");
        assert.equal(bulkMap.get("minecraft:copper_ore"), "minecraft:stone");
        assert.equal(bulkMap.get("minecraft:deepslate_copper_ore"), "minecraft:stone");
    });

    it("gives every full-cube modern block a real Beta stand-in", () => {
        // These are the blocks the resource pack stopped masking: the fine pass is what turns them
        // into a Beta material, so the table has to name one for each.
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
        assert.equal(BLOCK_FINE_REPLACEMENTS["minecraft:azalea_leaves"], "minecraft:leaves");
    });
});

describe("Inventory normalization agrees with the world tables where it should", () => {
    it("converts modern stone variants to standard stone", () => {
        assert.equal(converted("minecraft:andesite"), "minecraft:stone");
        assert.equal(converted("minecraft:diorite"), "minecraft:stone");
        assert.equal(converted("minecraft:granite"), "minecraft:stone");
        assert.equal(converted("minecraft:tuff"), "minecraft:stone");
        assert.equal(converted("minecraft:deepslate"), "minecraft:stone");
        assert.equal(converted("minecraft:cobbled_deepslate"), "minecraft:cobblestone");
    });

    it("converts modern copper items to cobblestone or stone", () => {
        assert.equal(converted("minecraft:copper_ingot"), "minecraft:cobblestone");
        assert.equal(converted("minecraft:raw_copper"), "minecraft:cobblestone");
        assert.equal(converted("minecraft:copper_ore"), "minecraft:stone");
        assert.equal(converted("minecraft:copper_stairs"), "minecraft:cobblestone_stairs");
    });

    it("converts modern woods, doors, fences and slabs to beta equivalents", () => {
        assert.equal(converted("minecraft:cherry_fence"), "bh:fence");
        assert.equal(converted("minecraft:cherry_slab"), "bh:wooden_slab");
        assert.equal(converted("minecraft:mangrove_door"), "minecraft:wooden_door");
        assert.equal(converted("minecraft:birch_boat"), "minecraft:boat");
    });

    it("answers \"is this id authentic Beta?\" for the oak fence and slab, not \"is it the bh: one?\"", () => {
        // Beta 1.7.3 shipped oak fences and wooden slabs, so this layer calls both authentic — it is
        // answering which ids may exist in the world. A *held* item does not reach this function
        // alone: `inventoryManager` consults the placer table first, which is what moves a held oak
        // fence onto bh:fence. tests/policy/inventoryManager.test.ts pins that player-visible result.
        assert.equal(normalizeItem("minecraft:oak_fence").action, "keep");
        assert.equal(normalizeItem("minecraft:oak_slab").action, "keep");
    });

    it("keeps the terrain/inventory split the world tables rely on", () => {
        const bulkMap = new Map(BLOCK_BULK_REPLACEMENTS);

        // Tuff is cave-wall noise in terrain and a building block in a hotbar.
        assert.equal(bulkMap.get("minecraft:tuff"), "minecraft:gravel");
        assert.equal(converted("minecraft:tuff"), "minecraft:stone");

        // Raw copper stays solid rock underground but is cobblestone in the inventory.
        assert.equal(bulkMap.get("minecraft:raw_copper_block"), "minecraft:stone");
        assert.equal(converted("minecraft:raw_copper_block"), "minecraft:cobblestone");
    });
});

describe("Entity compatibility predicates", () => {
    it("allows classic Beta 1.7.3 entities", () => {
        const classic = [
            "minecraft:player", "minecraft:pig", "minecraft:cow", "minecraft:sheep", "minecraft:chicken",
            "minecraft:creeper", "minecraft:skeleton", "minecraft:zombie", "minecraft:spider",
            "minecraft:slime", "minecraft:ghast", "minecraft:zombie_pigman",
            "minecraft:item", "minecraft:arrow", "minecraft:boat", "minecraft:oak_boat", "minecraft:minecart"
        ];
        for (const typeId of classic) {
            assert.equal(isAllowedEntityType(typeId), true, `Expected ${typeId} to be allowed`);
        }
    });

    it("disallows post-Beta 1.7.3 mobs and entities", () => {
        const modern = [
            "minecraft:villager", "minecraft:drowned", "minecraft:husk", "minecraft:phantom",
            "minecraft:warden", "minecraft:pillager", "minecraft:iron_golem", "minecraft:horse",
            "minecraft:breeze", "minecraft:xp_orb"
        ];
        for (const typeId of modern) {
            assert.equal(isAllowedEntityType(typeId), false, `Expected ${typeId} to be disallowed`);
        }
    });

    it("flags every banned drop the normalizer removes, not just rotten flesh", () => {
        assert.equal(isBannedItemDrop("minecraft:rotten_flesh"), true);
        assert.equal(isBannedItemDrop("minecraft:mutton"), true);
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
        // The private banned-set this used to read held only rotten flesh, so mutton passed here
        // while the spawn handler removed it.
        assert.deepEqual(assessEntityCompatibility("minecraft:item", "minecraft:mutton"), {
            allowed: false,
            reason: "banned_item_drop"
        });
    });

    it("agrees with the drop normalizer on ore drops", () => {
        assert.deepEqual(normalizeEntityDrop("minecraft:raw_iron"), { action: "convert", targetId: "minecraft:iron_ore" });
        assert.deepEqual(normalizeEntityDrop("minecraft:raw_gold"), { action: "convert", targetId: "minecraft:gold_ore" });
        assert.deepEqual(normalizeEntityDrop("minecraft:raw_copper"), { action: "convert", targetId: "minecraft:cobblestone" });
    });
});
