import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

describe("Bedrock Natural Spawning Contract - Spawn Rules & Biome Integrity", () => {
    const root = process.cwd();
    const biomesDir = resolve(root, "packs/BP/biomes");
    const spawnRulesDir = resolve(root, "packs/BP/spawn_rules");

    it("verifies every biome file defines non-empty minecraft:tags", () => {
        const biomeFiles = readdirSync(biomesDir).filter(f => f.endsWith(".json"));
        assert.ok(biomeFiles.length >= 60, "Expected at least 60 biome definitions");

        for (const file of biomeFiles) {
            const content = JSON.parse(readFileSync(resolve(biomesDir, file), "utf-8"));
            const biome = content["minecraft:biome"];
            assert.ok(biome, `${file} must contain a minecraft:biome root`);

            const tagsComponent = biome.components?.["minecraft:tags"];
            assert.ok(tagsComponent, `${file} is missing components['minecraft:tags']`);
            assert.ok(Array.isArray(tagsComponent.tags), `${file} tags must be an array`);
            assert.ok(tagsComponent.tags.length > 0, `${file} tags array must not be empty`);

            const hasDimensionTag = tagsComponent.tags.some(
                (t: string) => t === "overworld" || t === "nether" || t === "the_end"
            );
            assert.ok(hasDimensionTag, `${file} must declare a dimension tag (overworld, nether, or the_end)`);
        }
    });

    it("verifies animal biomes include creature spawn probability for chunk generation", () => {
        const biomeFiles = readdirSync(biomesDir).filter(f => f.endsWith(".json"));

        for (const file of biomeFiles) {
            const content = JSON.parse(readFileSync(resolve(biomesDir, file), "utf-8"));
            const biome = content["minecraft:biome"];
            const tags = biome.components?.["minecraft:tags"]?.tags ?? [];

            if (tags.includes("animal")) {
                const prob = biome.components?.["minecraft:creature_spawn_probability"];
                assert.ok(prob, `${file} has 'animal' tag but lacks minecraft:creature_spawn_probability`);
                assert.ok(typeof prob.probability === "number" && prob.probability > 0, `${file} must define positive creature spawn probability`);
            }
        }
    });

    it("verifies spawn rules only filter on block ids vanilla uses", () => {
        // The 51 vanilla spawn_rules files only ever filter on these four ids. grass_block is a
        // real block (it is the command-facing name since 1.20.70) but vanilla never uses it here,
        // so a rule that does is filtering on something the spawn engine has no sample data for.
        const VANILLA_FILTERS = new Set([
            "minecraft:grass",
            "minecraft:sand",
            "minecraft:ice",
            "minecraft:clay"
        ]);

        const ruleFiles = readdirSync(spawnRulesDir).filter(f => f.endsWith(".json"));

        for (const file of ruleFiles) {
            const raw = readFileSync(resolve(spawnRulesDir, file), "utf-8");
            const declared = [...raw.matchAll(/"minecraft:spawns_on_block_filter":\s*"([^"]+)"/g)].map(m => m[1]);

            for (const id of declared) {
                assert.ok(
                    VANILLA_FILTERS.has(id),
                    `${file} filters on '${id}', which no vanilla spawn rule uses`
                );
            }
        }
    });

    it("verifies monster spawn rules do not constrain surface spawns to grass", () => {
        const monsterFiles = ["zombie.json", "skeleton.json", "creeper.json", "spider.json"];

        for (const file of monsterFiles) {
            const content = JSON.parse(readFileSync(resolve(spawnRulesDir, file), "utf-8"));
            const conditions = content["minecraft:spawn_rules"]?.conditions ?? [];

            for (const cond of conditions) {
                if (cond["minecraft:spawns_on_surface"]) {
                    assert.ok(
                        !cond["minecraft:spawns_on_block_filter"],
                        `${file} must not constrain surface spawning to a block filter`
                    );
                }
            }
        }
    });

    it("verifies Nether mob spawn rules use underground spawning and valid nether tags", () => {
        const netherFiles = ["ghast.json", "zombie_pigman.json"];

        for (const file of netherFiles) {
            const raw = readFileSync(resolve(spawnRulesDir, file), "utf-8");
            const content = JSON.parse(raw);
            const conditions = content["minecraft:spawn_rules"]?.conditions ?? [];

            assert.ok(!raw.includes("beta_nether"), `${file} must not reference phantom tag 'beta_nether'`);

            for (const cond of conditions) {
                assert.ok(
                    !cond["minecraft:spawns_on_surface"],
                    `${file} cannot use spawns_on_surface in Nether (Nether has no surface)`
                );
                assert.ok(
                    cond["minecraft:spawns_underground"],
                    `${file} must use spawns_underground in Nether`
                );
            }
        }
    });

    it("verifies post-Beta mobs are suppressed with the unreachable the_void biome filter", () => {
        // Vanilla keeps adding natural spawners; each one must ship a rule whose only
        // biome condition is a tag no real biome ever uses, otherwise it spawns unchecked.
        const suppressed = ["sulfur_cube", "bee", "armadillo", "creaking", "breeze"];

        for (const name of suppressed) {
            const content = JSON.parse(readFileSync(resolve(spawnRulesDir, `${name}.json`), "utf-8"));
            const conditions = content["minecraft:spawn_rules"]?.conditions ?? [];

            assert.ok(conditions.length > 0, `${name}.json must declare spawn conditions`);

            for (const cond of conditions) {
                const filter = JSON.stringify(cond["minecraft:biome_filter"] ?? "");
                assert.ok(
                    filter.includes("the_void"),
                    `${name}.json must filter on the_void so it never spawns naturally`
                );
            }
        }
    });

    it("verifies all Beta mob spawn rules reference existing biome tags", () => {
        const betaRules = [
            "chicken.json", "cow.json", "creeper.json", "ghast.json", "pig.json",
            "sheep.json", "skeleton.json", "slime.json", "spider.json", "squid.json",
            "wolf.json", "zombie.json", "zombie_pigman.json"
        ];

        // Collect all declared biome tags across BP biomes
        const declaredTags = new Set<string>();
        const biomeFiles = readdirSync(biomesDir).filter(f => f.endsWith(".json"));
        for (const file of biomeFiles) {
            const content = JSON.parse(readFileSync(resolve(biomesDir, file), "utf-8"));
            const tags = content["minecraft:biome"]?.components?.["minecraft:tags"]?.tags ?? [];
            for (const t of tags) declaredTags.add(t);
        }

        for (const file of betaRules) {
            const content = JSON.parse(readFileSync(resolve(spawnRulesDir, file), "utf-8"));
            const conditions = content["minecraft:spawn_rules"]?.conditions ?? [];

            for (const cond of conditions) {
                const filter = cond["minecraft:biome_filter"];
                if (!filter) continue;

                const checkFilter = (f: any) => {
                    if (f.test === "has_biome_tag" && f.operator === "==") {
                        assert.ok(
                            declaredTags.has(f.value),
                            `${file} references tag '${f.value}' which does not exist in any biome`
                        );
                    }
                    if (f.any_of) f.any_of.forEach(checkFilter);
                    if (f.all_of) f.all_of.forEach(checkFilter);
                };

                checkFilter(filter);
            }
        }
    });
});
