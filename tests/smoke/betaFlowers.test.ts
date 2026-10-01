import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const FEATURES_DIR = resolve(ROOT, "packs/BP/features");

/** Every flower block Mojang added after Beta 1.7.3, plus the modern double plants and petals. */
const POST_BETA_FLOWERS = new Set([
    "minecraft:allium",
    "minecraft:azure_bluet",
    "minecraft:blue_orchid",
    "minecraft:cornflower",
    "minecraft:lily_of_the_valley",
    "minecraft:oxeye_daisy",
    "minecraft:red_tulip",
    "minecraft:orange_tulip",
    "minecraft:white_tulip",
    "minecraft:pink_tulip",
    "minecraft:wither_rose",
    "minecraft:sunflower",
    "minecraft:lilac",
    "minecraft:rose_bush",
    "minecraft:peony",
    "minecraft:pink_petals",
    "minecraft:torchflower",
    "minecraft:pitcher_plant",
    "minecraft:wildflowers"
]);

/** The scatter features vanilla hangs its flower feature rules off. All are overridden here. */
const FLOWER_SCATTERS = [
    "scatter_overworld_flower_feature",
    "scatter_plains_flower_feature",
    "scatter_swamp_flower_feature",
    "scatter_flower_forest_flower_feature",
    "scatter_meadow_flower_feature"
];

function readFeature(file: string): Record<string, unknown> {
    return JSON.parse(readFileSync(resolve(FEATURES_DIR, file), "utf-8"));
}

function featureBody(file: string): Record<string, any> {
    const json = readFeature(file);
    const key = Object.keys(json).find(k => k.startsWith("minecraft:") && k !== "format_version");
    assert.ok(key, `${file} declares no feature type`);
    return { ...json[key] as object, format_version: json.format_version };
}

describe("Beta 1.7.3 Flower Generation Contract", () => {
    it("resolves the overworld flower feature to a poppy/dandelion choice", () => {
        const body = featureBody("flower_feature.json");

        assert.equal(body.description.identifier, "minecraft:flower_feature");
        assert.deepEqual(
            body.features,
            [["minecraft:red_flower_feature", 1], ["minecraft:yellow_flower_feature", 1]],
            "minecraft:flower_feature may only pick the two Beta flowers"
        );
    });

    it("places poppy and dandelion on grass and nothing else", () => {
        const red = featureBody("red_flower_feature.json");
        const yellow = featureBody("yellow_flower_feature.json");

        assert.equal(red.places_block, "minecraft:poppy");
        assert.equal(yellow.places_block, "minecraft:dandelion");

        for (const [file, body] of [["red_flower_feature.json", red], ["yellow_flower_feature.json", yellow]] as const) {
            assert.deepEqual(body.may_replace, ["minecraft:air"], `${file} may only grow into air`);
            // Beta flowers only ever grew on grass, which is also what keeps them out of deserts
            // and beaches where the scatter still runs.
            assert.deepEqual(body.may_attach_to.bottom, ["minecraft:grass_block"], `${file} must attach to grass`);
            assert.equal(body.enforce_survivability_rules, true, `${file} must respect plant survivability`);
        }
    });

    it("repoints every vanilla flower scatter at the Beta flower feature", () => {
        for (const name of FLOWER_SCATTERS) {
            const body = featureBody(`${name}.json`);
            assert.equal(body.description.identifier, `minecraft:${name}`);
            assert.equal(
                body.places_feature,
                "minecraft:flower_feature",
                `${name} still feeds the modern legacy flower picker`
            );
        }
    });

    it("neutralizes the modern double-plant aggregate that places lilac, peony and rose bush", () => {
        // Beta had no double-height flowers. The engine bakes `minecraft:double_plant_feature` as
        // an aggregate behind its own feature rules, so overriding the flower scatters alone left
        // it free to scatter lilacs; shipping the identifier as an inert ore_feature replaces it.
        const body = featureBody("double_plant_feature.json");

        assert.equal(body.description.identifier, "minecraft:double_plant_feature");
        assert.deepEqual(
            body.replace_rules,
            [{ places_block: "minecraft:air", may_replace: ["minecraft:structure_void"] }],
            "the double-plant aggregate must be an inert no-op"
        );
    });

    it("never places a post-Beta flower from any feature file", () => {
        for (const file of readdirSync(FEATURES_DIR).filter(f => f.endsWith(".json"))) {
            const raw = readFileSync(resolve(FEATURES_DIR, file), "utf-8");
            for (const flower of POST_BETA_FLOWERS) {
                assert.ok(!raw.includes(`"${flower}"`), `${file} still references post-Beta flower ${flower}`);
            }
        }
    });
});
