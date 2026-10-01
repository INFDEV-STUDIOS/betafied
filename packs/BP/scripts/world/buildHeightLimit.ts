import { Direction } from "@minecraft/server";
import { eventBus } from "../core/eventBus.js";

const BETA_FLOOR_Y = 0;
const OVERWORLD_ID = "minecraft:overworld";

// Beta's world stopped at bedrock on Y=0. The scrubber seals the sub-zero column, and this veto
// keeps anything that slips past the cap - a command, an unscrubbed chunk - from opening the void.
eventBus.onPlayerBreakBlockBefore((event) => {
    try {
        if (event.block.location.y < BETA_FLOOR_Y && event.block.dimension.id === OVERWORLD_ID) {
            event.cancel = true;
        }
    } catch {
        // Boundary safety
    }
});

eventBus.onPlayerInteractWithBlock((event) => {
    try {
        const { player, block, blockFace } = event;
        let targetY = block.location.y;
        if (blockFace === Direction.Up) {
            targetY++;
        }
        if (targetY >= 128) {
            event.cancel = true;
            player.sendMessage("§cHeight limit for building is 128 blocks");
        }
    } catch {
        // Boundary safety
    }
});

eventBus.onPlayerPlaceBlock((event) => {
    try {
        const { player, block } = event;
        if (block.location.y >= 128) {
            block.setType("minecraft:air");
            player.sendMessage("§cHeight limit for building is 128 blocks");
        }
    } catch {
        // Boundary safety
    }
});
