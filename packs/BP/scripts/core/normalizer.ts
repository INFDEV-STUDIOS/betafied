import { isBetaBlock, isBetaItem, isVanillaId } from "./betaRegistry.js";

export type NormalizationAction = "keep" | "convert" | "remove";

export interface NormalizationResult {
    readonly action: NormalizationAction;
    readonly targetId?: string;
}

const ORE_DROP_CONVERSIONS: Readonly<Record<string, string>> = Object.freeze({
    "minecraft:raw_iron": "minecraft:iron_ore",
    "minecraft:raw_gold": "minecraft:gold_ore",
    "minecraft:raw_copper": "minecraft:iron_ore"
});

const BANNED_DROPS = Object.freeze(new Set([
    "minecraft:rotten_flesh",
    "minecraft:ender_pearl",
    "minecraft:blaze_rod",
    "minecraft:ghast_tear",
    "minecraft:magma_cream",
    "minecraft:nether_star",
    "minecraft:spider_eye",
    "minecraft:fermented_spider_eye",
    "minecraft:phantom_membrane",
    "minecraft:rabbit_foot",
    "minecraft:rabbit_hide",
    "minecraft:mutton",
    "minecraft:cooked_mutton",
    "minecraft:rabbit",
    "minecraft:cooked_rabbit",
    "minecraft:rabbit_stew",
    "minecraft:prismarine_shard",
    "minecraft:prismarine_crystals",
    "minecraft:shulker_shell",
    "minecraft:dragon_breath",
    "minecraft:nautilus_shell",
    "minecraft:heart_of_the_sea",
    "minecraft:turtle_scute",
    "minecraft:armadillo_scute"
]));

export function normalizeEntityDrop(itemId: string): NormalizationResult {
    if (BANNED_DROPS.has(itemId)) {
        return { action: "remove" };
    }
    const oreReplacement = ORE_DROP_CONVERSIONS[itemId];
    if (oreReplacement) {
        return { action: "convert", targetId: oreReplacement };
    }
    if (isBetaItem(itemId)) {
        return { action: "keep" };
    }
    return normalizeItem(itemId);
}

function matchCopper(bareId: string): NormalizationResult | null {
    if (!bareId.includes("copper")) return null;
    if (bareId.includes("ore")) return { action: "convert", targetId: "minecraft:stone" };
    if (bareId.includes("stairs")) return { action: "convert", targetId: "minecraft:cobblestone_stairs" };
    if (bareId.includes("slab")) return { action: "convert", targetId: "minecraft:cobblestone_slab" };
    return { action: "convert", targetId: "minecraft:cobblestone" };
}

const NETHER_ORES: Readonly<Record<string, string>> = Object.freeze({
    "quartz_ore": "minecraft:netherrack",
    "nether_gold_ore": "minecraft:netherrack",
    "ancient_debris": "minecraft:netherrack"
});

function matchNetherOre(bareId: string): NormalizationResult | null {
    // Beta 1.7.3's Nether held no ores, but vanilla still hangs quartz, gold and debris off the
    // `nether` biome tag our single Nether biome carries, so they dissolve back into netherrack.
    const target = NETHER_ORES[bareId];
    return target === undefined ? null : { action: "convert", targetId: target };
}

const STONE_VARIANTS = new Set([
    "andesite", "granite", "diorite", "tuff", "calcite",
    "dripstone_block", "deepslate", "smooth_basalt"
]);

function matchStone(bareId: string): NormalizationResult | null {
    if (bareId.includes("cobbled_deepslate")) {
        return { action: "convert", targetId: "minecraft:cobblestone" };
    }
    if (STONE_VARIANTS.has(bareId) || bareId.endsWith("_deepslate_ore")) {
        return { action: "convert", targetId: "minecraft:stone" };
    }
    return null;
}

export function isStoneCompound(bareId: string): boolean {
    return bareId.includes("stone") || bareId.includes("cobble") || bareId.includes("deepslate") || bareId.includes("brick");
}

function matchWoodBuilding(bareId: string): NormalizationResult | null {
    if (bareId.endsWith("_planks")) return { action: "convert", targetId: "minecraft:oak_planks" };
    if (bareId.endsWith("_log") || bareId.endsWith("_stem") || bareId.endsWith("_wood") || bareId.includes("stripped_") || bareId === "wood" || bareId === "log" || bareId === "log2") {
        return { action: "convert", targetId: "minecraft:oak_log" };
    }
    if (bareId.endsWith("_fence") || bareId.endsWith("_fence_gate")) return { action: "convert", targetId: "bh:fence" };

    if (bareId.endsWith("_stairs")) {
        return { action: "convert", targetId: isStoneCompound(bareId) ? "minecraft:cobblestone_stairs" : "minecraft:oak_stairs" };
    }
    if (bareId.endsWith("_slab")) {
        return { action: "convert", targetId: isStoneCompound(bareId) ? "minecraft:cobblestone_slab" : "bh:wooden_slab" };
    }
    return null;
}

