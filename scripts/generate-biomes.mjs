#!/usr/bin/env node
/**
 * Emits the Overworld and Nether biome JSONs from the canonical Beta table in
 * scripts/lib/betaBiomes.mjs.
 *
 *   node scripts/generate-biomes.mjs           # write packs/BP/biomes/*.json
 *   node scripts/generate-biomes.mjs --check   # verify on-disk output matches, exit 1 otherwise
 *
 * Stale files (for example the old `ocean.biome.json`) are removed by identifier so a rename never
 * leaves two definitions of the same biome behind. The End definition is left untouched.
 */
import { readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
    NETHER_BIOME_IDS,
    OVERWORLD_BIOME_IDS,
    OVERWORLD_BIOME_PROFILE,
    RETIRED_BIOME_IDENTIFIERS,
    UNMANAGED_BIOME_IDENTIFIERS,
    biomeIdentifier,
    buildBiome,
    buildNetherBiome
} from "./lib/betaBiomes.mjs";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const biomesDir = resolve(root, "packs/BP/biomes");
const check = process.argv.includes("--check");

const entries = [
    ...OVERWORLD_BIOME_IDS.map(shortId => [shortId, () => buildBiome(shortId, OVERWORLD_BIOME_PROFILE[shortId])]),
    ...NETHER_BIOME_IDS.map(shortId => [shortId, () => buildNetherBiome(shortId)])
];

const managed = new Set(entries.map(([shortId]) => biomeIdentifier(shortId)));
const unmanaged = new Set(UNMANAGED_BIOME_IDENTIFIERS);
const retired = new Set(RETIRED_BIOME_IDENTIFIERS);

function readIdentifier(path) {
    try {
        return JSON.parse(readFileSync(path, "utf-8"))["minecraft:biome"]?.description?.identifier ?? null;
    } catch {
        return null;
    }
}

const problems = [];

for (const file of readdirSync(biomesDir).filter(f => f.endsWith(".json"))) {
    const path = resolve(biomesDir, file);
    const identifier = readIdentifier(path);

    if (identifier && unmanaged.has(identifier)) {
        continue;
    }

    // Delete anything this table manages, whatever its filename, so renames cannot duplicate, and
    // clear out identifiers the table has since corrected.
    if (identifier && (managed.has(identifier) || retired.has(identifier)) && !check) {
        rmSync(path);
    }
}

for (const [shortId, build] of entries) {
    const target = resolve(biomesDir, `${shortId}.json`);
    const expected = `${JSON.stringify(build(), null, 2)}\n`;

    if (check) {
        if (!existsSync(target)) {
            problems.push(`${shortId}.json is missing`);
            continue;
        }
        if (readFileSync(target, "utf-8") !== expected) {
            problems.push(`${shortId}.json is out of date with scripts/lib/betaBiomes.mjs`);
        }
        continue;
    }

    writeFileSync(target, expected);
}

if (check && problems.length > 0) {
    console.error("Biome generation check failed:");
    for (const problem of problems) {
        console.error(`  - ${problem}`);
    }
    process.exit(1);
}

const count = `${OVERWORLD_BIOME_IDS.length} Overworld and ${NETHER_BIOME_IDS.length} Nether biomes`;
console.log(check ? `Biome generation check passed (${count}).` : `Generated ${count}.`);
