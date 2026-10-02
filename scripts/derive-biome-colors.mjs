#!/usr/bin/env node
/**
 * Derives the grass and foliage tint of each Beta 1.7.3 biome from the real client colormaps.
 *
 * Beta never stored a colour per biome: the tint was a continuous function of the block's climate
 * (see scripts/lib/betaColorizer.mjs). To recover a single colour per biome this walks the whole
 * (temperature, rainfall) plane, classifies each point with Beta's own `getBiome`, samples the
 * colorizer, and averages the samples that land in each biome. The result is the colour a player
 * actually saw on an average block of that biome, not a hand-picked swatch.
 *
 * The two colormaps are Mojang assets and are not committed. Drop copies of `misc/grasscolor.png`
 * and `misc/foliagecolor.png` from a b1.7.3 client into `.scratch/` (the defaults below) or pass a
 * directory as the first argument:
 *
 *   node scripts/derive-biome-colors.mjs [colormapDir] [--json]
 *
 * Stock b1.7.3 sizes are 25237 and 17693 bytes.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
    betaBiomeAt,
    betaSkyColor,
    createColorizer,
    decodePng,
    toArgbBuffer,
    toHex
} from "./lib/betaColorizer.mjs";
import { BETA_PROFILES, OVERWORLD_BIOME_PROFILE } from "./lib/betaBiomes.mjs";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const args = process.argv.slice(2);
const asJson = args.includes("--json");
const directory = resolve(root, args.find(argument => !argument.startsWith("--")) ?? ".scratch");

/** Beta biome name -> the trade name used by the Beta profile table. The five that generated map 1:1. */
const BETA_BIOME_TO_PROFILE = Object.freeze({
    forest: "forest",
    plains: "plains",
    desert: "desert",
    taiga: "taiga",
    swampland: "swampland"
});

function loadColorizer(name) {
    const path = resolve(directory, name);
    let buffer;
    try {
        buffer = readFileSync(path);
    } catch {
        throw new Error(
            `Could not read ${path}. Copy grasscolor.png and foliagecolor.png from a b1.7.3 client into ${directory}.`
        );
    }
    return createColorizer(toArgbBuffer(decodePng(buffer)));
}

/**
 * Averaging in gamma space is not colourimetrically pure, but the colormap itself is authored in
 * sRGB and the values barely move across a region, so a plain mean is the honest summary here.
 */
function derive(grass, foliage, steps = 256) {
    const biomes = new Map();
    const global = { count: 0, grass: [0, 0, 0], foliage: [0, 0, 0], sky: [0, 0, 0] };

    for (let i = 0; i < steps; i++) {
        const temperature = (i + 0.5) / steps;
        for (let j = 0; j < steps; j++) {
            const rainfall = (j + 0.5) / steps;
            const biome = betaBiomeAt(temperature, rainfall);
            const grassColor = grass(temperature, rainfall);
            const foliageColor = foliage(temperature, rainfall);
            // The sky has no colormap: Beta fed the climate temperature straight into
            // BiomeGenBase.getSkyColorByTemp, so this needs no Mojang asset to reproduce.
            const skyColor = betaSkyColor(temperature);

            let entry = biomes.get(biome);
            if (!entry) {
                entry = { count: 0, temperature: 0, rainfall: 0, grass: [0, 0, 0], foliage: [0, 0, 0], sky: [0, 0, 0] };
                biomes.set(biome, entry);
            }
            entry.count += 1;
            entry.temperature += temperature;
            entry.rainfall += rainfall;
            accumulate(entry.grass, grassColor);
            accumulate(entry.foliage, foliageColor);
            accumulate(entry.sky, skyColor);

            global.count += 1;
            accumulate(global.grass, grassColor);
            accumulate(global.foliage, foliageColor);
            accumulate(global.sky, skyColor);
        }
    }

    const summarise = (entry, total) => ({
        share: entry.count / (total ?? entry.count),
        meanTemperature: entry.temperature / entry.count,
        meanRainfall: entry.rainfall / entry.count,
        grass: toHex(pack(entry.grass, entry.count)),
        foliage: toHex(pack(entry.foliage, entry.count)),
        sky: toHex(pack(entry.sky, entry.count))
    });

    const result = {};
    for (const [biome, entry] of [...biomes.entries()].sort((a, b) => b[1].count - a[1].count)) {
        result[biome] = summarise(entry, steps * steps);
    }
    result.__global = summarise(global);
    return result;
}

