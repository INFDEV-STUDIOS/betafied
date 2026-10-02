import { world, system, ItemStack, Entity, EntityComponentTypes } from "@minecraft/server";
import { reportError } from "../core/errorReporter.js";
import { isBetaEntity, isVanillaId } from "../core/betaRegistry.js";
import { resolveDropId } from "../core/normalizer.js";
import { eventBus } from "../core/eventBus.js";

const recentBrokenLeaves = new Map<string, number>();
const recentBrokenChests = new Map<string, number>();
const recentPlayerDeaths = new Map<string, number>();

function cleanOldEntries(map: Map<string, number>, currentTick: number, maxAge: number = 20): void {
    for (const [key, tick] of map) {
        if (currentTick - tick > maxAge) {
            map.delete(key);
        }
    }
}

export function isTreeAppleDrop(entity: Entity): boolean {
    const loc = entity.location;
    const dim = entity.dimension;
    const currentTick = system.currentTick;

    cleanOldEntries(recentBrokenLeaves, currentTick, 20);
    cleanOldEntries(recentBrokenChests, currentTick, 20);
    cleanOldEntries(recentPlayerDeaths, currentTick, 20);

    const bx = Math.floor(loc.x);
    const by = Math.floor(loc.y);
    const bz = Math.floor(loc.z);

    // Bedrock C++ engine hardcodes apple drops upon leaf destruction and decay.
    // In Beta 1.7.3, trees never dropped apples.
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            for (let dz = -1; dz <= 1; dz++) {
                const key = `${dim.id}:${bx + dx},${by + dy},${bz + dz}`;
                if (recentBrokenLeaves.has(key)) {
                    return true;
                }
            }
        }
    }

    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            for (let dz = -1; dz <= 1; dz++) {
                const key = `${dim.id}:${bx + dx},${by + dy},${bz + dz}`;
                if (recentBrokenChests.has(key) || recentPlayerDeaths.has(key)) {
                    return false;
                }
            }
        }
    }

    const players = world.getAllPlayers();
    for (const player of players) {
        if (!player.isValid || player.dimension.id !== dim.id) continue;
        const ploc = player.location;
        const distSq = (ploc.x - loc.x) ** 2 + (ploc.y - loc.y) ** 2 + (ploc.z - loc.z) ** 2;
        if (distSq < 2.25) {
            return false;
        }
    }

    for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
            for (let dz = -2; dz <= 2; dz++) {
                try {
                    const block = dim.getBlock({ x: bx + dx, y: by + dy, z: bz + dz });
                    if (block && (block.typeId.includes("leaves") || block.typeId.includes("log"))) {
                        return true;
                    }
                } catch {
                    // Out of bounds or unloaded block safely ignored
                }
            }
        }
    }

    return false;
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
