import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mockPlayers } from "../mocks/minecraftServer.js";
import {
    consumeStep,
    cropDropsFor,
    cropTramplingJob,
    isFenceBlock,
    resolveTrampleTarget,
    tileKey,
    walkedBlockLocation,
    type WalkState
} from "../../packs/BP/scripts/interactions/cropTrampling.js";
import { eventBus } from "../../packs/BP/scripts/core/eventBus.js";
import { tickManager } from "../../packs/BP/scripts/core/tickManager.js";

interface FakeBlockState {
    typeId: string;
    states?: Record<string, string | number>;
}

function fakePermutation(state: FakeBlockState) {
    const states = { ...(state.states ?? {}) };
    return {
        typeId: state.typeId,
        states,
        getState(key: string) {
            return states[key];
        },
        withState(key: string, value: string | number) {
            return fakePermutation({ typeId: state.typeId, states: { ...states, [key]: value } });
        }
    };
}

/**
 * A block store that records what the handler asked it to become.
 *
 * Unregistered coordinates answer `minecraft:air`, which is what the cells above a farm hold and what
 * a downward scan has to read past, so a fixture only has to name the blocks its case is about.
 */
function fakeDimension(options: { blocks?: Record<string, FakeBlockState | string>; throwOnBlock?: boolean } = {}) {
    const store = new Map<string, FakeBlockState>();
    for (const [key, value] of Object.entries(options.blocks ?? {})) {
        store.set(key, typeof value === "string" ? { typeId: value } : value);
    }

    const sets: { location: string; typeId: string }[] = [];
    /** Items the module put on the floor, so a case can assert the drop it paid out. */
    const spawned: { typeId: string; amount: number }[] = [];
    const dimension = {
        id: "minecraft:overworld",
        store,
        sets,
        spawned,
        /** Block reads this dimension has served, so a case can hold the guard to a read budget. */
        reads: 0,
        mobile: [] as any[],
        drops: [] as any[],
        spawnItem(item: { typeId: string; amount: number }) {
            spawned.push({ typeId: item.typeId, amount: item.amount });
            return { id: `mock_item_${spawned.length}`, typeId: "minecraft:item" };
        },
        getBlock(location: { x: number; y: number; z: number }) {
            if (options.throwOnBlock) throw new Error("Unloaded chunk");
            dimension.reads += 1;
            const key = `${location.x},${location.y},${location.z}`;
            const state = store.get(key) ?? { typeId: "minecraft:air" };
            return {
                typeId: state.typeId,
                permutation: fakePermutation(state),
                setType(typeId: string) {
                    sets.push({ location: key, typeId });
                    store.set(key, { typeId });
                },
                setPermutation(permutation: { typeId: string; states?: Record<string, string | number> }) {
                    sets.push({ location: key, typeId: permutation.typeId });
                    store.set(key, { typeId: permutation.typeId, states: permutation.states });
                }
            };
        },
        getEntities(query?: { type?: string }) {
            if (query?.type === "minecraft:item") return dimension.drops;
            return dimension.mobile;
        }
    };
    return dimension;
}

/** A dropped stack the restore path is expected to sweep up. */
function fakeDrop(stackId: string) {
    return {
        isValid: true,
        removed: false,
        remove() {
            this.removed = true;
        },
        getComponent(componentId: string) {
            return componentId === "minecraft:item" ? { itemStack: { typeId: stackId } } : undefined;
        }
    };
}

let walkerSequence = 0;

function fakeWalker(
    name: string,
    dimension: ReturnType<typeof fakeDimension>,
    feet = { x: 0.5, y: 64, z: 0.5 },
    options: { riding?: boolean } = {}
) {
    return {
        id: `${name}#${walkerSequence++}`,
        name,
        isValid: true,
        location: { ...feet },
        isSneaking: false,
        isOnGround: true,
        riding: options.riding ?? false,
        gameMode: "survival",
        getGameMode() {
            return this.gameMode;
        },
        getComponent(componentId: string) {
            return componentId === "minecraft:riding" && this.riding ? { entityRidingOn: {} } : undefined;
        },
        dimension
    };
}

/** Moves the entity and runs one pass, which is what one tick of Beta's `moveEntity` amounts to. */
function walk(walker: { location: { x: number; z: number } }, dx: number, dz = 0): void {
    walker.location.x += dx;
    walker.location.z += dz;
    cropTramplingJob();
}

