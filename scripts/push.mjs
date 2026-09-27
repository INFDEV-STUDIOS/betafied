#!/usr/bin/env node
import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import SftpClient from "ssh2-sftp-client";
import nbt from "prismarine-nbt";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

loadDotEnv(path.join(ROOT, ".env"));

const COM_MOJANG =
  process.env.COM_MOJANG ??
  path.join(
    process.env.HOME ?? "",
    "Library/Application Support/Minecraft Bedrock Launcher/MinecraftData/games/com.mojang",
  );

const CONFIG = {
  host: requireEnv("BETAFIED_SFTP_HOST"),
  port: parseInt(process.env.BETAFIED_SFTP_PORT ?? "2022", 10),
  username: requireEnv("BETAFIED_SFTP_USER"),
  password: requireEnv("BETAFIED_SFTP_PASSWORD"),
  localBp: path.join(COM_MOJANG, "development_behavior_packs", "betafied_bp"),
  localRp: path.join(COM_MOJANG, "development_resource_packs", "betafied_rp"),
  remoteBp: "/development_behavior_packs/betafied_bp",
  remoteRp: "/development_resource_packs/betafied_rp",
};

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  try {
    process.loadEnvFile(file);
  } catch (err) {
    console.warn(`[push] could not read ${file}: ${err.message}`);
  }
}

function requireEnv(name) {
  const value = process.env[name];
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
    const rawDat = await sftp.get(datPath);
    if (!rawDat || rawDat.length < 8) return false;

    const version = rawDat.readInt32LE(0);
    const parsed = await nbt.parse(rawDat.subarray(8), "little");
    if (!parsed?.parsed?.value) return false;

    if (!parsed.parsed.value.experiments || parsed.parsed.value.experiments.type !== "compound") {
      parsed.parsed.value.experiments = { type: "compound", value: {} };
    }

    const exp = parsed.parsed.value.experiments.value;
    let modified = false;

    const requiredFlags = [
      "gametest",
      "experiments_ever_used",
      "saved_with_toggled_experiments",
      "upcoming_creator_features",
      "data_driven_biomes",
    ];

    for (const flag of requiredFlags) {
      if (!exp[flag] || exp[flag].value !== 1) {
        exp[flag] = { type: "byte", value: 1 };
        modified = true;
      }
    }

    if (modified) {
      const newNbtBuf = nbt.writeUncompressed(parsed.parsed, "little");
      const newHeader = Buffer.alloc(8);
      newHeader.writeInt32LE(version, 0);
      newHeader.writeInt32LE(newNbtBuf.length, 4);
      const finalBuf = Buffer.concat([newHeader, newNbtBuf]);
      await sftp.put(finalBuf, datPath);
      return true;
    }
    return false;
  } catch {
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
    if (props.includes("content-log-console-output-enabled=false")) {
      props = props.replace("content-log-console-output-enabled=false", "content-log-console-output-enabled=true");
      propChanged = true;
    }
    if (props.includes("content-log-file-enabled=false")) {
      props = props.replace("content-log-file-enabled=false", "content-log-file-enabled=true");
      propChanged = true;
    }
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
