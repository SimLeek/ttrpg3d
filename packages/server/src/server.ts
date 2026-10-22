// Room/server config only -- no listen() call here. Split out from main.ts
// specifically so tests can boot() this exact same definition via
// @colyseus/testing without duplicating room registrations, and so
// starting a real process (main.ts) stays a thin wrapper around it.

import { defineServer, defineRoom, createEndpoint, createRouter } from "colyseus";
import { APIError } from "@colyseus/better-call";
import { HelloRoom } from "./rooms/HelloRoom.js";
import { WorldRoom, notifyCharacterSheetChanged } from "./rooms/WorldRoom.js";
import { GameRoom } from "./rooms/GameRoom.js";
import { store } from "./data/store.js";
import { createChatStorage } from "./chat/chatStorage.js";
import { listAvailableMods, listCharacterSheetTemplates, listCharacterSheetLibraries, resolveCharacterSheetMarkdown } from "./mods/modLoader.js";
import { findLibraryCalls } from "@ttrpg3d/shared";
import { join } from "node:path";

store.ensureSeedData();

// Worlds lobby page's REST surface -- the server otherwise has no HTTP
// endpoints at all, pure Colyseus rooms/WebSocket. `defineServer`/
// `defineRoom` come from @colyseus/core (re-exported via the "colyseus"
// meta-package), which routes plain HTTP through its own
// createEndpoint/createRouter (backed by @colyseus/better-call) rather than
// Express directly -- @colyseus/tools's Express-flavored `initializeExpress`
// hook only applies to its own `listen()` bootstrap helper, which this
// project doesn't use (checked both .d.ts's directly rather than guessing).
// scope: "http" -- these aren't meant to be invokable as Colyseus RPC
// actions from a connected room client, just plain REST endpoints.
//
// Games-and-world-generators PR: the lobby now lists/creates GAMES (the
// roll20-"campaign" concept), not worlds directly -- worlds (roll20
// "pages") are created/switched from an in-game UI once inside a game
// (pageManager.ts), via the new /games/:id/worlds endpoints below. This
// is also the first real "create" flow either concept has ever had --
// confirmed directly, no such endpoint existed before this PR.
const getAccounts = createEndpoint("/accounts", { method: "GET", scope: "http" }, async () => {
  return store.listAccounts();
});

const postAccount = createEndpoint("/accounts", { method: "POST", scope: "http" }, async (ctx) => {
  const displayName = typeof ctx.body?.displayName === "string" ? ctx.body.displayName.trim() : "";
  if (!displayName) throw new APIError("BAD_REQUEST", { message: "displayName is required" });
  return store.createAccount(displayName);
});

// Minimal character record (MVP goal items 1-2, docs/ROADMAP.md) --
// enough for the lobby's character dropdown + create form; full
// authoring is item 3, later. Same trust level as getGameWorlds/
// getGameChat above (no admin gate -- a client that already knows an
// accountId can list/create its own characters).
const getAccountCharacters = createEndpoint("/accounts/:id/characters", { method: "GET", scope: "http" }, async (ctx) => {
  return store.listCharactersForAccount(ctx.params.id);
});

const postAccountCharacter = createEndpoint("/accounts/:id/characters", { method: "POST", scope: "http" }, async (ctx) => {
  const ownerAccountId = ctx.params.id;
  const name = typeof ctx.body?.name === "string" ? ctx.body.name.trim() : "";
  if (!name) throw new APIError("BAD_REQUEST", { message: "name is required" });
  const color = ctx.body?.color;
  if (!Array.isArray(color) || color.length !== 3 || !color.every((c) => typeof c === "number")) {
    throw new APIError("BAD_REQUEST", { message: "color must be an [r,g,b] number triple" });
  }
  return store.createCharacter(ownerAccountId, name, color as [number, number, number]);
});

// MVP goal item 4 (docs/ROADMAP.md), slice 1 -- an account's own
// imported mods, which character-sheet templates (and future library
// mods) get resolved against on the standalone, game-free characters
// page. Ungated, same trust level as getAccountCharacters/
// postAccountCharacter above -- an account manages its own imports,
// not a game-scoped admin decision like postGameMod's isGameAdmin check.
const getAccountMods = createEndpoint("/accounts/:id/mods", { method: "GET", scope: "http" }, async (ctx) => {
  return store.getAccount(ctx.params.id)?.importedModIds ?? [];
});

