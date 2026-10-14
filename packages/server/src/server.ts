// Room/server config only -- no listen() call here. Split out from main.ts
// specifically so tests can boot() this exact same definition via
// @colyseus/testing without duplicating room registrations, and so
// starting a real process (main.ts) stays a thin wrapper around it.

import { defineServer, defineRoom, createEndpoint, createRouter } from "colyseus";
import { APIError } from "@colyseus/better-call";
import { HelloRoom } from "./rooms/HelloRoom.js";
import { WorldRoom } from "./rooms/WorldRoom.js";
import { store } from "./data/store.js";

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

const routes = createRouter({ getAccounts, postAccount, getGames, postGame, getGameWorlds, postGameWorld });

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
  },
  routes,
});
