// Connects to the server's "world" room: streams chunks (noa's
// worldDataNeeded -> server "requestChunk" -> binary "chunk" reply, per the
// architecture plan's Schema-vs-raw-binary split) and syncs player
// transforms both ways (this client's position out, everyone else's in).
//
// No anti-cheat / physics-verification requirement (per the migration
// plan) -- the client just reports its own position; the server doesn't
// re-simulate or validate it.

import { Client, type Room } from "@colyseus/sdk";
import * as BABYLON from "@babylonjs/core";
import type { Engine } from "noa-engine";
import { CHUNK_SIZE, decodeChunk, type ChunkRequest, type Item } from "@ttrpg3d/shared";
import { installVoxelEditor } from "./voxelEditor.js";

interface EditBlockMessage {
  x: number;
  y: number;
  z: number;
  voxelId: number;
}

interface RemotePlayerLike {
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

// Send position at a fraction of tick rate -- small DM-hosted groups (per
// the architecture plan's scale assumptions) don't need every-tick updates,
// and this keeps the message volume light without adding visible lag.
const POS_SEND_EVERY_N_TICKS = 3;

export interface WorldConnection {
  /** Actually tells the server this client is leaving the room -- see the
   * doc comment at the bottom of this function for why this exists. */
  leave(): void;
}

export async function connectAndStreamWorld(noa: Engine, url: string, playerName: string, worldId: string, getEquippedItem: () => Item | null): Promise<WorldConnection> {
  // noa starts emitting worldDataNeeded for chunks around the spawn point
  // almost immediately (well before a WebSocket connection + Colyseus
  // matchmaking round-trip can possibly finish) -- so the listener below
  // must attach synchronously, right now, before any `await`. Requests that
  // arrive before the room connection is ready get queued and flushed once
  // it is, rather than lost (confirmed live: attaching this listener only
  // after `await client.joinOrCreate(...)` meant the very first batch of
  // chunk requests around spawn were silently dropped forever -- nothing
  // ever rendered, reproduced as "blue as far as the eye can see").
  const pendingChunks = new Map<string, { id: string; data: any }>();
  const queuedRequests: ChunkRequest[] = [];
  let room: Room | undefined;

  function requestChunk(req: ChunkRequest): void {
    if (room) {
      room.send("requestChunk", req);
    } else {
      queuedRequests.push(req);
    }
  }

  noa.world.on(
    "worldDataNeeded",
    (id: string, data: any, x: number, y: number, z: number) => {
      const cx = Math.floor(x / CHUNK_SIZE);
      const cy = Math.floor(y / CHUNK_SIZE);
      const cz = Math.floor(z / CHUNK_SIZE);
      pendingChunks.set(`${cx},${cy},${cz}`, { id, data });
      requestChunk({ cx, cy, cz });
    },
  );

  const client = new Client(url);
  // worldId is matched against WorldRoom.filterBy(['worldId']) server-side
  // (server.ts) -- without it every player would land in the same shared
  // room regardless of which world they picked.
  room = await client.joinOrCreate("world", { name: playerName, worldId });
  for (const req of queuedRequests) room.send("requestChunk", req);
  queuedRequests.length = 0;

  room.onMessage("chunk", (bytes: Uint8Array) => {
    const { cx, cy, cz, voxels } = decodeChunk(bytes);
    const key = `${cx},${cy},${cz}`;
    const pending = pendingChunks.get(key);
    if (!pending) return; // no longer needed (player moved away) -- fine to drop
    pendingChunks.delete(key);
    let idx = 0;
    for (let i = 0; i < CHUNK_SIZE; i++) {
      for (let j = 0; j < CHUNK_SIZE; j++) {
        for (let k = 0; k < CHUNK_SIZE; k++) {
          pending.data.set(i, j, k, voxels[idx++]);
        }
      }
    }
    noa.world.setChunkData(pending.id, pending.data);
  });

  // ---- voxel edits: apply locally immediately (installVoxelEditor already
  // does this via noa.setBlock before this callback even runs), send
  // intent to the server, and apply other clients' edits the same way we
  // apply our own. Installed here (after the room connects), not up with
  // the worldDataNeeded listener above -- unlike chunk requests, a click
  // can't happen before this function has had a chance to run past the
  // `await` below, so there's no pre-connection window to queue against.
  installVoxelEditor(noa, getEquippedItem, (x, y, z, voxelId) => {
    room.send("editBlock", { x, y, z, voxelId });
  });

  room.onMessage("blockChanged", ({ x, y, z, voxelId }: EditBlockMessage) => {
    noa.setBlock(voxelId, x, y, z);
  });

  // ---- remote player avatars: plain colored boxes, just enough to see
  // other connected players move during a two-tab test ----
  const scene = noa.rendering.getScene();
  const remoteMaterial = new BABYLON.StandardMaterial("remotePlayerMat", scene);
  remoteMaterial.diffuseColor = new BABYLON.Color3(0.9, 0.2, 0.2);
  const remoteEntities = new Map<string, number>(); // sessionId -> noa entity id

  noa.on("tick", () => {
    // Over a real connection (unlike @colyseus/testing's in-process
    // harness), the initial full-state sync can arrive a tick or two after
    // joinOrCreate() resolves -- confirmed directly via a real-socket smoke
    // test, not an assumption. Guard rather than assume state is populated.
    const players = (room.state as { players?: Map<string, RemotePlayerLike> } | undefined)?.players;
    if (!players) return;
    const seen = new Set<string>();
    for (const [sessionId, p] of players) {
      seen.add(sessionId);
      if (sessionId === room.sessionId) continue; // don't render ourselves as a remote box
      let eid = remoteEntities.get(sessionId);
      if (eid === undefined) {
        const mesh = BABYLON.MeshBuilder.CreateBox(`remote-${sessionId}`, { width: 0.6, height: 1.8, depth: 0.6 }, scene);
        mesh.material = remoteMaterial;
        eid = noa.entities.add([p.x, p.y, p.z], 0.6, 1.8, mesh, [0, 0.9, 0], false, false);
        remoteEntities.set(sessionId, eid);
      } else {
        noa.entities.setPosition(eid, [p.x, p.y, p.z]);
      }
    }
    for (const [sessionId, eid] of remoteEntities) {
      if (!seen.has(sessionId)) {
        // deleteEntity is inherited from ent-comp's ECS base class -- see
        // the same cast rationale in movement/PlayerController.ts.
        (noa.entities as unknown as { deleteEntity(id: number): void }).deleteEntity(eid);
        remoteEntities.delete(sessionId);
      }
    }
  });

  // ---- send our own position ----
  let tickCount = 0;
  noa.on("tick", () => {
    tickCount++;
    if (tickCount % POS_SEND_EVERY_N_TICKS !== 0) return;
    const pos = noa.ents.getPosition(noa.playerEntity);
    if (!pos) return;
    room.send("pos", { x: pos[0], y: pos[1], z: pos[2], yaw: noa.camera.heading });
  });

  // Real bug found live: leaving the game route (game.ts's RunningGame.stop())
  // tore down the local noa/Babylon view but never told the SERVER this
  // client disconnected -- the WebSocket just sat open with nothing reading
  // from it. The old session's PlayerState lingered in that world's room
  // state; reconnecting (even as a "new" session) made the leftover one
  // render as a red, non-colliding "remote player" ghost box, reproduced
  // live and confirmed from a screenshot. `leave()` here is what game.ts's
  // stop() now actually calls.
  return {
    leave() {
      room.leave();
    },
  };
}
