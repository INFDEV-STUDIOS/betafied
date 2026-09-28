import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    normalizeItem,
    normalizeBlock,
    normalizeEntityDrop
} from "../../packs/BP/scripts/core/normalizer.js";

describe("Heuristic Inverse Normalizer", () => {
    describe("Item Normalization", () => {
        it("keeps authentic Beta items unchanged", () => {
            const betaItems = ["minecraft:iron_sword", "minecraft:diamond_pickaxe", "minecraft:bread", "minecraft:coal"];
            for (const item of betaItems) {
                assert.deepEqual(normalizeItem(item), { action: "keep" });
            }
        });

        it("keeps addon-defined content instead of stripping it as unsupported", () => {
            const addonContent = [
                "bh:crafting_table",
                "bh:fence",
                "bh:wooden_slab",
                "ubd:furnace_minecart",
                "minecraft:empty_map"
            ];
            for (const item of addonContent) {
                assert.deepEqual(normalizeItem(item), { action: "keep" }, `Expected ${item} to survive normalization`);
            }
        });

        it("leaves third-party namespace content untouched", () => {
            const modded = [
                "gun:1911",
                "gun:bullet",
                "gun:deepslate",
                "gun:copper_ingot",
                "techmod:rotten_flesh",
                "techmod:cherry_planks"
            ];
            for (const item of modded) {
                assert.deepEqual(normalizeItem(item), { action: "keep" }, `Expected ${item} to be left to its own addon`);
            }
        });

        it("converts modern wood items to authentic oak equivalents via pattern heuristics", () => {
            assert.deepEqual(normalizeItem("minecraft:cherry_planks"), { action: "convert", targetId: "minecraft:oak_planks" });
            assert.deepEqual(normalizeItem("minecraft:mangrove_planks"), { action: "convert", targetId: "minecraft:oak_planks" });
            assert.deepEqual(normalizeItem("minecraft:pale_oak_planks"), { action: "convert", targetId: "minecraft:oak_planks" });
            assert.deepEqual(normalizeItem("minecraft:bamboo_planks"), { action: "convert", targetId: "minecraft:oak_planks" });
            assert.deepEqual(normalizeItem("minecraft:crimson_planks"), { action: "convert", targetId: "minecraft:oak_planks" });

            assert.deepEqual(normalizeItem("minecraft:cherry_log"), { action: "convert", targetId: "minecraft:oak_log" });
            assert.deepEqual(normalizeItem("minecraft:stripped_mangrove_log"), { action: "convert", targetId: "minecraft:oak_log" });
            assert.deepEqual(normalizeItem("minecraft:crimson_stem"), { action: "convert", targetId: "minecraft:oak_log" });

            assert.deepEqual(normalizeItem("minecraft:cherry_door"), { action: "convert", targetId: "minecraft:wooden_door" });
            assert.deepEqual(normalizeItem("minecraft:crimson_trapdoor"), { action: "convert", targetId: "minecraft:trapdoor" });
            assert.deepEqual(normalizeItem("minecraft:bamboo_fence"), { action: "convert", targetId: "bh:fence" });
        });

        it("converts modern stone, deepslate, and copper variants", () => {
            assert.deepEqual(normalizeItem("minecraft:andesite"), { action: "convert", targetId: "minecraft:stone" });
            assert.deepEqual(normalizeItem("minecraft:diorite"), { action: "convert", targetId: "minecraft:stone" });
            assert.deepEqual(normalizeItem("minecraft:granite"), { action: "convert", targetId: "minecraft:stone" });
            assert.deepEqual(normalizeItem("minecraft:deepslate"), { action: "convert", targetId: "minecraft:stone" });
            assert.deepEqual(normalizeItem("minecraft:cobbled_deepslate"), { action: "convert", targetId: "minecraft:cobblestone" });

            assert.deepEqual(normalizeItem("minecraft:copper_ingot"), { action: "convert", targetId: "minecraft:cobblestone" });
            assert.deepEqual(normalizeItem("minecraft:raw_copper"), { action: "convert", targetId: "minecraft:cobblestone" });
            assert.deepEqual(normalizeItem("minecraft:copper_block"), { action: "convert", targetId: "minecraft:cobblestone" });
        });

        it("removes unconvertible modern items that have no authentic counterpart", () => {
            const junk = [
                "minecraft:netherite_sword",
                "minecraft:netherite_ingot",
                "minecraft:elytra",
                "minecraft:mace",
                "minecraft:shulker_box",
                "minecraft:totem_of_undying"
            ];
            for (const item of junk) {
                assert.deepEqual(normalizeItem(item), { action: "remove" });
            }
        });
    });

    describe("Block Normalization", () => {
        it("keeps authentic Beta blocks unchanged", () => {
            assert.deepEqual(normalizeBlock("minecraft:stone"), { action: "keep" });
            assert.deepEqual(normalizeBlock("minecraft:oak_log"), { action: "keep" });
            assert.deepEqual(normalizeBlock("minecraft:netherrack"), { action: "keep" });
        });

        it("converts modern nether terrain blocks to netherrack", () => {
            assert.deepEqual(normalizeBlock("minecraft:basalt"), { action: "convert", targetId: "minecraft:netherrack" });
            assert.deepEqual(normalizeBlock("minecraft:blackstone"), { action: "convert", targetId: "minecraft:netherrack" });
            assert.deepEqual(normalizeBlock("minecraft:crimson_nylium"), { action: "convert", targetId: "minecraft:netherrack" });
            assert.deepEqual(normalizeBlock("minecraft:shroomlight"), { action: "convert", targetId: "minecraft:netherrack" });
        });

        it("leaves modded blocks out of the scrubber heuristic", () => {
            assert.deepEqual(normalizeBlock("techmod:deepslate"), { action: "keep" });
            assert.deepEqual(normalizeBlock("techmod:tuff"), { action: "keep" });
        });

        it("removes every vanilla block with no authentic counterpart (inverse allowlist)", () => {
            assert.deepEqual(normalizeBlock("minecraft:bee_nest"), { action: "remove" });
            assert.deepEqual(normalizeBlock("minecraft:beehive"), { action: "remove" });
            assert.deepEqual(normalizeBlock("minecraft:stone_bricks"), { action: "remove" });
            assert.deepEqual(normalizeBlock("minecraft:sulfur_spike"), { action: "remove" });
        });
    });

    describe("Entity Drop Normalization", () => {
        it("converts raw ore item drops back to authentic mined ore blocks", () => {
            assert.deepEqual(normalizeEntityDrop("minecraft:raw_iron"), { action: "convert", targetId: "minecraft:iron_ore" });
            assert.deepEqual(normalizeEntityDrop("minecraft:raw_gold"), { action: "convert", targetId: "minecraft:gold_ore" });
            assert.deepEqual(normalizeEntityDrop("minecraft:raw_copper"), { action: "convert", targetId: "minecraft:iron_ore" });
        });

        it("removes post-Beta monster and animal drops", () => {
            assert.deepEqual(normalizeEntityDrop("minecraft:rotten_flesh"), { action: "remove" });
            assert.deepEqual(normalizeEntityDrop("minecraft:mutton"), { action: "remove" });
        });

        it("never rewrites drops owned by another addon", () => {
            assert.deepEqual(normalizeEntityDrop("gun:bullet"), { action: "keep" });
            assert.deepEqual(normalizeEntityDrop("techmod:raw_iron"), { action: "keep" });
            assert.deepEqual(normalizeEntityDrop("gun:rotten_flesh"), { action: "keep" });
        });
    });
});
