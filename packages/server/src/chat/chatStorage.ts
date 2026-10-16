// Per-game chat log: one real SQLite file per Game, append-only -- direct
// structural mirror of ../world/storage.ts's per-world voxel storage
// (same node:sqlite DatabaseSync driver, same createXStorage(baseDir,
// scopeId) factory shape), just a message log instead of a chunk
// key-value table. Chat is a discrete event log, not continuously-synced
// live state, so it deliberately does NOT go through Colyseus Schema --
// see GameRoom.ts's own header comment for why.
//
// Factored as createChatStorage(baseDir, gameId) rather than module-level
// state, same reasoning as store.ts/storage.ts: tests point it at an
// isolated temp directory instead of touching the real data/ tree.

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export interface ChatMessage {
  /** Autoincrement row id -- also the pagination/dedupe cursor the REST scrollback endpoint and the live broadcast both key off of. */
  id: number;
  senderName: string;
  /** Already-resolved display text (any /roll or [[...]] segments substituted in) -- never raw notation plus separate roll data, so there's exactly one thing to render. */
  text: string;
  createdAt: number;
}

export interface ChatStorage {
  append(senderName: string, text: string): ChatMessage;
  /** The `limit` most recent messages, oldest first (ready to render top-to-bottom). */
  recent(limit: number): ChatMessage[];
  /** Up to `limit` messages strictly older than `beforeId`, oldest first -- scrollback pagination. */
  before(beforeId: number, limit: number): ChatMessage[];
  close(): void;
}

export function createChatStorage(baseDir: string, gameId: string): ChatStorage {
  mkdirSync(baseDir, { recursive: true });
  const db = new DatabaseSync(join(baseDir, `${gameId}.sqlite`));

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_name TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  const appendStmt = db.prepare("INSERT INTO messages (sender_name, text, created_at) VALUES (?, ?, ?)");
  const recentStmt = db.prepare("SELECT id, sender_name, text, created_at FROM messages ORDER BY id DESC LIMIT ?");
  const beforeStmt = db.prepare("SELECT id, sender_name, text, created_at FROM messages WHERE id < ? ORDER BY id DESC LIMIT ?");

  interface Row {
    id: number;
    sender_name: string;
    text: string;
    created_at: number;
  }

  function toMessage(row: Row): ChatMessage {
    return { id: row.id, senderName: row.sender_name, text: row.text, createdAt: row.created_at };
  }

  return {
    append(senderName, text) {
      const createdAt = Date.now();
      const result = appendStmt.run(senderName, text, createdAt);
      return { id: Number(result.lastInsertRowid), senderName, text, createdAt };
    },

    recent(limit) {
      const rows = recentStmt.all(limit) as unknown as Row[];
      return rows.map(toMessage).reverse();
    },

    before(beforeId, limit) {
      const rows = beforeStmt.all(beforeId, limit) as unknown as Row[];
      return rows.map(toMessage).reverse();
    },

    close() {
      db.close();
    },
  };
}
