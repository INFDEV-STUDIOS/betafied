import {
    world,
    system,
    Player,
    Entity,
    EntityDamageCause,
    EntityComponentTypes
} from "@minecraft/server";
import { eventBus } from "../core/eventBus.js";
import { tickManager } from "../core/tickManager.js";
import { reportError } from "../core/errorReporter.js";
import { BETA_HOSTILE_TYPES, BH_CRAFTING_TABLE_ID } from "../core/betaRegistry.js";


const ACH = Object.freeze({
    TAKING_INVENTORY: "inv",
    GETTING_WOOD: "wood",
    BENCHMARKING: "bench",
    TIME_TO_STRIKE: "sword",
    TIME_TO_FARM: "hoe",
    TIME_TO_MINE: "pick",
    MONSTER_HUNTER: "kill",
    COW_TIPPER: "cow",
    WHEN_PIGS_FLY: "pig",
    BAKE_BREAD: "bread",
    THE_LIE: "cake",
    GETTING_UPGRADE: "stone",
    DELICIOUS_FISH: "fish",
    HOT_TOPIC: "furnace",
    ACQUIRE_HARDWARE: "iron",
    ON_A_RAIL: "rail"
});

type AchievementKey = typeof ACH[keyof typeof ACH];

const PARENTS: Readonly<Partial<Record<AchievementKey, AchievementKey>>> = Object.freeze({
    [ACH.GETTING_WOOD]: ACH.TAKING_INVENTORY,
    [ACH.BENCHMARKING]: ACH.GETTING_WOOD,
    [ACH.TIME_TO_STRIKE]: ACH.BENCHMARKING,
    [ACH.TIME_TO_FARM]: ACH.BENCHMARKING,
    [ACH.TIME_TO_MINE]: ACH.BENCHMARKING,
    [ACH.MONSTER_HUNTER]: ACH.TIME_TO_STRIKE,
    [ACH.COW_TIPPER]: ACH.TIME_TO_STRIKE,
    [ACH.WHEN_PIGS_FLY]: ACH.COW_TIPPER,
    [ACH.BAKE_BREAD]: ACH.TIME_TO_FARM,
    [ACH.THE_LIE]: ACH.TIME_TO_FARM,
    [ACH.GETTING_UPGRADE]: ACH.TIME_TO_MINE,
    [ACH.HOT_TOPIC]: ACH.GETTING_UPGRADE,
    [ACH.DELICIOUS_FISH]: ACH.HOT_TOPIC,
    [ACH.ACQUIRE_HARDWARE]: ACH.HOT_TOPIC,
    [ACH.ON_A_RAIL]: ACH.ACQUIRE_HARDWARE
});

const TITLES: Readonly<Record<AchievementKey, string>> = Object.freeze({
    [ACH.TAKING_INVENTORY]: "Taking Inventory",
    [ACH.GETTING_WOOD]: "Getting Wood",
    [ACH.BENCHMARKING]: "Benchmarking",
    [ACH.TIME_TO_STRIKE]: "Time to Strike!",
    [ACH.TIME_TO_FARM]: "Time to Farm!",
    [ACH.TIME_TO_MINE]: "Time to Mine!",
    [ACH.MONSTER_HUNTER]: "Monster Hunter",
    [ACH.COW_TIPPER]: "Cow Tipper",
    [ACH.WHEN_PIGS_FLY]: "When Pigs Fly",
    [ACH.BAKE_BREAD]: "Bake Bread",
    [ACH.THE_LIE]: "The Lie",
    [ACH.GETTING_UPGRADE]: "Getting an Upgrade",
    [ACH.DELICIOUS_FISH]: "Delicious Fish",
    [ACH.HOT_TOPIC]: "Hot Topic",
    [ACH.ACQUIRE_HARDWARE]: "Acquire Hardware",
    [ACH.ON_A_RAIL]: "On A Rail"
});

const TOTAL_ACHIEVEMENTS = Object.keys(ACH).length;

class AchievementSystem {
    constructor() {
        this.setupEvents();
    }

    private setupEvents(): void {
        system.afterEvents.scriptEventReceive.subscribe((ev) => {
            if (ev.id === "betafied:achievements") {
                const player = ev.sourceEntity;
                if (player instanceof Player) {
                    if (ev.message.trim().toLowerCase() === "reset") {
                        this.resetAchievements(player);
                    } else {
                        this.openUI(player);
                    }
                }
            }
        });

        eventBus.onChatSend((ev) => {
            const sender = ev.sender;
            if (!sender?.isValid) return;
            const msg = ev.message.trim().toLowerCase();
            if (msg === "!achievements" || msg === "!ach") {
                this.openUI(sender);
            } else if (msg === "!achievements reset") {
                this.resetAchievements(sender);
            }
        });

        eventBus.onPlayerSpawn((ev) => {
            if (ev.initialSpawn) {
                this.grant(ev.player, ACH.TAKING_INVENTORY);
            }
        });

        eventBus.onPlayerBreakBlock((ev) => {
            if (ev.brokenBlockPermutation.type.id.includes("_log")) {
                this.grant(ev.player, ACH.GETTING_WOOD);
            }
        });

        tickManager.register("achievements:checkPlayers", 100, () => this.checkAllPlayers(), 45);

        eventBus.onEntityDie((ev) => {
            const damager = ev.damageSource.damagingEntity;
            if (damager && damager.typeId === "minecraft:player" && damager instanceof Player) {
                const victim = ev.deadEntity;
                if (victim && BETA_HOSTILE_TYPES.has(victim.typeId)) {
                    this.grant(damager, ACH.MONSTER_HUNTER);
                }
            }
        });

        eventBus.onEntityHurt((ev) => {
            const { hurtEntity, damageSource } = ev;

            if (hurtEntity.typeId === "minecraft:pig" && damageSource.cause === EntityDamageCause.fall) {
                const rideable = hurtEntity.getComponent(EntityComponentTypes.Rideable);
                const riders = rideable?.getRiders();

                if (riders && riders.length > 0) {
                    for (const rider of riders) {
                        if (rider.typeId === "minecraft:player" && rider instanceof Player) {
                            this.grant(rider, ACH.WHEN_PIGS_FLY);
                        }
                    }
                }
            }
        });
    }

