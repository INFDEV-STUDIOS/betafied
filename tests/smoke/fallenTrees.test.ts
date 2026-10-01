import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Bedrock scatters fallen logs through these features. Each is overridden with a stub that only
// replaces `structure_void` with air, so the feature generates nothing and no fallen log is placed.
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

describe("World Generation - fallen tree features", () => {
    const root = process.cwd();

    it("stubs every fallen-tree feature so it places nothing", () => {
        for (const name of FALLEN_FEATURES) {
            const path = resolve(root, `packs/BP/features/${name}.json`);
            assert.ok(existsSync(path), `${name} must be overridden to suppress fallen logs`);

            const feature = JSON.parse(readFileSync(path, "utf-8"));
            const identifier = feature?.["minecraft:ore_feature"]?.description?.identifier;
            assert.equal(identifier, `minecraft:${name}`, `${name} must keep its vanilla identifier`);

            const replaceRules = feature?.["minecraft:ore_feature"]?.replace_rules ?? [];
            for (const rule of replaceRules) {
                assert.equal(rule.places_block, "minecraft:air", `${name} must place air, not a log`);
                assert.ok(
                    (rule.may_replace ?? []).includes("minecraft:structure_void"),
                    `${name} must be gated on structure_void so it never overwrites real terrain`
                );
            }
        }
    });
});
