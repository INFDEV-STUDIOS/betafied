import { world, system, BlockPermutation, BlockVolume, Dimension } from "@minecraft/server";
import type { Block, BlockFilter, BlockLocationIterator } from "@minecraft/server";
import { BETA_BLOCK_IDS } from "../core/betaRegistry.js";
import { BLOCK_BULK_REPLACEMENTS, BLOCK_FINE_REPLACEMENTS } from "../core/compatibilityPolicy.js";
import { normalizeBlock } from "../core/normalizer.js";
import { tickManager } from "../core/tickManager.js";

const SCRUBBED_AT = new Map<string, number>();
const MAX_TRACKED_CHUNKS = 8192;
const CHUNKS_PER_TICK_LIMIT = 1;

// How far the floor is sealed past the player's own chunk. One chunk each way is enough now that the
// ring actually fills: the void players saw at a chunk boundary was the sweep re-sealing a single
// chunk, not the ring being too shallow. Raise this to widen the sealed area.
const SCRUB_RADIUS = 1;

function buildNeighbourhood(): (readonly [number, number])[] {
    const offsets: [number, number][] = [];
    for (let dx = -SCRUB_RADIUS; dx <= SCRUB_RADIUS; dx++) {
        for (let dz = -SCRUB_RADIUS; dz <= SCRUB_RADIUS; dz++) {
            offsets.push([dx, dz]);
        }
    }
    // Nearest first: the ring is sealed outward, so the ground under the player never waits on the
    // far corner of the neighbourhood. With a one-chunk-per-pass budget the old fixed west-to-east
    // sweep always spent the budget on the ring instead, and a moving player never saw the floor
    // arrive under them - only in the chunk they had already left.
    return offsets.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]));
}

const SCRUB_NEIGHBOURHOOD: readonly (readonly [number, number])[] = buildNeighbourhood();

// A scrub pass is one horizontal slab of a chunk. 128 keeps a band's volume query to 32768 blocks,
// which bounds a single native scan and lets the job yield at a useful granularity.
const BAND_HEIGHT = 128;
const CHUNK_SIZE = 16;

// A clean chunk is not re-walked every pass; it is only re-verified after this long. The rescan
// exists for terrain that arrives *after* the first visit - a structure that generates late, another
// addon writing into a chunk already declared clean - not for the chunk's own blocks, which cannot
// come back. At the old 200-tick cadence a player standing still paid to re-scan the same nine chunks
// ten times a minute, forever, which is what the profiler showed dominating the server tick.
const REVERIFY_INTERVAL_TICKS = 2400;

const OVERWORLD_ID = "minecraft:overworld";
const BETA_FLOOR_Y = 0;
const BETA_FLOOR_LAYERS = 3;

// The highest Y the floor generator may write. Anything above it is a floor written by an older
// build and is cleared back to air.
const BETA_FLOOR_CEILING = BETA_FLOOR_Y + BETA_FLOOR_LAYERS;

const BEDROCK_FILTER: BlockFilter = Object.freeze({ includeTypes: ["minecraft:bedrock"] });

/**
 * Types the scrubber is allowed to walk past.
 *
 * This is the negative filter for every volume query below: the Beta registry plus the engine's air
 * variants. A block is therefore handed back for inspection exactly when the scrubber does not already
 * recognize it as authentic, which keeps the inverse allowlist in `betaRegistry` authoritative as the
 * game grows - a type shipped by a future update is surfaced instead of silently surviving - without
 * anybody maintaining a second list.
 *
 * `minecraft:planks` is deliberately absent: it is the one modern block that gets retyped rather than
 * removed, and the query has to report it for that to happen.
 */
const UNTOUCHED_TYPES: string[] = [
    "minecraft:air",
    "minecraft:cave_air",
    "minecraft:void_air",
    ...BETA_BLOCK_IDS
];

const UNTOUCHED_FILTER: BlockFilter = Object.freeze({ excludeTypes: UNTOUCHED_TYPES });

const BULK_TARGET_TYPES: string[] = BLOCK_BULK_REPLACEMENTS.map(([target]) => target);

