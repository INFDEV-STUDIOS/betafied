import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { solidifyBetaFloor } from "../../packs/BP/scripts/world/chunkScrubber.js";

function capturingDimension(id = "minecraft:overworld") {
    const commands: string[] = [];
    return {
        id,
        heightRange: { min: -64, max: 319 },
        commands,
        runCommand(command: string) {
            commands.push(command);
            return { successCount: 1 };
        }
    };
}

describe("Beta floor - deep world sealing", () => {
    it("ballasts the sub-zero column and caps it with a flat bedrock floor", () => {
        const dim = capturingDimension();
        solidifyBetaFloor(dim as never, 0, 0);

        assert.ok(
            dim.commands.includes("fill 0 -63 0 15 -1 15 minecraft:stone"),
            `expected sub-zero ballast, got: ${dim.commands.join(" | ")}`
        );
        assert.ok(
            dim.commands.includes("fill 0 0 0 15 0 15 minecraft:bedrock"),
            "expected a flat bedrock cap at Y=0"
        );
    });

    it("stacks a few uneven bedrock layers so the cap is not a mirror", () => {
        const dim = capturingDimension();
        solidifyBetaFloor(dim as never, 4, -7);

        const x1 = 64;
        const z1 = -112;
        const layers = dim.commands.filter(c =>
            c.startsWith(`fill `) && / minecraft:bedrock$/.test(c) && !c.includes(` ${x1} 0 `)
        );

        assert.equal(layers.length, 3, `expected 3 rough layers, got ${layers.join(" | ")}`);

        for (const command of layers) {
            const [, fx1, fy, fz1, fx2, , fz2] = command.split(" ");
            assert.ok(Number(fy) >= 1 && Number(fy) <= 3, "rough layers sit just above the base");
            assert.ok(Number(fx1) >= x1 && Number(fx2) <= x1 + 15, "layers stay inside the chunk in X");
            assert.ok(Number(fz1) >= z1 && Number(fz2) <= z1 + 15, "layers stay inside the chunk in Z");
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
