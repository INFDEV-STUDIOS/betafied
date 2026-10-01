import { eventBus } from "./core/eventBus.js";
import { tickManager } from "./core/tickManager.js";

// Import order is load-bearing, not alphabetical. The EventBus dispatches in
// subscription order and short-circuits once a beforeEvent is cancelled, so the
// sequence below decides which handlers observe a cancelled interaction.
import "./core/inventoryManager.js";
import "./player/achievements.js";
import "./player/welcome.js";
import "./world/buildHeightLimit.js";
import "./combat/armor.js";
import "./combat/machineGunBow.js";
import "./mobs/pigmanEquipment.js";
import "./interactions/redstoneMining.js";
import "./interactions/swordMining.js";
import "./interactions/boatCollision.js";
import "./interactions/furnaceMinecart.js";
import "./interactions/instantBonemeal.js";
import "./interactions/placement.js";
import "./player/foodAndHealth.js";
import "./player/playerState.js";
import "./world/chunkScrubber.js";
import "./world/netherIce.js";
import "./world/classicFog.js";
import "./world/underwaterOverlay.js";
import "./world/island.js";
import "./world/dimensionBoundary.js";
import "./interactions/fenceConnectivity.js";
import "./world/worldBorder.js";
import "./mobs/entitySpawnHandler.js";
import "./mobs/entityCleaner.js";
import "./mobs/betaAnimalAI.js";
import "./mobs/nightmares.js";
import "./mobs/herobrine.js";
import "./world/worldSpawn.js";
import "./interactions/doubleChest.js";

eventBus.init();

tickManager.start();
