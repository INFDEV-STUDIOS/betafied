import { world, GameMode, EntityComponentTypes, ItemStack } from "@minecraft/server";
import type { Block, BlockPermutation, Dimension, Entity, Vector3 } from "@minecraft/server";
import { tickManager } from "../core/tickManager.js";
import { eventBus } from "../core/eventBus.js";
import { runCatching, reportError } from "../core/errorReporter.js";
import { BH_FENCE_ID } from "../core/betaRegistry.js";

/**
 * Beta 1.7.3 farmland trampling.
 *
 * The era's rule belonged to the *engine*, not to the farmland block: `Entity.moveEntity` resolved the
 * walked block as `floor(posY - 0.2)`, fired that block's `onEntityWalking` once per 1/0.6 blocks of
 * horizontal travel, and `BlockFarmland.onEntityWalking` answered with `rand.nextInt(4) == 0` -> dirt.
 * Three lines of that same call site are why this is more than "a player touched farmland":
 *   - the block *below* the walked block replaced it whenever it was a fence. Fences have no walking
 *     behaviour, so farmland sitting on one could never be trampled — the old "farms on fences keep
 *     their crops" trick.
 *   - the callback was skipped outright while the entity was sneaking on the ground, and while it was
 *     riding anything (`ridingEntity == null`).
 *
 * Bedrock kept neither half. It tramples farmland only when something *lands* on it (`fallDistance`
 * based, which 1.7.3 never looked at: a standing jump trampled nothing because no horizontal travel
 * happened), and it always tramples, fence or no fence. So this module owns both sides: it re-adds the
 * walking rule, and it puts back the tiles the engine's landing rule takes, which is the only way to
 * express "jumping on your farm does not destroy it" on this engine.
 *
 * The landing half cannot be prevented, only undone: the engine converts the block inside its own tick
 * with no script hook in front of it. Every tile an entity stands over is snapshotted each pass, so the
 * tile a fall lands on was already recorded before the engine took it. That costs one tick of dirt and
 * one popped crop — see `BETA_POLICY_GAPS.md`.
 */

/**
 * Whether the era's walking rule applies to this mode.
 *
 * Creative and Spectator have no Beta counterpart, so behaviour this module *adds* stays out of both: a
 * builder flying over a farm should not convert it back to dirt. The landing guard deliberately does not
 * consult this. That half exists to undo an engine behaviour the era never had, and the engine tramples in
 * Creative exactly as readily as in Survival — a builder jumping on their own farm is the case that
 * exposed the difference.
 */
function walkRuleApplies(mode: GameMode | undefined): boolean {
    return mode !== GameMode.Creative && mode !== GameMode.Spectator;
}

const CONFIG = Object.freeze({
    // Beta sampled per move, which is once a tick. The step cadence is measured in distance, so
    // spacing the mob sweep out does not change how many blocks an animal tramples per walk — it only
    // coarsens where a step lands, by about half a block.
    MOB_INTERVAL: 2,
    MOB_RADIUS: 24,
    /** `distanceWalkedModified += horizontalDelta * 0.6`. */
    DISTANCE_WALKED_MODIFIER: 0.6,
    /** `floor(posY - 0.2)` — the walked block, not the crop block, is what Beta asked. */
    WALKED_BLOCK_OFFSET: 0.2,
    /** `rand.nextInt(4) == 0`. */
    TRAMPLE_ROLL: 4,
    // Beta's movement never carried an entity a whole block between two ticks. A jump this large is a
    // teleport, and counting it as walked distance would fire a step (and possibly a trample) purely
    // from arriving somewhere.
    TELEPORT_DISTANCE: 3,
    // A falling entity can cross more than a block between two passes, so the tile it is falling
    // towards is found by walking down the first few cells rather than only the cell under its feet.
    LANDING_SCAN_DEPTH: 5,
    // A landing tick can be the tick the entity crosses a block boundary, and a sprint-jump or elytra
    // can cross several, so the columns this pass's travel heads into are recorded too.
    LANDING_LOOKAHEAD: 3,
    // ...but the lookahead is capped by a read budget per pass, so a fast glide cannot turn one pass
    // into a sweep of every column of terrain under it. The tile under the entity is always read first.
    LANDING_READ_BUDGET: 12,
    // A landing watch outlives the landing itself: the engine converts the block inside its tick and
    // this pass may only get to look at it on the next one.
    WATCH_TICKS: 30,
    // The crop's own drops land in the crop cell, so the sweep is measured from that cell's centre and
    // kept under a block: a wider radius would reach into a neighbouring tile and take the legitimate
    // drops of a farm that an entity trampled next door on the same tick.
    DROP_CLEAR_RADIUS: 0.9,
    MAX_TRACKED_WALKERS: 1024,
    STALE_WALKER_TICKS: 1200
});

