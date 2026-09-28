import { world, system, BlockPermutation, Dimension } from "@minecraft/server";
import { BLOCK_BULK_REPLACEMENTS } from "../core/compatibilityPolicy.js";
import { normalizeBlock } from "../core/normalizer.js";
import { tickManager } from "../core/tickManager.js";

const CLEAN_CHUNKS = new Set<string>();
const MAX_CLEAN_CHUNKS_CACHE = 8192;
const CHUNKS_PER_TICK_LIMIT = 1;

function recordCleanChunk(key: string): void {
    if (CLEAN_CHUNKS.size >= MAX_CLEAN_CHUNKS_CACHE) {
        const oldest = CLEAN_CHUNKS.keys().next().value;
        if (oldest !== undefined) {
            CLEAN_CHUNKS.delete(oldest);
        }
    }
    CLEAN_CHUNKS.add(key);
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

/**
 * Generator for asynchronous chunk scanning and scrub operations.
 */
export function* chunkScanJob(): Generator<void, void, unknown> {
    let chunksProcessed = 0;

    for (const player of world.getAllPlayers()) {
        if (chunksProcessed >= CHUNKS_PER_TICK_LIMIT) return;

        const dim = player.dimension;
        const { x: px, z: pz } = player.location;
        const cx = Math.floor(px / 16);
        const cz = Math.floor(pz / 16);

        for (let dx = -1; dx <= 1; dx++) {
            if (chunksProcessed >= CHUNKS_PER_TICK_LIMIT) return;

            for (let dz = -1; dz <= 1; dz++) {
                const chunkX = cx + dx;
                const chunkZ = cz + dz;
                const key = `${dim.id}:${chunkX},${chunkZ}`;

                if (CLEAN_CHUNKS.has(key)) continue;

                runBulkCommands(dim, chunkX, chunkZ);

                system.runJob(scrubFineDetails(dim, chunkX, chunkZ));

                recordCleanChunk(key);
                chunksProcessed++;
            }
        }
        yield;
    }
}

tickManager.register("chunkScrubber", 3, chunkScanJob, 1);

function runBulkCommands(dim: Dimension, cx: number, cz: number): void {
    const x1 = cx * 16;
    const z1 = cz * 16;
    const x2 = x1 + 15;
    const z2 = z1 + 15;

    let yMin = -64;
    let yMax = 320;

    if (dim.id === "minecraft:the_nether") {
        yMin = 0;
        yMax = 128;
    }

    const slices = dim.id === "minecraft:the_nether" ? [
        { min: 0, max: 64 },
        { min: 65, max: 128 }
    ] : [
        { min: yMin, max: 0 },       // deepslate
        { min: 1, max: 100 },        // surface
        { min: 101, max: 200 },      // low mountain
        { min: 201, max: yMax }      // high mountain
    ];

    for (const [target, replace] of BLOCK_BULK_REPLACEMENTS) {
        if (target.includes("deepslate") && dim.id === "minecraft:the_nether") continue;

        if (target === "minecraft:magma_block" && dim.id !== "minecraft:the_nether") {
            try {
                dim.runCommand(`fill ${x1} ${yMin} ${z1} ${x2} ${yMax} ${z2} minecraft:stone replace minecraft:magma_block`);
            } catch {
                // Ignore
            }
            continue;
        }

        for (const slice of slices) {
            if (slice.min >= slice.max) continue;
            try {
                dim.runCommand(`fill ${x1} ${slice.min} ${z1} ${x2} ${slice.max} ${z2} ${replace} replace ${target}`);
            } catch {
                // Ignore
            }
        }
    }
}

export function* scrubFineDetails(dimension: Dimension, cx: number, cz: number): Generator<void, void, unknown> {
    const startX = cx * 16;
    const startZ = cz * 16;

    const minY = dimension.id === "minecraft:the_nether" ? 0 : -8;
    const maxY = 128;

    for (let x = 0; x < 16; x++) {
        for (let z = 0; z < 16; z++) {
            for (let y = minY; y < maxY; y++) {
                try {
                    const block = dimension.getBlock({ x: startX + x, y: y, z: startZ + z });
                    if (!block) continue;

                    const typeId = block.typeId;

                    if (typeId === "minecraft:air" || typeId === "minecraft:stone" || typeId === "minecraft:water") continue;

                    // Bedrock collapses every wood type into one planks block, so it is not an
                    // unknown modern block — retype it to oak instead of scrubbing it away.
                    if (typeId === "minecraft:planks") {
                        const perm = block.permutation;
                        if (perm.getState("wood_type") !== "oak") {
                            block.setPermutation(BlockPermutation.resolve("minecraft:planks").withState("wood_type", "oak"));
                        }
                        continue;
                    }

                    const blockNorm = normalizeBlock(typeId);
                    if (blockNorm.action === "convert" && blockNorm.targetId) {
                        const target = blockNorm.targetId;
                        if (target === "minecraft:air") block.setType("minecraft:air");
                        else if (target === "minecraft:water") block.setType("minecraft:water");
                        else {
                            const p = getPermutation(target);
                            if (p) block.setPermutation(p);
                        }
                    } else if (blockNorm.action === "remove") {
                        // Inverse allowlist: any minecraft: block outside BETA_BLOCK_IDS that has no
                        // authentic counterpart must be scrubbed, not left behind in the chunk.
                        block.setType("minecraft:air");
                    }
                } catch {
                    // Ignore
                }
            }
            yield;
        }
    }
}
