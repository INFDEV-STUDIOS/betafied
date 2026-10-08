import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

function readJson(path: string): any {
    return JSON.parse(readFileSync(path, "utf-8"));
}

const chest = readJson(resolve(root, "packs/BP/blocks/chest.json"))["minecraft:block"];

function languageEntries(): Map<string, string> {
    const entries = new Map<string, string>();
    const raw = readFileSync(resolve(root, "packs/RP/texts/en_US.lang"), "utf-8");

    for (const line of raw.split(/\r?\n/)) {
        const separator = line.indexOf("=");
        if (separator <= 0 || line.startsWith("#")) continue;
        entries.set(line.slice(0, separator), line.slice(separator + 1));
    }
    return entries;
}

describe("Classic Block Contract - Beta 1.7.3 chest", () => {
    it("occupies the whole cube instead of vanilla's inset chest model", () => {
        assert.equal(chest.description.identifier, "bh:chest");
        assert.equal(chest.components["minecraft:geometry"].identifier, "minecraft:geometry.full_block");
        assert.deepEqual(
            chest.components["minecraft:collision_box"],
            { origin: [-8, 0, -8], size: [16, 16, 16] },
            "the chest must collide as a full block"
        );
        assert.deepEqual(
            chest.components["minecraft:selection_box"],
            { origin: [-8, 0, -8], size: [16, 16, 16] },
            "the chest must be targeted as a full block"
        );
    });

    it("carries a single chest worth of slots", () => {
        // The container lives on the block entity, so no script or container entity is needed
        // to give the block an inventory. Interacting with the block opens it natively.
        assert.deepEqual(
            chest.components["minecraft:block_entity"],
            { container: { slot_count: 27 } },
            "a single chest must expose exactly 27 slots"
        );
    });

    it("turns its latch toward whoever placed it", () => {
        // The trait records the player's facing, and rotating it half a turn leaves the latch on the
        // side the player is standing on, which is the face a chest shows the person who placed it.
        assert.deepEqual(chest.description.traits["minecraft:placement_direction"], {
            enabled_states: ["minecraft:cardinal_direction"],
            y_rotation_offset: 180
        });

        const frontFaces = (instances: any): string[] =>
            Object.entries(instances)
                .filter(([, instance]: [string, any]) => instance.texture === "bh_chest_front")
                .map(([face]) => face);

        // South is the base permutation, so it is also the face the inventory icon shows.
        assert.deepEqual(frontFaces(chest.components["minecraft:material_instances"]), ["south"]);

        for (const permutation of chest.permutations) {
            const direction = permutation.condition.match(/== '(\w+)'/)?.[1];
            assert.ok(direction, `unreadable rotation condition: ${permutation.condition}`);
            assert.deepEqual(
                frontFaces(permutation.components["minecraft:material_instances"]),
                [direction],
                `the ${direction} state must put the latch on its own face`
            );
        }

        assert.deepEqual(
            chest.permutations.map((p: any) => p.condition.match(/== '(\w+)'/)?.[1]).sort(),
            ["east", "north", "west"],
            "the base components already draw the south-facing latch"
        );
    });

    it("registers every chest texture in the terrain atlas", () => {
        const atlas = readJson(resolve(root, "packs/RP/textures/terrain_texture.json")).texture_data;

        for (const instance of Object.values(chest.components["minecraft:material_instances"])) {
            const texture = (instance as any).texture;
            assert.ok(atlas[texture], `chest references '${texture}', which is missing from terrain_texture.json`);
        }
    });

    it("is titled in the container screen it opens", () => {
        // The screen builds its own title from tile.<identifier>.name, so a missing entry is what
        // leaves an opened chest nameless no matter what display_name says.
        const lang = languageEntries();

        assert.equal(lang.get("tile.bh:chest.name"), "Chest");
        assert.equal(lang.get("tile.bh:double_chest.name"), "Large Chest");
        assert.equal(
            chest.components["minecraft:display_name"],
            lang.get("tile.bh:chest.name"),
            "the hover name and the container title must read the same"
        );
    });

    it("cannot be shoved around by pistons", () => {
        // A pushed container block leaves its block entity behind, which is how a chest ends up
        // spilling or duplicating its contents. Vanilla chests are immovable for the same reason.
        assert.equal(chest.components["minecraft:movable"].movement_type, "immovable");
    });

    it("declares tool tags the way the current block schema accepts them", () => {
        const raw = readFileSync(resolve(root, "packs/BP/blocks/chest.json"), "utf-8");

        assert.equal(raw.includes('"tag:'), false, "chest must declare tags as an array");
        assert.ok(
            chest.components["minecraft:tags"].includes("minecraft:is_axe_item_destructible"),
            "chest must be chopped with an axe"
        );
    });
});

describe("Classic Item Contract - Beta 1.7.3 chest items", () => {
    function recipeOf(name: string): any {
        return readJson(resolve(root, "packs/BP/recipes", `${name}.json`));
    }

    it("crafts the custom chest block itself", () => {
        // Crafting a vanilla chest would only hand the player an item the inventory sweep converts
        // a tick later, and a chest placed in that window would not join the pair. Overriding the
        // vanilla recipe id ensures vanilla chests cannot be crafted on either crafting table.
        const recipe = recipeOf("chest")["minecraft:recipe_shaped"];
        assert.equal(recipe.result.item, "bh:chest");
        assert.equal(
            recipe.description.identifier,
            "minecraft:chest",
            "the recipe must override vanilla's id rather than sit beside it"
        );
        assert.ok(
            recipe.tags.includes("crafting_table"),
            "the vanilla table has to offer the Beta result too"
        );
        assert.ok(
            recipe.tags.includes("beta_crafting"),
            "the custom crafting table serves this tag and must keep offering it"
        );
        assert.equal(
            recipe.key["#"].tag,
            "minecraft:planks",
            "all plank types must craft chests"
        );
        assert.deepEqual(
            recipe.unlock,
            [{ tag: "minecraft:planks" }],
            "planks unlock the chest recipe"
        );
    });

    it("lets the chest minecart recipe consume the chest players actually hold", () => {
        const ingredients = recipeOf("chest_minecart")["minecraft:recipe_shapeless"].ingredients;

        assert.deepEqual(
            ingredients.map((ingredient: any) => ingredient.item),
            ["bh:chest", "minecraft:minecart"],
            "once chests convert to bh:chest, a recipe keyed on the vanilla chest is uncraftable"
        );
    });
});
