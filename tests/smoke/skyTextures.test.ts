import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decodePng } from "../../scripts/lib/betaColorizer.mjs";

/**
 * Beta 1.7.3 hard-codes these paths in the client (`RenderGlobal`): `/environment/clouds.png`,
 * `/terrain/sun.png`, `/terrain/moon.png`, and the block-break crack drawn from `/terrain.png` at
 * atlas tiles 240 + damage * 10. Bedrock reads the same art from different places, so these are
 * file contracts, not behaviour tests: the engine either loads the file at that path or it does not.
 *
 * What cannot be proven offline is how Bedrock composites the files — in particular whether it
 * multiplies the crack stages the way Java did — which is why the tokens below assert identity and
 * shape rather than appearance.
 */
const environmentDir = resolve(process.cwd(), "packs/RP/textures/environment");
const miscDir = resolve(process.cwd(), "packs/RP/textures/misc");

function decode(path: string) {
    return decodePng(readFileSync(path));
}

/** Slice one frame out of a 4x2 sheet as raw scanline bytes, for palette or truecolour maps alike. */
function frameBytes(decoded: any, columns: number, rows: number, column: number, row: number): Buffer {
    const frameWidth = decoded.width / columns;
    const frameHeight = decoded.height / rows;
    const frameStride = Math.ceil((frameWidth * decoded.channels * decoded.bitDepth) / 8);
    const parts: Buffer[] = [];
    for (let y = 0; y < frameHeight; y++) {
        const start = (row * frameHeight + y) * decoded.stride + column * frameStride;
        parts.push(decoded.pixels.subarray(start, start + frameStride));
    }
    return Buffer.concat(parts);
}

describe("Beta Sky Textures - Resource Pack Environment Contract", () => {
    it("overrides clouds and the sun at the paths the engine reads", () => {
        assert.deepEqual([decode(resolve(environmentDir, "clouds.png")).width, decode(resolve(environmentDir, "clouds.png")).height], [256, 256]);
        assert.deepEqual([decode(resolve(environmentDir, "sun.png")).width, decode(resolve(environmentDir, "sun.png")).height], [32, 32]);
    });

    it("ships a single moon, not the eight phases Beta did not have", () => {
        // Beta had one `terrain/moon.png`. Bedrock only understands a 4x2 phase sheet, so the only
        // Beta-accurate sheet is the same moon repeated across all eight frames.
        const sheet = decode(resolve(environmentDir, "moon_phases.png"));
        assert.deepEqual([sheet.width, sheet.height], [128, 64], "moon sheet must be a 4x2 grid of 32x32 phases");

        const first = frameBytes(sheet, 4, 2, 0, 0);
        for (let row = 0; row < 2; row++) {
            for (let column = 0; column < 4; column++) {
                assert.ok(
                    first.equals(frameBytes(sheet, 4, 2, column, row)),
                    `moon phase frame (${row},${column}) differs; Beta 1.7.3 had no moon phases`
                );
            }
        }
    });

    it("overrides the pumpkin overlay", () => {
        const pumpkin = decode(resolve(miscDir, "pumpkinblur.png"));
        assert.deepEqual([pumpkin.width, pumpkin.height], [256, 256]);
    });

    it("ships ten distinct crack stages extracted from Beta's terrain atlas", () => {
        const stages = [];
        for (let i = 0; i < 10; i++) {
            const path = resolve(environmentDir, `destroy_stage_${i}.png`);
            assert.ok(existsSync(path), `missing destroy_stage_${i}.png`);
            const stage = decode(path);
            assert.deepEqual(
                [stage.width, stage.height],
                [16, 16],
                `destroy_stage_${i}.png must be one atlas tile`
            );
            stages.push(Buffer.from(stage.pixels));
        }

        assert.equal(new Set(stages.map(s => s.toString("base64"))).size, 10, "the ten stages must not be copies of one another");
    });
});
