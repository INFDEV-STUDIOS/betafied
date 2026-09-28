/**
 * Beta 1.7.3 double chests are two blocks sharing one 54-slot inventory. Bedrock cannot hand a
 * custom multi-block a shared container: every part of a multi-block owns its own block entity
 * by design (26.50 changelog), and no stable API opens one block entity's container for another.
 *
 * So the pair keeps exactly one half as the items' home ("master", part 0) and moves the
 * contents into whichever half a player opens, moving them back once the pair goes idle. The
 * contents are only ever moved, never copied, which is what keeps an interrupted session (a
 * crash, a broken chest, an explosion) from duplicating or double-dropping a single stack.
 */

import {
    Block,
    BlockPermutation,
    BlockVolume,
    Container,
    ItemStack,
    PlayerPlaceBlockAfterEvent,
    world
} from "@minecraft/server";
import type {
    BlockContainerClosedAfterEvent,
    BlockContainerOpenedAfterEvent,
    ContainerAccessSource,
    PlayerInteractWithBlockBeforeEvent,
    PlayerLeaveAfterEvent
} from "@minecraft/server";
import { eventBus } from "../core/eventBus.js";
import { reportError, runCatching } from "../core/errorReporter.js";
import { tickManager } from "../core/tickManager.js";

export const SINGLE_CHEST_ID = "bh:chest";
export const DOUBLE_CHEST_ID = "bh:double_chest";
export const SINGLE_CHEST_SLOTS = 27;
export const DOUBLE_CHEST_SLOTS = 54;

const PART_STATE = "minecraft:multi_block_part";
const SWEEP_INTERVAL_TICKS = 10;
/** The multi-block's direction is fixed east, so part 1 always sits one block east of part 0. */
const PART_OFFSET = 1;

export interface ChestLocation {
    x: number;
    y: number;
    z: number;
}

export type ChestHalf = "master" | "shadow";
export type MirrorMove = "none" | "master-to-shadow" | "shadow-to-master";

export interface PairResolution {
    half: ChestHalf;
    master: ChestLocation;
    shadow: ChestLocation;
}

export interface PlacementPlan<T> {
    destination: (T | undefined)[];
    source: (T | undefined)[];
    moves: { from: number; to: number }[];
}

/**
 * Orders a pair into the double chest's part order. The multi-block runs "east",
 * so part 0 must be the western block; the halves therefore map onto slots
 * 0-26 and 27-53 the way vanilla splits a double chest left from right.
 */
export function orderPair<T extends { x: number; z: number }>(a: T, b: T): [T, T] {
    return a.x <= b.x ? [a, b] : [b, a];
}

export function mergeContents<T>(
    west: readonly (T | undefined)[],
    east: readonly (T | undefined)[]
): (T | undefined)[] {
    return [...west, ...east];
}

export function pairKey(dimensionId: string, master: ChestLocation): string {
    return `${dimensionId}:${master.x},${master.y},${master.z}`;
}

export function resolveHalf(partValue: unknown, location: ChestLocation): PairResolution | undefined {
    const part = Number(partValue);
    if (!Number.isInteger(part) || part < 0 || part > 1) return undefined;

    const master =
        part === 0
            ? { x: location.x, y: location.y, z: location.z }
            : { x: location.x - PART_OFFSET, y: location.y, z: location.z };

    return {
        half: part === 0 ? "master" : "shadow",
        master,
        shadow: { x: master.x + PART_OFFSET, y: master.y, z: master.z }
    };
}

export function hasAnyItem<T>(contents: readonly (T | undefined)[]): boolean {
    return contents.some(stack => stack !== undefined);
}

/**
 * Whole stacks only: a destination that has run out of empty slots leaves the rest behind in the
 * source. That is loss-free without having to know each item's stack limit, which matters because
 * writing an amount over an item's limit would have the engine drop the overflow.
 */
export function planPlacement<T>(
    source: readonly (T | undefined)[],
    destination: readonly (T | undefined)[]
): PlacementPlan<T> {
    const sourceAfter = [...source];
    const destinationAfter = [...destination];
    const moves: { from: number; to: number }[] = [];

    let cursor = 0;
    for (let slot = 0; slot < sourceAfter.length; slot++) {
        const stack = sourceAfter[slot];
        if (!stack) continue;

        while (cursor < destinationAfter.length && destinationAfter[cursor] !== undefined) cursor++;
        if (cursor >= destinationAfter.length) break;

        destinationAfter[cursor] = stack;
        sourceAfter[slot] = undefined;
        moves.push({ from: slot, to: cursor });
        cursor++;
    }

    return { destination: destinationAfter, source: sourceAfter, moves };
}

