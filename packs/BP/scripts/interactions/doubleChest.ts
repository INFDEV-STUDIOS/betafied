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
    system,
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

const AIR_ID = "minecraft:air";
const PART_STATE = "minecraft:multi_block_part";
const DIRECTION_STATE = "minecraft:cardinal_direction";
const SWEEP_INTERVAL_TICKS = 10;
/** A chest placed this tick has no block entity to read yet, so the merge waits for the next one. */
const MERGE_DELAY_TICKS = 1;

export type CardinalDirection = "north" | "south" | "east" | "west";
type PairAxis = "x" | "z";

const CARDINAL_DIRECTIONS: readonly CardinalDirection[] = Object.freeze(["north", "south", "east", "west"]);

export interface PairLayout {
    /** Cell offset from the pair's part 0 (the master half) to part 1. */
    step: ChestLocation;
    /** The long face the two latches meet on, always perpendicular to the step. */
    latch: CardinalDirection;
}

/**
 * A large chest's latch sits on one of its long faces, so the engine's part axis and the latch
 * together leave exactly four layouts, and the block's `cardinal_direction` state names one of them.
 * The state therefore carries the step from part 0 to part 1 rather than the latch alone: part 0 is
 * the half on the viewer's left in every layout, which keeps slots 0-26 the left half the way
 * vanilla splits a double chest.
 */
export const PAIR_LAYOUTS: Readonly<Record<CardinalDirection, PairLayout>> = Object.freeze({
    east: { step: { x: 1, y: 0, z: 0 }, latch: "south" },
    west: { step: { x: -1, y: 0, z: 0 }, latch: "north" },
    north: { step: { x: 0, y: 0, z: -1 }, latch: "east" },
    south: { step: { x: 0, y: 0, z: 1 }, latch: "west" }
});

/** The inverse of PAIR_LAYOUTS: which layout wears each latch face. */
export const PAIR_STATE_BY_LATCH: Readonly<Record<CardinalDirection, CardinalDirection>> = Object.freeze({
    south: "east",
    north: "west",
    east: "north",
    west: "south"
});

export const INVERSE_DIRECTION: Readonly<Record<CardinalDirection, CardinalDirection>> = Object.freeze({
    north: "south",
    south: "north",
    east: "west",
    west: "east"
});

/** The latches that can sit on a long face of a pair running along each axis. */
const SIDE_LATCHES: Readonly<Record<PairAxis, readonly CardinalDirection[]>> = Object.freeze({
    x: ["north", "south"],
    z: ["east", "west"]
});

/** Chests placed end to end have no latch on a long face; the pair still needs a readable side. */
const FALLBACK_LATCH: Readonly<Record<PairAxis, CardinalDirection>> = Object.freeze({
    x: "south",
    z: "east"
});

const NEIGHBOUR_OFFSETS: readonly ChestLocation[] = Object.freeze([
    { x: 1, y: 0, z: 0 },
    { x: -1, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 0, y: 0, z: -1 }
]);

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

export interface ChestNeighbour {
    /** Where the neighbouring chest sits, relative to the chest that was just placed. */
    offset: ChestLocation;
    latch: CardinalDirection | undefined;
}

export interface PairPlan {
    state: CardinalDirection;
    latch: CardinalDirection;
    /** The part-0 cell, relative to the chest that was just placed. */
    masterOffset: ChestLocation;
}

/** The layout whose step runs in the given direction, or undefined for anything but a single step. */
function layoutStep(direction: ChestLocation): CardinalDirection | undefined {
    return CARDINAL_DIRECTIONS.find(state => {
        const step = PAIR_LAYOUTS[state].step;
        return step.x === direction.x && step.y === direction.y && step.z === direction.z;
    });
}

function stepReaches(step: ChestLocation, offset: ChestLocation): boolean {
    return step.x === offset.x && step.y === offset.y && step.z === offset.z;
}

function onLongFace(latch: CardinalDirection | undefined, axis: PairAxis): latch is CardinalDirection {
    return latch !== undefined && SIDE_LATCHES[axis].includes(latch);
}

function planAgainst(placedLatch: CardinalDirection | undefined, neighbour: ChestNeighbour): PairPlan | undefined {
    // Only a chest sharing a face can join; a diagonal or distant chest is not a partner at all.
    const axis = neighbour.offset.x !== 0 ? "x" : "z";
    if (!layoutStep(neighbour.offset)) return undefined;

    // A latch belongs on a long face, so the latch the placer is looking at wins whenever the two
    // halves ended up beside each other. Chests placed end to end leave only the neighbour's latch
    // before the pair falls back on the side that stays readable.
    const latch = onLongFace(placedLatch, axis)
        ? placedLatch
        : onLongFace(neighbour.latch, axis)
            ? neighbour.latch
            : FALLBACK_LATCH[axis];

    const state = PAIR_STATE_BY_LATCH[latch];
    return {
        state,
        latch,
        masterOffset: stepReaches(PAIR_LAYOUTS[state].step, neighbour.offset)
            ? { x: 0, y: 0, z: 0 }
            : neighbour.offset
    };
}

