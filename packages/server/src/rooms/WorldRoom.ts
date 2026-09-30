import { Room, type Client } from "colyseus";
import { CHUNK_SIZE, encodeChunk, type ChunkRequest } from "@ttrpg3d/shared";
import { WorldState, PlayerState, type WorldStateType } from "./WorldState.js";
import { fillChunk, spawnPosition } from "../world/testArea.js";

interface PlayerInput {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export class WorldRoom extends Room<{ state: WorldStateType }> {
  onCreate() {
    this.setState(new WorldState());

    this.onMessage<ChunkRequest>("requestChunk", (client, { cx, cy, cz }) => {
      const voxels = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE);
      fillChunk(voxels, CHUNK_SIZE, cx * CHUNK_SIZE, cy * CHUNK_SIZE, cz * CHUNK_SIZE);
      client.sendBytes("chunk", encodeChunk(cx, cy, cz, voxels));
    });

    // No anti-cheat / physics-verification requirement (per the migration
    // plan) -- the client owns its own movement simulation and just reports
    // position; the server's job here is broadcast via Schema sync, not
    // re-validating the move.
    this.onMessage<PlayerInput>("pos", (client, { x, y, z, yaw }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      player.x = x;
      player.y = y;
      player.z = z;
      player.yaw = yaw;
    });
  }

  onJoin(client: Client, options?: { name?: string }) {
    const player = new PlayerState();
    player.name = options?.name || `Player-${client.sessionId.slice(0, 4)}`;
    const [sx, sy, sz] = spawnPosition();
    player.x = sx;
    player.y = sy;
    player.z = sz;
    this.state.players.set(client.sessionId, player);
    console.log(`[WorldRoom] ${player.name} (${client.sessionId}) joined`);
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    console.log(`[WorldRoom] ${client.sessionId} left`);
  }
}
