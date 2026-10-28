import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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

  it("createGame defaults seeThroughWalls to true; setSeeThroughWallsForGame persists changes, no-op for an unknown game id", () => {
    const owner = store.createAccount("Owner");
    const game = store.createGame("Wall-vis Game", owner.id);

    expect(store.getGame(game.id)?.seeThroughWalls).toBe(true);

    store.setSeeThroughWallsForGame(game.id, false);
    expect(store.getGame(game.id)?.seeThroughWalls).toBe(false);

    store.setSeeThroughWallsForGame(game.id, true);
    expect(store.getGame(game.id)?.seeThroughWalls).toBe(true);

    expect(() => store.setSeeThroughWallsForGame("not-a-real-game", false)).not.toThrow();
  });

  it("createAccount defaults importedModIds to an empty array; importModForAccount/removeModForAccount persist changes, no-op for an unknown account id (MVP goal item 4, slice 1)", () => {
    const account = store.createAccount("Mod Importer");

    expect(store.getAccount(account.id)?.importedModIds).toEqual([]);

    store.importModForAccount(account.id, "default");
    expect(store.getAccount(account.id)?.importedModIds).toEqual(["default"]);

    // Importing the same mod twice doesn't duplicate it.
    store.importModForAccount(account.id, "default");
    expect(store.getAccount(account.id)?.importedModIds).toEqual(["default"]);

    store.importModForAccount(account.id, "stats-library");
    expect(store.getAccount(account.id)?.importedModIds).toEqual(["default", "stats-library"]);

    store.removeModForAccount(account.id, "default");
    expect(store.getAccount(account.id)?.importedModIds).toEqual(["stats-library"]);

    expect(() => store.importModForAccount("not-a-real-account", "default")).not.toThrow();
    expect(() => store.removeModForAccount("not-a-real-account", "default")).not.toThrow();
  });

  it("createCharacter defaults templateId/customSheet to null and variableValues to an empty object; updateCharacterSheet persists all three, no-op for an unknown character id (MVP goal item 4)", () => {
    const owner = store.createAccount("Sheet Owner");
    const character = store.createCharacter(owner.id, "Sheet Test", [1, 0, 0]);

    expect(store.getCharacter(character.id)?.templateId).toBeNull();
    expect(store.getCharacter(character.id)?.customSheet).toBeNull();
    expect(store.getCharacter(character.id)?.variableValues).toEqual({});

    const customSheet = { name: "Custom", pages: [{ title: "Overview", markdown: "# Hi", variableIds: ["hp"] }], variables: [{ id: "hp", label: "HP", type: "xOfY" as const, default: 10, max: 10 }] };
    store.updateCharacterSheet(character.id, "default", customSheet, { hp: 7, mp: 10 });
    expect(store.getCharacter(character.id)).toMatchObject({ templateId: "default", customSheet, variableValues: { hp: 7, mp: 10 } });

    store.updateCharacterSheet(character.id, null, null, {});
    expect(store.getCharacter(character.id)).toMatchObject({ templateId: null, customSheet: null, variableValues: {} });

    expect(() => store.updateCharacterSheet("not-a-real-character", "default", null, {})).not.toThrow();
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

  it("createCharacter creates a character with a unique id, no sheet yet, and no status effects", () => {
    const owner = store.createAccount("Owner");
    const a = store.createCharacter(owner.id, "Aria", [1, 0, 0]);
    const b = store.createCharacter(owner.id, "Bram", [0, 0, 1]);

    expect(a.id).not.toBe(b.id);
    expect(a.ownerAccountId).toBe(owner.id);
    expect(a.token).toEqual({ color: [1, 0, 0] });
    expect(a.customSheet).toBeNull();
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

  it("updateCharacterVariableValue writes a single variableValues entry and persists it, leaving the rest alone; a no-op for an unknown id", () => {
    const owner = store.createAccount("Owner");
    const character = store.createCharacter(owner.id, "Statted", [1, 0, 0]);
    store.updateCharacterSheet(character.id, null, null, { hp: 10, mp: 10 });

    store.updateCharacterVariableValue(character.id, "hp", 3);
    expect(store.getCharacter(character.id)?.variableValues).toEqual({ hp: 3, mp: 10 });

    expect(() => store.updateCharacterVariableValue("not-a-real-character", "hp", 99)).not.toThrow();
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

  describe("game<->character links (MVP goal item 4 follow-up -- 'characters' tab, many-to-many with optional folders)", () => {
    it("linkCharacterToGame is self-service for your own character, a no-op (not an error) for someone else's unless you're a game admin, and upserts rather than duplicating", () => {
      const owner = store.createAccount("Owner");
      const stranger = store.createAccount("Stranger");
      const game = store.createGame("G", owner.id);
      const character = store.createCharacter(owner.id, "Aria", [1, 0, 0]);

      expect(store.linkCharacterToGame(game.id, character.id, stranger.id)).toEqual([]); // not permitted, not an error
      const linked = store.linkCharacterToGame(game.id, character.id, owner.id, "NPCs");
      expect(linked).toHaveLength(1);
      expect(linked[0]).toMatchObject({ gameId: game.id, characterId: character.id, folder: "NPCs", visibility: "all" });

      // Admin of the game can also link someone else's character.
      store.grantGameAdmin(game.id, stranger.id);
      const strangerChar = store.createCharacter(stranger.id, "Bram", [0, 1, 0]);
      expect(store.linkCharacterToGame(game.id, strangerChar.id, stranger.id)).toHaveLength(2);

      // Re-linking an already-linked character doesn't duplicate or reset its folder.
      expect(store.linkCharacterToGame(game.id, character.id, owner.id)).toHaveLength(2);
      expect(store.listVisibleCharactersForGameAndAccount(game.id, owner.id).links.find((l) => l.character.id === character.id)?.link.folder).toBe("NPCs");
    });

    it("listVisibleCharactersForGameAndAccount: an admin sees everything; a non-admin sees their own + 'all'-visibility + anything explicitly listed for them, never anything else", () => {
      const owner = store.createAccount("Owner");
      const viewer = store.createAccount("Viewer");
      const stranger = store.createAccount("Stranger");
      const game = store.createGame("G", owner.id);

      const visibleToAll = store.createCharacter(owner.id, "Visible", [1, 0, 0]);
      const visibleToViewer = store.createCharacter(owner.id, "Shared", [0, 1, 0]);
      const privateChar = store.createCharacter(owner.id, "Private", [0, 0, 1]);
      store.linkCharacterToGame(game.id, visibleToAll.id, owner.id);
      store.linkCharacterToGame(game.id, visibleToViewer.id, owner.id);
      store.updateGameCharacterLink(game.id, visibleToViewer.id, owner.id, { visibility: [viewer.id] });
      store.linkCharacterToGame(game.id, privateChar.id, owner.id);
      store.updateGameCharacterLink(game.id, privateChar.id, owner.id, { visibility: [] });

      const viewerSees = store.listVisibleCharactersForGameAndAccount(game.id, viewer.id).links.map((l) => l.character.id);
      expect(viewerSees.sort()).toEqual([visibleToAll.id, visibleToViewer.id].sort());

      const strangerSees = store.listVisibleCharactersForGameAndAccount(game.id, stranger.id).links.map((l) => l.character.id);
      expect(strangerSees).toEqual([visibleToAll.id]);

      store.grantGameAdmin(game.id, stranger.id);
      const adminSees = store.listVisibleCharactersForGameAndAccount(game.id, stranger.id).links.map((l) => l.character.id);
      expect(adminSees.sort()).toEqual([visibleToAll.id, visibleToViewer.id, privateChar.id].sort());

      // participantAccounts is just "who owns any linked character" -- unaffected by visibility.
      expect(store.listVisibleCharactersForGameAndAccount(game.id, viewer.id).participantAccounts.map((a) => a.id)).toEqual([owner.id]);
    });

    it("canAccountViewCharacter / canAccountEditCharacter: owner always true; viewer true only via an 'all' or explicit-list link; editor true only via being an admin of a game it's linked to", () => {
      const owner = store.createAccount("Owner");
      const viewer = store.createAccount("Viewer");
      const admin = store.createAccount("Admin");
      const game = store.createGame("G", owner.id);
      const character = store.createCharacter(owner.id, "Aria", [1, 0, 0]);

      expect(store.canAccountViewCharacter(owner.id, character.id)).toBe(true);
      expect(store.canAccountViewCharacter(viewer.id, character.id)).toBe(false); // not linked anywhere yet
      expect(store.canAccountEditCharacter(admin.id, character.id)).toBe(false);

      store.linkCharacterToGame(game.id, character.id, owner.id);
      store.updateGameCharacterLink(game.id, character.id, owner.id, { visibility: [viewer.id] });
      expect(store.canAccountViewCharacter(viewer.id, character.id)).toBe(true);

      store.grantGameAdmin(game.id, admin.id);
      expect(store.canAccountEditCharacter(admin.id, character.id)).toBe(true);
      expect(store.canAccountViewCharacter(admin.id, character.id)).toBe(false); // admin's edit bypass is separate from the viewer check
    });

    it("unlinkCharacterFromGame removes just that link; a no-op (not an error) when not permitted or for an unknown link", () => {
      const owner = store.createAccount("Owner");
      const stranger = store.createAccount("Stranger");
      const game = store.createGame("G", owner.id);
      const character = store.createCharacter(owner.id, "Aria", [1, 0, 0]);
      store.linkCharacterToGame(game.id, character.id, owner.id);

      store.unlinkCharacterFromGame(game.id, character.id, stranger.id); // not permitted
      expect(store.listVisibleCharactersForGameAndAccount(game.id, owner.id).links).toHaveLength(1);

      store.unlinkCharacterFromGame(game.id, character.id, owner.id);
      expect(store.listVisibleCharactersForGameAndAccount(game.id, owner.id).links).toHaveLength(0);
      expect(() => store.unlinkCharacterFromGame(game.id, "not-a-real-character", owner.id)).not.toThrow();
    });

    it("deleteCharacter/deleteGame/deleteAccount all cascade to drop that character's/game's links", () => {
      const owner = store.createAccount("Owner");
      const game = store.createGame("G", owner.id);
      const charA = store.createCharacter(owner.id, "A", [1, 0, 0]);
      const charB = store.createCharacter(owner.id, "B", [0, 1, 0]);
      store.linkCharacterToGame(game.id, charA.id, owner.id);
      store.linkCharacterToGame(game.id, charB.id, owner.id);

      store.deleteCharacter(charA.id);
      expect(store.listVisibleCharactersForGameAndAccount(game.id, owner.id).links.map((l) => l.character.id)).toEqual([charB.id]);

      store.deleteGame(game.id);
      expect(store.listVisibleCharactersForGameAndAccount(game.id, owner.id).links).toEqual([]);

      const game2 = store.createGame("G2", owner.id);
      store.linkCharacterToGame(game2.id, charB.id, owner.id);
      store.deleteAccount(owner.id);
      expect(store.listVisibleCharactersForGameAndAccount(game2.id, owner.id).links).toEqual([]);
    });
  });
});

describe("getAbilityCatalog/setAbilityCatalog (real request, 2026-10-28 -- \"gathered from their imported character sheet xlsx since that has the updated list, and then a default list if that wasn't imported\")", () => {
  let dir: string;
  let modsDir: string;
  let store: Store;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ttrpg3d-store-test-"));
    modsDir = mkdtempSync(join(tmpdir(), "ttrpg3d-store-test-mods-"));
    mkdirSync(join(modsDir, "lyrian-chronicles", "data"), { recursive: true });
    writeFileSync(join(modsDir, "lyrian-chronicles", "data", "abilityCatalogSeed.json"), JSON.stringify([{ name: "Sense Magic", keywords: "", range: "", description: "Detect magic.", requirement: "", cost: "", apCost: "", manaCost: "", rpCost: "", benefits: "" }]));
    store = createStore(dir, modsDir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(modsDir, { recursive: true, force: true });
  });

  it("an account with nothing stored yet gets the mod's own bundled default seed", () => {
    expect(store.getAbilityCatalog("acct1", "lyrian-chronicles")).toEqual([{ name: "Sense Magic", keywords: "", range: "", description: "Detect magic.", requirement: "", cost: "", apCost: "", manaCost: "", rpCost: "", benefits: "" }]);
  });

  it("a mod with no bundled seed file at all returns an empty catalog, not a crash", () => {
    expect(store.getAbilityCatalog("acct1", "some-other-mod")).toEqual([]);
  });

  it("setAbilityCatalog overwrites wholesale (a fresher import), and that account's later reads see the new one -- a DIFFERENT account is unaffected", () => {
    store.getAbilityCatalog("acct1", "lyrian-chronicles"); // seeds the default first, same as a session that's never imported yet
    store.setAbilityCatalog("acct1", "lyrian-chronicles", [{ name: "New Ability", keywords: "", range: "", description: "Fresh from a new import.", requirement: "", cost: "", apCost: "", manaCost: "", rpCost: "", benefits: "" }]);

    expect(store.getAbilityCatalog("acct1", "lyrian-chronicles")).toEqual([{ name: "New Ability", keywords: "", range: "", description: "Fresh from a new import.", requirement: "", cost: "", apCost: "", manaCost: "", rpCost: "", benefits: "" }]);
    // A different account never imported anything -- still the bundled default, untouched by acct1's own refresh.
    expect(store.getAbilityCatalog("acct2", "lyrian-chronicles")).toEqual([{ name: "Sense Magic", keywords: "", range: "", description: "Detect magic.", requirement: "", cost: "", apCost: "", manaCost: "", rpCost: "", benefits: "" }]);
  });

  it("survives a reopen (reads a fresh createStore against the same baseDir)", () => {
    store.setAbilityCatalog("acct1", "lyrian-chronicles", [{ name: "Persisted Ability", keywords: "", range: "", description: "", requirement: "", cost: "", apCost: "", manaCost: "", rpCost: "", benefits: "" }]);
    const reopened = createStore(dir, modsDir);
    expect(reopened.getAbilityCatalog("acct1", "lyrian-chronicles")).toEqual([{ name: "Persisted Ability", keywords: "", range: "", description: "", requirement: "", cost: "", apCost: "", manaCost: "", rpCost: "", benefits: "" }]);
  });
});
