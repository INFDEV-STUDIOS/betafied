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

const NETHER_KEYWORDS = ["nylium", "basalt", "blackstone", "wart_block", "shroomlight", "ancient_debris", "nether_gold_ore", "quartz_ore"];

function matchNether(bareId: string): NormalizationResult | null {
    if (bareId === "crying_obsidian") return { action: "convert", targetId: "minecraft:obsidian" };
    if (bareId === "soul_soil") return { action: "convert", targetId: "minecraft:soul_sand" };
    if (bareId === "magma_block" || NETHER_KEYWORDS.some(kw => bareId.includes(kw))) {
        return { action: "convert", targetId: "minecraft:netherrack" };
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

function matchWoodItem(bareId: string): NormalizationResult | null {
    for (const [suffix, target] of Object.entries(SIMPLE_WOOD_ITEMS)) {
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
        ?? matchNether(bareId)
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
