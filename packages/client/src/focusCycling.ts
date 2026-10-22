// Tab/Shift+Tab cycle which of a session's OWN characters is currently
// focused/controlled -- MVP goal item 4 follow-up, the natural companion
// to drag-and-drop placement: once more than one of your own characters
// can be live in the world at once (WorldState.ts's otherCharacters),
// you need a way to switch which one you're driving. Same
// isCaptured()-gated global-hotkey pattern respawnControl.ts's Shift+R
// already uses.
//
// Teleports the LOCAL physics entity (noa.playerEntity, the one and
// only -- a focus swap is a teleport+relabel, never a different entity,
// per the architecture this PR builds on) using the TARGET character's
// last-known position read straight off this client's own already-
// synced Schema state (`otherCharacters`) -- same "use what's locally
// known already, don't wait on a server round-trip" precedent
// respawnControl.ts's Shift+R uses for the respawn anchor. Body-size
// resizing then happens for free on the next Schema sync, via net.ts's
// own existing bodySizeChanged check (unrelated to this module -- it
// already runs for ANY body-size change, a focus swap included).
//
// `direction` has to travel to the server explicitly (not inferred) --
// see WorldRoom.ts's FocusCharacterMessage doc for why "next"/"previous"
// insert the old focus back into otherCharacters at opposite ends,
// which is what makes Tab and Shift+Tab true inverses of each other
// around the ring [focused, ...otherCharacters].

import type { Room } from "@colyseus/sdk";
import type { PlayerController } from "./movement/PlayerController.js";
import { isCaptured } from "./inputCapture.js";

interface OtherCharacterLike {
  /** MVP goal item 4 follow-up ("multiple instances of the same character... for monsters") -- the real identity to target; characterId alone can no longer address one specific placed instance. */
  instanceId: string;
  x: number;
  y: number;
  z: number;
}

interface PlayerStateLike {
  otherCharacters: OtherCharacterLike[];
}

export function installFocusCycling(room: Room, playerController: PlayerController): void {
  function myPlayer(): PlayerStateLike | undefined {
    const players = (room.state as { players?: Map<string, PlayerStateLike> } | undefined)?.players;
    return players?.get(room.sessionId);
  }

  function cycleFocus(direction: "next" | "previous"): void {
    const player = myPlayer();
    if (!player || player.otherCharacters.length === 0) return; // nothing else to cycle to -- real state (solo character), not an error

    // Tab always targets the FRONT of the ring, Shift+Tab the BACK --
    // same selection WorldRoom.test.ts's own ring tests exercise.
    const target = direction === "next" ? player.otherCharacters[0] : player.otherCharacters[player.otherCharacters.length - 1];
    playerController.teleportTo([target.x, target.y, target.z]);
    room.send("focusCharacter", { instanceId: target.instanceId, direction });
  }

  window.addEventListener("keydown", (event) => {
    if (event.repeat) return;
    if (event.code !== "Tab") return;
    // Tab has real, standard meaning while typing (move to the next
    // form field/chat box) -- isCaptured() alone doesn't cover this
    // (the stat-value/color/status-effect overlays in net.ts don't
    // claim capture), so this checks DOM focus directly too, same as
    // any ordinary web page would expect Tab to behave.
    const activeTag = document.activeElement?.tagName;
    if (activeTag === "INPUT" || activeTag === "TEXTAREA") return;
    if (isCaptured()) return;
    event.preventDefault(); // nothing else on this canvas-only view is focusable to tab to regardless, but don't rely on that
    cycleFocus(event.shiftKey ? "previous" : "next");
  });
}