function withTrampleRoll(body: () => void): void {
    const original = Math.random;
    // `rand.nextInt(4) == 0`: a zero roll takes the trample, so a case only has to prove eligibility.
    Math.random = () => 0;
    try {
        body();
    } finally {
        Math.random = original;
    }
}

/**
 * The other half of the same control, and what makes the landing cases trustworthy: a case that asserts
 * a tile *came back* must not also be able to lose it to the walking rule's 1-in-4 roll. Left unowned,
 * the roll decides those cases at random — the assertion sees dirt and reports a failed guard that never
 * failed. The step clock keeps running either way, so the pass under test is still a real pass.
 */
function withoutTrampleRoll(body: () => void): void {
    const original = Math.random;
    Math.random = () => 0.99;
    try {
        body();
    } finally {
        Math.random = original;
    }
}

function pacingWalk(walker: { location: { x: number; z: number } }): void {
    // The steps stay inside one block on purpose: Beta resolves the walked block *after* the move, so
    // a step that carries the walker over a boundary asks about the tile being entered.
    for (let i = 0; i < 40; i++) walk(walker, 0.2, i % 2 === 0 ? 0.2 : -0.2);
}

function freshState(): WalkState {
    return { lastX: 0, lastZ: 0, distance: 0, nextStep: 0, lastSeen: 0 };
}

/** What the engine does inside its own tick, with no script hook in front of it. */
function engineTramples(dimension: ReturnType<typeof fakeDimension>, location: { x: number; y: number; z: number }) {
    dimension.store.set(`${location.x},${location.y},${location.z}`, { typeId: "minecraft:dirt" });
    dimension.store.set(`${location.x},${location.y + 1},${location.z}`, { typeId: "minecraft:air" });
}

function land(walker: { location: { x: number; y: number }; isOnGround: boolean }, y = 64): void {
    walker.location.y = y;
    walker.isOnGround = true;
}

describe("Beta farmland trampling - stepping rules", () => {
    it("resolves the walked block from the feet, offset by 0.2", () => {
        // Beta asked for `floor(posY - 0.2)`: standing on farmland at Y=63 puts the feet at 64, which
        // is the crop block, so the question has to fall back onto the farmland the crop grows in.
        assert.equal(walkedBlockLocation(0.5, 64, 0.5).y, 63);
        assert.equal(walkedBlockLocation(0.5, 64.3, 0.5).y, 64);
        assert.deepEqual(walkedBlockLocation(1.9, 64, -0.4), { x: 1, y: 63, z: -1 });
    });

    it("fires one step per 1/0.6 blocks of horizontal travel", () => {
        const state = freshState();

        assert.equal(consumeStep(state, 0.1), true, "the first movement past the zeroed counter is a step");
        assert.equal(consumeStep(state, 1), false);
        assert.equal(consumeStep(state, 1), true, "the next step lands 1.667 blocks later");
    });

    it("counts a large move as a single step", () => {
        const state = freshState();

        assert.equal(consumeStep(state, 40), true);
        assert.equal(state.nextStep, 1, "Beta raised the counter by one per step, however far the move went");
    });

    it("keeps the fence family and nothing else", () => {
        assert.equal(isFenceBlock("bh:fence"), true);
        assert.equal(isFenceBlock("minecraft:fence"), true);
        assert.equal(isFenceBlock("minecraft:oak_fence"), true);
        assert.equal(isFenceBlock("minecraft:nether_brick_fence"), true);
        assert.equal(isFenceBlock("minecraft:oak_fence_gate"), false, "1.7.3 knew only the fence block");
        assert.equal(isFenceBlock("minecraft:farmland"), false);
    });

    it("tramples farmland and refuses the fence-protected tile", () => {
        const bare = fakeDimension({ blocks: { "0,63,0": "minecraft:farmland" } });
        const fenced = fakeDimension({
            blocks: { "0,63,0": "minecraft:farmland", "0,62,0": "minecraft:oak_fence" }
        });
        const stone = fakeDimension();

        assert.ok(resolveTrampleTarget(bare as never, { x: 0, y: 63, z: 0 }), "bare farmland is trampleable");
        assert.equal(
            resolveTrampleTarget(fenced as never, { x: 0, y: 63, z: 0 }),
            undefined,
            "a fence under the farmland replaces the walked block in Beta, so nothing tramples"
        );
        assert.equal(resolveTrampleTarget(stone as never, { x: 0, y: 63, z: 0 }), undefined);
    });

    it("pays the era's wheat drop, from the era's own roll", () => {
        // `idDropped(meta) -> meta == 7 ? Item.wheat : -1`, then three `nextInt(15) <= meta` seed rolls.
        assert.deepEqual(
            cropDropsFor("minecraft:wheat", 7, () => 0),
            [
                { typeId: "minecraft:wheat", amount: 1 },
                { typeId: "minecraft:wheat_seeds", amount: 3 }
            ],
            "a zero roll takes all three seed rolls, and a ripe crop pays one wheat"
        );

        assert.deepEqual(
            cropDropsFor("minecraft:wheat", 7, () => 0.99),
            [{ typeId: "minecraft:wheat", amount: 1 }],
            "roll 14 fails the `<= 7` test, so a ripe crop can pay no seeds at all"
        );

        assert.deepEqual(
            cropDropsFor("minecraft:wheat", 0, () => 0),
            [{ typeId: "minecraft:wheat_seeds", amount: 3 }],
            "an unripe crop pays no wheat: the era's base drop answered -1"
        );

        assert.deepEqual(
            cropDropsFor("minecraft:wheat", 0, () => 0.99),
            [],
            "and an unripe crop with unlucky rolls pays nothing, unlike modern versions"
        );
    });

    it("leaves a crop the era never had to the compatibility policy", () => {
        assert.equal(
            cropDropsFor("minecraft:carrots", 7, () => 0),
            undefined,
            "carrots arrived after 1.7.3, so their drops are not this module's fact to model"
        );
    });

    it("keys watched tiles by dimension as well as coordinates", () => {
        assert.notEqual(
            tileKey("minecraft:overworld", { x: 0, y: 63, z: 0 }),
            tileKey("minecraft:nether", { x: 0, y: 63, z: 0 }),
            "the Overworld and the Nether share coordinates, and the tile keys must not"
        );
    });
});

