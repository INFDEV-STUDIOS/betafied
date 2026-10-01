/**
 * Compatibility Policy & Translation Registry for Betafied.
 *
 * Defines explicit transformation policies across subsystem boundaries:
 *
 * 1. World Block Scrubber (chunkScrubber.ts):
 *    - Replaces modern world generation blocks with authentic Beta 1.7.3 equivalents.
 *    - Intentional differences from inventory:
 *      * 'tuff' -> 'minecraft:gravel' (preserves cave wall noise and granular pocket feel).
 *      * 'raw_copper_block' -> 'minecraft:stone' (maintains solid subterranean rock rather than artificial cobblestone).
 *
 * 2. Player Inventory Manager (inventoryManager.ts):
 *    - Normalizes modern inventory items into playable Beta 1.7.3 equivalents.
 *    - 'tuff' item -> 'minecraft:stone' (provides standard building block for players).
 *    - 'raw_copper' / 'copper_ingot' -> 'minecraft:cobblestone'.
 *
 * 3. Entity Compatibility Policy (entitySpawnHandler.ts & entityCleaner.ts):
 *    - Replaces modern entity drops (e.g., raw ores to mined ore blocks).
 *    - Removes non-Beta 1.7.3 entities at spawn-time and during periodic radius cleanup.
 *
 * Namespace Scoping:
 *    - Every policy above targets `minecraft:` identifiers only. Content from other namespaces
 *      (`gun:1911`, `techmod:mob`) is intentionally unaware of Beta 1.7.3 and is never
 *      converted or removed, so third-party addons keep working alongside Betafied.
 */

import { isBetaEntity, isVanillaId } from "./betaRegistry.js";
import { normalizeEntityDrop } from "./normalizer.js";

export const ALLOWED_ENTITY_TYPES: Readonly<Set<string>> = Object.freeze(new Set([
    "minecraft:item",
    "minecraft:minecart",
    "minecraft:chest_minecart",
    "minecraft:painting",
    "ubd:furnace_minecart",
    "custom:furnace_minecart",
    "minecraft:boat",
    "minecraft:falling_block",
    "minecraft:arrow",
    "minecraft:chicken",
    "minecraft:cow",
    "minecraft:creeper",
    "minecraft:ghast",
    "minecraft:fireball",
    "minecraft:pig",
    "minecraft:tnt",
    "minecraft:player",
    "minecraft:sheep",
    "minecraft:skeleton",
    "minecraft:slime",
    "minecraft:spider",
    "minecraft:squid",
    "minecraft:wolf",
    "minecraft:zombie",
    "minecraft:zombie_pigman",
    "minecraft:zombified_piglin",
    "minecraft:lightning_bolt",
    "minecraft:snowball",
    "minecraft:egg",
    "minecraft:fishing_hook"
]));

export const BANNED_ITEM_DROP_IDS: Readonly<Set<string>> = Object.freeze(new Set([
    "minecraft:rotten_flesh"
]));

export function isAllowedEntityType(typeId: string): boolean {
    return !isVanillaId(typeId) || isBetaEntity(typeId);
}

export function isBannedItemDrop(itemId: string): boolean {
    const res = normalizeEntityDrop(itemId);
    return res.action === "remove";
}

export interface EntityCompatibilityAssessment {
    allowed: boolean;
    reason?: "disallowed_type" | "banned_item_drop";
}

export function assessEntityCompatibility(typeId: string, droppedItemTypeId?: string): EntityCompatibilityAssessment {
    if (isVanillaId(typeId) && !ALLOWED_ENTITY_TYPES.has(typeId)) {
        return { allowed: false, reason: "disallowed_type" };
    }
    if (typeId === "minecraft:item" && droppedItemTypeId && BANNED_ITEM_DROP_IDS.has(droppedItemTypeId)) {
        return { allowed: false, reason: "banned_item_drop" };
    }
    return { allowed: true };
}

