import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    DOUBLE_CHEST_ID,
    DOUBLE_CHEST_SLOTS,
    SINGLE_CHEST_ID,
    SINGLE_CHEST_SLOTS,
    dropOfflineViewers,
    hasAnyItem,
    mergeContents,
    orderPair,
    pairKey,
    planClose,
    planOpen,
    planOpenBlock,
    planPlacement,
    planSweep,
    resolveHalf
} from "../../packs/BP/scripts/interactions/doubleChest.js";

const root = process.cwd();

function readJson(path: string): any {
    return JSON.parse(readFileSync(path, "utf-8"));
}

function blockOf(name: string): any {
    return readJson(resolve(root, "packs/BP/blocks", `${name}.json`))["minecraft:block"];
}

const doubleChest = blockOf("double_chest");
const singleChest = blockOf("chest");

function texturesOf(block: any): string[] {
    const instances = [block.components, ...(block.permutations ?? []).map((p: any) => p.components)];
    return instances.flatMap(components =>
        Object.values(components["minecraft:material_instances"] ?? {}).map((instance: any) => instance.texture)
    );
}

describe("Classic Block Contract - Beta 1.7.3 double chest", () => {
    it("spans two blocks so the halves can share one inventory", () => {
        assert.equal(doubleChest.description.identifier, DOUBLE_CHEST_ID);
        assert.deepEqual(doubleChest.description.traits["minecraft:multi_block"], {
            enabled_states: ["minecraft:multi_block_part"],
            parts: 2,
            direction: "east"
        });

        // Without placement_direction the part axis stays east, so the pair never
        // rotates out from under the fixed south-facing latch.
        assert.equal(doubleChest.description.traits["minecraft:placement_direction"], undefined);
    });

    it("holds twice the slots of a single chest", () => {
        const container = doubleChest.components["minecraft:block_entity"].container;
        const single = singleChest.components["minecraft:block_entity"].container;

        assert.equal(container.slot_count, DOUBLE_CHEST_SLOTS);
        assert.equal(single.slot_count, SINGLE_CHEST_SLOTS);
        assert.equal(container.slot_count, single.slot_count * 2, "a double chest must be exactly two singles");
        assert.ok(container.slot_count <= 54, "the container component caps out at 54 slots");
    });

    it("stays a full cube in both parts", () => {
        for (const name of ["chest", "double_chest"]) {
            const block = blockOf(name);
            assert.equal(block.components["minecraft:geometry"].identifier, "minecraft:geometry.full_block");
            assert.deepEqual(block.components["minecraft:collision_box"], { origin: [-8, 0, -8], size: [16, 16, 16] });
            assert.deepEqual(block.components["minecraft:selection_box"], { origin: [-8, 0, -8], size: [16, 16, 16] });
        }
    });

    it("declares the movable component the multi-block trait requires", () => {
        const movementType = doubleChest.components["minecraft:movable"]["movement_type"];
        assert.ok(
            movementType === "popped" || movementType === "immovable",
            `multi-blocks only accept popped or immovable, got '${movementType}'`
        );
        // Popped would let a piston destroy one half of the pair on its own, which both strands the
        // other half and hands back the whole pair's loot.
        assert.equal(movementType, "immovable", "pistons must not be able to split the pair");
    });

    it("looks like two halves of one chest rather than two copies of one", () => {
        assert.deepEqual(doubleChest.permutations.map((p: any) => p.condition), [
            "q.block_state('minecraft:multi_block_part') == 1"
        ]);
        assert.notEqual(
            doubleChest.components["minecraft:material_instances"].south.texture,
            doubleChest.permutations[0].components["minecraft:material_instances"].south.texture,
            "the eastern half must wear the right-hand face texture"
        );
    });

    it("reads as a large chest in the screen it opens", () => {
        assert.equal(doubleChest.components["minecraft:display_name"], "Large Chest");
    });

    it("registers every chest texture in the terrain atlas", () => {
        const atlas = readJson(resolve(root, "packs/RP/textures/terrain_texture.json")).texture_data;

        for (const name of ["chest", "double_chest"]) {
            for (const texture of texturesOf(blockOf(name))) {
                assert.ok(atlas[texture], `${name} references '${texture}', which is missing from terrain_texture.json`);
            }
        }
    });

    it("returns both singles because the pair breaks as one block", () => {
        const loot = doubleChest.components["minecraft:loot"];
        assert.equal(loot, "loot_tables/blocks/double_chest.json");

        const pools = readJson(resolve(root, "packs/BP", loot)).pools;
        assert.deepEqual(pools.map((pool: any) => pool.rolls), [2], "breaking a double chest must hand back two chests");
        assert.deepEqual(pools[0].entries.map((entry: any) => entry.name), [SINGLE_CHEST_ID]);
    });

    it("declares tool tags the way the current block schema accepts them", () => {
        const raw = readFileSync(resolve(root, "packs/BP/blocks/double_chest.json"), "utf-8");

        assert.equal(raw.includes('"tag:'), false, "double_chest must declare tags as an array");
        assert.ok(
            doubleChest.components["minecraft:tags"].includes("minecraft:is_axe_item_destructible"),
            "double_chest must be chopped with an axe"
        );
    });
});

