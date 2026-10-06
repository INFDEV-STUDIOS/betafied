#!/usr/bin/env node
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import SftpClient from "ssh2-sftp-client";
import { loadEnv } from "./lib/env.mjs";
import { enableBetaApiExperiments } from "./lib/levelDat.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const env = loadEnv(ROOT);

const COM_MOJANG =
  env.COM_MOJANG ??
  path.join(
    env.HOME ?? "",
    "Library/Application Support/Minecraft Bedrock Launcher/MinecraftData/games/com.mojang",
  );

const CONFIG = {
  host: requireEnv("BETAFIED_SFTP_HOST"),
  port: parseInt(env.BETAFIED_SFTP_PORT ?? "2022", 10),
  username: requireEnv("BETAFIED_SFTP_USER"),
  password: requireEnv("BETAFIED_SFTP_PASSWORD"),
  localBp: path.join(COM_MOJANG, "development_behavior_packs", "betafied_bp"),
  localRp: path.join(COM_MOJANG, "development_resource_packs", "betafied_rp"),
  remoteBp: "/development_behavior_packs/betafied_bp",
  remoteRp: "/development_resource_packs/betafied_rp",
};

function requireEnv(name) {
  const value = env[name];
  if (!value) {
    console.error(
      `[push] Missing ${name}. Add it to .env (see .env.example) or export it before pushing.`,
    );
    process.exit(1);
  }
  return value;
}

async function main() {
  console.log("=========================================");
  console.log("  [betafied] Pushing addon to server...  ");
  console.log("=========================================");

  // 1. Build project first
  console.log("-> Compiling TypeScript via regolith...");
  try {
    execSync("./scripts/regolith.sh run", { cwd: ROOT, stdio: "inherit" });
  } catch {
    console.error("Build failed, aborting push.");
    process.exit(1);
  }

  // 2. Verify local build outputs exist
  if (!fs.existsSync(CONFIG.localBp)) {
    console.error(`Build output not found at: ${CONFIG.localBp}`);
    process.exit(1);
  }

  // 3. Connect to SFTP
  const sftp = new SftpClient();
  console.log(`-> Connecting to ${CONFIG.host}:${CONFIG.port} as ${CONFIG.username}...`);
  await sftp.connect({
    host: CONFIG.host,
    port: CONFIG.port,
    username: CONFIG.username,
    password: CONFIG.password,
    readyTimeout: 30000,
  });
  console.log("-> Connected!");

  // 4. Upload betafied_bp
  console.log(`-> Syncing behavior pack to ${CONFIG.remoteBp}...`);
  await sftp.mkdir(path.dirname(CONFIG.remoteBp), true);
  await sftp.uploadDir(CONFIG.localBp, CONFIG.remoteBp);
  console.log("   [✓] Behavior pack synced!");

  // 5. Upload betafied_rp if it exists
  let rpInfo = null;
  if (fs.existsSync(CONFIG.localRp)) {
    console.log(`-> Syncing resource pack to ${CONFIG.remoteRp}...`);
    await sftp.mkdir(path.dirname(CONFIG.remoteRp), true);
    await sftp.uploadDir(CONFIG.localRp, CONFIG.remoteRp);
    console.log("   [✓] Resource pack synced!");
    rpInfo = getPackInfo(CONFIG.localRp);
  }

  const bpInfo = getPackInfo(CONFIG.localBp);

  // 6. Ensure remote world configurations match the pushed packs
  console.log("-> Verifying and syncing world pack manifests...");
  try {
    const worlds = await sftp.list("/worlds");
    for (const w of worlds.filter((item) => item.type === "d")) {
      const worldPath = `/worlds/${w.name}`;
      console.log(`   Configuring world '${w.name}'...`);
      await syncWorldPacks(sftp, worldPath, "world_behavior_packs.json", bpInfo);
      if (rpInfo) {
        await syncWorldPacks(sftp, worldPath, "world_resource_packs.json", rpInfo);
      }
      await syncWorldExperiments(sftp, worldPath);
    }
    console.log("   [✓] World pack configurations verified and up-to-date!");
  } catch (err) {
    console.warn(`   [!] Warning: Failed to sync world pack configurations: ${err.message}`);
  }

  // 7. Ensure the server script modules are permitted
  console.log("-> Verifying server script permissions and content logging...");
  try {
    await syncScriptPermissions(sftp, bpInfo.uuid);
    console.log("   [✓] Server permissions and logging configured!");
  } catch (err) {
    console.warn(`   [!] Warning: Failed to sync script permissions: ${err.message}`);
  }

  await sftp.end();
  console.log("=========================================");
  console.log("  [✓] Push complete! Server is updated.  ");
  console.log("=========================================");
}

