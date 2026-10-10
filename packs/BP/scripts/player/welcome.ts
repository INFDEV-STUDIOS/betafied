import { system } from "@minecraft/server";
import { eventBus } from "../core/eventBus.js";

const CONFIG = Object.freeze({
    VERSION: "5.4",
    DELAY_TICKS: 70
});

const welcomed = new Set<string>();

eventBus.onPlayerSpawn((ev) => {
    if (!ev.initialSpawn) return;

    const player = ev.player;
    if (welcomed.has(player.id)) return;

    welcomed.add(player.id);

    system.runTimeout(() => {
        if (!player.isValid) return;
        player.sendMessage(`§e§lWelcome to Betafied! §r§7(v${CONFIG.VERSION})`);
    }, CONFIG.DELAY_TICKS);
});

eventBus.onPlayerLeave((event) => {
    welcomed.delete(event.playerId);
});
