import {
    EntityDamageCause,
    Player,
    ItemComponentTypes,
    EntityComponentTypes,
    GameMode,
    world
} from "@minecraft/server";
import { eventBus } from "../core/eventBus.js";
import { tickManager } from "../core/tickManager.js";
import { runCatching } from "../core/errorReporter.js";
import { ARMOR_SLOTS } from "../core/equipmentSlots.js";
import { isVanillaId } from "../core/betaRegistry.js";

const ARMOR_TABLE: Readonly<Record<string, number>> = Object.freeze({
    "minecraft:leather_helmet": 1, "minecraft:leather_chestplate": 3,
    "minecraft:leather_leggings": 2, "minecraft:leather_boots": 1,
    "minecraft:golden_helmet": 2, "minecraft:golden_chestplate": 5,
    "minecraft:golden_leggings": 3, "minecraft:golden_boots": 1,
    "minecraft:chainmail_helmet": 2, "minecraft:chainmail_chestplate": 5,
    "minecraft:chainmail_leggings": 4, "minecraft:chainmail_boots": 1,
    "minecraft:iron_helmet": 2, "minecraft:iron_chestplate": 6,
    "minecraft:iron_leggings": 5, "minecraft:iron_boots": 2,
    "minecraft:diamond_helmet": 3, "minecraft:diamond_chestplate": 8,
    "minecraft:diamond_leggings": 6, "minecraft:diamond_boots": 3
});

const BYPASS_SOURCES = Object.freeze(new Set([
    EntityDamageCause.void,
    EntityDamageCause.starve,
    EntityDamageCause.selfDestruct,
    "suicide"
]));

export function damageArmor(player: Player): void {
    const equip = player.getComponent(EntityComponentTypes.Equippable);
    if (!equip) return;

    for (const slot of ARMOR_SLOTS) {
        const item = equip.getEquipment(slot);
        if (!item) continue;

        if (getBaseArmorPoints(item.typeId) <= 0) continue;

        const dur = item.getComponent(ItemComponentTypes.Durability);
        if (!dur || dur.maxDurability <= 0) continue;

        const nextDamage = dur.damage + 1;
        if (nextDamage >= dur.maxDurability) {
            equip.setEquipment(slot, undefined);
            runCatching({ system: "armor", operation: "breakSound", target: player.id }, () => {
                if (typeof player.playSound === "function") {
                    player.playSound("random.break", { volume: 1.0, pitch: 0.9 });
                }
            });
        } else {
            dur.damage = nextDamage;
            equip.setEquipment(slot, item);
        }
    }
}

export function getBaseArmorPoints(typeId: string): number {
    const direct = ARMOR_TABLE[typeId];
    if (direct !== undefined) return direct;

    const colonIdx = typeId.indexOf(":");
    const baseName = colonIdx >= 0 ? typeId.substring(colonIdx + 1) : typeId;
    const mcEquivalent = `minecraft:${baseName}`;
    const mcDirect = ARMOR_TABLE[mcEquivalent];
    if (mcDirect !== undefined) return mcDirect;

    // A vanilla id reaches this point only when it is not authentic Beta armor (netherite, turtle),
    // so it gets no points. The suffix heuristic exists for third-party addon armor, which cannot be
    // enumerated here; applying it to a vanilla id would contradict the registry that strips the gear.
    if (isVanillaId(typeId)) return 0;

    if (baseName.endsWith("_helmet") || baseName.endsWith("_cap")) return 2;
    if (baseName.endsWith("_chestplate") || baseName.endsWith("_tunic")) return 6;
    if (baseName.endsWith("_leggings") || baseName.endsWith("_pants")) return 5;
    if (baseName.endsWith("_boots")) return 2;

    return 0;
}

export interface ArmorMitigationResult {
    damageInflicted: number;
    damageAbsorbed: number;
    updatedRemainder: number;
}

export function computeBetaArmorMitigation(
    incomingDamage: number,
    defenseRating: number,
    previousRemainder = 0
): ArmorMitigationResult {
    if (incomingDamage <= 0 || defenseRating <= 0) {
        return {
            damageInflicted: incomingDamage,
            damageAbsorbed: 0,
            updatedRemainder: previousRemainder
        };
    }

    const wholeDamage = Math.floor(incomingDamage);
    const penetrationFactor = 25 - Math.min(25, defenseRating);
    const accumulatedUnits = wholeDamage * penetrationFactor + previousRemainder;

    const damageInflicted = Math.floor(accumulatedUnits / 25);
    const updatedRemainder = accumulatedUnits % 25;
    const damageAbsorbed = Math.max(0, wholeDamage - damageInflicted);

    return { damageInflicted, damageAbsorbed, updatedRemainder };
}

