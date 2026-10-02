import { EquipmentSlot } from "@minecraft/server";

/**
 * The four armor slots.
 *
 * `inventoryManager` sweeps the offhand too, but armor damage and the armor readout are defined over
 * these four only. Both modules read the list from here instead of re-declaring it, so adding a slot
 * to the armor model cannot leave one of them behind.
 */
export const ARMOR_SLOTS: readonly EquipmentSlot[] = Object.freeze([
    EquipmentSlot.Head,
    EquipmentSlot.Chest,
    EquipmentSlot.Legs,
    EquipmentSlot.Feet
]);
