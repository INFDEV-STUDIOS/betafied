import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The Bedrock `com.mojang` directory, resolved without assuming the host OS.
 *
 * Regolith already finds this on Windows (the UWP data folder has one fixed shape) and
 * exposes `COM_MOJANG` for everyone else. macOS installs are the one case with a single
 * known location on every machine, which is the only default worth guessing. On Linux the
 * folder can live anywhere, so an unset value is left for Regolith's own resolution rather
 * than exported as a path that does not exist.
 *
 * `env` is the merged `.env` + process environment; an inherited value still wins.
 */
export function resolveComMojang(env = process.env, platform = process.platform) {
  const fromEnv = env.COM_MOJANG;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  if (platform === "darwin") {
    const candidate = path.join(
      os.homedir(),
      "Library/Application Support/Minecraft Bedrock Launcher/MinecraftData/games/com.mojang"
    );
    if (fs.existsSync(candidate)) return candidate;
  }

  return undefined;
}