/**
 * Wiring only. `getBlock` answers from the fixture, so a pass here says the handler agrees with our
 * own assumptions about the engine, not that Bedrock resolves the feet block this way or that a
 * landing really converts the tile. The engine half is checked in game, not here.
 */
describe("Beta farmland trampling - walking", () => {
    beforeEach(() => {
        mockPlayers.length = 0;
    });

    it("turns the walked farmland into dirt", () => {
        const dimension = fakeDimension({
            blocks: { "0,63,0": "minecraft:farmland", "0,64,0": "minecraft:wheat" }
        });
        const farmer = fakeWalker("farmer", dimension);
        mockPlayers.push(farmer);

        withTrampleRoll(() => {
            // The first pass only establishes the baseline: an entity's pre-move position is not
            // observable, so its first observed tick banks no distance.
            cropTramplingJob();
            walk(farmer, 0.2);
        });

        assert.equal(dimension.store.get("0,63,0")?.typeId, "minecraft:dirt");
    });

    it("takes the crop down with the farmland", () => {
        const dimension = fakeDimension({
            blocks: {
                "0,63,0": "minecraft:farmland",
                "0,64,0": { typeId: "minecraft:wheat", states: { growth: 7 } }
            }
        });
        const farmer = fakeWalker("farmer", dimension);
        mockPlayers.push(farmer);

        withTrampleRoll(() => {
            cropTramplingJob();
            walk(farmer, 0.2);
        });

        assert.equal(dimension.store.get("0,63,0")?.typeId, "minecraft:dirt");
        assert.equal(
            dimension.store.get("0,64,0")?.typeId,
            "minecraft:air",
            "a plant left standing on dirt is the visible half of the trample"
        );
        assert.deepEqual(
            dimension.spawned.map((drop) => drop.typeId),
            ["minecraft:wheat", "minecraft:wheat_seeds"],
            "the crop pays the era's drop, not nothing and not the modern loot table's"
        );
    });

    it("leaves a post-Beta crop standing on the dirt", () => {
        // The module breaks the crops it knows the era's drop for and nothing else: a carrot crop is
        // post-Beta, and removing it belongs to the compatibility policy rather than to trampling.
        const dimension = fakeDimension({
            blocks: {
                "0,63,0": "minecraft:farmland",
                "0,64,0": { typeId: "minecraft:carrots", states: { growth: 7 } }
            }
        });
        const farmer = fakeWalker("farmer", dimension);
        mockPlayers.push(farmer);

        withTrampleRoll(() => {
            cropTramplingJob();
            walk(farmer, 0.2);
        });

        assert.equal(dimension.store.get("0,64,0")?.typeId, "minecraft:carrots");
        assert.deepEqual(dimension.spawned, []);
    });

    it("never tramples a farm whose farmland sits on a fence", () => {
        const dimension = fakeDimension({
            blocks: { "0,63,0": "minecraft:farmland", "0,62,0": "bh:fence", "0,64,0": "minecraft:wheat" }
        });
        const farmer = fakeWalker("farmer", dimension);
        mockPlayers.push(farmer);

        withTrampleRoll(() => pacingWalk(farmer));

        assert.equal(dimension.store.get("0,63,0")?.typeId, "minecraft:farmland");
        assert.deepEqual(dimension.sets, [], "the old farm-on-fences trick has to hold against many steps");
    });

    it("does not read a fence gate under the farmland as protection", () => {
        // Beta's step callback compared the block below against the fence block specifically. Placed
        // gates retype onto `bh:fence` and so do protect; a gate that terrain or a command left vanilla
        // is not the block the era tested.
        const dimension = fakeDimension({
            blocks: { "0,63,0": "minecraft:farmland", "0,62,0": "minecraft:oak_fence_gate" }
        });
        const farmer = fakeWalker("farmer", dimension);
        mockPlayers.push(farmer);

        withTrampleRoll(() => pacingWalk(farmer));

        assert.equal(dimension.store.get("0,63,0")?.typeId, "minecraft:dirt");
    });

    it("skips the walking callback while the walker is sneaking on the ground", () => {
        const dimension = fakeDimension({ blocks: { "0,63,0": "minecraft:farmland" } });
        const farmer = fakeWalker("farmer", dimension);
        farmer.isSneaking = true;
        mockPlayers.push(farmer);

        withTrampleRoll(() => pacingWalk(farmer));

        assert.deepEqual(dimension.sets, [], "Beta skipped the callback outright, distance accumulation included");
    });

    it("still counts a sneaking walker that is airborne", () => {
        // Beta's guard was `onGround && isSneaking`; a sneaking entity in mid-air was not exempt.
        const dimension = fakeDimension({ blocks: { "0,63,0": "minecraft:farmland" } });
        const farmer = fakeWalker("farmer", dimension);
        farmer.isSneaking = true;
        farmer.isOnGround = false;
        mockPlayers.push(farmer);

        withTrampleRoll(() => {
            cropTramplingJob();
            walk(farmer, 0.2);
        });

        assert.equal(dimension.store.get("0,63,0")?.typeId, "minecraft:dirt");
    });

    it("lets a rider cross a farm without trampling it", () => {
        // Beta's step callback carried `ridingEntity == null`: the mount walks and tramples on its own
        // account, the rider does not add a trample on top of it.
        const dimension = fakeDimension({ blocks: { "0,63,0": "minecraft:farmland" } });
        const rider = fakeWalker("rider", dimension, undefined, { riding: true });
        mockPlayers.push(rider);

        withTrampleRoll(() => pacingWalk(rider));

        assert.deepEqual(dimension.sets, [], "a mounted entity trampled farmland with its own feet");
    });

    it("leaves Creative and Spectator players alone", () => {
        for (const gameMode of ["creative", "spectator"]) {
            const dimension = fakeDimension({ blocks: { "0,63,0": "minecraft:farmland" } });
            const builder = fakeWalker(`builder-${gameMode}`, dimension);
            builder.gameMode = gameMode;
            mockPlayers.push(builder);

            withTrampleRoll(() => {
                cropTramplingJob();
                walk(builder, 0.2);
            });

            assert.deepEqual(dimension.sets, [], `${gameMode} has no Beta counterpart to trample in`);
        }
    });

    it("keeps serving other walkers when a block lookup raises", () => {
        const unloaded = fakeDimension({ throwOnBlock: true });
        const stranded = fakeWalker("stranded", unloaded);
        const farmed = fakeDimension({ blocks: { "0,63,0": "minecraft:farmland" } });
        const farmer = fakeWalker("farmer", farmed);
        mockPlayers.push(stranded, farmer);

        withTrampleRoll(() => {
            assert.doesNotThrow(() => walk(stranded, 0.2), "an unloaded chunk is not a reason to drop the pass");
            walk(farmer, 0.2);
        });

        assert.equal(farmed.store.get("0,63,0")?.typeId, "minecraft:dirt");
    });

    it("does not count a teleport as walked distance", () => {
        const dimension = fakeDimension({ blocks: { "20,63,0": "minecraft:farmland" } });
        const farmer = fakeWalker("farmer", dimension);
        mockPlayers.push(farmer);

        withTrampleRoll(() => {
            cropTramplingJob();
            walk(farmer, 0.2);
            farmer.location.x = 20.5;
            cropTramplingJob();
        });

        assert.equal(dimension.store.get("20,63,0")?.typeId, "minecraft:farmland", "arriving is not a step");
    });

    it("tramples under mobs, not only under players", () => {
        const dimension = fakeDimension({
            blocks: {
                "1,63,0": "minecraft:farmland",
                "2,63,0": "minecraft:farmland",
                "3,63,0": "minecraft:farmland",
                "4,63,0": "minecraft:farmland"
            }
        });
        // The player is parked well above the farm, so the cow is the only walker in the case.
        const farmer = fakeWalker("farmer", dimension, { x: 4.5, y: 100, z: 0.5 });
        const cow = fakeWalker("cow", dimension, { x: 0.5, y: 64, z: 0.5 });
        dimension.mobile.push(cow);
        mockPlayers.push(farmer);

        withTrampleRoll(() => {
            // Two passes per step: the mob sweep only runs every other one, so each round is guaranteed
            // a sweep against a moved cow without the case depending on where the sweep phase started.
            for (let i = 0; i < 6; i++) {
                walk(cow, 0.5);
                cropTramplingJob();
            }
        });

        const trampled = ["1,63,0", "2,63,0", "3,63,0"].filter(
            (key) => dimension.store.get(key)?.typeId === "minecraft:dirt"
        );
        assert.ok(
            trampled.length > 0,
            `an animal crossing a row has to trample the farmland it walks on, got: ${[...dimension.store.keys()].join(" | ")}`
        );
        assert.equal(dimension.store.get("4,63,0")?.typeId, "minecraft:farmland", "a farm nobody walks on is untouched");
    });
});