const SIMPLE_WOOD_ITEMS: Readonly<Record<string, string>> = Object.freeze({
    _leaves: "minecraft:oak_leaves",
    _door: "minecraft:wooden_door",
    _trapdoor: "minecraft:trapdoor",
    _sign: "minecraft:oak_sign",
    _boat: "minecraft:boat",
    _sapling: "minecraft:oak_sapling"
});

// Hoisted: `matchWoodItem` runs once per inventory slot per tick, and rebuilding this list with
// Object.entries on every call was the allocation the inventory sweep spent its time on.
const SIMPLE_WOOD_ENTRIES: readonly (readonly [string, string])[] = Object.freeze(
    Object.entries(SIMPLE_WOOD_ITEMS)
);

function matchWoodItem(bareId: string): NormalizationResult | null {
    for (const [suffix, target] of SIMPLE_WOOD_ENTRIES) {
        if (bareId.endsWith(suffix)) {
            return { action: "convert", targetId: target };
        }
    }
    return null;
}

export function normalizeItem(itemId: string): NormalizationResult {
    if (isBetaItem(itemId)) {
        return { action: "keep" };
    }

    if (!isVanillaId(itemId)) {
        return { action: "keep" };
    }

    const bareId = itemId.slice(10);

    return matchCopper(bareId)
        ?? matchStone(bareId)
        ?? matchNetherOre(bareId)
        ?? matchWoodBuilding(bareId)
        ?? matchWoodItem(bareId)
        ?? { action: "remove" };
}

export function normalizeBlock(blockId: string): NormalizationResult {
    if (isBetaBlock(blockId)) {
        return { action: "keep" };
    }
    return normalizeItem(blockId);
}

/**
 * Maps a vanilla placer item to the custom `bh:` item the inventory sweeper retypes it into.
 *
 * The sweep and the drop rewriter must agree on the final identifier: a drop left as the vanilla id
 * is a different item from the stack it is destined for, so the engine has no stack to merge a second
 * pickup into and the inventory fills with hand-stacked singles. Resolving through the same table on
 * both paths keeps the ground item and the inventory item identical, so the engine merges natively.
 */
export function resolvePlacerReplacement(id: string): string | undefined {
    if (!id.startsWith("minecraft:")) {
        return undefined;
    }

    const bareId = id.slice(10);

    if (bareId === "wood" || bareId === "log" || bareId === "log2") {
        return "bh:oak_log";
    }
    if (bareId.endsWith("_log") || bareId.endsWith("_wood") || bareId.endsWith("_stem") || bareId.endsWith("_hyphae") || bareId.startsWith("stripped_")) {
        if (bareId.includes("spruce")) return "bh:spruce_log";
        if (bareId.includes("birch")) return "bh:birch_log";
        return "bh:oak_log";
    }

    if (bareId === "chest") {
        // The Beta chest is the custom block: it wears the era's model and its halves pair through
        // script, so a vanilla chest in a hotbar would place a block that never pairs.
        return "bh:chest";
    }

    if (bareId.endsWith("_stairs")) {
        const prefix = bareId.replace(/_mosaic_stairs|_stairs/, "");
        const isWood = prefix === "oak" || prefix === "spruce" || prefix === "birch" ||
            prefix === "jungle" || prefix === "acacia" || prefix === "dark_oak" ||
            prefix === "mangrove" || prefix === "cherry" || prefix === "pale_oak" ||
            prefix === "bamboo" || prefix === "crimson" || prefix === "warped";
        return isWood ? "bh:oak_stairs" : "bh:cobblestone_stairs";
    }

    if (bareId.endsWith("_slab") || bareId.startsWith("stone_block_slab")) {
        if (bareId.includes("cobble")) {
            return "bh:cobblestone_slab";
        }
        if (bareId.includes("sandstone")) {
            return "bh:sandstone_slab";
        }
        if (isStoneCompound(bareId) || bareId.startsWith("stone_block_slab") || bareId === "stone_slab" || bareId === "smooth_stone_slab") {
            return "bh:stone_slab";
        }
        return "bh:wooden_slab";
    }

    return undefined;
}
