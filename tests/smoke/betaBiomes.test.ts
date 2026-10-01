import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
    BETA_LAND_PROFILES,
    BETA_PROFILES,
    BETA_SURFACE_MATERIALS,
    GRAVEL_BEACH_PROFILES,
    NETHER_BIOME_IDS,
    OVERWORLD_BIOME_IDS,
    OVERWORLD_BIOME_PROFILE,
    UNMANAGED_BIOME_IDENTIFIERS,
    biomeIdentifier,
    buildBiome
} from "../../scripts/lib/betaBiomes.mjs";

// Every Overworld biome shipped in the vanilla behavior pack (Mojang/bedrock-samples). A biome
// added upstream that is missing here keeps its vanilla definition, including `village_type` and
// modern tags, so this list is the guard against silently unhandled biomes.
const VANILLA_OVERWORLD_BIOMES = [
    "bamboo_jungle", "bamboo_jungle_hills", "beach", "birch_forest", "birch_forest_hills",
    "birch_forest_hills_mutated", "birch_forest_mutated", "cherry_grove", "cold_beach", "cold_ocean",
    "cold_taiga", "cold_taiga_hills", "cold_taiga_mutated", "dappled_forest", "deep_cold_ocean",
    "deep_dark", "deep_frozen_ocean", "deep_lukewarm_ocean", "deep_ocean", "deep_warm_ocean",
    "desert", "desert_hills", "desert_mutated", "dripstone_caves", "extreme_hills",
    "extreme_hills_edge", "extreme_hills_mutated", "extreme_hills_plus_trees",
    "extreme_hills_plus_trees_mutated", "flower_forest", "forest", "forest_hills", "frozen_ocean",
    "frozen_peaks", "frozen_river", "grove", "ice_mountains", "ice_plains", "ice_plains_spikes",
    "jagged_peaks", "jungle", "jungle_edge", "jungle_edge_mutated", "jungle_hills", "jungle_mutated",
    "legacy_frozen_ocean", "lukewarm_ocean", "lush_caves", "mangrove_swamp", "meadow", "mega_taiga",
    "mega_taiga_hills", "mesa", "mesa_bryce", "mesa_plateau", "mesa_plateau_mutated",
    "mesa_plateau_stone", "mesa_plateau_stone_mutated", "mushroom_island", "mushroom_island_shore",
    "ocean", "pale_garden", "plains", "redwood_taiga_hills_mutated", "redwood_taiga_mutated", "river",
    "roofed_forest", "roofed_forest_mutated", "savanna", "savanna_mutated", "savanna_plateau",
    "savanna_plateau_mutated", "snowy_slopes", "stone_beach", "stony_peaks", "sulfur_caves",
    "sunflower_plains", "swampland", "swampland_mutated", "taiga", "taiga_hills", "taiga_mutated",
    "warm_ocean"
];

const VANILLA_NETHER_BIOMES = ["hell", "soulsand_valley", "crimson_forest", "warped_forest", "basalt_deltas"];

