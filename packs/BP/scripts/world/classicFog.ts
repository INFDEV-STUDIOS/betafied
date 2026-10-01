import { world } from "@minecraft/server";
import { eventBus } from "../core/eventBus.js";
import { tickManager } from "../core/tickManager.js";
import { reportError } from "../core/errorReporter.js";

const CONFIG = Object.freeze({
    CHECK_INTERVAL: 20,
    FOG_ID: "beta"
});

const hasFog = new Set<string>();

export function* fogJob(): Generator<void, void, unknown> {
    const players = world.getAllPlayers();

    for (const player of players) {
        try {
            const name = player.name;
            const dim = player.dimension.id;

            if (dim === "minecraft:overworld") {
                if (!hasFog.has(name)) {
                    // `/fog` is the only way to stack a custom fog: the script API exposes no fog
                    // equivalent, so this is the one place a command is the right tool.
                    player.runCommand(`fog @s push classic_water:default_fog ${CONFIG.FOG_ID}`);
                    hasFog.add(name);
                }
            } else {
                if (hasFog.has(name)) {
                    player.runCommand(`fog @s pop ${CONFIG.FOG_ID}`);
                    hasFog.delete(name);
                }
            }
        } catch (e) {
            reportError({
                system: "classicFog",
                operation: "syncPlayerFog",
                target: player.name
            }, e);
        }
        yield;
    }
}

tickManager.register("classicFog", CONFIG.CHECK_INTERVAL, fogJob, 12);

eventBus.onPlayerLeave((event) => {
    hasFog.delete(event.playerName);
});
