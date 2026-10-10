import { describe, it } from "node:test";
import assert from "node:assert/strict";
import nbt from "prismarine-nbt";
import {
  BETA_API_EXPERIMENT_FLAGS,
  enableBetaApiExperiments,
  enabledExperiments,
  levelName,
  readLevelDat,
} from "../../scripts/lib/levelDat.mjs";
import {
  alignInstalledVersions,
  packVersionDrift,
  parsePackPair,
  resolvePackPair,
} from "../../scripts/lib/worldPacks.mjs";

/** A level.dat shaped like the engine writes it: 8-byte header, then uncompressed NBT. */
function buildLevelDat({ name = "gargamel", experiments = {} } = {}) {
  const root = {
    type: "compound",
    name: "",
    value: {
      LevelName: { type: "string", value: name },
      experiments: { type: "compound", value: experiments },
    },
  };
  const body = nbt.writeUncompressed(root, "little");
  const header = Buffer.alloc(8);
  header.writeInt32LE(12, 0);
  header.writeInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

const pack = (id, version) => ({ pack_id: id, version });

describe("level.dat experiment patch", () => {
  it("turns on every required flag and leaves the rest of the file alone", async () => {
    const original = buildLevelDat();
    const patched = await enableBetaApiExperiments(original);

    assert.equal(patched.changed, true);
    assert.equal(levelName(patched.tag), "gargamel");

    const enabled = enabledExperiments(patched.tag);
    for (const flag of BETA_API_EXPERIMENT_FLAGS) {
      assert.equal(enabled.has(flag), true, `${flag} should be enabled`);
    }
    assert.equal(patched.raw.readInt32LE(0), original.readInt32LE(0), "header version is preserved");
  });

  it("survives a write-read round trip", async () => {
    const patched = await enableBetaApiExperiments(buildLevelDat());
    const readback = await readLevelDat(patched.raw);

    assert.equal(levelName(readback.tag), "gargamel");
    assert.equal(readback.version, 12);
    assert.equal(enabledExperiments(readback.tag).size, BETA_API_EXPERIMENT_FLAGS.length);
  });

  it("reports no change once the flags are already on", async () => {
    const first = await enableBetaApiExperiments(buildLevelDat());
    const second = await enableBetaApiExperiments(first.raw);

    assert.equal(second.changed, false);
    assert.equal(second.raw, null, "an unchanged file is not rewritten");
  });

  it("keeps flags the engine set that the addon does not require", async () => {
    const patched = await enableBetaApiExperiments(
      buildLevelDat({ experiments: { chemical_creator: { type: "byte", value: 1 } } }),
    );

    assert.equal(enabledExperiments(patched.tag).has("chemical_creator"), true);
  });

  it("refuses a file that is not a level.dat", async () => {
    await assert.rejects(() => enableBetaApiExperiments(Buffer.from([1, 2, 3])), /shorter than/);
    await assert.rejects(() => enableBetaApiExperiments(Buffer.alloc(8, 0xff)), /not readable NBT/);
  });
});

describe("world pack pair resolution", () => {
  const betafied = pack("9a9048e6-9214-3d27-d6e7-063c1df4b480", [5, 2, 0]);
  const farLand = pack("7a359871-33da-4702-8a91-4cfcb07604a1", [1, 1, 0]);
  const notInstalled = pack("3cdb2ddf-662e-4f8f-a0a1-1293b91ccb2f", [0, 10, 4]);

  it("keeps the server's pair verbatim and drops what the server does not have", () => {
    const resolved = resolvePackPair({
      server: [betafied, farLand],
      archive: [pack(betafied.pack_id, [4, 3, 0]), notInstalled, farLand],
      keep: true,
    });

    assert.equal(resolved.source, "server");
    assert.deepEqual(resolved.pair, [betafied, farLand]);
    assert.equal(resolved.dropped.length, 1);
    assert.match(resolved.dropped[0], /3cdb2ddf/);
  });

  it("falls back to the archive when the server has no pair to keep", () => {
    const resolved = resolvePackPair({ server: undefined, archive: [betafied], keep: true });

    assert.deepEqual(resolved.pair, [betafied]);
    assert.match(resolved.source, /archive/);
  });

  it("uses the archive's pair when asked to", () => {
    const resolved = resolvePackPair({ server: [betafied], archive: [notInstalled], keep: false });

    assert.deepEqual(resolved.pair, [notInstalled]);
    assert.equal(resolved.source, "archive");
  });

  it("rejects a pair that is not a well-formed array of packs", () => {
    assert.throws(() => parsePackPair("not json", "pair"), /not valid JSON/);
    assert.throws(() => parsePackPair('{"pack_id":"x"}', "pair"), /must be a JSON array/);
    assert.throws(() => parsePackPair('[{"version":[1,0,0]}]', "pair"), /has no pack_id/);
    assert.throws(() => parsePackPair('[{"pack_id":"x"}]', "pair"), /has no version array/);
    assert.throws(() => parsePackPair('[{"pack_id":"x","version":["1"]}]', "pair"), /non-integer/);
  });

  it("names the packs a pushed world would fail to load", () => {
    const installed = [{ uuid: betafied.pack_id, version: [5, 3, 0] }, { uuid: farLand.pack_id, version: [1, 1, 0] }];
    const drift = packVersionDrift([betafied, farLand, notInstalled], installed);

    assert.equal(drift.length, 2);
    assert.match(drift[0], /declares 5\.2\.0 but the server has 5\.3\.0/);
    assert.match(drift[1], /not installed on the server/);
    assert.deepEqual(packVersionDrift([farLand], installed), []);
  });

  it("aligns declared pack versions with what the server has installed", () => {
    const installed = [
      { uuid: betafied.pack_id, version: [5, 3, 2] },
      { uuid: farLand.pack_id, version: [1, 1, 0] },
    ];
    const stalePair = [pack(betafied.pack_id, [4, 3, 0]), farLand, notInstalled];
    const aligned = alignInstalledVersions(stalePair, installed);

    assert.deepEqual(aligned, [
      pack(betafied.pack_id, [5, 3, 2]),
      farLand,
      notInstalled,
    ]);
  });
});