const postAccountMod = createEndpoint("/accounts/:id/mods", { method: "POST", scope: "http" }, async (ctx) => {
  const accountId = ctx.params.id;
  const modId = typeof ctx.body?.modId === "string" ? ctx.body.modId : "";
  if (!modId) throw new APIError("BAD_REQUEST", { message: "modId is required" });
  store.importModForAccount(accountId, modId);
  return store.getAccount(accountId)?.importedModIds ?? [];
});

const deleteAccountMod = createEndpoint("/accounts/:id/mods/:modId", { method: "DELETE", scope: "http" }, async (ctx) => {
  const accountId = ctx.params.id;
  store.removeModForAccount(accountId, ctx.params.modId);
  return store.getAccount(accountId)?.importedModIds ?? [];
});

// Catalog of character-sheet templates this account can actually pick
// from -- scoped to its OWN importedModIds, not every mod on disk
// (getMods below) and not any game's modIds.
const getAccountCharacterSheetTemplates = createEndpoint("/accounts/:id/character-sheet-templates", { method: "GET", scope: "http" }, async (ctx) => {
  const account = store.getAccount(ctx.params.id);
  if (!account) return [];
  return listCharacterSheetTemplates(join(process.cwd(), "mods"), account.importedModIds);
});

// MVP goal item 4, round 5 -- "gotta make it so we actually know what
// the mod library names are, because right now there's no way to
// tell." Same scope/trust level as getAccountCharacterSheetTemplates
// above. A library's actual FUNCTIONS can't cross JSON (they'd just
// silently vanish from the response) -- only their NAMES are useful
// to a "what can I call" listing anyway, so that's all this maps to.
const getAccountCharacterSheetLibraries = createEndpoint("/accounts/:id/character-sheet-libraries", { method: "GET", scope: "http" }, async (ctx) => {
  const account = store.getAccount(ctx.params.id);
  if (!account) return [];
  const libraries = await listCharacterSheetLibraries(join(process.cwd(), "mods"), account.importedModIds);
  return libraries.map(({ modId, manifest, library }) => ({ modId, manifest, functionNames: Object.keys(library) }));
});

// Sets a character's template + variable values wholesale. Ownership-
// gated (the caller must actually own this character) -- a NEW gate
// shape, not isGameAdmin, since no game is involved at all; same
// "checked fresh against the store, never trusted blindly" spirit
// every other gate in this file already uses.
const putCharacterSheet = createEndpoint("/characters/:id/sheet", { method: "PUT", scope: "http" }, async (ctx) => {
  const characterId = ctx.params.id;
  const character = store.getCharacter(characterId);
  if (!character) throw new APIError("NOT_FOUND", { message: "no such character" });
  const accountId = typeof ctx.body?.accountId === "string" ? ctx.body.accountId : "";
  // Real correction (MVP goal item 4 follow-up, "characters" tab): a
  // game admin can now edit a character they don't own too, once it's
  // linked into one of their games -- not just the character's own
  // owner.
  if (accountId !== character.ownerAccountId && !store.canAccountEditCharacter(accountId, characterId)) throw new APIError("UNAUTHORIZED", { message: "not this character's owner or an admin of a game it's linked to" });
  const templateId = typeof ctx.body?.templateId === "string" ? ctx.body.templateId : null;
  const customSheet = typeof ctx.body?.customSheet === "object" && ctx.body.customSheet !== null ? ctx.body.customSheet : null;
  const variableValues = typeof ctx.body?.variableValues === "object" && ctx.body.variableValues !== null ? ctx.body.variableValues : {};
  store.updateCharacterSheet(characterId, templateId, customSheet, variableValues);
  // Real bug found live: this REST write has no way to reach a LIVE
  // WorldRoom session for this same character on its own -- the
  // standalone characters page, the in-game popup, and the pop-out
  // window all go through here, none of them have a WorldRoom
  // connection at all. Without this, a character's billboard bars sat
  // stale in-game until some UNRELATED room message happened to
  // trigger a refresh. See notifyCharacterSheetChanged's own doc.
  notifyCharacterSheetChanged(characterId);
  return store.getCharacter(characterId);
});

