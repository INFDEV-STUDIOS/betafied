import { BlockVolume, system } from "@minecraft/server";
import type { Dimension, Vector3 } from "@minecraft/server";
import { eventBus } from "../core/eventBus.js";
import { reportError } from "../core/errorReporter.js";
import { POST_BETA_TALL_PLANTS } from "../core/compatibilityPolicy.js";

const BLOCKED_TARGETS = Object.freeze(new Set([
    "minecraft:brown_mushroom",
    "minecraft:red_mushroom"
]));

// Bone meal on grass spreads across the clicked block's neighbourhood, so the sweep covers the
// same 15x5x15 volume the vanilla feature reaches into.
const SPREAD_RADIUS = 7;
const SPREAD_VERTICAL = 2;

function clearPostBetaTallPlants(dimension: Dimension, origin: Vector3): void {
    const from = {
        x: origin.x - SPREAD_RADIUS,
        y: origin.y - SPREAD_VERTICAL,
        z: origin.z - SPREAD_RADIUS
    };
    const to = {
        x: origin.x + SPREAD_RADIUS,
        y: origin.y + SPREAD_VERTICAL,
        z: origin.z + SPREAD_RADIUS
    };

    dimension.fillBlocks(new BlockVolume(from, to), "minecraft:air", {
        blockFilter: { includeTypes: [...POST_BETA_TALL_PLANTS] },
        ignoreChunkBoundErrors: true
    });
}

eventBus.onPlayerInteractWithBlock((event) => {
    try {
        const { itemStack, block } = event;
        if (!itemStack || itemStack.typeId !== "minecraft:bone_meal") return;

        if (BLOCKED_TARGETS.has(block.typeId)) {
            event.cancel = true;
            return;
        }

        if (block.typeId === "minecraft:wheat") {
            system.run(() => {
                block.setPermutation(block.permutation.withState("growth", 7));
                block.dimension.spawnParticle("minecraft:crop_growth_emitter", block.center());
            });
        }

        if (block.typeId === "minecraft:grass_block") {
            const dimension = block.dimension;
            const origin = {
                x: Math.floor(block.location.x),
                y: Math.floor(block.location.y),
                z: Math.floor(block.location.z)
            };

            system.runTimeout(() => {
                try {
                    clearPostBetaTallPlants(dimension, origin);
                } catch (e) {
                    reportError({
                        system: "instantBonemeal",
                        operation: "clearPostBetaTallPlants",
                        target: `${origin.x},${origin.y},${origin.z}`
                    }, e);
                }
            }, 1);
        }
    } catch (e) {
        reportError({
            system: "instantBonemeal",
            operation: "playerInteractWithBlock",
            target: event.block.typeId
        }, e);
    }
});
