import { world, system, Entity, Player, ItemStack, EntityComponentTypes, Dimension } from "@minecraft/server";
import { eventBus } from "../core/eventBus.js";
import { tickManager } from "../core/tickManager.js";
import { reportError } from "../core/errorReporter.js";
import { WOOL_BY_COLOR } from "../core/betaRegistry.js";

const CONFIG = Object.freeze({
    CHECK_INTERVAL: 40,
    CLEANUP_INTERVAL: 600,
    MAX_MAP_SIZE: 500,
    PLAYER_RADIUS: 32,
    CROWD_RADIUS: 2.2,
    HURT_COOLDOWN_TICKS: 160,
    JUMP_COOLDOWN_MIN: 60,
    JUMP_COOLDOWN_MAX: 160,
    JUMP_IMPULSE_Y: 0.42,
    FORWARD_IMPULSE: 0.12,
    OBSTACLE_HOP_CHANCE: 0.85,
    CROWD_HOP_CHANCE: 0.65,
    WATER_HOP_CHANCE: 0.70,
    ANIMALS_PER_TICK: 10,
    WANDER_HOP_CHANCE: 0.15
});

export const PASSIVE_MOBS = Object.freeze(new Set([
    "minecraft:pig",
    "minecraft:cow",
    "minecraft:sheep",
    "minecraft:chicken"
]));

/**
 * Beta 1.7.3's shearing drop, `1 + rand.nextInt(3)`.
 *
 * A punch and a pair of shears reach different owners for this number: shears run the engine's
 * `minecraft:interact`, which reads `loot_tables/entities/sheep_shear.json`, while the punch path below
 * spawns the stack itself. The two had drifted (2-4 by shears, 1-3 by punch), so both are pinned here
 * and `tests/integration/sheepPunch.test.ts` asserts the loot table still agrees.
 */
export const WOOL_DROP_MIN = 1;
export const WOOL_DROP_MAX = 3;

export const hurtCooldowns = new Map<string, number>();
export const jumpCooldowns = new Map<string, number>();

export function handleSheepPunch(sheep: Entity): void {
    if (!sheep.isValid) return;

    const health = sheep.getComponent(EntityComponentTypes.Health);
    if (health && health.currentValue <= 0) return;

    sheep.triggerEvent("minecraft:on_sheared");

    const colorComp = sheep.getComponent(EntityComponentTypes.Color);
    const colorVal = typeof colorComp?.value === "number" ? colorComp.value : 0;
    const woolId = WOOL_BY_COLOR[colorVal] ?? "minecraft:white_wool";
    const count = WOOL_DROP_MIN + Math.floor(Math.random() * (WOOL_DROP_MAX - WOOL_DROP_MIN + 1));

    sheep.dimension.spawnItem(new ItemStack(woolId, count), sheep.location);
}

eventBus.onEntityHurt((ev) => {
    const hurtEntity = ev.hurtEntity;
    if (PASSIVE_MOBS.has(hurtEntity.typeId)) {
        hurtCooldowns.set(hurtEntity.id, tickManager.getCurrentTick() + CONFIG.HURT_COOLDOWN_TICKS);
    }

    if (
        hurtEntity.typeId === "minecraft:sheep" &&
        ev.damageSource.damagingEntity instanceof Player &&
        !hurtEntity.hasComponent("minecraft:is_sheared")
    ) {
        handleSheepPunch(hurtEntity);
    }
});

/**
 * Recreates Java Beta 1.7.3 isCollidedHorizontally hop behavior.
 * Evaluates whether an animal is bumping into terrain/fences, crowded in a pen, or in water.
 */
export function evaluateHopConditions(entity: Entity, dimension: Dimension): boolean {
    const loc = entity.location;

    try {
        const currentBlock = dimension.getBlock({
            x: Math.floor(loc.x),
            y: Math.floor(loc.y),
            z: Math.floor(loc.z)
        });
        if (currentBlock && (currentBlock.isLiquid || currentBlock.typeId.includes("water"))) {
            return Math.random() < CONFIG.WATER_HOP_CHANCE;
        }
    } catch {
        // Block coordinate unloaded or out of dimension bounds
    }

    try {
        const viewDir = entity.getViewDirection();
        const checkX = Math.floor(loc.x + viewDir.x * 0.9);
        const checkY = Math.floor(loc.y);
        const checkZ = Math.floor(loc.z + viewDir.z * 0.9);

        const obstacleBlock = dimension.getBlock({ x: checkX, y: checkY, z: checkZ });
        if (
            obstacleBlock &&
            (obstacleBlock.isSolid || obstacleBlock.typeId.includes("fence") || obstacleBlock.typeId.includes("wall"))
        ) {
            if (Math.random() < CONFIG.OBSTACLE_HOP_CHANCE) {
                return true;
            }
        }
    } catch {
        // Spatial query out of bounds
    }

    try {
        const nearby = dimension.getEntities({
            location: loc,
            maxDistance: CONFIG.CROWD_RADIUS,
            excludeFamilies: ["inanimate", "player", "monster"]
        });

        let passiveNeighbors = 0;
        for (const n of nearby) {
            if (n.id !== entity.id && PASSIVE_MOBS.has(n.typeId)) {
                passiveNeighbors++;
            }
        }

        if (passiveNeighbors > 0 && Math.random() < CONFIG.CROWD_HOP_CHANCE) {
            return true;
        }
    } catch {
        // Transient entity query failure
    }

    return Math.random() < CONFIG.WANDER_HOP_CHANCE;
}

