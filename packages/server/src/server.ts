// Room/server config only -- no listen() call here. Split out from main.ts
// specifically so tests can boot() this exact same definition via
// @colyseus/testing without duplicating room registrations, and so
// starting a real process (main.ts) stays a thin wrapper around it.

import { defineServer, defineRoom } from "colyseus";
import { HelloRoom } from "./rooms/HelloRoom.js";

export const server = defineServer({
  rooms: {
    hello: defineRoom(HelloRoom),
  },
});
