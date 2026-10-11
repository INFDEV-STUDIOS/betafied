/**
 * Mock implementation of @minecraft/server for offline testing and integration verification.
 */

export const registeredBeforeEvents = new Map<string, Function[]>();
export const registeredAfterEvents = new Map<string, Function[]>();
export const scheduledIntervals: { id: number; callback: Function; interval: number }[] = [];
export const scheduledTimeouts: { id: number; callback: Function; timeout: number }[] = [];
export const activeJobs: Generator<void, void, unknown>[] = [];
export const activeJobEntries = new Map<number, Generator<void, void, unknown>>();
export const mockPlayers: any[] = [];
export const mockEntities = new Map<string, any>();
export const mockDynamicProperties = new Map<string, any>();

export let nextRunId = 1;

export function resetMocks(): void {
    registeredBeforeEvents.clear();
    registeredAfterEvents.clear();
    scheduledIntervals.length = 0;
    scheduledTimeouts.length = 0;
    activeJobs.length = 0;
    activeJobEntries.clear();
    mockPlayers.length = 0;
    mockEntities.clear();
    mockDynamicProperties.clear();
    for (const dim of dimensions.values()) {
        dim.blocks.clear();
    }
    nextRunId = 1;
}

function createEventSignal(registry: Map<string, Function[]>, name: string) {
    return {
        subscribe(callback: Function) {
            const list = registry.get(name) ?? [];
            list.push(callback);
            registry.set(name, list);
            return callback;
        },
        unsubscribe(callback: Function) {
            const list = registry.get(name) ?? [];
            const idx = list.indexOf(callback);
            if (idx >= 0) list.splice(idx, 1);
        }
    };
}

// Beta forbids stacking the custom foods and the bow; cookies cap at 8. Everything else defaults to
// the common 64, matching the item JSON the real engine reads for `maxAmount`.
const MOCK_UNSTACKABLE_IDS = new Set([
    "bh:apple", "bh:bread", "bh:porkchop", "bh:cooked_porkchop",
    "bh:cod", "bh:cooked_cod", "bh:golden_apple", "bh:bow",
    "minecraft:bow"
]);

export class ItemStack {
    typeId: string;
    amount: number;
    private components = new Map<string, any>();

    constructor(typeId: string, amount: number = 1) {
        this.typeId = typeId;
        this.amount = amount;
    }

    get maxAmount(): number {
        if (this.typeId === "bh:cookie" || this.typeId === "minecraft:cookie") return 8;
        return MOCK_UNSTACKABLE_IDS.has(this.typeId) ? 1 : 64;
    }

    getComponent(componentId: string) {
        return this.components.get(componentId) ?? null;
    }

    setComponent(componentId: string, comp: any) {
        this.components.set(componentId, comp);
    }
}

export class BlockPermutation {
    private static cache = new Map<string, BlockPermutation>();

    readonly typeId: string;
    private states: Record<string, any>;

    get type(): { id: string } {
        return { id: this.typeId };
    }

    private constructor(typeId: string, states: Record<string, any> = {}) {
        this.typeId = typeId;
        this.states = { ...states };
    }

    static resolve(typeId: string, states: Record<string, any> = {}): BlockPermutation {
        const key = `${typeId}:${JSON.stringify(states)}`;
        let perm = BlockPermutation.cache.get(key);
        if (!perm) {
            perm = new BlockPermutation(typeId, states);
            BlockPermutation.cache.set(key, perm);
        }
        return perm;
    }

    getState(key: string): any {
        return this.states[key];
    }

    withState(key: string, value: any): BlockPermutation {
        const next = new BlockPermutation(this.typeId, { ...this.states, [key]: value });
        return next;
    }

    matches(typeId: string): boolean {
        return this.typeId === typeId;
    }
}

export class BlockVolume {
    readonly from: { x: number; y: number; z: number };
    readonly to: { x: number; y: number; z: number };

    constructor(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }) {
        this.from = from;
        this.to = to;
    }
}

