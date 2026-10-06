import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { SWORD_FAST_BLOCKS } from "../../packs/BP/scripts/interactions/swordMining.js";

const root = process.cwd();

const STAIRS = ["oak_stairs", "cobblestone_stairs"];
const SLABS = ["wooden_slab", "cobblestone_slab", "sandstone_slab", "stone_slab"];
const LOGS = ["oak_log", "birch_log", "spruce_log"];

function readJson(path: string): any {
    return JSON.parse(readFileSync(path, "utf-8"));
}

function blockOf(name: string): any {
    const path = resolve(root, "packs/BP/blocks", `${name}.json`);
    assert.ok(existsSync(path), `packs/BP/blocks/${name}.json must exist`);
    return readJson(path)["minecraft:block"];
}

function texturesOf(block: any): string[] {
    return Object.values(block.components["minecraft:material_instances"])
        .map((instance: any) => instance.texture);
}

describe("Classic Block Contract - Beta 1.7.3 logs, stairs and slabs", () => {
    it("restricts stairs to a single flat placement direction", () => {
        for (const name of STAIRS) {
            const block = blockOf(name);
            const traits = block.description.traits;

            assert.deepEqual(
                traits["minecraft:placement_direction"].enabled_states,
                ["minecraft:cardinal_direction"],
                `${name} must only record the player's horizontal direction`
            );
            // Beta 1.7.3 had no upside-down stairs, so no vertical_half state may exist.
            assert.equal(traits["minecraft:placement_position"], undefined, `${name} must not enable vertical_half`);
            assert.equal(block.description.states, undefined, `${name} must not declare custom states`);

            const conditions = block.permutations.map((p: any) => p.condition);
            assert.equal(conditions.length, 4, `${name} must rotate through four cardinal directions`);
            for (const condition of conditions) {
                assert.ok(
                    condition.includes("minecraft:cardinal_direction"),
                    `${name} rotation must be driven by cardinal_direction only: ${condition}`
                );
            }
        }
    });

    it("keeps stair collision shape direction independent", () => {
        for (const name of STAIRS) {
            const block = blockOf(name);

            // The cardinal rotations move the collision box with the model, so the box is
            // declared once in its default (south facing) orientation.
            assert.deepEqual(block.components["minecraft:collision_box"], [
                { origin: [-8, 0, -8], size: [16, 8, 16] },
                { origin: [-8, 8, 0], size: [16, 8, 8] }
            ], `${name} must collide as a lower step plus an upper back quarter`);
            assert.equal(block.components["minecraft:selection_box"], true, `${name} must reuse its collision box`);
            assert.deepEqual(
                block.permutations.map((p: any) => p.components["minecraft:transformation"].rotation),
                [[0, 180, 0], [0, 270, 0], [0, 0, 0], [0, 90, 0]],
                `${name} must map north/west/south/east onto the shared geometry`
            );
        }
    });

    it("returns the source material instead of the stair itself", () => {
        // Beta 1.7.3 stairs were the one block that did not drop themselves: breaking a
        // wooden stair handed back a plank and a cobblestone stair handed back cobblestone,
        // which is why a mis-placed stair was worth a quarter of the stack that made it.
        const drops: Record<string, string> = {
            oak_stairs: "minecraft:oak_planks",
            cobblestone_stairs: "minecraft:cobblestone"
        };

        for (const [name, expected] of Object.entries(drops)) {
            const loot = blockOf(name).components["minecraft:loot"];
            assert.equal(loot, `loot_tables/blocks/${name}.json`, `${name} must route its drop through a loot table`);

            const pools = readJson(resolve(root, "packs/BP", loot)).pools;
            assert.deepEqual(pools.map((pool: any) => pool.rolls), [1], `${name} must drop exactly one roll`);
            assert.deepEqual(
                pools[0].entries.map((entry: any) => entry.name),
                [expected],
                `${name} must drop its source material`
            );
        }
    });

    it("ships a stair model with no corner or ceiling bones", () => {
        const geometry = readJson(resolve(root, "packs/RP/models/blocks/stair.geo.json"));
        const bones = geometry["minecraft:geometry"][0].bones.map((bone: any) => bone.name);

        assert.deepEqual(bones, ["g_base", "g_back"], "only the flat step and back quarter may be modelled");

        for (const name of STAIRS) {
            assert.equal(blockOf(name).components["minecraft:geometry"].identifier, "geometry.bh_stair");
        }
    });

    it("keeps slabs flat on the ground with nothing to rotate them", () => {
        for (const name of SLABS) {
            const block = blockOf(name);

            // Beta slabs only ever sat in the bottom half, so the block needs no half state,
            // no placement trait and no transformation at all.
            assert.equal(block.description.traits, undefined, `${name} must not enable placement traits`);
            assert.equal(block.description.states, undefined, `${name} must not declare states`);
            assert.equal(block.permutations, undefined, `${name} must not transform itself`);
            assert.deepEqual(
                block.components["minecraft:collision_box"],
                { origin: [-8, 0, -8], size: [16, 8, 16] },
                `${name} must collide as a bottom half`
            );
            // `selection_box: true` resolves to a full 16x16x16 outline, so a slab has to
            // declare the half box explicitly or it is targeted as if it were a full block.
            assert.deepEqual(
                block.components["minecraft:selection_box"],
                { origin: [-8, 0, -8], size: [16, 8, 16] },
                `${name} must outline only the bottom half`
            );
        }
    });

    it("pins logs to the vertical axis by omitting the axis state entirely", () => {
        for (const name of LOGS) {
            const block = blockOf(name);
            const instances = block.components["minecraft:material_instances"];

            assert.equal(block.description.states, undefined, `${name} must not expose a pillar axis`);
            assert.equal(block.description.traits, undefined, `${name} must not rotate on placement`);
            assert.equal(block.components["minecraft:geometry"].identifier, "minecraft:geometry.full_block");
            assert.ok(instances["*"].texture.endsWith("_log_side"), `${name} sides must use the bark texture`);
            assert.equal(instances["up"].texture, instances["down"].texture, `${name} caps must share a texture`);
            assert.ok(instances["up"].texture.endsWith("_log_top"), `${name} caps must use the ring texture`);
        }
    });

    it("returns each log item through the block so the vanilla log tags keep working", () => {
        for (const name of LOGS) {
            const item = readJson(resolve(root, "packs/BP/items", `${name}.json`))["minecraft:item"];
            const placer = item.components["minecraft:block_placer"];

            assert.equal(placer.block, `bh:${name}`);
            assert.equal(placer.replace_block_item, true, `${name} must replace the automatic block item`);
            assert.ok(
                item.components["minecraft:tags"].tags.includes("minecraft:logs"),
                `${name} must stay craftable into planks`
            );
        }
    });

    it("keeps charcoal obtainable by smelting any Beta log", () => {
        // The pack retypes every held log into a bh: item, so vanilla's furnace_log_* recipes
        // (input minecraft:log) can never match; these replacements are the only route to
        // charcoal in survival. Charcoal carries vanilla's minecraft:coals tag, so torches,
        // fires and the furnace itself accept it without further content.
        for (const name of LOGS) {
            const recipe = readJson(resolve(root, "packs/BP/recipes", `furnace_charcoal_${name}.json`))["minecraft:recipe_furnace"];

            assert.equal(recipe.input.item, `bh:${name}`, `charcoal recipe must smelt the item players actually hold (${name})`);
            assert.equal(recipe.output, "minecraft:charcoal");
            assert.ok(recipe.tags.includes("furnace"), `charcoal recipe for ${name} must fire in a furnace`);
        }
    });

    it("burns Beta logs in a furnace like the originals did", () => {
        // Beta's logs were furnace fuel at 15 seconds, so the custom items must carry the
        // fuel component themselves - tags do not grant burn time.
        for (const name of LOGS) {
            const item = readJson(resolve(root, "packs/BP/items", `${name}.json`))["minecraft:item"];
            const fuel = item.components["minecraft:fuel"];

            assert.ok(fuel, `${name} must declare minecraft:fuel`);
            assert.equal(fuel.duration, 15.0, `${name} must burn for Beta's 15 seconds`);
        }
    });

    it("registers every block texture in the terrain atlas", () => {
        const atlas = readJson(resolve(root, "packs/RP/textures/terrain_texture.json")).texture_data;

        for (const name of [...STAIRS, ...SLABS, ...LOGS]) {
            for (const texture of texturesOf(blockOf(name))) {
                assert.ok(atlas[texture], `${name} references '${texture}', which is missing from terrain_texture.json`);
            }
        }
    });

    it("declares tool tags the way the current block schema accepts them", () => {
        const blocksDir = resolve(root, "packs/BP/blocks");
        const files = readdirSync(blocksDir).filter(file => file.endsWith(".json"));

        for (const file of files) {
            const raw = readFileSync(resolve(blocksDir, file), "utf-8");
            const definition = JSON.parse(raw);
            const formatVersion = String(definition.format_version).split(".").map(Number);
            if (formatVersion[1] < 26) continue;

            const block = definition["minecraft:block"];

            // Formats from 1.26.20 onward dropped the `tag:<name>` component from the schema in
            // favour of a tags array, and the loader rejects a definition that still uses it.
            assert.equal(raw.includes('"tag:'), false, `${file} must declare tags as an array`);
            assert.ok(Array.isArray(block.components["minecraft:tags"]), `${file} must declare minecraft:tags`);
        }

        for (const name of STAIRS) {
            const tags = blockOf(name).components["minecraft:tags"];
            assert.equal(
                tags.includes("minecraft:cornerable_stairs"),
                false,
                `${name} must stay out of vanilla's corner-forming group`
            );
        }

        for (const name of [...LOGS, "oak_stairs"]) {
            assert.ok(
                blockOf(name).components["minecraft:tags"].includes("minecraft:is_axe_item_destructible"),
                `${name} must be chopped with an axe`
            );
        }

        // Beta shipped the wooden slab as the stone slab with a plank texture tacked on,
        // so it answers to a pickaxe and must not reward an axe.
        const slabTags = blockOf("wooden_slab").components["minecraft:tags"];
        assert.ok(
            slabTags.includes("minecraft:is_pickaxe_item_destructible"),
            "wooden_slab must be mined at stone speed with a pickaxe"
        );
        assert.equal(
            slabTags.includes("minecraft:is_axe_item_destructible"),
            false,
            "wooden_slab must not be chopped with an axe"
        );
    });

    it("gives the sword haste only to the wood-class blocks", () => {
        assert.ok(SWORD_FAST_BLOCKS.has("bh:oak_stairs"), "custom wooden stairs must break fast with a sword");
        assert.equal(
            SWORD_FAST_BLOCKS.has("bh:wooden_slab"),
            false,
            "the stone-backed wooden slab must not get the sword bonus"
        );
    });

    it("keeps no scripted placer, structure or overriding item for these blocks", () => {
        const scripts = resolve(root, "packs/BP/scripts");

        assert.equal(existsSync(resolve(scripts, "interactions/structurePlacer.ts")), false);
        assert.equal(existsSync(resolve(root, "packs/BP/structures/oak_stairs.mcstructure")), false);
        assert.equal(existsSync(resolve(root, "packs/BP/structures/cobblestone_stairs.mcstructure")), false);

        for (const name of [...STAIRS, ...SLABS]) {
            assert.equal(
                existsSync(resolve(root, "packs/BP/items", `${name}.json`)),
                false,
                `${name} must be defined by its block alone`
            );
        }

        const structures = readdirSync(resolve(root, "packs/BP/structures"));
        assert.deepEqual(structures, ["island.mcstructure"], "stairs were the only structures the pack needed");

        const stale = readdirSync(resolve(root, "packs/BP/blocks"))
            .filter(file => file.endsWith(".json"))
            .filter(file => readFileSync(resolve(root, "packs/BP/blocks", file), "utf-8").includes("_placer"));
        assert.deepEqual(stale, [], "no block may depend on a scripted placer component");
    });
});

