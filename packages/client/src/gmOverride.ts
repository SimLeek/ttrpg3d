// GM admin-override escape hatch (core/mod-boundary plan): a core,
// always-available safety valve for whoever the server told us is this
// world's owner/admin/root (WorldRoom.onJoin -> PlayerState.isAdmin,
// Schema-synced -- this file doesn't decide admin status itself, just
// reads it). Toggling switches the player's active MovementProvider to
// NoclipFlyProvider (fly + pass through terrain) and flips a flag
// voxelEditor.ts's overlap-guard bypass reads for instant build/delete.
// No "immortal" flag -- no damage/health system exists anywhere yet for
// that to mean anything against (Phase 5, NOT STARTED, see the plan).
//
// The specific powers bundled here and the KeyG binding are the one
// fixed default for now, not yet a swappable mod layer -- see the
// core/mod-boundary plan's explicit out-of-scope note on why.

import type { Engine } from "noa-engine";
import type { Room } from "@colyseus/sdk";
import type { PlayerController } from "./movement/PlayerController.js";

export interface GmOverride {
  isActive(): boolean;
}

export function installGmOverride(noa: Engine, room: Room, playerController: PlayerController): GmOverride {
  let active = false;

  function isAdmin(): boolean {
    // room.state may not have its initial sync yet right after join
    // (confirmed real over an actual socket connection, not just
    // @colyseus/testing's in-process harness -- see net.ts's own remote-
    // player loop for the same defensive read) -- a plain `false` until
    // it arrives is the correct answer either way (can't grant GM mode
    // before we even know we're admin).
    const players = (room.state as { players?: Map<string, { isAdmin?: boolean }> } | undefined)?.players;
    return !!players?.get(room.sessionId)?.isAdmin;
  }

  window.addEventListener("keydown", (event) => {
    if (event.code !== "KeyG" || event.repeat) return;
    if (!active && !isAdmin()) return; // can't turn ON without being admin; always allowed to turn back off
    active = !active;
    playerController.setProvider(active ? playerController.noclip : playerController.core);
  });

  return { isActive: () => active };
}