export interface OpenDecisionInput {
    half: ChestHalf;
    firstViewer: boolean;
    masterHasItems: boolean;
    shadowHasItems: boolean;
    masterViewers: number;
    shadowViewers: number;
}

/**
 * The items follow the half that is being opened, because an open container is the one place a
 * player can see and edit them. A half that already has a viewer keeps them: emptying a chest
 * under someone mid-session reads as items being deleted, so the other half opens empty and
 * whatever is dropped into it drains back to the master when that session ends.
 */
export function planOpen(input: OpenDecisionInput): MirrorMove {
    if (input.half === "shadow") {
        if (!input.firstViewer) return "none";
        if (input.masterViewers > 0) return "none";
        return input.masterHasItems ? "master-to-shadow" : "none";
    }

    if (!input.firstViewer) return "none";
    if (input.shadowViewers > 0) return "none";
    return input.shadowHasItems ? "shadow-to-master" : "none";
}

export function planClose(input: { half: ChestHalf; remainingViewers: number; shadowHasItems: boolean }): MirrorMove {
    if (input.half !== "shadow" || input.remainingViewers > 0 || !input.shadowHasItems) return "none";
    return "shadow-to-master";
}

export function planSweep(input: { shadowViewers: number; shadowHasItems: boolean }): MirrorMove {
    return input.shadowViewers === 0 && input.shadowHasItems ? "shadow-to-master" : "none";
}

/**
 * The pair only ever holds one inventory, so a second player opening the other half would find it
 * empty and could stock a half that is not the one on screen. Turning that interaction away keeps
 * both players on the same page; the mirror stays what makes the pair safe, this only spares the
 * confusion.
 */
export function planOpenBlock(input: { half: ChestHalf; masterViewers: number; shadowViewers: number }): boolean {
    return input.half === "master" ? input.shadowViewers > 0 : input.masterViewers > 0;
}

/**
 * A close event is not guaranteed to arrive (a dropped connection, a crash, a reload), and a viewer
 * that never leaves would freeze the pair: its other half stays empty and the items stay parked.
 */
export function dropOfflineViewers(viewers: Set<string>, onlinePlayerIds: ReadonlySet<string>): number {
    let dropped = 0;
    for (const playerId of [...viewers]) {
        if (onlinePlayerIds.has(playerId)) continue;
        viewers.delete(playerId);
        dropped++;
    }
    return dropped;
}

type Guarded<T> = { ok: true; value: T } | { ok: false };

function guard<T>(operation: string, fn: () => T): Guarded<T> {
    let outcome: Guarded<T> = { ok: false };
    runCatching({ system: "doubleChest", operation }, () => {
        outcome = { ok: true, value: fn() };
    });
    return outcome;
}

function blockAt(dimensionId: string, location: ChestLocation): Block | undefined {
    const found = guard(`getBlock:${dimensionId}`, () => world.getDimension(dimensionId).getBlock(location));
    return found.ok ? found.value : undefined;
}

function containerOf(block: Block): Container | undefined {
    const component = guard(`getContainerComponent`, () => block.getComponent("minecraft:inventory"));
    return component.ok ? component.value?.container : undefined;
}

function partStateOf(block: Block): unknown {
    const state = guard("readPartState", () => block.permutation.getState(PART_STATE));
    return state.ok ? state.value : undefined;
}

function isHalf(block: Block | undefined): boolean {
    return block !== undefined && block.typeId === DOUBLE_CHEST_ID;
}

function readSlots(container: Container, slots: number): (ItemStack | undefined)[] | undefined {
    const contents: (ItemStack | undefined)[] = [];
    for (let slot = 0; slot < slots; slot++) {
        const read = guard(`readSlot:${slot}`, () => container.getItem(slot));
        // A half-read container is worse than no read at all: treating a slot we could not read as
        // empty would let a move overwrite it.
        if (!read.ok) return undefined;
        contents.push(read.value);
    }
    return contents;
}

function clearSlots(container: Container, slots: number): void {
    for (let slot = 0; slot < slots; slot++) {
        guard(`clearSlot:${slot}`, () => container.setItem(slot));
    }
}

/** Undefined when the half could not be read, which callers must not mistake for "empty". */
function containerHasItems(dimensionId: string, location: ChestLocation): boolean | undefined {
    const block = blockAt(dimensionId, location);
    if (!block) return undefined;

    const container = containerOf(block);
    if (!container) return undefined;

    const contents = readSlots(container, DOUBLE_CHEST_SLOTS);
    return contents === undefined ? undefined : hasAnyItem(contents);
}

