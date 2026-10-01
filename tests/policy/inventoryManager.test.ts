import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    ItemStack,
    Container,
    EntityComponentTypes,
    EquipmentSlot,
    EntityEquippableComponent,
    ItemComponentTypes,
    GameMode,
    system
} from "@minecraft/server";
import {
    evaluateItemAction,
    processInventory,
    processPlayers
} from "../../packs/BP/scripts/core/inventoryManager.js";
import { PRIVILEGED_TAGS } from "../../packs/BP/scripts/core/permissions.js";
import { eventBus } from "../../packs/BP/scripts/core/eventBus.js";
import { mockPlayers, Player } from "../mocks/minecraftServer.js";

describe("Inventory Manager Item Normalization & Unstacking", () => {
    describe("Bow Normalization", () => {
        it("replaces vanilla minecraft:bow with authentic bh:bow", () => {
            const bowItem = new ItemStack("minecraft:bow", 1);
            const action = evaluateItemAction(bowItem);

            assert.equal(action.type, "replace");
            if (action.type === "replace") {
                assert.equal(action.item.typeId, "bh:bow");
                assert.equal(action.item.amount, 1);
            }
        });
    });

    describe("Placer Item Normalization", () => {
        it("replaces vanilla stairs, logs, and slabs with bh: equivalents", () => {
            const items = [
                { vanilla: "minecraft:oak_stairs", bh: "bh:oak_stairs" },
                { vanilla: "minecraft:spruce_stairs", bh: "bh:oak_stairs" },
                { vanilla: "minecraft:birch_stairs", bh: "bh:oak_stairs" },
                { vanilla: "minecraft:dark_oak_stairs", bh: "bh:oak_stairs" },
                { vanilla: "minecraft:stone_stairs", bh: "bh:cobblestone_stairs" },
                { vanilla: "minecraft:cobblestone_stairs", bh: "bh:cobblestone_stairs" },
                { vanilla: "minecraft:brick_stairs", bh: "bh:cobblestone_stairs" },
                { vanilla: "minecraft:sandstone_stairs", bh: "bh:cobblestone_stairs" },
                { vanilla: "minecraft:oak_log", bh: "bh:oak_log" },
                { vanilla: "minecraft:birch_log", bh: "bh:birch_log" },
                { vanilla: "minecraft:spruce_log", bh: "bh:spruce_log" },
                { vanilla: "minecraft:wood", bh: "bh:oak_log" },
                { vanilla: "minecraft:oak_wood", bh: "bh:oak_log" },
                { vanilla: "minecraft:spruce_wood", bh: "bh:spruce_log" },
                { vanilla: "minecraft:birch_wood", bh: "bh:birch_log" },
                { vanilla: "minecraft:dark_oak_log", bh: "bh:oak_log" },
                { vanilla: "minecraft:jungle_log", bh: "bh:oak_log" },
                { vanilla: "minecraft:stripped_oak_log", bh: "bh:oak_log" },
                { vanilla: "minecraft:stripped_spruce_log", bh: "bh:spruce_log" },
                { vanilla: "minecraft:stripped_birch_log", bh: "bh:birch_log" },
                { vanilla: "minecraft:chest", bh: "bh:chest" },
                { vanilla: "minecraft:cobblestone_slab", bh: "bh:cobblestone_slab" },
                { vanilla: "minecraft:sandstone_slab", bh: "bh:sandstone_slab" },
                { vanilla: "minecraft:smooth_stone_slab", bh: "bh:stone_slab" },
                { vanilla: "minecraft:stone_slab", bh: "bh:stone_slab" },
                { vanilla: "minecraft:oak_slab", bh: "bh:wooden_slab" },
                { vanilla: "minecraft:wooden_slab", bh: "bh:wooden_slab" },
                { vanilla: "minecraft:spruce_slab", bh: "bh:wooden_slab" },
                { vanilla: "minecraft:birch_slab", bh: "bh:wooden_slab" },
                { vanilla: "minecraft:dark_oak_slab", bh: "bh:wooden_slab" }
            ];

            for (const { vanilla, bh } of items) {
                const action = evaluateItemAction(new ItemStack(vanilla, 5));
                assert.equal(action.type, "replace", `Expected ${vanilla} to have action type replace`);
                if (action.type === "replace") {
                    assert.equal(action.item.typeId, bh, `Expected ${vanilla} to convert to ${bh}`);
                    assert.equal(action.item.amount, 5);
                }
            }
        });
    });

    describe("Placer Normalization for Exempt and Creative Players", () => {
        it("replaces vanilla logs, wood, slabs, and stairs with bh: items even when player is in Creative mode", () => {
            const player = new Player();
            player.name = "CreativeBuilder";
            player.id = "builder_creative_1";
            player.gameMode = GameMode.Creative;

            const inv = new Container(36);
            inv.setItem(0, new ItemStack("minecraft:oak_log", 64));
            inv.setItem(1, new ItemStack("minecraft:oak_stairs", 64));
            inv.setItem(2, new ItemStack("minecraft:oak_slab", 64));
            inv.setItem(3, new ItemStack("minecraft:wood", 64));
            inv.setItem(4, new ItemStack("minecraft:elytra", 1));
            inv.setItem(5, new ItemStack("minecraft:chest", 8));
            player.setComponent(EntityComponentTypes.Inventory, { container: inv });

            mockPlayers.length = 0;
            mockPlayers.push(player);

            processPlayers();

            assert.equal(inv.getItem(0)?.typeId, "bh:oak_log");
            assert.equal(inv.getItem(0)?.amount, 64);
            assert.equal(inv.getItem(1)?.typeId, "bh:oak_stairs");
            assert.equal(inv.getItem(1)?.amount, 64);
            assert.equal(inv.getItem(2)?.typeId, "bh:wooden_slab");
            assert.equal(inv.getItem(2)?.amount, 64);
            assert.equal(inv.getItem(3)?.typeId, "bh:oak_log");
            assert.equal(inv.getItem(3)?.amount, 64);
            assert.equal(inv.getItem(4)?.typeId, "minecraft:elytra", "Other creative items must be preserved");
            assert.equal(inv.getItem(5)?.typeId, "bh:chest", "Chest stacks convert even for exempt players");
            assert.equal(inv.getItem(5)?.amount, 8, "Converting a chest must keep the stack count");

            mockPlayers.length = 0;
        });

        it("replaces vanilla logs, wood, slabs, and stairs with bh: items even when player has builder_exempt tag", () => {
            const player = new Player();
            player.name = "StaffBuilder";
            player.id = "builder_staff_1";
            player.gameMode = GameMode.Survival;
            player.addTag(PRIVILEGED_TAGS.BUILDER_EXEMPT);

            const inv = new Container(36);
            inv.setItem(0, new ItemStack("minecraft:spruce_log", 32));
            inv.setItem(1, new ItemStack("minecraft:cobblestone_slab", 32));
            inv.setItem(2, new ItemStack("minecraft:netherite_pickaxe", 1));
            player.setComponent(EntityComponentTypes.Inventory, { container: inv });

            mockPlayers.length = 0;
            mockPlayers.push(player);

            processPlayers();

            assert.equal(inv.getItem(0)?.typeId, "bh:spruce_log");
            assert.equal(inv.getItem(0)?.amount, 32);
            assert.equal(inv.getItem(1)?.typeId, "bh:cobblestone_slab");
            assert.equal(inv.getItem(1)?.amount, 32);
            assert.equal(inv.getItem(2)?.typeId, "minecraft:netherite_pickaxe", "Other exempt items must be preserved");

            mockPlayers.length = 0;
        });
    });

    describe("Utility Item Unstacking", () => {
        const unstackableUtilities = [
            "minecraft:wooden_door",
            "minecraft:iron_door",
            "minecraft:oak_sign",
            "minecraft:bucket"
        ];

        for (const typeId of unstackableUtilities) {
            it(`marks stacked ${typeId} (amount > 1) for unstacking`, () => {
                const item = new ItemStack(typeId, 3);
                const action = evaluateItemAction(item);

                assert.equal(action.type, "unstack_utility");
                if (action.type === "unstack_utility") {
                    assert.equal(action.targetId, typeId);
                    assert.equal(action.totalAmount, 3);
                }
            });

            it(`keeps single ${typeId} (amount === 1) as-is`, () => {
                const item = new ItemStack(typeId, 1);
                const action = evaluateItemAction(item);

                assert.equal(action.type, "keep");
            });
        }
    });

    describe("Equipment & Armor Slot Clearing", () => {
        it("clears modern armor and offhand items while preserving beta armor", () => {
            const player = new Player();
            player.name = "TestSteve";
            const inv = new Container(36);
            player.setComponent(EntityComponentTypes.Inventory, { container: inv });
            const equippable = new EntityEquippableComponent();
            player.setComponent(EntityComponentTypes.Equippable, equippable);

            // Equip modern non-Beta items
            equippable.setEquipment(EquipmentSlot.Head, new ItemStack("minecraft:turtle_helmet", 1));
            equippable.setEquipment(EquipmentSlot.Chest, new ItemStack("minecraft:netherite_chestplate", 1));
            equippable.setEquipment(EquipmentSlot.Legs, new ItemStack("minecraft:diamond_leggings", 1));
            equippable.setEquipment(EquipmentSlot.Feet, new ItemStack("minecraft:netherite_boots", 1));
            equippable.setEquipment(EquipmentSlot.Offhand, new ItemStack("minecraft:shield", 1));

            processInventory(player);

            // Modern armor/offhand should be wiped
            assert.equal(equippable.getEquipment(EquipmentSlot.Head), undefined);
            assert.equal(equippable.getEquipment(EquipmentSlot.Chest), undefined);
            assert.equal(equippable.getEquipment(EquipmentSlot.Feet), undefined);
            assert.equal(equippable.getEquipment(EquipmentSlot.Offhand), undefined);

            // Authentic Beta armor should remain equipped
            const legs = equippable.getEquipment(EquipmentSlot.Legs);
            assert.ok(legs);
            assert.equal(legs.typeId, "minecraft:diamond_leggings");
        });

        it("strips enchantments from equipped armor", () => {
            const player = new Player();
            const inv = new Container(36);
            player.setComponent(EntityComponentTypes.Inventory, { container: inv });
            const equippable = new EntityEquippableComponent();
            player.setComponent(EntityComponentTypes.Equippable, equippable);

            const enchantedChest = new ItemStack("minecraft:diamond_chestplate", 1);
            enchantedChest.setComponent(ItemComponentTypes.Enchantable, {
                getEnchantments: () => [{ type: "protection", level: 4 }]
            });
            equippable.setEquipment(EquipmentSlot.Chest, enchantedChest);

            processInventory(player);

            const cleaned = equippable.getEquipment(EquipmentSlot.Chest);
            assert.ok(cleaned);
            assert.equal(cleaned.typeId, "minecraft:diamond_chestplate");
            assert.equal(cleaned.getComponent(ItemComponentTypes.Enchantable), null);
        });
    });

    describe("Third-Party Namespace Preservation", () => {
        it("keeps items from other addons instead of deleting them as unsupported", () => {
            const modded = ["gun:1911", "gun:bullet", "techmod:deepslate", "techmod:rotten_flesh"];
            for (const typeId of modded) {
                assert.equal(evaluateItemAction(new ItemStack(typeId, 1)).type, "keep", `Expected ${typeId} to be preserved`);
            }
        });

        it("does not rewrite modded stacks or equipped gear during a sweep", () => {
            mockPlayers.length = 0;
            const player = new Player();
            player.name = "ModdedSteve";
            player.id = "modded_steve_1";

            const inv = new Container(36);
            inv.setItem(0, new ItemStack("gun:1911", 1));
            inv.setItem(1, new ItemStack("gun:ammo", 64));
            player.setComponent(EntityComponentTypes.Inventory, { container: inv });

            const equippable = new EntityEquippableComponent();
            equippable.setEquipment(EquipmentSlot.Chest, new ItemStack("techmod:jetpack", 1));
            player.setComponent(EntityComponentTypes.Equippable, equippable);

            mockPlayers.push(player);
            processPlayers();

            assert.equal(inv.getItem(0)?.typeId, "gun:1911");
            assert.equal(inv.getItem(0)?.amount, 1);
            assert.equal(inv.getItem(1)?.typeId, "gun:ammo");
            assert.equal(inv.getItem(1)?.amount, 64);
            assert.equal(equippable.getEquipment(EquipmentSlot.Chest)?.typeId, "techmod:jetpack");

            mockPlayers.length = 0;
        });
    });

    describe("builder_exempt Tag Exemption & Instant Transition", () => {
        it("preserves modern items while builder_exempt, then sweeps immediately upon removal", () => {
            mockPlayers.length = 0;
            const player = new Player();
            player.name = "BuilderBob";
            player.id = "builder_bob_1";
            player.gameMode = GameMode.Survival;
            player.addTag(PRIVILEGED_TAGS.BUILDER_EXEMPT);

            const inv = new Container(36);
            inv.setItem(0, new ItemStack("minecraft:elytra", 1));
            inv.setItem(1, new ItemStack("minecraft:totem_of_undying", 1));
            player.setComponent(EntityComponentTypes.Inventory, { container: inv });

            const equippable = new EntityEquippableComponent();
            equippable.setEquipment(EquipmentSlot.Chest, new ItemStack("minecraft:netherite_chestplate", 1));
            equippable.setEquipment(EquipmentSlot.Offhand, new ItemStack("minecraft:shield", 1));
            player.setComponent(EntityComponentTypes.Equippable, equippable);

            mockPlayers.push(player);

            // 1. Tick with builder_exempt active: items must NOT be removed
            processPlayers();
            assert.ok(inv.getItem(0), "Elytra should be preserved while exempt");
            assert.ok(inv.getItem(1), "Totem should be preserved while exempt");
            assert.ok(equippable.getEquipment(EquipmentSlot.Chest), "Netherite chestplate preserved while exempt");
            assert.ok(equippable.getEquipment(EquipmentSlot.Offhand), "Shield preserved while exempt");

            // 2. Remove builder_exempt tag
            player.removeTag(PRIVILEGED_TAGS.BUILDER_EXEMPT);

            // 3. Next tick sweep: must immediately wipe inventory & equipment without delay
            processPlayers();
            assert.equal(inv.getItem(0), undefined, "Elytra must be cleared immediately after tag removal");
            assert.equal(inv.getItem(1), undefined, "Totem must be cleared immediately after tag removal");
            assert.equal(equippable.getEquipment(EquipmentSlot.Chest), undefined, "Netherite chestplate must be cleared immediately after tag removal");
            assert.equal(equippable.getEquipment(EquipmentSlot.Offhand), undefined, "Shield must be cleared immediately after tag removal");

            mockPlayers.length = 0;
        });
    });

    describe("GameMode Change Instant Transition", () => {
        it("immediately clears illegal items when switching from Creative to Survival", () => {
            const player = new Player();
            player.name = "CreativeCharlie";
            player.id = "charlie_1";
            player.gameMode = GameMode.Survival; // Changed to survival

            const inv = new Container(36);
            inv.setItem(0, new ItemStack("minecraft:netherite_sword", 1));
            player.setComponent(EntityComponentTypes.Inventory, { container: inv });

            const equippable = new EntityEquippableComponent();
            equippable.setEquipment(EquipmentSlot.Chest, new ItemStack("minecraft:elytra", 1));
            player.setComponent(EntityComponentTypes.Equippable, equippable);

            // Dispatch playerGameModeChange event
            eventBus.dispatch("playerGameModeChange", {
                player,
                fromGameMode: GameMode.Creative,
                toGameMode: GameMode.Survival
            });

            assert.equal(inv.getItem(0), undefined, "Netherite sword cleared on gamemode change");
            assert.equal(equippable.getEquipment(EquipmentSlot.Chest), undefined, "Elytra cleared on gamemode change");
        });
    });

    describe("Event-driven sweep gating", () => {
        function playerHolding(id: string, itemId: string): { player: Player; inv: Container } {
            const player = new Player();
            player.name = id;
            player.id = id;
            player.gameMode = GameMode.Survival;

            const inv = new Container(36);
            inv.setItem(0, new ItemStack(itemId, 1));
            player.setComponent(EntityComponentTypes.Inventory, { container: inv });

            mockPlayers.length = 0;
            mockPlayers.push(player);
            return { player, inv };
        }

        function atTick(tick: number, run: () => void): void {
            system.currentTick = tick;
            try {
                run();
            } finally {
                system.currentTick = 0;
                mockPlayers.length = 0;
            }
        }

        it("leaves an idle player's inventory unread between safety sweeps", () => {
            const { inv } = playerHolding("idle_builder", "minecraft:netherite_sword");

            atTick(3, () => {
                processPlayers();
                assert.ok(inv.getItem(0), "a player who touched nothing must not have 36 slots re-read");
            });
        });

        it("sweeps the next tick after the engine reports an inventory change", () => {
            const { player, inv } = playerHolding("picked_up", "minecraft:netherite_sword");

            atTick(3, () => {
                eventBus.dispatch("playerInventoryItemChange", { player, slot: 0, itemStack: inv.getItem(0) });
                processPlayers();
                assert.equal(inv.getItem(0), undefined, "a reported change must be normalized on the next sweep");
            });
        });

        it("still sweeps every player on the safety interval", () => {
            const { inv } = playerHolding("safety_net", "minecraft:netherite_sword");

            atTick(20, () => {
                processPlayers();
                assert.equal(inv.getItem(0), undefined, "the safety sweep must catch what the event missed");
            });
        });
    });
});
