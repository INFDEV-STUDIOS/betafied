import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    resetMocks,
    registeredBeforeEvents,
    mockPlayers,
    mockEntities,
    world,
    Player,
    CommandPermissionLevel
} from "../mocks/minecraftServer.js";
import { tickManager } from "../../packs/BP/scripts/core/tickManager.js";
import {
    forceAppearance,
    hasActiveSighting
} from "../../packs/BP/scripts/mobs/herobrine.js";

const OVERWORLD = "minecraft:overworld";

function layOpenGround(radius = 42): void {
    const dimension = world.getDimension(OVERWORLD);
    for (let x = -radius; x <= radius; x++) {
        for (let z = -radius; z <= radius; z++) {
            dimension.setBlock({ x, y: 64, z }, { typeId: "minecraft:air", isAir: true, isSolid: false, isLiquid: false });
            dimension.setBlock({ x, y: 65, z }, { typeId: "minecraft:air", isAir: true, isSolid: false, isLiquid: false });
        }
    }
}

function spawnTestPlayer(): Player {
    const player = new Player("herobrine_test_player", "Alex");
    player.dimension = world.getDimension(OVERWORLD);
    player.location = { x: 0.5, y: 64, z: 0.5 };
    mockPlayers.push(player);
    return player;
}

/** Advances the master scheduler one tick at a time until the sighting resolves or we give up. */
function sweepUntilResolved(limit: number): void {
    for (let i = 0; i < limit && hasActiveSighting(); i++) {
        tickManager.step();
    }
}

function sweepTicks(limit: number): void {
    for (let i = 0; i < limit; i++) {
        tickManager.step();
    }
}

describe("Herobrine Appearance Integration", () => {
    it("registers the /appear custom command as operator-only", () => {
        const callbacks = registeredBeforeEvents.get("startup") ?? [];
        assert.ok(callbacks.length > 0, "herobrine should subscribe to the system startup event");

        const commands: { name: string; permissionLevel: number; cheatsRequired?: boolean }[] = [];
        const registry = {
            registerCommand: (command: { name: string; permissionLevel: number; cheatsRequired?: boolean }) => {
                commands.push(command);
            }
        };

        for (const callback of callbacks) {
            callback({ customCommandRegistry: registry });
        }

        assert.equal(commands.length, 1);
        assert.equal(commands[0].name, "betafied:appear");
        assert.equal(commands[0].permissionLevel, CommandPermissionLevel.Admin);
        assert.equal(commands[0].cheatsRequired, false);
    });

    it("registers its scheduling sweep and maintenance sweeps with the central tick manager", () => {
        assert.equal(tickManager.isRegistered("herobrine:sweep"), true);
        assert.equal(tickManager.isRegistered("herobrine:maintain"), true);
    });

    it("spawns a single apparition and records the sighting", () => {
        resetMocks();
        layOpenGround();
        spawnTestPlayer();

        assert.equal(forceAppearance(), true);
        assert.equal(hasActiveSighting(), true);
        assert.equal(mockEntities.size, 1);

        const [entity] = [...mockEntities.values()];
        assert.equal(entity.typeId, "bh:herobrine");
        assert.equal(entity.dimension.id, OVERWORLD);
    });

    it("dismisses the apparition once any player gets too close", () => {
        resetMocks();
        layOpenGround();
        const player = spawnTestPlayer();

        assert.equal(forceAppearance(), true);
        const [entity] = [...mockEntities.values()];

        player.location = { x: entity.location.x, y: entity.location.y, z: entity.location.z };
        sweepUntilResolved(60);

        assert.equal(hasActiveSighting(), false);
        assert.equal(entity.isValid, false);
    });

    it("unloads the moment a player catches him in their crosshair", () => {
        resetMocks();
        layOpenGround();
        const player = spawnTestPlayer();

        assert.equal(forceAppearance(), true);
        const [entity] = [...mockEntities.values()];

        // Stand 20 blocks away on his -Z side: the mock player's view faces +Z, straight at him.
        player.location = { x: entity.location.x, y: entity.location.y, z: entity.location.z - 20 };
        sweepUntilResolved(60);

        assert.equal(hasActiveSighting(), false);
        assert.equal(entity.isValid, false);
    });

    it("stays put while nobody has him in frame, then dissolves once everyone is far off", () => {
        resetMocks();
        layOpenGround();
        const player = spawnTestPlayer();

        assert.equal(forceAppearance(), true);
        const [entity] = [...mockEntities.values()];

        // Same 20 block gap, but now on his +Z side: the fixed +Z view points away from him.
        player.location = { x: entity.location.x, y: entity.location.y, z: entity.location.z + 20 };
        sweepTicks(120);

        assert.equal(hasActiveSighting(), true, "looking away must not dismiss him");
        assert.equal(entity.isValid, true);

        player.location = { x: entity.location.x, y: entity.location.y, z: entity.location.z + 400 };
        sweepUntilResolved(120);

        assert.equal(hasActiveSighting(), false, "he should not linger once nobody is near");
        assert.equal(entity.isValid, false);
    });

    it("dismisses him when any other player looks, not only the one he appeared to", () => {
        resetMocks();
        layOpenGround();
        const witness = spawnTestPlayer();

        assert.equal(forceAppearance(), true);
        const [entity] = [...mockEntities.values()];

        // The original witness walks off well out of frame.
        witness.location = { x: entity.location.x, y: entity.location.y, z: entity.location.z + 400 };

        const bystander = new Player("bystander", "Bystander");
        bystander.dimension = world.getDimension(OVERWORLD);
        bystander.location = { x: entity.location.x, y: entity.location.y, z: entity.location.z - 20 };
        mockPlayers.push(bystander);

        sweepUntilResolved(60);

        assert.equal(hasActiveSighting(), false, "a bystander's gaze must end the sighting too");
        assert.equal(entity.isValid, false);
    });

    it("will not drop him on top of another player", () => {
        const originalRandom = Math.random;
        // Freeze the picker so every attempt lands on the same spot.
        Math.random = () => 0.5;

        try {
            resetMocks();
            layOpenGround();
            spawnTestPlayer();

            assert.equal(forceAppearance(), true);
            const [probe] = [...mockEntities.values()];
            const spot = { ...probe.location };

            resetMocks();
            layOpenGround();
            spawnTestPlayer();

            const bystander = new Player("bystander", "Bystander");
            bystander.dimension = world.getDimension(OVERWORLD);
            bystander.location = spot;
            mockPlayers.push(bystander);

            assert.equal(forceAppearance(), false, "every candidate spot is occupied");
            assert.equal(mockEntities.size, 0);
        } finally {
            Math.random = originalRandom;
        }
    });

    it("refuses to spawn without players online", () => {
        resetMocks();
        assert.equal(forceAppearance(), false);
        assert.equal(hasActiveSighting(), false);
    });
});
