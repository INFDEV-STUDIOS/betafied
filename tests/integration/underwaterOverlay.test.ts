import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mockPlayers } from "../mocks/minecraftServer.js";
import {
    CLEAR_SENTINEL,
    UNDERWATER_SENTINEL,
    isHeadSubmerged,
    underwaterOverlayJob
} from "../../packs/BP/scripts/world/underwaterOverlay.js";
import { eventBus } from "../../packs/BP/scripts/core/eventBus.js";

interface FakeBlock {
    typeId: string;
    isLiquid: boolean;
}

interface FakePlayerOptions {
    headBlock?: FakeBlock;
    throwOnHeadQuery?: boolean;
    /** Pin the id when a test needs the same player across a rejoin. */
    id?: string;
}

let playerSequence = 0;

function fakePlayer(name: string, options: FakePlayerOptions = {}) {
    const titles: string[] = [];

    return {
        name,
        // Ids are unique per player unless a test pins one: the driver tracks tinted players by id
        // across passes, so a reused id would carry a previous test's tint into the next one.
        id: options.id ?? `${name}#${playerSequence++}`,
        isValid: true,
        location: { x: 0, y: 64, z: 0 },
        /** Every title this player was sent, in order. */
        titles,
        /** Whether this player is tinted right now, read back off the last title they were sent. */
        get tinted() {
            return titles[titles.length - 1] === UNDERWATER_SENTINEL;
        },
        getHeadLocation() {
            if (options.throwOnHeadQuery) throw new Error("InvalidEntityError");
            return { x: 0.5, y: 65.62, z: 0.5 };
        },
        dimension: {
            id: "minecraft:overworld",
            // Real dimensions expose heightRange; the driver settles out-of-world heads against it
            // before it would ever reach getBlock.
            heightRange: { min: -64, max: 319 },
            getBlock() {
                return options.headBlock;
            }
        },
        onScreenDisplay: {
            setTitle(text: string) {
                titles.push(text);
            }
        }
    };
}

/** The titles that turn the tint on, ignoring the re-asserts. */
function sentinels(player: { titles: string[] }): string[] {
    return player.titles.filter((title) => title === UNDERWATER_SENTINEL);
}

function clears(player: { titles: string[] }): string[] {
    return player.titles.filter((title) => title === CLEAR_SENTINEL);
}

function drainJob(runs: number): void {
    for (let i = 0; i < runs; i++) underwaterOverlayJob();
}

