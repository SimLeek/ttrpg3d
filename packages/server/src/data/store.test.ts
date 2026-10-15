import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore, type Store } from "./store.js";
import { DEFAULT_GENERATOR_ID } from "@ttrpg3d/shared";

describe("accounts/games/worlds store (pure logic, no 3D/physics -- real unit tests)", () => {
  let dir: string;
  let store: Store;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ttrpg3d-store-test-"));
    store = createStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("seeds root + two test accounts, two test games, and one starter DEFAULT_GENERATOR_ID world per game on first call, and is idempotent", () => {
    store.ensureSeedData();
    const accounts = store.listAccounts();
    expect(accounts.map((a) => a.id).sort()).toEqual(["root", "test1", "test2"]);
    expect(accounts.find((a) => a.id === "root")?.role).toBe("root");
    expect(accounts.find((a) => a.id === "test1")?.role).toBe("normal");

    const games = store.listGamesVisibleTo("root");
    expect(games).toHaveLength(2);
    for (const game of games) {
      const worlds = store.listWorldsForGame(game.id);
      expect(worlds).toHaveLength(1);
      expect(worlds[0].generatorId).toBe(DEFAULT_GENERATOR_ID);
    }

    store.ensureSeedData(); // calling again must not duplicate
    expect(store.listAccounts()).toHaveLength(3);
    expect(store.listGamesVisibleTo("root")).toHaveLength(2);
  });

  it("creates a new normal account with a unique id", () => {
    const a = store.createAccount("Alice");
    const b = store.createAccount("Bob");
    expect(a.role).toBe("normal");
    expect(a.id).not.toBe(b.id);
    expect(store.listAccounts().map((x) => x.displayName)).toEqual(["Alice", "Bob"]);
  });

  it("owner sees their own game; a stranger does not", () => {
    const owner = store.createAccount("Owner");
    const stranger = store.createAccount("Stranger");
    const game = store.createGame("Owner's Game", owner.id);

    expect(store.listGamesVisibleTo(owner.id).map((g) => g.id)).toContain(game.id);
    expect(store.listGamesVisibleTo(stranger.id)).toEqual([]);
  });

  it("a granted admin sees the game; a non-admin never does", () => {
    const owner = store.createAccount("Owner");
    const admin = store.createAccount("Admin");
    const stranger = store.createAccount("Stranger");
    const game = store.createGame("Shared Game", owner.id);

    expect(store.listGamesVisibleTo(admin.id)).toEqual([]);
    store.grantGameAdmin(game.id, admin.id);
    expect(store.listGamesVisibleTo(admin.id).map((g) => g.id)).toContain(game.id);
    expect(store.listGamesVisibleTo(stranger.id)).toEqual([]);
  });

  it("root is an implicit superuser -- sees every game with no explicit grant", () => {
    store.ensureSeedData(); // creates the root account
    const owner = store.createAccount("Owner");
    const game1 = store.createGame("Game One", owner.id);
    const game2 = store.createGame("Game Two", owner.id);

    const visibleToRoot = store.listGamesVisibleTo("root").map((g) => g.id);
    expect(visibleToRoot).toContain(game1.id);
    expect(visibleToRoot).toContain(game2.id);
  });

  it("listGamesVisibleTo returns empty for an unknown account id", () => {
    expect(store.listGamesVisibleTo("does-not-exist")).toEqual([]);
  });

  it("isGameAdmin: owner, granted admin, and root are admin; a stranger, unknown account, and unknown game are not", () => {
    store.ensureSeedData(); // creates the root account
    const owner = store.createAccount("Owner");
    const admin = store.createAccount("Admin");
    const stranger = store.createAccount("Stranger");
    const game = store.createGame("Guarded Game", owner.id);

    expect(store.isGameAdmin(game.id, owner.id)).toBe(true);
    expect(store.isGameAdmin(game.id, stranger.id)).toBe(false);

    store.grantGameAdmin(game.id, admin.id);
    expect(store.isGameAdmin(game.id, admin.id)).toBe(true);

    expect(store.isGameAdmin(game.id, "root")).toBe(true);
    expect(store.isGameAdmin(game.id, "does-not-exist")).toBe(false);
    expect(store.isGameAdmin("not-a-real-game", owner.id)).toBe(false);
    expect(store.isGameAdmin(game.id, undefined)).toBe(false);
  });

  it("createWorld adds a world to a game, listed by listWorldsForGame; worlds carry no owner/admin of their own", () => {
    const owner = store.createAccount("Owner");
    const game = store.createGame("Multi-page Game", owner.id);

    const world1 = store.createWorld(game.id, "Overworld", "hilly", {});
    const world2 = store.createWorld(game.id, "The Quarry", "limestone_slab", { width: 16, height: 4, depth: 16, voxelId: 1 });

    const worlds = store.listWorldsForGame(game.id);
    expect(worlds.map((w) => w.id).sort()).toEqual([world1.id, world2.id].sort());
    expect(worlds.find((w) => w.id === world2.id)?.params).toEqual({ width: 16, height: 4, depth: 16, voxelId: 1 });
  });

  it("isWorldAdmin resolves through the world's parent game -- same owner/admin/root/stranger outcomes as isGameAdmin", () => {
    const owner = store.createAccount("Owner");
    const stranger = store.createAccount("Stranger");
    const game = store.createGame("World-admin-check Game", owner.id);
    const world = store.createWorld(game.id, "Page One", "hilly", {});

    expect(store.isWorldAdmin(world.id, owner.id)).toBe(true);
    expect(store.isWorldAdmin(world.id, stranger.id)).toBe(false);
    expect(store.isWorldAdmin("not-a-real-world", owner.id)).toBe(false);
  });

  it("setWorldRespawnAnchor persists the anchor onto the world record, visible via getWorld; a no-op for an unknown world id", () => {
    const owner = store.createAccount("Owner");
    const game = store.createGame("Anchor Game", owner.id);
    const world = store.createWorld(game.id, "Page One", "hilly", {});

    expect(store.getWorld(world.id)?.respawnAnchor).toBeUndefined();
    store.setWorldRespawnAnchor(world.id, { x: 1, y: 2, z: 3 });
    expect(store.getWorld(world.id)?.respawnAnchor).toEqual({ x: 1, y: 2, z: 3 });

    expect(() => store.setWorldRespawnAnchor("not-a-real-world", { x: 0, y: 0, z: 0 })).not.toThrow();
  });

  it("getWorld returns the world record by id, undefined for an unknown id", () => {
    const owner = store.createAccount("Owner");
    const game = store.createGame("Lookup Game", owner.id);
    const world = store.createWorld(game.id, "Page One", "hilly", {});

    expect(store.getWorld(world.id)).toMatchObject({ id: world.id, gameId: game.id, name: "Page One" });
    expect(store.getWorld("not-a-real-world")).toBeUndefined();
  });

  it("getGame returns the game record by id, undefined for an unknown id", () => {
    const owner = store.createAccount("Owner");
    const game = store.createGame("Lookup Game", owner.id);

    expect(store.getGame(game.id)).toMatchObject({ id: game.id, name: "Lookup Game" });
    expect(store.getGame("not-a-real-game")).toBeUndefined();
  });

  it("deleteAccount removes the account; a no-op for an unknown id", () => {
    const account = store.createAccount("Removable");
    store.deleteAccount(account.id);
    expect(store.getAccount(account.id)).toBeUndefined();
    expect(() => store.deleteAccount("not-a-real-account")).not.toThrow();
  });

  it("deleteWorld removes just that world, leaving its siblings alone; a no-op for an unknown id", () => {
    const owner = store.createAccount("Owner");
    const game = store.createGame("Delete-world Game", owner.id);
    const world1 = store.createWorld(game.id, "Keep", "hilly", {});
    const world2 = store.createWorld(game.id, "Remove", "hilly", {});

    store.deleteWorld(world2.id);
    expect(store.listWorldsForGame(game.id).map((w) => w.id)).toEqual([world1.id]);
    expect(() => store.deleteWorld("not-a-real-world")).not.toThrow();
  });

  it("deleteGame cascades to every world inside it, but leaves other games' worlds alone; a no-op for an unknown id", () => {
    const owner = store.createAccount("Owner");
    const gameToDelete = store.createGame("Delete-game Game", owner.id);
    const otherGame = store.createGame("Other Game", owner.id);
    store.createWorld(gameToDelete.id, "Page", "hilly", {});
    const otherWorld = store.createWorld(otherGame.id, "Other Page", "hilly", {});

    store.deleteGame(gameToDelete.id);
    expect(store.getGame(gameToDelete.id)).toBeUndefined();
    expect(store.listWorldsForGame(gameToDelete.id)).toEqual([]);
    expect(store.listWorldsForGame(otherGame.id)).toEqual([otherWorld]);
    expect(() => store.deleteGame("not-a-real-game")).not.toThrow();
  });

  it("persists across separate createStore calls pointed at the same directory", () => {
    const owner = store.createAccount("Persisted Owner");
    const game = store.createGame("Persisted Game", owner.id);
    store.createWorld(game.id, "Persisted World", "hilly", {});

    const reopened = createStore(dir);
    expect(reopened.listAccounts().map((a) => a.displayName)).toContain("Persisted Owner");
    expect(reopened.listGamesVisibleTo(owner.id)).toHaveLength(1);
    expect(reopened.listWorldsForGame(game.id)).toHaveLength(1);
  });
});
