import { system } from "@minecraft/server";
import { eventBus } from "../core/eventBus.js";
import { reportError } from "../core/errorReporter.js";
import { NETHER_ID } from "../core/betaConstants.js";

eventBus.onPlayerBreakBlock((event) => {
    try {
        const { block, brokenBlockPermutation, dimension } = event;

        if (dimension.id !== NETHER_ID) return;
        if (brokenBlockPermutation.type.id !== "minecraft:ice") return;

        const location = block.location;

        system.runTimeout(() => {
            try {
                const currentBlock = dimension.getBlock(location);
                if (currentBlock && currentBlock.typeId === "minecraft:air") {
                    currentBlock.setType("minecraft:flowing_water");
                }
            } catch (e) {
                reportError({
                    system: "NetherIce",
                    operation: "placeWater",
                    target: `${location.x},${location.y},${location.z}`
                }, e);
            }
        }, 1);

    } catch (e) {
        reportError({
            system: "NetherIce",
            operation: "playerBreakBlock"
        }, e);
    }
});
