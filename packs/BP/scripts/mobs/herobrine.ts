import {
    world,
    system,
    CommandPermissionLevel,
    CustomCommandStatus,
    Dimension,
    Entity,
    Player
} from "@minecraft/server";
import type { CustomCommandOrigin, Vector3 } from "@minecraft/server";
import { tickManager } from "../core/tickManager.js";
import { reportError, runCatching } from "../core/errorReporter.js";

const ENTITY_ID = "bh:herobrine";

const CONFIG = Object.freeze({
    /** How often the scheduler wakes up to compare the world clock against its timer. */
    SWEEP_INTERVAL_TICKS: 20,
    /** Long, quiet first window so a freshly loaded world never opens with an apparition. */
    INITIAL_GAP_MIN_TICKS: 6000,
    INITIAL_GAP_MAX_TICKS: 18000,
    /** Later windows are re-rolled after each wake-up, so the schedule never settles into a rhythm. */
    GAP_MIN_TICKS: 1200,
    GAP_MAX_TICKS: 7200,
    /** Deliberately low and entirely flat: no trigger, no escalation, no memory of past sightings. */
    SIGHTING_CHANCE: 0.12,
    MIN_DISTANCE: 12,
    MAX_DISTANCE: 40,
    /** Widest sideways spread off the player's facing, in radians. Keeps him out of the crosshair. */
    MIN_SPREAD_RADIANS: 0.26,
    MAX_SPREAD_RADIANS: 1.03,
    /** Any player this close ends the sighting. */
    VANISH_RADIUS: 4.7,
    /**
     * No sighting may be placed this close to any player. Kept at or above the vanish radius so a
     * spawn is never created already doomed to dismiss itself on the next maintenance pass.
     */
    SPAWN_CLEARANCE: 5,
    /** The apparition dissolves once nobody is left within this radius. */
    FORGET_RADIUS: 56,
    /** Hard ceiling so a single sighting never lingers. */
    LIFETIME_TICKS: 600,
    LOOK_RADIUS: 44,
    /** Cone width, either side of a player's crosshair, that counts as looking straight at him. */
    LOOK_CONE_DEGREES: 30,
    CAVE_VOLUME_MIN: 0.5,
    CAVE_VOLUME_MAX: 0.9,
    CAVE_PITCH_MIN: 0.6,
    CAVE_PITCH_MAX: 1.0,
    SPAWN_ATTEMPTS: 12
});

const CAVE_SOUND = "ambient.cave";

const LOOK_CONE_COS = Math.cos((CONFIG.LOOK_CONE_DEGREES * Math.PI) / 180);

const POSES: readonly string[] = Object.freeze([
    "animation.herobrine.stand",
    "animation.herobrine.sneak"
]);

// Distant sightings can sit a fair way above or below the player, so the footing search is wide.
const FOOTING_OFFSETS: readonly number[] = Object.freeze([0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, -7, -8]);

interface Sighting {
    readonly entityId: string;
    readonly dimensionId: string;
    readonly expiresAtTick: number;
}

/**
 * Only one apparition may exist at a time across the whole server; multiplayer visibility comes
 * from the fact that every player renders the same entity, not from per-player instances.
 */
let sighting: Sighting | null = null;

/**
 * Distance for a sighting. Squaring the uniform sample skews the spread hard toward the far end,
 * so most apparitions are distant shapes on the horizon rather than something in the player's face.
 */
export function pickSightDistance(): number {
    const skew = 1 - Math.random() ** 2;
    return CONFIG.MIN_DISTANCE + skew * (CONFIG.MAX_DISTANCE - CONFIG.MIN_DISTANCE);
}

/**
 * Randomised gaps are what keep the appearance schedule from ever becoming predictable: the next
 * window is drawn fresh each time instead of accumulating toward a guaranteed appearance.
 */
export function pickRollDelayTicks(first: boolean): number {
    const min = first ? CONFIG.INITIAL_GAP_MIN_TICKS : CONFIG.GAP_MIN_TICKS;
    const max = first ? CONFIG.INITIAL_GAP_MAX_TICKS : CONFIG.GAP_MAX_TICKS;
    return min + Math.floor(Math.random() * (max - min));
}

/** Bedrock yaw pointing `from` at `to`: yaw 0 faces +Z, 90 faces -X. */
export function facingYaw(from: Vector3, to: Vector3): number {
    return Math.atan2(-(to.x - from.x), to.z - from.z) * (180 / Math.PI);
}

