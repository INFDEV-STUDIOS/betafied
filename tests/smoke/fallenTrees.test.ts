import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

/**
 * Every feature below is overridden with a stub that only replaces `structure_void` with air, so the
 * vanilla feature generates nothing. The identifier is the contract: a stub whose name does not match
 * a real vanilla feature is inert, which is how a suppression quietly stops working.
 */
function assertFeatureIsStubbed(name: string): void {
    const path = resolve(root, `packs/BP/features/${name}.json`);
    assert.ok(existsSync(path), `${name} must be overridden to suppress its block`);

    const feature = JSON.parse(readFileSync(path, "utf-8"));
    const identifier = feature?.["minecraft:ore_feature"]?.description?.identifier;
    assert.equal(identifier, `minecraft:${name}`, `${name} must keep its vanilla identifier`);

    const replaceRules = feature?.["minecraft:ore_feature"]?.replace_rules ?? [];
    for (const rule of replaceRules) {
        assert.equal(rule.places_block, "minecraft:air", `${name} must place air`);
        assert.ok(
            (rule.may_replace ?? []).includes("minecraft:structure_void"),
            `${name} must be gated on structure_void so it never overwrites real terrain`
        );
    }
}

// Bedrock scatters fallen logs through these features.
const FALLEN_FEATURES = [
    "fallen_oak_tree_feature",
    "fallen_birch_tree_feature",
    "fallen_spruce_tree_feature",
    "fallen_jungle_tree_feature",
    "fallen_super_birch_tree_feature",
    "optional_fallen_oak_tree_feature",
    "optional_fallen_birch_tree_feature",
    "optional_fallen_spruce_tree_feature",
    "optional_fallen_jungle_tree_feature",
    "optional_fallen_super_birch_tree_feature"
];

// Vines and glow lichen are post-Beta decoration with no authentic counterpart. The script scrubber
// removes what is already in the ground; these stubs stop it being placed in the first place.
const VINE_LICHEN_FEATURES = [
    "vines_single_face_scatter_feature",
    "glow_lichen_feature",
    "underground_glow_lichen_feature"
];

// Ores Beta 1.7.3 never had. Emerald arrived in 1.3 and copper in 1.17, but both still generate on
// modern terrain; suppressing the feature keeps them out of new chunks, and the scrubber's emerald
// and copper -> stone mappings cover chunks that were generated before the pack was installed.
const POST_BETA_ORE_FEATURES = [
    "emerald_ore_feature",
    "copper_ore_feature",
    "dripstone_caves_copper_ore_feature"
];

describe("World Generation - suppressed decoration features", () => {
    it("stubs every fallen-tree feature so it places nothing", () => {
        for (const name of FALLEN_FEATURES) {
            assertFeatureIsStubbed(name);
        }
    });

    it("stubs the vine and glow lichen features so they place nothing", () => {
        for (const name of VINE_LICHEN_FEATURES) {
            assertFeatureIsStubbed(name);
        }
    });

    it("stubs the post-Beta ore features so they place nothing", () => {
        for (const name of POST_BETA_ORE_FEATURES) {
            assertFeatureIsStubbed(name);
        }
    });
});

/**
 * Beta 1.7.3's ore decorator table: `veins` attempts per chunk, `count` blocks per vein, `y` the
 * band each attempt could start in (half-open, matching Java's nextInt(max - min) + min). Modern
 * Bedrock spreads the same ores across many split rules; the pack replaces the primary rule of each
 * ore with these numbers and neuters the split variants, so both halves have to hold or new chunks
 * silently drift back to modern density.
 */
const BETA_ORE_TABLE: Readonly<Record<string, {
    readonly veins: number;
    readonly count: number;
    readonly y: readonly [number, number];
    readonly yDistribution: "uniform" | "triangle";
}>> = Object.freeze({
    coal: { veins: 20, count: 16, y: [0, 128], yDistribution: "uniform" },
    iron: { veins: 20, count: 8, y: [0, 64], yDistribution: "uniform" },
    gold: { veins: 2, count: 8, y: [0, 32], yDistribution: "uniform" },
    redstone: { veins: 8, count: 7, y: [0, 16], yDistribution: "uniform" },
    diamond: { veins: 1, count: 7, y: [0, 16], yDistribution: "uniform" },
    // Lapis clusters around y16 and tapers off toward 32 either side, so it scatters as a triangle.
    lapis: { veins: 1, count: 6, y: [0, 32], yDistribution: "triangle" }
});

