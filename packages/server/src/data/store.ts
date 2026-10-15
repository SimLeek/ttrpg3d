// Accounts + games + worlds registry (metadata only -- see
// docs/PORTING_CHECKLIST.md and the "Worlds lobby page" section of the
// architecture plan for why this is intentionally NOT full per-world voxel
// storage, that's storage.ts).
//
// Plain JSON files, not SQLite: `better-sqlite3` was the first choice (one
// persistence technology throughout the project), but its native build
// failed outright in this environment (node-gyp/compile error against this
// Node version) -- confirmed by actually trying it, not assumed. The plan
// explicitly named a JSON file as an acceptable fallback for exactly this
// kind of small, low-write-frequency metadata, so that's what this is.
//
// Dev-only account model, no passwords: see the "Auth" section of the
// architecture plan. `root` is a seeded, implicit superuser -- it sees and
// can admin every game without an explicit grant row.
//
// Game/World split (games-and-world-generators PR): a roll20-style
// "campaign contains multiple pages" model, confirmed via real design
// discussion ("one game can have many pcg voxel worlds in it"). `Game` is
// now the top-level owned/administered unit (what `WorldRecord` used to
// be); `WorldRecord` is a page WITHIN a game -- it carries no owner/admin
// of its own, permissions resolve through its parent game
// (`isWorldAdmin` -> `getWorld` -> `isGameAdmin`).
//
// Pure, non-3D/non-physics logic -- this is exactly the kind of thing that
// should have real unit tests (see store.test.ts), unlike the client's
// movement/physics code which gets verified by actual playtesting instead.
// Factored as createStore(baseDir) rather than module-level state
// specifically so tests can point it at an isolated temp directory instead
// of this process's real `data/`.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_GENERATOR_ID, type GeneratorId, type GeneratorParams } from "@ttrpg3d/shared";

export interface Account {
  id: string;
  displayName: string;
  role: "root" | "normal";
  createdAt: number;
}

export interface GameRecord {
  id: string;
  name: string;
  ownerAccountId: string;
  adminAccountIds: string[];
  createdAt: number;
}

