// Phase 0 scaffolding: proves noa-engine + Babylon.js render inside Vite, and
// that the @ttrpg3d/shared workspace package links and type-checks
// correctly. Real, server-driven terrain starts in Phase 1 -- this is
// deliberately just a flat single-block-type floor so there's something
// visible to confirm rendering actually works.

import { Engine } from "noa-engine";
import type { HelloMessage } from "@ttrpg3d/shared";

// Proves the shared package import resolves and type-checks; Phase 1 will
// use real shared message types for the actual client/server protocol.
const hello: HelloMessage = { text: "ttrpg3d client booted", sentAt: Date.now() };
console.log(hello);

const noa = new Engine({
  debug: true,
  showFPS: true,
  chunkSize: 32,
  chunkAddDistance: 2.5,
  chunkRemoveDistance: 3.5,
});

noa.registry.registerMaterial("dirt", { color: [0.45, 0.36, 0.22] });
const dirtID = noa.registry.registerBlock(1, { material: "dirt" });

// noa's own World class provides no per-event type overloads (it extends
// plain Node EventEmitter) -- param types below are explicit, matching the
// shapes documented in noa's own world.d.ts JSDoc and setChunkData's `any`
// array param, rather than fighting for stricter typing than upstream
// itself provides.
noa.world.on(
  "worldDataNeeded",
  (id: string, data: any, _x: number, y: number, _z: number) => {
    for (let i = 0; i < data.shape[0]; i++) {
      for (let j = 0; j < data.shape[1]; j++) {
        for (let k = 0; k < data.shape[2]; k++) {
          data.set(i, j, k, y + j < 0 ? dirtID : 0);
        }
      }
    }
    noa.world.setChunkData(id, data);
  },
);
