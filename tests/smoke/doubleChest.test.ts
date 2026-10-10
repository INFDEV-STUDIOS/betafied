import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    DOUBLE_CHEST_ID,
    DOUBLE_CHEST_SLOTS,
    INVERSE_DIRECTION,
    PAIR_LAYOUTS,
    PAIR_STATE_BY_LATCH,
    SINGLE_CHEST_ID,
    SINGLE_CHEST_SLOTS,
    chestOpenBlocked,
    clampSlots,
    dropOfflineViewers,
    hasAnyItem,
    mergeContents,
    pairKey,
    partHome,
    planChestPlacement,
    planClose,
    planOpen,
    planOpenBlock,
    planPair,
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

// The viewer's left when looking at the latch: the half that must own slots 0-26.
const VIEWER_LEFT: Record<string, { x: number; z: number }> = {
    south: { x: -1, z: 0 },
    north: { x: 1, z: 0 },
    east: { x: 0, z: 1 },
    west: { x: 0, z: -1 }
};

const NEIGHBOUR_OFFSETS = [
    { x: 1, y: 0, z: 0 },
    { x: -1, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 0, y: 0, z: -1 }
];

const LATCHES = ["north", "south", "east", "west"] as const;

function permutationFor(part: number, state: string): any {
    const condition = `q.block_state('minecraft:multi_block_part') == ${part} && q.block_state('minecraft:cardinal_direction') == '${state}'`;
    return doubleChest.permutations.find((p: any) => p.condition === condition);
}

