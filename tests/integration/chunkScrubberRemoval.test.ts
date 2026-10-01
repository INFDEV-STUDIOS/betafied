import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BlockPermutation } from "@minecraft/server";
import { scrubFineDetails } from "../../packs/BP/scripts/world/chunkScrubber.js";

interface RecordedBlock {
    typeId: string;
    permutation: any;
    setTypeCalls: string[];
    permutationCalls: string[];
    setType(id: string): void;
    setPermutation(perm: any): void;
}

function recordingBlock(typeId: string, states: Record<string, any> = {}): RecordedBlock {
    const block: RecordedBlock = {
        typeId,
        permutation: BlockPermutation.resolve(typeId, states),
        setTypeCalls: [],
        permutationCalls: [],
        setType(id: string) {
            block.setTypeCalls.push(id);
            block.typeId = id;
        },
        setPermutation(perm: any) {
            block.permutationCalls.push(perm.typeId);
        }
    };
    return block;
}

const AIR = {
    typeId: "minecraft:air",
    permutation: BlockPermutation.resolve("minecraft:air"),
    setType() {},
    setPermutation() {}
};

interface TestDimension {
    id: string;
    heightRange: { min: number; max: number };
    commands: string[];
    containsBlockCalls: number;
    getBlock(location: { x: number; y: number; z: number }): RecordedBlock;
    isChunkLoaded(location: { x: number; y: number; z: number }): boolean;
    getBlocks(volume: any, filter: any): { getBlockLocationIterator(): IterableIterator<{ x: number; y: number; z: number }> };
    containsBlock(volume: any, filter: any): boolean;
    runCommand(command: string): { successCount: number };
}

/**
 * Stands in for the dimension the way the script API presents it: the scrubber only ever asks for a
 * filter *over a volume*, never for individual coordinates, so the mock has to answer those queries
 * from the same block map instead of counting getBlock calls.
 */
function scrubDimension(blocks: Map<string, RecordedBlock>): TestDimension {
    const commands: string[] = [];
    let containsBlockCalls = 0;

    const typeIdAt = (x: number, y: number, z: number): string => blocks.get(`${x},${y},${z}`)?.typeId ?? AIR.typeId;

    const accepts = (typeId: string, filter: any): boolean => {
        if (filter.includeTypes && !filter.includeTypes.includes(typeId)) return false;
        if (filter.excludeTypes && filter.excludeTypes.includes(typeId)) return false;
        return true;
    };

    const walk = (volume: any, visit: (x: number, y: number, z: number) => boolean | void): void => {
        for (let x = volume.from.x; x <= volume.to.x; x++) {
            for (let y = volume.from.y; y <= volume.to.y; y++) {
                for (let z = volume.from.z; z <= volume.to.z; z++) {
                    if (visit(x, y, z) === false) return;
                }
            }
        }
    };

    return {
        id: "minecraft:overworld",
        heightRange: { min: -64, max: 319 },
        commands,
        get containsBlockCalls() {
            return containsBlockCalls;
        },
        getBlock({ x, y, z }) {
            return blocks.get(`${x},${y},${z}`) ?? AIR;
        },
        isChunkLoaded() {
            return true;
        },
        getBlocks(volume, filter) {
            const hits: { x: number; y: number; z: number }[] = [];
            walk(volume, (x, y, z) => {
                if (accepts(typeIdAt(x, y, z), filter)) hits.push({ x, y, z });
            });
            return { getBlockLocationIterator: () => hits[Symbol.iterator]() };
        },
        containsBlock(volume, filter) {
            containsBlockCalls++;
            let found = false;
            walk(volume, (x, y, z) => {
                if (accepts(typeIdAt(x, y, z), filter)) {
                    found = true;
                    return false;
                }
            });
            return found;
        },
        runCommand(command) {
            commands.push(command);
            return { successCount: 1 };
        }
    };
}

function drain(dim: TestDimension): boolean | undefined {
    const job = scrubFineDetails(dim as any, 0, 0);
    let step = job.next();
    while (!step.done) {
        step = job.next();
    }
    return step.value;
}

function scrub(dim: TestDimension): void {
    drain(dim);
}

function bulkFillsFor(dim: TestDimension, target: string): string[] {
    return dim.commands.filter(command => command.endsWith(` replace ${target}`));
}