describe("Beta 1.7.3 Biome Table - Overworld Generation Integrity", () => {
    const biomesDir = resolve(process.cwd(), "packs/BP/biomes");

    it("defines every Bedrock Overworld biome the table maps", () => {
        for (const shortId of OVERWORLD_BIOME_IDS) {
            assert.ok(
                existsSync(resolve(biomesDir, `${shortId}.json`)),
                `missing biome file for ${biomeIdentifier(shortId)}`
            );
        }
    });

    it("keeps on-disk biome files byte-identical to the canonical table", () => {
        // Drift here means someone hand-edited a generated file. Run `node scripts/generate-biomes.mjs`.
        for (const shortId of OVERWORLD_BIOME_IDS) {
            const expected = `${JSON.stringify(buildBiome(shortId, OVERWORLD_BIOME_PROFILE[shortId]), null, 2)}\n`;
            const actual = readFileSync(resolve(biomesDir, `${shortId}.json`), "utf-8");
            assert.equal(actual, expected, `${shortId}.json is out of date with scripts/lib/betaBiomes.mjs`);
        }
    });

    it("maps every Bedrock Overworld biome onto a real Beta profile", () => {
        for (const [shortId, profileName] of Object.entries(OVERWORLD_BIOME_PROFILE)) {
            assert.ok(
                Object.hasOwn(BETA_PROFILES, profileName),
                `${shortId} points at unknown profile '${profileName}'`
            );
        }
    });

    it("uses only Beta-era surface materials in every biome", () => {
        for (const shortId of OVERWORLD_BIOME_IDS) {
            const content = JSON.parse(readFileSync(resolve(biomesDir, `${shortId}.json`), "utf-8"));
            const builder = content["minecraft:biome"].components["minecraft:surface_builder"].builder;

            for (const key of ["top_material", "mid_material", "foundation_material", "sea_floor_material"]) {
                const material = builder[key];
                assert.ok(
                    BETA_SURFACE_MATERIALS.has(material),
                    `${shortId} uses post-Beta surface material '${material}' for ${key}`
                );
            }
            assert.equal(builder.sea_material, "minecraft:water", `${shortId} sea material must be water`);
        }
    });

    it("uses only the five land biomes Beta 1.7.3 actually generated", () => {
        // Ten biomes existed in the code, but the Adventure Update changelog records that Rain
        // Forest, Seasonal Forest, Shrubland, Savanna, Tundra and Ice Desert never generated.
        const profiles = new Set(Object.values(OVERWORLD_BIOME_PROFILE));

        for (const profile of BETA_LAND_PROFILES) {
            assert.ok(profiles.has(profile), `profile '${profile}' is defined but no Bedrock biome uses it`);
        }

        for (const ghost of ["rainforest", "seasonal_forest", "shrubland", "savanna", "tundra"]) {
            assert.ok(!profiles.has(ghost), `'${ghost}' never generated in Beta 1.7.3 and must not be used`);
        }
    });

    it("confines snow to the single Beta taiga profile", () => {
        // Beta only accumulated snow in taiga. The engine's climate map hands out far more cold
        // zones than Beta had biomes, so every modern frozen biome is folded onto a temperate
        // profile and this test stops anyone from quietly handing one of them snow again.
        const snowy = Object.entries(BETA_PROFILES)
            .filter(([, profile]) => profile.climate.snow_accumulation[1] > 0)
            .map(([name]) => name);

        assert.deepEqual(snowy, ["taiga"], "only taiga may accumulate snow");
    });

    it("gives a gravel shore only to the profiles that own a waterline", () => {
        const waterline = new Set(GRAVEL_BEACH_PROFILES);

        for (const [shortId, profileName] of Object.entries(OVERWORLD_BIOME_PROFILE)) {
            const content = JSON.parse(readFileSync(resolve(biomesDir, `${shortId}.json`), "utf-8"));
            const adjustments = content["minecraft:biome"].components["minecraft:surface_material_adjustments"]?.adjustments ?? [];

            if (!waterline.has(profileName)) {
                assert.equal(adjustments.length, 0, `${shortId} has no waterline and must not grow gravel shores`);
                continue;
            }

            assert.equal(adjustments.length, 1, `${shortId} must carry exactly one gravel shore rule`);
            const shore = adjustments[0];
            assert.equal(shore.materials.top_material, "minecraft:gravel");
            assert.deepEqual(shore.height_range, ["variable.sea_level - 3", "variable.sea_level + 2"]);
            assert.ok(shore.noise_range[1] <= -0.5, `${shortId} gravel shores must stay uncommon, not a coastline`);
        }
    });

    it("renders Beta's sea unfrozen", () => {
        for (const shortId of ["frozen_ocean", "legacy_frozen_ocean", "deep_frozen_ocean", "deep_cold_ocean", "cold_ocean"]) {
            assert.equal(OVERWORLD_BIOME_PROFILE[shortId], "ocean", `${shortId} must render as ordinary ocean water`);
        }
        assert.equal(OVERWORLD_BIOME_PROFILE.frozen_river, "river", "frozen rivers must render as plain water");
    });

    it("leaves no stray biome override outside the table", () => {
        const managed = new Set([...OVERWORLD_BIOME_IDS, ...NETHER_BIOME_IDS].map(biomeIdentifier));
        const unmanaged = new Set(UNMANAGED_BIOME_IDENTIFIERS);

        for (const file of readdirSync(biomesDir).filter(f => f.endsWith(".json"))) {
            const content = JSON.parse(readFileSync(resolve(biomesDir, file), "utf-8"));
            const identifier = content["minecraft:biome"]?.description?.identifier;
            assert.ok(
                managed.has(identifier) || unmanaged.has(identifier),
                `${file} defines '${identifier}', which the Beta biome table does not manage`
            );
        }
    });

    it("covers every vanilla biome so none can keep its modern definition", () => {
        for (const shortId of VANILLA_OVERWORLD_BIOMES) {
            assert.ok(
                Object.hasOwn(OVERWORLD_BIOME_PROFILE, shortId),
                `${shortId} is a vanilla Overworld biome with no Beta remap; it will keep its vanilla village_type and tags`
            );
        }

        for (const shortId of VANILLA_NETHER_BIOMES) {
            assert.ok(
                NETHER_BIOME_IDS.includes(shortId),
                `${shortId} is a vanilla Nether biome with no Beta override`
            );
        }
    });

    it("declares a dimension tag and animal spawn probability inline with the smoke contract", () => {
        for (const shortId of OVERWORLD_BIOME_IDS) {
            const content = JSON.parse(readFileSync(resolve(biomesDir, `${shortId}.json`), "utf-8"));
            const components = content["minecraft:biome"].components;
            const tags: string[] = components["minecraft:tags"].tags;

            assert.ok(tags.includes("overworld"), `${shortId} must carry the overworld tag`);
            if (tags.includes("animal")) {
                const probability = components["minecraft:creature_spawn_probability"]?.probability;
                assert.ok(
                    typeof probability === "number" && probability > 0,
                    `${shortId} has the animal tag but no positive creature spawn probability`
                );
            }
        }
    });
});
