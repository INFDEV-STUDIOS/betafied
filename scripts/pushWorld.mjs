#!/usr/bin/env node
// Push a world to the hosted server, replacing the one already there.
//
//   npm run push:world -- --file=gargamel_merged.mcworld --world=gargamel --yes
//
// The archive is unpacked into a working directory, its pack pair is reconciled (the pair already
// on the server wins by default, so the world keeps loading the packs installed there) and its
// level.dat is patched for Beta APIs. The result uploads to a staging directory and is verified
// before two renames swap it into place, so an interrupted transfer never leaves the live world
// half-written and the replaced world survives beside it under a timestamped name.
//
// The target world must not be live: the engine holds its LevelDB open while the server runs.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import SftpClient from "ssh2-sftp-client";
import { loadEnv } from "./lib/env.mjs";
import {
  BETA_API_EXPERIMENT_FLAGS,
  enableBetaApiExperiments,
  enabledExperiments,
  levelName,
  readLevelDat,
} from "./lib/levelDat.mjs";
import {
  WORLD_PACK_FILES,
  alignInstalledVersions,
  packVersionDrift,
  parsePackPair,
  resolvePackPair,
  serializePackPair,
} from "./lib/worldPacks.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = loadEnv(ROOT);

const REMOTE_WORLDS = "/worlds";
const PROGRESS_STEP = 256 * 1024 * 1024;

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

const WORLD = value("world") ?? "gargamel";
const defaultFile = fs.existsSync(path.resolve(ROOT, "gargamel_merged.mcworld"))
  ? "gargamel_merged.mcworld"
  : "gargamel_merged_unsmoothed.mcworld";
const FILE = path.resolve(ROOT, value("file") ?? defaultFile);
const WORK = path.resolve(ROOT, value("work") ?? ".betafied-world");
const KEEP_PACKS = value("packs") !== "archive";
const DRY_RUN = flag("dry-run");
const CONFIRMED = flag("yes");
const IN_PLACE = flag("in-place");
const BACKUP = !flag("no-backup");
const ACTIVATE = !flag("no-activate");
const REEXTRACT = flag("reextract");

const WORLD_PATH = `${REMOTE_WORLDS}/${WORLD}`;
const STAGING_PATH = `${REMOTE_WORLDS}/${WORLD}.staging`;
const UPLOAD_PATH = IN_PLACE ? WORLD_PATH : STAGING_PATH;
const EXTRACTED = path.join(WORK, "world");

function log(message) {
  console.log(`pushWorld: ${message}`);
}

function fail(message) {
  console.error(`pushWorld: ${message}`);
  process.exit(1);
}

const ignored = (name) => name === ".DS_Store" || name === "__MACOSX" || name.startsWith("._");

