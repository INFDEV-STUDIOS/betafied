import {
    ItemStack,
    Player,
    GameMode,
    EntityComponentTypes,
    system
} from "@minecraft/server";
import { eventBus } from "../core/eventBus.js";
import { BH_BOW_ID } from "../core/betaRegistry.js";

const CONFIG = Object.freeze({
    FIRE_COOLDOWN: 2,
    HOLD_FIRE_RATE: 3
});

const lastFireTime = new Map<string, number>();
const holdIntervals = new Map<string, number>();

function fireArrow(player: Player): boolean {
    const now = system.currentTick;
    const lastFire = lastFireTime.get(player.id) ?? 0;

    if (now - lastFire < CONFIG.FIRE_COOLDOWN) return false;
    lastFireTime.set(player.id, now);

    const isCreative = player.getGameMode() === GameMode.Creative;
    const invComp = player.getComponent(EntityComponentTypes.Inventory);
    const inv = invComp?.container;
    if (!inv) return false;

    if (!isCreative) {
        let arrowSlot = -1;
        const size = inv.size;
        for (let i = 0; i < size; i++) {
            const slotItem = inv.getItem(i);
            if (slotItem?.typeId === "minecraft:arrow") {
                arrowSlot = i;
                break;
            }
        }

        if (arrowSlot === -1) return false;

        const arrowItem = inv.getItem(arrowSlot);
        if (arrowItem && arrowItem.amount > 1) {
            inv.setItem(arrowSlot, new ItemStack("minecraft:arrow", arrowItem.amount - 1));
        } else {
            inv.setItem(arrowSlot, undefined);
        }
    }

    const dir = player.getViewDirection();
    const head = player.getHeadLocation();
    const spawnPos = {
        x: head.x + dir.x * 1.5,
        y: head.y + dir.y * 1.5,
        z: head.z + dir.z * 1.5
    };

    try {
        const arrow = player.dimension.spawnEntity("minecraft:arrow", spawnPos);
        const proj = arrow.getComponent(EntityComponentTypes.Projectile);
        if (proj) {
            proj.owner = player;
            proj.shoot({ x: dir.x * 3.0, y: dir.y * 3.0, z: dir.z * 3.0 }, { uncertainty: 1.0 });
        }

        player.playSound("random.bow", {
            volume: 0.5,
            pitch: 1.0 + Math.random() * 0.3
        });
        return true;
    } catch {
        return false;
    }
}

function stopHoldFiring(playerId: string): void {
    const interval = holdIntervals.get(playerId);
    if (interval !== undefined) {
        system.clearRun(interval);
        holdIntervals.delete(playerId);
    }
}

eventBus.onItemUseAfter((ev) => {
    const player = ev.source;
    const item = ev.itemStack;

    if (!(player instanceof Player)) return;
    if (item?.typeId !== BH_BOW_ID) return;
    fireArrow(player);
});

eventBus.onItemStartUse((ev) => {
    const player = ev.source;
    const item = ev.itemStack;

    if (!(player instanceof Player)) return;
    if (item?.typeId !== BH_BOW_ID) return;

    stopHoldFiring(player.id);

    const intervalId = system.runInterval(() => {
        try {
            if (!player.isValid) {
                stopHoldFiring(player.id);
                return;
            }

            const invComp = player.getComponent(EntityComponentTypes.Inventory);
            const currentItem = invComp?.container?.getItem(player.selectedSlotIndex);
            if (currentItem?.typeId !== BH_BOW_ID) {
                stopHoldFiring(player.id);
                return;
            }

            fireArrow(player);
        } catch {
            stopHoldFiring(player.id);
        }
    }, CONFIG.HOLD_FIRE_RATE);

    holdIntervals.set(player.id, intervalId);
});

eventBus.onItemStopUse((ev) => {
    const player = ev.source;
    if (player instanceof Player) {
        stopHoldFiring(player.id);
    }
});

eventBus.onItemReleaseUse((ev) => {
    const player = ev.source;
    if (player instanceof Player) {
        stopHoldFiring(player.id);
    }
});

eventBus.onPlayerLeave((ev) => {
    lastFireTime.delete(ev.playerId);
    stopHoldFiring(ev.playerId);
});
