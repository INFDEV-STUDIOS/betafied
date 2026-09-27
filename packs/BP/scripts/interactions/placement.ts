import {
    Direction,
    BlockPermutation,
    system,
    PlayerInteractWithBlockBeforeEvent,
    PlayerPlaceBlockAfterEvent,
    Block
} from "@minecraft/server";
import { eventBus } from "../core/eventBus.js";
import { reportError } from "../core/errorReporter.js";
import { isVanillaId } from "../core/betaRegistry.js";

const CEILING_RESTRICTED = Object.freeze(new Set([
    "minecraft:stone_button",
    "minecraft:lever"
]));

const BOTTOM_ONLY_SLABS = Object.freeze(new Set([
    "minecraft:cobblestone_slab",
    "minecraft:oak_slab",
    "minecraft:smooth_stone_slab",
    "minecraft:sandstone_slab"
]));

const BOTTOM_ONLY_STAIRS = Object.freeze(new Set([
    "minecraft:oak_stairs",
    "minecraft:stone_stairs",
    "minecraft:cobblestone_stairs"
]));

const VERTICAL_ONLY_LOGS = Object.freeze(new Set([
    "minecraft:oak_log",
    "minecraft:birch_log",
    "minecraft:spruce_log"
]));

const PATHABLE_BLOCKS = Object.freeze(new Set([
    "minecraft:dirt",
    "minecraft:grass_block"
]));

function validateBlockInteraction(event: PlayerInteractWithBlockBeforeEvent): void {
    const { itemStack, block, blockFace } = event;
    if (!itemStack) return;

    const itemId = itemStack.typeId;

    if (blockFace === Direction.Down && CEILING_RESTRICTED.has(itemId)) {
        event.cancel = true;
        return;
    }

    if (!block) return;
    const blockId = block.typeId;

    if (itemId.endsWith("_axe") && VERTICAL_ONLY_LOGS.has(blockId)) {
        event.cancel = true;
        return;
    }

    if (itemId.endsWith("_shovel") && PATHABLE_BLOCKS.has(blockId)) {
        event.cancel = true;
        return;
    }

    if (itemId === "minecraft:bone_meal" && (blockId === "minecraft:short_grass" || blockId === "minecraft:fern")) {
        event.cancel = true;
    }
}

function preventWaterlogging(block: Block | undefined): void {
    if (!block || !isVanillaId(block.typeId)) return;
    try {
        if (block.isWaterlogged) {
            block.setWaterlogged(false);
        }
    } catch (e) {
        reportError({
            system: "placement",
            operation: "preventWaterlogging",
            target: `${block.location.x},${block.location.y},${block.location.z}`
        }, e);
    }
}

function handleDoorPlacement(block: Block): void {
    const dim = block.dimension;
    const loc = block.location;

    system.runTimeout(() => {
        try {
            const botLoc = { x: Math.floor(loc.x), y: Math.floor(loc.y), z: Math.floor(loc.z) };
            const topLoc = { x: botLoc.x, y: botLoc.y + 1, z: botLoc.z };

            const topBlock = dim.getBlock(topLoc);
            const botBlock = dim.getBlock(botLoc);

            if (topBlock?.typeId.includes("_door")) {
                try {
                    topBlock.setWaterlogged(false);
                } catch {
                    topBlock.setType("minecraft:air");
                }
            } else if (topBlock?.typeId === "minecraft:water") {
                topBlock.setType("minecraft:air");
            }

            if (botBlock?.typeId.includes("_door")) {
                try {
                    botBlock.setWaterlogged(false);
                } catch (e) {
                    reportError({
                        system: "placement",
                        operation: "unwaterlogDoorBottom",
                        target: `${botLoc.x},${botLoc.y},${botLoc.z}`
                    }, e);
                }
            }
        } catch (e) {
            reportError({
                system: "placement",
                operation: "postProcessDoor",
                target: `${loc.x},${loc.y},${loc.z}`
            }, e);
        }
    }, 3);
}

function normalizeSlabPlacement(block: Block): void {
    try {
        const permutation = BlockPermutation.resolve(block.typeId, {
            "minecraft:vertical_half": "bottom"
        });
        block.setPermutation(permutation);
    } catch (e) {
        reportError({
            system: "placement",
            operation: "normalizeSlab",
            target: block.typeId
        }, e);
    }
}

function normalizeStairPlacement(block: Block): void {
    try {
        const currentStates = block.permutation.getAllStates();
        const permutation = BlockPermutation.resolve(block.typeId, {
            ...currentStates,
            "upside_down_bit": false
        });
        block.setPermutation(permutation);
    } catch (e) {
        reportError({
            system: "placement",
            operation: "normalizeStair",
            target: block.typeId
        }, e);
    }
}

function normalizeLogPlacement(block: Block): void {
    try {
        const permutation = BlockPermutation.resolve(block.typeId, {
            "pillar_axis": "y"
        });
        block.setPermutation(permutation);
    } catch (e) {
        reportError({
            system: "placement",
            operation: "normalizeLog",
            target: block.typeId
        }, e);
    }
}

function handleBlockPlacement(event: PlayerPlaceBlockAfterEvent): void {
    const { block, player } = event;
    if (!block || !player) return;

    preventWaterlogging(block);

    const typeId = block.typeId;

    if (typeId.includes("_door")) {
        handleDoorPlacement(block);
        return;
    }

    if (BOTTOM_ONLY_SLABS.has(typeId)) {
        normalizeSlabPlacement(block);
        return;
    }

    if (BOTTOM_ONLY_STAIRS.has(typeId)) {
        normalizeStairPlacement(block);
        return;
    }

    if (VERTICAL_ONLY_LOGS.has(typeId)) {
        normalizeLogPlacement(block);
    }
}

eventBus.onPlayerInteractWithBlock(validateBlockInteraction);
eventBus.onPlayerPlaceBlock(handleBlockPlacement);
