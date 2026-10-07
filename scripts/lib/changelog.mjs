/**
 * The release tooling reads what the repository already declares — the version in `package.json`
 * and the prose in `CHANGELOG.md` — so a published release can never describe a build the tree
 * does not contain. These helpers are pure so the derivations can be pinned offline.
 */

/**
 * `5.2.0` -> `5.2`, which is the tag shape the packs and releases use (major.minor). A patch
 * release keeps its digit — `5.3.1` -> `5.3.1` — so it can publish under its own tag; only an
 * explicit `.0` collapses, since that is not a release a maintainer asked for but the zero that
 * rounds the triple out.
 * Returns null when the version is not a semver triple, so the caller can fail loudly.
 */
export function releaseVersionFrom(packageVersion) {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?(?:[-+].*)?$/.exec(String(packageVersion ?? "").trim());
  if (!match) return null;
  return match[3] && match[3] !== "0" ? `${match[1]}.${match[2]}.${match[3]}` : `${match[1]}.${match[2]}`;
}

function matchesVersion(heading, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // The lookahead keeps `5.2` from matching a `5.20` heading, which would publish the wrong notes.
  return new RegExp(`^${escaped}(?![\\d.])`).test(heading.trim());
}

/**
 * The body of one `## <version> ...` section, up to the next `## ` heading.
 * Returns null when the changelog has no entry for that version.
 */
export function extractChangelogSection(markdown, version) {
  const lines = String(markdown).split(/\r?\n/);

  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const heading = /^##\s+(.+?)\s*$/.exec(lines[i]);
    if (heading && matchesVersion(heading[1], version)) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return null;

  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }

  return lines.slice(start, end).join("\n").trim() || null;
}
