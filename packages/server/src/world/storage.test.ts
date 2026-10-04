import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorldStorage, type WorldStorage } from "./storage.js";

describe("per-world voxel storage (node:sqlite-backed, pure logic -- real unit tests)", () => {
  let dir: string;
  let storage: WorldStorage;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ttrpg3d-storage-test-"));
    storage = createWorldStorage(dir, "world-1");
  });

  afterEach(() => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null for a chunk that's never been saved", () => {
    expect(storage.getChunk(0, 0, 0)).toBeNull();
  });

  it("round-trips a saved chunk's exact bytes", () => {
    const voxels = new Uint8Array([1, 2, 3, 0, 255, 1]);
    storage.setChunk(1, 2, 3, voxels);
    expect(storage.getChunk(1, 2, 3)).toEqual(voxels);
  });

  it("overwrites a chunk saved twice at the same coordinates", () => {
    storage.setChunk(0, 0, 0, new Uint8Array([1, 1, 1]));
    storage.setChunk(0, 0, 0, new Uint8Array([2, 2, 2]));
    expect(storage.getChunk(0, 0, 0)).toEqual(new Uint8Array([2, 2, 2]));
  });

  it("keeps different chunk coordinates independent", () => {
    storage.setChunk(0, 0, 0, new Uint8Array([9]));
    storage.setChunk(1, 0, 0, new Uint8Array([8]));
    expect(storage.getChunk(0, 0, 0)).toEqual(new Uint8Array([9]));
    expect(storage.getChunk(1, 0, 0)).toEqual(new Uint8Array([8]));
  });

  it("handles negative chunk coordinates", () => {
    storage.setChunk(-5, -1, -3, new Uint8Array([7, 7]));
    expect(storage.getChunk(-5, -1, -3)).toEqual(new Uint8Array([7, 7]));
  });

  it("persists to the actual file across separate createWorldStorage calls", () => {
    // Deliberately doesn't touch the shared `storage` from beforeEach (its
    // own close() in afterEach must stay a single, first close -- confirmed
    // directly that DatabaseSync.close() throws "database is not open" on
    // a second call, so this uses its own independent open/close pair).
    const first = createWorldStorage(dir, "world-persist");
    first.setChunk(4, 4, 4, new Uint8Array([42]));
    first.close();

    const reopened = createWorldStorage(dir, "world-persist");
    expect(reopened.getChunk(4, 4, 4)).toEqual(new Uint8Array([42]));
    reopened.close();
  });

  it("keeps different worlds in separate files -- a chunk saved in one isn't visible in another", () => {
    storage.setChunk(0, 0, 0, new Uint8Array([1]));
    const other = createWorldStorage(dir, "world-2");
    expect(other.getChunk(0, 0, 0)).toBeNull();
    other.close();
  });
});
