import { world, Player, EquipmentSlot, EntityComponentTypes } from "@minecraft/server";
import { eventBus } from "../core/eventBus.js";
import { tickManager } from "../core/tickManager.js";
import { runCatching } from "../core/errorReporter.js";
import { BETA_SWORD_IDS, WOOL_BY_COLOR } from "../core/betaRegistry.js";

// Only ids that exist on this engine belong here: the legacy aliases (`web`, `leaves`, `leaves2`,
// `wooden_stairs`, `wool`) never resolve, and the palette comes from the registry so a species or
// colour the shears recognize is never missing from the sword bonus.
export const SWORD_FAST_BLOCKS = new Set([
    "minecraft:cobweb",
    "minecraft:oak_leaves", "minecraft:spruce_leaves", "minecraft:birch_leaves",
    "minecraft:oak_planks", "minecraft:spruce_planks", "minecraft:birch_planks",
    "minecraft:planks",
    "minecraft:oak_stairs",
    // Beta's reworked wooden stairs keep their own wood tool class, unlike the slab
    // below which shares the stone slab's internals.
    "bh:oak_stairs",
    "minecraft:pumpkin", "minecraft:carved_pumpkin", "minecraft:lit_pumpkin",
    ...WOOL_BY_COLOR
]);

export const SWORDS: ReadonlySet<string> = BETA_SWORD_IDS;

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
