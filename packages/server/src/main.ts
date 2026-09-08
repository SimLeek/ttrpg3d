// Phase 0 scaffolding: bare Colyseus server, one hello-world room. Real
// per-world rooms (WorldRoom, matching WorldManager's world = room mapping)
// land in Phase 1/3 per the migration plan.

import { defineServer, defineRoom } from "colyseus";
import { HelloRoom } from "./rooms/HelloRoom.js";

const port = Number(process.env.PORT) || 2567;

const server = defineServer({
  rooms: {
    hello: defineRoom(HelloRoom),
  },
});

server.listen(port);
console.log(`[ttrpg3d server] listening on ws://localhost:${port}`);
