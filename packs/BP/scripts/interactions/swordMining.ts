import { world, Player, EquipmentSlot, EntityComponentTypes } from "@minecraft/server";
import { eventBus } from "../core/eventBus.js";
import { tickManager } from "../core/tickManager.js";
import { runCatching } from "../core/errorReporter.js";

export const SWORD_FAST_BLOCKS = new Set([
    "minecraft:web",
    "minecraft:cobweb",
    "minecraft:oak_leaves", "minecraft:spruce_leaves", "minecraft:birch_leaves",
    "minecraft:leaves", "minecraft:leaves2",
    "minecraft:oak_planks", "minecraft:spruce_planks", "minecraft:birch_planks",
    "minecraft:planks",
    "minecraft:oak_stairs", "minecraft:wooden_stairs",
    // Beta's reworked wooden stairs keep their own wood tool class, unlike the slab
    // below which shares the stone slab's internals.
    "bh:oak_stairs",
    "minecraft:pumpkin", "minecraft:carved_pumpkin", "minecraft:lit_pumpkin",
    "minecraft:wool", 
    "minecraft:white_wool", "minecraft:orange_wool", "minecraft:magenta_wool", "minecraft:light_blue_wool",
    "minecraft:yellow_wool", "minecraft:lime_wool", "minecraft:pink_wool", "minecraft:gray_wool",
    "minecraft:light_gray_wool", "minecraft:cyan_wool", "minecraft:purple_wool", "minecraft:blue_wool",
    "minecraft:brown_wool", "minecraft:green_wool", "minecraft:red_wool", "minecraft:black_wool"
]);

export const SWORDS = new Set([
    "minecraft:wooden_sword",
    "minecraft:stone_sword",
    "minecraft:iron_sword",
    "minecraft:golden_sword",
    "minecraft:diamond_sword"
]);

const CONFIG = Object.freeze({
    TICK_INTERVAL: 3,
    HASTE_DURATION: 10,
    HASTE_AMPLIFIER: 2,
    MAX_DISTANCE: 5
});

const hasHaste = new Set<string>();

export function clearHaste(player: Player): void {
    if (hasHaste.has(player.id)) {
        try {
            player.removeEffect("haste");
        } catch {
            // Player may have unloaded or disconnected
        }
        hasHaste.delete(player.id);
    }
}

tickManager.register("swordMining", CONFIG.TICK_INTERVAL, () => {
    for (const player of world.getAllPlayers()) {
        if (!player.isValid) continue;

        runCatching({ system: "swordMining", operation: "checkPlayer" }, () => {
            const equip = player.getComponent(EntityComponentTypes.Equippable);
            const mainhand = equip?.getEquipment(EquipmentSlot.Mainhand);
            const hasSword = mainhand && SWORDS.has(mainhand.typeId);

            if (!hasSword) {
                clearHaste(player);
                return;
            }

            const blockRay = player.getBlockFromViewDirection({ maxDistance: CONFIG.MAX_DISTANCE });
            
            if (blockRay?.block && SWORD_FAST_BLOCKS.has(blockRay.block.typeId)) {
                player.addEffect("haste", CONFIG.HASTE_DURATION, {
                    amplifier: CONFIG.HASTE_AMPLIFIER,
                    showParticles: false
                });
                hasHaste.add(player.id);
            } else {
                clearHaste(player);
            }
        });
    }
});

eventBus.onPlayerLeave((ev) => {
    hasHaste.delete(ev.playerId);
});
