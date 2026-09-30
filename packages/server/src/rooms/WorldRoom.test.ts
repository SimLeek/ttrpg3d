import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import { decodeChunk } from "@ttrpg3d/shared";
import { server } from "../server.js";
import { WorldRoom } from "./WorldRoom.js";
import { GROUND, AIR, AREA_SIZE } from "../world/testArea.js";

describe("WorldRoom", () => {
  let colyseus: ColyseusTestServer;

  beforeAll(async () => {
    colyseus = await boot(server);
  });

  afterAll(async () => {
    await colyseus.shutdown();
  });

  it("spawns a joining player inside the test area bounds", async () => {
    const room = await colyseus.createRoom<WorldRoom>("world", {});
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
    const room = await colyseus.createRoom<WorldRoom>("world", {});
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
});
