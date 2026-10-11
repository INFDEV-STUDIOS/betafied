import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mockPlayers } from "../mocks/minecraftServer.js";
import { chunkScanJob } from "../../packs/BP/scripts/world/chunkScrubber.js";

// A refused volume query reports through the ambient Bedrock console, so capture it rather than let
// the line land in the test output.
function captureWarnings(): { lines: string[]; restore: () => void } {
    const lines: string[] = [];
    const original = console.warn;
    console.warn = (message?: unknown) => {
        lines.push(String(message));
    };
    return { lines, restore: () => { console.warn = original; } };
}

/**
 * Minimal dimension stub for the scan loop. The floor seal only needs runCommand, and the fine sweep
 * needs to answer "is there anything to inspect" - saying no everywhere lets one pass finish so the
 * order of the chunks can be read straight off the fill commands.
 */
function scanDimension(
    commands: string[],
    isUnloaded: (location: { x: number; y: number; z: number }) => boolean = () => false
) {
    return {
        id: "minecraft:overworld",
        heightRange: { min: -64, max: 319 },
        fillBlocks(
            volume: { from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number } },
            block: string
        ) {
            const { from, to } = volume;
            commands.push(`fill ${from.x} ${from.y} ${from.z} ${to.x} ${to.y} ${to.z} ${block}`);
        },
        isChunkLoaded(location: { x: number; y: number; z: number }) {
            return !isUnloaded(location);
        },
        containsBlock(_volume: unknown, filter?: { excludeTypes?: string[] }) {
            // The seal probe asks for anything that is not bedrock in the Y=0 layer. Report the base as
            // unsealed so every pass lays its floor and the visit order can be read off the fills; every
            // other probe (the bulk table, the fallen-log scan) still answers "nothing present".
            return Boolean(filter?.excludeTypes?.includes("minecraft:bedrock"));
        },
        getBlocks() {
            return { getBlockLocationIterator: () => ([] as { x: number; y: number; z: number }[])[Symbol.iterator]() };
        },
        getBlock() {
            return undefined;
        }
    };
}

function drain(job: Generator<void, void, unknown>): void {
    for (const _ of job) {
        // The scan loop yields between chunks; every step is part of the recorded pass.
    }
}

/** The base seal is the only fill that spans a single Y=0 layer; the bumps all sit above it. */
function baseChunks(commands: string[]): Set<string> {
    return new Set(
        commands
            .map(command => command.split(" "))
            .filter(parts => parts[0] === "fill" && parts[2] === "0" && parts[5] === "0")
            .map(parts => `${Number(parts[1]) / 16},${Number(parts[3]) / 16}`)
    );
}

describe("Chunk scrubber - visit order", () => {
    let warnings: { lines: string[]; restore: () => void };

    beforeEach(() => {
        mockPlayers.length = 0;
        warnings = captureWarnings();
    });

    afterEach(() => {
        warnings.restore();
    });

    it("seals the player's own chunk before the ring around it", () => {
        const commands: string[] = [];
        const dimension = scanDimension(commands);

        mockPlayers.push({
            isValid: true,
            location: { x: -33, y: 13, z: 1 },
            dimension
        } as never);

        drain(chunkScanJob());

        assert.equal(
            commands[0],
            "fill -48 0 0 -33 0 15 minecraft:bedrock",
            `expected the player's own chunk first, got: ${commands.slice(0, 2).join(" | ")}`
        );
    });

    it("seals the ring around the player's own chunk", () => {
        const commands: string[] = [];
        const dimension = scanDimension(commands);

        // Far from the previous case's chunk so no seal is already marked done.
        mockPlayers.push({
            isValid: true,
            location: { x: 1000, y: 13, z: 1000 },
            dimension
        } as never);

        // One chunk is sealed per pass, so the whole neighbourhood takes one pass per chunk.
        for (let pass = 0; pass < 9; pass++) {
            drain(chunkScanJob());
        }

        const playerChunkX = Math.floor(1000 / 16);
        const playerChunkZ = Math.floor(1000 / 16);

        const sealed = baseChunks(commands);

        assert.equal(sealed.size, 9, `expected a 3x3 neighbourhood, got ${sealed.size}: ${[...sealed].join(" ")}`);

        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                assert.ok(
                    sealed.has(`${playerChunkX + dx},${playerChunkZ + dz}`),
                    `expected chunk ${dx},${dz} to be sealed`
                );
            }
        }
    });

    it("reports a refused fine query once for the whole neighbourhood", () => {
        const commands: string[] = [];
        const dimension = scanDimension(commands);
        // The engine refuses the volume query on every band of every chunk. Reported per chunk that
        // was nine lines per neighbourhood sweep, forever; the refusal is one condition about the
        // engine, so it is one line.
        dimension.getBlocks = () => {
            throw new Error("the volume query is unavailable");
        };

        mockPlayers.push({ isValid: true, location: { x: 3000, y: 13, z: 3000 }, dimension } as never);

        // One chunk is sealed per pass, so the neighbourhood takes one pass per chunk.
        for (let pass = 0; pass < 9; pass++) {
            drain(chunkScanJob());
        }

        assert.equal(
            warnings.lines.filter(line => line.includes("during fineScrubQuery")).length,
            1,
            `expected one line for nine chunks, got: ${warnings.lines.join(" | ")}`
        );
        // The sweep still did its work; silencing the report must not be done by skipping the pass.
        assert.equal(baseChunks(commands).size, 9, "the whole neighbourhood must still be sealed");
    });

    it("moves on while the chunk under the player is still mid-sweep", () => {
        const commands: string[] = [];
        const dimension = scanDimension(commands);
        mockPlayers.push({ isValid: true, location: { x: 2000, y: 13, z: 2000 }, dimension } as never);

        // A sweep yields mid-chunk, so the scheduler's next pass starts while this one still owns its
        // chunk. It must claim the next one instead of re-sealing the same ground.
        const first = chunkScanJob();
        first.next();

        const before = commands.length;
        drain(chunkScanJob());

        assert.notEqual(
            commands[before],
            commands[0],
            `the second pass re-sealed the first pass's chunk: ${commands[before]}`
        );
    });

    it("reaches past a neighbour that is not loaded yet", () => {
        const commands: string[] = [];
        const centerX = 150;
        const centerZ = 150;
        const westX = (centerX - 1) * 16;

        const dimension = scanDimension(commands, location => location.x === westX && location.z === centerZ * 16);
        mockPlayers.push({
            isValid: true,
            location: { x: centerX * 16 + 8, y: 13, z: centerZ * 16 + 8 },
            dimension
        } as never);

        drain(chunkScanJob()); // the player's own chunk
        drain(chunkScanJob()); // the west neighbour is unloaded, so the pass must reach the next one

        const sealed = baseChunks(commands);

        assert.ok(sealed.has(`${centerX},${centerZ}`), "the player's chunk must be sealed");
        assert.ok(sealed.has(`${centerX},${centerZ - 1}`), "the pass must reach past the unloaded neighbour");
        assert.ok(!sealed.has(`${centerX - 1},${centerZ}`), "an unloaded neighbour must not be filled against");
    });
});