describe("Classic Block Contract - Beta 1.7.3 double chest", () => {
    it("spans two blocks so the halves can share one inventory", () => {
        assert.equal(doubleChest.description.identifier, DOUBLE_CHEST_ID);
        assert.deepEqual(doubleChest.description.traits["minecraft:multi_block"], {
            enabled_states: ["minecraft:multi_block_part"],
            parts: 2,
            direction: "east"
        });

        // `direction` is only the fallback for a pair with no state to read: the trait hands the
        // part axis to cardinal_direction, which is what lets one block pair on either axis.
        assert.deepEqual(doubleChest.description.traits["minecraft:placement_direction"], {
            enabled_states: ["minecraft:cardinal_direction"]
        });
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

    it("dresses both halves for every layout the script can build", () => {
        assert.equal(doubleChest.permutations.length, 8, "two halves across four layouts");

        for (const [state, layout] of Object.entries(PAIR_LAYOUTS)) {
            const back = INVERSE_DIRECTION[layout.latch];

            for (const part of [0, 1]) {
                const permutation = permutationFor(part, state);
                assert.ok(permutation, `the ${state} layout is missing its part ${part} permutation`);

                const instances = permutation.components["minecraft:material_instances"];
                const half = part === 0 ? "left" : "right";

                assert.equal(
                    instances[layout.latch].texture,
                    `bh_chest_${half}_front`,
                    `${state} part ${part} must wear its ${half} face on the ${layout.latch} side`
                );
                assert.equal(instances[back].texture, `bh_chest_${half}_back`, `${state} part ${part} back`);
                assert.equal(instances["up"].texture, "bh_chest_top");
                assert.equal(instances["down"].texture, "bh_chest_top");
            }
        }
    });

    it("keeps every latch on a long face with part 0 on the viewer's left", () => {
        for (const [state, layout] of Object.entries(PAIR_LAYOUTS)) {
            const axis = layout.step.x !== 0 ? "x" : "z";
            const latchAxis = layout.latch === "east" || layout.latch === "west" ? "x" : "z";

            assert.notEqual(latchAxis, axis, `${state}: a latch cannot sit on the end the halves run toward`);
            assert.equal(PAIR_STATE_BY_LATCH[layout.latch], state, "the latch lookup must mirror the layouts");

            // Slots 0-26 belong to the left half, so part 1 has to run from part 0 toward the
            // viewer's right when they stand in front of the latch.
            const left = VIEWER_LEFT[layout.latch];
            assert.equal(
                layout.step.x * left.x + layout.step.z * left.z,
                -1,
                `${state}: part 0 must stay on the viewer's left`
            );
        }
    });

    it("inverts a layout by flipping its step", () => {
        for (const [state, layout] of Object.entries(PAIR_LAYOUTS)) {
            assert.deepEqual(
                PAIR_LAYOUTS[INVERSE_DIRECTION[state]].step,
                { x: 0 - layout.step.x, y: 0 - layout.step.y, z: 0 - layout.step.z },
                `${state} inverse`
            );
        }
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
    it("plans a pair for a chest placed beside the other on either axis", () => {
        // Latch north with the partner to the east: the halves run along x, so part 0 is the eastern
        // cell and the latches meet on the north face.
        assert.deepEqual(planPair("north", [{ offset: { x: 1, y: 0, z: 0 }, latch: "north" }]), {
            state: "west",
            latch: "north",
            masterOffset: { x: 1, y: 0, z: 0 }
        });

        // Latch east with the partner to the north: "north" lays part 1 to the north, which is the
        // neighbour, so the chest the player just placed is part 0.
        assert.deepEqual(planPair("east", [{ offset: { x: 0, y: 0, z: -1 }, latch: "east" }]), {
            state: "north",
            latch: "east",
            masterOffset: { x: 0, y: 0, z: 0 }
        });
    });

    it("puts part 0 on the cell the layout's step runs from", () => {
        const origin = { x: 0, y: 0, z: 0 };

        for (const latch of LATCHES) {
            for (const offset of NEIGHBOUR_OFFSETS) {
                const plan = planPair(latch, [{ offset, latch }]);
                assert.ok(plan, `${latch} beside ${offset.x},${offset.z} must pair`);

                const step = PAIR_LAYOUTS[plan.state].step;
                const master = plan.masterOffset;
                const shadow = { x: master.x + step.x, y: master.y + step.y, z: master.z + step.z };
                const other =
                    master.x === offset.x && master.y === offset.y && master.z === offset.z ? origin : offset;

                assert.equal(PAIR_LAYOUTS[plan.state].latch, plan.latch, "the layout must wear the planned latch");
                assert.deepEqual(shadow, other, "part 1 must be the other half of the pair");
            }
        }
    });

    it("takes the neighbour's latch when the placed chest's own latch is on the end", () => {
        assert.deepEqual(planPair("east", [{ offset: { x: 1, y: 0, z: 0 }, latch: "south" }]), {
            state: "east",
            latch: "south",
            masterOffset: { x: 0, y: 0, z: 0 }
        });
    });

    it("falls back to a readable side for two chests placed end to end", () => {
        // Latch north with the partner directly north leaves no latch on a long face at all.
        assert.deepEqual(planPair("north", [{ offset: { x: 0, y: 0, z: -1 }, latch: "north" }]), {
            state: "north",
            latch: "east",
            masterOffset: { x: 0, y: 0, z: 0 }
        });
    });

    it("prefers the partner that keeps the latch the placer just saw", () => {
        const plan = planPair("south", [
            { offset: { x: 0, y: 0, z: 1 }, latch: "east" },
            { offset: { x: -1, y: 0, z: 0 }, latch: "south" }
        ]);

        assert.equal(plan?.latch, "south");
        assert.equal(plan?.state, "east");
        assert.deepEqual(plan?.masterOffset, { x: -1, y: 0, z: 0 });
    });

    it("ignores anything that is not one step along an axis", () => {
        assert.equal(planPair("north", [{ offset: { x: 1, y: 0, z: 1 }, latch: "north" }]), undefined);
        assert.equal(planPair("north", [{ offset: { x: 0, y: 1, z: 0 }, latch: "north" }]), undefined);
        assert.equal(planPair("north", []), undefined);

        // Neither chest can offer a latch: the pair still forms on a readable side.
        assert.deepEqual(planPair(undefined, [{ offset: { x: 1, y: 0, z: 0 }, latch: undefined }]), {
            state: "east",
            latch: "south",
            masterOffset: { x: 0, y: 0, z: 0 }
        });
    });

    it("lands the left half's inventory in slots 0-26 and the right half's in 27-53", () => {
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

        assert.deepEqual(resolveHalf(0, west, "east"), { half: "master", master: west, shadow: east });
        assert.deepEqual(resolveHalf(1, east, "east"), { half: "shadow", master: west, shadow: east });
    });

    it("reads a pair running north to south the same way", () => {
        const south = { x: 2, y: 70, z: 9 };
        const north = { x: 2, y: 70, z: 8 };

        assert.deepEqual(resolveHalf(0, south, "north"), { half: "master", master: south, shadow: north });
        assert.deepEqual(resolveHalf(1, north, "north"), { half: "shadow", master: south, shadow: north });
    });

    it("refuses a part state that is not one of the two halves", () => {
        const location = { x: 0, y: 0, z: 0 };

        assert.equal(resolveHalf(2, location, "east"), undefined);
        assert.equal(resolveHalf(-1, location, "east"), undefined);
        assert.equal(resolveHalf(undefined, location, "east"), undefined);
        assert.equal(resolveHalf(0, location, undefined), undefined, "a half with no layout cannot be resolved");
        assert.equal(resolveHalf(0, location, "up"), undefined, "only the four cardinal layouts exist");
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

    it("finds the half the engine made part 0", () => {
        // The engine places the parts itself, so the merge has to read back which cell it made the
        // pair's home rather than assume the one the plan called the master.
        assert.equal(partHome(0, 1), "master");
        assert.equal(partHome(1, 0), "shadow");
        assert.equal(partHome("0", "1"), "master", "a part state read back as text still names its cell");
        assert.equal(partHome(0, 0), undefined, "two part 0s are not one pair");
        assert.equal(partHome(1, 1), undefined, "two part 1s are not one pair");
        assert.equal(partHome(undefined, 1), undefined);
        assert.equal(partHome(0, undefined), undefined);
    });

    it("lets a chest stand alone or beside a single it can pair with", () => {
        assert.equal(planChestPlacement([]), true, "a chest with no neighbour becomes a single");
        assert.equal(
            planChestPlacement([SINGLE_CHEST_ID]),
            true,
            "one single neighbour is the other half of the pair"
        );
        // Only the horizontal face neighbours are judged; a non-chest block never matters.
        assert.equal(planChestPlacement(["minecraft:stone", "minecraft:air"]), true);
    });

    it("refuses a chest that would not become part of a pair", () => {
        // Two singles beside the new cell means only one can pair, leaving the other touching a
        // chest it is not half of - a dangling neighbour the era refused outright.
        assert.equal(planChestPlacement([SINGLE_CHEST_ID, SINGLE_CHEST_ID]), false);
        // A neighbour that is already half of a large chest can never take a second partner, which is
        // why two large chests may not touch.
        assert.equal(planChestPlacement([DOUBLE_CHEST_ID]), false);
        assert.equal(planChestPlacement([SINGLE_CHEST_ID, DOUBLE_CHEST_ID]), false);
        assert.equal(planChestPlacement([DOUBLE_CHEST_ID, DOUBLE_CHEST_ID]), false);
    });

    it("refuses to open a chest with a block resting on it", () => {
        assert.equal(chestOpenBlocked({ placing: false, aboveSolid: true }), true);
        assert.equal(chestOpenBlocked({ placing: false, aboveSolid: false }), false);
        assert.equal(
            chestOpenBlocked({ placing: true, aboveSolid: true }),
            false,
            "a crouched item being placed against the face is not the chest being opened"
        );
    });

    it("clamps slot work to the count the container actually reports", () => {
        // A half that kept the 27 slots of the single it was converted from must not be read past
        // slot 26: every slot the pair touches is bounded by the container's own size.
        assert.equal(clampSlots(DOUBLE_CHEST_SLOTS, SINGLE_CHEST_SLOTS), SINGLE_CHEST_SLOTS);
        assert.equal(clampSlots(SINGLE_CHEST_SLOTS, DOUBLE_CHEST_SLOTS), SINGLE_CHEST_SLOTS);
        assert.equal(clampSlots(DOUBLE_CHEST_SLOTS, DOUBLE_CHEST_SLOTS), DOUBLE_CHEST_SLOTS);
        assert.equal(clampSlots(DOUBLE_CHEST_SLOTS, undefined), 0, "a container with no readable size is never addressed");
        assert.equal(clampSlots(DOUBLE_CHEST_SLOTS, 0), 0);
    });
});