// Fetches a single character by id for a viewer who doesn't necessarily
// own it (fetchCharactersForAccount is scoped to one account's OWN
// characters only) -- backs the in-game character-sheet popup/popout.
// `canEdit` is computed server-side (store.canAccountEditCharacter) so
// the client never has to re-implement the admin/ownership check.
const getCharacter = createEndpoint("/characters/:id", { method: "GET", scope: "http" }, async (ctx) => {
  const characterId = ctx.params.id;
  const character = store.getCharacter(characterId);
  if (!character) throw new APIError("NOT_FOUND", { message: "no such character" });
  const viewerAccountId = typeof ctx.query?.viewerAccountId === "string" ? ctx.query.viewerAccountId : "";
  if (!store.canAccountViewCharacter(viewerAccountId, characterId)) throw new APIError("UNAUTHORIZED", { message: "not permitted to view this character" });
  return { character, canEdit: viewerAccountId === character.ownerAccountId || store.canAccountEditCharacter(viewerAccountId, characterId) };
});

// Live-preview resolution of a sheet page's `{{modId.fn(args)}}` calls
// (findLibraryCalls/resolveCharacterSheetMarkdown) against the
// ACCOUNT's own importedModIds -- a mod not imported is treated as
// missing even if it exists on disk (see resolveCharacterSheetMarkdown's
// own doc). Markdown parsing itself stays client-side (characters.ts's
// existing marked+DOMPurify pipeline); only library-call resolution
// needs this round trip, since a mod's real function body is
// server-side Node code with no way to ship it to the browser.
const postCharacterSheetPreview = createEndpoint("/accounts/:id/character-sheet-preview", { method: "POST", scope: "http" }, async (ctx) => {
  const account = store.getAccount(ctx.params.id);
  if (!account) throw new APIError("NOT_FOUND", { message: "no such account" });
  const markdown = typeof ctx.body?.markdown === "string" ? ctx.body.markdown : "";
  const variableValues = typeof ctx.body?.variableValues === "object" && ctx.body.variableValues !== null ? ctx.body.variableValues : {};
  const modsDir = join(process.cwd(), "mods");
  const resolvedMarkdown = await resolveCharacterSheetMarkdown(modsDir, account.importedModIds, markdown, variableValues);
  // MVP goal item 4, round 3 -- per-segment resolved values too (not
  // just the flattened text), so the client can render each call as a
  // clickable "roll chip" (characters.ts's test chat panel) instead of
  // plain substituted text. Reuses resolveCharacterSheetMarkdown
  // unchanged -- just called once per segment's own substring rather
  // than once for the whole text, zero new resolution logic.
  const callSegments = findLibraryCalls(markdown);
  const segments = await Promise.all(
    callSegments.map(async (segment) => ({
      ...segment,
      value: await resolveCharacterSheetMarkdown(modsDir, account.importedModIds, markdown.slice(segment.start, segment.end), variableValues),
    })),
  );
  return { resolvedMarkdown, segments };
});

const getGames = createEndpoint("/games", { method: "GET", scope: "http" }, async (ctx) => {
  const accountId = typeof ctx.query?.account === "string" ? ctx.query.account : "";
  if (!accountId) throw new APIError("BAD_REQUEST", { message: "account query param is required" });
  return store.listGamesVisibleTo(accountId);
});

const postGame = createEndpoint("/games", { method: "POST", scope: "http" }, async (ctx) => {
  const name = typeof ctx.body?.name === "string" ? ctx.body.name.trim() : "";
  const ownerAccountId = typeof ctx.body?.ownerAccountId === "string" ? ctx.body.ownerAccountId : "";
  if (!name) throw new APIError("BAD_REQUEST", { message: "name is required" });
  if (!ownerAccountId) throw new APIError("BAD_REQUEST", { message: "ownerAccountId is required" });
  return store.createGame(name, ownerAccountId);
});