const FARMLAND_ID = "minecraft:farmland";
const DIRT_ID = "minecraft:dirt";
const AIR_ID = "minecraft:air";
const WHEAT_ID = "minecraft:wheat";
const WHEAT_SEEDS_ID = "minecraft:wheat_seeds";

/** `BlockCrops`' `meta == 7` ripeness check, and the three `nextInt(15) <= meta` seed rolls. */
const GROWTH_STATE = "growth";
const RIPE_GROWTH = 7;
const SEED_ROLLS = 3;
const SEED_ROLL_FACES = 15;

/**
 * What a crop leaves behind when the engine breaks it, so a restored crop does not also leave a free
 * harvest on the ground. `minecraft:seeds` is the legacy id the same drop answers to.
 */
const CROP_DROP_IDS: readonly string[] = ["minecraft:wheat", "minecraft:wheat_seeds", "minecraft:seeds"];

/**
 * Entities that never "walk" in the era's sense. Drops are pushed around rather than moved, and
 * projectile spam would otherwise be swept every pass. Held at module scope so the sweep does not
 * hand the engine a fresh array every pass.
 */
const NON_WALKING_TYPES = ["minecraft:item", "minecraft:xp_orb", "minecraft:experience_orb"];

/**
 * Types an entity can be standing *in* rather than on, which the downward scan has to read past to reach
 * the tile a fall is heading for.
 *
 * `Block.isSolid` answers this in one call, but the generated docs carry it inside an
 * `=minecraft-bedrock-experimental` moniker — a pre-release property whose signature may change — so the
 * small set this guard actually meets is spelled out instead of the guard depending on it. Reading past
 * too much is harmless (a deeper farmland becomes a watch that never fires); stopping too early is the
 * failure that loses a farm, so the set errs wide.
 */
const PASSABLE_TYPES = new Set([
    "minecraft:air",
    "minecraft:cave_air",
    "minecraft:void_air",
    "minecraft:water",
    "minecraft:flowing_water",
    "minecraft:lava",
    "minecraft:flowing_lava",
    "minecraft:wheat",
    "minecraft:carrots",
    "minecraft:potatoes",
    "minecraft:beetroot",
    "minecraft:pumpkin_stem",
    "minecraft:melon_stem",
    "minecraft:torchflower_crop",
    "minecraft:pitcher_crop"
]);

export interface WalkState {
    lastX: number;
    lastZ: number;
    /** Beta's `distanceWalkedModified`, in blocks of horizontal travel times 0.6. */
    distance: number;
    /** Beta's `nextStepDistance`, a per-entity counter that never resets. */
    nextStep: number;
    lastSeen: number;
}

interface WatchedLanding {
    location: Vector3;
    farmland: BlockPermutation;
    /** The crop the farmland was holding, when it held one. The engine pops it with the trample. */
    crop?: BlockPermutation;
    expiresAt: number;
}

const walkers = new Map<string, WalkState>();
/** Keyed by entity id: one entity can have watches on the columns it is crossing at once. */
const landings = new Map<string, WatchedLanding[]>();