/**
 * Wiring only, and this half is the one that cannot be proven offline: nothing here shows that Bedrock
 * converts the tile on a landing at all. The cases assert the shape of the correction — what gets put
 * back, and what is deliberately left alone.
 */
describe("Beta farmland trampling - landings", () => {
    beforeEach(() => {
        mockPlayers.length = 0;
    });

    it("puts back the farmland and its crop when something lands on them", () => {
        const dimension = fakeDimension({
            blocks: {
                "0,63,0": { typeId: "minecraft:farmland", states: { moisturized_amount: 7 } },
                "0,64,0": { typeId: "minecraft:wheat", states: { growth: 4 } }
            }
        });
        const drop = fakeDrop("minecraft:wheat_seeds");
        dimension.drops.push(drop);
        // Airborne well above the farm: this is the pass that has to notice what it is falling onto.
        const farmer = fakeWalker("farmer", dimension, { x: 0.5, y: 66, z: 0.5 });
        farmer.isOnGround = false;
        mockPlayers.push(farmer);

        cropTramplingJob();
        engineTramples(dimension, { x: 0, y: 63, z: 0 });
        land(farmer);
        withoutTrampleRoll(() => walk(farmer, 0.1));

        assert.deepEqual(
            dimension.store.get("0,63,0"),
            { typeId: "minecraft:farmland", states: { moisturized_amount: 7 } },
            "the moisture the farmland had before the landing has to come back with it"
        );
        assert.deepEqual(
            dimension.store.get("0,64,0"),
            { typeId: "minecraft:wheat", states: { growth: 4 } },
            "a crop put back at a lower growth stage would be a visible regression"
        );
        assert.equal(drop.removed, true, "the restored crop must not also leave a free harvest behind");
    });

    it("watches the column a sprint-jump is about to cross into", () => {
        const dimension = fakeDimension({
            blocks: {
                "0,63,0": "minecraft:farmland",
                "1,63,0": { typeId: "minecraft:farmland", states: { moisturized_amount: 3 } },
                "1,64,0": { typeId: "minecraft:wheat", states: { growth: 7 } }
            }
        });
        const farmer = fakeWalker("farmer", dimension, { x: 0.6, y: 66, z: 0.5 });
        farmer.isOnGround = false;
        mockPlayers.push(farmer);

        cropTramplingJob();
        walk(farmer, 0.1);
        engineTramples(dimension, { x: 1, y: 63, z: 0 });
        farmer.location.x = 1.5;
        land(farmer);
        walk(farmer, 0.1);

        assert.equal(
            dimension.store.get("1,63,0")?.typeId,
            "minecraft:farmland",
            "the landing tick can be the tick the entity crosses a block boundary"
        );
    });

    it("puts the farm back even when the entity never reports itself airborne", () => {
        // `Entity.isOnGround` is documented to behave unexpectedly, so the guard must not gate the
        // snapshot on it: here the entity claims to be grounded for every pass of the jump.
        const dimension = fakeDimension({
            blocks: {
                "0,63,0": { typeId: "minecraft:farmland", states: { moisturized_amount: 4 } },
                "0,64,0": { typeId: "minecraft:wheat", states: { growth: 2 } }
            }
        });
        const farmer = fakeWalker("farmer", dimension);
        mockPlayers.push(farmer);

        cropTramplingJob();
        engineTramples(dimension, { x: 0, y: 63, z: 0 });
        cropTramplingJob();

        assert.deepEqual(dimension.store.get("0,63,0"), { typeId: "minecraft:farmland", states: { moisturized_amount: 4 } });
        assert.deepEqual(dimension.store.get("0,64,0"), { typeId: "minecraft:wheat", states: { growth: 2 } });
    });

    it("spends one read a pass on a grounded entity that is not over a farm", () => {
        // The guard reads every pass now, so the cost of the common case is a contract, not a detail:
        // a stationary entity on ordinary ground must cost a single block read, because the cell under
        // its feet is the block it stands on and the scan stops there.
        const dimension = fakeDimension({ blocks: { "0,63,0": "minecraft:stone" } });
        const farmer = fakeWalker("farmer", dimension);
        mockPlayers.push(farmer);

        cropTramplingJob();
        const afterFirstPass = dimension.reads;
        cropTramplingJob();

        assert.equal(afterFirstPass, 1, "the first pass reads the cell under the feet and stops there");
        assert.equal(dimension.reads - afterFirstPass, 1, "so does every pass after it");
    });

    it("serves the landing guard to a Creative player", () => {
        // The engine tramples farmland in Creative exactly as it does in Survival, so the guard may not be
        // gated on a mode: the era drew no such line, and a builder jumping on their own farm is the case
        // that found this. Only the walking rule stays out of Creative, because that half is our addition.
        const dimension = fakeDimension({
            blocks: {
                "0,63,0": { typeId: "minecraft:farmland", states: { moisturized_amount: 7 } },
                "0,64,0": "minecraft:wheat"
            }
        });
        const builder = fakeWalker("builder", dimension, { x: 0.5, y: 66, z: 0.5 });
        builder.isOnGround = false;
        builder.gameMode = "creative";
        mockPlayers.push(builder);

        cropTramplingJob();
        engineTramples(dimension, { x: 0, y: 63, z: 0 });
        land(builder);
        cropTramplingJob();

        assert.deepEqual(
            dimension.store.get("0,63,0"),
            { typeId: "minecraft:farmland", states: { moisturized_amount: 7 } },
            "a Creative player's farm gets corrected like anyone else's"
        );
    });

    it("keeps the landing guard running when the walking half raises", () => {
        // The guard is the half that keeps a farm alive, so it must not sit behind anything the walking
        // half needs. `isOnGround` is the walking half's first read and is documented to behave
        // unexpectedly; if it throws, the correction still has to happen.
        const dimension = fakeDimension({
            blocks: {
                "0,63,0": { typeId: "minecraft:farmland", states: { moisturized_amount: 7 } },
                "0,64,0": "minecraft:wheat"
            }
        });
        const farmer = fakeWalker("farmer", dimension);
        mockPlayers.push(farmer);

        // First pass records the watch while the walking half still reads.
        cropTramplingJob();
        Object.defineProperty(farmer, "isOnGround", {
            get() {
                throw new Error("isOnGround raised");
            }
        });

        engineTramples(dimension, { x: 0, y: 63, z: 0 });
        cropTramplingJob();

        assert.deepEqual(
            dimension.store.get("0,63,0"),
            { typeId: "minecraft:farmland", states: { moisturized_amount: 7 } },
            "a throw in the walking half is not allowed to cost the pass its correction"
        );
        assert.deepEqual(dimension.store.get("0,64,0"), { typeId: "minecraft:wheat", states: {} });
    });

    it("watches the columns a fast fall crosses in one pass", () => {
        const dimension = fakeDimension({
            blocks: {
                "2,63,0": { typeId: "minecraft:farmland", states: { moisturized_amount: 5 } },
                "2,64,0": { typeId: "minecraft:wheat", states: { growth: 6 } }
            }
        });
        const farmer = fakeWalker("farmer", dimension, { x: 1.1, y: 66, z: 0.5 });
        farmer.isOnGround = false;
        mockPlayers.push(farmer);

        cropTramplingJob();
        // A whole block of travel between two passes, which is more than the column under it.
        farmer.location.x = 2.2;
        withoutTrampleRoll(() => cropTramplingJob());

        engineTramples(dimension, { x: 2, y: 63, z: 0 });
        farmer.location.x = 2.5;
        land(farmer);
        cropTramplingJob();

        assert.equal(dimension.store.get("2,63,0")?.typeId, "minecraft:farmland");
        assert.deepEqual(dimension.store.get("2,64,0"), { typeId: "minecraft:wheat", states: { growth: 6 } });
    });

    it("leaves the tile alone when the landing is the era's own trample", () => {
        const dimension = fakeDimension({ blocks: { "0,63,0": "minecraft:farmland" } });
        const farmer = fakeWalker("farmer", dimension, { x: 0.5, y: 66, z: 0.5 });
        farmer.isOnGround = false;
        mockPlayers.push(farmer);

        cropTramplingJob();
        land(farmer);

        withTrampleRoll(() => walk(farmer, 0.2));

        assert.equal(
            dimension.store.get("0,63,0")?.typeId,
            "minecraft:dirt",
            "walking is supposed to cost the player their farmland, so supervision must not undo it"
        );
    });

    it("does not fight a player who replaced the tile themselves", () => {
        const dimension = fakeDimension({ blocks: { "0,63,0": "minecraft:farmland" } });
        const farmer = fakeWalker("farmer", dimension, { x: 0.5, y: 66, z: 0.5 });
        farmer.isOnGround = false;
        mockPlayers.push(farmer);

        cropTramplingJob();
        eventBus.dispatch("playerPlaceBlock", {
            block: { location: { x: 0, y: 63, z: 0 } },
            player: farmer
        });

        engineTramples(dimension, { x: 0, y: 63, z: 0 });
        land(farmer);
        withoutTrampleRoll(() => walk(farmer, 0.1));

        assert.equal(dimension.store.get("0,63,0")?.typeId, "minecraft:dirt", "the placed block is the player's");
    });

    it("stops watching a tile once the entity has walked away from it", () => {
        // Standing over a farm keeps its watch alive pass after pass. Leaving is what starts the clock,
        // and an expired watch must not resurrect a tile the entity is no longer anywhere near.
        const dimension = fakeDimension({
            blocks: { "0,63,0": "minecraft:farmland", "20,63,0": "minecraft:stone" }
        });
        const farmer = fakeWalker("farmer", dimension);
        mockPlayers.push(farmer);

        // Driven through the scheduler so the tile key's clock actually advances.
        tickManager.step();
        farmer.location.x = 20.5;
        for (let tick = 0; tick < 40; tick++) tickManager.step();

        engineTramples(dimension, { x: 0, y: 63, z: 0 });
        tickManager.step();

        assert.equal(dimension.store.get("0,63,0")?.typeId, "minecraft:dirt", "a stale watch must not resurrect dirt");
    });

    it("is not watching a farm that a solid block stands between the fall and", () => {
        const dimension = fakeDimension({
            blocks: { "0,63,0": "minecraft:farmland", "0,64,0": "minecraft:stone" }
        });
        const farmer = fakeWalker("farmer", dimension, { x: 0.5, y: 67, z: 0.5 });
        farmer.isOnGround = false;
        mockPlayers.push(farmer);

        cropTramplingJob();
        engineTramples(dimension, { x: 0, y: 63, z: 0 });
        land(farmer, 65);
        walk(farmer, 0.1);

        assert.equal(
            dimension.store.get("0,63,0")?.typeId,
            "minecraft:dirt",
            "an entity lands on the stone, so the farmland below it is not what it fell onto"
        );
    });
});
