import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { reportError, runCatching } from "../../packs/BP/scripts/core/errorReporter.js";

// reportError writes through the ambient Bedrock console, so capture it rather than let every case
// print a line into the test output.
function captureWarnings(): { lines: string[]; restore: () => void } {
    const lines: string[] = [];
    const original = console.warn;
    console.warn = (message?: unknown) => {
        lines.push(String(message));
    };
    return { lines, restore: () => { console.warn = original; } };
}

describe("Error boundary plumbing", () => {
    let captured: { lines: string[]; restore: () => void };

    beforeEach(() => {
        captured = captureWarnings();
    });

    afterEach(() => {
        captured.restore();
    });

    it("returns the callback's value without logging when nothing throws", () => {
        const value = runCatching({ system: "test", operation: "happy" }, () => 42);

        assert.equal(value, 42);
        assert.deepEqual(captured.lines, [], "a successful operation must not log");
    });

    it("swallows the exception so a failing job cannot kill the tick", () => {
        assert.doesNotThrow(() =>
            runCatching({ system: "test", operation: "boom" }, () => {
                throw new Error("InvalidEntityError");
            })
        );
    });

    it("logs the throwing system and operation instead of dropping the error", () => {
        runCatching({ system: "chunkScrubber", operation: "sealFloor", target: "0,0" }, () => {
            throw new Error("chunk unloaded");
        });

        assert.equal(captured.lines.length, 1);
        assert.match(captured.lines[0], /^chunkScrubber: Error during sealFloor/);
        assert.match(captured.lines[0], /target: 0,0/);
        assert.match(captured.lines[0], /chunk unloaded/);
    });

    it("falls back when one is supplied and returns undefined when it is not", () => {
        const recovered = runCatching({ system: "test", operation: "fallback" }, () => {
            throw new Error("nope");
        }, () => "recovered");

        assert.equal(recovered, "recovered");

        const bare = runCatching({ system: "test", operation: "noFallback" }, () => {
            throw new Error("nope");
        });

        assert.equal(bare, undefined);
    });

    it("stringifies a thrown non-Error rather than crashing the reporter itself", () => {
        runCatching({ system: "test", operation: "throwString" }, () => {
            throw "plain string failure";
        });

        assert.equal(captured.lines.length, 1);
        assert.match(captured.lines[0], /plain string failure/);
    });

    it("reports detail entries as key=value pairs", () => {
        reportError({ system: "inventoryManager", operation: "sweep", details: { slot: 3, id: "minecraft:elytra" } }, new Error("x"));

        assert.match(captured.lines[0], /slot=3/);
        assert.match(captured.lines[0], /id=minecraft:elytra/);
    });
});
