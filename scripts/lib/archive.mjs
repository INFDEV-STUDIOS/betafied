import { execFileSync } from "node:child_process";

/**
 * Create a ZIP archive containing `entries` (top-level names, relative to `cwd`).
 *
 * The release installers are `.mcpack`/`.mcaddon`, which are ZIP files, and no single
 * archiver exists on every development OS: Info-ZIP `zip` is standard on Linux but absent on
 * Windows, bsdtar (`tar`) ships on Windows 10+ and macOS but GNU tar on Linux cannot write
 * ZIP, and Python's `zipfile` module is the portable last resort already installed for the
 * Regolith filters. So the writer is probed once, in that order, and a missing one produces
 * install guidance rather than an opaque failure deep into packaging.
 */
function zipWriter() {
  if (attempts("zip", ["-v"])) {
    return {
      name: "zip",
      run: (archive, cwd, entries) => run("zip", ["-r", "-X", "-q", archive, ...entries], { cwd }),
    };
  }

  const tarVersion = probe("tar", ["--version"]);
  if (tarVersion?.includes("bsdtar")) {
    return {
      name: "bsdtar",
      run: (archive, cwd, entries) => run("tar", ["-a", "-c", "-f", archive, "-C", cwd, ...entries]),
    };
  }

  for (const python of ["python3", "python", "py"]) {
    if (probe(python, ["--version"])) {
      return {
        name: `${python} -m zipfile`,
        run: (archive, cwd, entries) => run(python, ["-m", "zipfile", "-c", archive, ...entries], { cwd }),
      };
    }
  }

  return null;
}

function probe(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

function attempts(command, args) {
  return probe(command, args) !== null;
}

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: "inherit", ...options });
}

/** Throws with actionable guidance when the host cannot write a ZIP at all. */
export function assertArchiveTool() {
  const writer = zipWriter();
  if (!writer) {
    throw new Error(
      "no tool available to build the .mcpack/.mcaddon installers. Install one of: " +
        "Info-ZIP (`zip`), bsdtar (`tar`), or Python 3 (already required for Regolith filters)."
    );
  }
  return writer.name;
}

export function createZip(archive, cwd, entries) {
  const writer = zipWriter();
  if (!writer) assertArchiveTool();
  writer.run(archive, cwd, entries);
}