export const ORE_ITEM_REPLACEMENTS: Readonly<Record<string, string>> = Object.freeze({
    "minecraft:raw_iron": "minecraft:iron_ore",
    "minecraft:raw_gold": "minecraft:gold_ore",
    "minecraft:raw_copper": "minecraft:iron_ore"
});

export const ITEM_CONVERSIONS: Readonly<Record<string, string>> = Object.freeze({
    "minecraft:andesite": "minecraft:stone",
    "minecraft:granite": "minecraft:stone",
    "minecraft:diorite": "minecraft:stone",
    "minecraft:tuff": "minecraft:stone",
    "minecraft:calcite": "minecraft:stone",
    "minecraft:dripstone_block": "minecraft:stone",
    "minecraft:deepslate": "minecraft:stone",
    "minecraft:smooth_basalt": "minecraft:stone",
    "minecraft:cobbled_deepslate": "minecraft:cobblestone",

    "minecraft:copper_ingot": "minecraft:cobblestone",
    "minecraft:raw_copper": "minecraft:cobblestone",
    "minecraft:copper_ore": "minecraft:stone",
    "minecraft:deepslate_copper_ore": "minecraft:stone",
    "minecraft:raw_copper_block": "minecraft:cobblestone",
    "minecraft:copper_block": "minecraft:cobblestone",
    "minecraft:cut_copper": "minecraft:cobblestone",
    "minecraft:exposed_copper": "minecraft:cobblestone",
    "minecraft:weathered_copper": "minecraft:cobblestone",
    "minecraft:oxidized_copper": "minecraft:cobblestone",
    "minecraft:waxed_copper_block": "minecraft:cobblestone",
    "minecraft:waxed_cut_copper": "minecraft:cobblestone",
    "minecraft:waxed_exposed_copper": "minecraft:cobblestone",
    "minecraft:waxed_weathered_copper": "minecraft:cobblestone",
    "minecraft:waxed_oxidized_copper": "minecraft:cobblestone",
    "minecraft:copper_stairs": "minecraft:cobblestone_stairs",
    "minecraft:copper_slab": "minecraft:cobblestone_slab",

    "minecraft:mangrove_log": "minecraft:oak_log",
    "minecraft:cherry_log": "minecraft:oak_log",
    "minecraft:bamboo_block": "minecraft:oak_log",
    "minecraft:crimson_stem": "minecraft:oak_log",
    "minecraft:warped_stem": "minecraft:oak_log",
    "minecraft:pale_oak_log": "minecraft:oak_log",
    "minecraft:stripped_cherry_log": "minecraft:oak_log",
    "minecraft:stripped_mangrove_log": "minecraft:oak_log",
    "minecraft:stripped_bamboo_block": "minecraft:oak_log",

    "minecraft:mangrove_planks": "minecraft:oak_planks",
    "minecraft:cherry_planks": "minecraft:oak_planks",
    "minecraft:bamboo_planks": "minecraft:oak_planks",
    "minecraft:crimson_planks": "minecraft:oak_planks",
    "minecraft:warped_planks": "minecraft:oak_planks",
    "minecraft:pale_oak_planks": "minecraft:oak_planks",

    "minecraft:mangrove_stairs": "minecraft:oak_stairs",
    "minecraft:cherry_stairs": "minecraft:oak_stairs",
    "minecraft:bamboo_stairs": "minecraft:oak_stairs",
    "minecraft:crimson_stairs": "minecraft:oak_stairs",
    "minecraft:warped_stairs": "minecraft:oak_stairs",
    "minecraft:pale_oak_stairs": "minecraft:oak_stairs",

    "minecraft:mangrove_door": "minecraft:wooden_door",
    "minecraft:cherry_door": "minecraft:wooden_door",
    "minecraft:bamboo_door": "minecraft:wooden_door",
    "minecraft:crimson_door": "minecraft:wooden_door",
    "minecraft:warped_door": "minecraft:wooden_door",
    "minecraft:pale_oak_door": "minecraft:wooden_door",

    "minecraft:mangrove_trapdoor": "minecraft:trapdoor",
    "minecraft:cherry_trapdoor": "minecraft:trapdoor",
    "minecraft:bamboo_trapdoor": "minecraft:trapdoor",
    "minecraft:crimson_trapdoor": "minecraft:trapdoor",
    "minecraft:warped_trapdoor": "minecraft:trapdoor",
    "minecraft:pale_oak_trapdoor": "minecraft:trapdoor",

    "minecraft:mangrove_sign": "minecraft:oak_sign",
    "minecraft:cherry_sign": "minecraft:oak_sign",
    "minecraft:bamboo_sign": "minecraft:oak_sign",
    "minecraft:crimson_sign": "minecraft:oak_sign",
    "minecraft:warped_sign": "minecraft:oak_sign",
    "minecraft:pale_oak_sign": "minecraft:oak_sign",

    "minecraft:oak_fence": "bh:fence",
    "minecraft:birch_fence": "bh:fence",
    "minecraft:spruce_fence": "bh:fence",
    "minecraft:jungle_fence": "bh:fence",
    "minecraft:acacia_fence": "bh:fence",
    "minecraft:dark_oak_fence": "bh:fence",
    "minecraft:cherry_fence": "bh:fence",
    "minecraft:mangrove_fence": "bh:fence",
    "minecraft:bamboo_fence": "bh:fence",
    "minecraft:crimson_fence": "bh:fence",
    "minecraft:warped_fence": "bh:fence",
    "minecraft:nether_brick_fence": "bh:fence",
    "minecraft:pale_oak_fence": "bh:fence",

    "minecraft:oak_slab": "bh:wooden_slab",
    "minecraft:birch_slab": "bh:wooden_slab",
    "minecraft:spruce_slab": "bh:wooden_slab",
    "minecraft:jungle_slab": "bh:wooden_slab",
    "minecraft:acacia_slab": "bh:wooden_slab",
    "minecraft:dark_oak_slab": "bh:wooden_slab",
    "minecraft:cherry_slab": "bh:wooden_slab",
    "minecraft:mangrove_slab": "bh:wooden_slab",
    "minecraft:bamboo_slab": "bh:wooden_slab",
    "minecraft:crimson_slab": "bh:wooden_slab",
    "minecraft:warped_slab": "bh:wooden_slab",
    "minecraft:pale_oak_slab": "bh:wooden_slab",

    "minecraft:birch_boat": "minecraft:oak_boat",
    "minecraft:spruce_boat": "minecraft:oak_boat",
    "minecraft:jungle_boat": "minecraft:oak_boat",
    "minecraft:acacia_boat": "minecraft:oak_boat",
    "minecraft:dark_oak_boat": "minecraft:oak_boat",
    "minecraft:cherry_boat": "minecraft:oak_boat",
    "minecraft:mangrove_boat": "minecraft:oak_boat",
    "minecraft:bamboo_raft": "minecraft:oak_boat",
    "minecraft:pale_oak_boat": "minecraft:oak_boat",

    "minecraft:mud": "minecraft:dirt",
    "minecraft:muddy_mangrove_roots": "minecraft:dirt",
    "minecraft:suspicious_sand": "minecraft:sand",
    "minecraft:suspicious_gravel": "minecraft:gravel",

    "minecraft:cornflower": "minecraft:poppy",
    "minecraft:lily_of_the_valley": "minecraft:poppy",
    "minecraft:blue_orchid": "minecraft:poppy",
    "minecraft:allium": "minecraft:poppy",
    "minecraft:azure_bluet": "minecraft:poppy",
    "minecraft:red_tulip": "minecraft:poppy",
    "minecraft:orange_tulip": "minecraft:poppy",
    "minecraft:white_tulip": "minecraft:poppy",
    "minecraft:pink_tulip": "minecraft:poppy",
    "minecraft:oxeye_daisy": "minecraft:poppy",
    "minecraft:wither_rose": "minecraft:poppy",
    "minecraft:peony": "minecraft:poppy",
    "minecraft:rose_bush": "minecraft:poppy",
    "minecraft:lilac": "minecraft:poppy",
    "minecraft:sunflower": "minecraft:poppy",
    "minecraft:pink_petals": "minecraft:poppy",
    "minecraft:torchflower": "minecraft:poppy",
    "minecraft:pitcher_plant": "minecraft:poppy",

    "minecraft:rotten_flesh": "minecraft:feather",

    "minecraft:bow": "bh:bow",
    "minecraft:crafting_table": "bh:crafting_table",

    "minecraft:white_dye": "minecraft:bone_meal",
    "minecraft:black_dye": "minecraft:ink_sac",
    "minecraft:blue_dye": "minecraft:lapis_lazuli",
    "minecraft:brown_dye": "minecraft:cocoa_beans",

    "minecraft:stone_bricks": "minecraft:stone",
    "minecraft:mossy_stone_bricks": "minecraft:mossy_cobblestone",
    "minecraft:cracked_stone_bricks": "minecraft:cobblestone",
    "minecraft:chiseled_stone_bricks": "minecraft:stone",

    "minecraft:terracotta": "minecraft:clay",
    "minecraft:white_terracotta": "minecraft:clay",
    "minecraft:orange_terracotta": "minecraft:clay",
    "minecraft:magenta_terracotta": "minecraft:clay",
    "minecraft:light_blue_terracotta": "minecraft:clay",
    "minecraft:yellow_terracotta": "minecraft:clay",
    "minecraft:lime_terracotta": "minecraft:clay",
    "minecraft:pink_terracotta": "minecraft:clay",
    "minecraft:gray_terracotta": "minecraft:clay",
    "minecraft:light_gray_terracotta": "minecraft:clay",
    "minecraft:cyan_terracotta": "minecraft:clay",
    "minecraft:purple_terracotta": "minecraft:clay",
    "minecraft:blue_terracotta": "minecraft:clay",
    "minecraft:brown_terracotta": "minecraft:clay",
    "minecraft:green_terracotta": "minecraft:clay",
    "minecraft:red_terracotta": "minecraft:clay",
    "minecraft:black_terracotta": "minecraft:clay",

    "minecraft:packed_ice": "minecraft:ice",
    "minecraft:blue_ice": "minecraft:ice"
});