export class MockDimension {
    readonly id: string;
    public blocks = new Map<string, any>();

    constructor(id: string) {
        this.id = id;
    }

    setBlock(location: { x: number; y: number; z: number }, blockData: any) {
        this.blocks.set(`${location.x},${location.y},${location.z}`, blockData);
    }

    getBlock(location: { x: number; y: number; z: number }) {
        const key = `${location.x},${location.y},${location.z}`;
        if (this.blocks.has(key)) {
            return this.blocks.get(key);
        }
        return {
            typeId: "minecraft:stone",
            permutation: BlockPermutation.resolve("minecraft:stone"),
            isSolid: true,
            isLiquid: false,
            setType(_typeId: string) {},
            setPermutation(_perm: BlockPermutation) {}
        };
    }

    getEntities(_query?: any) {
        return [...mockEntities.values()].filter((entity) => entity.dimension?.id === this.id);
    }

    getPlayers(query?: { location?: { x: number; y: number; z: number }; maxDistance?: number }) {
        return mockPlayers.filter((player) => {
            if (player.dimension?.id !== this.id) return false;
            if (!query?.location || query.maxDistance === undefined) return true;
            const distance = Math.hypot(
                player.location.x - query.location.x,
                player.location.z - query.location.z
            );
            return distance <= query.maxDistance;
        });
    }

    spawnEntity(typeId: string, location: { x: number; y: number; z: number }) {
        const entity = new Entity();
        entity.id = `mock_entity_${nextRunId++}`;
        entity.typeId = typeId;
        entity.location = { ...location };
        entity.dimension = this;
        mockEntities.set(entity.id, entity);

        for (const callback of registeredAfterEvents.get("entitySpawn") ?? []) {
            callback({ entity });
        }

        return entity;
    }

    spawnItem(_itemStack: ItemStack, _location: { x: number; y: number; z: number }) {
        return { id: "mock_item_entity", typeId: "minecraft:item" };
    }

    soundsPlayed: { soundId: string; location: any; options?: any }[] = [];

    playSound(soundId: string, location: any, options?: any) {
        this.soundsPlayed.push({ soundId, location, options });
    }

    runCommand(_command: string) {
        return { successCount: 1 };
    }
}

const dimensions = new Map<string, MockDimension>([
    ["overworld", new MockDimension("minecraft:overworld")],
    ["nether", new MockDimension("minecraft:the_nether")],
    ["the_end", new MockDimension("minecraft:the_end")],
    ["minecraft:overworld", new MockDimension("minecraft:overworld")],
    ["minecraft:the_nether", new MockDimension("minecraft:the_nether")],
    ["minecraft:the_end", new MockDimension("minecraft:the_end")]
]);

