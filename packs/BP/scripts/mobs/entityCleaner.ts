import { world, ItemStack, EntityComponentTypes } from "@minecraft/server";
import { reportError } from "../core/errorReporter.js";
import { isBetaEntity, isVanillaId } from "../core/betaRegistry.js";
import { resolveDropId } from "../core/normalizer.js";
import { tickManager } from "../core/tickManager.js";

const CONFIG = Object.freeze({
    CHECK_INTERVAL: 100,
    CHECK_RADIUS: 32
});

/**
 * Generator for asynchronous periodic entity cleanup.
 * Removes non-Beta entities using the canonical allowlist and replaces/removes modern item drops.
 */
export function* cleanerJob(): Generator<void, void, unknown> {
    const players = world.getAllPlayers();

    for (const player of players) {
        if (!player.isValid) continue;

        try {
            const entities = player.dimension.getEntities({
                location: player.location,
                maxDistance: CONFIG.CHECK_RADIUS
            });

            for (const ent of entities) {
                if (!ent.isValid) continue;

                if (isVanillaId(ent.typeId) && !isBetaEntity(ent.typeId)) {
                    ent.remove();
                } else if (ent.typeId === "minecraft:item") {
                    const itemComp = ent.getComponent(EntityComponentTypes.Item);
                    const itemStack = itemComp?.itemStack;
                    if (itemStack) {
                        const finalId = resolveDropId(itemStack.typeId);
                        if (finalId === null) {
                            ent.remove();
                        } else if (finalId !== itemStack.typeId) {
                            const loc = ent.location;
                            const dim = ent.dimension;
                            const amount = itemStack.amount;
                            ent.remove();
                            dim.spawnItem(new ItemStack(finalId, amount), loc);
                        }
                    }
                }
                yield;
            }
        } catch (e) {
            reportError({
                system: "entityCleaner",
                operation: "cleanNearbyEntities",
                target: player.name
            }, e);
        }

        yield;
    }
}

tickManager.register("entityCleaner", CONFIG.CHECK_INTERVAL, cleanerJob, 10);