let mobSweepDue = false;

/** Coordinates alone collide the Overworld with the Nether, so every tile key carries its dimension. */
export function tileKey(dimensionId: string, location: Vector3): string {
    return `${dimensionId}:${location.x},${location.y},${location.z}`;
}

/** The block Beta resolved a walk against: the block under the entity's feet, offset by 0.2. */
export function walkedBlockLocation(x: number, y: number, z: number): Vector3 {
    return {
        x: Math.floor(x),
        y: Math.floor(y - CONFIG.WALKED_BLOCK_OFFSET),
        z: Math.floor(z)
    };
}

/**
 * Advances the walk accumulator and reports whether this move fired a step event.
 *
 * Beta raised the counter by exactly one per firing, so a single large move produces one step rather
 * than one per block of overshoot — that is what keeps the cadence at roughly one step per 1.667
 * blocks regardless of how fast the entity is travelling.
 */
export function consumeStep(state: WalkState, horizontalDelta: number): boolean {
    state.distance += horizontalDelta * CONFIG.DISTANCE_WALKED_MODIFIER;
    if (state.distance <= state.nextStep) return false;
    state.nextStep += 1;
    return true;
}

/**
 * Beta swapped the walked block for the block beneath it when that was a fence, which is the entirety
 * of the farm-on-fences immunity: a fence has no walking behaviour to run.
 *
 * Every held fence retypes onto `bh:fence` (`inventoryManager`), but world generation still leaves
 * vanilla fences in terrain, so the family check covers both spellings. Fence *gates* are deliberately
 * not in the family: 1.7.3 knew only the fence block, and `oak_fence_gate` does not end in `_fence`.
 */
export function isFenceBlock(typeId: string): boolean {
    return typeId === BH_FENCE_ID || typeId === "minecraft:fence" || typeId.endsWith("_fence");
}

/**
 * The farmland a step event would trample, or `undefined` when there is nothing to trample: the walked
 * block is not farmland, or a fence sits directly beneath it.
 *
 * Block reads raise on an unloaded chunk, so this is a caller-side `try` away from the world and must
 * not be cached across ticks.
 */
export function resolveTrampleTarget(dimension: Dimension, walked: Vector3): Block | undefined {
    const block = dimension.getBlock(walked);
    if (block === undefined || block.typeId !== FARMLAND_ID) return undefined;

    const below = dimension.getBlock({ x: walked.x, y: walked.y - 1, z: walked.z });
    if (below === undefined || isFenceBlock(below.typeId)) return undefined;

    return block;
}

export interface CropDrop {
    typeId: string;
    amount: number;
}

/**
 * What breaking a crop leaves behind, straight from the era's drop code.
 *
 * `BlockCrops` (1.7.3) answered the base drop with `idDropped(meta) -> meta == 7 ? Item.wheat : -1`, so a
 * crop only paid out wheat once it was ripe, and then added its own seeds on top:
 *
 *     for (i = 0; i < 3; i++) if (rand.nextInt(15) <= meta) drop(Item.seeds);
 *
 * Three independent rolls, each succeeding with probability `(growth + 1) / 15`. A ripe crop therefore
 * pays one wheat and up to three seeds, and an unripe one pays no guaranteed seed at all — which is not
 * what modern versions hand out, and is exactly the sort of number worth reading off the source rather
 * than remembering.
 *
 * Wheat was the era's only crop: carrots, potatoes, melons and beetroot all arrived later, and the block
 * registry here agrees. Any other crop block growing on a farm is therefore post-Beta and belongs to
 * `compatibilityPolicy`, not to this rule, so this returns `undefined` for it and leaves it standing.
 */