export const world = {
    timeOfDay: 0,
    getTimeOfDay() {
        return this.timeOfDay;
    },
    setTimeOfDay(time: number) {
        this.timeOfDay = time;
    },
    getAllPlayers() {
        return [...mockPlayers];
    },
    getPlayers() {
        return [...mockPlayers];
    },
    getEntity(id: string) {
        return mockEntities.get(id);
    },
    getDynamicProperty(identifier: string) {
        return mockDynamicProperties.get(identifier);
    },
    setDynamicProperty(identifier: string, value?: any) {
        if (value === undefined) {
            mockDynamicProperties.delete(identifier);
        } else {
            mockDynamicProperties.set(identifier, value);
        }
    },
    getDimension(dimensionId: string) {
        const dim = dimensions.get(dimensionId);
        if (!dim) {
            const created = new MockDimension(dimensionId);
            dimensions.set(dimensionId, created);
            return created;
        }
        return dim;
    },
    beforeEvents: {
        playerInteractWithBlock: createEventSignal(registeredBeforeEvents, "playerInteractWithBlock"),
        playerInteractWithEntity: createEventSignal(registeredBeforeEvents, "playerInteractWithEntity"),
        playerBreakBlock: createEventSignal(registeredBeforeEvents, "playerBreakBlock"),
        playerPlaceBlock: createEventSignal(registeredBeforeEvents, "playerPlaceBlock"),
        itemUse: createEventSignal(registeredBeforeEvents, "itemUse"),
        chatSend: createEventSignal(registeredBeforeEvents, "chatSend")
    },
    afterEvents: {
        entitySpawn: createEventSignal(registeredAfterEvents, "entitySpawn"),
        entityLoad: createEventSignal(registeredAfterEvents, "entityLoad"),
        entityDie: createEventSignal(registeredAfterEvents, "entityDie"),
        blockBreak: createEventSignal(registeredAfterEvents, "blockBreak"),
        entityHurt: createEventSignal(registeredAfterEvents, "entityHurt"),
        entityHitEntity: createEventSignal(registeredAfterEvents, "entityHitEntity"),
        playerSpawn: createEventSignal(registeredAfterEvents, "playerSpawn"),
        playerLeave: createEventSignal(registeredAfterEvents, "playerLeave"),
        playerPlaceBlock: createEventSignal(registeredAfterEvents, "playerPlaceBlock"),
        playerBreakBlock: createEventSignal(registeredAfterEvents, "playerBreakBlock"),
        blockContainerOpened: createEventSignal(registeredAfterEvents, "blockContainerOpened"),
        blockContainerClosed: createEventSignal(registeredAfterEvents, "blockContainerClosed"),
        playerDimensionChange: createEventSignal(registeredAfterEvents, "playerDimensionChange"),
        itemUse: createEventSignal(registeredAfterEvents, "itemUse"),
        itemStartUse: createEventSignal(registeredAfterEvents, "itemStartUse"),
        itemStopUse: createEventSignal(registeredAfterEvents, "itemStopUse"),
        itemReleaseUse: createEventSignal(registeredAfterEvents, "itemReleaseUse"),
        chatSend: createEventSignal(registeredAfterEvents, "chatSend"),
        worldInitialize: createEventSignal(registeredAfterEvents, "worldInitialize"),
        playerGameModeChange: createEventSignal(registeredAfterEvents, "playerGameModeChange"),
        playerInventoryItemChange: createEventSignal(registeredAfterEvents, "playerInventoryItemChange")
    }
};

export const system = {
    currentTick: 0,
    scheduledTimeouts,
    scheduledIntervals,
    activeJobs,
    beforeEvents: {
        startup: createEventSignal(registeredBeforeEvents, "startup")
    },
    afterEvents: {
        scriptEventReceive: createEventSignal(registeredAfterEvents, "scriptEventReceive")
    },
    run(callback: Function): number {
        const id = nextRunId++;
        scheduledTimeouts.push({ id, callback, timeout: 0 });
        return id;
    },
    runInterval(callback: Function, interval: number): number {
        const id = nextRunId++;
        scheduledIntervals.push({ id, callback, interval });
        return id;
    },
    runTimeout(callback: Function, timeout: number): number {
        const id = nextRunId++;
        scheduledTimeouts.push({ id, callback, timeout });
        return id;
    },
    runJob(generator: Generator<void, void, unknown>): number {
        const id = nextRunId++;
        activeJobs.push(generator);
        activeJobEntries.set(id, generator);
        return id;
    },
    clearJob(id: number): void {
        const gen = activeJobEntries.get(id);
        if (gen) {
            activeJobEntries.delete(id);
            const idx = activeJobs.indexOf(gen);
            if (idx >= 0) activeJobs.splice(idx, 1);
        }
    },
    clearRun(id: number): void {
        const intervalIdx = scheduledIntervals.findIndex(i => i.id === id);
        if (intervalIdx >= 0) scheduledIntervals.splice(intervalIdx, 1);
        const timeoutIdx = scheduledTimeouts.findIndex(t => t.id === id);
        if (timeoutIdx >= 0) scheduledTimeouts.splice(timeoutIdx, 1);
    },
    advanceTicks(ticks: number = 1): void {
        for (let t = 0; t < ticks; t++) {
            this.currentTick++;
            for (let i = activeJobs.length - 1; i >= 0; i--) {
                const job = activeJobs[i];
                try {
                    const res = job.next();
                    if (res.done) {
                        activeJobs.splice(i, 1);
                        for (const [id, g] of activeJobEntries) {
                            if (g === job) {
                                activeJobEntries.delete(id);
                                break;
                            }
                        }
                    }
                } catch {
                    activeJobs.splice(i, 1);
                    for (const [id, g] of activeJobEntries) {
                        if (g === job) {
                            activeJobEntries.delete(id);
                            break;
                        }
                    }
                }
            }
        }
    }
};

