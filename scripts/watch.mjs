#!/usr/bin/env node
import { watch } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const debounceMs = 200;

// Windows has no extensionless `npm` on PATH for a non-shell spawn; the CLI is `npm.cmd`.
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

const targets = [
  { path: path.join(root, "packs"), recursive: true },
  { path: path.join(root, "config.json"), recursive: false },
];

let timer = null;
let running = false;
let pending = false;

function executeCommand(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: root,
      stdio: "inherit",
    });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", (err) => {
      process.stderr.write(`[watch] failed to start ${cmd}: ${err.message}\n`);
      resolve(1);
    });
  });
}

async function runPipeline() {
  if (running) {
    pending = true;
    return;
  }
  running = true;
  const started = Date.now();
  process.stdout.write("\n[watch] change detected, checking types and lint...\n");

  const checkCode = await executeCommand(NPM, ["run", "check"]);
  if (checkCode !== 0) {
    running = false;
    process.stderr.write(`[watch] ❌ typecheck/lint failed (exit ${checkCode}). Build aborted.\n`);
    if (pending) {
      pending = false;
      runPipeline();
    }
    return;
  }

  process.stdout.write("[watch] ✔ checks passed. Running Regolith build...\n");
  const buildCode = await executeCommand(process.execPath, [path.join(root, "scripts", "regolith.mjs"), "run"]);
  running = false;
  const ms = Date.now() - started;
  if (buildCode === 0) {
    process.stdout.write(`[watch] 🎉 build ok in ${ms}ms\n`);
  } else {
    process.stderr.write(`[watch] ❌ build failed (exit ${buildCode}) in ${ms}ms\n`);
  }

  if (pending) {
    pending = false;
    runPipeline();
  }
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    runPipeline().catch((err) => {
      running = false;
      process.stderr.write(`[watch] unexpected error: ${err.message}\n`);
    });
  }, debounceMs);
}

for (const target of targets) {
  try {
    watch(target.path, { recursive: target.recursive }, schedule);
    process.stdout.write(`[watch] watching ${path.relative(root, target.path)}\n`);
  } catch (error) {
    process.stderr.write(`[watch] cannot watch ${target.path}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

process.stdout.write("[watch] ready. Ctrl+C to stop.\n");

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    process.stdout.write("\n[watch] stopped.\n");
    process.exit(0);
  });
}
