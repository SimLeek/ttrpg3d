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