export function cropDropsFor(typeId: string, growth: number, random: () => number = Math.random): CropDrop[] | undefined {
    if (typeId !== WHEAT_ID) return undefined;

    const drops: CropDrop[] = growth === RIPE_GROWTH ? [{ typeId: WHEAT_ID, amount: 1 }] : [];

    let seeds = 0;
    for (let roll = 0; roll < SEED_ROLLS; roll++) {
        if (Math.floor(random() * SEED_ROLL_FACES) <= growth) seeds += 1;
    }
    if (seeds > 0) drops.push({ typeId: WHEAT_SEEDS_ID, amount: seeds });

    return drops;
}

/** The `growth` state every Bedrock crop carries, 0 through 7. */
function growthOf(permutation: BlockPermutation): number {
    const growth = permutation.getState(GROWTH_STATE);
    return typeof growth === "number" ? growth : 0;
}

/**
 * Takes the crop standing on a tile that is about to be trampled, paying the era's drop for it.
 *
 * The engine's own neighbour update is deliberately not relied on to do this. Whether Bedrock pops a crop
 * when the farmland beneath it goes is not something this module can check offline, and a plant left
 * standing on dirt is the visible half of the bug being fixed; breaking it here also means the drop is
 * the era's rather than the modern loot table's.
 */
function breakCrop(dimension: Dimension, farmland: Vector3): void {
    const location = { x: farmland.x, y: farmland.y + 1, z: farmland.z };
    const crop = dimension.getBlock(location);
    if (crop === undefined) return;

    const drops = cropDropsFor(crop.typeId, growthOf(crop.permutation));
    if (drops === undefined) return;

    crop.setType(AIR_ID);

    const center = { x: location.x + 0.5, y: location.y + 0.5, z: location.z + 0.5 };
    for (const drop of drops) {
        dimension.spawnItem(new ItemStack(drop.typeId, drop.amount), center);
    }
}

function sameTile(a: Vector3, b: Vector3): boolean {
    return a.x === b.x && a.y === b.y && a.z === b.z;
}

function resetWalker(state: WalkState, x: number, z: number): void {
    state.lastX = x;
    state.lastZ = z;
    state.distance = 0;
    state.nextStep = 0;
}

/**
 * Retires every landing watch standing on this tile.
 *
 * A trample this module performs is the era's own behaviour and has to survive the supervision below,
 * which would otherwise read the fresh dirt as the engine's work and put the farm back.
 */
function forgetLandingsAt(location: Vector3): void {
    for (const [id, list] of landings) {
        const remaining = list.filter((watch) => !sameTile(watch.location, location));
        if (remaining.length === 0) landings.delete(id);
        else landings.set(id, remaining);
    }
}

/**
 * Records what a tile holds, so it can be put back if the engine's landing trample takes it.
 *
 * This runs for every sampled entity every pass, grounded or airborne, and without asking
 * `Entity.isOnGround` anything: that property is documented to "behave in unexpected ways" (and to read
 * true for a freshly spawned entity), and the one thing this guard cannot afford is to skip the pass
 * before the landing. A grounded entity costs a single read, because the cell under its feet is the
 * block it stands on and the scan stops there.
 *
 * The result is a tile watched *before* the trample, whichever pass the landing happens on.
 */
function captureLanding(
    entity: Entity,
    dimension: Dimension,
    columnX: number,
    columnZ: number,
    feetY: number,
    nowTick: number,
    budget: number
): number {
    const id = entity.id;
    const top = Math.floor(feetY - CONFIG.WALKED_BLOCK_OFFSET);
    let remaining = budget;

    for (let depth = 0; depth < CONFIG.LANDING_SCAN_DEPTH && remaining > 0; depth++) {
        const location = { x: columnX, y: top - depth, z: columnZ };
        const block = dimension.getBlock(location);
        remaining -= 1;
        if (block === undefined) return remaining;

        if (block.typeId === FARMLAND_ID) {
            const crop = dimension.getBlock({ x: columnX, y: location.y + 1, z: columnZ });
            const watch: WatchedLanding = {
                location,
                farmland: block.permutation,
                crop: crop !== undefined && crop.typeId !== AIR_ID ? crop.permutation : undefined,
                expiresAt: nowTick + CONFIG.WATCH_TICKS
            };

            const list = landings.get(id) ?? [];
            const existing = list.findIndex((entry) => sameTile(entry.location, location));
            if (existing >= 0) {
                list[existing] = watch;
            } else {
                list.push(watch);
            }

            landings.set(id, list);
            return remaining;
        }

        // Anything else is a block the entity is standing on, or would land on instead of the farm
        // below it.
        if (!PASSABLE_TYPES.has(block.typeId)) return remaining;
    }

    return remaining;
}

