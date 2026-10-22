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
import { DEFAULT_GENERATOR_ID, type GeneratorId, type GeneratorParams, type CharacterSheetTemplate } from "@ttrpg3d/shared";

export interface Account {
  id: string;
  displayName: string;
  role: "root" | "normal";
  createdAt: number;
  /**
   * MVP goal item 4 (docs/ROADMAP.md), slice 1 -- which mods this
   * ACCOUNT has imported, by id, mirroring GameRecord.modIds exactly
   * but keyed on the account instead of a game: real direction,
   * 2026-10-21, "the character sheet page would itself have mods
   * imported as libraries for different functionalities, and those
   * mods would have to be imported to the character page itself per
   * account, NOT site-wide." This is what the standalone, game-free
   * characters page resolves character-sheet templates against (via
   * modLoader.ts's listCharacterSheetTemplates) -- NOT a bare scan of
   * every mod on disk, and NOT gated by any game's own modIds.
   */
  importedModIds: string[];
}

export interface GameRecord {
  id: string;
  name: string;
  ownerAccountId: string;
  adminAccountIds: string[];
  createdAt: number;
  /**
   * MVP goal item 3 (docs/ROADMAP.md) -- which mods this GAME has
   * enabled, by id (mods/modLoader.ts's manifest `id`). Real correction
   * (2026-10-17) after an initial per-WORLD version: "mods for this
   * page... too fine grained... I think they should be per game, not
   * per page." Per-GAME SCOPE, but registration still happens per-WORLD
   * TIMING (at each WorldRoom's onCreate, reading its PARENT game's
   * modIds) -- the "registration happens per-world at WorldRoom
   * instantiation" redesign in docs/PORTING_CHECKLIST.md's Phase 6 is
   * about WHEN registration happens, not which record owns the list; a
   * World's own room is still where voxel-affecting registration would
   * actually run. No hot-reload: toggling takes effect the next time a
   * room for one of this game's worlds is (re)created, not live-pushed
   * to an already-running one -- same precedent as WorldRecord's own
   * respawnAnchor persistence.
   */
  modIds: string[];
  /**
   * GM-only panel (gmPanel.ts): whether players can see through walls
   * in third person (blockShaders.ts's xray-cutout shader). Per-GAME
   * scope, same reasoning as modIds -- a DM-level table policy, not a
   * per-player preference. UNLIKE modIds, this is live-synced via
   * WorldState's own `seeThroughWalls` Schema field (WorldState.ts),
   * not a reload-required setting -- a toggle takes effect on this
   * room's connected clients immediately; it's persisted here only so
   * the next time any of this game's worlds has its room (re)created,
   * it starts with the GM's last choice rather than resetting to the
   * `true` default.
   */
  seeThroughWalls: boolean;
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

export interface StatusEffect {
  icon: string;
  label: string;
}

/**
 * MVP goal items 1-2 (docs/ROADMAP.md): the minimal data contract the
 * 3D token/billboard visuals bind to -- deliberately NOT the full
 * mod-based character-sheet template (that's item 3, later). Owned
 * per-USER (`ownerAccountId`), not per-game -- a character is portable
 * across games by construction, matching the same ownership model
 * Account already has, not Game/World's owner+admin-list shape.
 *
 * `token` is a simple structured value using EXISTING rendering
 * primitives (a plain color), not a model-asset reference -- there's
 * no `.glb`/model-loading pipeline anywhere in this project yet, and
 * `net.ts`'s remote-player boxes / `playerBodyMesh.ts`'s local body are
 * already both the exact same box mesh with nothing but a fixed color
 * varying -- this is a direct, zero-new-infrastructure generalization
 * of that existing convention (and fixes "every remote player looks
 * visually identical" as a side effect), not a new concept.
 */
export interface CharacterRecord {
  id: string;
  ownerAccountId: string;
  name: string;
  token: { color: [number, number, number] };
  statusEffects: StatusEffect[];
  createdAt: number;
  /**
   * MVP goal item 4 (docs/ROADMAP.md) -- which mod this sheet was last
   * CLONED FROM (round 2 real correction: a mod's own
   * `characterSheetTemplate` is only ever a clone source now, not a
   * live, permanent reference -- "not 'this is all you get ever' once
   * the mod is loaded in"). Also doubles as "which mod this sheet
   * depends on as a library" for computeMissingModDependencies, since
   * a cloned page's markdown may still call that mod's
   * `characterSheetLibrary` functions inline. `null` until a template
   * is picked or a blank sheet is started -- a real state, not an
   * error, matching this project's own "a missing selection is a real
   * state" convention (e.g. characterId on a world join).
   */
  templateId: string | null;
  /**
   * The character's OWN editable pages/variables (round 2) -- `null`
   * until the player starts one (blank, or cloned from a mod's
   * template). Once set, this is what's rendered/edited; the mod
   * named by `templateId` is never read again for rendering, only
   * for the dependency check above (its markdown may still call that
   * mod's library functions by name).
   */
  customSheet: CharacterSheetTemplate | null;
  /**
   * Flat map keyed by variable id (customSheet's own variable defs,
   * plus the core RESERVED_BODY_SIZE_VARIABLES ids, which use fixed
   * keys regardless of sheet). Values are read/written as a whole by
   * store.updateCharacterSheet -- no per-variable endpoint.
   */
  variableValues: Record<string, number | string>;
}

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function createStore(baseDir: string) {
  const accountsFile = join(baseDir, "accounts.json");
  const gamesFile = join(baseDir, "games.json");
  const worldsFile = join(baseDir, "worlds.json");
  const charactersFile = join(baseDir, "characters.json");

  function readJson<T>(path: string, fallback: T): T {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  }

  function writeJson(path: string, data: unknown): void {
    mkdirSync(baseDir, { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
  }

  function loadAccounts(): Account[] {
    // importedModIds is new (MVP goal item 4, slice 1) -- same
    // backward-compat default-fill as loadGames() already does for
    // GameRecord.modIds, so a real pre-existing account with no such
    // key on disk doesn't crash the first time anything iterates it.
    return readJson<Account[]>(accountsFile, []).map((a) => ({ ...a, importedModIds: a.importedModIds ?? [] }));
  }

  function saveAccounts(accounts: Account[]): void {
    writeJson(accountsFile, accounts);
  }

  function loadGames(): GameRecord[] {
    // modIds is new (MVP goal item 3) -- a game saved before this field
    // existed has no `modIds` key in its real on-disk JSON at all, so a
    // real stale-data game would otherwise crash the first time
    // anything iterates it (e.g. `for (const id of game.modIds)`).
    // Defaulted here, at the one place every other reader goes through,
    // rather than at each call site.
    return readJson<GameRecord[]>(gamesFile, []).map((g) => ({ ...g, modIds: g.modIds ?? [], seeThroughWalls: g.seeThroughWalls ?? true }));
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

  function loadCharacters(): CharacterRecord[] {
    // templateId/variableValues are new (MVP goal item 4, slice 1) --
    // same backward-compat default-fill spirit as loadAccounts()/
    // loadGames() already use for their own new fields.
    return readJson<CharacterRecord[]>(charactersFile, []).map((c) => ({ ...c, templateId: c.templateId ?? null, customSheet: c.customSheet ?? null, variableValues: c.variableValues ?? {} }));
  }

  function saveCharacters(characters: CharacterRecord[]): void {
    writeJson(charactersFile, characters);
  }

  /** Deterministic, no-two-defaults-look-identical color for an auto-created default character -- real request: picking a character shouldn't be required just to see something other than a flat gray/placeholder box. Not cryptographic, just spread across the color space. */
  function colorFromAccountId(accountId: string): [number, number, number] {
    let hash = 0;
    for (let i = 0; i < accountId.length; i++) hash = (hash * 31 + accountId.charCodeAt(i)) >>> 0;
    return [(hash & 0xff) / 255, ((hash >> 8) & 0xff) / 255, ((hash >> 16) & 0xff) / 255];
  }

  function createCharacterInternal(ownerAccountId: string, name: string, color: [number, number, number]): CharacterRecord {
    const characters = loadCharacters();
    const character: CharacterRecord = {
      id: newId(),
      ownerAccountId,
      name,
      token: { color },
      statusEffects: [],
      createdAt: Date.now(),
      templateId: null,
      customSheet: null,
      variableValues: {},
    };
    characters.push(character);
    saveCharacters(characters);
    return character;
  }

  return {
    /** Seeds a root account + a couple of test accounts/games (one starter DEFAULT_GENERATOR_ID world each) on first boot, if the store is empty. Safe to call every boot -- no-ops once seeded. */
    ensureSeedData(): void {
      let accounts = loadAccounts();
      if (accounts.length === 0) {
        const now = Date.now();
        accounts = [
          { id: "root", displayName: "root", role: "root", createdAt: now, importedModIds: [] },
          { id: "test1", displayName: "Test Account 1", role: "normal", createdAt: now, importedModIds: [] },
          { id: "test2", displayName: "Test Account 2", role: "normal", createdAt: now, importedModIds: [] },
        ];
        saveAccounts(accounts);
      }

      let games = loadGames();
      if (games.length === 0) {
        const now = Date.now();
        games = [
          { id: newId(), name: "Root's Game", ownerAccountId: "root", adminAccountIds: [], createdAt: now, modIds: [], seeThroughWalls: true },
          { id: newId(), name: "Test1's Game", ownerAccountId: "test1", adminAccountIds: [], createdAt: now, modIds: [], seeThroughWalls: true },
        ];
        saveGames(games);
        for (const game of games) {
          createWorldInternal(game.id, "Starting World", DEFAULT_GENERATOR_ID, {});
        }
      }

      // MVP goal item 1 (docs/ROADMAP.md): dev/test convenience only --
      // mirrors the accounts/games/worlds blocks above, NOT a precedent
      // for createAccount itself (confirmed directly: real account
      // creation already doesn't auto-seed a starter Game/World either,
      // so a real new account getting no starter Character either is
      // consistent, not a gap).
      if (loadCharacters().length === 0) {
        createCharacterInternal("root", "Root's Character", [0.8, 0.2, 0.2]);
        createCharacterInternal("test1", "Test1's Character", [0.2, 0.5, 0.8]);
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
      const account: Account = { id: newId(), displayName, role: "normal", createdAt: Date.now(), importedModIds: [] };
      accounts.push(account);
      saveAccounts(accounts);
      return account;
    },

    /** No-op if already imported or the account id is unknown, same "stale id, not a crash" spirit as enableModForGame. Ungated here (an account manages its own imports) -- same trust level the existing /accounts/:id/characters endpoints already use. */
    importModForAccount(accountId: string, modId: string): void {
      const accounts = loadAccounts();
      const account = accounts.find((a) => a.id === accountId);
      if (!account) return;
      if (!account.importedModIds.includes(modId)) account.importedModIds.push(modId);
      saveAccounts(accounts);
    },

    removeModForAccount(accountId: string, modId: string): void {
      const accounts = loadAccounts();
      const account = accounts.find((a) => a.id === accountId);
      if (!account) return;
      account.importedModIds = account.importedModIds.filter((id) => id !== modId);
      saveAccounts(accounts);
    },

    createGame(name: string, ownerAccountId: string): GameRecord {
      const games = loadGames();
      const game: GameRecord = { id: newId(), name, ownerAccountId, adminAccountIds: [], createdAt: Date.now(), modIds: [], seeThroughWalls: true };
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

    /** No-op if already enabled or the game id is unknown, same "stale id, not a crash" spirit as setWorldRespawnAnchor. Admin-gating happens at the caller (server.ts), same split that function already uses. Per-GAME, not per-world -- real correction, see GameRecord.modIds's own doc. */
    enableModForGame(gameId: string, modId: string): void {
      const games = loadGames();
      const game = games.find((g) => g.id === gameId);
      if (!game) return;
      if (!game.modIds.includes(modId)) game.modIds.push(modId);
      saveGames(games);
    },

    disableModForGame(gameId: string, modId: string): void {
      const games = loadGames();
      const game = games.find((g) => g.id === gameId);
      if (!game) return;
      game.modIds = game.modIds.filter((id) => id !== modId);
      saveGames(games);
    },

    /** No-op if the game id is unknown, same spirit as enableModForGame/setWorldRespawnAnchor. Admin-gating happens at the caller (WorldRoom.ts's "setSeeThroughWalls" message handler), same split those functions already use. */
    setSeeThroughWallsForGame(gameId: string, enabled: boolean): void {
      const games = loadGames();
      const game = games.find((g) => g.id === gameId);
      if (!game) return;
      game.seeThroughWalls = enabled;
      saveGames(games);
    },

    /** Thin wrapper over isGameAdmin, resolved through the world's parent game -- WorldRoom.ts's own call site (worldId, not gameId) doesn't need to change. */
    isWorldAdmin(worldId: string, accountId: string | undefined): boolean {
      const world = loadWorlds().find((w) => w.id === worldId);
      if (!world) return false;
      return this.isGameAdmin(world.gameId, accountId);
    },

    createCharacter: createCharacterInternal,

    listCharactersForAccount(ownerAccountId: string): CharacterRecord[] {
      return loadCharacters().filter((c) => c.ownerAccountId === ownerAccountId);
    },

    getCharacter(id: string): CharacterRecord | undefined {
      return loadCharacters().find((c) => c.id === id);
    },

    /** MVP goal item 4 (docs/ROADMAP.md) -- replaces templateId/customSheet/variableValues wholesale (no per-field endpoint). No-op if the character id is unknown. Ownership-gating (is the caller actually this character's owner) happens at the caller (server.ts's PUT /characters/:id/sheet), same split enableModForGame/setRespawnAnchor already use. */
    updateCharacterSheet(characterId: string, templateId: string | null, customSheet: CharacterSheetTemplate | null, variableValues: Record<string, number | string>): void {
      const characters = loadCharacters();
      const character = characters.find((c) => c.id === characterId);
      if (!character) return;
      character.templateId = templateId;
      character.customSheet = customSheet;
      character.variableValues = variableValues;
      saveCharacters(characters);
    },

    /**
     * Real request: a characterless join shouldn't be a dead end requiring
     * a trip through the lobby's create-character form first -- WorldRoom.ts/
     * GameRoom.ts's onJoin calls this whenever a join's characterId is
     * missing or unknown. Returns the account's OLDEST character if it has
     * one (stable choice across repeated joins, not "whichever happens to
     * be first in an unordered list"), auto-creating one if the account
     * has none yet -- covers a brand-new account, AND an account that just
     * deleted its last character (the very next join recreates a default,
     * per the explicit request: "deleting them just makes another
     * default"). Returns undefined only if accountId itself doesn't
     * resolve to a real account (an anonymous/no-account join truly has
     * nothing to default to -- not this function's problem to invent an
     * owner for).
     */
    getDefaultCharacterForAccount(accountId: string): CharacterRecord | undefined {
      const existing = loadCharacters()
        .filter((c) => c.ownerAccountId === accountId)
        .sort((a, b) => a.createdAt - b.createdAt);
      if (existing[0]) return existing[0];

      const account = loadAccounts().find((a) => a.id === accountId);
      if (!account) return undefined;
      return createCharacterInternal(accountId, `${account.displayName}'s Character`, colorFromAccountId(accountId));
    },

    /** The click-to-edit write-back (WorldRoom's setCharacterVariableValue handler) -- writes ONE key into variableValues, never the whole record, so an admin/self edit can't accidentally clobber name/token/statusEffects/customSheet. Generalizes the old hp/maxHp/mp/maxMp-specific updateCharacterStats now that bars (and any other in-game-editable value) point at arbitrary sheet variables instead of fixed fields. No-op for an unknown id, same "stale id, not a crash" spirit as setWorldRespawnAnchor. */
    updateCharacterVariableValue(id: string, variableId: string, value: number): void {
      const characters = loadCharacters();
      const character = characters.find((c) => c.id === id);
      if (!character) return;
      character.variableValues = { ...character.variableValues, [variableId]: value };
      saveCharacters(characters);
    },

    setCharacterStatusEffects(id: string, statusEffects: StatusEffect[]): void {
      const characters = loadCharacters();
      const character = characters.find((c) => c.id === id);
      if (!character) return;
      character.statusEffects = statusEffects;
      saveCharacters(characters);
    },

    /** Backs the "Edit token properties" context-menu item -- same shape/no-op-safe spirit as updateCharacterStats above, just the token color instead of a stat. */
    setCharacterToken(id: string, color: [number, number, number]): void {
      const characters = loadCharacters();
      const character = characters.find((c) => c.id === id);
      if (!character) return;
      character.token = { color };
      saveCharacters(characters);
    },

    deleteCharacter(id: string): void {
      saveCharacters(loadCharacters().filter((c) => c.id !== id));
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
     * left to resolve its admin permissions through). deleteAccount now
     * cascades to that account's own characters too (a character can't
     * meaningfully outlive its owner, same reasoning) -- closing a
     * pre-existing gap found while adding CharacterRecord: deleteAccount
     * never cascaded to that account's OWN games/worlds either, a real
     * leftover-orphan gap this didn't introduce and isn't the place to
     * fix (unrelated to characters, would need its own look at whether
     * an account's games should really vanish with it or be reassigned).
     */
    deleteAccount(id: string): void {
      saveAccounts(loadAccounts().filter((a) => a.id !== id));
      saveCharacters(loadCharacters().filter((c) => c.ownerAccountId !== id));
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