describe("Chunk Scrubber - Inverse Allowlist Enforcement", () => {
    it("scrubs post-Beta blocks that have no authentic counterpart", () => {
        const beeNest = recordingBlock("minecraft:bee_nest");
        const beehive = recordingBlock("minecraft:beehive");
        const stoneBricks = recordingBlock("minecraft:stone_bricks");

        const blocks = new Map<string, RecordedBlock>([
            ["3,64,4", beeNest],
            ["5,70,6", beehive],
            ["7,12,8", stoneBricks]
        ]);

        scrub(scrubDimension(blocks));

        assert.deepEqual(beeNest.setTypeCalls, ["minecraft:air"], "bee nests must be deleted");
        assert.deepEqual(beehive.setTypeCalls, ["minecraft:air"], "beehives must be deleted");
        assert.deepEqual(stoneBricks.setTypeCalls, ["minecraft:air"], "all non-Beta blocks must be deleted");
    });

    it("keeps authentic Beta blocks untouched", () => {
        const log = recordingBlock("minecraft:oak_log");
        const cobble = recordingBlock("minecraft:cobblestone");

        scrub(scrubDimension(new Map<string, RecordedBlock>([
            ["1,64,1", log],
            ["2,65,2", cobble]
        ])));

        assert.deepEqual(log.setTypeCalls, []);
        assert.deepEqual(log.permutationCalls, []);
        assert.deepEqual(cobble.setTypeCalls, []);
        assert.deepEqual(cobble.permutationCalls, []);
    });

    it("still converts convertible modern blocks rather than deleting them", () => {
        const andesite = recordingBlock("minecraft:andesite");
        const dim = scrubDimension(new Map<string, RecordedBlock>([["2,64,2", andesite]]));

        scrub(dim);

        assert.equal(andesite.setTypeCalls.length, 0, "a convertible block must never be deleted");
    });

    it("retypes Bedrock's consolidated planks block to oak instead of scrubbing it", () => {
        const planks = recordingBlock("minecraft:planks", { wood_type: "spruce" });

        scrub(scrubDimension(new Map<string, RecordedBlock>([["7,64,7", planks]])));

        assert.deepEqual(planks.setTypeCalls, []);
        assert.deepEqual(planks.permutationCalls, ["minecraft:planks"]);
    });

    it("runs a bulk fill for every post-Beta rock type the chunk actually holds", () => {
        const dim = scrubDimension(new Map<string, RecordedBlock>([
            ["2,64,2", recordingBlock("minecraft:andesite")],
            ["8,20,3", recordingBlock("minecraft:deepslate")]
        ]));

        scrub(dim);

        assert.deepEqual(bulkFillsFor(dim, "minecraft:andesite"), [
            "fill 0 0 0 15 127 15 minecraft:stone replace minecraft:andesite"
        ]);
        assert.deepEqual(bulkFillsFor(dim, "minecraft:deepslate"), [
            "fill 0 0 0 15 127 15 minecraft:stone replace minecraft:deepslate"
        ]);
    });

    it("reports success only for a chunk it was actually able to read", () => {
        const readable = scrubDimension(new Map<string, RecordedBlock>());
        assert.equal(drain(readable), true, "a fully read chunk is done");

        const unloaded = scrubDimension(new Map<string, RecordedBlock>());
        unloaded.isChunkLoaded = () => false;

        // An unloaded chunk reads as "nothing to do", which must not be mistaken for "already clean"
        // now that a success mark keeps a chunk out of the queue until the re-verify window.
        assert.equal(drain(unloaded), false, "an unread chunk must stay queued for a retry");
        assert.deepEqual(unloaded.commands, [], "an unloaded chunk must not be filled against");
    });

    it("group-tests the bulk table instead of probing every entry", () => {
        const dim = scrubDimension(new Map<string, RecordedBlock>([
            ["2,64,2", recordingBlock("minecraft:andesite")]
        ]));

        scrub(dim);

        // A 70-entry table must not cost 70 full-volume scans. The present type is located by
        // pruning ranges, so the probe count tracks what the chunk holds, not the table's size.
        assert.ok(
            dim.containsBlockCalls < 40,
            `expected group-testing, got ${dim.containsBlockCalls} volume probes`
        );
    });

    it("never builds a fill for a type the chunk does not contain", () => {
        const dim = scrubDimension(new Map<string, RecordedBlock>([
            ["2,64,2", recordingBlock("minecraft:andesite")]
        ]));

        scrub(dim);

        // The gating probe is the whole point: 80 table entries would otherwise each pay for a native
        // scan of the band, and this chunk only needs the one it actually holds.
        assert.equal(dim.commands.length, 1, `expected only the andesite fill, got: ${dim.commands.join(" | ")}`);
        assert.deepEqual(bulkFillsFor(dim, "minecraft:deepslate"), []);
        assert.deepEqual(bulkFillsFor(dim, "minecraft:terracotta"), []);
        assert.deepEqual(bulkFillsFor(dim, "minecraft:magma"), []);
    });
});
