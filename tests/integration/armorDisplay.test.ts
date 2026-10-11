import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    getBaseArmorPoints,
    getEffectiveArmorPoints,
    updatePlayerArmorDisplay,
    damageArmor,
    computeBetaArmorMitigation
} from "../../packs/BP/scripts/combat/armor.js";
import {
    Player,
    EquipmentSlot,
    EntityComponentTypes,
    ItemComponentTypes,
    EntityDamageCause,
    GameMode
} from "../mocks/minecraftServer.js";
import { eventBus } from "../../packs/BP/scripts/core/eventBus.js";

describe("Beta Armor Points & Titleraw HUD Display", () => {
    describe("getBaseArmorPoints", () => {
        it("returns authentic points for vanilla armor", () => {
            assert.equal(getBaseArmorPoints("minecraft:diamond_helmet"), 3);
            assert.equal(getBaseArmorPoints("minecraft:diamond_chestplate"), 8);
            assert.equal(getBaseArmorPoints("minecraft:diamond_leggings"), 6);
            assert.equal(getBaseArmorPoints("minecraft:diamond_boots"), 3);
            assert.equal(getBaseArmorPoints("minecraft:iron_chestplate"), 6);
            assert.equal(getBaseArmorPoints("minecraft:leather_helmet"), 1);
        });

        it("correctly resolves custom namespace armor matching vanilla names", () => {
            assert.equal(getBaseArmorPoints("bh:diamond_helmet"), 3);
            assert.equal(getBaseArmorPoints("bh:diamond_chestplate"), 8);
            assert.equal(getBaseArmorPoints("custom:iron_boots"), 2);
        });

        it("provides fallback heuristics for arbitrary custom armor pieces", () => {
            assert.equal(getBaseArmorPoints("custom:ruby_chestplate"), 6);
            assert.equal(getBaseArmorPoints("custom:obsidian_helmet"), 2);
            assert.equal(getBaseArmorPoints("custom:emerald_leggings"), 5);
            assert.equal(getBaseArmorPoints("custom:topaz_boots"), 2);
        });

        it("returns 0 for non-armor items", () => {
            assert.equal(getBaseArmorPoints("minecraft:stick"), 0);
            assert.equal(getBaseArmorPoints("minecraft:apple"), 0);
        });
    });

    describe("getEffectiveArmorPoints", () => {
        it("returns 0 when player has no equippable component or no armor", () => {
            const player = new Player();
            assert.equal(getEffectiveArmorPoints(player as any), 0);
        });

        it("calculates 20 full points for undamaged diamond armor", () => {
            const player = new Player();
            const equipment = new Map<EquipmentSlot, any>([
                [EquipmentSlot.Head, { typeId: "minecraft:diamond_helmet", getComponent: () => null }],
                [EquipmentSlot.Chest, { typeId: "minecraft:diamond_chestplate", getComponent: () => null }],
                [EquipmentSlot.Legs, { typeId: "minecraft:diamond_leggings", getComponent: () => null }],
                [EquipmentSlot.Feet, { typeId: "minecraft:diamond_boots", getComponent: () => null }]
            ]);

            player.setComponent(EntityComponentTypes.Equippable, {
                getEquipment: (slot: EquipmentSlot) => equipment.get(slot) || null
            });

            const points = getEffectiveArmorPoints(player as any);
            assert.equal(points, 20);
        });

        it("scales points proportionally to durability for damaged armor", () => {
            const player = new Player();
            const equipment = new Map<EquipmentSlot, any>([
                [EquipmentSlot.Chest, {
                    typeId: "minecraft:diamond_chestplate",
                    getComponent: (type: string) => {
                        if (type === ItemComponentTypes.Durability) {
                            return { maxDurability: 100, damage: 50 };
                        }
                        return null;
                    }
                }]
            ]);

            player.setComponent(EntityComponentTypes.Equippable, {
                getEquipment: (slot: EquipmentSlot) => equipment.get(slot) || null
            });

            const points = getEffectiveArmorPoints(player as any);
            assert.equal(points, 4); // 8 base * 50% durability = 4 points
        });
    });

    describe("updatePlayerArmorDisplay", () => {
        it("broadcasts titleraw command with _a prefix and points to update the HUD", () => {
            const player = new Player();
            player.id = "test_player_armor_1";

            const equipment = new Map<EquipmentSlot, any>([
                [EquipmentSlot.Chest, { typeId: "minecraft:diamond_chestplate", getComponent: () => null }]
            ]);

            player.setComponent(EntityComponentTypes.Equippable, {
                getEquipment: (slot: EquipmentSlot) => equipment.get(slot) || null
            });

            updatePlayerArmorDisplay(player as any, true);

            assert.equal(player.commandsRun.length, 1);
            assert.equal(player.commandsRun[0], 'titleraw @s title {"rawtext":[{"text":"_a8"}]}');
        });

        it("does not re-broadcast titleraw if armor points remain unchanged", () => {
            const player = new Player();
            player.id = "test_player_armor_2";

            const equipment = new Map<EquipmentSlot, any>([
                [EquipmentSlot.Chest, { typeId: "minecraft:diamond_chestplate", getComponent: () => null }]
            ]);

            player.setComponent(EntityComponentTypes.Equippable, {
                getEquipment: (slot: EquipmentSlot) => equipment.get(slot) || null
            });

            updatePlayerArmorDisplay(player as any, true);
            assert.equal(player.commandsRun.length, 1);

            // Second call with same armor should not run command
            updatePlayerArmorDisplay(player as any, false);
            assert.equal(player.commandsRun.length, 1);
        });

        it("sends _a0 and suppresses armor display when player is in Creative mode", () => {
            const player = new Player();
            player.id = "test_player_creative";
            player.gameMode = GameMode.Creative;

            const equipment = new Map<EquipmentSlot, any>([
                [EquipmentSlot.Chest, { typeId: "minecraft:diamond_chestplate", getComponent: () => null }]
            ]);

            player.setComponent(EntityComponentTypes.Equippable, {
                getEquipment: (slot: EquipmentSlot) => equipment.get(slot) || null
            });

            updatePlayerArmorDisplay(player as any, true);

            assert.equal(player.commandsRun.length, 1);
            assert.equal(player.commandsRun[0], 'titleraw @s title {"rawtext":[{"text":"_a0"}]}');
        });

        it("updates display to _a0 when switching from Survival to Creative, and restores upon return", () => {
            const player = new Player();
            player.id = "test_player_switch";
            player.gameMode = GameMode.Survival;

            const equipment = new Map<EquipmentSlot, any>([
                [EquipmentSlot.Chest, { typeId: "minecraft:diamond_chestplate", getComponent: () => null }]
            ]);

            player.setComponent(EntityComponentTypes.Equippable, {
                getEquipment: (slot: EquipmentSlot) => equipment.get(slot) || null
            });

            // In survival, displays 8 armor points
            updatePlayerArmorDisplay(player as any, true);
            assert.equal(player.commandsRun[player.commandsRun.length - 1], 'titleraw @s title {"rawtext":[{"text":"_a8"}]}');

            // Switch to creative mode
            player.gameMode = GameMode.Creative;
            updatePlayerArmorDisplay(player as any, false);
            assert.equal(player.commandsRun[player.commandsRun.length - 1], 'titleraw @s title {"rawtext":[{"text":"_a0"}]}');

            // Switch back to survival mode
            player.gameMode = GameMode.Survival;
            updatePlayerArmorDisplay(player as any, false);
            assert.equal(player.commandsRun[player.commandsRun.length - 1], 'titleraw @s title {"rawtext":[{"text":"_a8"}]}');
        });

        it("suppresses armor display when player is in Spectator mode", () => {
            const player = new Player();
            player.id = "test_player_spectator";
            player.gameMode = GameMode.Spectator;

            const equipment = new Map<EquipmentSlot, any>([
                [EquipmentSlot.Chest, { typeId: "minecraft:diamond_chestplate", getComponent: () => null }]
            ]);

            player.setComponent(EntityComponentTypes.Equippable, {
                getEquipment: (slot: EquipmentSlot) => equipment.get(slot) || null
            });

            updatePlayerArmorDisplay(player as any, true);

            assert.equal(player.commandsRun.length, 1);
            assert.equal(player.commandsRun[0], 'titleraw @s title {"rawtext":[{"text":"_a0"}]}');
        });
    });

    describe("damageArmor - Classic Beta 1.7.3 Durability Degradation", () => {
        it("increments damage by 1 on all equipped armor pieces with durability", () => {
            const player = new Player();
            player.id = "test_player_damage_armor";

            const helmetDur = { maxDurability: 100, damage: 10 };
            const chestDur = { maxDurability: 200, damage: 20 };

            const equipment = new Map<EquipmentSlot, any>([
                [EquipmentSlot.Head, {
                    typeId: "minecraft:diamond_helmet",
                    getComponent: (type: string) => type === ItemComponentTypes.Durability ? helmetDur : null
                }],
                [EquipmentSlot.Chest, {
                    typeId: "minecraft:diamond_chestplate",
                    getComponent: (type: string) => type === ItemComponentTypes.Durability ? chestDur : null
                }]
            ]);

            player.setComponent(EntityComponentTypes.Equippable, {
                getEquipment: (slot: EquipmentSlot) => equipment.get(slot) || null,
                setEquipment: (slot: EquipmentSlot, item: any) => {
                    if (!item) equipment.delete(slot);
                    else equipment.set(slot, item);
                    return true;
                }
            });

            damageArmor(player as any);

            assert.equal(helmetDur.damage, 11);
            assert.equal(chestDur.damage, 21);
        });

        it("breaks and clears armor piece when damage reaches maxDurability, playing break sound", () => {
            const player = new Player();
            player.id = "test_player_break_armor";

            const helmetDur = { maxDurability: 50, damage: 49 };

            const equipment = new Map<EquipmentSlot, any>([
                [EquipmentSlot.Head, {
                    typeId: "minecraft:iron_helmet",
                    getComponent: (type: string) => type === ItemComponentTypes.Durability ? helmetDur : null
                }]
            ]);

            player.setComponent(EntityComponentTypes.Equippable, {
                getEquipment: (slot: EquipmentSlot) => equipment.get(slot) || null,
                setEquipment: (slot: EquipmentSlot, item: any) => {
                    if (!item) equipment.delete(slot);
                    else equipment.set(slot, item);
                    return true;
                }
            });

            damageArmor(player as any);

            assert.equal(equipment.get(EquipmentSlot.Head), undefined);
            assert.equal(player.soundsPlayed.length, 1);
            assert.equal(player.soundsPlayed[0].soundId, "random.break");
        });

        it("ignores non-armor equipped items", () => {
            const player = new Player();
            player.id = "test_player_non_armor";

            const stickDur = { maxDurability: 100, damage: 0 };

            const equipment = new Map<EquipmentSlot, any>([
                [EquipmentSlot.Head, {
                    typeId: "minecraft:stick",
                    getComponent: (type: string) => type === ItemComponentTypes.Durability ? stickDur : null
                }]
            ]);

            player.setComponent(EntityComponentTypes.Equippable, {
                getEquipment: (slot: EquipmentSlot) => equipment.get(slot) || null,
                setEquipment: (slot: EquipmentSlot, item: any) => {
                    if (!item) equipment.delete(slot);
                    else equipment.set(slot, item);
                    return true;
                }
            });

            damageArmor(player as any);

            assert.equal(stickDur.damage, 0);
        });
    });

    describe("onEntityHurt Durability Loss & Parity", () => {
        it("reduces armor durability and restores blocked health when taking combat damage", () => {
            const player = new Player();
            player.id = "test_player_combat_hurt";
            const chestDur = { maxDurability: 200, damage: 0 };

            const equipment = new Map<EquipmentSlot, any>([
                [EquipmentSlot.Chest, {
                    typeId: "minecraft:diamond_chestplate",
                    getComponent: (type: string) => type === ItemComponentTypes.Durability ? chestDur : null
                }]
            ]);

            player.setComponent(EntityComponentTypes.Equippable, {
                getEquipment: (slot: EquipmentSlot) => equipment.get(slot) || null,
                setEquipment: (slot: EquipmentSlot, item: any) => {
                    if (!item) equipment.delete(slot);
                    else equipment.set(slot, item);
                    return true;
                }
            });

            const health = { currentValue: 18, effectiveMax: 20, setCurrentValue(v: number) { this.currentValue = v; } };
            player.setComponent(EntityComponentTypes.Health, health);

            eventBus.dispatch("entityHurt", {
                hurtEntity: player,
                damage: 4,
                damageSource: { cause: EntityDamageCause.entityAttack }
            });

            assert.equal(chestDur.damage, 1);
            // Beta 1.7.3 EntityPlayer damage: weighted = 4 * (25 - 8) + 0 = 68; betaDamage = floor(68/25) = 2; blocked = 4 - 2 = 2.
            assert.equal(health.currentValue, 20);
        });

        it("reduces armor durability on authentic Beta environmental damage (fall, fire)", () => {
            const player = new Player();
            player.id = "test_player_env_hurt";
            const bootsDur = { maxDurability: 100, damage: 5 };

            const equipment = new Map<EquipmentSlot, any>([
                [EquipmentSlot.Feet, {
                    typeId: "minecraft:iron_boots",
                    getComponent: (type: string) => type === ItemComponentTypes.Durability ? bootsDur : null
                }]
            ]);

            player.setComponent(EntityComponentTypes.Equippable, {
                getEquipment: (slot: EquipmentSlot) => equipment.get(slot) || null,
                setEquipment: (slot: EquipmentSlot, item: any) => {
                    if (!item) equipment.delete(slot);
                    else equipment.set(slot, item);
                    return true;
                }
            });

            const health = { currentValue: 18, effectiveMax: 20, setCurrentValue(v: number) { this.currentValue = v; } };
            player.setComponent(EntityComponentTypes.Health, health);

            eventBus.dispatch("entityHurt", {
                hurtEntity: player,
                damage: 3,
                damageSource: { cause: EntityDamageCause.fall }
            });

            assert.equal(bootsDur.damage, 6);
        });

        it("bypasses armor and does not damage durability for void or starve damage", () => {
            const player = new Player();
            player.id = "test_player_void_hurt";
            const chestDur = { maxDurability: 200, damage: 0 };

            const equipment = new Map<EquipmentSlot, any>([
                [EquipmentSlot.Chest, {
                    typeId: "minecraft:diamond_chestplate",
                    getComponent: (type: string) => type === ItemComponentTypes.Durability ? chestDur : null
                }]
            ]);

            player.setComponent(EntityComponentTypes.Equippable, {
                getEquipment: (slot: EquipmentSlot) => equipment.get(slot) || null,
                setEquipment: (slot: EquipmentSlot, item: any) => {
                    if (!item) equipment.delete(slot);
                    else equipment.set(slot, item);
                    return true;
                }
            });

            eventBus.dispatch("entityHurt", {
                hurtEntity: player,
                damage: 4,
                damageSource: { cause: EntityDamageCause.void }
            });

            assert.equal(chestDur.damage, 0);
        });

        it("does not reduce durability when damage is 0 or less", () => {
            const player = new Player();
            player.id = "test_player_zero_hurt";
            const chestDur = { maxDurability: 200, damage: 0 };

            const equipment = new Map<EquipmentSlot, any>([
                [EquipmentSlot.Chest, {
                    typeId: "minecraft:diamond_chestplate",
                    getComponent: (type: string) => type === ItemComponentTypes.Durability ? chestDur : null
                }]
            ]);

            player.setComponent(EntityComponentTypes.Equippable, {
                getEquipment: (slot: EquipmentSlot) => equipment.get(slot) || null,
                setEquipment: (slot: EquipmentSlot, item: any) => {
                    if (!item) equipment.delete(slot);
                    else equipment.set(slot, item);
                    return true;
                }
            });

            eventBus.dispatch("entityHurt", {
                hurtEntity: player,
                damage: 0,
                damageSource: { cause: EntityDamageCause.entityAttack }
            });

            assert.equal(chestDur.damage, 0);
        });
    });

    describe("computeBetaArmorMitigation", () => {
        it("returns raw damage when incoming damage or defense points are zero", () => {
            const noDmg = computeBetaArmorMitigation(0, 10, 5);
            assert.equal(noDmg.damageInflicted, 0);
            assert.equal(noDmg.damageAbsorbed, 0);
            assert.equal(noDmg.updatedRemainder, 5);

            const noArmor = computeBetaArmorMitigation(10, 0, 3);
            assert.equal(noArmor.damageInflicted, 10);
            assert.equal(noArmor.damageAbsorbed, 0);
            assert.equal(noArmor.updatedRemainder, 3);
        });

        it("mitigates damage using authentic 1/25 ratio per point and carries remainders", () => {
            // 4 damage with 8 armor points:
            // penetrationFactor = 25 - 8 = 17
            // accumulatedUnits = 4 * 17 + 0 = 68
            // damageInflicted = floor(68 / 25) = 2
            // updatedRemainder = 68 % 25 = 18
            // damageAbsorbed = 4 - 2 = 2
            const hit1 = computeBetaArmorMitigation(4, 8, 0);
            assert.equal(hit1.damageInflicted, 2);
            assert.equal(hit1.damageAbsorbed, 2);
            assert.equal(hit1.updatedRemainder, 18);

            // Second hit with remainder 18:
            // accumulatedUnits = 4 * 17 + 18 = 86
            // damageInflicted = floor(86 / 25) = 3
            // updatedRemainder = 86 % 25 = 11
            // damageAbsorbed = 4 - 3 = 1
            const hit2 = computeBetaArmorMitigation(4, 8, hit1.updatedRemainder);
            assert.equal(hit2.damageInflicted, 3);
            assert.equal(hit2.damageAbsorbed, 1);
            assert.equal(hit2.updatedRemainder, 11);
        });
    });
});

