import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

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

    it("looks dimensions up by the short keys the API documents", () => {
        // `Dimension.id` is the `minecraft:`-prefixed identifier, but `world.getDimension` is
        // documented against the short keys ("overworld", "nether", "the_end") and rejects some
        // prefixed forms outright. Passing an id constant here is the regression this pins.
        const scriptsDir = resolve(root, "packs/BP/scripts");
        const offenders: string[] = [];

        for (const file of readdirSync(scriptsDir, { recursive: true }).map(String).filter(f => f.endsWith(".ts"))) {
            const source = readFileSync(resolve(scriptsDir, file), "utf-8");
            for (const match of source.matchAll(/getDimension\(\s*([A-Z_][A-Z0-9_]*)\s*\)/g)) {
                if (match[1].endsWith("_ID")) {
                    offenders.push(`${file} -> ${match[1]}`);
                }
            }
        }

        assert.deepEqual(offenders, [], `world.getDimension must take a short key, not a Dimension.id: ${offenders.join(", ")}`);
    });

    it("reaches every script module from main.ts so the transpiler emits it", () => {
        // ts_transpiler only emits files imported directly or indirectly from main.ts, so a module
        // that nothing imports is silently dropped from the built pack rather than failing a build.
        const scriptsDir = resolve(root, "packs/BP/scripts");

        const scriptFiles = (): string[] =>
            readdirSync(scriptsDir, { recursive: true })
                .map(String)
                .filter(file => file.endsWith(".ts") && !file.endsWith(".d.ts"))
                .map(file => resolve(scriptsDir, file));

        // Imports in the pack always carry the emitted .js extension while the sources are .ts, so
        // the specifier is rewritten rather than looked up verbatim.
        const relativeImportsOf = (file: string): string[] => {
            const source = readFileSync(file, "utf-8");
            const specifiers = [
                ...source.matchAll(/from\s+["']([^"']+)["']/g),
                ...source.matchAll(/^\s*import\s+["']([^"']+)["']/gm)
            ].map(match => match[1]);
            return specifiers.filter(specifier => specifier.startsWith("."));
        };

        const entry = resolve(scriptsDir, "main.ts");
        const reachable = new Set<string>([entry]);
        const queue = [entry];

        while (queue.length > 0) {
            const file = queue.pop() as string;
            for (const specifier of relativeImportsOf(file)) {
                const target = resolve(dirname(file), specifier).replace(/\.js$/, ".ts");
                if (!existsSync(target) || reachable.has(target)) continue;
                reachable.add(target);
                queue.push(target);
            }
        }

        const orphaned = scriptFiles()
            .filter(file => !reachable.has(file))
            .map(file => relative(root, file));

        assert.deepEqual(orphaned, [], `Unreferenced modules will be dropped from the build: ${orphaned.join(", ")}`);
    });
});