function getPackInfo(packPath) {
  const manifestPath = path.join(packPath, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`manifest.json not found at: ${manifestPath}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  return {
    uuid: manifest.header?.uuid,
    version: manifest.header?.version || [1, 0, 0],
  };
}

async function syncWorldPacks(sftp, worldPath, fileName, packInfo) {
  const targetPath = `${worldPath}/${fileName}`;
  let packs = [];
  try {
    const raw = (await sftp.get(targetPath)).toString();
    packs = JSON.parse(raw);
    if (!Array.isArray(packs)) packs = [];
  } catch {
    packs = [];
  }

  const idx = packs.findIndex((p) => p.pack_id === packInfo.uuid);
  const versionMatches =
    idx >= 0 && JSON.stringify(packs[idx].version) === JSON.stringify(packInfo.version);

  if (idx >= 0) {
    if (!versionMatches) {
      console.log(
        `      Updating ${fileName}: ${packInfo.uuid} -> version ${JSON.stringify(packInfo.version)}`,
      );
      packs[idx].version = packInfo.version;
    }
  } else {
    console.log(
      `      Adding to ${fileName}: ${packInfo.uuid} (version ${JSON.stringify(packInfo.version)})`,
    );
    packs.push({
      pack_id: packInfo.uuid,
      version: packInfo.version,
    });
  }

  await sftp.put(Buffer.from(JSON.stringify(packs, null, 2)), targetPath);
}

async function patchDatFile(sftp, datPath) {
  try {
    const patched = await enableBetaApiExperiments(await sftp.get(datPath));
    if (!patched.changed) return false;
    await sftp.put(patched.raw, datPath);
    return true;
  } catch {
    // A world whose level.dat cannot be read is not worth aborting the pack push over.
    return false;
  }
}

async function syncWorldExperiments(sftp, worldPath) {
  const p1 = await patchDatFile(sftp, `${worldPath}/level.dat`);
  const p2 = await patchDatFile(sftp, `${worldPath}/level.dat_old`);
  if (p1 || p2) {
    console.log(`      [✓] Enabled Beta APIs experiments in ${worldPath}!`);
  } else {
    console.log(`      [✓] Beta APIs experiments already active in ${worldPath}`);
  }
}

async function syncScriptPermissions(sftp, packUuid) {
  // 1. Ensure the server's allowed module list covers every module the addon may import
  const permPath = "/config/default/permissions.json";
  try {
    let permObj = { allowed_modules: [] };
    try {
      const raw = (await sftp.get(permPath)).toString();
      permObj = JSON.parse(raw);
    } catch {
      await sftp.mkdir("/config/default", true);
    }
    if (!Array.isArray(permObj.allowed_modules)) permObj.allowed_modules = [];
    const requiredModules = [
      "@minecraft/server",
      "@minecraft/server-net",
      "@minecraft/server-ui",
      "@minecraft/server-admin",
      "@minecraft/server-gametest",
    ];
    let changed = false;
    for (const mod of requiredModules) {
      if (!permObj.allowed_modules.includes(mod)) {
        permObj.allowed_modules.push(mod);
        changed = true;
      }
    }
    if (changed) {
      await sftp.put(Buffer.from(JSON.stringify(permObj, null, 2)), permPath);
    }

    if (packUuid) {
      const packDir = `/config/${packUuid}`;
      await sftp.mkdir(packDir, true);
      await sftp.put(Buffer.from(JSON.stringify(permObj, null, 2)), `${packDir}/permissions.json`);
    }
  } catch (err) {
    console.warn(`      Could not sync permissions.json: ${err.message}`);
  }

  // 2. Ensure content logging is enabled so pack errors reach the console
  const propPath = "/server.properties";
  try {
    let props = (await sftp.get(propPath)).toString();
    let propChanged = false;

    // Upsert, not repair. Repairing only the literal `=false` form meant a key that was absent
    // altogether left logging off, which is exactly the state a fresh server.properties ships in.
    const enable = (key) => {
      const anyValue = new RegExp(`^${key}=.*\\r?$`, "m");
      if (anyValue.test(props)) {
        if (new RegExp(`^${key}=true\\r?$`, "m").test(props)) return;
        props = props.replace(anyValue, `${key}=true`);
        propChanged = true;
        return;
      }
      if (!props.endsWith("\n")) props += "\n";
      props += `${key}=true\n`;
      propChanged = true;
    };

    enable("content-log-console-output-enabled");
    enable("content-log-file-enabled");

    if (propChanged) {
      await sftp.put(Buffer.from(props), propPath);
    }
  } catch (err) {
    console.warn(`      Could not sync server.properties logging: ${err.message}`);
  }
}

main().catch((err) => {
  console.error("Push failed with error:", err.message || err);
  process.exit(1);
});
