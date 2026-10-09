// Core respawn primitives (worldBottomCatch.ts's crossing-detection,
// PlayerController.teleportTo, WorldRoom's respawn-anchor Schema fields)
// PLUS the one fixed default policy built on top of them -- per the
// core/mod-boundary plan: the functions are core, calling them (Shift+R
// for anyone, Shift+T admin-only to set an anchor, and this file's own
// per-tick auto-check) is the thin default-mod policy layer. Not yet a
// swappable mod object -- see the plan's explicit out-of-scope note.
//
// Shift+T, not Ctrl+T or plain T -- real bug found live: Ctrl+T is a
// browser-reserved shortcut (new tab) that a web page cannot intercept at
// all, confirmed live ("creates and switches to a new browser tab
// instead"). Shift (not Ctrl) matches Shift+R's own modifier, and avoids
// relying on an unmodified single-letter key for a privileged action.

import type { Engine } from "noa-engine";
import type { Room } from "@colyseus/sdk";
import type { PlayerController } from "./movement/PlayerController.js";
import { WorldBottomCatch } from "./worldBottomCatch.js";

interface WorldStateLike {
  worldBottomY: number;
  hasRespawnAnchor: boolean;
  respawnAnchorX: number;
  respawnAnchorY: number;
  respawnAnchorZ: number;
  players?: Map<string, { isAdmin?: boolean }>;
}

export function installRespawnControl(noa: Engine, room: Room, playerController: PlayerController, fallbackSpawn: readonly [number, number, number]): void {
  function state(): WorldStateLike | undefined {
    return room.state as WorldStateLike | undefined;
  }

  function respawnTargetPosition(): readonly [number, number, number] {
    const s = state();
    if (s?.hasRespawnAnchor) return [s.respawnAnchorX, s.respawnAnchorY, s.respawnAnchorZ];
    return fallbackSpawn;
  }

  // Built lazily once room.state has actually synced (same defensive
  // pattern net.ts's remote-player loop already uses) -- worldBottomY is
  // fixed per room for today's scope (see WorldState.ts), so constructing
  // it once rather than every tick is fine.
  let catcher: WorldBottomCatch | null = null;

  noa.on("tick", () => {
    const s = state();
    if (!s) return;
    if (!catcher) catcher = new WorldBottomCatch(s.worldBottomY);
    const pos = noa.ents.getPosition(noa.playerEntity);
    if (!pos) return;
    if (catcher.update(pos[1])) {
      playerController.teleportTo(respawnTargetPosition());
    }
  });

  window.addEventListener("keydown", (event) => {
    if (event.repeat) return;
    if (event.code === "KeyR" && event.shiftKey) {
      playerController.teleportTo(respawnTargetPosition());
    } else if (event.code === "KeyT" && event.shiftKey) {
      // Admin-gated server-side too (WorldRoom's setRespawnAnchor handler)
      // -- this client-side check is just for not sending a message the
      // server will silently drop, not the actual authorization boundary.
      if (!state()?.players?.get(room.sessionId)?.isAdmin) return;
      room.send("setRespawnAnchor");
    }
  });
}
