// Real process entry point -- thin wrapper around server.ts's room/server
// config, which is what actually gets exercised (via @colyseus/testing) by
// this package's tests.

import { server } from "./server.js";

const port = Number(process.env.PORT) || 2567;

server.listen(port);
console.log(`[ttrpg3d server] listening on ws://localhost:${port}`);
