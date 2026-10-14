import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import { decodeChunk, AIR, DIRT } from "@ttrpg3d/shared";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { server } from "../server.js";
import { WorldRoom } from "./WorldRoom.js";
import { DEFAULT_WORLD_BOTTOM_Y } from "./WorldState.js";
import { store } from "../data/store.js";

// A deterministic limestone_slab world (no noise, trivial bounded box --
// see limestoneSlab.ts) replaces the old hand-built test area as this
// suite's test fixture (games-and-world-generators PR; the hand-built
// area was retired entirely). Real Game + World records, registered via
// store.ts like any other world now has to be -- WorldRoom.onCreate looks
// up store.getWorld(worldId) for real generator info, so a bare arbitrary
// worldId with nothing registered would silently fall back to
// DEFAULT_WORLD_GEN instead of this suite's own deterministic params.
const SLAB_PARAMS = { width: 32, height: 8, depth: 32, voxelId: DIRT };

describe("WorldRoom", () => {
  let colyseus: ColyseusTestServer;
  let testWorldId: string;

  beforeAll(async () => {
    colyseus = await boot(server);
    const owner = store.createAccount(`WorldRoom-test-owner-${Date.now()}`);
    const game = store.createGame(`WorldRoom-test-game-${Date.now()}`, owner.id);
    const world = store.createWorld(game.id, "Test Slab", "limestone_slab", SLAB_PARAMS);
    testWorldId = world.id;
  });

  afterAll(async () => {
    await colyseus.shutdown();
    rmSync(join(process.cwd(), "data", "worlds", `${testWorldId}.sqlite`), { force: true });
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
    const room = await colyseus.createRoom<WorldRoom>("world", { worldId: testWorldId });
    const client = await colyseus.connectTo(room);
    await new Promise((resolve) => setTimeout(resolve, 50)); // let the initial state sync actually land
    expect((client.state as { worldBottomY: number }).worldBottomY).toBe(DEFAULT_WORLD_BOTTOM_Y);
  });

  it("spawns a joining player at the deterministic safe-spawn-scan position (first 2-consecutive-air gap above the slab, at the fixed x=8,z=8 scan column)", async () => {
    const room = await colyseus.createRoom<WorldRoom>("world", { worldId: testWorldId });
    await colyseus.connectTo(room, { name: "Tester" });

    const players = Array.from(room.state.players.values());
    expect(players).toHaveLength(1);
    expect(players[0].name).toBe("Tester");
    expect(players[0].x).toBe(8);
    expect(players[0].y).toBe(SLAB_PARAMS.height); // first air voxel is exactly at y=height, since y < height is all solid
    expect(players[0].z).toBe(8);
  });

  it("generates the same deterministic chunk on request, solid inside the slab bounds and air above it", async () => {
    const room = await colyseus.createRoom<WorldRoom>("world", { worldId: testWorldId });
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

    // (5,0,5) is inside the 32x8x32 slab -> solid DIRT; (5,10,5) is above
    // height=8 -> air. Exact, not sampled -- limestone_slab has no noise.
    const idx = (i: number, j: number, k: number) => i * 32 * 32 + j * 32 + k;
    expect(decoded.voxels[idx(5, 0, 5)]).toBe(DIRT);
    expect(decoded.voxels[idx(5, 10, 5)]).toBe(AIR);
  });

  describe("GM admin-override escape hatch + respawn anchor (core/mod-boundary)", () => {
    // store.ts's own createAccount/createGame/createWorld (real, not
    // test-isolated -- see store.test.ts for the pure-logic coverage of
    // isGameAdmin/isWorldAdmin itself; this suite only checks WorldRoom
    // actually wires it up). Uses this real world's own id for the room,
    // not testWorldId above, since isWorldAdmin needs a world store.ts
    // actually knows about and this describe block wants its own
    // owner/stranger pair.
    const owner = store.createAccount(`WorldRoom-test-owner-${Date.now()}`);
    const stranger = store.createAccount(`WorldRoom-test-stranger-${Date.now()}`);
    const game = store.createGame(`WorldRoom-test-game-${Date.now()}`, owner.id);
    const world = store.createWorld(game.id, "Admin Test World", "limestone_slab", SLAB_PARAMS);

    afterAll(() => {
      rmSync(join(process.cwd(), "data", "worlds", `${world.id}.sqlite`), { force: true });
    });

    it("PlayerState.isAdmin is true for the game's owner, false for a stranger or no accountId -- present immediately on join, not a racy follow-up message", async () => {
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

    it("setRespawnAnchor refuses a position inside solid terrain, even from an admin (real request: \"it shouldn't be able to be set underground\")", async () => {
      // A dedicated fresh world, not the shared `world` above -- that one
      // already has a real anchor persisted by an earlier test in this
      // describe block (anchors persist across rooms now, that's the
      // whole point of the fix), so asserting against it here would be
      // testing stale cross-test state, not this message's own behavior.
      const freshWorld = store.createWorld(game.id, "Underground Anchor Test World", "limestone_slab", SLAB_PARAMS);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: freshWorld.id });
      const adminClient = await colyseus.connectTo(room, { accountId: owner.id });

      // Move the admin's own synced position to y=2 -- solidly inside the
      // slab's 0..height(8) solid region, reachable live via
      // NoclipFlyProvider flying through terrain.
      adminClient.send("pos", { x: 5, y: 2, z: 5, yaw: 0 });
      await new Promise((resolve) => setTimeout(resolve, 50));

      adminClient.send("setRespawnAnchor");
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(room.state.hasRespawnAnchor).toBe(false);
    });

    it("the anchor survives the room being recreated (e.g. everyone leaving during a page switch, then switching back) -- persisted via store.ts, not just in-memory Schema state", async () => {
      const firstRoom = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const firstClient = await colyseus.connectTo(firstRoom, { accountId: owner.id });
      firstClient.send("setRespawnAnchor");
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(firstRoom.state.hasRespawnAnchor).toBe(true);
      const anchorPos = { x: firstRoom.state.respawnAnchorX, y: firstRoom.state.respawnAnchorY, z: firstRoom.state.respawnAnchorZ };

      // A brand-new room instance for the SAME worldId -- same situation
      // as everyone leaving (Colyseus's default auto-dispose) and the
      // next join creating a fresh room.
      const secondRoom = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      expect(secondRoom.state.hasRespawnAnchor).toBe(true);
      expect(secondRoom.state.respawnAnchorX).toBe(anchorPos.x);
      expect(secondRoom.state.respawnAnchorY).toBe(anchorPos.y);
      expect(secondRoom.state.respawnAnchorZ).toBe(anchorPos.z);

      // New joiners land AT the anchor, not the generic safe-spawn scan.
      const secondClient = await colyseus.connectTo(secondRoom, { accountId: stranger.id });
      const joined = secondRoom.state.players.get(secondClient.sessionId)!;
      expect({ x: joined.x, y: joined.y, z: joined.z }).toEqual(anchorPos);
    });
  });

  describe("block edits persist (real per-world storage)", () => {
    it("an edited block is visible to another client in the same room immediately (broadcast)", async () => {
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: testWorldId });
      const editor = await colyseus.connectTo(room);
      const observer = await colyseus.connectTo(room);

      const changed = new Promise<{ x: number; y: number; z: number; voxelId: number }>((resolve) => {
        observer.onMessage("blockChanged", resolve);
      });
      editor.send("editBlock", { x: 15, y: 0, z: 15, voxelId: AIR });

      await expect(changed).resolves.toEqual({ x: 15, y: 0, z: 15, voxelId: AIR });
    });

    it("an edited block survives being re-requested as part of its chunk (persisted, not just broadcast)", async () => {
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: testWorldId });
      const client = await colyseus.connectTo(room);

      // (16,0,16) is solid DIRT by default (inside the slab bounds) --
      // break it, then re-request the same chunk and confirm the edit,
      // not the generator's default, comes back. Different coordinates
      // from the "visible to another client" test above so the two tests
      // can't interfere with each other.
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
      expect(decoded.voxels[idx(17, 0, 16)]).toBe(DIRT);
    });
  });
});
