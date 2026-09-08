// Phase 0 scaffolding: bare hello-world room, just enough to prove a client
// can connect and exchange a message that both sides type-check against the
// shared package. Real per-world rooms (WorldRoom) land in Phase 1/3.

import { Room, type Client } from "colyseus";
import type { HelloMessage } from "@ttrpg3d/shared";

export class HelloRoom extends Room {
  onCreate() {
    this.onMessage<HelloMessage>("hello", (client, message) => {
      console.log(`[HelloRoom] ${client.sessionId} says:`, message.text);
      const reply: HelloMessage = {
        text: `server received: ${message.text}`,
        sentAt: Date.now(),
      };
      client.send("hello", reply);
    });
  }

  onJoin(client: Client) {
    console.log(`[HelloRoom] ${client.sessionId} joined`);
  }

  onLeave(client: Client) {
    console.log(`[HelloRoom] ${client.sessionId} left`);
  }
}