/**
 * Clears the crop drops the engine spawned when it broke the crop we are about to put back.
 *
 * Anchored on the crop cell rather than on the farmland: that is where a popped crop lands, and it is the
 * one place a sweep can look without also taking the drops of a farm trampled next door.
 */
function clearCropDrops(dimension: Dimension, farmland: Vector3): void {
    const drops = dimension.getEntities({
        location: { x: farmland.x + 0.5, y: farmland.y + 1.5, z: farmland.z + 0.5 },
        maxDistance: CONFIG.DROP_CLEAR_RADIUS,
        type: "minecraft:item"
    });

    for (const drop of drops) {
        if (!drop.isValid) continue;

        const stack = drop.getComponent(EntityComponentTypes.Item)?.itemStack;
        if (stack !== undefined && CROP_DROP_IDS.includes(stack.typeId)) drop.remove();
    }
}

function restoreLanding(dimension: Dimension, watch: WatchedLanding): void {
    const farmland = dimension.getBlock(watch.location);
    if (farmland === undefined) return;

    farmland.setPermutation(watch.farmland);

    if (watch.crop !== undefined) {
        const cropCell = dimension.getBlock({ x: watch.location.x, y: watch.location.y + 1, z: watch.location.z });
        // A tile the player has since filled is left filled; only the popped crop is put back.
        if (cropCell !== undefined && cropCell.typeId === AIR_ID) cropCell.setPermutation(watch.crop);
        clearCropDrops(dimension, watch.location);
    }
}

/**
 * Drops every watch whose tile is no longer dirt, keeping the list compacted in place.
 *
 * Anything but dirt (air, a placed block) means the tile was taken by something other than a landing,
 * so that watch is dropped without a word.
 */
function pruneLandingWatch(dimension: Dimension, list: WatchedLanding[], nowTick: number): void {
    let kept = 0;

    for (const watch of list) {
        if (nowTick > watch.expiresAt) continue;

        const block = dimension.getBlock(watch.location);
        if (block === undefined) {
            list[kept++] = watch;
            continue;
        }

        if (block.typeId === FARMLAND_ID) {
            list[kept++] = watch;
            continue;
        }

        if (block.typeId === DIRT_ID) restoreLanding(dimension, watch);
    }

    list.length = kept;
}

/**
 * The half that keeps a farm alive, and the first thing a pass does for an entity.
 *
 * It reads the column under the entity and nothing else — deliberately not `isOnGround`, not
 * `isSneaking`, not the step clock — so that no assumption the walking half makes can stop a correction
 * from being made. It runs ahead of that half for the same reason: every read in front of the correction
 * is one more way for a pass to die before it has put a farm back.
 */
