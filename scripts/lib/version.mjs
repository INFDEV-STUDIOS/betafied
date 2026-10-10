/**
 * Pure helpers for starting a release: what the next version is, and the exact edits
 * that carry it into every place the pack declares one.
 *
 * Kept free of I/O, like `changelog.mjs`, so the derivations can be pinned offline —
 * a version that lands in three of four carriers is the failure this module exists to
 * prevent, and it is not something a test can catch after the fact on a published tag.
 */

/** `5.4.0` -> `[5, 4, 0]`. A missing patch counts as zero; null when not a semver triple. */
export function versionTriple(version) {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?(?:[-+].*)?$/.exec(String(version ?? "").trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

/** Ordering for version triples, so `latestReleaseTag` and the guard against going backwards can share it. */
export function compareTriples(left, right) {
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

/**
 * The next release version: `minor` steps `5.4.0` to `5.5.0`, `patch` steps it to `5.4.1`.
 *
 * The base is the last *released* tag rather than `package.json`, so a preparation step
 * that failed halfway can be run again without stepping a second version.
 */
export function nextReleaseVersion(current, bump) {
  const triple = versionTriple(current);
  if (!triple) return null;
  const [major, minor, patch] = triple;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  if (bump === "patch") return `${major}.${minor}.${patch + 1}`;
  return null;
}

/**
 * The highest released tag among `tags`, or null when none look like a release.
 *
 * The checkout carries tags that are not releases (`Worlds`, `release`, `v0.2.x-<sha>`),
 * so the shape is matched rather than trusting the tag list's sort order.
 */
export function latestReleaseTag(tags) {
  let best = null;
  let bestTriple = null;
  for (const raw of tags) {
    const tag = String(raw).trim();
    if (!/^\d+\.\d+(?:\.\d+)?$/.test(tag)) continue;
    const triple = versionTriple(tag);
    if (!triple) continue;
    if (bestTriple === null || compareTriples(triple, bestTriple) > 0) {
      best = tag;
      bestTriple = triple;
    }
  }
  return best;
}

/**
 * One pack manifest with every release version replaced.
 *
 * Both a module's `version` and a pack dependency's `version` are written. The engine
 * matches the dependency entry against the resource pack it loads, so a manifest whose
 * modules moved and whose dependency did not is exactly the drift that makes the
 * resource pack silently stop loading. A dependency on an engine module (`@minecraft/server`)
 * carries a string version and is left alone.
 */
export function applyManifestVersion(manifest, triple, options = {}) {
  const copy = structuredClone(manifest);
  if (copy.header) {
    copy.header.version = [...triple];
    if (options.name) copy.header.name = options.name;
  }
  if (Array.isArray(copy.modules)) {
    copy.modules = copy.modules.map((module) => ({ ...module, version: [...triple] }));
  }
  if (Array.isArray(copy.dependencies)) {
    copy.dependencies = copy.dependencies.map((dependency) =>
      Array.isArray(dependency.version) ? { ...dependency, version: [...triple] } : dependency
    );
  }
  return copy;
}

/**
 * The welcome banner's version, which is the tag the release publishes under rather than
 * the `package.json` triple — `5.5.0` ships as `5.5`, and the player sees the tag.
 * Returns null when the source has no version to replace, so the caller can fail loudly.
 */
export function applyWelcomeVersion(source, tag) {
  const pattern = /(VERSION:\s*")([^"]*)(")/;
  if (!pattern.test(source)) return null;
  return source.replace(pattern, `$1${tag}$3`);
}
