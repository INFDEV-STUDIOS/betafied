import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractChangelogSection, releaseVersionFrom } from "../../scripts/lib/changelog.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("Release version derivation", () => {
  it("collapses a semver triple to the major.minor tag the packs use", () => {
    assert.equal(releaseVersionFrom("5.2.0"), "5.2");
    assert.equal(releaseVersionFrom("4.3.1"), "4.3");
    assert.equal(releaseVersionFrom(" 5.0.0 "), "5.0");
    assert.equal(releaseVersionFrom("5.2.0-beta.1"), "5.2");
  });

  it("returns null for a version it cannot read, rather than guessing a tag", () => {
    assert.equal(releaseVersionFrom("5"), null);
    assert.equal(releaseVersionFrom("stable"), null);
    assert.equal(releaseVersionFrom(undefined), null);
  });
});

describe("Changelog section extraction", () => {
  const markdown = [
    "# Changelog",
    "",
    "Intro that belongs to no release.",
    "",
    "## 5.2 — 2026-10-02",
    "",
    "The 5.2 body.",
    "",
    "### A subsection",
    "",
    "- a bullet",
    "",
    "## 5.1 — 2026-10-01",
    "",
    "The 5.1 body.",
  ].join("\n");

  it("returns exactly the requested section, stopping at the next heading", () => {
    const section = extractChangelogSection(markdown, "5.1");
    assert.equal(section, "The 5.1 body.");

    const earlier = extractChangelogSection(markdown, "5.2");
    assert.ok(earlier.includes("The 5.2 body."));
    assert.ok(earlier.includes("### A subsection"));
    assert.ok(!earlier.includes("The 5.1 body."), "must not bleed into the next version's notes");
  });

  it("does not confuse a longer version with a shorter prefix", () => {
    const withTwenty = "# Changelog\n\n## 5.20 — someday\n\nTwenty.\n";
    assert.equal(extractChangelogSection(withTwenty, "5.2"), null);
    assert.equal(extractChangelogSection(withTwenty, "5.20"), "Twenty.");
  });

  it("returns null when the changelog has no such version", () => {
    assert.equal(extractChangelogSection(markdown, "9.9"), null);
  });
});

describe("The tracked changelog covers the version about to be released", () => {
  it("has a section for package.json's version, so `npm run release` cannot publish empty notes", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    const version = releaseVersionFrom(pkg.version);
    assert.ok(version, `package.json version '${pkg.version}' must reduce to a major.minor tag`);

    const changelog = fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8");
    assert.ok(
      extractChangelogSection(changelog, version),
      `CHANGELOG.md needs a '## ${version}' entry matching package.json ${pkg.version}`,
    );
  });
});