function superviseLanding(entity: Entity, nowTick: number): void {
    const id = entity.id;
    const dimension = entity.dimension;
    const location = entity.location;
    const prior = walkers.get(id);
    const rawX = prior === undefined ? 0 : location.x - prior.lastX;
    const rawZ = prior === undefined ? 0 : location.z - prior.lastZ;
    // Arriving somewhere is not travelling: a teleport gets no lookahead into columns it never crossed.
    const moved = Math.abs(rawX) <= CONFIG.TELEPORT_DISTANCE && Math.abs(rawZ) <= CONFIG.TELEPORT_DISTANCE;
    const deltaX = moved ? rawX : 0;
    const deltaZ = moved ? rawZ : 0;
    const list = landings.get(id);

    if (list !== undefined) {
        pruneLandingWatch(dimension, list, nowTick);
        if (list.length === 0) landings.delete(id);
    }

    const columnX = Math.floor(location.x);
    const columnZ = Math.floor(location.z);

    // The tile under the entity is read first and always within budget; it is the tile a standing fall
    // lands on.
    let budget = captureLanding(entity, dimension, columnX, columnZ, location.y, nowTick, CONFIG.LANDING_READ_BUDGET);

    // The landing tick can be the tick the entity crosses into the next column, so the columns this
    // pass's travel is heading into are recorded too — nearest first, each axis on its own, because a
    // diagonal move reaches the next column along either axis before it reaches the diagonal one.
    const alongX = Math.min(CONFIG.LANDING_LOOKAHEAD, Math.ceil(Math.abs(deltaX)));
    const alongZ = Math.min(CONFIG.LANDING_LOOKAHEAD, Math.ceil(Math.abs(deltaZ)));
    const furthest = Math.max(alongX, alongZ);

    for (let ahead = 1; ahead <= furthest && budget > 0; ahead++) {
        if (ahead <= alongX) {
            budget = captureLanding(entity, dimension, columnX + Math.sign(deltaX) * ahead, columnZ, location.y, nowTick, budget);
        }
        if (ahead <= alongZ) {
            budget = captureLanding(entity, dimension, columnX, columnZ + Math.sign(deltaZ) * ahead, location.y, nowTick, budget);
        }
    }
}

/**
 * One entity, one pass.
 *
 * The landing guard goes first, in its own error boundary, and the walking half follows in a second one.
 * The guard is the half that keeps a farm alive, and every read the walking half needs — `isOnGround`,
 * `isSneaking`, the step clock — is one more way for a pass to die before the guard has run. Splitting them
 * is what makes "the walking half threw" a logged non-event instead of a silently dead farm.
 */
function sample(entity: Entity, nowTick: number, mode?: GameMode): void {
    runCatching({ system: "cropTrampling", operation: "landingGuard", target: entity.id }, () =>
        superviseLanding(entity, nowTick)
    );
    runCatching({ system: "cropTrampling", operation: "walkRule", target: entity.id }, () =>
        walkRule(entity, nowTick, mode)
    );
}

/**
 * Beta's walking rule: the era's step cadence, its one-in-four roll, and its exemptions.
 *
 * Everything below the guard, and nothing above it depends on it.
 */
function walkRule(entity: Entity, nowTick: number, mode?: GameMode): void {
    if (!walkRuleApplies(mode)) return;

    const id = entity.id;
    const location = entity.location;
    const prior = walkers.get(id);
    const state: WalkState = prior ?? {
        lastX: location.x,
        lastZ: location.z,
        distance: 0,
        nextStep: 0,
        lastSeen: nowTick
    };

    state.lastSeen = nowTick;
    if (prior === undefined) walkers.set(id, state);

    const deltaX = location.x - state.lastX;
    const deltaZ = location.z - state.lastZ;

    if (Math.abs(deltaX) > CONFIG.TELEPORT_DISTANCE || Math.abs(deltaZ) > CONFIG.TELEPORT_DISTANCE) {
        resetWalker(state, location.x, location.z);
        return;
    }

    state.lastX = location.x;
    state.lastZ = location.z;

    // Beta skipped the walking callback while sneaking on the ground, the distance accumulation
    // included, so sneaked movement banks nothing towards the next step either.
    if (entity.isSneaking && entity.isOnGround) return;

    if (!consumeStep(state, Math.hypot(deltaX, deltaZ))) return;

    const walked = walkedBlockLocation(location.x, location.y, location.z);

    // The mount walks, the rider does not: Beta's step callback carried `ridingEntity == null`, so a
    // player crossing a farm on a horse trampled nothing with their own feet. The component is read
    // here rather than up front because a rider is the only case that answers anything, and the step
    // clock it lets advance is worth at most one block of phase after dismounting.
    const riding = runCatching(
        { system: "cropTrampling", operation: "readRidingComponent", target: id },
        () => entity.getComponent(EntityComponentTypes.Riding)
    );
    if (riding !== undefined) return;

    const target = resolveTrampleTarget(entity.dimension, walked);

    if (target !== undefined && Math.floor(Math.random() * CONFIG.TRAMPLE_ROLL) === 0) {
        forgetLandingsAt(walked);
        // The crop goes first: once the tile below it is dirt, the engine's own block update is free to
        // pop the crop, and that drop would be the modern one rather than the era's.
        breakCrop(entity.dimension, walked);
        target.setType(DIRT_ID);
    }
}

