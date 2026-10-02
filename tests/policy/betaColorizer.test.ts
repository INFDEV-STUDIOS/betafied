import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import {
    betaBiomeAt,
    betaSkyColor,
    createColorizer,
    decodePng,
    toArgbBuffer
} from "../../scripts/lib/betaColorizer.mjs";

/**
 * The colorizer is a pure function of its inputs, so these cases are real evidence rather than a
 * restatement of a table: they pin the exact index arithmetic and boundary conditions lifted from
 * b1.7.3's `ColorizerGrass` / `BiomeGenBase`. The one part a test cannot prove offline is that the
 * shipped PNGs are the genuine Beta assets — that is why the derivation records their sizes.
 */

/** Build the `buffer[y << 8 | x]` array the colorizers index, encoding x in red and y in green. */
function syntheticColormap() {
    const buffer = new Uint32Array(65536);
    for (let y = 0; y < 256; y++) {
        for (let x = 0; x < 256; x++) {
            buffer[(y << 8) | x] = (0xff000000 | (x << 16) | (y << 8)) >>> 0;
        }
    }
    return createColorizer(buffer);
}

function chunk(type, body) {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(body.length, 0);
    header.write(type, 4, "latin1");
    // The decoder never reads CRCs, so a placeholder keeps this helper short.
    return Buffer.concat([header, body, Buffer.alloc(4)]);
}

function buildRgbaPng(width, height, paint) {
    const raw = Buffer.alloc(height * (1 + width * 4));
    for (let y = 0; y < height; y++) {
        const row = y * (1 + width * 4);
        raw[row] = 0;
        for (let x = 0; x < width; x++) {
            const [r, g, b, a] = paint(x, y);
            const at = row + 1 + x * 4;
            raw[at] = r;
            raw[at + 1] = g;
            raw[at + 2] = b;
            raw[at + 3] = a;
        }
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;

    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", ihdr),
        chunk("IDAT", deflateSync(raw)),
        chunk("IEND", Buffer.alloc(0))
    ]);
}

describe("Beta colorizer", () => {
    describe("getGrassColor index arithmetic", () => {
        it("maps temperature and humidity onto the buffer the way the client did", () => {
            const grass = syntheticColormap();

            // x = (1 - t) * 255, y = (1 - t * h) * 255, both truncated toward zero.
            assert.equal(grass(0.5, 0.5), 0xff7fbf00, "0.5/0.5 -> x=127, y=191");
            assert.equal(grass(0.7, 0.8), 0xff4c7000, "0.7/0.8 -> x=76, y=112 after humidity *= temperature");
            assert.equal(grass(1, 1), 0xff000000, "full temperature and humidity reach the origin");
        });

        it("keeps a dry block on the bottom row regardless of temperature", () => {
            const grass = syntheticColormap();
            assert.equal(grass(0.25, 0), 0xffbfff00, "x=191, y=255");
        });

        it("clamps out-of-range climate instead of trusting it into a negative index", () => {
            const grass = syntheticColormap();
            assert.equal(grass(2, -1), 0xff00ff00, "temperature clamps to 1 and humidity to 0, so x=0 and y=255");
        });
    });

    describe("getBiome classification", () => {
        it("matches the boundary cases from BiomeGenBase.getBiome", () => {
            assert.equal(betaBiomeAt(0.05, 0.9), "tundra", "temperature below 0.1 is always tundra");
            assert.equal(betaBiomeAt(0.3, 0.1), "tundra", "dry and cold");
            assert.equal(betaBiomeAt(0.6, 0.1), "savanna", "dry and temperate");
            assert.equal(betaBiomeAt(0.99, 0.1), "desert", "dry and hot");
            assert.equal(betaBiomeAt(0.6, 0.95), "swampland", "humid and below 0.7");
            assert.equal(betaBiomeAt(0.4, 0.9), "taiga", "humid and cold");
            assert.equal(betaBiomeAt(0.6, 0.4), "shrubland", "humid and temperate but dry enough");
            assert.equal(betaBiomeAt(0.7, 0.9), "forest", "temperate rainforest edge");
            assert.equal(betaBiomeAt(0.99, 0.3), "plains", "hot and dry");
            assert.equal(betaBiomeAt(0.99, 0.6), "seasonal_forest", "hot and wet");
            assert.equal(betaBiomeAt(0.99, 0.99), "rainforest", "hot and soaked");
        });
    });

    describe("getSkyColorByTemp", () => {
        it("returns the colour Java's Color.getHSBColor would for the same temperature", () => {
            // Hue = 0.62222224 - t/3 * 0.05, saturation = 0.5 + t/3 * 0.1, brightness 1. Values
            // read straight off the formula at the three temperatures a biome can land on.
            assert.equal(betaSkyColor(0), 0x80a1ff, "hue 0.62222224, saturation 0.5, brightness 1");
            assert.equal(betaSkyColor(0.5), 0x7ba5ff, "the temperature halfway through the plane");
            assert.equal(betaSkyColor(1), 0x77a9ff, "hottest sky: hue drops and saturation rises with temperature");
        });

        it("clamps the temperature after dividing, the way the engine did", () => {
            assert.equal(betaSkyColor(3), betaSkyColor(100), "both clamp to t = 1");
            assert.equal(betaSkyColor(-3), betaSkyColor(-100), "both clamp to t = -1");
            assert.notEqual(betaSkyColor(3), betaSkyColor(0), "the clamp is not a no-op");
        });
    });

    describe("PNG decoding", () => {
        it("round-trips an 8-bit RGBA colormap into the ARGB buffer", () => {
            const png = buildRgbaPng(256, 256, (x, y) =>
                x === 3 && y === 5 ? [10, 20, 30, 255] : [0, 0, 0, 255]
            );
            const buffer = toArgbBuffer(decodePng(png));

            assert.equal(buffer[(5 << 8) | 3], 0xff0a141e, "pixel (3,5) packs as ARGB");
            assert.equal(buffer[0], 0xff000000, "untouched pixels stay opaque black");
        });

        it("rejects a colormap that is not 256x256", () => {
            const png = buildRgbaPng(2, 2, () => [0, 0, 0, 255]);
            assert.throws(() => toArgbBuffer(decodePng(png)), /256x256/);
        });
    });
});