export const Direction = Object.freeze({
    Down: "Down",
    Up: "Up",
    North: "North",
    South: "South",
    West: "West",
    East: "East"
});

export const EquipmentSlot = Object.freeze({
    Head: "Head",
    Chest: "Chest",
    Legs: "Legs",
    Feet: "Feet",
    Mainhand: "Mainhand",
    Offhand: "Offhand"
});

export const CommandPermissionLevel = Object.freeze({
    Any: 0,
    GameDirectors: 1,
    Admin: 2,
    Host: 3,
    Owner: 4
});

export const CustomCommandStatus = Object.freeze({
    Success: 0,
    Failure: 1
});

export const GameMode = Object.freeze({
    Survival: "survival",
    Creative: "creative",
    Adventure: "adventure",
    Spectator: "spectator"
});

export const HudElement = Object.freeze({
    PaperDoll: 0,
    Armor: 1,
    ToolTips: 2,
    TouchControls: 3,
    Crosshair: 4,
    Hotbar: 5,
    Health: 6,
    ProgressBar: 7,
    Hunger: 8,
    AirBubbles: 9,
    HorseHealth: 10,
    StatusEffects: 11,
    ItemText: 12
});

export const HudVisibility = Object.freeze({
    Hide: 0,
    Reset: 1
});

export const EntityDamageCause = Object.freeze({
    fall: "fall",
    fire: "fire",
    fireTick: "fireTick",
    lava: "lava",
    drowning: "drowning",
    suffocation: "suffocation",
    void: "void",
    starve: "starve",
    magic: "magic",
    wither: "wither",
    flyIntoWall: "flyIntoWall",
    entityAttack: "entityAttack",
    projectile: "projectile",
    entityExplosion: "entityExplosion",
    blockExplosion: "blockExplosion",
    selfDestruct: "selfDestruct",
    suicide: "suicide"
});

export const EntityComponentTypes = Object.freeze({
    Equippable: "minecraft:equippable",
    Inventory: "minecraft:inventory",
    Item: "minecraft:item",
    Health: "minecraft:health",
    Variant: "minecraft:variant",
    Movement: "minecraft:movement",
    Color: "minecraft:color",
    Riding: "minecraft:riding"
});

export const ItemComponentTypes = Object.freeze({
    Enchantable: "minecraft:enchantable",
    Durability: "minecraft:durability",
    Cooldown: "minecraft:cooldown"
});

export class Entity {
    id: string = "mock_entity";
    typeId: string = "minecraft:item";
    isValid: boolean = true;
    location: any = { x: 0, y: 64, z: 0 };
    dimension: any = dimensions.get("minecraft:overworld");
    protected components = new Map<string, any>();
    isRemoved: boolean = false;

    getComponent(typeId: string): any {
        return this.components.get(typeId);
    }

    setComponent(typeId: string, component: any): void {
        this.components.set(typeId, component);
    }

    remove(): void {
        this.isValid = false;
        this.isRemoved = true;
    }

    kill(): void {
        this.isValid = false;
        this.isRemoved = true;
    }

    getVelocity(): { x: number; y: number; z: number } {
        return { x: 0, y: 0, z: 0 };
    }

    nameTag: string = "";
    rotation: { x: number; y: number } = { x: 0, y: 0 };
    public animationsPlayed: string[] = [];

    getHeadLocation(): { x: number; y: number; z: number } {
        return { x: this.location.x, y: this.location.y + 1.62, z: this.location.z };
    }

