// The actual 3D game view -- this is what used to be the entire content of
// main.ts before the worlds lobby page existed. Now it's a function the
// router calls once an account has picked a world to play, instead of
// running immediately on page load.
//
// `worldId` IS sent to the server now (as a room-creation option, matched
// against WorldRoom.filterBy(['worldId']) in server.ts) so different
// worlds get different room instances -- and testArea.ts's generator now
// varies a small region near spawn by worldId too, since two different
// worlds looked completely identical in practice (confirmed live,
// "impossible to tell which I'm in"). An on-screen label was tried first
// and explicitly rejected in favor of real, lookable-at terrain
// differences -- see testArea.ts's variant-region comment for that part.
// This file's only remaining job for it is a console log, not UI.

import { Engine } from "noa-engine";
import { CHUNK_SIZE } from "@ttrpg3d/shared";
import { connectAndStreamWorld } from "./net.js";
import { installPlayerController } from "./movement/PlayerController.js";
import { installOriginShiftLogger } from "./originShiftLogger.js";

// Matches testArea.ts's spawnPosition() exactly -- avoids the player
// rendering somewhere wrong for the one tick before the server's own spawn
// position round-trips back. NOT the area center -- see that function's
// comment for why (it collided with the center marker pillar).
const SPAWN: [number, number, number] = [8, 5, 24];

export interface RunningGame {
  /**
   * Tears down the noa/Babylon instance -- noa-engine has no built-in
   * dispose API (checked its source directly: no dispose/destroy method
   * anywhere), so this does the closest equivalent by hand: pause the tick
   * loop, dispose the Babylon scene+engine (frees the WebGL context --
   * important, browsers cap how many can exist at once), and remove noa's
   * own container/canvas element (appended directly to document.body by
   * noa itself, confirmed via its container.js). Needed because leaving
   * the game route previously left the canvas running full-screen on top
   * of the lobby with no way back short of a hard refresh -- reproduced
   * live via the browser back button.
   */
  stop(): void;
}

export function startGame(worldId: string, worldName: string, serverUrl: string, playerName: string): RunningGame {
  console.log(`[game] starting world "${worldName}" (${worldId})`);

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

  // Resolves to the real server connection once joinOrCreate() completes --
  // stop() below chains onto this (rather than needing its own connected/
  // not-yet-connected branch) so leaving works correctly whether the
  // connection has finished by then or not.
  const connection = connectAndStreamWorld(noa, serverUrl, playerName, worldId).catch((err) => {
    console.error("[net] failed to connect to world server:", err);
    return null;
  });

  return {
    stop(): void {
      // Real bug found live: this used to only tear down the local view --
      // the server never learned the client left, so the old session
      // lingered in that world's room state and reappeared as a red,
      // walk-through "ghost" player box on reconnecting (confirmed from a
      // screenshot). Actually leave the room now.
      connection.then((c) => c?.leave());

      noa.setPaused(true);
      try {
        const scene = noa.rendering.getScene();
        const engine = scene.getEngine();
        scene.dispose();
        engine.dispose();
      } catch (err) {
        console.error("[game] error disposing Babylon scene/engine:", err);
      }
      noa.container.element.remove();
    },
  };
}