const getGameWorlds = createEndpoint("/games/:id/worlds", { method: "GET", scope: "http" }, async (ctx) => {
  return store.listWorldsForGame(ctx.params.id);
});

const postGameWorld = createEndpoint("/games/:id/worlds", { method: "POST", scope: "http" }, async (ctx) => {
  const gameId = ctx.params.id;
  const accountId = typeof ctx.body?.accountId === "string" ? ctx.body.accountId : "";
  if (!store.isGameAdmin(gameId, accountId)) throw new APIError("UNAUTHORIZED", { message: "not an admin of this game" });
  const name = typeof ctx.body?.name === "string" ? ctx.body.name.trim() : "";
  const generatorId = typeof ctx.body?.generatorId === "string" ? ctx.body.generatorId : "";
  if (!name) throw new APIError("BAD_REQUEST", { message: "name is required" });
  if (generatorId !== "hilly" && generatorId !== "plains" && generatorId !== "limestone_slab") {
    throw new APIError("BAD_REQUEST", { message: "generatorId must be hilly, plains, or limestone_slab" });
  }
  const params = typeof ctx.body?.params === "object" && ctx.body.params !== null ? ctx.body.params : {};
  return store.createWorld(gameId, name, generatorId, params);
});

// Chat scrollback -- reads only (sends only ever go through the live
// GameRoom's "chatSend" message, never REST, so there's exactly one
// place chat text is ever evaluated). Same trust level as
// getGameWorlds above (no admin/account gate) -- a client that already
// knows a gameId can list its worlds with no check today, and reading
// its chat history is no more sensitive than that. Opens its own
// ChatStorage handle per request rather than keeping one open
// long-term (node:sqlite supports concurrent readers against the same
// file -- this and a live GameRoom instance can both have it open at
// once) and closes it before returning, so a burst of scrollback
// requests can't leak file handles.
const getGameChat = createEndpoint("/games/:id/chat", { method: "GET", scope: "http" }, async (ctx) => {
  const limit = Math.min(Number(ctx.query?.limit) || 50, 200);
  const beforeId = typeof ctx.query?.before === "string" ? Number(ctx.query.before) : undefined;
  const storage = createChatStorage(join(process.cwd(), "data", "chat"), ctx.params.id);
  try {
    return beforeId !== undefined ? storage.before(beforeId, limit) : storage.recent(limit);
  } finally {
    storage.close();
  }
});

// MVP goal item 3 (docs/ROADMAP.md): the REST surface chatPanel.ts's
// Settings tab (via main.ts) and a script test both call directly.
// Per-GAME, not per-world -- real correction (see GameRecord.modIds's
// own doc in store.ts); admin-gated via store.isGameAdmin, same
// pattern postGameWorld already uses for its own game-scoped check.
const getMods = createEndpoint("/mods", { method: "GET", scope: "http" }, async () => {
  return listAvailableMods(join(process.cwd(), "mods"));
});

const getGameMods = createEndpoint("/games/:id/mods", { method: "GET", scope: "http" }, async (ctx) => {
  return store.getGame(ctx.params.id)?.modIds ?? [];
});

const postGameMod = createEndpoint("/games/:id/mods", { method: "POST", scope: "http" }, async (ctx) => {
  const gameId = ctx.params.id;
  const accountId = typeof ctx.body?.accountId === "string" ? ctx.body.accountId : "";
  if (!store.isGameAdmin(gameId, accountId)) throw new APIError("UNAUTHORIZED", { message: "not an admin of this game" });
  const modId = typeof ctx.body?.modId === "string" ? ctx.body.modId : "";
  if (!modId) throw new APIError("BAD_REQUEST", { message: "modId is required" });
  store.enableModForGame(gameId, modId);
  return store.getGame(gameId)?.modIds ?? [];
});

const deleteGameMod = createEndpoint("/games/:id/mods/:modId", { method: "DELETE", scope: "http" }, async (ctx) => {
  const gameId = ctx.params.id;
  const accountId = typeof ctx.query?.accountId === "string" ? ctx.query.accountId : "";
  if (!store.isGameAdmin(gameId, accountId)) throw new APIError("UNAUTHORIZED", { message: "not an admin of this game" });
  store.disableModForGame(gameId, ctx.params.modId);
  return store.getGame(gameId)?.modIds ?? [];
});