/** Whether `toTarget` falls inside the look cone around a player's normalised `view` direction. */
export function isWithinLookCone(view: Vector3, toTarget: Vector3): boolean {
    const length = Math.hypot(toTarget.x, toTarget.y, toTarget.z);
    if (length < 1e-3) return true;

    const alignment = (view.x * toTarget.x + view.y * toTarget.y + view.z * toTarget.z) / length;
    return alignment >= LOOK_CONE_COS;
}

export function hasActiveSighting(): boolean {
    return sighting !== null;
}

function horizontalDistance(a: Vector3, b: Vector3): number {
    return Math.hypot(a.x - b.x, a.z - b.z);
}

function isFooting(dimension: Dimension, x: number, y: number, z: number): boolean {
    try {
        const ground = dimension.getBlock({ x, y: y - 1, z });
        const feet = dimension.getBlock({ x, y, z });
        const head = dimension.getBlock({ x, y: y + 1, z });
        if (!ground || !feet || !head) return false;
        if (!ground.isSolid || ground.isLiquid) return false;
        return feet.isAir && head.isAir;
    } catch {
        // Unloaded chunk or out-of-bounds query
        return false;
    }
}

function findFootingY(dimension: Dimension, x: number, z: number, baseY: number): number | null {
    for (const offset of FOOTING_OFFSETS) {
        if (isFooting(dimension, x, baseY + offset, z)) {
            return baseY + offset;
        }
    }
    return null;
}

function isSpotVacant(dimension: Dimension, location: Vector3, excludeId: string): boolean {
    for (const player of dimension.getPlayers({ location, maxDistance: CONFIG.SPAWN_CLEARANCE })) {
        if (player.id !== excludeId) return false;
    }
    return true;
}

/**
 * Picks a standable spot off to one side of the target's field of view. Spawning square in front
 * would read as an ambush; a side offset makes him something the player has to notice.
 */
function pickSpawnLocation(target: Player): Vector3 | null {
    const dimension = target.dimension;
    const origin = target.location;
    const view = target.getViewDirection();
    const baseAngle = Math.atan2(view.x, view.z);
    const baseY = Math.floor(origin.y);

    for (let attempt = 0; attempt < CONFIG.SPAWN_ATTEMPTS; attempt++) {
        const spreadRange = CONFIG.MAX_SPREAD_RADIANS - CONFIG.MIN_SPREAD_RADIANS;
        const spread = (CONFIG.MIN_SPREAD_RADIANS + Math.random() * spreadRange) * (Math.random() < 0.5 ? -1 : 1);
        const angle = baseAngle + spread;
        const distance = pickSightDistance();

        const x = Math.floor(origin.x + Math.sin(angle) * distance);
        const z = Math.floor(origin.z + Math.cos(angle) * distance);

        const y = findFootingY(dimension, x, z, baseY);
        if (y === null) continue;

        const location = { x: x + 0.5, y, z: z + 0.5 };
        if (!isSpotVacant(dimension, location, target.id)) continue;

        return location;
    }

    return null;
}

function dismiss(entity: Entity): void {
    runCatching(
        { system: "herobrine", operation: "dismissApparition", target: entity.id },
        () => entity.remove()
    );
    sighting = null;
}

function isLookingAt(player: Player, entity: Entity): boolean {
    const eyes = player.getHeadLocation();
    const target = entity.location;

    return isWithinLookCone(player.getViewDirection(), {
        x: target.x - eyes.x,
        y: target.y + 1.6 - eyes.y,
        z: target.z - eyes.z
    });
}

function playCaveNoise(target: Player): void {
    runCatching(
        { system: "herobrine", operation: "playCaveNoise", target: target.name },
        () => target.playSound(CAVE_SOUND, {
            volume: CONFIG.CAVE_VOLUME_MIN + Math.random() * (CONFIG.CAVE_VOLUME_MAX - CONFIG.CAVE_VOLUME_MIN),
            pitch: CONFIG.CAVE_PITCH_MIN + Math.random() * (CONFIG.CAVE_PITCH_MAX - CONFIG.CAVE_PITCH_MIN)
        })
    );
}

