#!/usr/bin/env node
/**
 * Start a release in one command.
 *
 * Everything between "cut a release" and "the notes are written" is mechanical and easy to
 * get wrong by hand: the version lives in four files with three different shapes, and the
 * installers are zipped from the Regolith development export rather than from the repository.
 * This does that work, then prints the two steps a script cannot take — the changelog prose
 * and the commit — so a release does not begin with rediscovering the previous one.
 *
 *   npm run release:prepare -- --minor
 *   npm run release:prepare -- --patch
 *   npm run release:prepare -- --version 5.6.0
 *   npm run release:prepare -- --minor --dry-run
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertArchiveTool, createZip } from "./lib/archive.mjs";
import { resolveComMojang } from "./lib/comMojang.mjs";
import { loadEnv } from "./lib/env.mjs";
import {
  ensureChangelogEntry,
  extractChangelogSection,
  releaseVersionFrom,
  RELEASE_NOTES_PLACEHOLDER,
} from "./lib/changelog.mjs";
import {
  applyManifestVersion,
  applyWelcomeVersion,
  compareTriples,
  latestReleaseTag,
  nextReleaseVersion,
  versionTriple,
} from "./lib/version.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The installers are named for the tag, not the package version: `5.5.0` publishes as `5.5`
 * and ships as `Betafied_5.5.mcaddon`, which is also the name `release.mjs` looks for.
 */
const assetName = (tag, suffix = "") => `Betafied_${tag}${suffix}`;

const USAGE = `Usage: npm run release:prepare -- [--minor | --patch | --version <x.y.z>] [--dry-run]

  --minor        the next minor (5.4 -> 5.5.0), for a feature release
  --patch        the next patch (5.4 -> 5.4.1), for a fix-up
  --version      an explicit target version, validated against the last released tag
  --dry-run      print the plan and stop before writing anything
`;

function fail(message) {
  console.error(`release:prepare: ${message}`);
  process.exit(1);
}

function run(command, args) {
  execFileSync(command, args, { cwd: ROOT, stdio: "inherit" });
}

/** Local calendar date, which is what the changelog headings have always used. */
function today() {
  const now = new Date();
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((part, index) => (index === 0 ? String(part) : String(part).padStart(2, "0")))
    .join("-");
}