    private *checkAllPlayers(): Generator<void, void, unknown> {
        for (const player of world.getAllPlayers()) {
            try {
                this.checkInventory(player);
                this.checkRiding(player);
            } catch (e) {
                reportError({
                    system: "achievements",
                    operation: "checkPlayer",
                    target: player.id
                }, e);
            }
            yield;
        }
    }

    private checkRiding(player: Player): void {
        const riding = player.getComponent(EntityComponentTypes.Riding);
        if (!riding) return;

        try {
            const vehicle: Entity = riding.entityRidingOn;
            if (vehicle?.isValid && vehicle.typeId === "minecraft:minecart") {
                this.grant(player, ACH.ON_A_RAIL);
            }
        } catch {
            // entityRidingOn can throw if vehicle entity became invalid
        }
    }

    private checkInventory(player: Player): void {
        const invComp = player.getComponent(EntityComponentTypes.Inventory);
        const inv = invComp?.container;
        if (!inv) return;

        this.grant(player, ACH.TAKING_INVENTORY);

        let hasLog = false;
        let hasLeather = false;
        let hasBread = false;
        let hasCake = false;
        let hasFish = false;
        let hasWoodPick = false;
        let hasStonePick = false;
        let hasBench = false;
        let hasSword = false;
        let hasHoe = false;
        let hasFurnace = false;
        let hasIron = false;

        const size = inv.size;
        for (let i = 0; i < size; i++) {
            const item = inv.getItem(i);
            if (!item) continue;
            const id = item.typeId;

            if (id.includes("_log")) hasLog = true;
            if (id === "minecraft:crafting_table" || id === BH_CRAFTING_TABLE_ID) hasBench = true;
            if (id.includes("_sword")) hasSword = true;
            if (id.includes("_hoe")) hasHoe = true;
            if (id.includes("_pickaxe")) hasWoodPick = true;
            if (id.includes("stone_pickaxe") || id.includes("iron_pickaxe") ||
                id.includes("golden_pickaxe") || id.includes("diamond_pickaxe")) hasStonePick = true;
            if (id === "minecraft:leather") hasLeather = true;
            if (id === "minecraft:bread" || id === "bh:bread") hasBread = true;
            if (id === "minecraft:cake") hasCake = true;
            if (id === "minecraft:cooked_cod" || id === "bh:cooked_cod") hasFish = true;
            if (id === "minecraft:furnace") hasFurnace = true;
            if (id === "minecraft:iron_ingot") hasIron = true;
        }

        if (hasLog) this.grant(player, ACH.GETTING_WOOD);
        if (hasBench) this.grant(player, ACH.BENCHMARKING);
        if (hasSword) this.grant(player, ACH.TIME_TO_STRIKE);
        if (hasHoe) this.grant(player, ACH.TIME_TO_FARM);
        if (hasWoodPick) this.grant(player, ACH.TIME_TO_MINE);
        if (hasStonePick) this.grant(player, ACH.GETTING_UPGRADE);
        if (hasLeather) this.grant(player, ACH.COW_TIPPER);
        if (hasBread) this.grant(player, ACH.BAKE_BREAD);
        if (hasCake) this.grant(player, ACH.THE_LIE);
        if (hasFish) this.grant(player, ACH.DELICIOUS_FISH);
        if (hasFurnace) this.grant(player, ACH.HOT_TOPIC);
        if (hasIron) this.grant(player, ACH.ACQUIRE_HARDWARE);
    }

    public has(player: Player, key: AchievementKey): boolean {
        return player.getDynamicProperty(`ach:${key}`) === true;
    }

    public getUnlockedCount(player: Player): number {
        let count = 0;
        for (const key of Object.values(ACH)) {
            if (this.has(player, key)) count++;
        }
        return count;
    }

    public grant(player: Player, key: AchievementKey): void {
        if (this.has(player, key)) return;

        const parent = PARENTS[key];
        if (parent && !this.has(player, parent)) return;

        player.setDynamicProperty(`ach:${key}`, true);
        this.toast(player, key);
    }

    private toast(player: Player, key: AchievementKey): void {
        const title = TITLES[key];
        player.sendMessage("§eAchievement get!");
        player.sendMessage(`§f${title}`);
        player.playSound("random.levelup");
    }

    public resetAchievements(player: Player): void {
        for (const key of Object.values(ACH)) {
            player.setDynamicProperty(`ach:${key}`, undefined);
        }
        player.sendMessage("§cAchievements reset!");
    }

    public openUI(player: Player): void {
        const count = this.getUnlockedCount(player);
        player.sendMessage(`§e--- Beta Achievements (${count}/${TOTAL_ACHIEVEMENTS}) ---`);

        for (const key of Object.values(ACH)) {
            const unlocked = this.has(player, key);
            const title = TITLES[key];
            const parent = PARENTS[key];
            const parentUnlocked = !parent || this.has(player, parent);

            if (unlocked) {
                player.sendMessage(`§a[✔] ${title}`);
            } else if (parentUnlocked) {
                player.sendMessage(`§f[ ] ${title}`);
            } else if (parent) {
                const parentTitle = TITLES[parent];
                player.sendMessage(`§7[?] ??? (Need: ${parentTitle})`);
            }
        }
    }
}

new AchievementSystem();
