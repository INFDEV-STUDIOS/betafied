import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  findAgentsMdFiles,
  isPackExportRoot,
  stripAgentsMd
} from "../../filters/agents-md-strip/strip.js";

/**
 * The nested AGENTS.md files exist in the source tree on purpose — agent tooling
 * loads them by directory — so the filter has to remove them from the *export*
 * without ever touching the source. Every case below builds its own throwaway
 * export rather than operating on this repository.
 */
function makeExport(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agents-md-strip-"));
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

function cleanup(root: string): void {
  fs.rmSync(root, { recursive: true, force: true });
}

describe("Regolith agents-md-strip filter", () => {
  it("finds instruction files at any depth", () => {
    const root = makeExport({
      "BP/scripts/AGENTS.md": "# scripts\n",
      "BP/scripts/core/AGENTS.md": "# core\n",
      "BP/scripts/core/tickManager.ts": "export {};\n",
      "RP/manifest.json": "{}\n"
    });

    try {
      const found = findAgentsMdFiles(root).map((file) => path.relative(root, file));
      assert.deepEqual(found, ["BP/scripts/AGENTS.md", "BP/scripts/core/AGENTS.md"]);
    } finally {
      cleanup(root);
    }
  });

  it("removes them and leaves every other file alone", () => {
    const root = makeExport({
      "BP/manifest.json": "{}\n",
      "BP/scripts/AGENTS.md": "# scripts\n",
      "BP/scripts/core/AGENTS.md": "# core\n",
      "BP/scripts/main.js": "export {};\n",
      "BP/scripts/core/kernel.js": "export {};\n"
    });

    try {
      const removed = stripAgentsMd(root).map((file) => path.relative(root, file));
      assert.deepEqual(removed, ["BP/scripts/AGENTS.md", "BP/scripts/core/AGENTS.md"]);
      assert.deepEqual(findAgentsMdFiles(root), []);
      assert.ok(fs.existsSync(path.join(root, "BP/scripts/main.js")));
      assert.ok(fs.existsSync(path.join(root, "BP/scripts/core/kernel.js")));
    } finally {
      cleanup(root);
    }
  });

  it("is a no-op when the export has no instruction files", () => {
    const root = makeExport({ "BP/manifest.json": "{}\n", "BP/scripts/main.js": "" });

    try {
      assert.deepEqual(stripAgentsMd(root), []);
    } finally {
      cleanup(root);
    }
  });

  it("recognises a pack export by its BP manifest", () => {
    const exportRoot = makeExport({ "BP/manifest.json": "{}\n" });
    const repoLike = makeExport({ "packs/BP/manifest.json": "{}\n" });

    try {
      assert.equal(isPackExportRoot(exportRoot), true);
      assert.equal(
        isPackExportRoot(repoLike),
        false,
        "a source tree must not be treated as an export, or the filter would delete the real instructions"
      );
    } finally {
      cleanup(exportRoot);
      cleanup(repoLike);
    }
  });

  it("refuses this repository, where the instructions are the source of truth", () => {
    assert.equal(
      isPackExportRoot(process.cwd()),
      false,
      "running the filter from the repo root must remove nothing"
    );
  });
});
