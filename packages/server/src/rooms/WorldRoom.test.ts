import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import { decodeChunk } from "@ttrpg3d/shared";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { server } from "../server.js";
import { WorldRoom } from "./WorldRoom.js";
import { GROUND, AIR, AREA_SIZE } from "../world/testArea.js";

// Every room created below passes this same worldId -- WorldRoom's storage
// isn't test-dir-injectable the way data/store.ts's createStore(baseDir)
// is (a real Colyseus room doesn't take a constructor argument for that),
// so it always writes a real .sqlite file under the server's real
// data/worlds/ directory. Using one dedicated id (instead of letting rooms
// fall back to "default") and cleaning up that one file in afterAll keeps
// the real dev-data directory from accumulating a stray file on every test
// run.
const TEST_WORLD_ID = `test-world-${Date.now()}`;

describe("WorldRoom", () => {
  let colyseus: ColyseusTestServer;

  beforeAll(async () => {
    colyseus = await boot(server);
  });

  afterAll(async () => {
    await colyseus.shutdown();
    rmSync(join(process.cwd(), "data", "worlds", `${TEST_WORLD_ID}.sqlite`), { force: true });
  });

  it("spawns a joining player inside the test area bounds", async () => {
    const room = await colyseus.createRoom<WorldRoom>("world", { worldId: TEST_WORLD_ID });
    await colyseus.connectTo(room, { name: "Tester" });

    const players = Array.from(room.state.players.values());
    expect(players).toHaveLength(1);
    expect(players[0].name).toBe("Tester");
    expect(players[0].x).toBeGreaterThanOrEqual(0);
    expect(players[0].x).toBeLessThan(AREA_SIZE);
    expect(players[0].z).toBeGreaterThanOrEqual(0);
    expect(players[0].z).toBeLessThan(AREA_SIZE);
  });

  it("generates the same deterministic chunk on request, with solid ground and a marker pillar", async () => {
    const room = await colyseus.createRoom<WorldRoom>("world", { worldId: TEST_WORLD_ID });
    const client = await colyseus.connectTo(room);

    // requestChunk is a small plain message (per the protocol split, chunk
    // *requests* aren't worth the binary-framing ceremony); the reply is the
    // raw-binary "chunk" message.
    const decoded = await new Promise<ReturnType<typeof decodeChunk>>((resolve) => {
      client.onMessage("chunk", (bytes: Uint8Array) => resolve(decodeChunk(bytes)));
      client.send("requestChunk", { cx: 0, cy: 0, cz: 0 });
    });

    expect(decoded.cx).toBe(0);
    expect(decoded.cy).toBe(0);
    expect(decoded.cz).toBe(0);
    expect(decoded.voxels.length).toBe(32 * 32 * 32);

    // Ground floor near the origin (y=0, well within the area's x/z bounds)
    // should be solid; well above the floor should be air.
    const idx = (i: number, j: number, k: number) => i * 32 * 32 + j * 32 + k;
    expect(decoded.voxels[idx(5, 0, 5)]).toBe(GROUND);
    expect(decoded.voxels[idx(5, 10, 5)]).toBe(AIR);
  });

  describe("block edits persist (real per-world storage)", () => {
    it("an edited block is visible to another client in the same room immediately (broadcast)", async () => {
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: TEST_WORLD_ID });
      const editor = await colyseus.connectTo(room);
      const observer = await colyseus.connectTo(room);

      const changed = new Promise<{ x: number; y: number; z: number; voxelId: number }>((resolve) => {
        observer.onMessage("blockChanged", resolve);
      });
      editor.send("editBlock", { x: 15, y: 0, z: 15, voxelId: AIR });

      await expect(changed).resolves.toEqual({ x: 15, y: 0, z: 15, voxelId: AIR });
    });

    it("an edited block survives being re-requested as part of its chunk (persisted, not just broadcast)", async () => {
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: TEST_WORLD_ID });
      const client = await colyseus.connectTo(room);

      // (16,0,16) is solid GROUND by default (same reasoning as the
      // generation test above -- well within the floor, away from the
      // gap/stairs/wall/markers) -- break it, then re-request the same
      // chunk and confirm the edit, not the generator's default, comes
      // back. Different coordinates from the "visible to another client"
      // test above so the two tests can't interfere with each other.
      client.send("editBlock", { x: 16, y: 0, z: 16, voxelId: AIR });
      // editBlock has no reply -- give it a tick to apply before asking
      // for the chunk again, same real room instance either way.
      await new Promise((resolve) => setTimeout(resolve, 50));

      const decoded = await new Promise<ReturnType<typeof decodeChunk>>((resolve) => {
        client.onMessage("chunk", (bytes: Uint8Array) => resolve(decodeChunk(bytes)));
        client.send("requestChunk", { cx: 0, cy: 0, cz: 0 });
      });

      const idx = (i: number, j: number, k: number) => i * 32 * 32 + j * 32 + k;
      expect(decoded.voxels[idx(16, 0, 16)]).toBe(AIR);
      // A neighboring, untouched cell should still be the generator's default.
      expect(decoded.voxels[idx(17, 0, 16)]).toBe(GROUND);
    });
  });
});
