/**
 * The pack pair a world declares is what the engine loads into it. A world exported from a client
 * carries whatever that client had enabled — frequently an older Betafied version plus a pack the
 * server never installed, which the server then refuses to resolve. The pair already on the server
 * matches the packs installed there, so replacing a world reuses it by default; the archive's pair
 * is only the fallback for a world the server has not seen before.
 */
export const WORLD_PACK_FILES = Object.freeze({
  behavior: "world_behavior_packs.json",
  resource: "world_resource_packs.json",
});

export function parsePackPair(text, label = "pack pair") {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`${label} is not valid JSON: ${err.message}`);
  }
  if (!Array.isArray(parsed)) throw new Error(`${label} must be a JSON array`);

  parsed.forEach((entry, index) => {
    if (typeof entry?.pack_id !== "string" || entry.pack_id.length === 0) {
      throw new Error(`${label}[${index}] has no pack_id`);
    }
    if (!Array.isArray(entry.version) || entry.version.length === 0) {
      throw new Error(`${label}[${index}] (${entry.pack_id}) has no version array`);
    }
    if (!entry.version.every((part) => Number.isInteger(part))) {
      throw new Error(`${label}[${index}] (${entry.pack_id}) has a non-integer version`);
    }
  });
  return parsed;
}

export function serializePackPair(pair) {
  return `${JSON.stringify(pair, null, 2)}\n`;
}

/**
 * `keep` is the safe default: the server's pair wins and anything the archive carried that the
 * server does not have is reported as dropped. With no server pair there is nothing to keep, so
 * the archive's own pair is used and the caller learns which source it got.
 */
export function resolvePackPair({ server, archive, keep }) {
  if (!keep) return { pair: archive, source: "archive", dropped: [] };
  if (!server) return { pair: archive, source: "archive (server has none to keep)", dropped: [] };
  return { pair: server, source: "server", dropped: droppedPacks(archive, server) };
}

function droppedPacks(archive, server) {
  const kept = new Set(server.map((entry) => entry.pack_id));
  return archive
    .filter((entry) => !kept.has(entry.pack_id))
    .map((entry) => `${entry.pack_id}@${entry.version.join(".")}`);
}

/**
 * Compares a pair against the packs actually installed on the server. A declared version that is
 * not installed is the one failure mode that silently drops the addon from a freshly pushed world.
 */
export function packVersionDrift(pair, installed) {
  const byId = new Map(installed.map((entry) => [entry.uuid, entry.version]));
  const drift = [];
  for (const entry of pair) {
    const have = byId.get(entry.pack_id);
    const declared = entry.version.join(".");
    if (!have) {
      drift.push(`${entry.pack_id}@${declared} is declared but not installed on the server`);
    } else if (have.join(".") !== declared) {
      drift.push(`${entry.pack_id} declares ${declared} but the server has ${have.join(".")} installed`);
    }
  }
  return drift;
}
