import { world } from "@minecraft/server";
import type { Player } from "@minecraft/server";
import { tickManager } from "../core/tickManager.js";
import { eventBus } from "../core/eventBus.js";
import { runCatching, reportError } from "../core/errorReporter.js";

/**
 * Title string that turns the Beta water tint on in packs/RP/ui/hud_screen.json. The tint rides the
 * title channel rather than the actionbar because the engine keeps the last actionbar in the
 * factory binding after its fade, so the old driver could only push a decoy string to make the tint
 * leave, and both edges of a dive paid the actionbar's fade.
 */
export const UNDERWATER_SENTINEL = "_w";

/**
 * Surfacing pushes this rather than setTitle(""): an empty title stops drawing but leaves
 * #hud_title_text_string still holding the old sentinel, so the tint only left when some other
 * system (the armor readout) happened to overwrite the channel. This is a real string, which the UI
 * hides on its "_w" prefix, so it updates the binding without ever reaching the screen.
 */
export const CLEAR_SENTINEL = "_w0";

const CONFIG = Object.freeze({
    // The tint answers the camera, not the tick budget. A 20-tick poll left up to a second of
    // untinted diving before the screen caught up, and the same second of stale tint on the way out.
    CHECK_INTERVAL: 1,
    // The armor readout shares this channel and re-sends whenever its value changes, so the tint
    // re-asserts itself well inside that window rather than blinking out for a beat.
    REFRESH_INTERVAL: 5
});

/** Who is currently tinted, so surfacing clears exactly one title instead of spamming. */
const tintedPlayers = new Set<string>();

let ticksSinceRefresh = 0;

export function isHeadSubmerged(player: Player): boolean {
    const head = player.getHeadLocation();
    const block = player.dimension.getBlock({
        x: Math.floor(head.x),
        y: Math.floor(head.y),
        z: Math.floor(head.z)
    });

    // Lava is a liquid block too, and Beta only tinted the screen for water.
    return block !== undefined && block.isLiquid && block.typeId.includes("water");
}

function sendSentinel(player: Player): void {
    runCatching({ system: "underwaterOverlay", operation: "sendSentinel", target: player.name }, () => {
        player.onScreenDisplay.setTitle(UNDERWATER_SENTINEL);
    });
}

function clearSentinel(player: Player): void {
    runCatching({ system: "underwaterOverlay", operation: "clearSentinel", target: player.name }, () => {
        player.onScreenDisplay.setTitle(CLEAR_SENTINEL);
    });
}

export function underwaterOverlayJob(): void {
    ticksSinceRefresh = (ticksSinceRefresh + 1) % CONFIG.REFRESH_INTERVAL;
    const refreshDue = ticksSinceRefresh === 0;

    for (const player of world.getAllPlayers()) {
        let submerged: boolean;
        try {
            submerged = isHeadSubmerged(player);
        } catch (e) {
            // An unloaded chunk is not an answer about the head, so a failed lookup leaves whatever
            // the player was last known to be doing alone instead of clearing them out of the water.
            // The error context is built here rather than passed in up front because reading
            // player.name is itself a native call, and this runs for every player every tick.
            reportError({ system: "underwaterOverlay", operation: "resolveHeadSubmerged", target: player.name }, e);
            continue;
        }

        if (submerged) {
            if (refreshDue || !tintedPlayers.has(player.id)) {
                sendSentinel(player);
            }
            tintedPlayers.add(player.id);
        } else if (tintedPlayers.delete(player.id)) {
            clearSentinel(player);
        }
    }
}

// A departed player must not linger in the set: their next session would skip the enter edge.
eventBus.onPlayerLeave((event) => {
    tintedPlayers.delete(event.playerId);
});

tickManager.register("underwaterOverlay", CONFIG.CHECK_INTERVAL, underwaterOverlayJob);
