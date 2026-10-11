import { world, system, BlockPermutation, BlockVolume, Dimension } from "@minecraft/server";
import type { Block, BlockFilter, BlockLocationIterator } from "@minecraft/server";
import { BETA_BLOCK_IDS, POST_BETA_WOOD_SPECIES } from "../core/betaRegistry.js";
import { BLOCK_BULK_REPLACEMENTS, BLOCK_FINE_REPLACEMENTS } from "../core/compatibilityPolicy.js";
import { normalizeBlock } from "../core/normalizer.js";
import { reportError } from "../core/errorReporter.js";
import { tickManager } from "../core/tickManager.js";
import { BETA_FLOOR_Y, OVERWORLD_ID } from "../core/betaConstants.js";

// Holds the tick each chunk next becomes due, not the tick it was last swept: the jitter is then paid
// once when the chunk is marked instead of on every lookup.
const SCRUB_DUE_AT = new Map<string, number>();
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

// A player's nine chunks are marked within one pass of each other, so without this they would all
// come due on the same tick - and on a server every player's neighbourhood would land with them,
// spending the entire budget on one burst. Spreading each chunk's deadline over this window turns
// the re-verify into a trickle that the one-chunk-per-pass budget can actually absorb.
const REVERIFY_SPREAD_TICKS = 600;

function reverifyOffset(key: string): number {
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
        hash = (hash * 31 + key.charCodeAt(i)) | 0;
    }
    return (hash >>> 0) % REVERIFY_SPREAD_TICKS;
}

const BETA_FLOOR_LAYERS = 2;

/**
 * Matches a log laid on its side.
 *
 * Beta 1.7.3 logs only ever stood upright, so the horizontal logs modern world generation scatters
 * as "fallen trees" have no Beta counterpart and are cleared to air. Keying the filter on the
 * `pillar_axis` permutation keeps this to one native scan per band and leaves a vertical log - which
 * the axis alone cannot distinguish from terrain - alone.
 */
function buildHorizontalLogFilter(): BlockFilter {
    const includePermutations: BlockPermutation[] = [];
    for (const type of ["minecraft:oak_log", "minecraft:birch_log", "minecraft:spruce_log"]) {
        for (const axis of ["x", "z"]) {
            try {
                includePermutations.push(BlockPermutation.resolve(type, { pillar_axis: axis }));
            } catch {
                // The log type or its axis state is absent in this engine build.
            }
        }
    }
    return Object.freeze({ includePermutations });
}

const HORIZONTAL_LOG_FILTER: BlockFilter = buildHorizontalLogFilter();

/**
 * Types the scrubber is allowed to walk past.
 *
 * Negative filter for the fine pass volume query: authentic Beta blocks resolved against the
 * engine's block registry. Passing unregistered or item-only identifiers causes Bedrock's native
 * filter parser to throw, so candidate IDs are validated against BlockPermutation.resolve.
 *
 * `minecraft:planks` is deliberately absent: it is the one modern block that gets retyped rather than
 * removed, and the query has to report it for that to happen.
 */
function buildUntouchedFilter(): BlockFilter {
    const excludeTypes: string[] = [];
    const candidates = new Set<string>([
        "minecraft:air",
        ...BETA_BLOCK_IDS,
        "minecraft:reeds",
        "minecraft:deadbush",
        "minecraft:web",
        "minecraft:mob_spawner",
        "minecraft:unpowered_repeater",
        "minecraft:powered_repeater",
        "minecraft:stone_block_slab",
        "minecraft:brick_block"
    ]);

    for (const id of candidates) {
        try {
            BlockPermutation.resolve(id);
            excludeTypes.push(id);
        } catch {
            // Unregistered block identifier in current engine build (e.g. item ID or Java alias).
        }
    }

    return Object.freeze({ excludeTypes });
}

const UNTOUCHED_FILTER: BlockFilter = buildUntouchedFilter();

/**
 * Reports anything in a volume that is not bedrock.
 *
 * The floor's Y=0 base is written as one unbroken bedrock slab, so testing that slab for a
 * non-bedrock block is a cheap "this chunk is sealed already" probe: 256 blocks against the ~120
 * native fills the ragged cap above it costs to lay down.
 */
const NOT_BEDROCK_FILTER: BlockFilter = Object.freeze({ excludeTypes: ["minecraft:bedrock"] });

