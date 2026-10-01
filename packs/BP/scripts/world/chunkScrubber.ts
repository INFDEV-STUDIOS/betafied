import { world, system, BlockPermutation, BlockVolume, Dimension } from "@minecraft/server";
import type { Block, BlockFilter, BlockLocationIterator } from "@minecraft/server";
import { BETA_BLOCK_IDS } from "../core/betaRegistry.js";
import { BLOCK_BULK_REPLACEMENTS, BLOCK_FINE_REPLACEMENTS } from "../core/compatibilityPolicy.js";
import { normalizeBlock } from "../core/normalizer.js";
import { tickManager } from "../core/tickManager.js";

const SCRUBBED_AT = new Map<string, number>();
const MAX_TRACKED_CHUNKS = 8192;
const CHUNKS_PER_TICK_LIMIT = 1;

// A scrub pass is one horizontal slab of a chunk. 128 keeps every native call exactly at the
// 32768-block fill ceiling, so no band top is ever paid for as slack.
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

function fill(dim: Dimension, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, block: string, target?: string): void {
    const replace = target === undefined ? "" : ` replace ${target}`;
    try {
        dim.runCommand(`fill ${x1} ${y1} ${z1} ${x2} ${y2} ${z2} ${block}${replace}`);
    } catch {
        // An unloaded chunk rejects the fill; the scrubber revisits it on a later pass.
    }
}

function chunkSeed(cx: number, cz: number): number {
    let h = (cx * 374761393 + cz * 668265263) | 0;
    h = (h ^ (h >>> 13)) * 1274126177;
    return (h ^ (h >>> 16)) >>> 0;
}

function nextSeed(seed: number): number {
    return (seed * 1664525 + 1013904223) >>> 0;
}

/**
 * Seals the deep world so the Overworld ends at Y=0 the way Beta's did.
 *
 * Beta was 128 blocks tall with a jagged bedrock floor at the bottom and nothing beneath it. An
 * addon cannot shorten the Overworld, so the sub-zero column is ballasted with stone and capped
 * with bedrock instead. That is a handful of native fills per chunk; rebuilding it per column
 * would be 16k script calls and blow the watchdog budget.
 *
 * This also means nothing under Y=0 needs to be *inspected*: the column is one solid block type
 * afterwards, so the scrub sweep starts at the floor rather than re-reading it.
 */
export function solidifyBetaFloor(dim: Dimension, cx: number, cz: number): void {
    if (dim.id !== OVERWORLD_ID) return;

    const x1 = cx * CHUNK_SIZE;
    const z1 = cz * CHUNK_SIZE;
    const x2 = x1 + CHUNK_SIZE - 1;
    const z2 = z1 + CHUNK_SIZE - 1;
    const { min: yMin } = dim.heightRange;

    // Starting one above the floor leaves the engine's own bottom bedrock in place.
    fill(dim, x1, yMin + 1, z1, x2, BETA_FLOOR_Y - 1, z2, "minecraft:stone");
    fill(dim, x1, BETA_FLOOR_Y, z1, x2, BETA_FLOOR_Y, z2, "minecraft:bedrock");

    // Deterministic per-chunk offsets stack a few uneven bedrock layers, so the cap reads as ragged
    // without costing a fill per column.
    let seed = chunkSeed(cx, cz);
    for (let layer = 1; layer <= BETA_FLOOR_LAYERS; layer++) {
        seed = nextSeed(seed);
        const ax = x1 + (seed & 15);
        const az = z1 + ((seed >>> 8) & 15);
        const bx = x1 + ((seed >>> 16) & 15);
        const bz = z1 + ((seed >>> 24) & 15);
        fill(dim, Math.min(ax, bx), layer, Math.min(az, bz), Math.max(ax, bx), layer, Math.max(az, bz), "minecraft:bedrock");
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
        fill(dimension, x1, bandBottom, z1, x2, bandTop, z2, replacement, target);
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

    // Everything below Y=0 is sealed by solidifyBetaFloor into a single block type, so there is
    // nothing down there worth reading back.
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

        for (let dx = -1; dx <= 1; dx++) {
            if (scrubbed >= CHUNKS_PER_TICK_LIMIT) return;

            for (let dz = -1; dz <= 1; dz++) {
                if (scrubbed >= CHUNKS_PER_TICK_LIMIT) return;

                const chunkX = centerX + dx;
                const chunkZ = centerZ + dz;
                const key = `${dimension.id}:${chunkX},${chunkZ}`;

                if (!needsScrub(key, tick)) continue;

                solidifyBetaFloor(dimension, chunkX, chunkZ);

                if (yield* scrubFineDetails(dimension, chunkX, chunkZ)) {
                    markScrubbed(key, tick);
                }
                scrubbed++;
            }
        }
    }
}

tickManager.register("chunkScrubber", 3, chunkScanJob, 1);
