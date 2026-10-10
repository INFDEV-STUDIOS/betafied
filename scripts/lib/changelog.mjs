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

/** Whether the changelog already carries a heading for `version`. */
export function changelogHasVersion(markdown, version) {
  return String(markdown)
    .split(/\r?\n/)
    .some((line) => {
      const heading = /^##\s+(.+?)\s*$/.exec(line);
      return Boolean(heading && matchesVersion(heading[1], version));
    });
}

/**
 * The marker a prepared-but-unwritten section carries.
 *
 * `release.mjs` refuses to publish while it is still present. Preparation has to create
 * the heading before the notes exist, because `npm run check` and the release tooling both
 * require the section — without the refusal, an unwritten release would publish the marker
 * as its notes, which is worse than failing.
 */
export const RELEASE_NOTES_PLACEHOLDER =
  "<!-- release-notes-placeholder: replace this marker with the release notes -->";

/** Whether a section is still the placeholder a `release:prepare` run left behind. */
export function notesArePlaceholder(section) {
  return typeof section === "string" && section.includes(RELEASE_NOTES_PLACEHOLDER);
}

/**
 * The changelog with a heading for `version` present, inserted above the newest release.
 *
 * An existing section is returned untouched, so re-running preparation never overwrites
 * notes that were already written.
 */
export function ensureChangelogEntry(markdown, version, date) {
  const source = String(markdown);
  if (changelogHasVersion(source, version)) return source;

  const lines = source.replace(/\r?\n/g, "\n").split("\n");
  let insertAt = lines.findIndex((line) => /^##\s+/.test(line));
  if (insertAt === -1) insertAt = lines.length;

  const block = [`## ${version} — ${date}`, "", RELEASE_NOTES_PLACEHOLDER];
  const joined = [...lines.slice(0, insertAt), ...block, "", ...lines.slice(insertAt)].join("\n");
  return `${joined.replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}