function accumulate(target, argb) {
    target[0] += (argb >> 16) & 0xff;
    target[1] += (argb >> 8) & 0xff;
    target[2] += argb & 0xff;
}

function pack(sums, count) {
    return (
        (((Math.round(sums[0] / count) & 0xff) << 16) |
            ((Math.round(sums[1] / count) & 0xff) << 8) |
            (Math.round(sums[2] / count) & 0xff)) >>>
        0
    );
}

const grass = loadColorizer("grasscolor.png");
const foliage = loadColorizer("foliagecolor.png");
const derived = derive(grass, foliage);
const global = derived.__global;

const profileColors = {};
for (const profile of Object.values(OVERWORLD_BIOME_PROFILE)) {
    profileColors[profile] ??= {};
}
for (const [profile, betaBiome] of Object.entries(BETA_BIOME_TO_PROFILE)) {
    const entry = derived[betaBiome];
    profileColors[profile] = { betaBiome, grass: entry.grass, foliage: entry.foliage, sky: entry.sky };
}
for (const profile of Object.keys(profileColors)) {
    if (!profileColors[profile].grass) {
        profileColors[profile] = { betaBiome: null, grass: global.grass, foliage: global.foliage, sky: global.sky };
    }
}

if (asJson) {
    console.log(
        JSON.stringify(
            {
                source: "Minecraft Beta 1.7.3 misc/grasscolor.png + misc/foliagecolor.png + BiomeGenBase.getSkyColorByTemp",
                global: { grass: global.grass, foliage: global.foliage, sky: global.sky },
                biomes: Object.fromEntries(Object.entries(derived).filter(([name]) => name !== "__global")),
                profiles: profileColors
            },
            null,
            2
        )
    );
} else {
    console.log("Beta 1.7.3 biome tints derived from the real client colormaps\n");
    console.log("biome            share  mean t/h      grass     foliage     sky");
    for (const [biome, entry] of Object.entries(derived)) {
        if (biome === "__global") {
            continue;
        }
        const label = biome.padEnd(16);
        const share = `${(entry.share * 100).toFixed(1)}%`.padStart(5);
        const climate = `${entry.meanTemperature.toFixed(2)}/${entry.meanRainfall.toFixed(2)}`.padStart(9);
        console.log(`${label} ${share}  ${climate}   ${entry.grass}   ${entry.foliage}   ${entry.sky}`);
    }
    console.log(
        `${"global mean".padEnd(16)} 100.0%          ` +
            `    ${global.grass}   ${global.foliage}   ${global.sky}`
    );

    const profileNames = Object.keys(profileColors);
    const biomeCount = new Map();
    for (const profile of Object.values(OVERWORLD_BIOME_PROFILE)) {
        biomeCount.set(profile, (biomeCount.get(profile) ?? 0) + 1);
    }
    console.log("\nBedrock profile  beta source     biomes  grass     foliage     sky");
    for (const profile of profileNames.sort()) {
        const entry = profileColors[profile];
        const source = (entry.betaBiome ?? "global mean").padEnd(13);
        console.log(
            `${profile.padEnd(16)} ${source} ${String(biomeCount.get(profile) ?? 0).padStart(3)}     ${entry.grass}   ${entry.foliage}   ${entry.sky}`
        );
    }

    // The profile climates are Bedrock's scale, not Beta's, so this is a different reading from the
    // region averages above: it answers "what does the colormap say at the climate we declared?".
    console.log("\nDirect read at each profile's declared Bedrock climate (temperature/downfall clamped to 0..1)");
    console.log("profile          climate        grass     foliage");
    for (const profile of profileNames.sort()) {
        const climate = BETA_PROFILES[profile].climate;
        const temperature = Math.min(1, Math.max(0, climate.temperature));
        const humidity = Math.min(1, Math.max(0, climate.downfall));
        console.log(
            `${profile.padEnd(16)} ${`${climate.temperature}/${climate.downfall}`.padEnd(13)}  ` +
                `${toHex(grass(temperature, humidity))}   ${toHex(foliage(temperature, humidity))}`
        );
    }
}
