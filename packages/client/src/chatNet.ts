// Second, GAME-scoped Colyseus room connection -- deliberately separate
// from net.ts's `connectAndStreamWorld` (which is per-WORLD/page). Chat
// must survive this project's existing stop()+startGame() page-switch
// cycle, so it cannot share that connection's lifecycle -- a SEPARATE
// `Client`/room pair, opened once per game (main.ts), closed only when
// returning to the lobby. Colyseus supports concurrent room connections
// per tab without any special handling -- each room gets its own
// WebSocket.

import { Client, getStateCallbacks, type Room } from "@colyseus/sdk";
import type { ChatMessage } from "./api.js";

export interface PresenceEntry {
  sessionId: string;
  name: string;
}

export interface ChatConnection {
  send(text: string): void;
  /** Subscribes to live new messages (NOT history -- fetch that via api.ts's fetchGameChat). Returns an unsubscribe function. */
  onMessage(cb: (msg: ChatMessage) => void): () => void;
  onError(cb: (reason: string) => void): () => void;
  /**
   * Subscribes to the game's current presence (partyListPanel.ts) --
   * real Colyseus Schema state (GameRoom.ts/GameState.ts), not a
   * join-time message (see GameRoom.ts's own header for why). Calls
   * back with the FULL current list every time membership changes
   * (simplest contract for the panel to just re-render), including
   * once immediately with whoever's already present at subscribe time.
   * Returns an unsubscribe function.
   */
  onPresenceChange(cb: (players: PresenceEntry[]) => void): () => void;
  leave(): void;
}

export async function connectChat(url: string, gameId: string, playerName: string, accountId: string): Promise<ChatConnection> {
  const client = new Client(url);
  const room: Room = await client.joinOrCreate("game", { gameId, name: playerName, accountId });

  return {
    send(text) {
      room.send("chatSend", { text });
    },
    onMessage(cb) {
      // room.onMessage itself already returns the unsubscribe function
      // (confirmed in @colyseus/sdk's Room.d.ts) -- no need for a
      // broader removeAllListeners() call, which would tear down every
      // other listener too.
      return room.onMessage("chatMessage", cb);
    },
    onError(cb) {
      return room.onMessage("chatError", (msg: { reason: string }) => cb(msg.reason));
    },
    onPresenceChange(cb) {
      const $ = getStateCallbacks(room);
      const presence = new Map<string, string>();
      function notify(): void {
        cb(Array.from(presence, ([sessionId, name]) => ({ sessionId, name })));
      }
      // onAdd's own `immediate` default also fires for whoever's
      // already in the map at subscribe time (confirmed in @colyseus/
      // schema's real .d.ts) -- the panel gets a correct initial list
      // with no separate "fetch current presence" step needed.
      const detachAdd = $(room.state as { players: Map<string, { name: string }> }).players.onAdd((player, sessionId) => {
        presence.set(sessionId, player.name);
        notify();
      });
      const detachRemove = $(room.state as { players: Map<string, { name: string }> }).players.onRemove((_player, sessionId) => {
        presence.delete(sessionId);
        notify();
      });
      return () => {
        detachAdd();
        detachRemove();
      };
    },
    leave() {
      room.leave();
    },
  };
}
