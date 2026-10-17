// Room/server config only -- no listen() call here. Split out from main.ts
// specifically so tests can boot() this exact same definition via
// @colyseus/testing without duplicating room registrations, and so
// starting a real process (main.ts) stays a thin wrapper around it.

import { defineServer, defineRoom, createEndpoint, createRouter } from "colyseus";
import { APIError } from "@colyseus/better-call";
import { HelloRoom } from "./rooms/HelloRoom.js";
import { WorldRoom } from "./rooms/WorldRoom.js";
import { GameRoom } from "./rooms/GameRoom.js";
import { store } from "./data/store.js";
import { createChatStorage } from "./chat/chatStorage.js";
import { listAvailableMods } from "./mods/modLoader.js";
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

const routes = createRouter({
  getAccounts,
  postAccount,
  getAccountCharacters,
  postAccountCharacter,
  getGames,
  postGame,
  getGameWorlds,
  postGameWorld,
  getGameChat,
  getMods,
  getGameMods,
  postGameMod,
  deleteGameMod,
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