function writeSlots(container: Container, contents: readonly (ItemStack | undefined)[], fallback: Block): void {
    for (let slot = 0; slot < contents.length; slot++) {
        const stack = contents[slot];
        if (!stack) continue;
        if (guard(`writeSlot:${slot}`, () => container.setItem(slot, stack)).ok) continue;

        guard("spawnUnplacedStack", () => fallback.dimension.spawnItem(stack, fallback.center()));
    }
}

/**
 * Returns the number of stacks still sitting in the source, or undefined when the pair could not
 * be read at all. A cleared source slot is what hands the stack to the destination, so a write
 * that fails after the clear hands the stack back to the world instead of losing it.
 */
function moveContents(dimensionId: string, from: ChestLocation, to: ChestLocation): number | undefined {
    const source = blockAt(dimensionId, from);
    const destination = blockAt(dimensionId, to);
    if (!source || !destination) return undefined;

    const sourceContainer = containerOf(source);
    const destinationContainer = containerOf(destination);
    if (!sourceContainer || !destinationContainer) return undefined;

    const sourceContents = readSlots(sourceContainer, DOUBLE_CHEST_SLOTS);
    const destinationContents = readSlots(destinationContainer, DOUBLE_CHEST_SLOTS);
    if (!sourceContents || !destinationContents) return undefined;

    const plan = planPlacement(sourceContents, destinationContents);
    for (const move of plan.moves) {
        const stack = sourceContents[move.from];
        if (!stack) continue;

        if (!guard(`clearSlot:${move.from}`, () => sourceContainer.setItem(move.from)).ok) continue;
        if (guard(`writeSlot:${move.to}`, () => destinationContainer.setItem(move.to, stack)).ok) continue;

        guard("spawnUnplacedStack", () => source.dimension.spawnItem(stack, source.center()));
    }

    return plan.source.filter(stack => stack !== undefined).length;
}

interface PairSession {
    dimensionId: string;
    master: ChestLocation;
    shadow: ChestLocation;
    masterViewers: Set<string>;
    shadowViewers: Set<string>;
}

const sessions = new Map<string, PairSession>();

function sessionFor(key: string, dimensionId: string, resolution: PairResolution): PairSession {
    const existing = sessions.get(key);
    if (existing) return existing;

    const session: PairSession = {
        dimensionId,
        master: resolution.master,
        shadow: resolution.shadow,
        masterViewers: new Set(),
        shadowViewers: new Set()
    };
    sessions.set(key, session);
    return session;
}

function applyMove(move: MirrorMove, session: PairSession): number | undefined {
    if (move === "none") return 0;

    return move === "master-to-shadow"
        ? moveContents(session.dimensionId, session.master, session.shadow)
        : moveContents(session.dimensionId, session.shadow, session.master);
}

function dropIfIdle(session: PairSession, key: string, drained: number | undefined): void {
    if (session.masterViewers.size > 0 || session.shadowViewers.size > 0) return;
    if (drained === 0) sessions.delete(key);
}

function releaseIdleShadow(session: PairSession, key: string): void {
    if (session.shadowViewers.size > 0) return;
    const drained = applyMove("shadow-to-master", session);
    dropIfIdle(session, key, drained);
}

function viewerIdOf(source: ContainerAccessSource | undefined): string | undefined {
    const entity = source?.entity;
    return entity?.typeId === "minecraft:player" ? entity.id : undefined;
}

function resolvePairRef(block: Block): { key: string; dimensionId: string; resolution: PairResolution } | undefined {
    if (block.typeId !== DOUBLE_CHEST_ID) return undefined;

    const resolution = resolveHalf(partStateOf(block), block.location);
    if (!resolution) return undefined;

    const dimensionId = block.dimension.id;
    return { key: pairKey(dimensionId, resolution.master), dimensionId, resolution };
}

function resolveEventBlock(block: Block): { key: string; session: PairSession; half: ChestHalf } | undefined {
    const ref = resolvePairRef(block);
    if (!ref) return undefined;

    return {
        key: ref.key,
        session: sessionFor(ref.key, ref.dimensionId, ref.resolution),
        half: ref.resolution.half
    };
}

