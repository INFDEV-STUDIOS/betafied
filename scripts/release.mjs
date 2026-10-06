#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractChangelogSection, releaseVersionFrom } from "./lib/changelog.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The checkout carries several remotes (origin, fork, upstream) whose slugs include orgs
// this project has outgrown or renamed away from — GitHub still resolves the old names by
// redirect, which makes a stray remote look like a different repository. Pin the canonical
// name so `gh` cannot resolve a remote to the wrong target; GH_REPO wins because the CLI
// reads it itself.
const REPO = process.env.GH_REPO ?? "INFDEV-STUDIOS/betafied";

const BANNER =
  "> **Note:** **Betafied** brings Minecraft Beta 1.7.3 to Bedrock Edition. When playing on the " +
  "**Betafied server**, you do **not** need to download this addon — the server handles all packs " +
  "automatically upon joining. Download below for use in local **singleplayer** worlds.";

const INSTALL =
  "### Installation\n\nRun the `.mcaddon` file to install both the Behavior Pack and Resource Pack " +
  "automatically. No download is needed when playing on the Betafied server.\n\n— fyreic";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

/**
 * Run `gh`, returning stdout; throws with the CLI's own stderr so a failure explains itself.
 */
function gh(commandArgs) {
  return execFileSync("gh", commandArgs, { cwd: ROOT, encoding: "utf8", env: { ...process.env, GH_REPO: REPO } });
}

function ghSucceeds(commandArgs) {
  try {
    execFileSync("gh", commandArgs, { cwd: ROOT, stdio: "ignore", env: { ...process.env, GH_REPO: REPO } });
    return true;
  } catch {
    return false;
  }
}

/** The built pack assets for a version: `build/<version>/*.mcaddon` and `*.mcpack`. */
function packAssets(version) {
  const dir = path.join(ROOT, "build", version);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => /\.(mcaddon|mcpack)$/i.test(name))
    .sort()
    .map((name) => path.join(dir, name));
}

function main() {
  if (!ghSucceeds(["--version"])) fail("the GitHub CLI (`gh`) is not installed or not on PATH");

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const version = releaseVersionFrom(pkg.version);
  if (!version) fail(`cannot derive a major.minor release version from package.json version '${pkg.version}'`);
  const tag = version;

  const changelog = fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8");
  const section = extractChangelogSection(changelog, version);
  if (!section) fail(`CHANGELOG.md has no '## ${version}' section — write the entry before publishing`);

  const assets = packAssets(version);
  if (assets.length === 0) {
    fail(`no .mcaddon/.mcpack assets in build/${version}/ — run the build and package the pack first`);
  }

  const title = `Betafied ${version}`;
  const body = `${BANNER}\n\n${section}\n\n${INSTALL}\n`;

  if (DRY_RUN) {
    console.log(`release: dry run for ${tag} (${assets.length} asset(s))`);
    for (const asset of assets) console.log(`   ${path.relative(ROOT, asset)}`);
    console.log(`\n--- notes ---\n${body}`);
    return;
  }

  const exists = ghSucceeds(["release", "view", tag]);
  if (exists) {
    gh(["release", "edit", tag, "--title", title, "--notes", body]);
    gh(["release", "upload", tag, ...assets, "--clobber"]);
    console.log(`release: updated ${title} and re-uploaded ${assets.length} asset(s)`);
  } else {
    gh(["release", "create", tag, "--title", title, "--notes", body, ...assets]);
    console.log(`release: created ${title} with ${assets.length} asset(s)`);
  }
}

main();
