import {
  DBChunkLinkedContentTypes,
  getChunkKeyIndices,
  getContentTypeFromDBKey,
} from "mcbe-leveldb";

const CHUNK_LINKED_CONTENT_TYPES = new Set(DBChunkLinkedContentTypes);

/**
 * Classifies a raw Bedrock LevelDB key, returning its content type when it holds Nether
 * chunk data and `null` otherwise.
 *
 * Bedrock keeps all three dimensions in one LevelDB, so a dimension is not a folder to
 * delete — it is the dimension word baked into each chunk key (terrain, block entities,
 * entities, ticks and digests alike). Non-chunk keys, including the per-dimension
 * singleton ("Nether"), carry no terrain and are deliberately left alone.
 */
export function netherKeyContentType(key) {
  const type = getContentTypeFromDBKey(key);
  if (!CHUNK_LINKED_CONTENT_TYPES.has(type)) return null;
  return getChunkKeyIndices(key).dimension === "nether" ? type : null;
}

export function isNetherChunkKey(key) {
  return netherKeyContentType(key) !== null;
}
