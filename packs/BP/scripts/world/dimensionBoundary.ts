import { world } from "@minecraft/server";
import { eventBus } from "../core/eventBus.js";
import { END_ID, OVERWORLD_ID, OVERWORLD_KEY } from "../core/betaConstants.js";

eventBus.onPlayerDimensionChange((event) => {
    if (event.toDimension.id === END_ID) {
        const player = event.player;
        if (player.isValid) {
            const overworld = world.getDimension(OVERWORLD_KEY);
            const spawn = player.getSpawnPoint();
            const targetLoc = spawn && spawn.dimension.id === OVERWORLD_ID
                ? { x: spawn.x, y: spawn.y, z: spawn.z }
                : { x: 0, y: 70, z: 0 };
            player.teleport(targetLoc, { dimension: overworld });
            player.sendMessage("§cThe End does not exist in Beta 1.7.3.");
        }
    }
});
