import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

describe("Bedrock Runtime Smoke Suite - Manifest & Entrypoint Integrity", () => {
    const root = process.cwd();
    const bpManifestPath = resolve(root, "packs/BP/manifest.json");
    const rpManifestPath = resolve(root, "packs/RP/manifest.json");
    const mainScriptPath = resolve(root, "packs/BP/scripts/main.ts");

    it("verifies behavior pack manifest structure and script module entrypoint", () => {
        assert.ok(existsSync(bpManifestPath), "BP manifest must exist");
        const raw = readFileSync(bpManifestPath, "utf-8");
        const manifest = JSON.parse(raw);

        assert.equal(manifest.format_version, 2, "BP format_version must be 2");
        assert.ok(manifest.header.uuid, "BP header must contain a UUID");
        assert.ok(manifest.header.version, "BP header must contain version array");

        const scriptModule = manifest.modules.find((m: any) => m.type === "script");
        assert.ok(scriptModule, "BP manifest must have a script module");
        assert.equal(scriptModule.entry, "scripts/main.js", "Script entrypoint must be scripts/main.js");

        // Verify @minecraft/server dependency exists with valid version
        const serverDep = manifest.dependencies.find((d: any) => d.module_name === "@minecraft/server");
        assert.ok(serverDep, "BP manifest must declare @minecraft/server dependency");
        assert.ok(serverDep.version, "@minecraft/server dependency must have a version");
    });

    it("verifies resource pack manifest structure", () => {
        assert.ok(existsSync(rpManifestPath), "RP manifest must exist");
        const raw = readFileSync(rpManifestPath, "utf-8");
        const manifest = JSON.parse(raw);

        assert.equal(manifest.format_version, 2, "RP format_version must be 2");
        assert.ok(manifest.header.uuid, "RP header must contain a UUID");
        assert.ok(manifest.modules.some((m: any) => m.type === "resources"), "RP must have resources module");
    });

    it("verifies script entrypoint file exists on disk", () => {
        assert.ok(existsSync(mainScriptPath), "packs/BP/scripts/main.ts must exist on disk");
    });

    it("verifies all referenced submodules exist", () => {
        const submodules = [
            "packs/BP/scripts/core/inventoryManager.ts",
            "packs/BP/scripts/core/compatibilityPolicy.ts",
            "packs/BP/scripts/core/permissions.ts",
            "packs/BP/scripts/core/errorReporter.ts",
            "packs/BP/scripts/player/achievements.ts",
            "packs/BP/scripts/player/welcome.ts",
            "packs/BP/scripts/player/foodAndHealth.ts",
            "packs/BP/scripts/player/playerState.ts",
            "packs/BP/scripts/combat/armor.ts",
            "packs/BP/scripts/combat/machineGunBow.ts",
            "packs/BP/scripts/interactions/redstoneMining.ts",
            "packs/BP/scripts/interactions/swordMining.ts",
            "packs/BP/scripts/interactions/boatCollision.ts",
            "packs/BP/scripts/interactions/furnaceMinecart.ts",
            "packs/BP/scripts/interactions/instantBonemeal.ts",
            "packs/BP/scripts/interactions/placement.ts",
            "packs/BP/scripts/interactions/fenceConnectivity.ts",
            "packs/BP/scripts/world/buildHeightLimit.ts",
            "packs/BP/scripts/world/chunkScrubber.ts",
            "packs/BP/scripts/world/dimensionBoundary.ts",
            "packs/BP/scripts/world/classicFog.ts",
            "packs/BP/scripts/world/island.ts",
            "packs/BP/scripts/world/netherIce.ts",
            "packs/BP/scripts/world/worldBorder.ts",
            "packs/BP/scripts/mobs/betaAnimalAI.ts",
            "packs/BP/scripts/mobs/entityCleaner.ts",
            "packs/BP/scripts/mobs/entitySpawnHandler.ts",
            "packs/BP/scripts/mobs/nightmares.ts",
            "packs/BP/scripts/mobs/pigmanEquipment.ts"
        ];

        for (const mod of submodules) {
            assert.ok(existsSync(resolve(root, mod)), `Submodule ${mod} must exist on disk`);
        }
    });
});