describe("Classic Recipe Contract - Beta 1.7.3 fence", () => {
    it("replaces vanilla's fence recipe instead of adding a parallel one", () => {
        // Vanilla's oak fence recipe id is `minecraft:fence`. Adding a second bh: recipe beside it —
        // which is what this recipe used to be — leaves the vanilla result craftable, and a vanilla
        // fence never joins a bh:fence line. Overriding the id is the same fix the chest needed.
        const recipe = readJson(resolve(root, "packs/BP/recipes/oak_fence.json"))["minecraft:recipe_shaped"];

        assert.equal(
            recipe.description.identifier,
            "minecraft:fence",
            "the recipe must override vanilla's id rather than sit beside it"
        );
        assert.equal(recipe.result.item, "bh:fence", "a crafted fence must already be the custom block");
        assert.equal(recipe.result.count, 2, "Beta crafted two fences from six sticks");
        assert.ok(
            recipe.tags.includes("crafting_table"),
            "the vanilla table has to offer the Beta result too"
        );
        assert.ok(
            recipe.tags.includes("beta_crafting"),
            "the custom crafting table serves this tag and must keep offering it"
        );
    });
});

describe("Classic Block Contract - custom block names", () => {
    it("translates every custom block, not just its display name", () => {
        // Since 1.19.30 minecraft:display_name shows its raw string, but surfaces that build their
        // own title (the container screen among them) still look up tile.<identifier>.name and come
        // up nameless when it is missing.
        const entries = new Set<string>();
        for (const line of readFileSync(resolve(root, "packs/RP/texts/en_US.lang"), "utf-8").split(/\r?\n/)) {
            const separator = line.indexOf("=");
            if (separator > 0 && !line.startsWith("#")) entries.add(line.slice(0, separator));
        }

        const blocksDir = resolve(root, "packs/BP/blocks");
        const untranslated = readdirSync(blocksDir)
            .filter(file => file.endsWith(".json"))
            .map(file => readJson(resolve(blocksDir, file))["minecraft:block"].description.identifier)
            .filter(identifier => !entries.has(`tile.${identifier}.name`));

        assert.deepEqual(untranslated, [], "every custom block needs a tile.<identifier>.name entry");
    });
});
