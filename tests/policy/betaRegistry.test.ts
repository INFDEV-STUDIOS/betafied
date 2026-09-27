import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    BETA_ENTITY_TYPES,
    BETA_ITEM_IDS,
    BETA_BLOCK_IDS,
    isBetaEntity,
    isBetaItem,
    isBetaBlock,
    isModItem,
    isVanillaId
} from "../../packs/BP/scripts/core/betaRegistry.js";

describe("Canonical Beta 1.7.3 Registry Policy", () => {
    describe("Entity Registry", () => {
        it("allows classic Beta 1.7.3 entities", () => {
            const classic = [
                "minecraft:player",
                "minecraft:item",
                "minecraft:arrow",
                "minecraft:chicken",
                "minecraft:cow",
                "minecraft:pig",
                "minecraft:sheep",
                "minecraft:squid",
                "minecraft:wolf",
                "minecraft:zombie",
                "minecraft:skeleton",
                "minecraft:creeper",
                "minecraft:spider",
                "minecraft:slime",
                "minecraft:ghast",
                "minecraft:zombie_pigman",
                "minecraft:boat",
                "minecraft:minecart"
            ];
            for (const id of classic) {
                assert.ok(isBetaEntity(id), `Expected ${id} to be recognized as a Beta entity`);
                assert.ok(BETA_ENTITY_TYPES.has(id));
            }
        });

        it("disallows post-Beta 1.7.3 modern mobs", () => {
            const modern = [
                "minecraft:warden",
                "minecraft:allay",
                "minecraft:sniffer",
                "minecraft:breeze",
                "minecraft:bogged",
                "minecraft:phantom",
                "minecraft:drowned",
                "minecraft:pillager",
                "minecraft:ravager",
                "minecraft:piglin",
                "minecraft:hoglin",
                "minecraft:enderman",
                "minecraft:villager",
                "minecraft:iron_golem"
            ];
            for (const id of modern) {
                assert.equal(isBetaEntity(id), false, `Expected ${id} to be rejected as post-Beta`);
            }
        });
    });

    describe("Item Registry", () => {
        it("allows authentic Beta 1.7.3 items and tools", () => {
            const classic = [
                "minecraft:iron_pickaxe",
                "minecraft:diamond_sword",
                "minecraft:wooden_shovel",
                "minecraft:bow",
                "minecraft:arrow",
                "minecraft:bread",
                "minecraft:apple",
                "minecraft:cooked_porkchop",
                "minecraft:coal",
                "minecraft:iron_ingot",
                "minecraft:diamond",
                "minecraft:redstone",
                "minecraft:bone_meal"
            ];
            for (const id of classic) {
                assert.ok(isBetaItem(id), `Expected ${id} to be recognized as a Beta item`);
                assert.ok(BETA_ITEM_IDS.has(id));
            }
        });

        it("disallows modern post-Beta items", () => {
            const modern = [
                "minecraft:netherite_sword",
                "minecraft:elytra",
                "minecraft:mace",
                "minecraft:totem_of_undying",
                "minecraft:trident",
                "minecraft:crossbow",
                "minecraft:shield",
                "minecraft:shulker_shell",
                "minecraft:amethyst_shard",
                "minecraft:raw_iron",
                "minecraft:raw_copper",
                "minecraft:copper_ingot"
            ];
            for (const id of modern) {
                assert.equal(isBetaItem(id), false, `Expected ${id} to be rejected as post-Beta item`);
            }
        });
    });

    describe("Addon-Owned Content", () => {
        it("trusts every item the mod itself defines, even when it is not a vanilla Beta id", () => {
            // The mod replaces the vanilla workbench with bh:crafting_table; the gatekeeper
            // must not delete the addon's own blocks or items.
            const addonContent = [
                "bh:crafting_table",
                "bh:fence",
                "bh:wooden_slab",
                "bh:apple",
                "bh:bow",
                "ubd:furnace_minecart"
            ];
            for (const id of addonContent) {
                assert.ok(isModItem(id), `Expected ${id} to belong to a mod namespace`);
                assert.ok(isBetaItem(id), `Expected ${id} to be allowed through the item gatekeeper`);
            }
        });

        it("does not mistake vanilla ids for mod content", () => {
            assert.equal(isModItem("minecraft:crafting_table"), false);
            assert.equal(isModItem("minecraft:stone"), false);
            assert.equal(isModItem("crafting_table"), false);
        });

        it("scopes destructive policies to the vanilla namespace", () => {
            assert.equal(isVanillaId("minecraft:stone"), true);
            assert.equal(isVanillaId("minecraft:netherite_sword"), true);
            assert.equal(isVanillaId("gun:1911"), false);
            assert.equal(isVanillaId("bh:fence"), false);
            assert.equal(isVanillaId("crafting_table"), false);
        });

        it("allows Beta 1.7.3 maps despite the modern empty_map id split", () => {
            assert.ok(isBetaItem("minecraft:empty_map"));
            assert.ok(isBetaItem("minecraft:filled_map"));
        });
    });

    describe("Block Registry", () => {
        it("allows authentic Beta 1.7.3 blocks", () => {
            const classic = [
                "minecraft:stone",
                "minecraft:cobblestone",
                "minecraft:dirt",
                "minecraft:grass_block",
                "minecraft:sand",
                "minecraft:gravel",
                "minecraft:bedrock",
                "minecraft:oak_log",
                "minecraft:oak_planks",
                "minecraft:oak_leaves",
                "minecraft:netherrack",
                "minecraft:obsidian",
                "minecraft:glowstone",
                "minecraft:tnt",
                "minecraft:glass"
            ];
            for (const id of classic) {
                assert.ok(isBetaBlock(id), `Expected ${id} to be recognized as a Beta block`);
                assert.ok(BETA_BLOCK_IDS.has(id));
            }
        });

        it("disallows modern post-Beta blocks", () => {
            const modern = [
                "minecraft:deepslate",
                "minecraft:tuff",
                "minecraft:calcite",
                "minecraft:copper_block",
                "minecraft:mud",
                "minecraft:mangrove_planks",
                "minecraft:cherry_log",
                "minecraft:pale_oak_log",
                "minecraft:blackstone",
                "minecraft:basalt",
                "minecraft:ancient_debris",
                "minecraft:sculk"
            ];
            for (const id of modern) {
                assert.equal(isBetaBlock(id), false, `Expected ${id} to be rejected as post-Beta block`);
            }
        });
    });
});
