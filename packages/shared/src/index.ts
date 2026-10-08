// Phase 0: proves the workspace-linking setup works end to end -- both the
// client and server import this same type from the shared package. Real
// game data (voxel types, item catalog, network message shapes) lands here
// starting Phase 2, per the migration plan.

export interface HelloMessage {
  text: string;
  sentAt: number;
}

// Phase 2: chunk streaming protocol. Chunk *requests* (client -> server) are
// small enough to go as a plain Colyseus message ({cx,cy,cz}); chunk
// *responses* (server -> client) carry a full voxel array and go over the
// raw-binary path (Room#sendBytes / client Room#onMessage("chunk", ...)),
// per the architecture plan's Schema-vs-binary split. Encode/decode live
// here so client and server can't drift on the wire format.

/** Must match the `chunkSize` passed to noa-engine's Engine constructor. */
export const CHUNK_SIZE = 32;

const VOXELS_PER_CHUNK = CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE;
const HEADER_BYTES = 12; // 3x int32: cx, cy, cz

export interface ChunkRequest {
  cx: number;
  cy: number;
  cz: number;
}

export interface DecodedChunk {
  cx: number;
  cy: number;
  cz: number;
  voxels: Uint8Array;
}

/** One byte per voxel (block ids 0..255) -- plenty of headroom for Phase 3's ~20-type catalog. */
export function encodeChunk(cx: number, cy: number, cz: number, voxels: Uint8Array): Uint8Array {
  if (voxels.length !== VOXELS_PER_CHUNK) {
    throw new Error(`encodeChunk: expected ${VOXELS_PER_CHUNK} voxels, got ${voxels.length}`);
  }
  const bytes = new Uint8Array(HEADER_BYTES + voxels.length);
  const view = new DataView(bytes.buffer);
  view.setInt32(0, cx, true);
  view.setInt32(4, cy, true);
  view.setInt32(8, cz, true);
  bytes.set(voxels, HEADER_BYTES);
  return bytes;
}

export function decodeChunk(bytes: Uint8Array): DecodedChunk {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const cx = view.getInt32(0, true);
  const cy = view.getInt32(4, true);
  const cz = view.getInt32(8, true);
  const voxels = bytes.subarray(HEADER_BYTES, HEADER_BYTES + VOXELS_PER_CHUNK);
  return { cx, cy, cz, voxels };
}

// Worlds lobby page: client-side fuzzy search over the (small) worlds list,
// so filtering is instant-as-you-type rather than a server round-trip per
// keystroke. Standard lightweight "fuzzy-finder" approach -- ordered
// subsequence matching (every query character must appear in the target,
// in order, not necessarily adjacent) with a score boost for contiguous
// runs and a small bonus for matches starting earlier in the string. Pure
// function, no 3D/physics involved -- real unit tests live in
// fuzzyMatch.test.ts.

export interface FuzzyMatchResult<T> {
  item: T;
  score: number;
}

/** Characters of `query` must appear in `text`, in order (not necessarily adjacent). Case-insensitive. Returns null if query isn't a subsequence of text at all. */
function scoreSubsequence(query: string, text: string): number | null {
  if (query.length === 0) return 0;
  let qi = 0;
  let score = 0;
  let contiguousRun = 0;
  for (let ti = 0; ti < text.length && qi < query.length; ti++) {
    if (text[ti] === query[qi]) {
      contiguousRun++;
      // Contiguous runs score much higher than scattered single-char hits;
      // an early match is worth a little more than a late one.
      score += 10 + contiguousRun * 15 - ti * 0.1;
      qi++;
    } else {
      contiguousRun = 0;
    }
  }
  return qi === query.length ? score : null;
}

/**
 * Fuzzy-filters and ranks `items` by how well `query` matches `getText(item)`.
 * Items that don't match at all (query isn't an in-order subsequence of the
 * item's text) are excluded, not just scored low. An empty query matches
 * everything with score 0, preserving input order (nothing to rank by yet).
 */
export function fuzzyMatch<T>(query: string, items: readonly T[], getText: (item: T) => string): FuzzyMatchResult<T>[] {
  const q = query.trim().toLowerCase();
  if (!q) return items.map((item) => ({ item, score: 0 }));

  const results: FuzzyMatchResult<T>[] = [];
  for (const item of items) {
    const score = scoreSubsequence(q, getText(item).toLowerCase());
    if (score !== null) results.push({ item, score });
  }
  results.sort((a, b) => b.score - a.score);
  return results;
}

export * from "./voxelTypes.js";
export * from "./items.js";
export * from "./collision.js";