function reveal(entityId: string): void {
    const pose = POSES[Math.floor(Math.random() * POSES.length)];
    system.runTimeout(() => {
        const entity = world.getEntity(entityId);
        if (!entity?.isValid) return;
        runCatching(
            { system: "herobrine", operation: "playPose", target: entityId },
            () => entity.playAnimation(pose)
        );
    }, 1);
}

function attemptAppearance(target: Player): boolean {
    const location = pickSpawnLocation(target);
    if (!location) return false;

    let entity: Entity;
    try {
        entity = target.dimension.spawnEntity<typeof ENTITY_ID>(ENTITY_ID, location);
        entity.setRotation({ x: 0, y: facingYaw(location, target.location) });
    } catch (e) {
        reportError({
            system: "herobrine",
            operation: "spawnApparition",
            target: target.name
        }, e);
        return false;
    }

    sighting = {
        entityId: entity.id,
        dimensionId: entity.dimension.id,
        expiresAtTick: system.currentTick + CONFIG.LIFETIME_TICKS
    };

    reveal(entity.id);
    playCaveNoise(target);
    return true;
}

/**
 * Forces a sighting outside the normal rarity roll. Used by the operator `/appear` command so the
 * system can be demonstrated without waiting out the timer.
 */
export function forceAppearance(preferred?: Player): boolean {
    const players = world.getAllPlayers().filter((player) => player.isValid);
    if (players.length === 0) return false;

    if (sighting) {
        const existing = world.getEntity(sighting.entityId);
        if (existing?.isValid) dismiss(existing);
        else sighting = null;
    }

    const target = preferred?.isValid ? preferred : players[Math.floor(Math.random() * players.length)];
    return attemptAppearance(target);
}

function clearSighting(): void {
    sighting = null;
}

/**
 * Wind-up timer for the next possible sighting, on the world clock. -1 means the first window has
 * not been drawn yet since scripts loaded.
 */
let nextRollTick = -1;

function rollSweep(): void {
    const now = system.currentTick;

    if (nextRollTick < 0) {
        nextRollTick = now + pickRollDelayTicks(true);
        return;
    }

    if (now < nextRollTick) return;

    // Consume the window either way: a sighting must never chain straight into the next window.
    nextRollTick = now + pickRollDelayTicks(false);

    if (sighting) return;

    const players = world.getAllPlayers().filter((player) => player.isValid);
    if (players.length === 0) return;
    if (Math.random() >= CONFIG.SIGHTING_CHANCE) return;

    attemptAppearance(players[Math.floor(Math.random() * players.length)]);
}

function maintainSighting(): void {
    const record = sighting;
    if (!record) return;

    const entity = world.getEntity(record.entityId);
    if (!entity?.isValid || entity.dimension.id !== record.dimensionId) {
        clearSighting();
        return;
    }

    if (system.currentTick >= record.expiresAtTick) {
        dismiss(entity);
        return;
    }

    let nearest = Infinity;

    for (const player of world.getAllPlayers()) {
        if (!player.isValid || player.dimension.id !== record.dimensionId) continue;

        const distance = horizontalDistance(player.location, entity.location);
        if (distance < nearest) nearest = distance;

        if (distance <= CONFIG.VANISH_RADIUS) {
            dismiss(entity);
            return;
        }

        if (distance <= CONFIG.LOOK_RADIUS && isLookingAt(player, entity)) {
            dismiss(entity);
            return;
        }
    }

    if (nearest > CONFIG.FORGET_RADIUS) {
        dismiss(entity);
    }
}

system.beforeEvents.startup.subscribe(({ customCommandRegistry }) => {
    customCommandRegistry.registerCommand(
        {
            name: "betafied:appear",
            description: "Force a Herobrine sighting.",
            permissionLevel: CommandPermissionLevel.Admin,
            cheatsRequired: false
        },
        (origin: CustomCommandOrigin) => {
            if (world.getAllPlayers().length === 0) {
                return { status: CustomCommandStatus.Failure, message: "No players are online." };
            }

            const source = origin.sourceEntity;
            const preferred = source instanceof Player ? source : undefined;

            system.run(() => {
                if (!forceAppearance(preferred)) {
                    console.warn("herobrine: /appear could not find a valid spot");
                }
            });

            return { status: CustomCommandStatus.Success, message: "Herobrine stirs..." };
        }
    );
});

tickManager.register("herobrine:sweep", CONFIG.SWEEP_INTERVAL_TICKS, rollSweep, 120);
tickManager.register("herobrine:maintain", 10, maintainSighting, 130);