export function doHop(entity: Entity): void {
    const isChicken = entity.typeId === "minecraft:chicken";
    const hopCount = isChicken ? 1 : 1 + Math.floor(Math.random() * 2);

    for (let i = 0; i < hopCount; i++) {
        system.runTimeout(() => {
            try {
                if (!entity.isValid) return;
                const v = entity.getVelocity();
                if (Math.abs(v.y) > 0.15) return;

                const viewDir = entity.getViewDirection();
                entity.applyImpulse({
                    x: viewDir.x * CONFIG.FORWARD_IMPULSE,
                    y: CONFIG.JUMP_IMPULSE_Y,
                    z: viewDir.z * CONFIG.FORWARD_IMPULSE
                });
            } catch {
                // Entity despawned during staggered impulse timeout
            }
        }, i * 12);
    }
}

/**
 * Player-scoped generator job to prevent O(N^2) global dimension queries.
 * Scans active player view radii for passive animals and applies Beta hop physics.
 */
function tryAnimalHop(entity: Entity, dimension: Dimension, currentTick: number): void {
    const hurtEnd = hurtCooldowns.get(entity.id);
    if (hurtEnd && currentTick < hurtEnd) return;
    if (hurtEnd) hurtCooldowns.delete(entity.id);

    const jumpEnd = jumpCooldowns.get(entity.id);
    if (jumpEnd && currentTick < jumpEnd) return;

    try {
        const vel = entity.getVelocity();
        if (Math.abs(vel.y) > 0.15) return;
    } catch {
        return;
    }

    if (!evaluateHopConditions(entity, dimension)) return;

    doHop(entity);

    const cooldown = CONFIG.JUMP_COOLDOWN_MIN +
        Math.floor(Math.random() * (CONFIG.JUMP_COOLDOWN_MAX - CONFIG.JUMP_COOLDOWN_MIN));
    jumpCooldowns.set(entity.id, currentTick + cooldown);
}

export function* animalJumpJob(): Generator<void, void, unknown> {
    const playerIds = world.getAllPlayers().map(p => p.id);
    if (playerIds.length === 0) return;

    const currentTick = tickManager.getCurrentTick();
    const processedIds = new Set<string>();
    let evaluated = 0;

    for (const playerId of playerIds) {
        const player = world.getAllPlayers().find(p => p.id === playerId);
        if (!player || !player.isValid) continue;

        let animalIds: string[];
        try {
            const nearby = player.dimension.getEntities({
                location: player.location,
                maxDistance: CONFIG.PLAYER_RADIUS
            });
            animalIds = nearby.filter(e => PASSIVE_MOBS.has(e.typeId)).map(e => e.id);
        } catch (e) {
            reportError({
                system: "betaAnimalAI",
                operation: "getEntitiesNearbyPlayer",
                target: player.name
            }, e);
            continue;
        }

        for (const animalId of animalIds) {
            const currentPlayer = world.getAllPlayers().find(p => p.id === playerId);
            if (!currentPlayer || !currentPlayer.isValid) break;

            const entity = world.getEntity(animalId);
            if (!entity || !entity.isValid) continue;
            if (processedIds.has(entity.id)) continue;
            processedIds.add(entity.id);

            try {
                tryAnimalHop(entity, currentPlayer.dimension, currentTick);
            } catch (e) {
                reportError({
                    system: "betaAnimalAI",
                    operation: "processAnimal",
                    target: entity.id
                }, e);
            }

            evaluated++;
            if (evaluated % CONFIG.ANIMALS_PER_TICK === 0) {
                yield;
            }
        }
    }
}

export function cleanupCooldowns(): void {
    const currentTick = tickManager.getCurrentTick();

    if (jumpCooldowns.size > CONFIG.MAX_MAP_SIZE) jumpCooldowns.clear();
    if (hurtCooldowns.size > CONFIG.MAX_MAP_SIZE) hurtCooldowns.clear();

    for (const [id, time] of jumpCooldowns) {
        if (time < currentTick) jumpCooldowns.delete(id);
    }
    for (const [id, time] of hurtCooldowns) {
        if (time < currentTick) hurtCooldowns.delete(id);
    }
}

tickManager.register("betaAnimalAI:jump", CONFIG.CHECK_INTERVAL, animalJumpJob, 25);
tickManager.register("betaAnimalAI:cleanup", CONFIG.CLEANUP_INTERVAL, cleanupCooldowns, 50);
