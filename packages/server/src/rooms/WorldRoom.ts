import { Room, type Client } from "colyseus";
import { CHUNK_SIZE, encodeChunk, type ChunkRequest } from "@ttrpg3d/shared";
import { WorldState, PlayerState, type WorldStateType } from "./WorldState.js";
import { fillChunk, spawnPosition } from "../world/testArea.js";
import { createWorldStorage, type WorldStorage } from "../world/storage.js";
import { mod } from "../world/mathUtils.js";
import { join } from "node:path";

interface PlayerInput {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

interface EditBlockMessage {
  x: number;
  y: number;
  z: number;
  voxelId: number;
}

function flatIndex(i: number, j: number, k: number): number {
  return i * CHUNK_SIZE * CHUNK_SIZE + j * CHUNK_SIZE + k;
}

export class WorldRoom extends Room<{ state: WorldStateType }> {
  // Set once in onCreate from the first joiner's options -- paired with
  // `.filterBy(['worldId'])` on this room's registration (server.ts), which
  // tells Colyseus's matchmaker that different worldIds need different room
  // instances rather than everyone piling into one shared "world" room.
  // Falls back to "default" only so a room created with no worldId at all
  // (e.g. an old client, or @colyseus/testing's createRoom with no options)
  // still works rather than throwing -- real clients always pass one.
  worldId = "default";
  storage!: WorldStorage;

  onCreate(options?: { worldId?: string }) {
    this.worldId = options?.worldId || "default";
    this.storage = createWorldStorage(join(process.cwd(), "data", "worlds"), this.worldId);
    this.setState(new WorldState());

    this.onMessage<ChunkRequest>("requestChunk", (client, { cx, cy, cz }) => {
      const saved = this.storage.getChunk(cx, cy, cz);
      if (saved) {
        client.sendBytes("chunk", encodeChunk(cx, cy, cz, saved));
        return;
      }
      // Unmodified chunk -- regenerate from the generator, don't save it.
      // Only edited chunks ever get persisted (the sparse-diff model the
      // architecture plan committed to from the start).
      const voxels = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE);
      fillChunk(voxels, CHUNK_SIZE, cx * CHUNK_SIZE, cy * CHUNK_SIZE, cz * CHUNK_SIZE, this.worldId);
      client.sendBytes("chunk", encodeChunk(cx, cy, cz, voxels));
    });

    // No anti-cheat/validation beyond basic sanity, per the already-
    // confirmed trust model -- DM-permission gating is later (Phase 8),
    // not now.
    this.onMessage<EditBlockMessage>("editBlock", (client, { x, y, z, voxelId }) => {
      const cx = Math.floor(x / CHUNK_SIZE);
      const cy = Math.floor(y / CHUNK_SIZE);
      const cz = Math.floor(z / CHUNK_SIZE);
      const li = mod(x, CHUNK_SIZE);
      const lj = mod(y, CHUNK_SIZE);
      const lk = mod(z, CHUNK_SIZE);

      let voxels = this.storage.getChunk(cx, cy, cz);
      if (!voxels) {
        voxels = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE);
        fillChunk(voxels, CHUNK_SIZE, cx * CHUNK_SIZE, cy * CHUNK_SIZE, cz * CHUNK_SIZE, this.worldId);
      } else {
        // getChunk returns the storage's own buffer -- copy before mutating
        // so a second edit to the same chunk can't corrupt anything still
        // referencing the original (defensive; cheap at chunk size).
        voxels = voxels.slice();
      }
      voxels[flatIndex(li, lj, lk)] = voxelId;
      this.storage.setChunk(cx, cy, cz, voxels);

      this.broadcast("blockChanged", { x, y, z, voxelId }, { except: client });
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

  onDispose() {
    this.storage.close();
  }

  onJoin(client: Client, options?: { name?: string }) {
    const player = new PlayerState();
    player.name = options?.name || `Player-${client.sessionId.slice(0, 4)}`;
    const [sx, sy, sz] = spawnPosition();
    player.x = sx;
    player.y = sy;
    player.z = sz;
    this.state.players.set(client.sessionId, player);
    console.log(`[WorldRoom:${this.worldId}] ${player.name} (${client.sessionId}) joined`);
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    console.log(`[WorldRoom:${this.worldId}] ${client.sessionId} left`);
  }
}
