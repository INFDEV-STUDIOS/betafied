import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Plants, flat overlays and water decorations have no cube silhouette, so masking them is a
// reasonable way to make a post-Beta block disappear. Anything with a solid cube silhouette is
// deliberately not listed: masking a cube punches a see-through hole in the terrain until a script
// gets around to it, and a hole is never what a player should see.
const MAY_BE_INVISIBLE = new Set([
    "bubble_column",
    "cactus_flower",
    "campfire",
    "firefly_bush",
    "kelp",
    "lantern",
    "leaf_litter",
    "lilac",
    "peony",
    "pitcher_plant",
    "rose_bush",
    "seagrass",
    "soul_fire",
    "soul_lantern",
    "spore_blossom",
    "sunflower",
    "vine"
]);

// Shortnames the pack's own blocks.json asks the atlas to resolve for Beta materials. Each one has
// to be declared here: an undeclared shortname falls back to resolution behaviour the pack does not
// control, which is how netherrack and soul sand became hard to tell apart.
const BETA_SHORTNAMES = ["netherrack", "soul_sand", "stone", "gravel", "obsidian", "glowstone"];

// Tiles vanilla's flipbook_textures.json animates by name. The engine animates the atlas tile, not
// the JSON entry, so a pack entry that points at the same texture path as one of these is the same
// tile and silently inherits its frames. Pointing magma at gravel's path is how gravel started
// rendering with the soul sand art sitting in graphics/blocks/magma.
const VANILLA_ANIMATED_TILES = [
    "magma",
    "portal",
    "prismarine",
    "sea_lantern",
    "stonecutter2_saw",
    "still_lava",
    "flowing_lava",
    "still_water_grey",
    "flowing_water_grey",
    "cauldron_water",
    "campfire_fire",
    "campfire_log_lit",
    "lantern",
    "kelp_a",
    "kelp_b",
    "kelp_c",
    "kelp_d",
    "kelp_top",
    "kelp_top_bulb",
    "seagrass_short",
    "seagrass_tall_bot_a",
    "seagrass_tall_bot_b",
    "seagrass_tall_top_a",
    "seagrass_tall_top_b",
    "fire_0",
    "fire_1"
];

// The pack's deliberate "make this disappear" sentinel. Masked tiles share it on purpose and a
// flipbook repainting one with itself is a no-op, so only real block paths are worth asserting on.
const MASKED_PATH = "textures/blocks/invisible";

const readJson = (path: string): any => JSON.parse(readFileSync(path, "utf-8"));

// The single texture path of an atlas entry, or undefined when it fans out across several tiles.
const solePath = (entry: any): string | undefined =>
    typeof entry?.textures === "string" ? entry.textures : undefined;

describe("Block Appearance - masked blocks and atlas shortnames", () => {
    const root = process.cwd();
    const blocks = readJson(resolve(root, "packs/RP/blocks.json"));
    const atlas = readJson(resolve(root, "packs/RP/textures/terrain_texture.json")).texture_data;

    it("never masks a full cube with the invisible block shape", () => {
        const masked = Object.entries(blocks)
            .filter(([, definition]: [string, any]) => definition?.blockshape === "invisible")
            .map(([name]) => name);

        for (const name of masked) {
            assert.ok(
                MAY_BE_INVISIBLE.has(name),
                `${name} is a full cube masked with blockshape "invisible"; map it onto a Beta block instead`
            );
        }
    });

    // Vanilla's own flipbook targets atlas_index 1 of this entry ("firefly_bush_firefly"), so the
    // second tile is load-bearing. Collapsing it to a single tile does not silence the engine's
    // "invalid atlas index 1 for the expected UV count 1" line either: that compile-time check fires
    // for vanilla's own declaration, which the pack cannot replace, only shadow.
    it("keeps the firefly bush entry two tiles wide for vanilla's flipbook", () => {
        const entry = atlas.firefly_bush;
        assert.ok(entry, "terrain_texture.json must keep the firefly_bush entry");
        assert.ok(
            Array.isArray(entry.textures) && entry.textures.length === 2,
            "firefly_bush must stay two tiles: vanilla's flipbook animates atlas_index 1"
        );
    });

    it("declares every shortname the remapped blocks resolve through the atlas", () => {
        for (const name of BETA_SHORTNAMES) {
            const entry = atlas[name];
            assert.ok(entry, `terrain_texture.json must define the '${name}' shortname`);
            assert.match(entry.textures, /^textures\/blocks\//, `${name} must point at a block texture path`);
        }
    });

    it("never lets a beta block alias onto a tile vanilla animates", () => {
        const animated = new Map(
            VANILLA_ANIMATED_TILES.filter((name) => name in atlas).map((name) => [name, solePath(atlas[name])])
        );

        for (const [name, entry] of Object.entries(atlas)) {
            const path = solePath(entry);
            if (path === undefined || path === MASKED_PATH) continue;
            for (const [animatedName, animatedPath] of animated) {
                if (name === animatedName || animatedPath !== path) continue;
                assert.fail(
                    `'${name}' and the vanilla-animated '${animatedName}' both resolve to ${path}; ` +
                        `give '${name}' its own texture file so the flipbook cannot repaint it`
                );
            }
        }
    });
});
