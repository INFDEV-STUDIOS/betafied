import {
    Direction,
    PlayerInteractWithBlockBeforeEvent
} from "@minecraft/server";
import { eventBus } from "../core/eventBus.js";
import { BETA_WOOD_SPECIES } from "../core/betaRegistry.js";

// The blocks a player can still legitimately reach as vanilla ids: world generation leaves authentic
// logs, dirt and grass under their vanilla names, and buttons, levers, doors and trapdoors have no
// bh: equivalent. Everything else is retyped by the inventory sweep, so a placed slab, stair, log,
// fence or chest is already the custom block and needs no repair after the fact — see the note below.
const CEILING_RESTRICTED = Object.freeze(new Set([
    "minecraft:stone_button",
    "minecraft:lever"
]));

const STRIPPABLE_LOGS = Object.freeze(
    new Set([...BETA_WOOD_SPECIES].map(species => `minecraft:${species}_log`))
);

const PATHABLE_BLOCKS = Object.freeze(new Set([
    "minecraft:dirt",
    "minecraft:grass_block"
]));

function validateBlockInteraction(event: PlayerInteractWithBlockBeforeEvent): void {
    const { itemStack, block, blockFace } = event;
    if (!itemStack) return;

    const itemId = itemStack.typeId;

    // Beta 1.7.3 had no ceiling-mounted buttons or levers.
    if (blockFace === Direction.Down && CEILING_RESTRICTED.has(itemId)) {
        event.cancel = true;
        return;
    }

    if (!block) return;
    const blockId = block.typeId;

    // Axe stripping and shovel pathing both arrived after Beta. Only the vanilla ids need cancelling:
    // every plank, log, stair, slab and fence a player can hold is retyped to its bh: equivalent,
    // which carries no such interaction. `tests/policy/inventoryManager.test.ts` pins that retyping,
    // so if a vanilla block ever becomes reachable again this guard is the thing that has to grow.
    if (itemId.endsWith("_axe") && STRIPPABLE_LOGS.has(blockId)) {
        event.cancel = true;
        return;
    }

    if (itemId.endsWith("_shovel") && PATHABLE_BLOCKS.has(blockId)) {
        event.cancel = true;
        return;
    }

    // Vanilla would grow tall grass here; the custom instant bone meal spread owns this instead.
    if (itemId === "minecraft:bone_meal" && (blockId === "minecraft:short_grass" || blockId === "minecraft:fern")) {
        event.cancel = true;
    }
}

eventBus.onPlayerInteractWithBlock(validateBlockInteraction);