describe("Double chest mirror rules", () => {
    const idle = { masterViewers: 0, shadowViewers: 0 };

    it("hands the items to the half a player opens", () => {
        assert.equal(
            planOpen({ half: "shadow", firstViewer: true, masterHasItems: true, shadowHasItems: false, ...idle }),
            "master-to-shadow"
        );
        assert.equal(
            planOpen({ half: "master", firstViewer: true, masterHasItems: false, shadowHasItems: true, ...idle }),
            "shadow-to-master"
        );
    });

    it("moves nothing when the opened half already holds the items", () => {
        assert.equal(
            planOpen({ half: "shadow", firstViewer: true, masterHasItems: false, shadowHasItems: true, ...idle }),
            "none"
        );
        assert.equal(
            planOpen({ half: "master", firstViewer: true, masterHasItems: true, shadowHasItems: false, ...idle }),
            "none"
        );
    });

    it("never empties a half that someone is already looking at", () => {
        assert.equal(
            planOpen({ half: "shadow", firstViewer: true, masterHasItems: true, shadowHasItems: false, masterViewers: 1, shadowViewers: 0 }),
            "none",
            "a shadow viewer would watch the master's items vanish mid-session"
        );
        assert.equal(
            planOpen({ half: "master", firstViewer: true, masterHasItems: false, shadowHasItems: true, masterViewers: 0, shadowViewers: 1 }),
            "none",
            "the live shadow session owns the items"
        );
    });

    it("treats a second viewer of the same half as joining the live container", () => {
        assert.equal(
            planOpen({ half: "shadow", firstViewer: false, masterHasItems: true, shadowHasItems: true, masterViewers: 0, shadowViewers: 1 }),
            "none"
        );
        assert.equal(
            planOpen({ half: "master", firstViewer: false, masterHasItems: true, shadowHasItems: true, masterViewers: 1, shadowViewers: 0 }),
            "none"
        );
    });

    it("returns the right half's leftovers to the master once its last viewer leaves", () => {
        assert.equal(planClose({ half: "shadow", remainingViewers: 0, shadowHasItems: true }), "shadow-to-master");
        assert.equal(planClose({ half: "shadow", remainingViewers: 1, shadowHasItems: true }), "none");
        assert.equal(planClose({ half: "shadow", remainingViewers: 0, shadowHasItems: false }), "none");
        assert.equal(planClose({ half: "master", remainingViewers: 0, shadowHasItems: true }), "none");
    });

    it("drains for the master only while nobody holds the right half open", () => {
        assert.equal(planSweep({ shadowViewers: 0, shadowHasItems: true }), "shadow-to-master");
        assert.equal(planSweep({ shadowViewers: 1, shadowHasItems: true }), "none");
        assert.equal(planSweep({ shadowViewers: 0, shadowHasItems: false }), "none");
    });

    it("turns away a second viewer of the other half rather than showing an empty chest", () => {
        assert.equal(planOpenBlock({ half: "master", masterViewers: 0, shadowViewers: 1 }), true);
        assert.equal(planOpenBlock({ half: "shadow", masterViewers: 1, shadowViewers: 0 }), true);
    });

    it("lets a second viewer join the half that is already on screen", () => {
        assert.equal(planOpenBlock({ half: "master", masterViewers: 1, shadowViewers: 0 }), false);
        assert.equal(planOpenBlock({ half: "shadow", masterViewers: 0, shadowViewers: 1 }), false);
        assert.equal(planOpenBlock({ half: "master", masterViewers: 0, shadowViewers: 0 }), false);
    });

    it("forgets viewers whose player is no longer online", () => {
        const viewers = new Set(["alice", "bob"]);

        assert.equal(dropOfflineViewers(viewers, new Set(["alice", "bob", "carol"])), 0);
        assert.deepEqual([...viewers], ["alice", "bob"]);

        assert.equal(dropOfflineViewers(viewers, new Set(["carol"])), 2);
        assert.deepEqual([...viewers], []);
    });
});