export interface WorldRecord {
  id: string;
  gameId: string;
  name: string;
  generatorId: GeneratorId;
  params: GeneratorParams;
  createdAt: number;
  /** Respawn core primitive's persisted half -- real bug found live: this used to live ONLY in WorldRoom's in-memory Schema state, which Colyseus disposes once the room empties (the normal case when switching pages away and back in solo/small-group testing), silently losing the anchor. Persisted here instead so it survives a room being recreated. Admin-settable only (WorldRoom's setRespawnAnchor handler), null until set. */
  respawnAnchor?: { x: number; y: number; z: number } | null;
}

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function createStore(baseDir: string) {
  const accountsFile = join(baseDir, "accounts.json");
  const gamesFile = join(baseDir, "games.json");
  const worldsFile = join(baseDir, "worlds.json");

  function readJson<T>(path: string, fallback: T): T {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  }

  function writeJson(path: string, data: unknown): void {
    mkdirSync(baseDir, { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
  }

  function loadAccounts(): Account[] {
    return readJson<Account[]>(accountsFile, []);
  }

  function saveAccounts(accounts: Account[]): void {
    writeJson(accountsFile, accounts);
  }

  function loadGames(): GameRecord[] {
    return readJson<GameRecord[]>(gamesFile, []);
  }

  function saveGames(games: GameRecord[]): void {
    writeJson(gamesFile, games);
  }

  function loadWorlds(): WorldRecord[] {
    return readJson<WorldRecord[]>(worldsFile, []);
  }

  function saveWorlds(worlds: WorldRecord[]): void {
    writeJson(worldsFile, worlds);
  }

  function createWorldInternal(gameId: string, name: string, generatorId: GeneratorId, params: GeneratorParams): WorldRecord {
    const worlds = loadWorlds();
    const world: WorldRecord = { id: newId(), gameId, name, generatorId, params, createdAt: Date.now() };
    worlds.push(world);
    saveWorlds(worlds);
    return world;
  }

  return {
    /** Seeds a root account + a couple of test accounts/games (one starter DEFAULT_GENERATOR_ID world each) on first boot, if the store is empty. Safe to call every boot -- no-ops once seeded. */
    ensureSeedData(): void {
      let accounts = loadAccounts();
      if (accounts.length === 0) {
        const now = Date.now();
        accounts = [
          { id: "root", displayName: "root", role: "root", createdAt: now },
          { id: "test1", displayName: "Test Account 1", role: "normal", createdAt: now },
          { id: "test2", displayName: "Test Account 2", role: "normal", createdAt: now },
        ];
        saveAccounts(accounts);
      }

      let games = loadGames();
      if (games.length === 0) {
        const now = Date.now();
        games = [
          { id: newId(), name: "Root's Game", ownerAccountId: "root", adminAccountIds: [], createdAt: now },
          { id: newId(), name: "Test1's Game", ownerAccountId: "test1", adminAccountIds: [], createdAt: now },
        ];
        saveGames(games);
        for (const game of games) {
          createWorldInternal(game.id, "Starting World", DEFAULT_GENERATOR_ID, {});
        }
      }
    },

    listAccounts(): Account[] {
      return loadAccounts();
    },

    getAccount(id: string): Account | undefined {
      return loadAccounts().find((a) => a.id === id);
    },

    createAccount(displayName: string): Account {
      const accounts = loadAccounts();
      const account: Account = { id: newId(), displayName, role: "normal", createdAt: Date.now() };
      accounts.push(account);
      saveAccounts(accounts);
      return account;
    },

    createGame(name: string, ownerAccountId: string): GameRecord {
      const games = loadGames();
      const game: GameRecord = { id: newId(), name, ownerAccountId, adminAccountIds: [], createdAt: Date.now() };
      games.push(game);
      saveGames(games);
      return game;
    },

    getGame(id: string): GameRecord | undefined {
      return loadGames().find((g) => g.id === id);
    },

    grantGameAdmin(gameId: string, accountId: string): void {
      const games = loadGames();
      const game = games.find((g) => g.id === gameId);
      if (game && !game.adminAccountIds.includes(accountId)) {
        game.adminAccountIds.push(accountId);
        saveGames(games);
      }
    },

    /** Games visible to this account: owner, granted admin, or root's implicit superuser access. */
    listGamesVisibleTo(accountId: string): GameRecord[] {
      const account = loadAccounts().find((a) => a.id === accountId);
      if (!account) return [];
      const games = loadGames();
      if (account.role === "root") return games;
      return games.filter((g) => g.ownerAccountId === accountId || g.adminAccountIds.includes(accountId));
    },

    /**
     * Same owner/admin/root-superuser check listGamesVisibleTo uses for the
     * lobby's game list, for a single (game, account) pair -- the GM
     * admin-override escape hatch's actual permission check
     * (WorldRoom.onJoin, via isWorldAdmin below) and the new-world/switch-
     * page UI's gating. Missing/unknown game or account id is false, not an
     * error, since a stale/forged id should just mean "not admin," not a
     * crash.
     */
    isGameAdmin(gameId: string, accountId: string | undefined): boolean {
      if (!accountId) return false;
      const account = loadAccounts().find((a) => a.id === accountId);
      if (!account) return false;
      if (account.role === "root") return true;
      const game = loadGames().find((g) => g.id === gameId);
      if (!game) return false;
      return game.ownerAccountId === accountId || game.adminAccountIds.includes(accountId);
    },

    createWorld: createWorldInternal,

    listWorldsForGame(gameId: string): WorldRecord[] {
      return loadWorlds().filter((w) => w.gameId === gameId);
    },

    getWorld(worldId: string): WorldRecord | undefined {
      return loadWorlds().find((w) => w.id === worldId);
    },

    setWorldRespawnAnchor(worldId: string, anchor: { x: number; y: number; z: number }): void {
      const worlds = loadWorlds();
      const world = worlds.find((w) => w.id === worldId);
      if (!world) return;
      world.respawnAnchor = anchor;
      saveWorlds(worlds);
    },

    /** Thin wrapper over isGameAdmin, resolved through the world's parent game -- WorldRoom.ts's own call site (worldId, not gameId) doesn't need to change. */
    isWorldAdmin(worldId: string, accountId: string | undefined): boolean {
      const world = loadWorlds().find((w) => w.id === worldId);
      if (!world) return false;
      return this.isGameAdmin(world.gameId, accountId);
    },

    /**
     * Real gap found live: nothing could ever remove a game/world/account
     * once created -- including this file's OWN test suite, which (like
     * WorldRoom.test.ts) creates real fixtures against the real store
     * rather than an isolated one, so every test run left more
     * "WorldRoom-test-*" cruft in the actual lobby with no way to clean
     * it up. Real, generally useful functionality either way (a future DM
     * delete-world tool needs exactly this), not added JUST for tests.
     * Cascading: deleting a game also deletes every world inside it (a
     * world can't meaningfully outlive its parent -- there'd be no game
     * left to resolve its admin permissions through).
     */
    deleteAccount(id: string): void {
      saveAccounts(loadAccounts().filter((a) => a.id !== id));
    },

    deleteGame(id: string): void {
      saveGames(loadGames().filter((g) => g.id !== id));
      saveWorlds(loadWorlds().filter((w) => w.gameId !== id));
    },

    deleteWorld(id: string): void {
      saveWorlds(loadWorlds().filter((w) => w.id !== id));
    },
  };
}

export type Store = ReturnType<typeof createStore>;

/** The real process's store, rooted at ./data relative to the server's cwd (matches the Docker volume mount convention already established in docker-compose.yml). */
export const store: Store = createStore(join(process.cwd(), "data"));