describe("Beta Water Screen Tint - sentinel driver", () => {
    beforeEach(() => {
        mockPlayers.length = 0;
    });

    it("reads the water state from the head block, not from the feet", () => {
        const submerged = fakePlayer("diver", {
            headBlock: { typeId: "minecraft:water", isLiquid: true }
        }) as any;
        const wading = fakePlayer("wader", {
            headBlock: { typeId: "minecraft:air", isLiquid: false }
        }) as any;

        assert.equal(isHeadSubmerged(submerged), true, "a submerged head must read as under water");
        assert.equal(isHeadSubmerged(wading), false, "standing in shallow water must not tint the screen");
    });

    it("sends the sentinel only while the player is submerged", () => {
        const diver = fakePlayer("diver", {
            headBlock: { typeId: "minecraft:water", isLiquid: true }
        });
        const wader = fakePlayer("wader", {
            headBlock: { typeId: "minecraft:air", isLiquid: false }
        });
        mockPlayers.push(diver, wader);

        underwaterOverlayJob();

        assert.deepEqual(sentinels(diver), [UNDERWATER_SENTINEL]);
        assert.deepEqual(wader.titles, [], "a dry player must never receive the sentinel");
    });

    it("tints for flowing water and leaves lava alone", () => {
        const flowing = fakePlayer("flowing", {
            headBlock: { typeId: "minecraft:flowing_water", isLiquid: true }
        });
        const lava = fakePlayer("lava", {
            headBlock: { typeId: "minecraft:lava", isLiquid: true }
        });
        mockPlayers.push(flowing, lava);

        underwaterOverlayJob();

        assert.equal(sentinels(flowing).length, 1);
        assert.deepEqual(lava.titles, [], "Beta only tinted the screen for water");
    });

    it("keeps serving other players when one lookup throws", () => {
        const broken = fakePlayer("broken", { throwOnHeadQuery: true });
        const diver = fakePlayer("diver", {
            headBlock: { typeId: "minecraft:water", isLiquid: true }
        });
        mockPlayers.push(broken, diver);

        assert.doesNotThrow(
            () => underwaterOverlayJob(),
            "a despawned or unloaded player must not kill the pass"
        );
        assert.deepEqual(broken.titles, []);
        assert.equal(sentinels(diver).length, 1);
    });

    it("re-asserts the sentinel on a timer so the shared title channel cannot lose the tint", () => {
        // The armor readout writes the same title string, so a long dive has to keep restating the
        // tint or an armor update would leave the screen untinted until the player surfaced.
        const diver = fakePlayer("diver", {
            headBlock: { typeId: "minecraft:water", isLiquid: true }
        });
        mockPlayers.push(diver);

        drainJob(12);

        assert.ok(
            sentinels(diver).length > 1,
            "the sentinel must be re-sent across a long dive, not only on the enter edge"
        );
    });

    it("does not restate the sentinel on every pass", () => {
        const diver = fakePlayer("diver", {
            headBlock: { typeId: "minecraft:water", isLiquid: true }
        });
        mockPlayers.push(diver);

        drainJob(3);

        assert.equal(sentinels(diver).length, 1, "a short dive must not spam the title channel");
    });

    it("pushes exactly one title clear when the head leaves the water", () => {
        const diver = fakePlayer("diver", {
            headBlock: { typeId: "minecraft:water", isLiquid: true }
        });
        mockPlayers.push(diver);
        underwaterOverlayJob();

        (diver.dimension as any).getBlock = () => ({ typeId: "minecraft:air", isLiquid: false });

        drainJob(6);

        assert.deepEqual(
            clears(diver),
            [CLEAR_SENTINEL],
            "surfacing must clear the title exactly once, and an empty title is the clear"
        );
        assert.equal(diver.tinted, false, "the clear is what actually takes the tint down");
    });

    it("does not clear players that were never tinted", () => {
        const wader = fakePlayer("wader", {
            headBlock: { typeId: "minecraft:air", isLiquid: false }
        });
        mockPlayers.push(wader);

        drainJob(3);

        assert.deepEqual(wader.titles, [], "a dry player must never receive a clear");
    });

    it("answers dry for a head above the build height without consulting the block lookup", () => {
        // Above the ceiling the engine's only possible getBlock answer is LocationOutOfWorldBoundaries,
        // so the height guard must settle the question before the lookup ever runs.
        const flying = fakePlayer("flying");
        mockPlayers.push(flying);

        let blockQueries = 0;
        (flying.dimension as any).getBlock = () => {
            blockQueries++;
            throw new Error("LocationOutOfWorldBoundariesError");
        };
        (flying as any).getHeadLocation = () => ({ x: 0.5, y: 400, z: 0.5 });

        assert.doesNotThrow(() => underwaterOverlayJob());
        assert.deepEqual(flying.titles, []);
        assert.equal(
            blockQueries,
            0,
            "an out-of-bounds head must be settled by the height guard, not by a throwing lookup"
        );
    });

    it("answers dry for a head below the world floor and lifts a tint exactly once", () => {
        const diver = fakePlayer("diver", {
            headBlock: { typeId: "minecraft:water", isLiquid: true }
        });
        mockPlayers.push(diver);
        underwaterOverlayJob();
        assert.equal(diver.tinted, true);

        (diver as any).getHeadLocation = () => ({ x: 0.5, y: -100, z: 0.5 });
        drainJob(6);

        assert.deepEqual(
            clears(diver),
            [CLEAR_SENTINEL],
            "the void is definitively dry, so it must lift the tint — unlike an unloaded chunk"
        );
        assert.equal(diver.tinted, false);
    });

    it("leaves a tinted player alone when a lookup throws", () => {
        // An unloaded chunk is not an answer about the head, so it must not be mistaken for air.
        const diver = fakePlayer("diver", {
            headBlock: { typeId: "minecraft:water", isLiquid: true }
        });
        mockPlayers.push(diver);
        underwaterOverlayJob();

        const broken = fakePlayer("unloaded", { throwOnHeadQuery: true });
        (diver as any).dimension.getBlock = () => {
            throw new Error("chunk unloaded");
        };
        mockPlayers.push(diver, broken);

        drainJob(3);

        assert.deepEqual(clears(diver), [], "a failed lookup must not clear a submerged player");
    });

    it("forgets tinted players on leave so their next session takes the enter edge", () => {
        const diver = fakePlayer("diver", {
            headBlock: { typeId: "minecraft:water", isLiquid: true }
        });
        mockPlayers.push(diver);
        underwaterOverlayJob();

        eventBus.dispatch("playerLeave", { playerId: diver.id, playerName: diver.name });

        mockPlayers.length = 0;
        const rejoined = fakePlayer("diver", {
            id: diver.id,
            headBlock: { typeId: "minecraft:water", isLiquid: true }
        });
        mockPlayers.push(rejoined);
        underwaterOverlayJob();

        assert.equal(
            sentinels(rejoined).length,
            1,
            "a rejoined diver must be tinted again immediately"
        );
    });
});
