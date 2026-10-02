/**
 * Beta 1.7.3 grass and foliage tint sampling.
 *
 * The tint was never stored per biome: the client computed it from the block's climate. In b1.7.3
 * `ColorizerGrass.getGrassColor(temperature, humidity)` reads a 256x256 PNG into a flat buffer and
 * indexes it like this:
 *
 *     humidity *= temperature;
 *     int x = (int) ((1.0 - temperature) * 255.0);
 *     int y = (int) ((1.0 - humidity) * 255.0);
 *     return buffer[y << 8 | x];
 *
 * Multiplying humidity by temperature first folds every (temperature, humidity) pair onto the
 * lower-left triangle of the image, on or below the main diagonal. `ColorizerFoliage` is the same
 * lookup over its own PNG, plus three constant colours for pine, birch and its fallback.
 *
 * The two PNGs (`misc/grasscolor.png`, `misc/foliagecolor.png`) are Mojang assets, so they are not
 * committed here. Point the derivation CLI at a directory holding copies from a b1.7.3 client; the
 * originals in a stock jar are 25237 and 17693 bytes.
 */
import { inflateSync } from "node:zlib";

/** Constant foliage colours from ColorizerFoliage, kept for parity even though Beta's own leaves used the lookup. */
export const FOLIAGE_PINE = 0x619961;
export const FOLIAGE_BIRCH = 0x80a755;
export const FOLIAGE_BASIC = 0x48b518;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS_BY_COLOR_TYPE = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paeth(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) {
        return a;
    }
    return pb <= pc ? b : c;
}

function unfilter(raw, height, stride, bytesPerPixel) {
    const out = Buffer.alloc(height * stride);
    let cursor = 0;
    for (let y = 0; y < height; y++) {
        const filter = raw[cursor++];
        const row = y * stride;
        const previous = row - stride;
        for (let x = 0; x < stride; x++) {
            const value = raw[cursor + x];
            const left = x >= bytesPerPixel ? out[row + x - bytesPerPixel] : 0;
            const up = y > 0 ? out[previous + x] : 0;
            const upLeft = y > 0 && x >= bytesPerPixel ? out[previous + x - bytesPerPixel] : 0;
            let reconstructed;
            switch (filter) {
                case 0:
                    reconstructed = value;
                    break;
                case 1:
                    reconstructed = value + left;
                    break;
                case 2:
                    reconstructed = value + up;
                    break;
                case 3:
                    reconstructed = value + ((left + up) >> 1);
                    break;
                case 4:
                    reconstructed = value + paeth(left, up, upLeft);
                    break;
                default:
                    throw new Error(`Unsupported PNG filter ${filter}`);
            }
            out[row + x] = reconstructed & 0xff;
        }
        cursor += stride;
    }
    return out;
}

/** Decode a non-interlaced PNG far enough to read every pixel. Supports 8-bit RGBA/RGB/grey and 1/2/4/8-bit palette or grey. */
export function decodePng(buffer) {
    if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
        throw new Error("Not a PNG file");
    }

    let offset = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    let interlace = 0;
    let palette = null;
    let paletteAlpha = null;
    const idat = [];

    while (offset + 8 <= buffer.length) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.toString("latin1", offset + 4, offset + 8);
        const body = buffer.subarray(offset + 8, offset + 8 + length);
        offset += length + 12;
        if (type === "IHDR") {
            width = body.readUInt32BE(0);
            height = body.readUInt32BE(4);
            bitDepth = body[8];
            colorType = body[9];
            interlace = body[12];
        } else if (type === "PLTE") {
            palette = Buffer.from(body);
        } else if (type === "tRNS") {
            paletteAlpha = Buffer.from(body);
        } else if (type === "IDAT") {
            idat.push(Buffer.from(body));
        } else if (type === "IEND") {
            break;
        }
    }

    if (interlace !== 0) {
        throw new Error("Interlaced PNGs are not supported");
    }
    const channels = CHANNELS_BY_COLOR_TYPE[colorType];
    if (!channels || ![1, 2, 4, 8].includes(bitDepth)) {
        throw new Error(`Unsupported PNG (${bitDepth}-bit, colour type ${colorType})`);
    }

    const stride = Math.ceil((width * channels * bitDepth) / 8);
    const bytesPerPixel = Math.max(1, Math.ceil((channels * bitDepth) / 8));
    const raw = inflateSync(Buffer.concat(idat));
    const pixels = unfilter(raw, height, stride, bytesPerPixel);

    return { width, height, bitDepth, colorType, channels, stride, palette, paletteAlpha, pixels };
}

function readSample(row, index, channel, bitDepth, channels) {
    if (bitDepth === 8) {
        return row[index * channels + channel];
    }
    const bitOffset = index * channels * bitDepth + channel * bitDepth;
    const value = (row[bitOffset >> 3] >> (8 - bitDepth - (bitOffset & 7))) & ((1 << bitDepth) - 1);
    return Math.round((value * 255) / ((1 << bitDepth) - 1));
}

/**
 * Pack a decoded colormap into the `buffer[y << 8 | x]` array the Beta colorizers index into, using
 * Java's ARGB layout. The engine hard-codes a 256 stride, so anything else is rejected rather than
 * silently misread.
 */
