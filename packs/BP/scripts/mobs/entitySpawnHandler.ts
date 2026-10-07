import { world, system, ItemStack, Dimension, Entity, EntityComponentTypes } from "@minecraft/server";
import { reportError } from "../core/errorReporter.js";
import { isBetaEntity, isVanillaId } from "../core/betaRegistry.js";
import { resolveDropId } from "../core/normalizer.js";
import { eventBus } from "../core/eventBus.js";

const recentBrokenLeaves = new Map<string, number>();
const recentBrokenChests = new Map<string, number>();
const recentPlayerDeaths = new Map<string, number>();

const dropOrigins = [recentBrokenLeaves, recentBrokenChests, recentPlayerDeaths];

const ORIGIN_RADIUS = 1;
const TREE_RADIUS = 2;

function cleanOldEntries(currentTick: number): void {
    for (const origins of dropOrigins) {
        for (const [key, tick] of origins) {
            if (currentTick - tick > 20) origins.delete(key);
        }
    }
}

function hasBetaTreeAround(dim: Dimension, x: number, y: number, z: number): boolean {
    for (let dx = -TREE_RADIUS; dx <= TREE_RADIUS; dx++) {
        for (let dy = -TREE_RADIUS; dy <= TREE_RADIUS; dy++) {
            for (let dz = -TREE_RADIUS; dz <= TREE_RADIUS; dz++) {
                try {
                    const block = dim.getBlock({ x: x + dx, y: y + dy, z: z + dz });
                    if (block && (block.typeId.includes("leaves") || block.typeId.includes("log"))) return true;
                } catch {
                    // Out of bounds or unloaded block safely ignored
                }
            }
        }
    }

    return false;
}

/**
 * Whether a fresh `minecraft:apple` item entity is the engine's own leaf-decay drop rather than a
 * player's.
 *
 * Bedrock's C++ engine hardcodes apple drops when leaves are destroyed or decay, and Beta 1.7.3 trees
 * never dropped apples. A leaf broken in the neighbourhood owns the drop; a chest broken there or a
 * nearby death does not, and neither does a player close enough to have broken the leaf themselves.
 */
export function isTreeAppleDrop(entity: Entity): boolean {
    const loc = entity.location;
    const dim = entity.dimension;

    cleanOldEntries(system.currentTick);

    const bx = Math.floor(loc.x);
    const by = Math.floor(loc.y);
    const bz = Math.floor(loc.z);

    let leafOrigin = false;
    let otherOrigin = false;

    for (let dx = -ORIGIN_RADIUS; dx <= ORIGIN_RADIUS; dx++) {
        for (let dy = -ORIGIN_RADIUS; dy <= ORIGIN_RADIUS; dy++) {
            for (let dz = -ORIGIN_RADIUS; dz <= ORIGIN_RADIUS; dz++) {
                const key = `${dim.id}:${bx + dx},${by + dy},${bz + dz}`;
                if (recentBrokenLeaves.has(key)) leafOrigin = true;
                else if (recentBrokenChests.has(key) || recentPlayerDeaths.has(key)) otherOrigin = true;
            }
        }
    }

    if (leafOrigin) return true;
    if (otherOrigin) return false;

    for (const player of world.getAllPlayers()) {
        if (!player.isValid || player.dimension.id !== dim.id) continue;

        const ploc = player.location;
        const distSq = (ploc.x - loc.x) ** 2 + (ploc.y - loc.y) ** 2 + (ploc.z - loc.z) ** 2;
        if (distSq < 2.25) return false;
    }

    return hasBetaTreeAround(dim, bx, by, bz);
}

eventBus.onPlayerBreakBlock((event) => {
    try {
        const blockId = event.brokenBlockPermutation?.type?.id ?? "";
        const locKey = `${event.block.dimension.id}:${event.block.x},${event.block.y},${event.block.z}`;
        if (blockId.includes("leaves")) {
            recentBrokenLeaves.set(locKey, system.currentTick);
        } else if (blockId.includes("chest")) {
            recentBrokenChests.set(locKey, system.currentTick);
        }
    } catch {
        // fail-safe ignore
    }
});

eventBus.onEntitySpawn((event) => {
    try {
        const entity = event.entity;
        if (!entity || !entity.isValid) return;

        const typeId = entity.typeId;

        if (typeId === "minecraft:item") {
            const itemComp = entity.getComponent(EntityComponentTypes.Item);
            if (!itemComp?.itemStack) return;

            const itemId = itemComp.itemStack.typeId;
            const amount = itemComp.itemStack.amount;

            if ((itemId === "minecraft:apple" || itemId === "bh:apple") && isTreeAppleDrop(entity)) {
                entity.remove();
                return;
            }

            // The inventory sweeper retypes held items into their `bh:` form on pickup, so the drop
            // has to land on that same identifier. Left as the vanilla id, a second log finds no stack
            // to merge into - the first one is already `bh:oak_log` - and every pickup lands alone.
            const finalId = resolveDropId(itemId);
            if (finalId === null) {
                entity.remove();
            } else if (finalId !== itemId) {
                const loc = entity.location;
                const dim = entity.dimension;
                entity.remove();
                dim.spawnItem(new ItemStack(finalId, amount), loc);
            }

            return;
        }

        if (isVanillaId(typeId) && !isBetaEntity(typeId)) {
            entity.remove();
        }

    } catch (e) {
        reportError({
            system: "entitySpawnHandler",
            operation: "entitySpawnValidation",
            target: event.entity?.typeId
        }, e);
    }
});

eventBus.onEntityDie((event) => {
    try {
        const deadEntity = event.deadEntity;
        if (!deadEntity) return;

        const type = deadEntity.typeId;

        if (type === "minecraft:player") {
            const loc = deadEntity.location;
            const locKey = `${deadEntity.dimension.id}:${Math.floor(loc.x)},${Math.floor(loc.y)},${Math.floor(loc.z)}`;
            recentPlayerDeaths.set(locKey, system.currentTick);
        }
    } catch (e) {
        reportError({
            system: "entitySpawnHandler",
            operation: "trackDeath",
            target: event.deadEntity?.typeId
        }, e);
    }
});
