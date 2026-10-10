import fs from "node:fs";
import path from "node:path";

/**
 * Read `KEY=value` pairs from a dotenv-style file.
 *
 * Only enough of the format for the flat values betafied keeps here: a line is
 * a name, an optional `=`, and a value that may be wrapped in matching quotes.
 */
export function parseEnv(contents) {
  const out = {};
  for (const line of contents.split("\n")) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[match[1]] = value;
  }
  return out;
}

/**
 * `.env` values overlaid with the real environment, which wins.
 *
 * npm does not export `.env`, so the build and release entrypoints load it themselves
 * through here. Keeping the process environment on top lets a one-off
 * `COM_MOJANG=... npm run build` override the file without editing it.
 */
export function loadEnv(root) {
  const file = path.join(root, ".env");
  const fromFile = fs.existsSync(file) ? parseEnv(fs.readFileSync(file, "utf8")) : {};
  return { ...fromFile, ...process.env };
}
