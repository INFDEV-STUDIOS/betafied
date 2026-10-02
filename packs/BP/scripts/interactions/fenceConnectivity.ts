import { system, BlockPermutation, Block } from "@minecraft/server";
import { eventBus } from "../core/eventBus.js";
import { reportError } from "../core/errorReporter.js";
import { BH_FENCE_ID } from "../core/betaRegistry.js";

const CONFIG = Object.freeze({
    FENCE_ID: BH_FENCE_ID,
    STATE_ID: "bh:connections"
});

const DIR = Object.freeze({ N: 1, E: 2, S: 4, W: 8 });

function updateFenceBlock(block: Block): void {
    if (!block.isValid) return;

    const id = block.typeId;
    const n = block.north();
    const e = block.east();
    const s = block.south();
    const w = block.west();

    let mask = 0;
    if (n?.typeId === id) mask |= DIR.N;
    if (e?.typeId === id) mask |= DIR.E;
    if (s?.typeId === id) mask |= DIR.S;
    if (w?.typeId === id) mask |= DIR.W;

    block.setPermutation(BlockPermutation.resolve(id, {
        ...block.permutation.getAllStates(),
        [CONFIG.STATE_ID]: mask
    }));
}

eventBus.onPlayerPlaceBlock((ev) => {
    const block = ev.block;
    if (block.typeId !== CONFIG.FENCE_ID) return;

    system.run(() => {
        if (!block.isValid) return;
        updateFenceBlock(block);

        const neighbors = [block.north(), block.east(), block.south(), block.west()];
        for (const nb of neighbors) {
            if (nb?.typeId === CONFIG.FENCE_ID) updateFenceBlock(nb);
        }
    });
});

eventBus.onPlayerBreakBlock((ev) => {
    if (ev.brokenBlockPermutation.type.id !== CONFIG.FENCE_ID) return;

    const dim = ev.dimension;
    const { x, y, z } = ev.block.location;

    const offsets = [
        { x, y, z: z - 1 },
        { x, y, z: z + 1 },
        { x: x + 1, y, z },
        { x: x - 1, y, z }
    ];

    for (const pos of offsets) {
        try {
            const nb = dim.getBlock(pos);
            if (nb?.typeId === CONFIG.FENCE_ID) updateFenceBlock(nb);
        } catch (e) {
            // An unloaded neighbour is not an answer about connectivity, so report it rather than
            // leaving the fence silently holding a stale connection mask.
            reportError({
                system: "fenceConnectivity",
                operation: "updateNeighbour",
                target: `${pos.x},${pos.y},${pos.z}`
            }, e);
        }
    }
});
