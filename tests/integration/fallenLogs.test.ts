import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { clearFallenLogs } from "../../packs/BP/scripts/world/chunkScrubber.js";

interface Placed {
    typeId: string;
    states: Record<string, unknown>;
}

interface RecordedFill {
    block: string;
    permutationCount: number;
}

/**
 * Answers the two engine calls `clearFallenLogs` makes - a presence probe and a filtered fill - from
 * the same block map, matching permutations the way the engine would: by type and the axis state.
 */
function fallenLogDimension(id: string, blocks: Map<string, Placed>) {
    const fills: RecordedFill[] = [];

    const matches = (placed: Placed, filter: any): boolean => {
        const permutations = filter?.includePermutations;
        if (!Array.isArray(permutations)) return false;
        return permutations.some(
            (perm: any) =>
                perm.type.id === placed.typeId &&
                perm.getState("pillar_axis") === placed.states.pillar_axis
        );
    };

    return {
        id,
        heightRange: { min: -64, max: 319 },
        fills,
        containsBlock(volume: any, filter: any): boolean {
            for (let x = volume.from.x; x <= volume.to.x; x++) {
                for (let y = volume.from.y; y <= volume.to.y; y++) {
                    for (let z = volume.from.z; z <= volume.to.z; z++) {
                        const placed = blocks.get(`${x},${y},${z}`);
                        if (placed && matches(placed, filter)) return true;
                    }
                }
            }
            return false;
        },
        fillBlocks(_volume: any, block: string, options: any): void {
            fills.push({ block, permutationCount: options.blockFilter.includePermutations.length });
        }
    };
}

describe("Chunk Scrubber - fallen logs", () => {
    it("clears a sideways log to air", () => {
        const dim = fallenLogDimension("minecraft:overworld", new Map([
            ["5,70,3", { typeId: "minecraft:oak_log", states: { pillar_axis: "x" } }]
        ]));

        clearFallenLogs(dim as any, 0, 0);

        assert.equal(dim.fills.length, 1, "a sideways log must trigger exactly one fill");
        assert.equal(dim.fills[0].block, "minecraft:air", "the fallen log must become air");
        // oak, birch and spruce each contribute an x and a z permutation.
        assert.equal(dim.fills[0].permutationCount, 6, "the filter must cover every Beta log species both ways");
    });

    it("leaves an upright log alone", () => {
        const dim = fallenLogDimension("minecraft:overworld", new Map([
            ["5,70,3", { typeId: "minecraft:oak_log", states: { pillar_axis: "y" } }]
        ]));

        clearFallenLogs(dim as any, 0, 0);

        assert.equal(dim.fills.length, 0, "a vertical log is authentic Beta and must survive");
    });

    it("only runs in the Overworld", () => {
        const dim = fallenLogDimension("minecraft:the_nether", new Map([
            ["5,70,3", { typeId: "minecraft:oak_log", states: { pillar_axis: "x" } }]
        ]));

        clearFallenLogs(dim as any, 0, 0);

        assert.equal(dim.fills.length, 0, "the fallen-log sweep is an Overworld-only rule");
    });
});
