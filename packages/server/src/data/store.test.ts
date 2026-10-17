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

    expect(store.listCharactersForAccount("root")).toHaveLength(1);
    expect(store.listCharactersForAccount("test1")).toHaveLength(1);

    store.ensureSeedData(); // calling again must not duplicate
    expect(store.listAccounts()).toHaveLength(3);
    expect(store.listGamesVisibleTo("root")).toHaveLength(2);
    expect(store.listCharactersForAccount("root")).toHaveLength(1);
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

  it("createGame defaults modIds to an empty array; enableModForGame/disableModForGame persist changes, no-op for an unknown game id (per-GAME, not per-world -- real correction, 2026-10-17)", () => {
    const owner = store.createAccount("Owner");
    const game = store.createGame("Mod Game", owner.id);

    expect(store.getGame(game.id)?.modIds).toEqual([]);

    store.enableModForGame(game.id, "example-noop");
    expect(store.getGame(game.id)?.modIds).toEqual(["example-noop"]);

    // Enabling the same mod twice doesn't duplicate it.
    store.enableModForGame(game.id, "example-noop");
    expect(store.getGame(game.id)?.modIds).toEqual(["example-noop"]);

    store.enableModForGame(game.id, "second-mod");
    expect(store.getGame(game.id)?.modIds).toEqual(["example-noop", "second-mod"]);

    store.disableModForGame(game.id, "example-noop");
    expect(store.getGame(game.id)?.modIds).toEqual(["second-mod"]);

    expect(() => store.enableModForGame("not-a-real-game", "example-noop")).not.toThrow();
    expect(() => store.disableModForGame("not-a-real-game", "example-noop")).not.toThrow();
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

  it("deleteAccount cascades to that account's own characters, leaving other accounts' characters alone", () => {
    const owner = store.createAccount("Character Owner");
    const other = store.createAccount("Other Owner");
    const character = store.createCharacter(owner.id, "Removable Character", [1, 0, 0]);
    const otherCharacter = store.createCharacter(other.id, "Kept Character", [0, 1, 0]);

    store.deleteAccount(owner.id);
    expect(store.getCharacter(character.id)).toBeUndefined();
    expect(store.getCharacter(otherCharacter.id)).toEqual(otherCharacter);
  });

  it("createCharacter creates a character with a unique id, defaulted stats, and no status effects", () => {
    const owner = store.createAccount("Owner");
    const a = store.createCharacter(owner.id, "Aria", [1, 0, 0]);
    const b = store.createCharacter(owner.id, "Bram", [0, 0, 1]);

    expect(a.id).not.toBe(b.id);
    expect(a.ownerAccountId).toBe(owner.id);
    expect(a.token).toEqual({ color: [1, 0, 0] });
    expect(a.hp).toBe(a.maxHp);
    expect(a.mp).toBe(a.maxMp);
    expect(a.statusEffects).toEqual([]);
  });

  it("listCharactersForAccount returns only that owner's characters", () => {
    const owner = store.createAccount("Owner");
    const other = store.createAccount("Other");
    const character = store.createCharacter(owner.id, "Mine", [1, 0, 0]);
    store.createCharacter(other.id, "Theirs", [0, 1, 0]);

    expect(store.listCharactersForAccount(owner.id).map((c) => c.id)).toEqual([character.id]);
    expect(store.listCharactersForAccount("does-not-exist")).toEqual([]);
  });

  it("getCharacter returns the character record by id, undefined for an unknown id", () => {
    const owner = store.createAccount("Owner");
    const character = store.createCharacter(owner.id, "Lookup", [1, 0, 0]);

    expect(store.getCharacter(character.id)).toEqual(character);
    expect(store.getCharacter("not-a-real-character")).toBeUndefined();
  });

  it("getDefaultCharacterForAccount returns the account's oldest character when it has one, undefined for an unknown account", () => {
    const owner = store.createAccount("Owner");
    const first = store.createCharacter(owner.id, "First", [1, 0, 0]);
    store.createCharacter(owner.id, "Second", [0, 1, 0]);

    expect(store.getDefaultCharacterForAccount(owner.id)?.id).toBe(first.id);
    expect(store.getDefaultCharacterForAccount("not-a-real-account")).toBeUndefined();
  });

  it("getDefaultCharacterForAccount auto-creates a character for a real account that has none yet, and persists it so the next call returns the SAME one", () => {
    const owner = store.createAccount("Fresh Owner");
    expect(store.listCharactersForAccount(owner.id)).toEqual([]);

    const created = store.getDefaultCharacterForAccount(owner.id);
    expect(created).toBeDefined();
    expect(created?.ownerAccountId).toBe(owner.id);
    expect(store.listCharactersForAccount(owner.id)).toEqual([created]);

    // Real request: deleting your last character should just mean the
    // NEXT join recreates a fresh default, not a permanent dead end.
    store.deleteCharacter(created!.id);
    expect(store.listCharactersForAccount(owner.id)).toEqual([]);
    const recreated = store.getDefaultCharacterForAccount(owner.id);
    expect(recreated).toBeDefined();
    expect(recreated?.id).not.toBe(created?.id);

    // A second call once a character already exists doesn't create ANOTHER one.
    expect(store.getDefaultCharacterForAccount(owner.id)?.id).toBe(recreated?.id);
    expect(store.listCharactersForAccount(owner.id)).toHaveLength(1);
  });

  it("updateCharacterStats writes a single stat and persists it; a no-op for an unknown id", () => {
    const owner = store.createAccount("Owner");
    const character = store.createCharacter(owner.id, "Statted", [1, 0, 0]);

    store.updateCharacterStats(character.id, "hp", 3);
    expect(store.getCharacter(character.id)?.hp).toBe(3);
    expect(store.getCharacter(character.id)?.maxHp).toBe(character.maxHp);

    expect(() => store.updateCharacterStats("not-a-real-character", "hp", 99)).not.toThrow();
  });

  it("setCharacterStatusEffects replaces the status effects list and persists it", () => {
    const owner = store.createAccount("Owner");
    const character = store.createCharacter(owner.id, "Effected", [1, 0, 0]);

    store.setCharacterStatusEffects(character.id, [{ icon: "poison.svg", label: "Poisoned" }]);
    expect(store.getCharacter(character.id)?.statusEffects).toEqual([{ icon: "poison.svg", label: "Poisoned" }]);

    expect(() => store.setCharacterStatusEffects("not-a-real-character", [])).not.toThrow();
  });

  it("setCharacterToken replaces the token color and persists it; a no-op for an unknown id", () => {
    const owner = store.createAccount("Owner");
    const character = store.createCharacter(owner.id, "Tokened", [1, 0, 0]);

    store.setCharacterToken(character.id, [0, 1, 0]);
    expect(store.getCharacter(character.id)?.token).toEqual({ color: [0, 1, 0] });

    expect(() => store.setCharacterToken("not-a-real-character", [0, 0, 0])).not.toThrow();
  });

  it("deleteCharacter removes just that character; a no-op for an unknown id", () => {
    const owner = store.createAccount("Owner");
    const keep = store.createCharacter(owner.id, "Keep", [1, 0, 0]);
    const remove = store.createCharacter(owner.id, "Remove", [0, 1, 0]);

    store.deleteCharacter(remove.id);
    expect(store.listCharactersForAccount(owner.id).map((c) => c.id)).toEqual([keep.id]);
    expect(() => store.deleteCharacter("not-a-real-character")).not.toThrow();
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
    store.createCharacter(owner.id, "Persisted Character", [1, 0, 0]);

    const reopened = createStore(dir);
    expect(reopened.listAccounts().map((a) => a.displayName)).toContain("Persisted Owner");
    expect(reopened.listGamesVisibleTo(owner.id)).toHaveLength(1);
    expect(reopened.listWorldsForGame(game.id)).toHaveLength(1);
    expect(reopened.listCharactersForAccount(owner.id)).toHaveLength(1);
  });
});