/**
 * Plans the pair a freshly placed chest joins: which layout the halves take, and which of the two
 * cells ends up as part 0. Only one partner can join a chest, so the caller's order breaks ties.
 */
export function planPair(
    placedLatch: CardinalDirection | undefined,
    neighbours: readonly ChestNeighbour[]
): PairPlan | undefined {
    const plans: PairPlan[] = [];
    for (const neighbour of neighbours) {
        const plan = planAgainst(placedLatch, neighbour);
        if (plan) plans.push(plan);
    }

    return plans.find(plan => plan.latch === placedLatch) ?? plans[0];
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

export function isCardinalDirection(value: unknown): value is CardinalDirection {
    return CARDINAL_DIRECTIONS.some(direction => direction === value);
}

export function resolveHalf(partValue: unknown, location: ChestLocation, state: unknown): PairResolution | undefined {
    const part = Number(partValue);
    if (!Number.isInteger(part) || part < 0 || part > 1) return undefined;
    if (!isCardinalDirection(state)) return undefined;

    const { step } = PAIR_LAYOUTS[state];
    const master =
        part === 0
            ? { x: location.x, y: location.y, z: location.z }
            : { x: location.x - step.x, y: location.y - step.y, z: location.z - step.z };

    return {
        half: part === 0 ? "master" : "shadow",
        master,
        shadow: { x: master.x + step.x, y: master.y + step.y, z: master.z + step.z }
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

function isHalf(block: Block | undefined): block is Block {
    return block !== undefined && block.typeId === DOUBLE_CHEST_ID;
}

function cellOf(block: Block): ChestLocation {
    return { x: block.location.x, y: block.location.y, z: block.location.z };
}

function offsetLocation(location: ChestLocation, offset: ChestLocation): ChestLocation {
    return { x: location.x + offset.x, y: location.y + offset.y, z: location.z + offset.z };
}

function directionStateOf(block: Block): CardinalDirection | undefined {
    const state = guard("readDirection", () => block.permutation.getState(DIRECTION_STATE));
    const value = state.ok ? state.value : undefined;
    return isCardinalDirection(value) ? value : undefined;
}

function spansCells(dimensionId: string, resolution: PairResolution): boolean {
    return isHalf(blockAt(dimensionId, resolution.master)) && isHalf(blockAt(dimensionId, resolution.shadow));
}

/** The block's declared slot count is not a promise, so slot work is bounded by the container itself. */
export function clampSlots(requested: number, size: number | undefined): number {
    return size === undefined ? 0 : Math.min(requested, size);
}

/**
 * Converting a placed single into a half leaves that half's block entity with the 27 slots it was
 * born with, not the 54 the double chest declares, and addressing past that throws. The container's
 * own `size` is the only slot count both halves agree on.
 */
function slotCapacity(container: Container, requested: number): number | undefined {
    const measured = guard("containerSize", () => container.size);
    return measured.ok ? clampSlots(requested, measured.value) : undefined;
}

function readSlots(container: Container, slots: number): (ItemStack | undefined)[] | undefined {
    const contents: (ItemStack | undefined)[] = [];
    const capacity = slotCapacity(container, slots);
    // A container that cannot even report its size is unreadable, which callers must not read as empty.
    if (capacity === undefined) return undefined;

    for (let slot = 0; slot < capacity; slot++) {
        const read = guard(`readSlot:${slot}`, () => container.getItem(slot));
        // A half-read container is worse than no read at all: treating a slot we could not read as
        // empty would let a move overwrite it.
        if (!read.ok) return undefined;
        contents.push(read.value);
    }
    return contents;
}

function clearSlots(container: Container, slots: number): void {
    const capacity = slotCapacity(container, slots) ?? 0;
    for (let slot = 0; slot < capacity; slot++) {
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
    const capacity = slotCapacity(container, contents.length) ?? 0;
    for (let slot = 0; slot < contents.length; slot++) {
        const stack = contents[slot];
        if (!stack) continue;
        // A stack the container is too small to hold is handed to the world rather than dropped.
        if (slot < capacity && guard(`writeSlot:${slot}`, () => container.setItem(slot, stack)).ok) continue;

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

    const dimensionId = block.dimension.id;
    const part = partStateOf(block);
    const state = directionStateOf(block);

    // The engine is the one that places the halves, so when the world does not match the layout the
    // state promised, the mirrored layout is the one that does.
    let resolution = resolveHalf(part, block.location, state);
    if (!resolution || !spansCells(dimensionId, resolution)) {
        resolution = resolveHalf(part, block.location, state ? INVERSE_DIRECTION[state] : undefined);
    }

    if (!resolution || !spansCells(dimensionId, resolution)) return undefined;

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

interface PairCells {
    /** The cell the engine made part 0: the half the pair's items live in. */
    home: ChestLocation;
    other: ChestLocation;
}

/**
 * The engine builds a multi-block when it places the block, not when a permutation is written over a
 * chest that is already standing there. Writing the two parts by hand only dresses two unrelated
 * blocks in the same id - each keeping the 27-slot block entity it was born with - and the world
 * later cleans that mess up by taking a chest with it. Emptying both cells first is what turns the
 * pair into a fresh placement, and each attempt is checked against the world afterwards, because
 * being handed the permutations is not the same thing as becoming one multi-block.
 */
function assemblePair(master: Block, shadow: Block, state: CardinalDirection): PairCells | undefined {
    const dimensionId = master.dimension.id;
    const masterCell = cellOf(master);
    const shadowCell = cellOf(shadow);
    const permutation = pairPermutation(state);

    clearPairCells(dimensionId, masterCell, shadowCell);
    try {
        master.dimension.fillBlocks(new BlockVolume(masterCell, shadowCell), permutation);
    } catch (e) {
        reportError({ system: "doubleChest", operation: "fillPair", target: DOUBLE_CHEST_ID }, e);
    }

    const filled = readPair(dimensionId, masterCell, shadowCell);
    if (filled) return filled;

    // A fill is not obliged to assemble the parts, so the pair gets one plainer placement attempt -
    // still over two empty cells, which is what keeps it from dressing two unrelated blocks again.
    clearPairCells(dimensionId, masterCell, shadowCell);
    const placed = blockAt(dimensionId, masterCell);
    if (placed) guard("placePair", () => placed.setPermutation(permutation));

    return readPair(dimensionId, masterCell, shadowCell);
}

function clearPairCells(dimensionId: string, masterCell: ChestLocation, shadowCell: ChestLocation): void {
    for (const cell of [masterCell, shadowCell]) {
        const block = blockAt(dimensionId, cell);
        if (!block) continue;

        guard("clearPairCell", () => block.setType(AIR_ID));
    }
}

/** The engine owns the part order, so the pair is read back out of the world rather than assumed. */
function readPair(dimensionId: string, masterCell: ChestLocation, shadowCell: ChestLocation): PairCells | undefined {
    const built = blockAt(dimensionId, masterCell);
    const twin = blockAt(dimensionId, shadowCell);
    if (!isHalf(built) || !isHalf(twin)) return undefined;

    const home = partHome(partStateOf(built), partStateOf(twin));
    if (home === undefined) return undefined;

    return home === "master" ? { home: masterCell, other: shadowCell } : { home: shadowCell, other: masterCell };
}

/** Which of the two cells the engine made part 0, or undefined when the cells are not one pair. */
export function partHome(masterPart: unknown, shadowPart: unknown): ChestHalf | undefined {
    const built = Number(masterPart);
    const twin = Number(shadowPart);
    if (built === 0 && twin === 1) return "master";
    if (built === 1 && twin === 0) return "shadow";
    return undefined;
}

function pairPermutation(state: CardinalDirection): BlockPermutation {
    return BlockPermutation.resolve(DOUBLE_CHEST_ID, { [DIRECTION_STATE]: state, [PART_STATE]: 0 });
}

function restoreSingles(
    master: Block,
    shadow: Block,
    masterLatch: CardinalDirection,
    shadowLatch: CardinalDirection,
    masterContents: (ItemStack | undefined)[],
    shadowContents: (ItemStack | undefined)[]
): void {
    // Each single goes back the way the placer left it, so a failed pair does not spin a chest around.
    // Both writes are guarded because the contents are already empty and nothing may stop them
    // from being handed back below.
    guard("restoreMasterSingle", () => master.setPermutation(singlePermutation(masterLatch)));
    guard("restoreShadowSingle", () => shadow.setPermutation(singlePermutation(shadowLatch)));

    handBackContents(master, masterContents);
    handBackContents(shadow, shadowContents);

    console.warn("doubleChest: pairing failed, kept two single chests");
}

/** Puts stacks back where they came from, dropping them at the block when its container is gone. */
function handBackContents(block: Block, contents: readonly (ItemStack | undefined)[]): void {
    const container = containerOf(block);
    if (container) {
        writeSlots(container, contents, block);
        return;
    }

    for (const stack of contents) {
        if (!stack) continue;
        guard("spawnUnplacedStack", () => block.dimension.spawnItem(stack, block.center()));
    }
}

function singlePermutation(latch: CardinalDirection): BlockPermutation {
    return BlockPermutation.resolve(SINGLE_CHEST_ID, { [DIRECTION_STATE]: latch });
}

/**
 * Two singles become one 54-slot pair: the merged contents land in whichever half the engine made
 * part 0 and the other half stays empty, since the pair only fills a half while a player has it open.
 */
function mergePair(master: Block, shadow: Block, state: CardinalDirection): void {
    const dimensionId = master.dimension.id;
    const masterCell = cellOf(master);
    const shadowCell = cellOf(shadow);

    const masterContainer = containerOf(master);
    const shadowContainer = containerOf(shadow);
    if (!masterContainer || !shadowContainer) return;

    const masterContents = readSlots(masterContainer, SINGLE_CHEST_SLOTS);
    const shadowContents = readSlots(shadowContainer, SINGLE_CHEST_SLOTS);
    if (!masterContents || !shadowContents) return;

    const masterLatch = directionStateOf(master) ?? FALLBACK_LATCH.x;
    const shadowLatch = directionStateOf(shadow) ?? FALLBACK_LATCH.x;

    // The assembly replaces both blocks, so their block entities are emptied before the swap to keep
    // the pair from dropping the stacks the replaced singles still held.
    clearSlots(masterContainer, SINGLE_CHEST_SLOTS);
    clearSlots(shadowContainer, SINGLE_CHEST_SLOTS);

    const cells = assemblePair(master, shadow, state);
    if (!cells) {
        const left = blockAt(dimensionId, masterCell) ?? master;
        const right = blockAt(dimensionId, shadowCell) ?? shadow;
        restoreSingles(left, right, masterLatch, shadowLatch, masterContents, shadowContents);
        return;
    }

    const home = blockAt(dimensionId, cells.home) ?? master;
    const other = blockAt(dimensionId, cells.other) ?? shadow;

    const homeContainer = containerOf(home);
    if (!homeContainer) {
        const left = blockAt(dimensionId, masterCell) ?? home;
        const right = blockAt(dimensionId, shadowCell) ?? other;
        restoreSingles(left, right, masterLatch, shadowLatch, masterContents, shadowContents);
        return;
    }

    writeSlots(homeContainer, mergeContents(masterContents, shadowContents), home);

    // The other half is a fresh block entity, so anything readable there is a copy the pair carried.
    const otherContainer = containerOf(other);
    if (otherContainer) clearSlots(otherContainer, DOUBLE_CHEST_SLOTS);
}

function chestNeighbours(placed: Block): ChestNeighbour[] {
    const neighbours: ChestNeighbour[] = [];

    for (const offset of NEIGHBOUR_OFFSETS) {
        const found = guard(`neighbour:${offset.x},${offset.z}`, () => placed.offset(offset));
        if (!found.ok || !found.value) continue;
        if (found.value.typeId !== SINGLE_CHEST_ID) continue;

        neighbours.push({ offset, latch: directionStateOf(found.value) });
    }

    return neighbours;
}

function handleChestPlaced(event: PlayerPlaceBlockAfterEvent): void {
    const placed = event.block;
    if (!placed || placed.typeId !== SINGLE_CHEST_ID) return;

    const dimensionId = placed.dimension.id;
    const location: ChestLocation = { x: placed.location.x, y: placed.location.y, z: placed.location.z };

    // The merge empties both halves before the engine overwrites them, so it cannot run until the
    // placed chest's block entity is readable. Holding the id and the cell keeps no block reference
    // alive across the tick either.
    system.runTimeout(() => {
        try {
            mergeChestAt(dimensionId, location);
        } catch (e) {
            reportError({
                system: "doubleChest",
                operation: "mergeOnPlace",
                target: `${location.x},${location.y},${location.z}`
            }, e);
        }
    }, MERGE_DELAY_TICKS);
}

function mergeChestAt(dimensionId: string, location: ChestLocation): void {
    const placed = blockAt(dimensionId, location);
    if (!placed || placed.typeId !== SINGLE_CHEST_ID) return;

    const plan = planPair(directionStateOf(placed), chestNeighbours(placed));
    if (!plan) return;

    const masterLocation = offsetLocation(location, plan.masterOffset);
    const shadowLocation = offsetLocation(masterLocation, PAIR_LAYOUTS[plan.state].step);

    const master = blockAt(dimensionId, masterLocation);
    const shadow = blockAt(dimensionId, shadowLocation);
    if (!master || !shadow) return;
    if (master.typeId !== SINGLE_CHEST_ID || shadow.typeId !== SINGLE_CHEST_ID) return;

    mergePair(master, shadow, plan.state);
}

eventBus.onPlayerPlaceBlock(event => {
    try {
        handleChestPlaced(event);
    } catch (e) {
        reportError({ system: "doubleChest", operation: "mergeOnPlace", target: SINGLE_CHEST_ID }, e);
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