// Presence is discovered by group-testing the table (see runBulkReplacements), so a filter spans a
// contiguous slice rather than one type. Slices repeat every band of every chunk, so they are built
// once and reused instead of allocating a fresh includeTypes array per probe.
const BULK_RANGE_FILTERS = new Map<string, BlockFilter>();
function bulkRangeFilter(lo: number, hi: number): BlockFilter {
    const key = `${lo}:${hi}`;
    let filter = BULK_RANGE_FILTERS.get(key);
    if (filter === undefined) {
        filter = { includeTypes: BULK_TARGET_TYPES.slice(lo, hi + 1) };
        BULK_RANGE_FILTERS.set(key, filter);
    }
    return filter;
}

const BULK_BY_TARGET = new Map(BLOCK_BULK_REPLACEMENTS);

function markScrubbed(key: string, tick: number): void {
    if (SCRUBBED_AT.size >= MAX_TRACKED_CHUNKS) {
        const oldest = SCRUBBED_AT.keys().next().value;
        if (oldest !== undefined) {
            SCRUBBED_AT.delete(oldest);
        }
    }
    SCRUBBED_AT.set(key, tick);
}

function needsScrub(key: string, tick: number): boolean {
    const lastScrubbed = SCRUBBED_AT.get(key);
    return lastScrubbed === undefined || tick - lastScrubbed >= REVERIFY_INTERVAL_TICKS;
}

// A sweep yields across ticks, so the scheduler fires the next pass before the current one has
// marked its chunk done. Without a claim, every pass re-picks the same first chunk and the rest of
// the neighbourhood never gets a turn - the starvation just moves to whichever chunk the order
// favours. A claim older than the stale window is ignored so a dropped job cannot wedge a chunk.
const SCRUB_IN_FLIGHT = new Map<string, number>();
const IN_FLIGHT_STALE_TICKS = 200;

function isInFlight(key: string, tick: number): boolean {
    const claimedAt = SCRUB_IN_FLIGHT.get(key);
    return claimedAt !== undefined && tick - claimedAt < IN_FLIGHT_STALE_TICKS;
}

/**
 * Fills a volume through the native block API.
 *
 * The `fill` command is deliberately not used: every command is parsed and permission-checked on the
 * way through the engine, so the same work costs far more per call and caps a volume at 32768 blocks.
 * `fillBlocks` is the direct engine call, and `ignoreChunkBoundErrors` keeps a fill that only partly
 * lands in loaded chunks from being thrown away whole.
 */
function fill(dim: Dimension, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, block: string, filter?: BlockFilter): void {
    try {
        dim.fillBlocks(
            new BlockVolume({ x: x1, y: y1, z: z1 }, { x: x2, y: y2, z: z2 }),
            block,
            { blockFilter: filter, ignoreChunkBoundErrors: true }
        );
    } catch {
        // A volume still outside loaded chunks is retried on a later pass.
    }
}

