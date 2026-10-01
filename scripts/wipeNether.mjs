#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import SftpClient from "ssh2-sftp-client";
import { LevelDB } from "@8crafter/leveldb-zlib";
import { netherKeyContentType } from "./lib/netherKeys.mjs";
import { loadEnv } from "./lib/env.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = loadEnv(ROOT);

const BATCH_SIZE = 5000;
const REMOTE_WORLDS = "/worlds";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

const WORLD = value("world");
const DRY_RUN = flag("dry-run");
const NO_BACKUP = flag("no-backup");
const CONFIRMED = flag("yes");
const WORK_DIR = path.resolve(ROOT, value("work") ?? ".betafied-wipe");
const REMOTE_DB = WORLD ? `${REMOTE_WORLDS}/${WORLD}/db` : undefined;

function fail(message) {
  console.error(`wipeNether: ${message}`);
  process.exit(1);
}

async function walkRemote(sftp, dir, prefix = "") {
  const entries = await sftp.list(dir);
  const files = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.type === "d") files.push(...(await walkRemote(sftp, `${dir}/${entry.name}`, rel)));
    else if (entry.type === "-") files.push(rel);
  }
  return files;
}

function walkLocal(dir, prefix = "") {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...walkLocal(path.join(dir, entry.name), rel));
    else files.push(rel);
  }
  return files;
}

function human(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/**
 * Streams the database, tallying Nether keys and (when `apply`) deleting them in batches.
 * The iterator holds its own snapshot, so deleting behind it is safe.
 */
async function filterNetherKeys(dbPath, apply) {
  const db = new LevelDB(dbPath, { createIfMissing: false });
  await db.open();

  const counts = new Map();
  const pending = [];
  let scanned = 0;
  let matched = 0;

  const flush = async () => {
    if (!apply || pending.length === 0) {
      pending.length = 0;
      return;
    }
    await db.batch(pending.map((key) => ({ type: "del", key })));
    pending.length = 0;
  };

  const iterator = db.getIterator({ keys: true, values: false, keyAsBuffer: true, valueAsBuffer: true });
  try {
    for await (const [key] of iterator) {
      scanned++;
      const type = netherKeyContentType(key);
      if (type === null) continue;
      matched++;
      counts.set(type, (counts.get(type) ?? 0) + 1);
      if (apply) {
        pending.push(key);
        if (pending.length >= BATCH_SIZE) await flush();
      }
    }
    await flush();
  } finally {
    // iterator.end() never resolves once the snapshot is drained, so only the db is closed.
    await db.close().catch(() => {});
  }

  return { scanned, matched, counts };
}

async function main() {
  if (!CONFIRMED && !DRY_RUN && !flag("list")) {
    fail("this erases the Nether from a live world — pass --yes once the server is stopped, or --dry-run");
  }
  if (WORLD && /[\\/]|\.\./.test(WORLD)) fail(`invalid world name '${WORLD}'`);

  const host = env.BETAFIED_SFTP_HOST;
  const username = env.BETAFIED_SFTP_USER;
  const password = env.BETAFIED_SFTP_PASSWORD;
  if (!host || !username || !password) fail("missing BETAFIED_SFTP_* values in .env");

  const sftp = new SftpClient();
  console.log(`wipeNether: connecting to ${host}...`);
  await sftp.connect({
    host,
    port: parseInt(env.BETAFIED_SFTP_PORT ?? "2022", 10),
    username,
    password,
    readyTimeout: 30000,
  });

  try {
    const worlds = (await sftp.list(REMOTE_WORLDS)).filter((e) => e.type === "d").map((e) => e.name);
    if (flag("list")) {
      console.log(`wipeNether: worlds on server -> ${worlds.join(", ") || "(none)"}`);
      return;
    }
    if (!WORLD) fail(`pass --world=<name>. Server has: ${worlds.join(", ") || "(none)"}`);
    if (!worlds.includes(WORLD)) fail(`world '${WORLD}' not found. Server has: ${worlds.join(", ") || "(none)"}`);

    const remoteFiles = await walkRemote(sftp, REMOTE_DB);
    let remoteBytes = 0;
    for (const rel of remoteFiles) remoteBytes += (await sftp.stat(`${REMOTE_DB}/${rel}`)).size;
    console.log(`wipeNether: ${REMOTE_DB} holds ${remoteFiles.length} files (${human(remoteBytes)})`);
    console.log("wipeNether: the server MUST be stopped — a live LevelDB must never be rewritten");

    const workDir = path.join(WORK_DIR, WORLD);
    const pristineDir = path.join(workDir, "db");
    const outputDir = path.join(workDir, "db.filtered");

    if (flag("redownload") || !fs.existsSync(pristineDir)) {
      fs.rmSync(pristineDir, { recursive: true, force: true });
      fs.mkdirSync(pristineDir, { recursive: true });
      console.log(`wipeNether: downloading db -> ${pristineDir}`);
      await sftp.downloadDir(REMOTE_DB, pristineDir);
    } else {
      console.log(`wipeNether: reusing the existing download at ${pristineDir} (--redownload to refresh)`);
    }

    fs.rmSync(outputDir, { recursive: true, force: true });
    if (NO_BACKUP) {
      fs.renameSync(pristineDir, outputDir);
    } else {
      console.log("wipeNether: copying to a working set (the download stays as the backup)");
      fs.cpSync(pristineDir, outputDir, { recursive: true });
    }

    const summary = await filterNetherKeys(outputDir, !DRY_RUN);
    console.log(`wipeNether: scanned ${summary.scanned} keys, found ${summary.matched} Nether keys`);
    for (const [type, count] of [...summary.counts].sort((a, b) => b[1] - a[1])) {
      console.log(`   ${type}: ${count}`);
    }

    if (DRY_RUN) {
      console.log("wipeNether: dry run — nothing was written. Inspect the download, then rerun with --yes.");
      return;
    }
    if (summary.matched === 0) {
      console.log("wipeNether: no Nether chunks found — nothing to upload.");
      return;
    }

    console.log(`wipeNether: uploading filtered db -> ${REMOTE_DB}`);
    await sftp.uploadDir(outputDir, REMOTE_DB);

    // LevelDB replays stray *.log files and ignores obsolete *.ldb ones, so the remote side
    // mirrors the filtered set exactly instead of merely receiving new files.
    const filtered = new Set(walkLocal(outputDir));
    let pruned = 0;
    for (const rel of remoteFiles) {
      if (filtered.has(rel)) continue;
      await sftp.delete(`${REMOTE_DB}/${rel}`);
      pruned++;
    }
    console.log(`wipeNether: pruned ${pruned} stale remote files`);
    console.log(`wipeNether: done. Pre-wipe backup: ${pristineDir}`);
  } finally {
    await sftp.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error(`wipeNether failed: ${err?.message ?? err}`);
  process.exit(1);
});
