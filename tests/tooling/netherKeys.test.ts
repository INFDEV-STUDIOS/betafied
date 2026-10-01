import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LevelDB } from "@8crafter/leveldb-zlib";
import { generateChunkKeyFromIndices } from "mcbe-leveldb";
import { isNetherChunkKey, netherKeyContentType } from "../../scripts/lib/netherKeys.mjs";

const DIMENSION_ID = { overworld: 0, nether: 1, the_end: 2 };

function chunkKey(x, z, dimension, type, subChunkIndex) {
  const indices = { x, z, dimension: DIMENSION_ID[dimension] };
  if (subChunkIndex !== undefined) indices.subChunkIndex = subChunkIndex;
  return generateChunkKeyFromIndices(indices, type);
}

// The library's Digest writer disagrees with its own reader, so the digest layout is built
// by hand from the documented offsets: "digp" + x + z + dimension.
function digestKey(x, z, dimension) {
  const key = Buffer.alloc(16);
  key.write("digp", 0, "ascii");
  key.writeInt32LE(x, 4);
  key.writeInt32LE(z, 8);
  key.writeInt32LE(DIMENSION_ID[dimension], 12);
  return key;
}

async function readAllKeys(dbPath) {
  const db = new LevelDB(dbPath, { createIfMissing: false });
  await db.open();
  const keys = [];
  // Draining the iterator is enough; iterator.end() never resolves once it has finished.
  const iterator = db.getIterator({ keys: true, values: false, keyAsBuffer: true, valueAsBuffer: true });
  for await (const [key] of iterator) keys.push(Buffer.from(key));
  await db.close();
  return keys;
}

describe("Nether chunk key filter", () => {
    it("classifies only Nether chunk keys as Nether", () => {
        // Every content type that carries Nether terrain, entities or bookkeeping.
        assert.equal(netherKeyContentType(chunkKey(0, 0, "nether", "SubChunkPrefix", 3)), "SubChunkPrefix");
        assert.equal(netherKeyContentType(chunkKey(4, -7, "nether", "Data2D")), "Data2D");
        assert.equal(netherKeyContentType(chunkKey(4, -7, "nether", "Version")), "Version");
        assert.equal(netherKeyContentType(chunkKey(1, 2, "nether", "Entity")), "Entity");
        assert.equal(netherKeyContentType(digestKey(1, 2, "nether")), "Digest");

        // The other dimensions must never be swept up.
        assert.equal(netherKeyContentType(chunkKey(0, 0, "overworld", "SubChunkPrefix", 0)), null);
        assert.equal(netherKeyContentType(chunkKey(0, 0, "the_end", "Data2D")), null);
        assert.equal(netherKeyContentType(digestKey(0, 0, "overworld")), null);

        // World-level keys carry no terrain, including the per-dimension singleton.
        assert.equal(netherKeyContentType(Buffer.from("Nether")), null);
        assert.equal(netherKeyContentType(Buffer.from("Overworld")), null);
        assert.equal(netherKeyContentType(Buffer.from("dimension1")), null);

        assert.ok(isNetherChunkKey(chunkKey(9, 9, "nether", "SubChunkPrefix", 1)));
        assert.ok(!isNetherChunkKey(chunkKey(9, 9, "overworld", "SubChunkPrefix", 1)));
    });

    it("removes Nether chunks from a real LevelDB while leaving everything else", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "betafied-nether-"));
        const overworldKey = chunkKey(0, 0, "overworld", "SubChunkPrefix", 0);
        const endKey = chunkKey(0, 0, "the_end", "SubChunkPrefix", 0);
        const netherKey = chunkKey(0, 0, "nether", "SubChunkPrefix", 0);
        const netherEntityKey = chunkKey(0, 0, "nether", "Entity");
        const netherDigestKey = digestKey(0, 0, "nether");

        const db = new LevelDB(dir, { createIfMissing: true });
        await db.open();
        await db.put(Buffer.from("Nether"), Buffer.from("singleton"));
        for (const key of [overworldKey, endKey, netherKey, netherEntityKey, netherDigestKey]) {
            await db.put(key, Buffer.from("x"));
        }

        const deletions = [];
        const iterator = db.getIterator({ keys: true, values: false, keyAsBuffer: true, valueAsBuffer: true });
        for await (const [key] of iterator) {
            if (isNetherChunkKey(key)) deletions.push({ type: "del", key });
        }
        await db.batch(deletions);
        await db.close();

        assert.equal(deletions.length, 3, "expected the three Nether keys to be deleted");

        const remaining = await readAllKeys(dir);
        const has = (buf) => remaining.some((key) => key.equals(buf));
        assert.ok(!has(netherKey));
        assert.ok(!has(netherEntityKey));
        assert.ok(!has(netherDigestKey));
        assert.ok(has(overworldKey), "Overworld chunk must survive");
        assert.ok(has(endKey), "End chunk must survive");
        assert.ok(has(Buffer.from("Nether")), "The Nether singleton must survive");

        fs.rmSync(dir, { recursive: true, force: true });
    });
});