export function getEffectiveArmorPoints(player: Player): number {
    const equip = player.getComponent(EntityComponentTypes.Equippable);
    if (!equip) return 0;

    let basePointsTotal = 0;
    let durabilityRemaining = 0;
    let durabilityMax = 0;

    for (const slot of ARMOR_SLOTS) {
        const item = equip.getEquipment(slot);
        if (!item) continue;

        const base = getBaseArmorPoints(item.typeId);
        if (!base) continue;

        basePointsTotal += base;

        const dur = item.getComponent(ItemComponentTypes.Durability);
        if (dur && dur.maxDurability > 0) {
            const currentDamage = Math.max(0, dur.damage ?? 0);
            durabilityRemaining += Math.max(0, dur.maxDurability - currentDamage);
            durabilityMax += dur.maxDurability;
        } else {
            durabilityRemaining += 1;
            durabilityMax += 1;
        }
    }

    if (basePointsTotal <= 0 || durabilityMax <= 0) return 0;

    // Beta 1.7.3 InventoryPlayer.getTotalArmorValue(): ((basePoints - 1) * remainingDur) / maxDur + 1
    const scaled = Math.floor(((basePointsTotal - 1) * durabilityRemaining) / durabilityMax) + 1;
    return Math.max(0, Math.min(20, scaled));
}

const lastSentArmorPoints = new Map<string, number>();
const fractionalDamageCarryovers = new Map<string, number>();

export function getPlayerDamageCarryover(playerId: string): number {
    return fractionalDamageCarryovers.get(playerId) ?? 0;
}

export function setPlayerDamageCarryover(playerId: string, remainder: number): void {
    if (remainder <= 0) {
        fractionalDamageCarryovers.delete(playerId);
    } else {
        fractionalDamageCarryovers.set(playerId, remainder);
    }
}

export function clearPlayerDamageCarryover(playerId: string): void {
    fractionalDamageCarryovers.delete(playerId);
}

export function updatePlayerArmorDisplay(player: Player, force = false): void {
    if (!player.isValid) return;

    const isCreative = typeof player.getGameMode === "function" &&
        (player.getGameMode() === GameMode.Creative || player.getGameMode() === GameMode.Spectator);
    const current = isCreative ? 0 : Math.min(20, Math.max(0, Math.round(getEffectiveArmorPoints(player))));
    const last = lastSentArmorPoints.get(player.id);

    if (force || last === undefined || last !== current) {
        lastSentArmorPoints.set(player.id, current);
        runCatching({ system: "armor", operation: "updateDisplay", target: player.id }, () => {
            player.runCommand(`titleraw @s title {"rawtext":[{"text":"_a${current}"}]}`);
        });
    }
}

eventBus.onEntityHurt((ev) => {
    const player = ev.hurtEntity;
    const damage = ev.damage;
    const damageSource = ev.damageSource;

    if (!(player instanceof Player)) return;
    if (!player.isValid) return;
    if (damage <= 0) return;
    if (typeof player.getGameMode === "function" && player.getGameMode() === GameMode.Creative) return;
    if (BYPASS_SOURCES.has(damageSource.cause)) return;

    const points = getEffectiveArmorPoints(player);
    if (points > 0) {
        const carryover = getPlayerDamageCarryover(player.id);
        const { damageAbsorbed, updatedRemainder } = computeBetaArmorMitigation(damage, points, carryover);
        setPlayerDamageCarryover(player.id, updatedRemainder);

        if (damageAbsorbed > 0) {
            const health = player.getComponent(EntityComponentTypes.Health);
            if (health && health.currentValue > 0) {
                const newHp = Math.min(health.currentValue + damageAbsorbed, health.effectiveMax);
                health.setCurrentValue(newHp);
            }
        }
    }

    damageArmor(player);
    updatePlayerArmorDisplay(player);
});

eventBus.onPlayerSpawn((ev) => {
    if (ev.player) {
        updatePlayerArmorDisplay(ev.player, true);
    }
});

eventBus.onPlayerLeave((ev) => {
    lastSentArmorPoints.delete(ev.playerId);
    clearPlayerDamageCarryover(ev.playerId);
});

tickManager.register("armorDisplay", 5, () => {
    for (const player of world.getAllPlayers()) {
        updatePlayerArmorDisplay(player);
    }
});

