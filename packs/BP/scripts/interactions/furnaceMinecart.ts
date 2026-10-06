import { world, system, Dimension, Entity, Vector3, EntityComponentTypes } from "@minecraft/server";
import { eventBus } from "../core/eventBus.js";
import { tickManager } from "../core/tickManager.js";
import { reportError } from "../core/errorReporter.js";
import { END_KEY, NETHER_KEY, OVERWORLD_KEY } from "../core/betaConstants.js";
import { magnitude, normalizeXZ, scale } from "../core/vectorMath.js";

const CONFIG = Object.freeze({
    FURNACE_TYPE_ID: "ubd:furnace_minecart",
    FUEL_TICKS_PER_COAL: 720,
    IMPULSE_FORCE: 9,
    TICK_INTERVAL: 2,
    SCAN_INTERVAL: 20,
    MAX_INTERACTION_DISTANCE: 2,
    MIN_SPEED_THRESHOLD: 0.35
});

const PUSHABLE_CART_TYPES = Object.freeze(new Set([
    "minecraft:minecart",
    "minecraft:chest_minecart",
    "minecraft:hopper_minecart",
    "minecraft:tnt_minecart"
]));

const activeIntervals = new Map<string, number>();

const DIMENSION_IDS = Object.freeze([OVERWORLD_KEY, NETHER_KEY, END_KEY] as const);

function getAvailableDimensions(): Dimension[] {
    const resolved: Dimension[] = [];
    for (const dimId of DIMENSION_IDS) {
        try {
            resolved.push(world.getDimension(dimId));
        } catch (e) {
            reportError({
                system: "furnaceMinecart",
                operation: "getDimension",
                target: dimId
            }, e);
        }
    }
    return resolved;
}