const DISABLED_RULE_TAG = "betafied_ore_rule_disabled";
const STONE_FAMILY = ["minecraft:stone", "minecraft:granite", "minecraft:diorite", "minecraft:andesite", "minecraft:deepslate"];

function readJson(path: string): any {
    return JSON.parse(readFileSync(path, "utf-8"));
}

function primaryRulePath(ore: string): string {
    return resolve(root, `packs/BP/feature_rules/overworld_underground_${ore}_ore_feature.json`);
}

describe("World Generation - Beta ore retune", () => {
    it("scatters each ore with Beta's attempt count and height band", () => {
        for (const [ore, spec] of Object.entries(BETA_ORE_TABLE)) {
            const rule = readJson(primaryRulePath(ore))["minecraft:feature_rules"];
            assert.equal(rule.description.identifier, `minecraft:overworld_underground_${ore}_ore_feature`,
                `${ore}: the rule must keep the vanilla identifier or the override never lands`);
            assert.equal(rule.description.places_feature, `bh:beta_${ore}_ore_feature`,
                `${ore}: the primary rule must place the pack's own Beta feature`);
            assert.equal(rule.distribution.iterations, spec.veins,
                `${ore}: Beta attempted ${spec.veins} veins per chunk`);
            assert.deepEqual(rule.distribution.y.extent, spec.y,
                `${ore}: Beta's height band is y ${spec.y[0]}..${spec.y[1]}`);
            assert.equal(rule.distribution.y.distribution, spec.yDistribution,
                `${ore}: y must use the shape Beta's band had`);
            assert.ok(JSON.stringify(rule.conditions["minecraft:biome_filter"]).includes('"overworld"'),
                `${ore}: the rule must stay attached to the overworld biome tag`);
        }
    });

    it("builds every Beta ore feature with the era's vein size and only into stone", () => {
        for (const [ore, spec] of Object.entries(BETA_ORE_TABLE)) {
            const path = resolve(root, `packs/BP/features/beta_${ore}_ore_feature.json`);
            assert.ok(existsSync(path), `${ore}: the Beta ore feature must exist`);
            const feature = readJson(path)["minecraft:ore_feature"];
            assert.equal(feature.description.identifier, `bh:beta_${ore}_ore_feature`);
            assert.equal(feature.count, spec.count, `${ore}: Beta veins held ${spec.count} blocks`);
            for (const rule of feature.replace_rules) {
                assert.equal(rule.places_block, `minecraft:${ore}_ore`,
                    `${ore}: the feature may only place its own ore block`);
                assert.deepEqual(rule.may_replace, STONE_FAMILY,
                    `${ore}: ore may only replace the stone family, never surface or drop blocks`);
            }
        }
    });

    it("neuters every ore rule that is not a declared Beta primary", () => {
        const rulesDir = resolve(root, "packs/BP/feature_rules");
        for (const file of readdirSync(rulesDir)) {
            const rule = readJson(resolve(rulesDir, file))["minecraft:feature_rules"];
            const filter = JSON.stringify(rule.conditions["minecraft:biome_filter"]);
            const isDeclaredPrimary = Object.keys(BETA_ORE_TABLE)
                .some((ore) => rule.description.identifier === `minecraft:overworld_underground_${ore}_ore_feature`);
            if (isDeclaredPrimary) {
                assert.ok(!filter.includes(DISABLED_RULE_TAG),
                    `${file}: a declared Beta primary must not be disabled`);
            } else {
                assert.ok(filter.includes(DISABLED_RULE_TAG),
                    `${file}: modern split variants must be inert, or they double-fire on top of Beta's counts`);
            }
        }
    });
});
