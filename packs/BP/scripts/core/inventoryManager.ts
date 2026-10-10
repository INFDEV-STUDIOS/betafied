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
import { BH_BOW_ID, isBetaItem, isModItem, isVanillaId } from "./betaRegistry.js";
import { ARMOR_SLOTS } from "./equipmentSlots.js";
import { normalizeItem, resolvePlacerReplacement, FOOD_CONVERSIONS } from "./normalizer.js";
import { tickManager } from "./tickManager.js";
import { eventBus } from "./eventBus.js";

const CONFIG = Object.freeze({
    CHECK_INTERVAL: 1,
    PLAYERS_PER_TICK: 2,
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

const UNSTACKABLE_UTILITIES: Readonly<Set<string>> = Object.freeze(new Set([
    "minecraft:wooden_door",
    "minecraft:iron_door",
    "minecraft:oak_sign",
    "minecraft:bucket",
    "minecraft:cake"
]));

const BH_FOOD_IDS: ReadonlySet<string> = Object.freeze(new Set(Object.values(FOOD_CONVERSIONS)));

function maxBetaStackSize(typeId: string): number {
    return typeId === "bh:cookie" || typeId === "minecraft:cookie" ? 8 : 1;
}

const msgCooldowns = new Map<string, number>();
const previousExemptionState = new Map<string, boolean>();

const EQUIPMENT_SLOTS: readonly EquipmentSlot[] = Object.freeze([
    ...ARMOR_SLOTS,
    EquipmentSlot.Offhand
]);

type SlotKey = number | EquipmentSlot;

/**
 * The inventory indexes its slots by number and the equipment by slot name, but the sweep does the same
 * work to either, so it is written once against this and the container is chosen once per player.
 */
interface SlotAccessor {
    readonly keys: readonly SlotKey[];
    readonly label: string;
    get(key: SlotKey): ItemStack | undefined;
    set(key: SlotKey, item: ItemStack | undefined): void;
    /** Only the inventory can split a stack; an equipped stack is cleared instead. */
    split?(key: SlotKey, targetId: string, amount: number): void;
}

function inventorySlots(player: Player): SlotAccessor | undefined {
    const container = player.getComponent(EntityComponentTypes.Inventory)?.container;
    if (!container) return undefined;

    // `size` is a live native getter, and this sweep runs for every player every tick; reading it per
    // iteration made the loop condition itself a native call.
    const keys = Array.from({ length: container.size }, (_, index) => index);

    return {
        keys,
        label: "INV: Removed",
        get: (key) => container.getItem(key as number),
        set: (key, item) => container.setItem(key as number, item),
        split: (key, targetId, amount) => handleItemUnstacking(player, container, key as number, targetId, amount)
    };
}

function equipmentSlots(player: Player): SlotAccessor | undefined {
    const equippable = player.getComponent(EntityComponentTypes.Equippable);
    if (!equippable) return undefined;

    return {
        keys: EQUIPMENT_SLOTS,
        label: "INV: Removed equipped",
        get: (key) => equippable.getEquipment(key as EquipmentSlot),
        set: (key, item) => equippable.setEquipment(key as EquipmentSlot, item)
    };
}

function sweepPlacers(accessor?: SlotAccessor): void {
    if (!accessor) return;

    for (const key of accessor.keys) {
        const item = accessor.get(key);
        if (!item) continue;

        const targetId = resolvePlacerReplacement(item.typeId);
        if (targetId) accessor.set(key, new ItemStack(targetId, item.amount));
    }
}

/**
 * The exempt half of the equipment sweep, split out so it can be polled on its own cadence: the
 * item-change event never reports the equipment slots, so they still need a tick-based poll while the
 * main inventory does not.
 */
export function processExemptInventory(player: Player): void {
    sweepPlacers(inventorySlots(player));
    processExemptEquipment(player);
}

export function processExemptEquipment(player: Player): void {
    sweepPlacers(equipmentSlots(player));
}

// Players whose inventory the engine reported as changed since the last sweep. Reading all 36 slots of
// every player on every tick was the single largest cost in the server tick profile once the chunk
// scrubber was fixed; the engine already knows when an inventory moves, so the sweep rides that.
const dirtyInventories = new Set<string>();

export function markInventoryDirty(playerId: string): void {
    dirtyInventories.add(playerId);
}

function sweepPlayer(player: Player, fullSweep: boolean, equipmentSweep: boolean): void {
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
        return;
    }

    // A player who just lost the tag gets their message cooldown cleared, so the first item the sweep
    // removes tells them why instead of staying silent.
    if (wasExempt) msgCooldowns.delete(player.id);

    if (sweepAll) processInventory(player);
    else if (equipmentSweep) processEquipment(player);
}

export function* inventorySweepJob(): Generator<void, void, unknown> {
    const tick = system.currentTick;
    const fullSweep = tick % CONFIG.FULL_SWEEP_INTERVAL === 0;
    const equipmentSweep = tick % CONFIG.EQUIPMENT_SWEEP_INTERVAL === 0;

    // Enumerating players and reading each gamemode is itself native work, so an idle tick - nothing
    // reported dirty and no cadence due - returns before either call, rather than running them only
    // to find no inventory to look at.
    if (!fullSweep && !equipmentSweep && dirtyInventories.size === 0) return;

    let processed = 0;
    for (const player of world.getAllPlayers()) {
        if (!player.isValid) continue;

        try {
            sweepPlayer(player, fullSweep, equipmentSweep);
        } catch (e) {
            reportError({
                system: "InventoryManager",
                operation: "processInventory",
                target: player.name
            }, e);
        }

        processed++;
        if (processed % CONFIG.PLAYERS_PER_TICK === 0) {
            yield;
        }
    }
}

export function processPlayers(): void {
    const job = inventorySweepJob();
    while (!job.next().done) {
        // Drain synchronously for test harnesses or explicit sweeps
    }
}

tickManager.register("inventoryManager", CONFIG.CHECK_INTERVAL, inventorySweepJob, 0);

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

    if (!isVanillaId(id) && !isModItem(id)) {
        return { type: "keep" };
    }

    if (BH_FOOD_IDS.has(id)) {
        if (item.amount > maxBetaStackSize(id)) {
            return { type: "unstack_food", convertedId: id, totalAmount: item.amount };
        }
        return { type: "keep" };
    }

    if (id === BH_BOW_ID) {
        if (item.amount > 1) {
            return { type: "unstack_utility", targetId: id, totalAmount: item.amount };
        }
        const enchantable = item.getComponent(ItemComponentTypes.Enchantable);
        if (enchantable && enchantable.getEnchantments().length > 0) {
            const cleanItem = new ItemStack(id, item.amount);
            preserveDurability(item, cleanItem);
            return { type: "strip_enchantments", item: cleanItem };
        }
        return { type: "keep" };
    }

    if (!isVanillaId(id)) {
        return { type: "keep" };
    }

    if (id === "minecraft:bow") {
        const replacement = new ItemStack(BH_BOW_ID, item.amount);
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
    const maxStack = maxBetaStackSize(targetId);
    const slotAmount = Math.min(amount, maxStack);
    inv.setItem(slotIndex, new ItemStack(targetId, slotAmount));
    if (amount <= slotAmount) return;

    let remaining = amount - slotAmount;
    const size = inv.size;
    for (let s = 0; s < size && remaining > 0; s++) {
        if (!inv.getItem(s)) {
            const place = Math.min(remaining, maxStack);
            inv.setItem(s, new ItemStack(targetId, place));
            remaining -= place;
        }
    }

    while (remaining > 0) {
        const dropAmount = Math.min(remaining, maxStack);
        player.dimension.spawnItem(new ItemStack(targetId, dropAmount), player.location);
        remaining -= dropAmount;
    }
}

function sweepStrict(player: Player, accessor?: SlotAccessor): { removed: boolean; stripped: boolean } {
    if (!accessor) return { removed: false, stripped: false };

    let removed = false;
    let stripped = false;

    for (const key of accessor.keys) {
        const item = accessor.get(key);
        if (!item) continue;

        const action = evaluateItemAction(item);

        switch (action.type) {
            case "keep":
                break;
            case "delete":
                accessor.set(key, undefined);
                removed = true;
                if (action.reason === "unsupported") console.log(`${accessor.label} ${item.typeId} from ${player.name}`);
                break;
            case "replace":
            case "strip_enchantments":
                accessor.set(key, action.item);
                stripped ||= action.type === "strip_enchantments";
                break;
            case "unstack_food":
            case "unstack_utility":
                // Beta forbade stacking these, so the excess is split out where the slot allows it and
                // dropped where it does not, rather than left as the stack the era never had.
                if (!accessor.split) {
                    accessor.set(key, undefined);
                    removed = true;
                    break;
                }
                accessor.split(key, action.type === "unstack_food" ? action.convertedId : action.targetId, action.totalAmount);
                break;
            default:
                break;
        }
    }

    return { removed, stripped };
}

function reportSweep(player: Player, { removed, stripped }: { removed: boolean; stripped: boolean }): void {
    if (removed) notifyPlayer(player, CONFIG.REMOVE_MSG);
    if (stripped) notifyPlayer(player, CONFIG.ENCHANT_MSG);
}

export function processInventory(player: Player): void {
    // The inventory half reports first on purpose: the message cooldown is per player, so this keeps
    // the inventory's message the one that reaches the player when both halves trip.
    reportSweep(player, sweepStrict(player, inventorySlots(player)));
    processEquipment(player);
}

/**
 * The strict half of the equipment sweep, split out so the equipment slots can be polled on their own
 * cadence while the main inventory rides the item-change event.
 */
export function processEquipment(player: Player): void {
    reportSweep(player, sweepStrict(player, equipmentSlots(player)));
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
