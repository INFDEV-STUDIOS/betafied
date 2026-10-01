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
import { normalizeItem, resolvePlacerReplacement } from "./normalizer.js";
import { tickManager } from "./tickManager.js";
import { eventBus } from "./eventBus.js";

const CONFIG = Object.freeze({
    CHECK_INTERVAL: 1,
    // The engine announces an inventory change, so the sweep no longer has to assume every player's
    // inventory moved on every tick. These two intervals are the safety nets behind that signal: the
    // item-change event reports the main inventory and hotbar but not the equipment slots, and neither
    // net has to be fast because it only backstops a signal that already fired immediately.
    EQUIPMENT_SWEEP_INTERVAL: 5,
    FULL_SWEEP_INTERVAL: 20,
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
        // `size` is a live native getter, and this sweep runs for every player every tick; reading
        // it per iteration made the loop condition itself a native call.
        const size = inv.size;
        for (let i = 0; i < size; i++) {
            const item = inv.getItem(i);
            if (!item) continue;

            const targetId = resolvePlacerReplacement(item.typeId);
            if (targetId) {
                inv.setItem(i, new ItemStack(targetId, item.amount));
            }
        }
    }

    processExemptEquipment(player);
}

/**
 * The exempt half of the equipment sweep, split out so it can be polled on its own cadence: the
 * item-change event never reports the equipment slots, so they still need a tick-based poll while the
 * main inventory does not.
 */
export function processExemptEquipment(player: Player): void {
    const equippable = player.getComponent(EntityComponentTypes.Equippable);
    if (!equippable) return;

    for (const slot of EQUIPMENT_SLOTS) {
        const item = equippable.getEquipment(slot);
        if (!item) continue;

        const targetId = resolvePlacerReplacement(item.typeId);
        if (targetId) {
            equippable.setEquipment(slot, new ItemStack(targetId, item.amount));
        }
    }
}

// Players whose inventory the engine reported as changed since the last sweep. Reading all 36 slots of
// every player on every tick was the single largest cost in the server tick profile once the chunk
// scrubber was fixed; the engine already knows when an inventory moves, so the sweep rides that.
const dirtyInventories = new Set<string>();

export function markInventoryDirty(playerId: string): void {
    dirtyInventories.add(playerId);
}

export function processPlayers(): void {
    const tick = system.currentTick;
    const fullSweep = tick % CONFIG.FULL_SWEEP_INTERVAL === 0;
    const equipmentSweep = tick % CONFIG.EQUIPMENT_SWEEP_INTERVAL === 0;

    // Enumerating players and reading each gamemode is itself native work, so an idle tick - nothing
    // reported dirty and no cadence due - returns before either call, rather than running them only
    // to find no inventory to look at.
    if (!fullSweep && !equipmentSweep && dirtyInventories.size === 0) return;

    for (const player of world.getAllPlayers()) {
        if (!player.isValid) continue;

        try {
            const isExempt = isInventoryExempt(player);
            const wasExempt = previousExemptionState.get(player.id) ?? false;
            const exemptionFlipped = isExempt !== wasExempt;

            previousExemptionState.set(player.id, isExempt);

            // A full sweep already covers the equipment slots, so it subsumes the equipment cadence.
            const dirty = dirtyInventories.delete(player.id);
            const sweepAll = dirty || exemptionFlipped || fullSweep;

            if (isExempt) {
                if (sweepAll) processExemptInventory(player);
                else if (equipmentSweep) processExemptEquipment(player);
                continue;
            }

            if (wasExempt) {
                msgCooldowns.delete(player.id);
            }

            if (sweepAll) processInventory(player);
            else if (equipmentSweep) processEquipment(player);
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
    const size = inv.size;
    for (let s = 0; s < size && remaining > 0; s++) {
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
        const size = inv.size;
        for (let i = 0; i < size; i++) {
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

    if (removed) notifyPlayer(player, CONFIG.REMOVE_MSG);
    if (stripped) notifyPlayer(player, CONFIG.ENCHANT_MSG);

    // Notified after the inventory half on purpose: the message cooldown is per player, so running
    // this second keeps the inventory's message the one that reaches the player when both halves trip.
    processEquipment(player);
}

/**
 * The strict half of the equipment sweep, split out so the equipment slots can be polled on their own
 * cadence while the main inventory rides the item-change event.
 */
export function processEquipment(player: Player): void {
    let removed = false;
    let stripped = false;

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

eventBus.onPlayerInventoryItemChange((ev) => {
    if (ev.player?.isValid) {
        markInventoryDirty(ev.player.id);
    }
});

eventBus.onPlayerGameModeChange((ev) => {
    if (!ev.player?.isValid) return;
    markInventoryDirty(ev.player.id);
    if (!isInventoryExempt(ev.player)) {
        msgCooldowns.delete(ev.player.id);
        previousExemptionState.set(ev.player.id, false);
        processInventory(ev.player);
    }
});

eventBus.onPlayerLeave((ev) => {
    msgCooldowns.delete(ev.playerId);
    previousExemptionState.delete(ev.playerId);
    dirtyInventories.delete(ev.playerId);
});