function handleContainerOpened(event: BlockContainerOpenedAfterEvent): void {
    const resolved = resolveEventBlock(event.block);
    if (!resolved) return;

    const { session, half } = resolved;
    const masterViewers = session.masterViewers.size;
    const shadowViewers = session.shadowViewers.size;
    const firstViewer = half === "master" ? masterViewers === 0 : shadowViewers === 0;

    const viewerId = viewerIdOf(event.openSource);
    if (viewerId) (half === "master" ? session.masterViewers : session.shadowViewers).add(viewerId);

    const move = planOpen({
        half,
        firstViewer,
        masterHasItems: containerHasItems(session.dimensionId, session.master) ?? false,
        shadowHasItems: containerHasItems(session.dimensionId, session.shadow) ?? false,
        masterViewers,
        shadowViewers
    });

    const drained = applyMove(move, session);
    if (move !== "none") dropIfIdle(session, resolved.key, drained);
}

function handleContainerClosed(event: BlockContainerClosedAfterEvent): void {
    const resolved = resolveEventBlock(event.block);
    if (!resolved) return;

    const { key, session, half } = resolved;
    const viewerId = viewerIdOf(event.closeSource);
    if (viewerId) (half === "master" ? session.masterViewers : session.shadowViewers).delete(viewerId);

    if (half !== "shadow") return;

    const remainingViewers = session.shadowViewers.size;
    const shadowHasItems = containerHasItems(session.dimensionId, session.shadow);
    // An unreadable half stays tracked so the sweep retries the drain instead of parking items.
    if (shadowHasItems === undefined) return;

    const drained = applyMove(planClose({ half, remainingViewers, shadowHasItems }), session);
    dropIfIdle(session, key, drained);
}

function handlePlayerLeave(event: PlayerLeaveAfterEvent): void {
    for (const [key, session] of sessions) {
        const leftMaster = session.masterViewers.delete(event.playerId);
        const leftShadow = session.shadowViewers.delete(event.playerId);
        if (!leftMaster && !leftShadow) continue;

        releaseIdleShadow(session, key);
    }
}

function onlinePlayerIds(): Set<string> | undefined {
    const players = guard("getAllPlayers", () => world.getAllPlayers());
    return players.ok ? new Set(players.value.map(player => player.id)) : undefined;
}

function sweepPairs(): void {
    for (const [key, session] of sessions) {
        if (session.masterViewers.size > 0 || session.shadowViewers.size > 0) {
            const online = onlinePlayerIds();
            if (online) {
                dropOfflineViewers(session.masterViewers, online);
                dropOfflineViewers(session.shadowViewers, online);
            }
        }

        const master = blockAt(session.dimensionId, session.master);
        const shadow = blockAt(session.dimensionId, session.shadow);
        // The pair is gone (broken, exploded or replaced): the engine already dropped whatever the
        // halves held, so there is nothing left to move.
        if (!isHalf(master) || !isHalf(shadow)) {
            sessions.delete(key);
            continue;
        }

        if (session.masterViewers.size > 0 || session.shadowViewers.size > 0) continue;

        const shadowHasItems = containerHasItems(session.dimensionId, session.shadow);
        if (shadowHasItems === undefined) continue;
        if (!shadowHasItems) {
            sessions.delete(key);
            continue;
        }

        const drained = applyMove(planSweep({ shadowViewers: 0, shadowHasItems }), session);
        // Leftovers mean the master is full; the shadow keeps them until the master has room.
        dropIfIdle(session, key, drained);
    }
}

/**
 * Filling the two cells is the path the engine is known to assemble multi-blocks
 * through; writing each part by hand only lands the permutations and can leave two
 * unrelated blocks wearing the same id.
 */
function assemblePair(west: Block, east: Block): boolean {
    const dimension = west.dimension;

    try {
        dimension.fillBlocks(new BlockVolume(west.location, east.location), DOUBLE_CHEST_ID);
    } catch (e) {
        reportError({ system: "doubleChest", operation: "fillPair", target: DOUBLE_CHEST_ID }, e);
    }

    if (partCount(dimension.getBlock(west.location) ?? west) === 2) return true;

    try {
        const part = BlockPermutation.resolve(DOUBLE_CHEST_ID);
        west.setPermutation(part.withState(PART_STATE, 0));
        east.setPermutation(part.withState(PART_STATE, 1));
    } catch (e) {
        reportError({ system: "doubleChest", operation: "setParts", target: DOUBLE_CHEST_ID }, e);
    }

    return partCount(dimension.getBlock(west.location) ?? west) === 2;
}

function partCount(block: Block): number {
    const parts = guard("getParts", () => block.getParts()?.length ?? 0);
    return parts.ok ? parts.value : 0;
}