describe("Chest relocation helpers", () => {
    it("always puts the western chest first so part 0 is deterministic", () => {
        const east = { x: 12, z: 4 };
        const west = { x: 11, z: 4 };

        assert.deepEqual(orderPair(east, west), [west, east]);
        assert.deepEqual(orderPair(west, east), [west, east]);
    });

    it("lands the western inventory in slots 0-26 and the eastern one in 27-53", () => {
        const west = ["a", undefined, "b"];
        const east = [undefined, "c"];

        const merged = mergeContents(west, east);

        assert.equal(merged.length, 5);
        assert.deepEqual(merged.slice(0, 3), west);
        assert.deepEqual(merged.slice(3), east);
    });

    it("maps a part state onto the pair's master and shadow cells", () => {
        const west = { x: 5, y: 64, z: 5 };
        const east = { x: 6, y: 64, z: 5 };

        assert.deepEqual(resolveHalf(0, west), { half: "master", master: west, shadow: east });
        assert.deepEqual(resolveHalf(1, east), { half: "shadow", master: west, shadow: east });
    });

    it("refuses a part state that is not one of the two halves", () => {
        const location = { x: 0, y: 0, z: 0 };

        assert.equal(resolveHalf(2, location), undefined);
        assert.equal(resolveHalf(-1, location), undefined);
        assert.equal(resolveHalf(undefined, location), undefined);
    });

    it("keeps pair keys dimension aware", () => {
        const location = { x: 1, y: 2, z: 3 };

        assert.equal(pairKey("minecraft:overworld", location), "minecraft:overworld:1,2,3");
        assert.notEqual(
            pairKey("minecraft:overworld", location),
            pairKey("minecraft:the_nether", location)
        );
    });

    it("moves whole stacks into the destination's empty slots", () => {
        const plan = planPlacement(["a", undefined, "b"], [undefined, "c", undefined]);

        assert.deepEqual(plan.destination, ["a", "c", "b"]);
        assert.deepEqual(plan.source, [undefined, undefined, undefined]);
        assert.deepEqual(plan.moves, [{ from: 0, to: 0 }, { from: 2, to: 2 }]);
    });

    it("leaves stacks behind instead of dropping them when the destination is full", () => {
        const plan = planPlacement(["a", "b"], ["c", "d"]);

        assert.deepEqual(plan.destination, ["c", "d"]);
        assert.deepEqual(plan.source, ["a", "b"]);
        assert.deepEqual(plan.moves, []);
    });

    it("never splits or loses a stack", () => {
        const source = ["a", "b", "c"];
        const plan = planPlacement(source, [undefined, undefined]);
        const stacks = [...plan.source, ...plan.destination].filter(stack => stack !== undefined);

        assert.deepEqual(plan.moves.map(move => move.from), [0, 1], "a full destination stops the move mid-way");
        assert.deepEqual(stacks, ["c", "a", "b"], "every stack still exists exactly once");
    });

    it("reports whether a half holds anything at all", () => {
        assert.equal(hasAnyItem([undefined, undefined]), false);
        assert.equal(hasAnyItem([undefined, "a"]), true);
        assert.equal(hasAnyItem([]), false);
    });
});
