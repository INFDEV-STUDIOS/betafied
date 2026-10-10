import { world } from "@minecraft/server";
import { eventBus } from "../core/eventBus.js";
import { tickManager } from "../core/tickManager.js";
import { reportError } from "../core/errorReporter.js";
import { OVERWORLD_ID } from "../core/betaConstants.js";

const CONFIG = Object.freeze({
    CHECK_INTERVAL: 20,
    PLAYERS_PER_TICK: 5,
    FOG_ID: "beta"
});

const hasFog = new Set<string>();

export function* fogJob(): Generator<void, void, unknown> {
    const playerIds = world.getAllPlayers().map(p => p.id);

    let processed = 0;
    for (const playerId of playerIds) {
        const player = world.getAllPlayers().find(p => p.id === playerId);
        if (!player || !player.isValid) continue;

        try {
            const name = player.name;
            const dim = player.dimension.id;

            if (dim === OVERWORLD_ID) {
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

        processed++;
        if (processed % CONFIG.PLAYERS_PER_TICK === 0) {
            yield;
        }
    }
}

tickManager.register("classicFog", CONFIG.CHECK_INTERVAL, fogJob, 12);

eventBus.onPlayerLeave((event) => {
    hasFog.delete(event.playerName);
});
