import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import { decodeChunk } from "@ttrpg3d/shared";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { server } from "../server.js";
import { WorldRoom } from "./WorldRoom.js";
import { DEFAULT_WORLD_BOTTOM_Y } from "./WorldState.js";
import { GROUND, AIR, AREA_SIZE } from "../world/testArea.js";
import { store } from "../data/store.js";

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

  it("worldBottomY (DEFAULT_WORLD_BOTTOM_Y, the real default for a genuinely bottomless generator) survives the actual binary Schema encode/decode round-trip to a connected client", async () => {
    // Real concern, not a hypothetical: -Infinity was the first value
    // tried here and it did NOT survive this field's real wire encoding
    // (silently clamped server-side-vs-client-side -- see
    // DEFAULT_WORLD_BOTTOM_Y's own doc in WorldState.ts for the full
    // story). room.state (server-side memory) would trivially read back
    // whatever JS value was set regardless of encoding -- the actual
    // thing worth checking is what a CONNECTED CLIENT receives after
    // @colyseus/testing's real (in-process, but genuine) encode/decode.
    const room = await colyseus.createRoom<WorldRoom>("world", { worldId: TEST_WORLD_ID });
    const client = await colyseus.connectTo(room);
    await new Promise((resolve) => setTimeout(resolve, 50)); // let the initial state sync actually land
    expect((client.state as { worldBottomY: number }).worldBottomY).toBe(DEFAULT_WORLD_BOTTOM_Y);
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

  describe("GM admin-override escape hatch + respawn anchor (core/mod-boundary)", () => {
    // store.ts's own createAccount/createWorld (real, not test-isolated --
    // see store.test.ts for the pure-logic coverage of isWorldAdmin itself;
    // this suite only checks WorldRoom actually wires it up). Uses this
    // real world's own id for the room, not TEST_WORLD_ID, since
    // isWorldAdmin needs a world store.ts actually knows about.
    const owner = store.createAccount(`WorldRoom-test-owner-${Date.now()}`);
    const stranger = store.createAccount(`WorldRoom-test-stranger-${Date.now()}`);
    const world = store.createWorld(`WorldRoom-test-world-${Date.now()}`, owner.id);

    afterAll(() => {
      rmSync(join(process.cwd(), "data", "worlds", `${world.id}.sqlite`), { force: true });
    });

    it("PlayerState.isAdmin is true for the world's owner, false for a stranger or no accountId -- present immediately on join, not a racy follow-up message", async () => {
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });

      const ownerClient = await colyseus.connectTo(room, { accountId: owner.id });
      expect(room.state.players.get(ownerClient.sessionId)?.isAdmin).toBe(true);

      const strangerClient = await colyseus.connectTo(room, { accountId: stranger.id });
      expect(room.state.players.get(strangerClient.sessionId)?.isAdmin).toBe(false);

      const anonClient = await colyseus.connectTo(room);
      expect(room.state.players.get(anonClient.sessionId)?.isAdmin).toBe(false);
    });

    it("setRespawnAnchor is ignored from a non-admin, and sets the shared (Schema-synced) anchor when sent by the admin", async () => {
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const adminClient = await colyseus.connectTo(room, { accountId: owner.id });
      const strangerClient = await colyseus.connectTo(room, { accountId: stranger.id });

      strangerClient.send("setRespawnAnchor");
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(room.state.hasRespawnAnchor).toBe(false);

      adminClient.send("setRespawnAnchor");
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(room.state.hasRespawnAnchor).toBe(true);
      const adminPos = room.state.players.get(adminClient.sessionId)!;
      expect(room.state.respawnAnchorX).toBe(adminPos.x);
      expect(room.state.respawnAnchorY).toBe(adminPos.y);
      expect(room.state.respawnAnchorZ).toBe(adminPos.z);
    });
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
