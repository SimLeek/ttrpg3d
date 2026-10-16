import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChatStorage, type ChatStorage } from "./chatStorage.js";

describe("per-game chat storage (node:sqlite-backed, pure logic -- real unit tests)", () => {
  let dir: string;
  let storage: ChatStorage;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ttrpg3d-chatstorage-test-"));
    storage = createChatStorage(dir, "game-1");
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns an empty list when nothing has been sent yet", () => {
    expect(storage.recent(50)).toEqual([]);
  });

  it("round-trips an appended message's fields, assigning a real incrementing id", () => {
    const msg = storage.append("Alice", "hello");
    expect(msg.senderName).toBe("Alice");
    expect(msg.text).toBe("hello");
    expect(msg.id).toBeGreaterThan(0);
    expect(storage.recent(50)).toEqual([msg]);
  });

  it("recent() returns messages oldest-first, most recent N only", () => {
    storage.append("A", "one");
    storage.append("A", "two");
    storage.append("A", "three");
    const recent = storage.recent(2);
    expect(recent.map((m) => m.text)).toEqual(["two", "three"]);
  });

  it("before() returns the page strictly older than the given cursor, oldest-first", () => {
    const m1 = storage.append("A", "one");
    storage.append("A", "two");
    storage.append("A", "three");
    const page = storage.before(m1.id + 2, 10);
    expect(page.map((m) => m.text)).toEqual(["one", "two"]);
  });

  it("keeps different games in separate files -- a message appended in one isn't visible in another", () => {
    storage.append("A", "in game 1");
    const other = createChatStorage(dir, "game-2");
    expect(other.recent(50)).toEqual([]);
    other.close();
  });

  it("persists to the actual file across separate createChatStorage calls", () => {
    // Deliberately a separate open/close pair, not the shared `storage`
    // from beforeEach -- same reasoning as storage.test.ts's own
    // "persists across separate calls" test (DatabaseSync.close() throws
    // on a second close of the same handle).
    const first = createChatStorage(dir, "game-persist");
    first.append("A", "still here after reopen");
    first.close();

    const reopened = createChatStorage(dir, "game-persist");
    expect(reopened.recent(50).map((m) => m.text)).toEqual(["still here after reopen"]);
    reopened.close();
  });
});
