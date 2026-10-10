/**
 * Regolith local filter: drop the agent instruction files from the exported pack.
 *
 * The nested `AGENTS.md` files are read by agent tooling straight out of the pack
 * source tree, and Regolith copies that tree before any filter runs, so without this
 * step they are packaged into the exported pack and attached to releases.
 *
 * Refuses to touch anything when it does not recognise the working directory as a
 * pack export, so a misconfigured filter can never delete the source instructions.
 */
import path from "node:path";
import { isPackExportRoot, stripAgentsMd } from "./strip.js";

const settings = process.argv[2] ? JSON.parse(process.argv[2]) : {};
const target = typeof settings.path === "string" && settings.path.length > 0 ? settings.path : ".";
const cwd = process.cwd();

if (!isPackExportRoot(cwd)) {
  console.warn(
    `agents-md-strip: ${cwd} has no BP/manifest.json, so it is not a pack export; nothing removed`
  );
  process.exit(0);
}

const removed = stripAgentsMd(path.join(cwd, target));

if (removed.length > 0) {
  console.log(
    `agents-md-strip: removed ${removed.length} instruction file(s) from the export: ${removed.join(", ")}`
  );
}
