/**
 * Keep agent instruction files out of the shipped pack.
 *
 * Regolith copies the whole pack directory into its working tree before any filter
 * runs, so `packs/BP/scripts/AGENTS.md` - which lives in the source tree because
 * agent tooling loads it by directory - is otherwise packaged into the exported
 * pack. Verified against the 5.3.2 release: the four subsystem files are inside
 * `Betafied_5.3.2_BP.mcpack` and the `.mcaddon`.
 *
 * Kept separate from the filter entrypoint so it can be unit tested without
 * spawning Regolith or touching the real export.
 */
import fs from "node:fs";
import path from "node:path";

/** The instruction filename to remove, wherever it appears in the export. */
const TARGET_FILENAME = "AGENTS.md";

/**
 * Whether a directory is Regolith's export working tree rather than the repo.
 *
 * A filter that deletes files must never run against the source tree, so the
 * entrypoint checks this before removing anything: the export has `BP/manifest.json`
 * at its root, the repository has `packs/BP/manifest.json` instead.
 *
 * @param {string} directory
 * @returns {boolean}
 */
export function isPackExportRoot(directory) {
  return fs.existsSync(path.join(directory, "BP", "manifest.json"));
}

/**
 * Every `AGENTS.md` below `root`, recursively.
 *
 * @param {string} root
 * @returns {string[]} paths as walked, in stable depth-first order.
 */
export function findAgentsMdFiles(root) {
  const found = [];
  if (!fs.existsSync(root)) {
    return found;
  }

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      found.push(...findAgentsMdFiles(full));
    } else if (entry.name === TARGET_FILENAME) {
      found.push(full);
    }
  }

  return found;
}

/**
 * Delete every `AGENTS.md` below `root`.
 *
 * @param {string} root
 * @returns {string[]} the paths that were removed, empty when there was nothing to do.
 */
export function stripAgentsMd(root) {
  const removed = findAgentsMdFiles(root);
  for (const file of removed) {
    fs.unlinkSync(file);
  }
  return removed;
}