function gitTags() {
  try {
    return execFileSync("git", ["tag", "--list"], { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    fail("could not read git tags — run this from a git checkout");
  }
}

/** The exported pack folder names, read from the build config rather than assumed. */
function exportNames() {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
  const profile = config?.regolith?.profiles?.default?.export ?? {};
  const unquote = (value) => String(value ?? "").replace(/^['"]|['"]$/g, "");
  const bp = unquote(profile.bpName);
  const rp = unquote(profile.rpName);
  if (!bp || !rp) fail("config.json does not name the exported behavior and resource packs");
  return { bp, rp };
}

/**
 * `com.mojang`, resolved the same way `scripts/regolith.mjs` resolves it: the environment
 * (including `.env`, which npm does not export itself) wins, macOS has one known location,
 * and Windows needs no default because Regolith finds its own. A missing directory fails
 * here rather than packaging into a path that does not exist.
 */
function mojangRoot() {
  const resolved = resolveComMojang(loadEnv(ROOT));
  if (!resolved) {
    fail("could not locate com.mojang — set COM_MOJANG to your Bedrock data directory");
  }
  return resolved;
}

function parseArguments(argv) {
  const flags = argv.filter((arg) => arg.startsWith("--"));
  const unknown = flags.filter((flag) => !["--minor", "--patch", "--version", "--dry-run", "--help"].includes(flag));
  if (unknown.length > 0) fail(`unknown option ${unknown[0]} — ${USAGE}`);

  if (flags.includes("--help")) {
    console.log(USAGE);
    process.exit(0);
  }

  const dryRun = flags.includes("--dry-run");
  const bump = flags.includes("--minor") ? "minor" : flags.includes("--patch") ? "patch" : null;
  const versionIndex = argv.indexOf("--version");
  const explicit = versionIndex === -1 ? null : argv[versionIndex + 1];
  if (versionIndex !== -1 && !explicit) fail("--version needs a value");

  const chosen = [Boolean(bump), Boolean(explicit)].filter(Boolean).length;
  if (chosen !== 1) fail(`choose exactly one of --minor, --patch or --version — ${USAGE}`);
  return { bump, explicit, dryRun };
}

/** The version to prepare, refused unless it is a real step forward from the last release. */
function resolveTarget({ bump, explicit }) {
  const latest = latestReleaseTag(gitTags());
  if (!latest) fail("no released version tag to step from");

  const target = bump ? nextReleaseVersion(latest, bump) : explicit;
  const triple = versionTriple(target);
  if (!triple) fail(`'${target}' is not a semver version`);

  if (compareTriples(triple, versionTriple(latest)) <= 0) {
    fail(`${target} is not newer than the last release, ${latest}`);
  }

  const tag = releaseVersionFrom(target);
  if (!tag) fail(`'${target}' does not reduce to a release tag`);
  if (gitTags().includes(tag)) fail(`tag ${tag} already exists, so that version has shipped`);
  return { version: target, tag, triple, latest };
}

function bumpPackageVersion(version) {
  const file = path.join(ROOT, "package.json");
  const source = fs.readFileSync(file, "utf8");
  const replaced = source.replace(/("version":\s*")[^"]*(")/, `$1${version}$2`);
  if (replaced === source) fail("package.json has no version field to bump");
  fs.writeFileSync(file, replaced);
}

function writeManifest(file, triple, name) {
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  const updated = applyManifestVersion(manifest, triple, { name });
  fs.writeFileSync(file, `${JSON.stringify(updated, null, 4)}\n`);
}

function bumpWelcomeVersion(tag) {
  const file = path.join(ROOT, "packs/BP/scripts/player/welcome.ts");
  const source = fs.readFileSync(file, "utf8");
  const replaced = applyWelcomeVersion(source, tag);
  if (replaced === null) fail("welcome.ts has no VERSION to bump");
  fs.writeFileSync(file, replaced);
}

function writeChangelogEntry(tag, date) {
  const file = path.join(ROOT, "CHANGELOG.md");
  const source = fs.readFileSync(file, "utf8");
  const updated = ensureChangelogEntry(source, tag, date);
  if (updated === source) return false;
  fs.writeFileSync(file, updated);
  return true;
}

function assertArchiver() {
  try {
    assertArchiveTool();
  } catch (err) {
    fail(err.message);
  }
}

function agentsMdFiles(root) {
  const found = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) found.push(...agentsMdFiles(full));
    else if (entry.name === "AGENTS.md") found.push(full);
  }
  return found;
}

function zipInto(outDir, archive, ...entries) {
  createZip(path.join(outDir, archive), outDir, entries);
}

/** Copy an export into the release tree, without the desktop cruft a macOS folder picks up. */
function copyExport(source, destination) {
  fs.cpSync(source, destination, { recursive: true });
  for (const entry of fs.readdirSync(destination, { withFileTypes: true })) {
    if (entry.isFile() && entry.name === ".DS_Store") {
      fs.rmSync(path.join(destination, entry.name), { force: true });
    }
  }
}

/**
 * Package the Regolith export into `build/<tag>/`.
 *
 * The instruction files are *not* cleaned up here. `filters/agents-md-strip/` is supposed to
 * have removed them from the export, and a silently-stripped one would hide a filter that had
 * stopped running — which is how 5.3.2 shipped four of them inside its `.mcpack`.
 */
function packageInstallers(tag) {
  const mojang = mojangRoot();
  const names = exportNames();
  const sources = [
    ["bp", path.join(mojang, "development_behavior_packs", names.bp), `${assetName(tag, "_BP")}`],
    ["rp", path.join(mojang, "development_resource_packs", names.rp), `${assetName(tag, "_RP")}`],
  ];

  for (const [, source] of sources) {
    if (!fs.existsSync(source)) fail(`no export at ${source} — run \`npm run build\` first`);
  }

  const outDir = path.join(ROOT, "build", tag);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const folders = [];
  for (const [kind, source, folder] of sources) {
    copyExport(source, path.join(outDir, folder));
    const leaked = agentsMdFiles(path.join(outDir, folder));
    if (leaked.length > 0) {
      fail(
        `the ${kind} export still carries ${leaked.length} AGENTS.md file(s) — filters/agents-md-strip/ did not run`
      );
    }
    folders.push(folder);
    zipInto(outDir, `${folder}.mcpack`, folder);
  }
  zipInto(outDir, `${assetName(tag)}.mcaddon`, ...folders);

  return outDir;
}

function printNextSteps(tag) {
  console.log(`
Next steps:
  1. Write the '## ${tag}' section in CHANGELOG.md, replacing ${RELEASE_NOTES_PLACEHOLDER}.
     Match the published GitHub style: a one-line summary, then '### Section' headings of
     '- Added/Changed/Fixed/Removed' bullets.
  2. npm run check                       # write the notes first; the suite requires the section
  3. git add -A && git commit            # 'Betafied ${tag}: <summary>', authored as fyreic
  4. git tag -a ${tag} -m "Betafied ${tag}: <summary>"
  5. git push origin HEAD && git push origin ${tag}
  6. npm run release -- --dry-run        # read the notes before publishing
  7. npm run release
`);
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const { version, tag, triple, latest } = resolveTarget(options);

  const date = today();
  const changelog = fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8");
  const hasSection = extractChangelogSection(changelog, tag) !== null;

  console.log(`release:prepare: ${latest} -> ${version} (tag ${tag})`);
  if (options.dryRun) {
    console.log(`
  would bump   package.json, packs/BP/manifest.json, packs/RP/manifest.json,
               packs/BP/scripts/player/welcome.ts
  would ${hasSection ? "keep   " : "insert "} the '## ${tag}' section in CHANGELOG.md
  would run    npm run check, npm run build
  would write  build/${tag}/ (${assetName(tag)}.mcaddon, ${assetName(tag, "_BP")}.mcpack, ${assetName(tag, "_RP")}.mcpack)
`);
    return;
  }

  bumpPackageVersion(version);
  writeManifest(path.join(ROOT, "packs/BP/manifest.json"), triple, `Betafied ${tag}`);
  writeManifest(path.join(ROOT, "packs/RP/manifest.json"), triple, `Betafied ${tag} (Resources)`);
  bumpWelcomeVersion(tag);
  const inserted = writeChangelogEntry(tag, date);
  console.log(`release:prepare: bumped every version carrier to ${tag}`);
  console.log(inserted ? `release:prepare: added the '## ${tag}' placeholder to CHANGELOG.md` : `release:prepare: kept the existing '## ${tag}' section`);

  run("npm", ["run", "check"]);
  run("npm", ["run", "build"]);
  assertArchiver();
  const outDir = packageInstallers(tag);
  console.log(`release:prepare: packaged ${path.relative(ROOT, outDir)}`);
  printNextSteps(tag);
}

main();