/**
 * Every type the scrubber knows how to rewrite, in one group-tested probe list.
 *
 * The bulk and fine tables used to be reached by different passes: bulk targets by `containsBlock`
 * probes and filtered fills, fine targets only by the fine pass's reverse-allowlist volume query.
 * That query does not reliably hand these blocks back, so a chunk could clear a full sweep with its
 * plants, leaf litter and other fine-only types untouched. Folding both tables into the probe list
 * turns every known target into a filtered native fill, which is the path that actually reaches
 * them. On a target named in both tables the first entry wins, so the deliberate fine-table
 * backstops do not emit a duplicate fill.
 */
/**
 * Block ids for the rest of the post-Beta wood building set, derived rather than hand-listed.
 *
 * The two tables enumerate the modern blocks that *generate* as terrain. A post-Beta species also
 * reaches the world as everything else it can be built from - stairs, slabs, fences, doors, saplings,
 * and the log/stem spellings the table does not carry - and those used to be caught only by the fine
 * pass's reverse query, which the pinned module version does not have. Generating the ids from the
 * one owner of the species list keeps a new species' whole building set covered in one move, and each
 * candidate's replacement is read back off the normalizer rather than restated here.
 */
/**
 * The block every wood species' planks are retyped onto.
 *
 * Taken from the bulk table rather than repeated, so the generated post-Beta species and the species
 * the table already carries cannot drift apart on it.
 */
const PLANKS_TARGET = BLOCK_BULK_REPLACEMENTS.find(([target]) => target.endsWith("_planks"))?.[1] ?? "minecraft:planks";

function buildPostBetaWoodTargets(): readonly (readonly [string, string])[] {
    const suffixes = [
        "planks", "log", "stem", "wood", "hyphae",
        "fence", "fence_gate", "stairs", "slab",
        "leaves", "door", "trapdoor", "sign", "sapling"
    ];

    const targets: [string, string][] = [];
    for (const species of POST_BETA_WOOD_SPECIES) {
        for (const suffix of suffixes) {
            const id = `minecraft:${species}_${suffix}`;

            // Planks are the one block the scrubber retypes rather than replaces - Bedrock
            // consolidates the wood types into a single `planks` block whose `wood_type` the fine
            // pass sets - so they cannot go through the normalizer's item-side `oak_planks`. Read the
            // target back off the table so a generated species and a terrain species cannot disagree.
            if (suffix === "planks") {
                targets.push([id, PLANKS_TARGET]);
                continue;
            }

            const norm = normalizeBlock(id);
            if (norm.action === "keep" || !norm.targetId) continue;
            targets.push([id, norm.targetId]);
        }

        for (const spelling of [`stripped_${species}_log`, `stripped_${species}_stem`]) {
            const id = `minecraft:${spelling}`;
            const norm = normalizeBlock(id);
            if (norm.action === "keep" || !norm.targetId) continue;
            targets.push([id, norm.targetId]);
        }
    }
    return targets;
}

function buildScrubTargets(): readonly (readonly [string, string])[] {
    const seen = new Set<string>();
    const targets: [string, string][] = [];
    for (const [target, replacement] of [
        ...BLOCK_BULK_REPLACEMENTS,
        ...Object.entries(BLOCK_FINE_REPLACEMENTS),
        // Last, so the tables keep their deliberate choices: `mangrove_planks` targets the retyped
        // `planks` rather than the normalizer's plain oak, and the first entry for a target wins.
        ...buildPostBetaWoodTargets()
    ]) {
        if (seen.has(target)) continue;
        seen.add(target);
        targets.push([target, replacement]);
    }
    return targets;
}

const SCRUB_TARGETS: readonly (readonly [string, string])[] = buildScrubTargets();

const BULK_TARGET_TYPES: string[] = SCRUB_TARGETS.map(([target]) => target);

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

const BULK_BY_TARGET = new Map(SCRUB_TARGETS);

function markScrubbed(key: string, tick: number): void {
    if (SCRUB_DUE_AT.size >= MAX_TRACKED_CHUNKS) {
        const oldest = SCRUB_DUE_AT.keys().next().value;
        if (oldest !== undefined) {
            SCRUB_DUE_AT.delete(oldest);
        }
    }
    SCRUB_DUE_AT.set(key, tick + REVERIFY_INTERVAL_TICKS + reverifyOffset(key));
}