function pruneWalkers(nowTick: number): void {
    for (const [id, state] of walkers) {
        if (nowTick - state.lastSeen > CONFIG.STALE_WALKER_TICKS) {
            walkers.delete(id);
        }
    }

    // Nothing stale to sweep means the map is churning faster than the window tolerates; the oldest
    // walkers lose their step phase rather than the map growing without bound.
    let oldest = walkers.keys().next();
    while (walkers.size > CONFIG.MAX_TRACKED_WALKERS && !oldest.done) {
        walkers.delete(oldest.value);
        oldest = walkers.keys().next();
    }

    // Landing watches expire on their own, but an entity that despawns is never sampled again, so its
    // entries would otherwise sit in the map until the next prune.
    for (const [id, list] of landings) {
        if (list.every((watch) => nowTick > watch.expiresAt)) landings.delete(id);
    }
}

function sampleNearbyMobs(player: Entity, nowTick: number, seen: Set<string>): void {
    const mobs = player.dimension.getEntities({
        location: player.location,
        maxDistance: CONFIG.MOB_RADIUS,
        excludeTypes: NON_WALKING_TYPES
    });

    for (const mob of mobs) {
        if (!mob.isValid || seen.has(mob.id)) continue;
        seen.add(mob.id);

        try {
            sample(mob, nowTick);
        } catch (e) {
            reportError({ system: "cropTrampling", operation: "sampleMob", target: mob.id }, e);
        }
    }
}

export function cropTramplingJob(): void {
    mobSweepDue = !mobSweepDue;
    const nowTick = tickManager.getCurrentTick();
    const seen = mobSweepDue ? new Set<string>() : undefined;

    for (const player of world.getAllPlayers()) {
        if (!player.isValid) continue;

        try {
            const gameMode = runCatching(
                { system: "cropTrampling", operation: "readGameMode", target: player.id },
                () => player.getGameMode()
            );

            // Every mode is served here: the guard restores what the era always had, so it may not be
            // gated on a mode that never existed then. The walking rule makes its own call.
            sample(player, nowTick, gameMode);
            if (seen !== undefined) sampleNearbyMobs(player, nowTick, seen);
        } catch (e) {
            reportError({ system: "cropTrampling", operation: "samplePlayer", target: player.id }, e);
        }
    }

    if (walkers.size > CONFIG.MAX_TRACKED_WALKERS || landings.size > CONFIG.MAX_TRACKED_WALKERS) {
        pruneWalkers(nowTick);
    }
}

// A departed player must not carry a step phase into their next session.
eventBus.onPlayerLeave((event) => {
    walkers.delete(event.playerId);
    landings.delete(event.playerId);
});

// Dirt a player placed on a watched tile is theirs, not the engine's trample.
eventBus.onPlayerPlaceBlock((event) => {
    forgetLandingsAt(event.block.location);
});

// Beta asked the question once per move, i.e. every tick.
tickManager.register("cropTrampling", 1, cropTramplingJob);
