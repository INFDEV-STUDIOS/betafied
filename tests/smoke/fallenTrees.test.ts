import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
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
