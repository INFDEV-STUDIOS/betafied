import {
    world,
    system,
    ItemStack,
    Player,
    Container,
    ItemComponentTypes,
    EntityComponentTypes,
    EquipmentSlot
} from "@minecraft/server";
import { isInventoryExempt } from "./permissions.js";
import { reportError } from "./errorReporter.js";
import { isBetaItem, isVanillaId } from "./betaRegistry.js";
import { normalizeItem, isStoneCompound } from "./normalizer.js";
import { tickManager } from "./tickManager.js";
import { eventBus } from "./eventBus.js";

const CONFIG = Object.freeze({
    CHECK_INTERVAL: 1,
    MESSAGE_COOLDOWN: 60,
    REMOVE_MSG: "§c[Betafied] §7That item doesn't exist in Beta 1.7.3!",
    ENCHANT_MSG: "§c[Betafied] §7Enchantments removed! Beta 1.7.3 had no enchanting."
});

const FOOD_CONVERSIONS: Readonly<Record<string, string>> = Object.freeze({
    "minecraft:apple": "bh:apple",
    "minecraft:bread": "bh:bread",
    "minecraft:porkchop": "bh:porkchop",
    "minecraft:cooked_porkchop": "bh:cooked_porkchop",
    "minecraft:cod": "bh:cod",
    "minecraft:cooked_cod": "bh:cooked_cod",
    "minecraft:golden_apple": "bh:golden_apple",
    "minecraft:cookie": "bh:cookie",
    "minecraft:salmon": "bh:cod",
    "minecraft:cooked_salmon": "bh:cooked_cod"
});

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

const UNSTACKABLE_UTILITIES: Readonly<Set<string>> = Object.freeze(new Set([
    "minecraft:wooden_door",
    "minecraft:iron_door",
    "minecraft:oak_sign",
    "minecraft:bucket"
]));

const msgCooldowns = new Map<string, number>();
const previousExemptionState = new Map<string, boolean>();

const EQUIPMENT_SLOTS: readonly EquipmentSlot[] = Object.freeze([
    EquipmentSlot.Head,
    EquipmentSlot.Chest,
    EquipmentSlot.Legs,
    EquipmentSlot.Feet,
    EquipmentSlot.Offhand
]);

export function processExemptInventory(player: Player): void {
    const invComp = player.getComponent(EntityComponentTypes.Inventory);
    const inv = invComp?.container;
    if (inv) {
        for (let i = 0; i < inv.size; i++) {
            const item = inv.getItem(i);
            if (!item) continue;

            const targetId = resolvePlacerReplacement(item.typeId);
            if (targetId) {
                inv.setItem(i, new ItemStack(targetId, item.amount));
            }
        }
    }

    const equippable = player.getComponent(EntityComponentTypes.Equippable);
    if (equippable) {
        for (const slot of EQUIPMENT_SLOTS) {
            const item = equippable.getEquipment(slot);
            if (!item) continue;

            const targetId = resolvePlacerReplacement(item.typeId);
            if (targetId) {
                equippable.setEquipment(slot, new ItemStack(targetId, item.amount));
            }
        }
    }
}

export function processPlayers(): void {
    const players = world.getAllPlayers();

    for (const player of players) {
        if (!player.isValid) continue;

        try {
            const isExempt = isInventoryExempt(player);
            const wasExempt = previousExemptionState.get(player.id) ?? false;

            if (isExempt) {
                previousExemptionState.set(player.id, true);
                processExemptInventory(player);
                continue;
            }

            previousExemptionState.set(player.id, false);

            if (wasExempt) {
                msgCooldowns.delete(player.id);
            }

            processInventory(player);
        } catch (e) {
            reportError({
                system: "InventoryManager",
                operation: "processInventory",
                target: player.name
            }, e);
        }
    }
}

tickManager.register("inventoryManager", CONFIG.CHECK_INTERVAL, processPlayers, 0);

type ItemNormalizationAction =
    | { type: "keep" }
    | { type: "delete"; reason: "banned" | "unsupported" }
    | { type: "replace"; item: ItemStack }
    | { type: "unstack_food"; convertedId: string; totalAmount: number }
    | { type: "unstack_utility"; targetId: string; totalAmount: number }
    | { type: "strip_enchantments"; item: ItemStack };

function preserveDurability(sourceItem: ItemStack, targetItem: ItemStack): void {
    const oldDur = sourceItem.getComponent(ItemComponentTypes.Durability);
    const newDur = targetItem.getComponent(ItemComponentTypes.Durability);
    if (oldDur && newDur) {
        newDur.damage = oldDur.damage;
    }
}