    getViewDirection(): { x: number; y: number; z: number } {
        return { x: 0, y: 0, z: 1 };
    }

    setRotation(rotation: { x: number; y: number }): void {
        this.rotation = { ...rotation };
    }

    teleport(location: { x: number; y: number; z: number }): void {
        this.location = { ...location };
    }

    playAnimation(animationName: string): void {
        this.animationsPlayed.push(animationName);
    }

    // Tags are on `Entity`, not on `Player`: the engine lets any entity wear one, and a destructive
    // gate that recognizes another addon's entity has to ask a mob and an item the same question.
    private tags = new Set<string>();

    addTag(tag: string): boolean {
        this.tags.add(tag);
        return true;
    }

    hasTag(tag: string): boolean {
        return this.tags.has(tag);
    }

    removeTag(tag: string): boolean {
        return this.tags.delete(tag);
    }

    getTags(): string[] {
        return [...this.tags];
    }
}

export class Player extends Entity {
    name: string = "Steve";
    public gameMode: string = GameMode.Survival;
    public commandsRun: string[] = [];
    public messagesSent: string[] = [];

    constructor(id: string = "mock_player", name: string = "Steve") {
        super();
        this.id = id;
        this.name = name;
        this.typeId = "minecraft:player";
    }

    sendMessage(msg: string): void {
        this.messagesSent.push(msg);
    }

    getGameMode(): string {
        return this.gameMode;
    }

    public animationsPlayed: { animationName: string; options?: any }[] = [];
    public soundsPlayed: { soundId: string; options?: any }[] = [];

    public onScreenDisplay = {
        titles: [] as string[],
        hiddenHudElements: [] as number[],
        setTitle(text: string) {
            this.titles.push(text);
        },
        setHudVisibility(visibility: number, hudElements?: number[]) {
            if (visibility === HudVisibility.Hide && hudElements) {
                this.hiddenHudElements.push(...hudElements);
            }
        }
    };

    playAnimation(animationName: string, options?: any): void {
        this.animationsPlayed.push({ animationName, options });
    }

    playSound(soundId: string, options?: any): void {
        this.soundsPlayed.push({ soundId, options });
    }

    runCommand(cmd: string) {
        this.commandsRun.push(cmd);
        return { successCount: 1 };
    }
}
export class Container {
    private slots = new Map<number, any>();
    public readonly size: number;

    constructor(size: number = 36) {
        this.size = size;
    }

    getItem(slot: number): any {
        return this.slots.get(slot);
    }

    setItem(slot: number, item?: any): void {
        if (item === undefined || item === null) {
            this.slots.delete(slot);
        } else {
            this.slots.set(slot, item);
        }
    }

    addItem(item: any): any {
        for (let i = 0; i < this.size; i++) {
            if (!this.slots.has(i)) {
                this.slots.set(i, item);
                return undefined;
            }
        }
        return item;
    }
}
export class Block {}
export class Dimension {}
export class Vector3 {}
export class PlayerInteractWithBlockBeforeEvent {}
export class PlayerBreakBlockBeforeEvent {}
export class PlayerPlaceBlockAfterEvent {}
export class ItemComponentUseOnEvent {}
export class EntityHealthComponent {}
export class EntityEquippableComponent {
    private equipment = new Map<string, any>();

    getEquipment(slot: string): any {
        return this.equipment.get(slot);
    }

    setEquipment(slot: string, itemStack?: any): boolean {
        if (itemStack === undefined || itemStack === null) {
            this.equipment.delete(slot);
        } else {
            this.equipment.set(slot, itemStack);
        }
        return true;
    }
}
export class EntityRidingComponent {}
export class ItemUseBeforeEvent {}
export class PlayerGameModeChangeAfterEvent {
    readonly player: any;
    readonly fromGameMode: string;
    readonly toGameMode: string;

    constructor(player: any, fromGameMode: string, toGameMode: string) {
        this.player = player;
        this.fromGameMode = fromGameMode;
        this.toGameMode = toGameMode;
    }
}




