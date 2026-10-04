// Accounts + worlds registry (metadata only -- see docs/PORTING_CHECKLIST.md
// and the "Worlds lobby page" section of the architecture plan for why this
// is intentionally NOT full per-world voxel storage yet, that's Phase 4).
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
// can admin every world without an explicit grant row.
//
// Pure, non-3D/non-physics logic -- this is exactly the kind of thing that
// should have real unit tests (see store.test.ts), unlike the client's
// movement/physics code which gets verified by actual playtesting instead.
// Factored as createStore(baseDir) rather than module-level state
// specifically so tests can point it at an isolated temp directory instead
// of this process's real `data/`.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Account {
  id: string;
  displayName: string;
  role: "root" | "normal";
  createdAt: number;
}

export interface WorldRecord {
  id: string;
  name: string;
  ownerAccountId: string;
  adminAccountIds: string[];
  createdAt: number;
}

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function createStore(baseDir: string) {
  const accountsFile = join(baseDir, "accounts.json");
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

  function loadWorlds(): WorldRecord[] {
    return readJson<WorldRecord[]>(worldsFile, []);
  }

  function saveWorlds(worlds: WorldRecord[]): void {
    writeJson(worldsFile, worlds);
  }

  return {
    /** Seeds a root account + a couple of test accounts/worlds on first boot, if the store is empty. Safe to call every boot -- no-ops once seeded. */
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

      let worlds = loadWorlds();
      if (worlds.length === 0) {
        const now = Date.now();
        worlds = [
          { id: newId(), name: "Root's Test World", ownerAccountId: "root", adminAccountIds: [], createdAt: now },
          { id: newId(), name: "Test1's Sandbox", ownerAccountId: "test1", adminAccountIds: [], createdAt: now },
        ];
        saveWorlds(worlds);
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

    createWorld(name: string, ownerAccountId: string): WorldRecord {
      const worlds = loadWorlds();
      const world: WorldRecord = { id: newId(), name, ownerAccountId, adminAccountIds: [], createdAt: Date.now() };
      worlds.push(world);
      saveWorlds(worlds);
      return world;
    },

    grantAdmin(worldId: string, accountId: string): void {
      const worlds = loadWorlds();
      const world = worlds.find((w) => w.id === worldId);
      if (world && !world.adminAccountIds.includes(accountId)) {
        world.adminAccountIds.push(accountId);
        saveWorlds(worlds);
      }
    },

    /** Worlds visible to this account: owner, granted admin, or root's implicit superuser access. */
    listWorldsVisibleTo(accountId: string): WorldRecord[] {
      const account = loadAccounts().find((a) => a.id === accountId);
      if (!account) return [];
      const worlds = loadWorlds();
      if (account.role === "root") return worlds;
      return worlds.filter((w) => w.ownerAccountId === accountId || w.adminAccountIds.includes(accountId));
    },
  };
}

export type Store = ReturnType<typeof createStore>;

/** The real process's store, rooted at ./data relative to the server's cwd (matches the Docker volume mount convention already established in docker-compose.yml). */
export const store: Store = createStore(join(process.cwd(), "data"));