/** Deterministic value noise in [0, 1) for one cell of the floor heightmap. */
function floorNoise(cx: number, cz: number, gx: number, gz: number): number {
    let h = (cx * 374761393 + cz * 668265263 + gx * 1274126177 + gz * 1013904223) | 0;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Buckets the noise into a mostly-flat floor with scattered raised bedrock.
 *
 * The skew matters more than the curve: vanilla's own floor is a solid layer with roughly half its
 * columns carrying a second block and only a scattering above that, so an even split would average
 * two blocks per column and read as a pile rather than a surface.
 */
function floorHeight(noise: number): number {
    if (noise < 0.45) return 0;
    if (noise < 0.8) return 1;
    if (noise < 0.95) return 2;
    return BETA_FLOOR_LAYERS;
}

/**
 * Seals the Overworld at Y=0 the way Beta's did, under a rough bedrock floor.
 *
 * Beta was 128 blocks tall with a jagged bedrock floor at the bottom and nothing beneath it. An
 * addon cannot shorten the Overworld, so a bedrock floor is laid at Y=0 instead. The sub-zero column
 * is deliberately left as native terrain: survival players cannot break through bedrock, so
 * ballasting it with stone only spent native fills per chunk on ground that could never be seen.
 *
 * The surface is a per-block heightmap merged into horizontal runs, so it reads like the noise a
 * generated floor carries rather than a handful of flat plateaus. Runs keep a chunk to a few dozen
 * native fills where one per block would be 256.
 */
export function solidifyBetaFloor(dim: Dimension, cx: number, cz: number): void {
    if (dim.id !== OVERWORLD_ID) return;

    const originX = cx * CHUNK_SIZE;
    const originZ = cz * CHUNK_SIZE;

    // A solid base first: with the sub-zero column no longer ballasted, a gap here would drop the
    // player onto native deepslate or, in a flat world, into the void.
    fill(dim, originX, BETA_FLOOR_Y, originZ, originX + CHUNK_SIZE - 1, BETA_FLOOR_Y, originZ + CHUNK_SIZE - 1, "minecraft:bedrock");

    for (let z = 0; z < CHUNK_SIZE; z++) {
        let runStart = -1;
        let runHeight = 0;

        for (let x = 0; x <= CHUNK_SIZE; x++) {
            // The trailing sentinel of height zero flushes whatever run is still open.
            const height = x === CHUNK_SIZE ? 0 : floorHeight(floorNoise(cx, cz, x, z));

            if (runStart >= 0 && height === runHeight) continue;

            if (runStart >= 0) {
                fill(dim, originX + runStart, BETA_FLOOR_Y + 1, originZ + z, originX + x - 1, runHeight, originZ + z, "minecraft:bedrock");
            }

            runStart = height > 0 ? x : -1;
            runHeight = height;
        }
    }
}

/**
 * Clears stray bedrock above the sealed floor.
 *
 * Bedrock only exists naturally at the bottom of the world, so anything above the ceiling in the
 * Overworld is an artifact of a floor written by an older build. The presence probe gates the fill,
 * so a clean chunk pays one native scan per band and no write at all.
 */
export function repairFloorOverflow(dim: Dimension, cx: number, cz: number): void {
    if (dim.id !== OVERWORLD_ID) return;

    const { max: yMax } = dim.heightRange;
    const x1 = cx * CHUNK_SIZE;
    const z1 = cz * CHUNK_SIZE;
    const x2 = x1 + CHUNK_SIZE - 1;
    const z2 = z1 + CHUNK_SIZE - 1;

    for (let y = BETA_FLOOR_CEILING + 1; y <= yMax; y += BAND_HEIGHT) {
        const bandTop = Math.min(y + BAND_HEIGHT - 1, yMax);
        const volume = new BlockVolume({ x: x1, y, z: z1 }, { x: x2, y: bandTop, z: z2 });

        if (!containsBlocksIn(dim, volume, BEDROCK_FILTER)) continue;

        fill(dim, x1, y, z1, x2, bandTop, z2, "minecraft:air", BEDROCK_FILTER);
    }
}

const PERM_CACHE = new Map<string, BlockPermutation | null>();
function getPermutation(typeId: string): BlockPermutation | null {
    if (PERM_CACHE.has(typeId)) return PERM_CACHE.get(typeId) ?? null;
    try {
        const perm = BlockPermutation.resolve(typeId);
        PERM_CACHE.set(typeId, perm);
        return perm;
    } catch {
        PERM_CACHE.set(typeId, null);
        return null;
    }
}

function applyReplacement(block: Block, targetId: string): void {
    if (targetId === "minecraft:air") {
        block.setType("minecraft:air");
        return;
    }
    if (targetId === "minecraft:water") {
        block.setType("minecraft:water");
        return;
    }
    const permutation = getPermutation(targetId);
    if (permutation) {
        block.setPermutation(permutation);
    }
}

/**
 * Normalizes one block that the bulk pass could not express.
 *
 * The bulk table is consulted again here rather than assumed applied: a fill is rejected outright in
 * an unloaded chunk, so this is the backstop that keeps such a block from falling through to the
 * normalizer's remove-to-air default. The chain also matters for the planks entry, where the bulk
 * table rewrites mangrove/cherry planks *to* `planks` and the branch below retypes it to oak.
 */
function applyFineScrub(block: Block): void {
    let typeId = block.typeId;

    const bulkTarget = BULK_BY_TARGET.get(typeId);
    if (bulkTarget !== undefined) {
        applyReplacement(block, bulkTarget);
        typeId = bulkTarget;
    }

    // Bedrock collapses every wood type into one planks block, so it is not an unknown modern block —
    // retype it to oak instead of scrubbing it away.
    if (typeId === "minecraft:planks") {
        if (block.permutation.getState("wood_type") !== "oak") {
            block.setPermutation(BlockPermutation.resolve("minecraft:planks").withState("wood_type", "oak"));
        }
        return;
    }

    // The fine table overrules the generic normalizer: it exists for blocks whose Beta stand-in is a
    // deliberate choice ("this deep-dark sensor is stone") that the id-pattern rules cannot infer.
    const fineTarget = BLOCK_FINE_REPLACEMENTS[typeId];
    const blockNorm = fineTarget === undefined
        ? normalizeBlock(typeId)
        : { action: "convert" as const, targetId: fineTarget };

    if (blockNorm.action === "convert" && blockNorm.targetId) {
        applyReplacement(block, blockNorm.targetId);
    } else if (blockNorm.action === "remove") {
        // Inverse allowlist: any minecraft: block outside BETA_BLOCK_IDS that has no authentic
        // counterpart must be scrubbed, not left behind in the chunk.
        block.setType("minecraft:air");
    }
}

function containsBlocksIn(dimension: Dimension, volume: BlockVolume, filter: BlockFilter): boolean {
    try {
        return dimension.containsBlock(volume, filter, true);
    } catch {
        // An unloaded volume is not evidence of absence; treat the band as holding work so it is
        // reconsidered instead of being skipped for good (the write itself will simply fail).
        return true;
    }
}

/**
 * Records the table indices whose types are present in the volume, by group-testing the table.
 *
 * A probe answers "is any of these types here", so a range that comes back empty prunes its whole
 * subtree in one native scan. Probing the ~70 entries one at a time instead cost a full 32k-block
 * scan per entry - the single largest cost in the script tick - yet almost every band holds only one
 * or two of the entries, so nearly all of those scans returned nothing.
 */
function collectBulkTargets(dimension: Dimension, volume: BlockVolume, lo: number, hi: number, present: number[]): void {
    if (!containsBlocksIn(dimension, volume, bulkRangeFilter(lo, hi))) return;

    if (lo === hi) {
        present.push(lo);
        return;
    }

    const mid = (lo + hi) >> 1;
    collectBulkTargets(dimension, volume, lo, mid, present);
    collectBulkTargets(dimension, volume, mid + 1, hi, present);
}

function getMatchingBlocks(dimension: Dimension, volume: BlockVolume): BlockLocationIterator | null {
    try {
        return dimension.getBlocks(volume, UNTOUCHED_FILTER, true).getBlockLocationIterator();
    } catch {
        return null;
    }
}

/**
 * Converts the post-Beta blocks in one band with a native filtered fill.
 *
 * A fill touches thousands of blocks per command, where the same conversion spelled out as
 * setType/setPermutation is one script call per block, so a fill is issued only for a type that is
 * actually there. Group-testing the table finds those types in a couple of dozen scans instead of
 * one per entry, and a fill is never built for a range that reported nothing.
 */
function runBulkReplacements(dimension: Dimension, volume: BlockVolume, cx: number, cz: number, bandBottom: number, bandTop: number): void {
    const present: number[] = [];
    collectBulkTargets(dimension, volume, 0, BLOCK_BULK_REPLACEMENTS.length - 1, present);
    if (present.length === 0) return;

    const x1 = cx * CHUNK_SIZE;
    const z1 = cz * CHUNK_SIZE;
    const x2 = x1 + CHUNK_SIZE - 1;
    const z2 = z1 + CHUNK_SIZE - 1;

    for (const i of present) {
        const [target, replacement] = BLOCK_BULK_REPLACEMENTS[i];
        fill(dimension, x1, bandBottom, z1, x2, bandTop, z2, replacement, { includeTypes: [target] });
    }
}

/**
 * Scans and scrubs one chunk, one band at a time.
 *
 * Returns false when a band could not be read (its chunk unloaded mid-sweep), which leaves the chunk
 * unmarked so the next pass retries it rather than declaring it clean.
 */
export function* scrubFineDetails(dimension: Dimension, cx: number, cz: number): Generator<void, boolean, unknown> {
    const { min: yMin, max: yMax } = dimension.heightRange;
    const x1 = cx * CHUNK_SIZE;
    const z1 = cz * CHUNK_SIZE;

    // Everything below Y=0 sits under the unbreakable bedrock floor, so there is nothing down there
    // worth reading back.
    const startY = dimension.id === OVERWORLD_ID ? Math.max(yMin, BETA_FLOOR_Y) : yMin;

    // A chunk is only re-walked after the re-verify window, so an unloaded chunk must never be marked
    // clean: the volume queries below report "nothing to do" for ground that simply was not there to
    // read, which would pair with the success mark and lose the chunk until the window elapsed.
    if (!dimension.isChunkLoaded({ x: x1, y: startY, z: z1 })) return false;

    for (let y = startY; y <= yMax; y += BAND_HEIGHT) {
        const bandTop = Math.min(y + BAND_HEIGHT - 1, yMax);
        const volume = new BlockVolume({ x: x1, y, z: z1 }, { x: x1 + CHUNK_SIZE - 1, y: bandTop, z: z1 + CHUNK_SIZE - 1 });

        runBulkReplacements(dimension, volume, cx, cz, y, bandTop);

        // The fine pass only has to look at what the bulk table could not express, so the engine
        // hands back the matching blocks instead of the scrubber walking all 32768 of them. What
        // remains is normally a few hundred edits per chunk rather than a 32768-call column read.
        const matches = getMatchingBlocks(dimension, volume);
        if (matches === null) return false;

        let inspected = 0;
        for (const location of matches) {
            try {
                const block = dimension.getBlock(location);
                if (block) applyFineScrub(block);
            } catch {
                // A block whose chunk unloaded mid-band is retried on the next pass.
                return false;
            }

            // Only reachable for a pathological chunk; the yield keeps one band off the watchdog.
            if (++inspected % 512 === 0) yield;
        }

        yield;
    }

    return true;
}

export function* chunkScanJob(): Generator<void, void, unknown> {
    const tick = system.currentTick;
    let scrubbed = 0;

    for (const player of world.getAllPlayers()) {
        if (scrubbed >= CHUNKS_PER_TICK_LIMIT) return;
        if (!player.isValid) continue;

        const dimension = player.dimension;
        const { x: playerX, z: playerZ } = player.location;
        const centerX = Math.floor(playerX / CHUNK_SIZE);
        const centerZ = Math.floor(playerZ / CHUNK_SIZE);

        for (const [dx, dz] of SCRUB_NEIGHBOURHOOD) {
            if (scrubbed >= CHUNKS_PER_TICK_LIMIT) return;

            const chunkX = centerX + dx;
            const chunkZ = centerZ + dz;
            const key = `${dimension.id}:${chunkX},${chunkZ}`;

            if (!needsScrub(key, tick) || isInFlight(key, tick)) continue;

            // An unloaded chunk rejects the fill and cannot be read back. Skipping it keeps it off the
            // budget entirely, so a neighbour that is not loaded yet cannot starve the ring; it is
            // picked up once it loads.
            if (!dimension.isChunkLoaded({ x: chunkX * CHUNK_SIZE, y: BETA_FLOOR_Y, z: chunkZ * CHUNK_SIZE })) continue;

            SCRUB_IN_FLIGHT.set(key, tick);
            solidifyBetaFloor(dimension, chunkX, chunkZ);
            repairFloorOverflow(dimension, chunkX, chunkZ);

            const clean = yield* scrubFineDetails(dimension, chunkX, chunkZ);
            SCRUB_IN_FLIGHT.delete(key);

            // Only a completed sweep spends the budget, so a chunk that could not be read is retried
            // without holding the rest of the neighbourhood behind it.
            if (!clean) continue;

            markScrubbed(key, tick);
            scrubbed++;
        }
    }
}

tickManager.register("chunkScrubber", 3, chunkScanJob, 1);
