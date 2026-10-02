import {
    world,
    system,
    ItemStack,
    Player,
    Container,
    EntityHealthComponent,
    ItemUseBeforeEvent,
    PlayerInteractWithBlockBeforeEvent,
    EntityComponentTypes
} from "@minecraft/server";
import { eventBus } from "../core/eventBus.js";
import { reportError } from "../core/errorReporter.js";
import { FOOD_CONVERSIONS } from "../core/normalizer.js";

interface FoodConfig {
    health: number;
    returnContainer?: string;
}

// Health is Beta gameplay and lives here; which vanilla foods become which `bh:` item is the
// normalizer's conversion table. The membership of `FOOD_ITEMS` is derived from that table rather
// than re-listed, so a food the sweep retypes can never be one this module forgets to feed.
const FOOD_HEALTH: Readonly<Record<string, FoodConfig>> = Object.freeze({
    "bh:apple": { health: 4 },
    "bh:bread": { health: 5 },
    "bh:cookie": { health: 1 },
    "bh:cod": { health: 2 },
    "bh:cooked_cod": { health: 5 },
    "bh:golden_apple": { health: 42 },
    "bh:porkchop": { health: 3 },
    "bh:cooked_porkchop": { health: 8 }
});

// Mushroom stew is authentic Beta but the engine consumes it natively, so it is never retyped and is
// the one food the conversion table does not name.
const NATIVE_FOODS: Readonly<Record<string, FoodConfig>> = Object.freeze({
    "minecraft:mushroom_stew": { health: 10, returnContainer: "minecraft:bowl" }
});

function buildFoodItems(): Record<string, FoodConfig> {
    const items: Record<string, FoodConfig> = { ...NATIVE_FOODS };
    for (const convertedId of Object.values(FOOD_CONVERSIONS)) {
        const config = FOOD_HEALTH[convertedId];
        if (!config) {
            throw new Error(`foodAndHealth: no health configured for converted food ${convertedId}`);
        }
        items[convertedId] = config;
    }
    return items;
}

const FOOD_ITEMS: Readonly<Record<string, FoodConfig>> = Object.freeze(buildFoodItems());

const CAKE_CONFIG = Object.freeze({
    blockId: "minecraft:cake",
    healthRestore: 3,
    maxBites: 6,
    stateProperty: "bite_counter"
});

class FoodAndHealth {
    constructor() {
        this.disableNaturalRegeneration();
        this.registerEventHandlers();
    }

    private disableNaturalRegeneration(): void {
        system.run(() => {
            try {
                if (world.gameRules) {
                    world.gameRules.naturalRegeneration = false;
                }
            } catch (e) {
                reportError({
                    system: "foodAndHealth",
                    operation: "disableNaturalRegeneration"
                }, e);
            }
        });
    }

    private registerEventHandlers(): void {
        eventBus.onItemUse(this.handleFoodConsumption.bind(this));
        eventBus.onPlayerInteractWithBlock(this.handleCakeInteraction.bind(this));
    }

    private handleFoodConsumption(event: ItemUseBeforeEvent): void {
        const player = event.source;
        const itemStack = event.itemStack;

        if (!(player instanceof Player) || !itemStack || !FOOD_ITEMS[itemStack.typeId]) {
            return;
        }

        event.cancel = true;

        system.run(() => {
            try {
                if (!player.isValid) return;

                const invComp = player.getComponent(EntityComponentTypes.Inventory);
                const inventory = invComp?.container;
                const healthComponent = player.getComponent(EntityComponentTypes.Health);

                if (!inventory || !healthComponent) return;

                const selectedSlot = player.selectedSlotIndex;
                const slotItem = inventory.getItem(selectedSlot);

                if (!slotItem || slotItem.typeId !== itemStack.typeId) return;

                this.consumeFoodItem(player, inventory, healthComponent, itemStack, selectedSlot);
            } catch (e) {
                reportError({
                    system: "foodAndHealth",
                    operation: "consumeFoodDeferred",
                    target: player.name
                }, e);
            }
        });
    }

    private consumeFoodItem(
        player: Player,
        inventory: Container,
        healthComponent: EntityHealthComponent,
        item: ItemStack,
        slot: number
    ): void {
        const foodData = FOOD_ITEMS[item.typeId];
        if (!foodData) return;

        const currentHealth = healthComponent.currentValue;
        const maxHealth = healthComponent.defaultValue;
        const isGoldenApple = item.typeId.includes("golden_apple");

        if (currentHealth >= maxHealth && !isGoldenApple) {
            return;
        }

        const newHealth = Math.min(currentHealth + foodData.health, maxHealth);
        if (newHealth > currentHealth) {
            healthComponent.setCurrentValue(newHealth);
        }
        player.playSound("random.burp", { volume: 0.5, pitch: 1.0 });

        const newAmount = item.amount - 1;
        inventory.setItem(slot, newAmount > 0
            ? new ItemStack(item.typeId, newAmount)
            : undefined);

        if (foodData.returnContainer && newAmount <= 0) {
            this.tryAddItemToInventory(inventory, new ItemStack(foodData.returnContainer, 1));
        }
    }

    private handleCakeInteraction(event: PlayerInteractWithBlockBeforeEvent): void {
        const { player, block } = event;
        if (!block || block.typeId !== CAKE_CONFIG.blockId) return;

        event.cancel = true;

        system.run(() => {
            try {
                if (!player.isValid) return;

                const healthComponent = player.getComponent(EntityComponentTypes.Health);
                if (!healthComponent) return;

                const currentHealth = healthComponent.currentValue;
                const maxHealth = healthComponent.defaultValue;
                const newHealth = Math.min(currentHealth + CAKE_CONFIG.healthRestore, maxHealth);

                if (newHealth > currentHealth) {
                    healthComponent.setCurrentValue(newHealth);
                    player.playSound("random.burp", { volume: 0.5, pitch: 1.0 });
                }

                const stateVal = block.permutation.getState(CAKE_CONFIG.stateProperty);
                const currentBites = typeof stateVal === "number" ? stateVal : 0;
                const newBites = currentBites + 1;

                if (newBites < CAKE_CONFIG.maxBites) {
                    block.setPermutation(
                        block.permutation.withState(CAKE_CONFIG.stateProperty, newBites)
                    );
                } else {
                    system.runTimeout(() => {
                        block.setType("minecraft:air");
                    }, 1);
                }
            } catch (e) {
                reportError({
                    system: "foodAndHealth",
                    operation: "updateCakeState",
                    target: player.name
                }, e);
            }
        });
    }

    private tryAddItemToInventory(inventory: Container, itemStack: ItemStack): boolean {
        try {
            if (inventory.emptySlotsCount > 0) {
                return inventory.addItem(itemStack) === undefined;
            }
            return false;
        } catch {
            return false;
        }
    }
}

export const foodAndHealth = new FoodAndHealth();