function walkLocal(dir, prefix = "") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignored(entry.name)) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walkLocal(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

async function walkRemote(sftp, dir) {
  const out = [];
  for (const entry of await sftp.list(dir)) {
    const full = `${dir}/${entry.name}`;
    if (entry.type === "d") out.push(...(await walkRemote(sftp, full)));
    else out.push({ rel: full, size: entry.size, modifyTime: entry.modifyTime });
  }
  return out;
}

function human(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

// SFTP modify times arrive in seconds from some servers and milliseconds from others.
const asDate = (modifyTime) =>
  new Date(modifyTime > 1e11 ? modifyTime : modifyTime * 1000).toISOString();

function summariseLocal(dir) {
  const files = walkLocal(dir);
  const bytes = files.reduce((total, rel) => total + fs.statSync(path.join(dir, rel)).size, 0);
  return { files: files.length, bytes };
}

function summariseRemote(sftp, dir) {
  return walkRemote(sftp, dir).then((entries) => {
    const newest = entries.reduce((a, b) => (b.modifyTime > a.modifyTime ? b : a), entries[0]);
    return {
      files: entries.length,
      bytes: entries.reduce((total, entry) => total + entry.size, 0),
      newest: newest ? { file: newest.rel, at: asDate(newest.modifyTime) } : undefined,
    };
  });
}

async function exists(sftp, remotePath) {
  try {
    await sftp.stat(remotePath);
    return true;
  } catch {
    return false;
  }
}

async function readRemote(sftp, remotePath) {
  try {
    return await sftp.get(remotePath);
  } catch {
    return undefined;
  }
}

/** Extracts the archive, or copies a directory, into the working tree. */
function extract() {
  const stat = fs.statSync(FILE);
  if (!REEXTRACT && fs.existsSync(EXTRACTED)) {
    log(`reusing the unpacked world at ${path.relative(ROOT, EXTRACTED)} (--reextract to refresh)`);
    return;
  }
  fs.rmSync(EXTRACTED, { recursive: true, force: true });
  fs.mkdirSync(EXTRACTED, { recursive: true });

  if (stat.isDirectory()) {
    log(`copying ${path.relative(ROOT, FILE)} into the working tree`);
    fs.cpSync(FILE, EXTRACTED, { recursive: true });
  } else {
    log(`unpacking ${path.basename(FILE)} (${human(stat.size)})`);
    try {
      execFileSync("unzip", ["-o", "-q", FILE, "-d", EXTRACTED], { stdio: ["ignore", "ignore", "inherit"] });
    } catch (err) {
      fail(`unzip failed on ${path.basename(FILE)}: ${err.message}`);
    }
  }

  for (const name of ["db", "level.dat"]) {
    if (!fs.existsSync(path.join(EXTRACTED, name))) {
      fail(`the archive has no ${name} — refusing to push something that is not a world`);
    }
  }
}

/** Rewrites the pack pair and the experiment flags, then reports what changed. */
async function prepare(serverPacks, installed) {
  // A world exported without packs simply has no pair file; an empty pair then means "no packs",
  // which is the archive's honest answer and still loses to the server's pair under --packs=keep.
  const readPair = (file) => {
    const target = path.join(EXTRACTED, file);
    if (!fs.existsSync(target)) {
      log(`${file}: absent from the archive, treating as an empty pair`);
      return [];
    }
    return parsePackPair(fs.readFileSync(target).toString(), `archive ${file}`);
  };

  for (const [kind, file] of Object.entries(WORLD_PACK_FILES)) {
    const resolved = resolvePackPair({
      server: serverPacks[kind],
      archive: readPair(file),
      keep: KEEP_PACKS,
    });
    const aligned = alignInstalledVersions(resolved.pair, installed[kind]);
    fs.writeFileSync(path.join(EXTRACTED, file), serializePackPair(aligned));
    log(`${file}: ${aligned.length} entries from ${resolved.source}`);
    for (const dropped of resolved.dropped) log(`   dropped ${dropped} (not on the server)`);
    for (const drift of packVersionDrift(aligned, installed[kind])) log(`   warning: ${drift}`);
  }

  const datPath = path.join(EXTRACTED, "level.dat");
  const patched = await enableBetaApiExperiments(fs.readFileSync(datPath));
  if (patched.changed) fs.writeFileSync(datPath, patched.raw);

  // Read the written file back: a corrupted level.dat would upload happily and only surface as a
  // world that never loads.
  const readback = await readLevelDat(fs.readFileSync(datPath));
  const enabled = enabledExperiments(readback.tag);
  const missing = BETA_API_EXPERIMENT_FLAGS.filter((name) => !enabled.has(name));
  if (missing.length > 0) fail(`level.dat readback is missing experiment flags: ${missing.join(", ")}`);

  const levelnamePath = path.join(EXTRACTED, "levelname.txt");
  if (fs.existsSync(levelnamePath)) fs.writeFileSync(levelnamePath, WORLD);

  log(
    `level.dat: version=${readback.version}, LevelName=${JSON.stringify(levelName(readback.tag))}, ` +
      `experiments patched=${patched.changed}, all ${BETA_API_EXPERIMENT_FLAGS.length} flags present`,
  );
}

async function upload(sftp, root) {
  const files = walkLocal(root);
  const total = files.reduce((sum, rel) => sum + fs.statSync(path.join(root, rel)).size, 0);
  log(`uploading ${files.length} files (${human(total)}) -> ${UPLOAD_PATH}`);

  const made = new Set();
  const started = Date.now();
  let sent = 0;
  let nextMark = PROGRESS_STEP;

  for (const rel of files) {
    const remotePath = `${UPLOAD_PATH}/${rel}`;
    const dir = path.posix.dirname(remotePath);
    if (!made.has(dir)) {
      await sftp.mkdir(dir, true);
      made.add(dir);
    }
    await sftp.fastPut(path.join(root, rel), remotePath);
    sent += fs.statSync(path.join(root, rel)).size;
    if (sent >= nextMark) {
      const rate = sent / 1024 / 1024 / ((Date.now() - started) / 1000);
      log(`   ${Math.round(sent / 1024 / 1024)}MB (${rate.toFixed(1)} MB/s)`);
      nextMark += PROGRESS_STEP;
    }
  }
  log(`uploaded ${human(sent)} in ${Math.round((Date.now() - started) / 1000)}s`);
}

async function verifyRemote(sftp, remoteDir, localSummary) {
  const remote = await summariseRemote(sftp, remoteDir);
  if (remote.files !== localSummary.files || remote.bytes !== localSummary.bytes) {
    fail(
      `${remoteDir} has ${remote.files} files/${remote.bytes} bytes but local has ` +
        `${localSummary.files}/${localSummary.bytes} — not swapping`,
    );
  }
  log(`verified ${remote.files} files, ${human(remote.bytes)} at ${remoteDir}`);

  for (const file of Object.values(WORLD_PACK_FILES)) {
    const remoteText = (await sftp.get(`${remoteDir}/${file}`)).toString();
    const remotePair = parsePackPair(remoteText, `remote ${file}`);
    const localPair = parsePackPair(fs.readFileSync(path.join(EXTRACTED, file)).toString(), file);
    if (JSON.stringify(remotePair) !== JSON.stringify(localPair)) {
      fail(`${remoteDir}/${file} does not match the prepared pair`);
    }
  }

  const dat = await readLevelDat(await sftp.get(`${remoteDir}/level.dat`));
  const enabled = enabledExperiments(dat.tag);
  const missing = BETA_API_EXPERIMENT_FLAGS.filter((name) => !enabled.has(name));
  if (missing.length > 0) fail(`${remoteDir}/level.dat is missing ${missing.join(", ")}`);
  log(`verified ${remoteDir}/level.dat: LevelName=${JSON.stringify(levelName(dat.tag))}`);
  return remote;
}

async function readInstalledPacks(sftp, remoteDir) {
  const installed = [];
  let entries = [];
  try {
    entries = await sftp.list(remoteDir);
  } catch {
    return installed;
  }
  for (const entry of entries.filter((e) => e.type === "d")) {
    const manifest = await readRemote(sftp, `${remoteDir}/${entry.name}/manifest.json`);
    if (!manifest) continue;
    try {
      const parsed = JSON.parse(manifest.toString());
      const { uuid, version } = parsed.header ?? {};
      if (typeof uuid !== "string" || !Array.isArray(version)) continue;
      installed.push({ name: entry.name, uuid, version });
    } catch {
      log(`could not read ${remoteDir}/${entry.name}/manifest.json`);
    }
  }
  return installed;
}

async function activate(sftp, props) {
  const current = props.match(/^level-name=(.*)$/m)?.[1];
  if (current === WORLD) {
    log(`server.properties already points at ${WORLD}`);
    return;
  }
  const backupPath = path.join(WORK, `server.properties.bak-${stamp()}`);
  fs.writeFileSync(backupPath, props);
  const updated = props.replace(/^(level-name=)(.*?)(\r?)$/m, (_, key, _old, cr) => `${key}${WORLD}${cr}`);
  if (updated.match(/^level-name=(.*)$/m)?.[1] !== WORLD) fail("could not rewrite level-name; aborting");
  await sftp.put(Buffer.from(updated), "/server.properties");
  const readback = (await sftp.get("/server.properties")).toString();
  log(
    `server.properties level-name: ${JSON.stringify(current)} -> ` +
      `${JSON.stringify(readback.match(/^level-name=(.*)$/m)?.[1])} (backup ${path.relative(ROOT, backupPath)})`,
  );
}

const stamp = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
};

async function main() {
  if (!CONFIRMED && !DRY_RUN) {
    fail("this replaces a world on the live server — stop the server, then pass --yes (or --dry-run)");
  }
  if (!fs.existsSync(FILE)) fail(`no such world: ${path.relative(ROOT, FILE)}`);
  if (/[\\/]|\.\./.test(WORLD)) fail(`invalid world name '${WORLD}'`);

  const host = env.BETAFIED_SFTP_HOST;
  const username = env.BETAFIED_SFTP_USER;
  const password = env.BETAFIED_SFTP_PASSWORD;
  if (!host || !username || !password) fail("missing BETAFIED_SFTP_* values in .env");

  const sftp = new SftpClient();
  log(`connecting to ${host}...`);
  await sftp.connect({
    host,
    port: parseInt(env.BETAFIED_SFTP_PORT ?? "2022", 10),
    username,
    password,
    readyTimeout: 30000,
  });

  try {
    const worldExists = await exists(sftp, WORLD_PATH);
    if (!worldExists && IN_PLACE) fail(`${WORLD_PATH} does not exist; drop --in-place to create it`);
    const existing = worldExists ? await summariseRemote(sftp, WORLD_PATH) : undefined;
    if (existing) {
      log(
        `replacing ${WORLD_PATH}: ${existing.files} files, ${human(existing.bytes)}` +
          (existing.newest ? `, newest file ${existing.newest.file} at ${existing.newest.at}` : ""),
      );
    } else {
      log(`${WORLD_PATH} does not exist yet; this is a first push`);
    }

    const serverPacks = { behavior: undefined, resource: undefined };
    if (worldExists) {
      for (const [kind, file] of Object.entries(WORLD_PACK_FILES)) {
        const raw = await readRemote(sftp, `${WORLD_PATH}/${file}`);
        if (raw) serverPacks[kind] = parsePackPair(raw.toString(), `server ${file}`);
      }
    }
    const installed = {
      behavior: await readInstalledPacks(sftp, "/development_behavior_packs"),
      resource: await readInstalledPacks(sftp, "/development_resource_packs"),
    };
    const props = (await readRemote(sftp, "/server.properties"))?.toString() ?? "";

    extract();
    await prepare(serverPacks, installed);
    const local = summariseLocal(EXTRACTED);
    log(`prepared ${local.files} files, ${human(local.bytes)}`);

    if (DRY_RUN) {
      log("dry run — nothing was uploaded. Rerun with --yes once the server is stopped.");
      return;
    }

    if (IN_PLACE) {
      log(`--in-place: removing ${WORLD_PATH} before uploading`);
      await sftp.rmdir(WORLD_PATH, true);
    } else if (await exists(sftp, STAGING_PATH)) {
      log(`clearing the stale staging directory ${STAGING_PATH}`);
      await sftp.rmdir(STAGING_PATH, true);
    }

    await upload(sftp, EXTRACTED);
    await verifyRemote(sftp, UPLOAD_PATH, local);

    if (!IN_PLACE) {
      await swap(sftp, worldExists);
    }
    if (ACTIVATE) await activate(sftp, props);

    log("done.");
    if (!IN_PLACE && BACKUP && worldExists) {
      log(`the replaced world is kept at ${REMOTE_WORLDS}/${WORLD}.bak-* — delete it once the server is happy`);
    }
    log(`start the server (${WORLD_PATH} is now the uploaded world).`);
  } finally {
    await sftp.end().catch(() => {});
  }
}

/**
 * Two renames: the verified staging directory becomes the world, the old world is moved aside
 * first so the promoted world always replaces something rather than a hole. Without --no-backup
 * the moved-aside directory is the backup; with it, it is removed only after the promotion landed.
 */
async function swap(sftp, worldExists) {
  const aside = `${REMOTE_WORLDS}/${WORLD}.${BACKUP ? "bak" : "replaced"}-${stamp()}`;
  if (worldExists) {
    log(`moving the current world aside to ${aside}`);
    await rename(sftp, WORLD_PATH, aside);
  }
  log(`promoting ${STAGING_PATH} to ${WORLD_PATH}`);
  await rename(sftp, STAGING_PATH, WORLD_PATH);
  if (worldExists && !BACKUP) {
    log(`removing the replaced world ${aside}`);
    await sftp.rmdir(aside, true);
  }
}

async function rename(sftp, from, to) {
  try {
    await sftp.rename(from, to);
  } catch (err) {
    fail(
      `could not rename ${from} -> ${to} (${err.message}). The upload is sitting at ${from}; ` +
        "rerun with --in-place to write straight into the world directory instead.",
    );
  }
}

main().catch((err) => {
  console.error(`pushWorld failed: ${err?.message ?? err}`);
  process.exit(1);
});