function isValidFuelTime(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isValidPositionJson(raw: unknown): Vector3 | null {
    if (typeof raw !== "string") return null;
    try {
        const parsed: unknown = JSON.parse(raw);
        if (
            typeof parsed === "object" &&
            parsed !== null &&
            "x" in parsed &&
            "y" in parsed &&
            "z" in parsed
        ) {
            const pos = parsed;
            if (
                typeof pos.x === "number" && Number.isFinite(pos.x) &&
                typeof pos.y === "number" && Number.isFinite(pos.y) &&
                typeof pos.z === "number" && Number.isFinite(pos.z)
            ) {
                return { x: pos.x, y: pos.y, z: pos.z };
            }
        }
    } catch {
        return null;
    }
    return null;
}

const FurnaceState = {
    getFuel(entity: Entity): number {
        try {
            const raw = entity.getDynamicProperty("fuelTime");
            if (isValidFuelTime(raw)) {
                return Math.floor(raw);
            }
            if (raw !== undefined) {
                reportError({
                    system: "furnaceMinecart",
                    operation: "readFuelTimeInvalid",
                    target: entity.id,
                    details: { raw: typeof raw === "object" ? JSON.stringify(raw) : String(raw) }
                }, "Invalid fuelTime property");
                entity.setDynamicProperty("fuelTime", 0);
            }
        } catch (e) {
            reportError({
                system: "furnaceMinecart",
                operation: "readFuelTime",
                target: entity.id
            }, e);
        }
        return 0;
    },
    setFuel(entity: Entity, ticks: number): void {
        const validTicks = isValidFuelTime(ticks) ? Math.floor(ticks) : 0;
        try {
            entity.setDynamicProperty("fuelTime", validTicks);
        } catch (e) {
            reportError({
                system: "furnaceMinecart",
                operation: "setFuelTime",
                target: entity.id
            }, e);
        }
    },
    decrementFuel(entity: Entity): number {
        const current = FurnaceState.getFuel(entity);
        const updated = Math.max(0, current - 1);
        FurnaceState.setFuel(entity, updated);
        return updated;
    },
    getLastPosition(entity: Entity): Vector3 {
        try {
            const raw = entity.getDynamicProperty("lastPosition");
            if (raw !== undefined) {
                const parsed = isValidPositionJson(raw);
                if (parsed) {
                    return parsed;
                }
                reportError({
                    system: "furnaceMinecart",
                    operation: "parseLastPosition",
                    target: entity.id
                }, "Malformed lastPosition property");
                entity.setDynamicProperty("lastPosition", JSON.stringify(entity.location));
            }
        } catch (e) {
            reportError({
                system: "furnaceMinecart",
                operation: "readLastPosition",
                target: entity.id
            }, e);
        }
        return entity.location;
    },
    updateLastPosition(entity: Entity, currentPos: Vector3, lastPos: Vector3): void {
        if (currentPos.x !== lastPos.x || currentPos.y !== lastPos.y || currentPos.z !== lastPos.z) {
            try {
                entity.setDynamicProperty("lastPosition", JSON.stringify(currentPos));
            } catch (e) {
                reportError({
                    system: "furnaceMinecart",
                    operation: "updateLastPosition",
                    target: entity.id
                }, e);
            }
        }
    }
};

function isOnRail(entity: Entity): boolean {
    try {
        const block = entity.dimension.getBlock(entity.location);
        return Boolean(block?.typeId.includes("minecraft:") && block?.typeId.includes("rail"));
    } catch {
        return false;
    }
}

function pushNearbyCarts(furnaceCart: Entity): boolean {
    let pushedCart = false;
    try {
        const nearbyEntities = furnaceCart.dimension.getEntities({
            location: furnaceCart.location,
            maxDistance: CONFIG.MAX_INTERACTION_DISTANCE
        }).filter((target) => PUSHABLE_CART_TYPES.has(target.typeId) && target.id !== furnaceCart.id);

        for (const nearbyCart of nearbyEntities) {
            const dir = normalizeXZ({
                x: nearbyCart.location.x - furnaceCart.location.x,
                z: nearbyCart.location.z - furnaceCart.location.z
            });
            const pushVector = scale(dir, CONFIG.IMPULSE_FORCE);
            nearbyCart.applyImpulse(pushVector);
            pushedCart = true;
        }
    } catch (e) {
        reportError({
            system: "furnaceMinecart",
            operation: "pushNearbyCarts",
            target: furnaceCart.id
        }, e);
    }
    return pushedCart;
}

function applyMovementImpulse(entity: Entity, movementDir: Vector3, onRail: boolean): void {
    if (!onRail) {
        entity.clearVelocity();
        return;
    }

    const currentVelocity = entity.getVelocity();
    const currentSpeed = magnitude(currentVelocity);

    const hasMovement = Math.abs(movementDir.x) > 0.01 || Math.abs(movementDir.z) > 0.01;
    if (!hasMovement && currentSpeed >= CONFIG.MIN_SPEED_THRESHOLD) {
        return;
    }

    const hitCart = pushNearbyCarts(entity);
    const impulseMultiplier = (currentSpeed < CONFIG.MIN_SPEED_THRESHOLD && !hitCart) ? -1 : 1;
    const impulse = scale(scale(movementDir, impulseMultiplier), CONFIG.IMPULSE_FORCE);

    entity.applyImpulse(impulse);
}

function stopMinecartMovement(entityId: string, entity?: Entity): void {
    const intervalId = activeIntervals.get(entityId);
    if (intervalId !== undefined) {
        system.clearRun(intervalId);
        activeIntervals.delete(entityId);
    }

    if (entity?.isValid) {
        try {
            entity.clearVelocity();
            entity.triggerEvent("unfueled");
        } catch (e) {
            reportError({
                system: "furnaceMinecart",
                operation: "stopMovement",
                target: entityId
            }, e);
        }
    }
}

function runMinecartStep(entity: Entity, entityId: string): void {
    if (!entity.isValid) {
        stopMinecartMovement(entityId);
        return;
    }

    const remainingFuel = FurnaceState.decrementFuel(entity);
    if (remainingFuel <= 0) {
        stopMinecartMovement(entityId, entity);
        return;
    }

    const currentPos = entity.location;
    const lastPos = FurnaceState.getLastPosition(entity);
    const movementDir = normalizeXZ({
        x: currentPos.x - lastPos.x,
        z: currentPos.z - lastPos.z
    });

    FurnaceState.updateLastPosition(entity, currentPos, lastPos);

    try {
        const onRail = isOnRail(entity);
        applyMovementImpulse(entity, movementDir, onRail);
    } catch (e) {
        reportError({
            system: "furnaceMinecart",
            operation: "runStep",
            target: entityId
        }, e);
    }
}

function startMinecartMovement(entity: Entity): void {
    const entityId = entity.id;
    if (activeIntervals.has(entityId)) return;

    const intervalId = system.runInterval(() => {
        runMinecartStep(entity, entityId);
    }, CONFIG.TICK_INTERVAL);

    activeIntervals.set(entityId, intervalId);
}

const FUEL_ITEM_IDS: ReadonlySet<string> = Object.freeze(new Set(["minecraft:coal", "minecraft:charcoal"]));

function startFueledMinecart(entity: Entity): void {
    FurnaceState.setFuel(entity, CONFIG.FUEL_TICKS_PER_COAL);
    entity.setDynamicProperty("lastPosition", JSON.stringify(entity.location));
    startMinecartMovement(entity);
}

eventBus.onPlayerInteractWithEntity((e) => {
    const { target: entity, itemStack } = e;
    // Beta burned any fuel item in the hand; charcoal and coal were interchangeable (1600 ticks each).
    if (!itemStack || !FUEL_ITEM_IDS.has(itemStack.typeId)) return;
    if (entity.typeId !== CONFIG.FURNACE_TYPE_ID) return;

    const variant = entity.getComponent(EntityComponentTypes.Variant);
    if (variant && variant.value === 0) {
        system.runTimeout(() => {
            if (entity.isValid) {
                entity.triggerEvent("fueled");
                startFueledMinecart(entity);
            }
        }, 1);
    }
});

function sweeperJob(): void {
    const dimensions = getAvailableDimensions();
    if (dimensions.length === 0) return;

    for (const dimension of dimensions) {
        try {
            const entities = dimension.getEntities({ type: CONFIG.FURNACE_TYPE_ID });
            for (const entity of entities) {
                if (FurnaceState.getFuel(entity) > 0 && !activeIntervals.has(entity.id)) {
                    startMinecartMovement(entity);
                }
            }
        } catch (e) {
            reportError({
                system: "furnaceMinecart",
                operation: "sweeperScan",
                target: dimension.id
            }, e);
        }
    }
}

tickManager.register("furnaceMinecart:sweeper", CONFIG.SCAN_INTERVAL, sweeperJob, 7);