function needsScrub(key: string, tick: number): boolean {
    const dueAt = SCRUB_DUE_AT.get(key);
    return dueAt === undefined || tick >= dueAt;
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
 * Buckets the noise into the three-block floor: the Y=0 base always stands, and the two layers above
 * it are split so the top is common rather than rare.
 *
 * The shape is churn, not coverage. Vanilla's own taller floor leaves over half its columns flat, and
 * reused here that reads as wide plateaus at a three-block cap; this distribution keeps the floor
 * ragged across its whole footprint instead.
 */
function floorHeight(noise: number): number {
    if (noise < 0.3) return 0;
    return noise < 0.72 ? 1 : BETA_FLOOR_LAYERS;
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

    // The floor is deterministic per chunk and its base layer is always a full bedrock slab, so
    // "Y=0 holds nothing but bedrock" answers "was this chunk sealed already" for 256 blocks. The
    // cap above the base is ~120 separate fills - the single largest native cost the scrubber had -
    // and without this gate every re-verify of an already-sealed chunk paid for all of them again.
    // A failed fill leaves the slab unsealed, so the probe stays true and the seal is retried.
    if (
        !containsBlocksIn(
            dim,
            new BlockVolume(
                { x: originX, y: BETA_FLOOR_Y, z: originZ },
                { x: originX + CHUNK_SIZE - 1, y: BETA_FLOOR_Y, z: originZ + CHUNK_SIZE - 1 }
            ),
            NOT_BEDROCK_FILTER
        )
    ) {
        return;
    }

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
 * Clears fallen logs (sideways logs) from one chunk.
 *
 * A permutation-filtered fill is the native way to express "these logs, this axis": the presence
 * probe gates it, so a chunk with only upright logs pays one scan per band and no write.
 */
export function clearFallenLogs(dim: Dimension, cx: number, cz: number): void {
    if (dim.id !== OVERWORLD_ID) return;

    const permutations = HORIZONTAL_LOG_FILTER.includePermutations;
    if (!permutations || permutations.length === 0) return;

    const { max: yMax } = dim.heightRange;
    const x1 = cx * CHUNK_SIZE;
    const z1 = cz * CHUNK_SIZE;
    const x2 = x1 + CHUNK_SIZE - 1;
    const z2 = z1 + CHUNK_SIZE - 1;

    for (let y = BETA_FLOOR_Y; y <= yMax; y += BAND_HEIGHT) {
        const bandTop = Math.min(y + BAND_HEIGHT - 1, yMax);
        const volume = new BlockVolume({ x: x1, y, z: z1 }, { x: x2, y: bandTop, z: z2 });

        if (!containsBlocksIn(dim, volume, HORIZONTAL_LOG_FILTER)) continue;

        fill(dim, x1, y, z1, x2, bandTop, z2, "minecraft:air", HORIZONTAL_LOG_FILTER);
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
        // `planks` is the one target that is not final: the branch below retypes it to oak. Every
        // other target the table maps a block to is already the Beta stand-in, so the sweep stops
        // here rather than re-normalizing the id it just wrote.
        if (bulkTarget !== "minecraft:planks") return;
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
    collectBulkTargets(dimension, volume, 0, SCRUB_TARGETS.length - 1, present);
    if (present.length === 0) return;

    const x1 = cx * CHUNK_SIZE;
    const z1 = cz * CHUNK_SIZE;
    const x2 = x1 + CHUNK_SIZE - 1;
    const z2 = z1 + CHUNK_SIZE - 1;

    for (const i of present) {
        const [target, replacement] = SCRUB_TARGETS[i];
        fill(dimension, x1, bandBottom, z1, x2, bandTop, z2, replacement, { includeTypes: [target] });
    }
}

/**
 * Whether the volume-query refusal has already been reported this session.
 *
 * `Dimension.getBlocks` reads as a function on the object and type-checks against the pinned module
 * version, and the engine still refuses the call: a bare native error with no message, on every band
 * of every chunk. Repeating that puts a line in the log on each sweep for a condition that cannot
 * change while the server is up, so it is reported once.
 *
 * Only the reporting is latched, not the attempt. Disabling the call needs a verdict about a
 * dimension, and a module-level one would be shared across all of them; a single transient refusal -
 * a chunk unloaded between the load gate and the query - would then silently switch off a query that
 * works on another build. The call costs nothing but the throw.
 */
let fineQueryRefusalReported = false;

/**
 * Scans and scrubs one chunk, one band at a time.
 *
 * Returns false when the chunk is not loaded, which leaves it unmarked so the next pass retries it
 * rather than declaring it clean.
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
    //
    // This gate is the only thing that decides whether the chunk is retried. A query the engine
    // declines, or one block that refuses its write, is a failure of that band alone - letting either
    // cost the chunk its success mark is what pinned the scrubber: a chunk that can never report
    // success is re-swept whole on every pass, forever, which is exactly what the profile showed.
    if (!dimension.isChunkLoaded({ x: x1, y: startY, z: z1 })) return false;

    let refusedBands = 0;
    let refusedReads = 0;
    let refusedBlocks = 0;
    let firstError: unknown;

    for (let y = startY; y <= yMax; y += BAND_HEIGHT) {
        const bandTop = Math.min(y + BAND_HEIGHT - 1, yMax);
        const volume = new BlockVolume({ x: x1, y, z: z1 }, { x: x1 + CHUNK_SIZE - 1, y: bandTop, z: z1 + CHUNK_SIZE - 1 });

        runBulkReplacements(dimension, volume, cx, cz, y, bandTop);

        // The fine pass only has to look at what the bulk table could not express, so the engine
        // hands back the matching blocks instead of the scrubber walking all 32768 of them. What
        // remains is normally a few hundred edits per chunk rather than a 32768-call column read.
        let matches: BlockLocationIterator | null = null;
        try {
            matches = dimension.getBlocks(volume, UNTOUCHED_FILTER, true).getBlockLocationIterator();
        } catch (error) {
            refusedBands++;
            // Not routed through `firstError`: the query reports itself here, so the chunk-level line
            // below stays about the anomalies that are actually specific to this chunk.
            if (!fineQueryRefusalReported) {
                fineQueryRefusalReported = true;
                reportError(
                    {
                        system: "chunkScrubber",
                        operation: "fineScrubQuery",
                        target: `${cx},${cz}`,
                        details: { bandBottom: y, refusedBands, refusedBlocks }
                    },
                    error
                );
            }
        }

        if (matches !== null) {
            let inspected = 0;
            try {
                for (const location of matches) {
                    try {
                        const block = dimension.getBlock(location);
                        if (block) applyFineScrub(block);
                    } catch (error) {
                        refusedBlocks++;
                        firstError ??= error;
                    }

                    // Only reachable for a pathological chunk; the yield keeps one band off the watchdog.
                    if (++inspected % 512 === 0) yield;
                }
            } catch (error) {
                // The iterator itself gave up mid-band, so the band is left half-inspected. The next
                // re-verify finishes it; the chunk still counts as read.
                refusedReads++;
                firstError ??= error;
            }
        }

        yield;
    }

    // Only in-band anomalies reach here - a refused query has already reported itself, once for the
    // session - so this stays a per-chunk line, which is the cadence those are actually worth.
    if (firstError !== undefined) {
        reportError(
            { system: "chunkScrubber", operation: "fineScrub", target: `${cx},${cz}`, details: { refusedReads, refusedBlocks } },
            firstError
        );
    }

    return true;
}

// The pass budget is spent in player order, so always starting from the first player would let one
// player's ring eat the whole budget while everyone else's chunks waited - on a server the later
// players were never serviced at all. Rotating the starting point gives each player the ring in turn.
let playerCursor = 0;

export function* chunkScanJob(): Generator<void, void, unknown> {
    let scrubbed = 0;

    const players = world.getAllPlayers();
    const playerCount = players.length;
    if (playerCount === 0) return;

    const start = playerCount > 1 ? playerCursor % playerCount : 0;
    playerCursor = playerCount > 1 ? (start + 1) % playerCount : 0;

    for (let i = 0; i < playerCount; i++) {
        const player = players[(start + i) % playerCount];
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

            // Read per chunk rather than once per pass: a sweep yields across ticks, so a tick
            // captured at the top of the job would age while the pass is still running.
            const tick = system.currentTick;
            if (!needsScrub(key, tick) || isInFlight(key, tick)) continue;

            // An unloaded chunk rejects the fill and cannot be read back. Skipping it keeps it off the
            // budget entirely, so a neighbour that is not loaded yet cannot starve the ring; it is
            // picked up once it loads.
            if (!dimension.isChunkLoaded({ x: chunkX * CHUNK_SIZE, y: BETA_FLOOR_Y, z: chunkZ * CHUNK_SIZE })) continue;

            SCRUB_IN_FLIGHT.set(key, tick);
            solidifyBetaFloor(dimension, chunkX, chunkZ);
            clearFallenLogs(dimension, chunkX, chunkZ);

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
