import { world, EquipmentSlot, EntityComponentTypes, HudElement, HudVisibility, Player } from "@minecraft/server";
import { tickManager } from "../core/tickManager.js";
import { eventBus } from "../core/eventBus.js";
import { reportError } from "../core/errorReporter.js";

const SUPPRESSED_HUD_ELEMENTS = [
    HudElement.Hunger,
    HudElement.ProgressBar
];

const trackedHudPlayers = new Set<string>();

export function suppressPostBetaHudElements(player: Player): void {
    if (!player.isValid) return;
    try {
        if (typeof player.onScreenDisplay?.setHudVisibility === "function") {
            player.onScreenDisplay.setHudVisibility(HudVisibility.Hide, SUPPRESSED_HUD_ELEMENTS);
        }
    } catch (e) {
        reportError({
            system: "playerState",
            operation: "suppressPostBetaHudElements",
            target: player.name
        }, e);
    }
}

export function ensurePlayerHudState(player: Player): void {
    if (trackedHudPlayers.has(player.id)) return;
    trackedHudPlayers.add(player.id);
    suppressPostBetaHudElements(player);
}

eventBus.onPlayerSpawn((ev) => {
    if (ev.player) {
        trackedHudPlayers.delete(ev.player.id);
        ensurePlayerHudState(ev.player);
    }
});

eventBus.onPlayerLeave((ev) => {
    trackedHudPlayers.delete(ev.playerId);
});

export function playerStateJob(): void {
    const players = world.getAllPlayers();

    for (const player of players) {
        if (!player.isValid) continue;

        try {
            ensurePlayerHudState(player);

            if (player.level > 0 || player.xpEarnedAtCurrentLevel > 0) {
                player.resetLevel();
            }

            const equippable = player.getComponent(EntityComponentTypes.Equippable);
            if (!equippable) continue;

            const offhandItem = equippable.getEquipment(EquipmentSlot.Offhand);

            if (offhandItem) {
                equippable.setEquipment(EquipmentSlot.Offhand, undefined);

                const invComp = player.getComponent(EntityComponentTypes.Inventory);
                const inv = invComp?.container;
                if (inv) {
                    const leftover = inv.addItem(offhandItem);
                    if (leftover) {
                        player.dimension.spawnItem(leftover, player.location);
                    }
                } else {
                    player.dimension.spawnItem(offhandItem, player.location);
                }
            }
        } catch (e) {
            reportError({
                system: "playerState",
                operation: "processPlayerState",
                target: player.name
            }, e);
        }
    }
}

tickManager.register("playerState", 2, playerStateJob, 1);

