/**
 * World Block Replacement Policy
 *
 * This module answers exactly one question: which Beta 1.7.3 block does a modern block become in the
 * world? It is the world scrubber's table and nothing else.
 *
 * Ownership boundaries, so each Beta rule lives in one place:
 *   - `betaRegistry.ts` owns the Beta universe (what is authentic) and the namespace predicates.
 *   - `normalizer.ts` owns item and drop normalization, including the placer/food retyping that has
 *     to agree with it so a ground item merges into the stack the inventory sweeps it into.
 *   - here owns world-block replacement only.
 *
 * The tables below deliberately disagree with the inventory outcome in places: `tuff` becomes gravel
 * in terrain (it is the cave-wall noise Beta relied on) but stone in a hotbar, and `raw_copper_block`
 * stays solid stone underground but becomes cobblestone as an item. Those splits are intentional and
 * are asserted against `normalizeItem` in `tests/policy/compatibilityPolicy.test.ts`.
 */

import type { Entity } from "@minecraft/server";
import { isBetaEntity, isVanillaId, TERRAIN_PLANK_SPECIES } from "./betaRegistry.js";
import { normalizeEntityDrop } from "./normalizer.js";

// NOTE: this file used to also carry its own entity allowlist, banned-drop set, ore table and item
// conversion table. Each duplicated a table in `betaRegistry.ts` or `normalizer.ts` and had drifted
// from it, so the duplicate that the tests exercised was not the one the game used.

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
    // Delegates rather than restating the rules. The previous private copies had an entity list
    // missing oak_boat and a banned set holding only rotten_flesh, so this agreed with the spawn
    // handler on nothing but the common case.
    if (!isAllowedEntityType(typeId)) {
        return { allowed: false, reason: "disallowed_type" };
    }
    if (typeId === "minecraft:item" && droppedItemTypeId !== undefined && isBannedItemDrop(droppedItemTypeId)) {
        return { allowed: false, reason: "banned_item_drop" };
    }
    return { allowed: true };
}

/**
 * Tags by which another addon declares an entity it owns.
 *
 * A decor entity defeats the namespace rule: far.land's item display is a `minecraft:item` holding
 * whatever the player spent on it, so `isVanillaId` is true and the drop gate rewrites or deletes it —
 * the item is gone from the player's hand with nothing drawn in its place. The tag is the only thing
 * that can tell the gate this item is not a drop. Doing so cannot break the rule that a ground item
 * match the stack the inventory sweep keeps, because a display is never picked up: far.land cancels
 * the pickup.
 */
export const FOREIGN_OWNED_TAGS: readonly string[] = Object.freeze([
    "far:item_display",
    "far:shop_display"
]);

/** Whether another addon owns this entity, and every destructive gate must leave it as shipped. */
export function isForeignOwnedEntity(entity: Entity): boolean {
    for (const tag of FOREIGN_OWNED_TAGS) {
        if (entity.hasTag(tag)) return true;
    }
    return false;
}

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
    // Beta had neither copper nor emerald (emeralds arrived in 1.3), but both still generate on
    // modern terrain. They dissolve into the stone they replaced rather than into air: the ore was
    // carried by the rock, so deleting it would punch an ore-shaped hole in ground the player can see.
    ["minecraft:deepslate_copper_ore", "minecraft:stone"],
    ["minecraft:copper_ore", "minecraft:stone"],
    ["minecraft:raw_copper_block", "minecraft:stone"],
    ["minecraft:emerald_ore", "minecraft:stone"],
    ["minecraft:deepslate_emerald_ore", "minecraft:stone"],
    ["minecraft:deepslate_coal_ore", "minecraft:coal_ore"],
    ["minecraft:deepslate_redstone_ore", "minecraft:redstone_ore"],
    ["minecraft:deepslate_lapis_ore", "minecraft:lapis_ore"],
    ["minecraft:deepslate_diamond_ore", "minecraft:diamond_ore"],

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

    // The post-Beta species whose planks still generate as terrain come from one owner
    // (`TERRAIN_PLANK_SPECIES`) rather than being re-listed here, so the terrain and inventory tables
    // cannot enumerate the same species names and drift apart.
    ...TERRAIN_PLANK_SPECIES.map((species): [string, string] => [`minecraft:${species}_planks`, "minecraft:planks"])
];

/**
 * The two-block grasses Beta never knew. The modern bone-meal spread plants these beside the
 * single-block grass, so the interaction sweep and the scrubber refer to the same list.
 */
export const POST_BETA_TALL_PLANTS: readonly string[] = Object.freeze([
    "minecraft:tall_grass",
    "minecraft:large_fern"
]);

export const BLOCK_FINE_REPLACEMENTS: Readonly<Record<string, string>> = {
    ...Object.fromEntries(POST_BETA_TALL_PLANTS.map((id): [string, string] => [id, "minecraft:air"])),
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

    // Modern flowers and tall plants Beta never had. They are listed here so the scrubber resolves
    // them through its target table (see the combined probe list in chunkScrubber) instead of relying
    // on the fine pass's reverse-allowlist volume query to hand each one back.
    "minecraft:lilac": "minecraft:air",
    "minecraft:peony": "minecraft:air",
    "minecraft:rose_bush": "minecraft:air",
    "minecraft:sunflower": "minecraft:air",
    "minecraft:cornflower": "minecraft:air",
    "minecraft:lily_of_the_valley": "minecraft:air",
    "minecraft:azure_bluet": "minecraft:air",
    "minecraft:oxeye_daisy": "minecraft:air",
    "minecraft:allium": "minecraft:air",
    "minecraft:blue_orchid": "minecraft:air",
    "minecraft:pitcher_plant": "minecraft:air",
    "minecraft:torchflower": "minecraft:air",
    "minecraft:hanging_roots": "minecraft:air",

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