export function toArgbBuffer(decoded) {
    const { width, height, bitDepth, colorType, channels, palette, paletteAlpha, pixels } = decoded;
    if (width !== 256 || height !== 256) {
        throw new Error(`Colormap must be 256x256, got ${width}x${height}`);
    }

    const buffer = new Uint32Array(65536);
    for (let y = 0; y < height; y++) {
        const row = y * decoded.stride;
        for (let x = 0; x < width; x++) {
            let r;
            let g;
            let b;
            let a = 255;
            if (colorType === 3) {
                const index = readSample(pixels.subarray(row), x, 0, bitDepth, 1);
                r = palette[index * 3];
                g = palette[index * 3 + 1];
                b = palette[index * 3 + 2];
                if (paletteAlpha && index < paletteAlpha.length) {
                    a = paletteAlpha[index];
                }
            } else {
                r = readSample(pixels.subarray(row), x, 0, bitDepth, channels);
                g = channels >= 3 ? readSample(pixels.subarray(row), x, 1, bitDepth, channels) : r;
                b = channels >= 3 ? readSample(pixels.subarray(row), x, 2, bitDepth, channels) : r;
                if (channels === 2 || channels === 4) {
                    a = readSample(pixels.subarray(row), x, channels - 1, bitDepth, channels);
                }
            }
            buffer[(y << 8) | x] = ((a << 24) | (r << 16) | (g << 8) | b) >>> 0;
        }
    }
    return buffer;
}

/**
 * Reproduce one Beta colorizer lookup. Inputs are temperature and humidity in 0..1; values outside
 * that would index off the end of the buffer in Java, so they are clamped rather than trusted.
 */
export function createColorizer(argbBuffer) {
    return (temperature, humidity) => {
        const t = Math.min(1, Math.max(0, temperature));
        const h = Math.min(1, Math.max(0, humidity)) * t;
        const x = Math.trunc((1 - t) * 255);
        const y = Math.trunc((1 - h) * 255);
        return argbBuffer[(y << 8) | x];
    };
}

/**
 * Beta's `BiomeGenBase.getBiome`. Note the humidity multiplication: like the colorizer, the biome
 * test compares rainfall * temperature, not rainfall alone.
 */
export function betaBiomeAt(temperature, rainfall) {
    const humidity = rainfall * temperature;
    if (temperature < 0.1) {
        return "tundra";
    }
    if (humidity < 0.2) {
        if (temperature < 0.5) {
            return "tundra";
        }
        return temperature < 0.95 ? "savanna" : "desert";
    }
    if (humidity > 0.5 && temperature < 0.7) {
        return "swampland";
    }
    if (temperature < 0.5) {
        return "taiga";
    }
    if (temperature < 0.97) {
        return humidity < 0.35 ? "shrubland" : "forest";
    }
    if (humidity < 0.45) {
        return "plains";
    }
    return humidity < 0.9 ? "seasonal_forest" : "rainforest";
}

/**
 * Java's `Color.HSBtoRGB`, which is what b1.7.3's `Color.getHSBColor` runs underneath. The steps
 * are float32 in Java, so every intermediate is rounded through `Math.fround` to reproduce the
 * exact byte the client would have picked rather than something a double would drift into.
 */
function hsbToArgb(hue, saturation, brightness) {
    const h = Math.fround(Math.fround(hue) * 6);
    const f = Math.fround(h - Math.trunc(h));
    const p = Math.fround(Math.fround(brightness) * (1 - Math.fround(saturation)));
    const q = Math.fround(Math.fround(brightness) * (1 - Math.fround(Math.fround(saturation) * f)));
    const t = Math.fround(Math.fround(brightness) * (1 - Math.fround(Math.fround(saturation) * (1 - f))));
    // Java's `(int)(value * 255.0f + 0.5f)`: the multiply is float32, then truncation towards zero.
    const byte = value => Math.trunc(Math.fround(Math.fround(value) * 255) + 0.5);

    const [r, g, b] = [
        [brightness, t, p],
        [q, brightness, p],
        [p, brightness, t],
        [p, q, brightness],
        [t, p, brightness],
        [brightness, p, q]
    ][Math.trunc(h) % 6];

    return ((byte(r) << 16) | (byte(g) << 8) | byte(b)) >>> 0;
}

/**
 * Beta's `BiomeGenBase.getSkyColorByTemp`. The engine fed it the climate temperature under the
 * player, so the sky shifted from a deeper periwinkle in the cold to a paler cyan in the heat.
 */
export function betaSkyColor(temperature) {
    let t = Math.fround(temperature) / 3;
    if (t < -1) {
        t = -1;
    }
    if (t > 1) {
        t = 1;
    }
    return hsbToArgb(
        Math.fround(0.62222224 - Math.fround(t * 0.05)),
        Math.fround(0.5 + Math.fround(t * 0.1)),
        1
    );
}

export function toHex(argb) {
    const value = argb & 0xffffff;
    return `#${value.toString(16).padStart(6, "0").toUpperCase()}`;
}
