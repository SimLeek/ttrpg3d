// Second, GAME-scoped Colyseus room connection -- deliberately separate
// from net.ts's `connectAndStreamWorld` (which is per-WORLD/page). Chat
// must survive this project's existing stop()+startGame() page-switch
// cycle, so it cannot share that connection's lifecycle -- a SEPARATE
// `Client`/room pair, opened once per game (main.ts), closed only when
// returning to the lobby. Colyseus supports concurrent room connections
// per tab without any special handling -- each room gets its own
// WebSocket.

import { Client, type Room } from "@colyseus/sdk";
import type { ChatMessage } from "./api.js";

export interface ChatConnection {
  send(text: string): void;
  /** Subscribes to live new messages (NOT history -- fetch that via api.ts's fetchGameChat). Returns an unsubscribe function. */
  onMessage(cb: (msg: ChatMessage) => void): () => void;
  onError(cb: (reason: string) => void): () => void;
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
    leave() {
      room.leave();
    },
  };
}
