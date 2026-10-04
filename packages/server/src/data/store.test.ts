import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore, type Store } from "./store.js";

describe("accounts/worlds store (pure logic, no 3D/physics -- real unit tests)", () => {
  let dir: string;
  let store: Store;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ttrpg3d-store-test-"));
    store = createStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("seeds root + two test accounts and two test worlds on first call, and is idempotent", () => {
    store.ensureSeedData();
    const accounts = store.listAccounts();
    expect(accounts.map((a) => a.id).sort()).toEqual(["root", "test1", "test2"]);
    expect(accounts.find((a) => a.id === "root")?.role).toBe("root");
    expect(accounts.find((a) => a.id === "test1")?.role).toBe("normal");

    store.ensureSeedData(); // calling again must not duplicate
    expect(store.listAccounts()).toHaveLength(3);
  });

  it("creates a new normal account with a unique id", () => {
    const a = store.createAccount("Alice");
    const b = store.createAccount("Bob");
    expect(a.role).toBe("normal");
    expect(a.id).not.toBe(b.id);
    expect(store.listAccounts().map((x) => x.displayName)).toEqual(["Alice", "Bob"]);
  });

  it("owner sees their own world; a stranger does not", () => {
    const owner = store.createAccount("Owner");
    const stranger = store.createAccount("Stranger");
    const world = store.createWorld("Owner's World", owner.id);

    expect(store.listWorldsVisibleTo(owner.id).map((w) => w.id)).toContain(world.id);
    expect(store.listWorldsVisibleTo(stranger.id)).toEqual([]);
  });

  it("a granted admin sees the world; revoking isn't implemented, but a non-admin never does", () => {
    const owner = store.createAccount("Owner");
    const admin = store.createAccount("Admin");
    const stranger = store.createAccount("Stranger");
    const world = store.createWorld("Shared World", owner.id);

    expect(store.listWorldsVisibleTo(admin.id)).toEqual([]);
    store.grantAdmin(world.id, admin.id);
    expect(store.listWorldsVisibleTo(admin.id).map((w) => w.id)).toContain(world.id);
    expect(store.listWorldsVisibleTo(stranger.id)).toEqual([]);
  });

  it("root is an implicit superuser -- sees every world with no explicit grant", () => {
    store.ensureSeedData(); // creates the root account
    const owner = store.createAccount("Owner");
    const world1 = store.createWorld("World One", owner.id);
    const world2 = store.createWorld("World Two", owner.id);

    const visibleToRoot = store.listWorldsVisibleTo("root").map((w) => w.id);
    expect(visibleToRoot).toContain(world1.id);
    expect(visibleToRoot).toContain(world2.id);
  });

  it("listWorldsVisibleTo returns empty for an unknown account id", () => {
    expect(store.listWorldsVisibleTo("does-not-exist")).toEqual([]);
  });

  it("persists across separate createStore calls pointed at the same directory", () => {
    const owner = store.createAccount("Persisted Owner");
    store.createWorld("Persisted World", owner.id);

    const reopened = createStore(dir);
    expect(reopened.listAccounts().map((a) => a.displayName)).toContain("Persisted Owner");
    expect(reopened.listWorldsVisibleTo(owner.id)).toHaveLength(1);
  });
});
