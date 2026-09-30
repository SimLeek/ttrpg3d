// Phase 2: the first real playable slice. Connects to the server's "world"
// room, streams the test-area terrain as chunks, and drives movement with a
// ported version of the old game's tuned speed/jump/fall systems -- see
// movement/PlayerController.ts for what's in scope this phase (walk/sprint/
// jump/coyote-time/fall) vs. deferred (wall-kick/ledge-safety/stair-
// stepping, see docs/PORTING_CHECKLIST.md). Floating-origin shifting is
// noa-engine's own built-in behavior (see originShiftLogger.ts) -- this
// file's job for that piece is just the test area's marker-pillar block and
// wiring up the console log.

import { Engine } from "noa-engine";
import { CHUNK_SIZE } from "@ttrpg3d/shared";
import { connectAndStreamWorld } from "./net.js";
import { installPlayerController } from "./movement/PlayerController.js";
import { installOriginShiftLogger } from "./originShiftLogger.js";

// Matches testArea.ts's spawnPosition() exactly (AREA_SIZE/2, FLOOR_TOP+3,
// AREA_SIZE/2) -- avoids the player rendering somewhere wrong for the one
// tick before the server's own spawn position round-trips back.
const SPAWN: [number, number, number] = [24, 5, 24];

const noa = new Engine({
  debug: true,
  showFPS: true,
  chunkSize: CHUNK_SIZE,
  chunkAddDistance: 2.5,
  chunkRemoveDistance: 3.5,
  playerStart: SPAWN,
  // Closer to Godot's typical 60Hz physics step than noa's own 30Hz
  // default -- the ported movement constants (speed/friction-as-max-delta)
  // were tuned against that, and matching tick rate avoids having to
  // retune them just because the engine changed.
  tickRate: 60,
  // Matches the old repo's center_of_universe.gd threshold (128) closely
  // enough in spirit -- rebase a bit more eagerly than noa's own default
  // (25) is fine; smaller/more-frequent shifts are cheaper to verify during
  // the Phase 2 playtest than rare/large ones.
  originRebaseDistance: 40,
});

noa.registry.registerMaterial("ground", { color: [0.45, 0.36, 0.22] });
noa.registry.registerMaterial("marker", { color: [1.0, 0.1, 0.8] });
noa.registry.registerBlock(1, { material: "ground" });
noa.registry.registerBlock(2, { material: "marker" });

installPlayerController(noa);
installOriginShiftLogger(noa);

const serverUrl = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_SERVER_URL ?? "ws://localhost:2567";
const playerName = `Player-${Math.floor(Math.random() * 10000)}`;

connectAndStreamWorld(noa, serverUrl, playerName).catch((err) => {
  console.error("[net] failed to connect to world server:", err);
});
