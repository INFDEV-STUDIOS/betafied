import { world } from "@minecraft/server";
import { tickManager } from "../core/tickManager.js";
import { reportError } from "../core/errorReporter.js";

const CONFIG = Object.freeze({
    CHECK_INTERVAL: 10,
    DIMENSION: "the_end",
    FINAL_POS: { x: 400, y: 80, z: 400 },
    STRUCTURE_POS: { x: 396, y: 76, z: 396 },
    STRUCTURE_NAME: "mystructure:island",
    MAX_RADIUS_SQR: 10000,
    MIN_Y: 40,
    RESISTANCE_DURATION: 999999,
    RESISTANCE_AMP: 255
});

function isIslandPlaced(): boolean {
    return world.getDynamicProperty("betafied:island_placed") === true;
}

function placeIsland(): void {
    if (isIslandPlaced()) return;

    try {
        const end = world.getDimension(CONFIG.DIMENSION);
        world.structureManager.place(CONFIG.STRUCTURE_NAME, end, CONFIG.STRUCTURE_POS);
        world.setDynamicProperty("betafied:island_placed", true);
    } catch (e) {
        reportError({
            system: "island",
            operation: "placeIslandStructure"
        }, e);
    }
}

export function islandJob(): void {
    for (const player of world.getAllPlayers()) {
        if (!player.isValid) continue;

        if (!player.hasTag("voided")) {
            try {
                player.removeEffect("resistance");
            } catch (e) {
                reportError({
                    system: "island",
                    operation: "removeResistance",
                    target: player.name
                }, e);
            }
            continue;
        }

        if (!isIslandPlaced()) {
            placeIsland();
        }

        const end = world.getDimension(CONFIG.DIMENSION);

        if (player.dimension.id !== `minecraft:${CONFIG.DIMENSION}`) {
            player.teleport(CONFIG.FINAL_POS, { dimension: end });
        }

        try {
            player.addEffect("resistance", CONFIG.RESISTANCE_DURATION, {
                amplifier: CONFIG.RESISTANCE_AMP,
                showParticles: false
            });

            const loc = player.location;
            const dx = loc.x - CONFIG.FINAL_POS.x;
            const dz = loc.z - CONFIG.FINAL_POS.z;

            if (dx * dx + dz * dz > CONFIG.MAX_RADIUS_SQR || loc.y < CONFIG.MIN_Y) {
                player.teleport(CONFIG.FINAL_POS, { dimension: end });
            }
        } catch (e) {
            reportError({
                system: "island",
                operation: "confinePlayer",
                target: player.name
            }, e);
        }
    }
}

tickManager.register("island", CONFIG.CHECK_INTERVAL, islandJob, 8);
