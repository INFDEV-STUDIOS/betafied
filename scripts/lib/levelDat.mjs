/**
 * A level.dat is an 8-byte header (version, uncompressed length) followed by uncompressed
 * little-endian NBT. Two entrypoints need the same experiment flags — `push.mjs` patches a world
 * already on the server, `pushWorld.mjs` patches one before uploading it — so the flag list and
 * the read-modify-write live here instead of in either script.
 */
import nbt from "prismarine-nbt";

/**
 * Beta APIs, plus the bookkeeping flags the engine sets itself once experiments are in use, so a
 * pushed world loads the addon without anyone opening the world panel to toggle it.
 */
export const BETA_API_EXPERIMENT_FLAGS = Object.freeze([
  "gametest",
  "experiments_ever_used",
  "saved_with_toggled_experiments",
  "upcoming_creator_features",
  "data_driven_biomes",
]);

const HEADER_BYTES = 8;

/** Parses a level.dat buffer into its header version and NBT root tag. */
export async function readLevelDat(raw) {
  if (!raw || raw.length < HEADER_BYTES) {
    throw new Error("level.dat is shorter than its 8-byte header");
  }
  let parsed;
  try {
    parsed = await nbt.parse(raw.subarray(HEADER_BYTES), "little");
  } catch (err) {
    // The NBT reader reports a bare "undefined" for a truncated tag; name the file it choked on.
    throw new Error(`level.dat is not readable NBT: ${err.message}`);
  }
  const tag = parsed?.parsed;
  if (!tag || typeof tag.value !== "object") {
    throw new Error("level.dat did not parse into an NBT root tag");
  }
  return { version: raw.readInt32LE(0), tag };
}

/** Serialises a root tag back into a level.dat buffer, preserving the header version. */
export function writeLevelDat(version, tag) {
  const body = nbt.writeUncompressed(tag, "little");
  const header = Buffer.alloc(HEADER_BYTES);
  header.writeInt32LE(version, 0);
  header.writeInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

/** Names of the experiment flags currently enabled in a root tag. */
export function enabledExperiments(tag) {
  const enabled = new Set();
  const value = tag?.value?.experiments?.value;
  if (!value) return enabled;
  for (const [flag, entry] of Object.entries(value)) {
    if (entry?.value === 1) enabled.add(flag);
  }
  return enabled;
}

export function levelName(tag) {
  const name = tag?.value?.LevelName?.value;
  return typeof name === "string" ? name : undefined;
}

/**
 * Turns every required experiment flag on.
 *
 * Returns `raw: null` and `changed: false` when the file already satisfies the list, so callers
 * can treat "nothing to do" as a no-op instead of rewriting a byte-identical file.
 */
export async function enableBetaApiExperiments(raw) {
  const { version, tag } = await readLevelDat(raw);
  const experiments = ensureCompound(tag.value, "experiments");

  let changed = false;
  for (const flag of BETA_API_EXPERIMENT_FLAGS) {
    const entry = experiments[flag];
    if (entry?.type === "byte" && entry.value === 1) continue;
    experiments[flag] = { type: "byte", value: 1 };
    changed = true;
  }

  if (!changed) return { raw: null, changed: false, version, tag };
  return { raw: writeLevelDat(version, tag), changed: true, version, tag };
}

function ensureCompound(root, key) {
  if (!root[key] || root[key].type !== "compound") {
    root[key] = { type: "compound", value: {} };
  }
  return root[key].value;
}
