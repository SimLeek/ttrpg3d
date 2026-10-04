// Per-world voxel storage: one real SQLite file per world, holding only
// EDITED chunks (never a full world snapshot) -- matches the sparse-diff
// model the architecture plan committed to from the start (unmodified
// terrain always regenerates from the generator+seed).
//
// Driver is node:sqlite's DatabaseSync, not better-sqlite3 -- the latter's
// native build failed outright in this sandbox (node-gyp/compile error
// against this Node version) when tried for the accounts/worlds store.
// node:sqlite is built into Node itself (confirmed: Node 26, no native
// compilation, a real file-backed DB round-tripped a BLOB column correctly
// as a Uint8Array across close/reopen -- verified directly, not assumed).
//
// Factored as createWorldStorage(baseDir, worldId) rather than module-level
// state, same reasoning as data/store.ts: tests point it at an isolated
// temp directory instead of touching the real data/ tree.

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export interface WorldStorage {
  getChunk(cx: number, cy: number, cz: number): Uint8Array | null;
  setChunk(cx: number, cy: number, cz: number, voxels: Uint8Array): void;
  close(): void;
}

export function createWorldStorage(baseDir: string, worldId: string): WorldStorage {
  mkdirSync(baseDir, { recursive: true });
  const db = new DatabaseSync(join(baseDir, `${worldId}.sqlite`));

  db.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      cx INTEGER NOT NULL,
      cy INTEGER NOT NULL,
      cz INTEGER NOT NULL,
      block_data BLOB NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (cx, cy, cz)
    )
  `);

  const getStmt = db.prepare("SELECT block_data FROM chunks WHERE cx = ? AND cy = ? AND cz = ?");
  const setStmt = db.prepare(
    "INSERT INTO chunks (cx, cy, cz, block_data, updated_at) VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT (cx, cy, cz) DO UPDATE SET block_data = excluded.block_data, updated_at = excluded.updated_at",
  );

  return {
    getChunk(cx, cy, cz) {
      const row = getStmt.get(cx, cy, cz) as { block_data: Uint8Array } | undefined;
      return row ? row.block_data : null;
    },

    setChunk(cx, cy, cz, voxels) {
      setStmt.run(cx, cy, cz, voxels, Date.now());
    },

    close() {
      db.close();
    },
  };
}