export const BLOCK_BULK_REPLACEMENTS: readonly [string, string][] = [
    ["minecraft:deepslate", "minecraft:stone"],
    ["minecraft:tuff", "minecraft:gravel"],
    ["minecraft:cobbled_deepslate", "minecraft:cobblestone"],
    ["minecraft:andesite", "minecraft:stone"],
    ["minecraft:diorite", "minecraft:stone"],
    ["minecraft:granite", "minecraft:stone"],
    ["minecraft:smooth_basalt", "minecraft:stone"],
    ["minecraft:calcite", "minecraft:stone"],
    ["minecraft:amethyst_block", "minecraft:stone"],
    ["minecraft:budding_amethyst", "minecraft:stone"],
    ["minecraft:dripstone_block", "minecraft:stone"],
    ["minecraft:reinforced_deepslate", "minecraft:bedrock"],

    ["minecraft:deepslate_iron_ore", "minecraft:iron_ore"],
    ["minecraft:deepslate_gold_ore", "minecraft:gold_ore"],
    ["minecraft:deepslate_copper_ore", "minecraft:stone"],
    ["minecraft:copper_ore", "minecraft:stone"],
    ["minecraft:raw_copper_block", "minecraft:stone"],
    ["minecraft:deepslate_coal_ore", "minecraft:coal_ore"],
    ["minecraft:deepslate_redstone_ore", "minecraft:redstone_ore"],
    ["minecraft:deepslate_lapis_ore", "minecraft:lapis_ore"],
    ["minecraft:deepslate_diamond_ore", "minecraft:diamond_ore"],
    ["minecraft:deepslate_emerald_ore", "minecraft:emerald_ore"],

    ["minecraft:mud", "minecraft:gravel"],
    ["minecraft:packed_mud", "minecraft:gravel"],
    ["minecraft:muddy_mangrove_roots", "minecraft:gravel"],
    ["minecraft:powder_snow", "minecraft:snow"],
    ["minecraft:rooted_dirt", "minecraft:dirt"],
    ["minecraft:coarse_dirt", "minecraft:dirt"],
    ["minecraft:red_sand", "minecraft:sand"],
    ["minecraft:suspicious_sand", "minecraft:sand"],
    ["minecraft:suspicious_gravel", "minecraft:gravel"],

    ["minecraft:hardened_clay", "minecraft:sandstone"],
    ["minecraft:stained_hardened_clay", "minecraft:sandstone"],
    ["minecraft:terracotta", "minecraft:sandstone"],
    ["minecraft:red_terracotta", "minecraft:sandstone"],
    ["minecraft:orange_terracotta", "minecraft:sandstone"],
    ["minecraft:yellow_terracotta", "minecraft:sandstone"],
    ["minecraft:brown_terracotta", "minecraft:sandstone"],
    ["minecraft:white_terracotta", "minecraft:sandstone"],
    ["minecraft:light_gray_terracotta", "minecraft:sandstone"],
    ["minecraft:gray_terracotta", "minecraft:sandstone"],
    ["minecraft:black_terracotta", "minecraft:sandstone"],
    ["minecraft:light_blue_terracotta", "minecraft:sandstone"],
    ["minecraft:cyan_terracotta", "minecraft:sandstone"],
    ["minecraft:blue_terracotta", "minecraft:sandstone"],
    ["minecraft:purple_terracotta", "minecraft:sandstone"],
    ["minecraft:magenta_terracotta", "minecraft:sandstone"],
    ["minecraft:pink_terracotta", "minecraft:sandstone"],
    ["minecraft:lime_terracotta", "minecraft:sandstone"],
    ["minecraft:green_terracotta", "minecraft:sandstone"],
    ["minecraft:red_sandstone", "minecraft:sandstone"],

    // Beta 1.7.3's Nether held no ores, but vanilla ties quartz, gold and debris to the `nether`
    // biome tag our single Nether biome carries, so the scrubber refills them with netherrack.
    ["minecraft:quartz_ore", "minecraft:netherrack"],
    ["minecraft:nether_gold_ore", "minecraft:netherrack"],
    ["minecraft:ancient_debris", "minecraft:netherrack"],

    // Magma is drawn by the engine, not the biome, so it survives our Nether override as the rim of
    // every lava sea. Beta 1.7.3 had gravel beaches there instead, and magma's own scrub rule would
    // otherwise erase that rim to air and leave the coast punched full of holes.
    ["minecraft:magma", "minecraft:gravel"],

    ["minecraft:packed_ice", "minecraft:ice"],
    ["minecraft:blue_ice", "minecraft:ice"],
    ["minecraft:prismarine", "minecraft:stone"],
    ["minecraft:dark_prismarine", "minecraft:stone"],
    ["minecraft:sea_lantern", "minecraft:glowstone"],
    ["minecraft:melon_block", "minecraft:air"],

    ["minecraft:mangrove_planks", "minecraft:planks"],
    ["minecraft:cherry_planks", "minecraft:planks"],
    ["minecraft:bamboo_planks", "minecraft:planks"],
    ["minecraft:crimson_planks", "minecraft:planks"],
    ["minecraft:warped_planks", "minecraft:planks"],
    ["minecraft:pale_oak_planks", "minecraft:planks"]
];

