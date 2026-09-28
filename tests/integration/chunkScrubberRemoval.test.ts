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

function dimensionWith(blocks: Map<string, RecordedBlock>) {
    return {
        id: "minecraft:overworld",
        getBlock({ x, y, z }: { x: number; y: number; z: number }) {
            return blocks.get(`${x},${y},${z}`) ?? AIR;
        }
    };
}

function scrub(blocks: Map<string, RecordedBlock>): void {
    const job = scrubFineDetails(dimensionWith(blocks) as any, 0, 0);
    while (!job.next().done) {
        // drain the generator the same way system.runJob would
    }
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

        scrub(blocks);

        assert.deepEqual(beeNest.setTypeCalls, ["minecraft:air"], "bee nests must be deleted");
        assert.deepEqual(beehive.setTypeCalls, ["minecraft:air"], "beehives must be deleted");
        assert.deepEqual(stoneBricks.setTypeCalls, ["minecraft:air"], "all non-Beta blocks must be deleted");
    });

    it("keeps authentic Beta blocks untouched", () => {
        const log = recordingBlock("minecraft:oak_log");
        const cobble = recordingBlock("minecraft:cobblestone");

        scrub(new Map<string, RecordedBlock>([
            ["1,64,1", log],
            ["2,65,2", cobble]
        ]));

        assert.deepEqual(log.setTypeCalls, []);
        assert.deepEqual(log.permutationCalls, []);
        assert.deepEqual(cobble.setTypeCalls, []);
        assert.deepEqual(cobble.permutationCalls, []);
    });

    it("still converts convertible modern blocks rather than deleting them", () => {
        const andesite = recordingBlock("minecraft:andesite");

        scrub(new Map<string, RecordedBlock>([["2,64,2", andesite]]));

        assert.deepEqual(andesite.setTypeCalls, []);
        assert.deepEqual(andesite.permutationCalls, ["minecraft:stone"]);
    });

    it("retypes Bedrock's consolidated planks block to oak instead of scrubbing it", () => {
        const planks = recordingBlock("minecraft:planks", { wood_type: "spruce" });

        scrub(new Map<string, RecordedBlock>([["7,64,7", planks]]));

        assert.deepEqual(planks.setTypeCalls, []);
        assert.deepEqual(planks.permutationCalls, ["minecraft:planks"]);
    });
});
