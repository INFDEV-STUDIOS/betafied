#!/usr/bin/env node
/**
 * Emits the per-biome resource-pack client biome files that tint grass and foliage with the Beta
 * 1.7.3 colours from scripts/lib/betaBiomeTints.mjs.
 *
 *   node scripts/generate-client-biomes.mjs           # write packs/RP/biomes/*.client_biome.json
 *   node scripts/generate-client-biomes.mjs --check   # verify on-disk output matches, exit 1 otherwise
 *
 * Only the Overworld is emitted: Beta's Nether had no grass to tint. Stale files are removed by
 * identifier so a rename never leaves two definitions of the same biome behind.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OVERWORLD_BIOME_IDS, OVERWORLD_BIOME_PROFILE, biomeIdentifier } from "./lib/betaBiomes.mjs";
import { buildClientBiome } from "./lib/betaBiomeTints.mjs";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const biomesDir = resolve(root, "packs/RP/biomes");
const check = process.argv.includes("--check");

const managed = new Set(OVERWORLD_BIOME_IDS.map(biomeIdentifier));
const problems = [];

function readIdentifier(path) {
    try {
        return JSON.parse(readFileSync(path, "utf-8"))["minecraft:client_biome"]?.description?.identifier ?? null;
    } catch {
        return null;
    }
}

if (existsSync(biomesDir)) {
    for (const file of readdirSync(biomesDir).filter(f => f.endsWith(".client_biome.json"))) {
        const path = resolve(biomesDir, file);
        const identifier = readIdentifier(path);

        if (identifier && managed.has(identifier) && !check) {
            rmSync(path);
        }
    }
} else if (!check) {
    mkdirSync(biomesDir, { recursive: true });
}

for (const shortId of OVERWORLD_BIOME_IDS) {
    const target = resolve(biomesDir, `${shortId}.client_biome.json`);
    const expected = `${JSON.stringify(buildClientBiome(shortId, OVERWORLD_BIOME_PROFILE[shortId]), null, 2)}\n`;

    if (check) {
        if (!existsSync(target)) {
            problems.push(`${shortId}.client_biome.json is missing`);
            continue;
        }
        if (readFileSync(target, "utf-8") !== expected) {
            problems.push(`${shortId}.client_biome.json is out of date with scripts/lib/betaBiomeTints.mjs`);
        }
        continue;
    }

    writeFileSync(target, expected);
}

if (check && problems.length > 0) {
    console.error("Client biome generation check failed:");
    for (const problem of problems) {
        console.error(`  - ${problem}`);
    }
    process.exit(1);
}

console.log(
    check
        ? `Client biome generation check passed (${OVERWORLD_BIOME_IDS.length} biomes).`
        : `Generated ${OVERWORLD_BIOME_IDS.length} client biome files.`
);
