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
const getAccounts = createEndpoint("/accounts", { method: "GET", scope: "http" }, async () => {
  return store.listAccounts();
});

const postAccount = createEndpoint("/accounts", { method: "POST", scope: "http" }, async (ctx) => {
  const displayName = typeof ctx.body?.displayName === "string" ? ctx.body.displayName.trim() : "";
  if (!displayName) throw new APIError("BAD_REQUEST", { message: "displayName is required" });
  return store.createAccount(displayName);
});

const getWorlds = createEndpoint("/worlds", { method: "GET", scope: "http" }, async (ctx) => {
  const accountId = typeof ctx.query?.account === "string" ? ctx.query.account : "";
  if (!accountId) throw new APIError("BAD_REQUEST", { message: "account query param is required" });
  return store.listWorldsVisibleTo(accountId);
});

const routes = createRouter({ getAccounts, postAccount, getWorlds });

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
