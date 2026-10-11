import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { solidifyBetaFloor } from "../../packs/BP/scripts/world/chunkScrubber.js";

/**
 * Records the native fill calls the way the scrubber makes them. The code talks to the block API
 * rather than to commands, so the stub renders each volume back into the familiar `fill` shape to
 * keep the assertions readable.
 */
function capturingDimension(id = "minecraft:overworld", strayBedrockAt: number | null = null) {
    const commands: string[] = [];
    return {
        id,
        heightRange: { min: -64, max: 319 },
        commands,
        containsBlock(
            volume: { from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number } },
            filter: { includeTypes?: string[]; excludeTypes?: string[] }
        ) {
            // The seal probe asks whether anything other than bedrock sits in the Y=0 base. This stub
            // holds no blocks, so the base reads as unsealed and the floor is laid out - which is what
            // the assertions read off the fills below.
            if (filter.excludeTypes?.includes("minecraft:bedrock")) return true;
            if (strayBedrockAt === null) return false;
            if (!filter.includeTypes?.includes("minecraft:bedrock")) return false;
            return volume.from.y <= strayBedrockAt && strayBedrockAt <= volume.to.y;
        },
        fillBlocks(
            volume: { from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number } },
            block: string,
            options?: { blockFilter?: { includeTypes?: string[] } }
        ) {
            const { from, to } = volume;
            const replace = options?.blockFilter?.includeTypes?.[0];
            commands.push(`fill ${from.x} ${from.y} ${from.z} ${to.x} ${to.y} ${to.z} ${block}${replace === undefined ? "" : ` replace ${replace}`}`);
            return { getBlockLocationIterator: () => ([] as { x: number; y: number; z: number }[])[Symbol.iterator]() };
        }
    };
}

/**
 * Answers the "is there anything but bedrock at Y=0" probe the way an already-sealed chunk does, so
 * the seal can be shown to short-circuit instead of re-laying ~120 fills.
 */
function sealedFloorDimension(id = "minecraft:overworld") {
    const commands: string[] = [];
    return {
        id,
        heightRange: { min: -64, max: 319 },
        commands,
        containsBlock(volume: { from: { y: number } }, filter: { excludeTypes?: string[] }) {
            if (!filter.excludeTypes?.includes("minecraft:bedrock")) return false;
            // Nothing above the base layer is asked about by the seal probe.
            return volume.from.y > 0;
        },
        fillBlocks(volume: { from: { x: number; y: number; z: number } }, block: string) {
            commands.push(`fill ${volume.from.x} ${volume.from.y} ${volume.from.z} ${block}`);
        }
    };
}

describe("Beta floor - deep world sealing", () => {
    it("seals Y=0 with a full bedrock base and leaves the sub-zero column alone", () => {
        const dim = capturingDimension();
        solidifyBetaFloor(dim as never, 0, 0);

        assert.ok(
            dim.commands.includes("fill 0 0 0 15 0 15 minecraft:bedrock"),
            `expected a full bedrock base at Y=0, got: ${dim.commands.join(" | ")}`
        );
        assert.ok(
            !dim.commands.some(c => c.includes("minecraft:stone")),
            `expected no sub-zero ballast, got: ${dim.commands.join(" | ")}`
        );
    });

    it("builds the floor from a rough heightmap instead of stacked full-chunk slabs", () => {
        const dim = capturingDimension();
        solidifyBetaFloor(dim as never, 4, -7);

        const x1 = 64;
        const z1 = -112;
        const bedrock = dim.commands.filter(c => c.startsWith("fill ") && / minecraft:bedrock$/.test(c));
        const base = bedrock.filter(c => c === `fill ${x1} 0 ${z1} ${x1 + 15} 0 ${z1 + 15} minecraft:bedrock`);

        assert.equal(base.length, 1, "expected exactly one full-chunk bedrock base at Y=0");

        const bumps = bedrock.filter(c => c !== base[0]);
        assert.ok(bumps.length > 3, `expected many small bumps, got ${bumps.length}: ${bumps.join(" | ")}`);

        for (const command of bumps) {
            const [, fx1, fy1, fz1, fx2, fy2, fz2] = command.split(" ");
            assert.ok(Number(fy1) >= 1 && Number(fy2) <= 2, "bumps sit just above the base");
            assert.ok(Number(fy2) >= Number(fy1), "each bump is a contiguous vertical run");
            assert.ok(Number(fx1) >= x1 && Number(fx2) <= x1 + 15, "bumps stay inside the chunk in X");
            assert.ok(Number(fz1) >= z1 && Number(fz2) <= z1 + 15, "bumps stay inside the chunk in Z");
            assert.ok(Number(fx2) - Number(fx1) + 1 < 16, "no bump spans a whole chunk edge");
        }
    });

    it("is deterministic for a chunk but varies between chunks", () => {
        const first = capturingDimension();
        const second = capturingDimension();
        solidifyBetaFloor(first as never, 12, 34);
        solidifyBetaFloor(second as never, 12, 34);
        assert.deepEqual(first.commands, second.commands, "the same chunk must always seal the same way");

        const other = capturingDimension();
        solidifyBetaFloor(other as never, -9, 34);
        assert.notDeepEqual(first.commands, other.commands, "different chunks should get a different ragged cap");
    });

    it("never touches the Nether or the End", () => {
        const nether = capturingDimension("minecraft:the_nether");
        const end = capturingDimension("minecraft:the_end");
        solidifyBetaFloor(nether as never, 0, 0);
        solidifyBetaFloor(end as never, 0, 0);

        assert.deepEqual(nether.commands, []);
        assert.deepEqual(end.commands, []);
    });
});

describe("Beta floor - bedrock above the floor is left alone", () => {
    it("solidifying the floor never clears bedrock above Y=2, wherever it sits", () => {
        const stray = capturingDimension("minecraft:overworld", 8);
        solidifyBetaFloor(stray as never, 0, 0);

        for (const command of stray.commands) {
            const [, , fy1] = command.split(" ");
            assert.ok(Number(fy1) <= 2, `expected no write reaching above Y=2, got: ${command}`);
            assert.ok(!command.includes("minecraft:air"), `expected no air clear, got: ${command}`);
        }
    });
});

describe("Beta floor - an already-sealed chunk is left alone", () => {
    it("rebuilds nothing once the Y=0 base is already bedrock", () => {
        const dim = sealedFloorDimension();
        solidifyBetaFloor(dim as never, 0, 0);

        assert.deepEqual(dim.commands, [], "a floor that is already sealed must not be laid down again");
    });

    it("still no-ops outside the Overworld", () => {
        const nether = sealedFloorDimension("minecraft:the_nether");
        solidifyBetaFloor(nether as never, 0, 0);

        assert.deepEqual(nether.commands, [], "the floor is an Overworld-only rule");
    });
});