export const BLOCK_FINE_REPLACEMENTS: Readonly<Record<string, string>> = {
    "minecraft:tall_grass": "minecraft:air",
    "minecraft:seagrass": "minecraft:water",
    "minecraft:kelp": "minecraft:water",
    "minecraft:amethyst_cluster": "minecraft:air",
    "minecraft:glow_lichen": "minecraft:air",
    "minecraft:sculk": "minecraft:stone",
    "minecraft:sculk_vein": "minecraft:air",
    "minecraft:sculk_catalyst": "minecraft:stone",
    "minecraft:sculk_shrieker": "minecraft:stone",
    "minecraft:sculk_sensor": "minecraft:stone",
    "minecraft:calibrated_sculk_sensor": "minecraft:stone",
    "minecraft:moss_block": "minecraft:stone",
    "minecraft:moss_carpet": "minecraft:air",
    "minecraft:spore_blossom": "minecraft:air",
    "minecraft:azalea": "minecraft:air",
    "minecraft:flowering_azalea": "minecraft:air",
    "minecraft:mangrove_roots": "minecraft:gravel",

    // Full cubes that Beta has no counterpart for still have to land on a real block. Leaving them
    // to the normalizer deletes them to air, which reads as a hole punched through the terrain.
    "minecraft:beacon": "minecraft:obsidian",
    "minecraft:respawn_anchor": "minecraft:obsidian",
    "minecraft:conduit": "minecraft:stone",
    "minecraft:stonecutter_block": "minecraft:stone",
    // Ocean monuments are gone, but their blocks still arrive in creative-built worlds. These two
    // are repeated from the bulk table on purpose: the fine pass is the backstop when a bulk fill
    // cannot run (unloaded chunk), and a backstop that deletes the block would leave the hole.
    "minecraft:prismarine": "minecraft:stone",
    "minecraft:sea_lantern": "minecraft:glowstone",
    "minecraft:bamboo": "minecraft:air",
    "minecraft:sweet_berry_bush": "minecraft:air",
    "minecraft:large_fern": "minecraft:air",
    "minecraft:vine": "minecraft:air",
    "minecraft:cave_vines": "minecraft:air",
    "minecraft:cave_vines_body": "minecraft:air",
    "minecraft:cave_vines_body_with_berries": "minecraft:air",
    "minecraft:cave_vines_head": "minecraft:air",
    "minecraft:cave_vines_head_with_berries": "minecraft:air",
    "minecraft:big_dripleaf": "minecraft:air",
    "minecraft:small_dripleaf_block": "minecraft:air",
    "minecraft:mangrove_propagule": "minecraft:air",
    "minecraft:cherry_sapling": "minecraft:air",
    "minecraft:azalea_leaves": "minecraft:leaves",
    "minecraft:azalea_leaves_flowered": "minecraft:leaves",
    "minecraft:pitcher_crop": "minecraft:air",
    "minecraft:torchflower_crop": "minecraft:air",
    "minecraft:pink_petals": "minecraft:air",
    "minecraft:leaf_litter": "minecraft:air",
    "minecraft:oak_leaf_litter": "minecraft:air",
    "minecraft:spruce_leaf_litter": "minecraft:air",
    "minecraft:birch_leaf_litter": "minecraft:air",
    "minecraft:jungle_leaf_litter": "minecraft:air",
    "minecraft:cherry_leaf_litter": "minecraft:air",
    "minecraft:pale_oak_leaf_litter": "minecraft:air",
    "minecraft:dark_oak_leaf_litter": "minecraft:air",
    "minecraft:infested_deepslate": "minecraft:stone",
    "minecraft:infested_stone": "minecraft:stone",
    "minecraft:brain_coral": "minecraft:water",
    "minecraft:bubble_coral": "minecraft:water",
    "minecraft:fire_coral": "minecraft:water",
    "minecraft:horn_coral": "minecraft:water",
    "minecraft:tube_coral": "minecraft:water",
    "minecraft:brain_coral_fan": "minecraft:water",
    "minecraft:bubble_coral_fan": "minecraft:water",
    "minecraft:fire_coral_fan": "minecraft:water",
    "minecraft:horn_coral_fan": "minecraft:water",
    "minecraft:tube_coral_fan": "minecraft:water",
    "minecraft:bee_nest": "minecraft:air",
    "minecraft:beehive": "minecraft:air"
};