// ---- game<->character links ("Characters" tab) -- many-to-many, with
// optional folders. Self-service by design: an account can link its
// OWN character to any game it knows the id of; only a game admin can
// manage (folder/visibility/unlink) a link for a character it doesn't
// own -- gating lives in store.ts (same shape every linking method
// shares), this file just surfaces it over HTTP.

const getGameCharacters = createEndpoint("/games/:id/characters", { method: "GET", scope: "http" }, async (ctx) => {
  const accountId = typeof ctx.query?.accountId === "string" ? ctx.query.accountId : "";
  return store.listVisibleCharactersForGameAndAccount(ctx.params.id, accountId);
});

const postGameCharacter = createEndpoint("/games/:id/characters", { method: "POST", scope: "http" }, async (ctx) => {
  const gameId = ctx.params.id;
  const accountId = typeof ctx.body?.accountId === "string" ? ctx.body.accountId : "";
  const characterId = typeof ctx.body?.characterId === "string" ? ctx.body.characterId : "";
  if (!characterId) throw new APIError("BAD_REQUEST", { message: "characterId is required" });
  const folder = typeof ctx.body?.folder === "string" ? ctx.body.folder : null;
  store.linkCharacterToGame(gameId, characterId, accountId, folder);
  return store.listVisibleCharactersForGameAndAccount(gameId, accountId);
});

const patchGameCharacter = createEndpoint("/games/:id/characters/:characterId", { method: "PATCH", scope: "http" }, async (ctx) => {
  const gameId = ctx.params.id;
  const accountId = typeof ctx.body?.accountId === "string" ? ctx.body.accountId : "";
  const folder = typeof ctx.body?.folder === "string" || ctx.body?.folder === null ? ctx.body.folder : undefined;
  const visibility = ctx.body?.visibility === "all" || Array.isArray(ctx.body?.visibility) ? ctx.body.visibility : undefined;
  store.updateGameCharacterLink(gameId, ctx.params.characterId, accountId, { folder, visibility });
  return store.listVisibleCharactersForGameAndAccount(gameId, accountId);
});

const deleteGameCharacter = createEndpoint("/games/:id/characters/:characterId", { method: "DELETE", scope: "http" }, async (ctx) => {
  const gameId = ctx.params.id;
  const accountId = typeof ctx.query?.accountId === "string" ? ctx.query.accountId : "";
  store.unlinkCharacterFromGame(gameId, ctx.params.characterId, accountId);
  return store.listVisibleCharactersForGameAndAccount(gameId, accountId);
});

const routes = createRouter({
  getAccounts,
  postAccount,
  getAccountCharacters,
  postAccountCharacter,
  getAccountMods,
  postAccountMod,
  deleteAccountMod,
  getAccountCharacterSheetTemplates,
  getAccountCharacterSheetLibraries,
  putCharacterSheet,
  getCharacter,
  postCharacterSheetPreview,
  getGames,
  postGame,
  getGameWorlds,
  postGameWorld,
  getGameChat,
  getMods,
  getGameMods,
  postGameMod,
  deleteGameMod,
  getGameCharacters,
  postGameCharacter,
  patchGameCharacter,
  deleteGameCharacter,
});

export const server = defineServer({
  rooms: {
    hello: defineRoom(HelloRoom),
    // filterBy(['worldId']) tells Colyseus's matchmaker that different
    // worldIds need different room instances -- without it, joinOrCreate
    // would put every player into the SAME "world" room regardless of
    // which world they picked in the lobby, since Colyseus otherwise just
    // reuses any existing room of that name. Matches the architecture
    // plan's "instantiated on first join with {worldId}" room-per-world
    // design.
    world: defineRoom(WorldRoom).filterBy(["worldId"]),
    // Same filterBy reasoning, scoped one level up: one GameRoom instance
    // per Game (not per World/page), so chat survives this project's
    // existing per-page stop()+startGame() client teardown/rebuild cycle
    // instead of reconnecting/flickering on every page switch.
    game: defineRoom(GameRoom).filterBy(["gameId"]),
  },
  routes,
});
