import { BH_BOW_ID, BH_CHEST_ID, BH_FENCE_ID, isBetaBlock, isBetaItem, isVanillaId, WOOD_SPECIES } from "./betaRegistry.js";

export type NormalizationAction = "keep" | "convert" | "remove";

export interface NormalizationResult {
    readonly action: NormalizationAction;
    readonly targetId?: string;
}

// Copper is deliberately absent: Beta had no copper at all, so a raw copper pickup falls through
// to `normalizeItem` and lands on cobblestone like every other copper item — one owner for both
// the ground and inventory paths.
const ORE_DROP_CONVERSIONS: Readonly<Record<string, string>> = Object.freeze({
    "minecraft:raw_iron": "minecraft:iron_ore",
    "minecraft:raw_gold": "minecraft:gold_ore"
});

export function normalizeEntityDrop(itemId: string): NormalizationResult {
    // No explicit banned set: `normalizeItem` already removes every vanilla id the registry does not
    // recognize, so a hand-maintained list of "bad" drops would only be a second owner of the same
    // fact and could drift from the allowlist it was meant to mirror.
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
    if (bareId.endsWith("_fence") || bareId.endsWith("_fence_gate")) return { action: "convert", targetId: BH_FENCE_ID };

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
        return BH_CHEST_ID;
    }

    if (bareId.endsWith("_fence") || bareId.endsWith("_fence_gate")) {
        // Beta had a single wooden fence and no gates. A vanilla fence left in a hotbar places the
        // modern block, whose connection state nothing maintains and which never joins the pack's
        // bh:fence, so every species collapses onto bh:fence instead of converting a tick later.
        return BH_FENCE_ID;
    }

    if (bareId.endsWith("_stairs")) {
        const prefix = bareId.replace(/_mosaic_stairs|_stairs/, "");
        return WOOD_SPECIES.has(prefix) ? "bh:oak_stairs" : "bh:cobblestone_stairs";
    }

    if (bareId.endsWith("_slab")) {
        if (bareId.includes("cobble")) return "bh:cobblestone_slab";
        if (bareId.includes("sandstone")) return "bh:sandstone_slab";
        return isStoneCompound(bareId) ? "bh:stone_slab" : "bh:wooden_slab";
    }

    return undefined;
}

/**
 * Vanilla foods the inventory sweep retypes into the custom `bh:` items that carry Beta's
 * instant-consumption behaviour. Mirrored on the drop path so a dropped porkchop is already the
 * item it will merge into, rather than a vanilla stack the engine can never combine with the bh one.
 */
export const FOOD_CONVERSIONS: Readonly<Record<string, string>> = Object.freeze({
    "minecraft:apple": "bh:apple",
    "minecraft:bread": "bh:bread",
    "minecraft:porkchop": "bh:porkchop",
    "minecraft:cooked_porkchop": "bh:cooked_porkchop",
    "minecraft:cod": "bh:cod",
    "minecraft:cooked_cod": "bh:cooked_cod",
    "minecraft:golden_apple": "bh:golden_apple",
    "minecraft:cookie": "bh:cookie",
    "minecraft:salmon": "bh:cod",
    "minecraft:cooked_salmon": "bh:cooked_cod",
    // Bedrock's fishing tables name the raw/cooked fish items as `fish`/`cooked_fish`; the registry
    // and this table both accept them so a caught fish lands on the bh: item the sweep keeps.
    "minecraft:fish": "bh:cod",
    "minecraft:cooked_fish": "bh:cooked_cod"
});

/**
 * The identifier the inventory sweep leaves an item as when it is picked up, or `undefined` when
 * the sweep does not retype it.
 *
 * The sweep and the drop rewriter must agree on the final identifier: a ground item left as the
 * vanilla id is a different item from the stack it is destined for, so the engine has no stack to
 * merge a second pickup into and the inventory fills with hand-stacked singles. `resolvePlacerReplacement`
 * covers the placed blocks; the bow and the foods are retyped outside it, and this is the one place
 * both paths resolve them.
 */
export function resolveHeldItemReplacement(id: string): string | undefined {
    if (id === "minecraft:bow") {
        return BH_BOW_ID;
    }
    return resolvePlacerReplacement(id) ?? FOOD_CONVERSIONS[id];
}

/**
 * The identifier an item entity must carry once Betafied has normalized it, or `null` when the item
 * has no Beta 1.7.3 counterpart and must not sit on the ground at all.
 *
 * Both the spawn handler and the periodic cleaner resolve through this one function, so a ground
 * item is always the exact id the inventory sweep will merge it into.
 */
export function resolveDropId(itemId: string): string | null {
    const retyped = resolveHeldItemReplacement(itemId);
    if (retyped !== undefined) {
        return retyped;
    }

    const drop = normalizeEntityDrop(itemId);
    if (drop.action === "remove") {
        return null;
    }
    if (drop.action === "convert" && drop.targetId) {
        return drop.targetId;
    }
    return itemId;
}
