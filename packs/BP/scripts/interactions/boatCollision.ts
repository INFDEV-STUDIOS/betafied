import { world, ItemStack, Entity, Block, Vector3 } from "@minecraft/server";
import { eventBus } from "../core/eventBus.js";
import { tickManager } from "../core/tickManager.js";
import { reportError } from "../core/errorReporter.js";
import { OVERWORLD_KEY } from "../core/betaConstants.js";
import { normalizeXZ, scale } from "../core/vectorMath.js";

const CONFIG = Object.freeze({
    TICK_INTERVAL: 10,
    BOATS_PER_TICK: 10,
    NON_SOLID_WHITELIST: Object.freeze(["minecraft:air", "minecraft:water", "minecraft:soul_sand"])
});

function isSolidBlock(block: Block | undefined): boolean {
    const id = block?.typeId;
    return Boolean(id && !CONFIG.NON_SOLID_WHITELIST.includes(id));
}

function breakBoatWithParts(boat: Entity): void {
    const loc = boat.location;
    const dim = boat.dimension;
    boat.kill();
    for (let i = 0; i < 3; i++) dim.spawnItem(new ItemStack("minecraft:oak_planks", 1), loc);
    for (let i = 0; i < 2; i++) dim.spawnItem(new ItemStack("minecraft:stick", 1), loc);
}

function breakBoatWithItem(boat: Entity): void {
    const loc = boat.location;
    const dim = boat.dimension;
    boat.kill();
    dim.spawnItem(new ItemStack("minecraft:oak_boat", 1), loc);
}

export function* boatLoopJob(): Generator<void, void, unknown> {
    const overworld = world.getDimension(OVERWORLD_KEY);
    const boats = overworld.getEntities({ type: "minecraft:boat" });

    let processed = 0;
    for (const boat of boats) {
        if (!boat.isValid) continue;

        try {
            const loc = boat.location;
            const x = Math.floor(loc.x);
            const y = Math.floor(loc.y);
            const z = Math.floor(loc.z);

            const offsets = [
                { x: x + 1, z }, { x: x - 1, z },
                { x, z: z + 1 }, { x, z: z - 1 }
            ];

            let broken = false;
            for (const offset of offsets) {
                const block = overworld.getBlock({ x: offset.x, y, z: offset.z });
                if (isSolidBlock(block)) {
                    breakBoatWithParts(boat);
                    broken = true;
                    break;
                }
            }

            if (!broken) {
                const vel: Vector3 = boat.getVelocity();
                if (vel && (Math.abs(vel.x) >= 0.01 || Math.abs(vel.z) >= 0.01)) {
                    const blockBelow = overworld.getBlock({
                        x: Math.floor(loc.x),
                        y: Math.floor(loc.y - 0.3),
                        z: Math.floor(loc.z)
                    });

                    if (blockBelow?.typeId === "minecraft:water") {
                        const dir = normalizeXZ({ x: vel.x, z: vel.z });
                        const offset = scale(dir, -1);

                        const bubblePos = {
                            x: loc.x + offset.x,
                            y: loc.y + 0.1,
                            z: loc.z + offset.z
                        };

                        boat.dimension.spawnParticle("minecraft:basic_bubble_particle_gradual", bubblePos);
                    }
                }
            }
        } catch (e) {
            reportError({
                system: "boatCollision",
                operation: "processBoat",
                target: boat.id
            }, e);
        }

        processed++;
        if (processed % CONFIG.BOATS_PER_TICK === 0) {
            yield;
        }
    }
}

export function processBoats(): void {
    const job = boatLoopJob();
    while (!job.next().done) {
        // Drain generator synchronously
    }
}

tickManager.register("boatCollision", CONFIG.TICK_INTERVAL, boatLoopJob, 6);

eventBus.onEntityHitEntity((event) => {
    const { damagingEntity, hitEntity } = event;
    if (
        damagingEntity.typeId === "minecraft:player" &&
        hitEntity.typeId === "minecraft:boat"
    ) {
        breakBoatWithItem(hitEntity);
    }
});
