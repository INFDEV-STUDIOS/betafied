#!/usr/bin/env node
/**
 * Cross-platform entrypoint for the Regolith CLI.
 *
 * This used to be a bash script, which made every npm script that builds depend on a POSIX
 * shell. The only things it did that Regolith would not were (a) load `.env`, because the
 * build target is read from `COM_MOJANG`, and (b) fall back to the macOS install location
 * for that variable. Both are OS-independent, so they live here and the build runs in a
 * plain Windows shell as readily as on macOS or Linux.
 */
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./lib/env.mjs";
import { resolveComMojang } from "./lib/comMojang.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const childEnv = { ...loadEnv(ROOT) };

const comMojang = resolveComMojang(childEnv);
if (comMojang) {
  childEnv.COM_MOJANG = comMojang;
} else {
  // A `.env` inherited from another machine can point at a directory that does not exist
  // here; leaving it set makes Regolith build into a literal path inside the repo. Drop it
  // so the CLI resolves its own default.
  delete childEnv.COM_MOJANG;
}

// Regolith installs to ~/.local/bin on the Unixes; Windows puts it on PATH itself.
if (process.platform !== "win32") {
  const localBin = path.join(os.homedir(), ".local", "bin");
  childEnv.PATH = childEnv.PATH ? `${localBin}${path.delimiter}${childEnv.PATH}` : localBin;
}

const result = spawnSync("regolith", process.argv.slice(2), {
  cwd: ROOT,
  stdio: "inherit",
  env: childEnv,
  // Node does not consult PATHEXT with a bare command name, so let cmd.exe resolve
  // `regolith` to its .exe on Windows.
  shell: process.platform === "win32",
});

if (result.error) {
  console.error(`regolith: could not launch the CLI: ${result.error.message}`);
  console.error("Install Regolith and make sure it is on PATH.");
  process.exit(1);
}

process.exit(result.status ?? 1);