function restoreSingles(
    west: Block,
    east: Block,
    westContents: (ItemStack | undefined)[],
    eastContents: (ItemStack | undefined)[]
): void {
    const single = BlockPermutation.resolve(SINGLE_CHEST_ID);
    west.setPermutation(single);
    east.setPermutation(single);

    const westContainer = containerOf(west);
    const eastContainer = containerOf(east);
    if (westContainer) writeSlots(westContainer, westContents, west);
    if (eastContainer) writeSlots(eastContainer, eastContents, east);

    console.warn("doubleChest: pairing failed, kept two single chests");
}

/**
 * Two singles become one 54-slot pair: the merged contents land in the master half and the shadow
 * half stays empty, since the pair only fills a half while a player has it open.
 */
function mergePair(west: Block, east: Block): void {
    const westContainer = containerOf(west);
    const eastContainer = containerOf(east);
    if (!westContainer || !eastContainer) return;

    const westContents = readSlots(westContainer, SINGLE_CHEST_SLOTS);
    const eastContents = readSlots(eastContainer, SINGLE_CHEST_SLOTS);
    if (!westContents || !eastContents) return;

    // Overwriting a block entity ejects whatever it still holds, and it ejects it as real drops.
    // Emptying both singles first is what keeps the merged copy from duplicating the stacks the
    // swap spits onto the floor.
    clearSlots(westContainer, SINGLE_CHEST_SLOTS);
    clearSlots(eastContainer, SINGLE_CHEST_SLOTS);

    if (!assemblePair(west, east)) {
        restoreSingles(west, east, westContents, eastContents);
        return;
    }

    const master = west.dimension.getBlock(west.location) ?? west;
    const shadow = west.dimension.getBlock(east.location) ?? east;

    const masterContainer = containerOf(master);
    if (!masterContainer) {
        restoreSingles(master, shadow, westContents, eastContents);
        return;
    }

    writeSlots(masterContainer, mergeContents(westContents, eastContents), master);

    // The shadow is a fresh block entity, so anything still readable here is a second copy of the
    // east single's contents that the swap carried over.
    const shadowContainer = containerOf(shadow);
    if (shadowContainer) clearSlots(shadowContainer, DOUBLE_CHEST_SLOTS);
}

function findPartner(placed: Block): Block | undefined {
    const west = placed.west();
    if (west?.typeId === SINGLE_CHEST_ID) return west;

    const east = placed.east();
    if (east?.typeId === SINGLE_CHEST_ID) return east;

    return undefined;
}

function handleChestPlaced(event: PlayerPlaceBlockAfterEvent): void {
    const placed = event.block;
    if (placed.typeId !== SINGLE_CHEST_ID) return;

    const partner = findPartner(placed);
    if (!partner) return;

    const [west, east] = orderPair(placed, partner);
    mergePair(west, east);
}

eventBus.onPlayerPlaceBlock(event => {
    try {
        handleChestPlaced(event);
    } catch (e) {
        reportError({
            system: "doubleChest",
            operation: "mergeOnPlace",
            target: `${event.block.location.x},${event.block.location.y},${event.block.location.z}`
        }, e);
    }
});

eventBus.onBlockContainerOpened(event => {
    try {
        handleContainerOpened(event);
    } catch (e) {
        reportError({ system: "doubleChest", operation: "containerOpened" }, e);
    }
});

eventBus.onBlockContainerClosed(event => {
    try {
        handleContainerClosed(event);
    } catch (e) {
        reportError({ system: "doubleChest", operation: "containerClosed" }, e);
    }
});

eventBus.onPlayerLeave(event => {
    try {
        handlePlayerLeave(event);
    } catch (e) {
        reportError({ system: "doubleChest", operation: "playerLeave" }, e);
    }
});

function handleInteractWithBlock(event: PlayerInteractWithBlockBeforeEvent): void {
    const block = event.block;
    if (!block || block.typeId !== DOUBLE_CHEST_ID) return;

    const ref = resolvePairRef(block);
    if (!ref) return;

    const session = sessions.get(ref.key);
    if (!session) return;

    const busy = planOpenBlock({
        half: ref.resolution.half,
        masterViewers: session.masterViewers.size,
        shadowViewers: session.shadowViewers.size
    });
    if (!busy) return;

    event.cancel = true;
    event.player.sendMessage("§cThis chest is in use");
}

eventBus.onPlayerInteractWithBlock(event => {
    try {
        handleInteractWithBlock(event);
    } catch (e) {
        reportError({ system: "doubleChest", operation: "interactWithBlock" }, e);
    }
});

tickManager.register("doubleChest:sweep", SWEEP_INTERVAL_TICKS, sweepPairs);