export function evaluateItemAction(item: ItemStack): ItemNormalizationAction {
    const id = item.typeId;

    if (!isVanillaId(id)) {
        return { type: "keep" };
    }

    if (id === "minecraft:bow") {
        const replacement = new ItemStack("bh:bow", item.amount);
        preserveDurability(item, replacement);
        return { type: "replace", item: replacement };
    }

    const placerTarget = resolvePlacerReplacement(id);
    if (placerTarget) {
        return { type: "replace", item: new ItemStack(placerTarget, item.amount) };
    }

    if (FOOD_CONVERSIONS[id]) {
        return { type: "unstack_food", convertedId: FOOD_CONVERSIONS[id], totalAmount: item.amount };
    }

    if (UNSTACKABLE_UTILITIES.has(id) && item.amount > 1) {
        return { type: "unstack_utility", targetId: id, totalAmount: item.amount };
    }

    const norm = normalizeItem(id);
    if (norm.action === "remove") {
        return { type: "delete", reason: "banned" };
    }

    if (norm.action === "convert" && norm.targetId) {
        const replacement = new ItemStack(norm.targetId, item.amount);
        preserveDurability(item, replacement);
        return { type: "replace", item: replacement };
    }

    const enchantable = item.getComponent(ItemComponentTypes.Enchantable);
    if (enchantable && enchantable.getEnchantments().length > 0) {
        const cleanItem = new ItemStack(id, item.amount);
        preserveDurability(item, cleanItem);
        return { type: "strip_enchantments", item: cleanItem };
    }

    if (!isBetaItem(id)) {
        return { type: "delete", reason: "unsupported" };
    }

    return { type: "keep" };
}

function handleItemUnstacking(player: Player, inv: Container, slotIndex: number, targetId: string, amount: number): void {
    inv.setItem(slotIndex, new ItemStack(targetId, 1));
    if (amount <= 1) return;

    let remaining = amount - 1;
    for (let s = 0; s < inv.size && remaining > 0; s++) {
        if (!inv.getItem(s)) {
            inv.setItem(s, new ItemStack(targetId, 1));
            remaining--;
        }
    }

    if (remaining > 0) {
        player.dimension.spawnItem(new ItemStack(targetId, remaining), player.location);
    }
}

export function processInventory(player: Player): void {
    let removed = false;
    let stripped = false;

    const invComp = player.getComponent(EntityComponentTypes.Inventory);
    const inv = invComp?.container;
    if (inv) {
        for (let i = 0; i < inv.size; i++) {
            const item = inv.getItem(i);
            if (!item) continue;

            const action = evaluateItemAction(item);

            switch (action.type) {
                case "keep":
                    break;
                case "delete":
                    inv.setItem(i, undefined);
                    removed = true;
                    if (action.reason === "unsupported") {
                        console.log(`INV: Removed ${item.typeId} from ${player.name}`);
                    }
                    break;
                case "replace":
                    inv.setItem(i, action.item);
                    break;
                case "strip_enchantments":
                    inv.setItem(i, action.item);
                    stripped = true;
                    break;
                case "unstack_food":
                    handleItemUnstacking(player, inv, i, action.convertedId, action.totalAmount);
                    break;
                case "unstack_utility":
                    handleItemUnstacking(player, inv, i, action.targetId, action.totalAmount);
                    break;
                default:
                    break;
            }
        }
    }

    const equippable = player.getComponent(EntityComponentTypes.Equippable);
    if (equippable) {
        for (const slot of EQUIPMENT_SLOTS) {
            const item = equippable.getEquipment(slot);
            if (!item) continue;

            const action = evaluateItemAction(item);

            switch (action.type) {
                case "keep":
                    break;
                case "delete":
                    equippable.setEquipment(slot, undefined);
                    removed = true;
                    if (action.reason === "unsupported") {
                        console.log(`INV: Removed equipped ${item.typeId} from ${player.name}`);
                    }
                    break;
                case "replace":
                    equippable.setEquipment(slot, action.item);
                    break;
                case "strip_enchantments":
                    equippable.setEquipment(slot, action.item);
                    stripped = true;
                    break;
                case "unstack_food":
                case "unstack_utility":
                    equippable.setEquipment(slot, undefined);
                    removed = true;
                    break;
                default:
                    break;
            }
        }
    }

    if (removed) notifyPlayer(player, CONFIG.REMOVE_MSG);
    if (stripped) notifyPlayer(player, CONFIG.ENCHANT_MSG);
}

function notifyPlayer(player: Player, msg: string): void {
    const now = system.currentTick;
    const last = msgCooldowns.get(player.id) ?? 0;
    if (now - last >= CONFIG.MESSAGE_COOLDOWN) {
        player.sendMessage(msg);
        msgCooldowns.set(player.id, now);
    }
}

eventBus.onPlayerGameModeChange((ev) => {
    if (!ev.player?.isValid) return;
    if (!isInventoryExempt(ev.player)) {
        msgCooldowns.delete(ev.player.id);
        previousExemptionState.set(ev.player.id, false);
        processInventory(ev.player);
    }
});

eventBus.onPlayerLeave((ev) => {
    msgCooldowns.delete(ev.playerId);
    previousExemptionState.delete(ev.playerId);
});
