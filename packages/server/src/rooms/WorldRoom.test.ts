import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import { decodeChunk, AIR, DIRT } from "@ttrpg3d/shared";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { server } from "../server.js";
import { WorldRoom, notifyCharacterSheetChanged } from "./WorldRoom.js";
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

// Real cruft found live: this suite creates real accounts/games/worlds
// against the actual store singleton (not an isolated one -- @colyseus/
// testing boots the real server.ts, and WorldRoom.ts imports the real
// `store` directly, so there's no clean injection point without a bigger
// restructure). Every test run was silently leaving more
// "WorldRoom-test-*" games in the user's own real lobby, with no way to
// clean them up until store.ts grew real delete methods. Every account/
// game/world id created anywhere in this file is tracked here and swept
// in the top-level afterAll below -- deleteGame cascades to its worlds,
// so only accounts + games need tracking, not every world individually.
const createdAccountIds: string[] = [];
const createdGameIds: string[] = [];
// Per-world .sqlite files (storage.ts, real per-world voxel data) are a
// SEPARATE concern from store.ts's JSON registry -- deleting a
// WorldRecord doesn't touch its sqlite file, and any worldId a real
// WorldRoom was created against gets one regardless of whether store.ts
// knows about it. Tracked separately, cleaned up the same way the
// original single-world version of this suite already did.
const createdWorldSqliteIds: string[] = [];

function trackedAccount(name: string) {
  const account = store.createAccount(name);
  createdAccountIds.push(account.id);
  return account;
}

function trackedGame(name: string, ownerAccountId: string) {
  const game = store.createGame(name, ownerAccountId);
  createdGameIds.push(game.id);
  return game;
}

function trackedWorld(gameId: string, name: string, generatorId: "hilly" | "plains" | "limestone_slab", params: unknown) {
  const world = store.createWorld(gameId, name, generatorId, params as never);
  createdWorldSqliteIds.push(world.id);
  return world;
}

describe("WorldRoom", () => {
  let colyseus: ColyseusTestServer;
  let testWorldId: string;

  beforeAll(async () => {
    colyseus = await boot(server);
    const owner = trackedAccount(`WorldRoom-test-owner-${Date.now()}`);
    const game = trackedGame(`WorldRoom-test-game-${Date.now()}`, owner.id);
    const world = trackedWorld(game.id, "Test Slab", "limestone_slab", SLAB_PARAMS);
    testWorldId = world.id;
  });

  afterAll(async () => {
    await colyseus.shutdown();
    for (const worldId of createdWorldSqliteIds) {
      rmSync(join(process.cwd(), "data", "worlds", `${worldId}.sqlite`), { force: true });
    }
    for (const gameId of createdGameIds) store.deleteGame(gameId);
    for (const accountId of createdAccountIds) store.deleteAccount(accountId);
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
    expect(players[0].currentInstance.x).toBe(8);
    expect(players[0].currentInstance.y).toBe(SLAB_PARAMS.height); // first air voxel is exactly at y=height, since y < height is all solid
    expect(players[0].currentInstance.z).toBe(8);
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
    const owner = trackedAccount(`WorldRoom-test-owner-${Date.now()}`);
    const stranger = trackedAccount(`WorldRoom-test-stranger-${Date.now()}`);
    const game = trackedGame(`WorldRoom-test-game-${Date.now()}`, owner.id);
    const world = trackedWorld(game.id, "Admin Test World", "limestone_slab", SLAB_PARAMS);

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
      expect(room.state.respawnAnchorX).toBe(adminPos.currentInstance.x);
      expect(room.state.respawnAnchorY).toBe(adminPos.currentInstance.y);
      expect(room.state.respawnAnchorZ).toBe(adminPos.currentInstance.z);
    });

    it("setRespawnAnchor refuses a position inside solid terrain, even from an admin (real request: \"it shouldn't be able to be set underground\")", async () => {
      // A dedicated fresh world, not the shared `world` above -- that one
      // already has a real anchor persisted by an earlier test in this
      // describe block (anchors persist across rooms now, that's the
      // whole point of the fix), so asserting against it here would be
      // testing stale cross-test state, not this message's own behavior.
      const freshWorld = trackedWorld(game.id, "Underground Anchor Test World", "limestone_slab", SLAB_PARAMS);
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
      expect({ x: joined.currentInstance.x, y: joined.currentInstance.y, z: joined.currentInstance.z }).toEqual(anchorPos);
    });
  });

  describe("character record (MVP goal items 1-2, docs/ROADMAP.md)", () => {
    const owner = trackedAccount(`WorldRoom-test-char-owner-${Date.now()}`);
    const game = trackedGame(`WorldRoom-test-char-game-${Date.now()}`, owner.id);
    const world = trackedWorld(game.id, "Character Test World", "limestone_slab", SLAB_PARAMS);

    it("a join with a real characterId populates the flattened character fields plus the resolved bars from its sheet; a missing/unknown one leaves them at defaults and doesn't crash", async () => {
      const character = store.createCharacter(owner.id, "Aria", [0.5, 0.25, 0.75]);
      const customSheet = { name: "Aria's Sheet", pages: [], variables: [{ id: "hp", label: "HP", type: "xOfY" as const, default: 10, max: 10 }], bars: [{ variableId: "hp", color: [0.75, 0.22, 0.17] as [number, number, number] }] };
      store.updateCharacterSheet(character.id, null, customSheet, { hp: 7, bodyWidth: 1.0, bodyHeight: 2.2, bodyDepth: 0.8 });
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });

      const withCharacter = await colyseus.connectTo(room, { characterId: character.id });
      const joined = room.state.players.get(withCharacter.sessionId)!;
      expect(joined.currentInstance.characterId).toBe(character.id);
      expect(joined.currentInstance.characterName).toBe("Aria");
      expect([joined.currentInstance.tokenColorR, joined.currentInstance.tokenColorG, joined.currentInstance.tokenColorB]).toEqual([0.5, 0.25, 0.75]);
      expect(joined.currentInstance.bars).toHaveLength(1);
      expect(joined.currentInstance.bars[0]).toMatchObject({ variableId: "hp", label: "HP", value: 7, max: 10, colorR: 0.75, colorG: 0.22, colorB: 0.17 });
      // MVP goal item 4 follow-up ("I tried adjusting the character width/height/depth and that did nothing") -- real bug fix.
      expect([joined.currentInstance.bodyWidth, joined.currentInstance.bodyHeight, joined.currentInstance.bodyDepth]).toEqual([1.0, 2.2, 0.8]);

      const withoutCharacter = await colyseus.connectTo(room);
      const joinedBare = room.state.players.get(withoutCharacter.sessionId)!;
      expect(joinedBare.currentInstance.characterId).toBe("");
      expect(joinedBare.currentInstance.bars).toHaveLength(0);
      expect([joinedBare.currentInstance.bodyWidth, joinedBare.currentInstance.bodyHeight, joinedBare.currentInstance.bodyDepth]).toEqual([0.6, 1.8, 0.6]); // RESERVED_BODY_SIZE_VARIABLES' own shared defaults

      const withUnknownCharacter = await colyseus.connectTo(room, { characterId: "not-a-real-character" });
      const joinedUnknown = room.state.players.get(withUnknownCharacter.sessionId)!;
      expect(joinedUnknown.currentInstance.characterId).toBe("");
    });

    it("notifyCharacterSheetChanged also refreshes a connected session's body size after a plain REST-style sheet update, same mechanism as the bars fix", async () => {
      const character = store.createCharacter(owner.id, "ResizedViaRest", [1, 0, 0]);
      store.updateCharacterSheet(character.id, null, null, { bodyWidth: 0.6, bodyHeight: 1.8, bodyDepth: 0.6 });
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { characterId: character.id });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(room.state.players.get(client.sessionId)!.currentInstance.bodyHeight).toBe(1.8);

      store.updateCharacterSheet(character.id, null, null, { bodyWidth: 1.2, bodyHeight: 2.4, bodyDepth: 1.2 });
      expect(room.state.players.get(client.sessionId)!.currentInstance.bodyHeight).toBe(1.8); // not yet -- the room doesn't know

      notifyCharacterSheetChanged(character.id);
      expect([room.state.players.get(client.sessionId)!.currentInstance.bodyWidth, room.state.players.get(client.sessionId)!.currentInstance.bodyHeight, room.state.players.get(client.sessionId)!.currentInstance.bodyDepth]).toEqual([1.2, 2.4, 1.2]);
    });

    it("a join with an accountId but no (or an unknown) characterId falls back to that account's default character instead of staying blank", async () => {
      const fallbackOwner = trackedAccount(`WorldRoom-test-fallback-owner-${Date.now()}`);
      const defaultCharacter = store.createCharacter(fallbackOwner.id, "Fallback", [0.1, 0.2, 0.3]);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });

      const noCharacterId = await colyseus.connectTo(room, { accountId: fallbackOwner.id });
      const joinedNoId = room.state.players.get(noCharacterId.sessionId)!;
      expect(joinedNoId.currentInstance.characterId).toBe(defaultCharacter.id);
      expect([joinedNoId.currentInstance.tokenColorR, joinedNoId.currentInstance.tokenColorG, joinedNoId.currentInstance.tokenColorB]).toEqual([0.1, 0.2, 0.3]);

      const unknownCharacterId = await colyseus.connectTo(room, { accountId: fallbackOwner.id, characterId: "not-a-real-character" });
      const joinedUnknownId = room.state.players.get(unknownCharacterId.sessionId)!;
      expect(joinedUnknownId.currentInstance.characterId).toBe(defaultCharacter.id);
    });

    it("a join with an accountId that has no characters yet auto-creates a default one, real request: deleting your last character isn't a dead end", async () => {
      const freshOwner = trackedAccount(`WorldRoom-test-fresh-owner-${Date.now()}`);
      expect(store.listCharactersForAccount(freshOwner.id)).toEqual([]);

      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { accountId: freshOwner.id });
      const joined = room.state.players.get(client.sessionId)!;

      expect(joined.currentInstance.characterId).not.toBe("");
      expect(store.getCharacter(joined.currentInstance.characterId)?.ownerAccountId).toBe(freshOwner.id);
    });

    it("setCharacterVariableValue re-resolves the live Schema bar immediately and never writes through to the shared CharacterRecord -- real correction: editing your own focused character used to write straight through, which retroactively changed every OTHER placed instance of the same character that had no override of its own yet", async () => {
      const character = store.createCharacter(owner.id, "Statted", [1, 0, 0]);
      const customSheet = { name: "Sheet", pages: [], variables: [{ id: "hp", label: "HP", type: "xOfY" as const, default: 10, max: 10 }], bars: [{ variableId: "hp", color: [1, 0, 0] as [number, number, number] }] };
      store.updateCharacterSheet(character.id, null, customSheet, { hp: 10 });
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { characterId: character.id });
      const instanceId = room.state.players.get(client.sessionId)!.currentInstance.instanceId;

      client.send("setCharacterVariableValue", { characterId: character.id, instanceId, variableId: "hp", value: 3 });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(room.state.players.get(client.sessionId)!.currentInstance.bars[0].value).toBe(3);
      expect(store.getCharacter(character.id)?.variableValues.hp).toBe(10); // the shared record is NEVER touched by an instance-scoped edit, piloted or not
    });

    it("a currently-piloted character's own edit survives a disconnect and reconnect EXACTLY (not baked into the shared record, not reset to spawn) -- real correction: onLeave used to delete the whole PlayerState, discarding position/stats; \"the controlled player starts in spawn instead, which is 100% wrong\"", async () => {
      const character = store.createCharacter(owner.id, "ResumedExactly", [1, 0, 0]);
      const customSheet = { name: "Sheet", pages: [], variables: [{ id: "hp", label: "HP", type: "xOfY" as const, default: 10, max: 10 }], bars: [{ variableId: "hp", color: [1, 0, 0] as [number, number, number] }] };
      store.updateCharacterSheet(character.id, null, customSheet, { hp: 10 });
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const firstClient = await colyseus.connectTo(room, { accountId: owner.id, characterId: character.id });
      const instanceId = room.state.players.get(firstClient.sessionId)!.currentInstance.instanceId;
      firstClient.send("pos", { x: 42, y: 7, z: -3, yaw: 1.5 });
      firstClient.send("setCharacterVariableValue", { characterId: character.id, instanceId, variableId: "hp", value: 3 });
      await new Promise((resolve) => setTimeout(resolve, 50));

      await firstClient.leave();
      await new Promise((resolve) => setTimeout(resolve, 50));
      // Idle in otherCharacters now, not discarded -- NOT at spawn.
      const idle = room.state.otherCharacters.find((o) => o.instanceId === instanceId)!;
      expect([idle.x, idle.y, idle.z, idle.yaw]).toEqual([42, 7, -3, 1.5]);
      expect(idle.bars[0].value).toBe(3);

      // `firstClient.leave()` drops the room to 0 clients, which
      // auto-disposes it -- the SAME situation a real refresh/rejoin
      // is in (see the "placed instances... survive the room being
      // recreated" test below), so resuming means a FRESH room for the
      // same worldId, not reconnecting to the now-disposed one.
      const secondRoom = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const secondClient = await colyseus.connectTo(secondRoom, { accountId: owner.id, instanceId });
      const resumed = secondRoom.state.players.get(secondClient.sessionId)!.currentInstance;
      expect(resumed.instanceId).toBe(instanceId);
      expect([resumed.x, resumed.y, resumed.z, resumed.yaw]).toEqual([42, 7, -3, 1.5]);
      expect(resumed.bars[0].value).toBe(3);
      expect(secondRoom.state.otherCharacters.some((o) => o.instanceId === instanceId)).toBe(false); // moved back OUT of the idle array, not duplicated
    });

    it("notifyCharacterSheetChanged refreshes a connected session's bars after a plain REST-style sheet update (real bug found live: a popout/popup/standalone-page edit, which has no WorldRoom connection of its own, left in-game bars stale until an unrelated room message happened to trigger a refresh)", async () => {
      const character = store.createCharacter(owner.id, "RestEdited", [1, 0, 0]);
      const customSheet = { name: "Sheet", pages: [], variables: [{ id: "hp", label: "HP", type: "xOfY" as const, default: 10, max: 10 }], bars: [{ variableId: "hp", color: [1, 0, 0] as [number, number, number] }] };
      store.updateCharacterSheet(character.id, null, customSheet, { hp: 10 });
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { characterId: character.id });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(room.state.players.get(client.sessionId)!.currentInstance.bars[0].value).toBe(10);

      // The REST endpoint's own half (server.ts's putCharacterSheet) --
      // simulated directly here as the plain store write it actually
      // is, with NO room message sent at all.
      store.updateCharacterSheet(character.id, null, customSheet, { hp: 4 });
      expect(room.state.players.get(client.sessionId)!.currentInstance.bars[0].value).toBe(10); // not yet -- the room doesn't know

      notifyCharacterSheetChanged(character.id);
      expect(room.state.players.get(client.sessionId)!.currentInstance.bars[0].value).toBe(4);
    });

    it("notifyCharacterSheetChanged is a no-op (not an error) for a character nobody is currently playing, or an unknown id", async () => {
      const character = store.createCharacter(owner.id, "NotPlaying", [1, 0, 0]);
      expect(() => notifyCharacterSheetChanged(character.id)).not.toThrow();
      expect(() => notifyCharacterSheetChanged("not-a-real-character")).not.toThrow();
    });

    it("setCharacterVariableValue is ignored from a client who is neither the character's own owner session nor an admin", async () => {
      const character = store.createCharacter(owner.id, "Guarded", [0, 1, 0]);
      store.updateCharacterSheet(character.id, null, null, { hp: 10 });
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const ownerClient = await colyseus.connectTo(room, { accountId: owner.id, characterId: character.id });
      const instanceId = room.state.players.get(ownerClient.sessionId)!.currentInstance.instanceId;
      const bystander = await colyseus.connectTo(room);

      bystander.send("setCharacterVariableValue", { characterId: character.id, instanceId, variableId: "hp", value: 1 });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(room.state.players.get(ownerClient.sessionId)!.currentInstance.bars.find((b) => b.variableId === "hp")?.value ?? 10).toBe(10);
    });

    it("setCharacterToken writes to the live Schema field when sent by the character's own owner, but never touches the shared record (instance-scoped, not a sheet edit)", async () => {
      const character = store.createCharacter(owner.id, "Recolored", [1, 0, 0]);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { characterId: character.id });
      const instanceId = room.state.players.get(client.sessionId)!.currentInstance.instanceId;

      client.send("setCharacterToken", { characterId: character.id, instanceId, color: [0, 1, 0] });
      await new Promise((resolve) => setTimeout(resolve, 50));

      const synced = room.state.players.get(client.sessionId)!.currentInstance;
      expect([synced.tokenColorR, synced.tokenColorG, synced.tokenColorB]).toEqual([0, 1, 0]);
      expect(store.getCharacter(character.id)?.token.color).toEqual([1, 0, 0]); // the shared record keeps its ORIGINAL color
    });

    it("setStatusEffects writes to the live Schema array when sent by the character's own owner, but never touches the shared record", async () => {
      const character = store.createCharacter(owner.id, "Effected", [0, 0, 1]);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { characterId: character.id });
      const instanceId = room.state.players.get(client.sessionId)!.currentInstance.instanceId;

      client.send("setStatusEffects", { characterId: character.id, instanceId, statusEffects: [{ icon: "poison.svg", label: "Poisoned" }] });
      await new Promise((resolve) => setTimeout(resolve, 50));

      const synced = room.state.players.get(client.sessionId)!.currentInstance;
      expect(synced.statusEffects.length).toBe(1);
      expect(synced.statusEffects[0].icon).toBe("poison.svg");
      expect(store.getCharacter(character.id)?.statusEffects).toEqual([]); // the shared record is untouched
    });
  });

  describe("multi-character presence: placement, focus cycling, instance delete (MVP goal item 4 follow-up)", () => {
    const owner = trackedAccount(`WorldRoom-test-multi-owner-${Date.now()}`);
    const game = trackedGame(`WorldRoom-test-multi-game-${Date.now()}`, owner.id);
    // otherCharacters is WORLD-level and genuinely persisted now (this
    // round's whole point) -- a single shared `world` fixture across
    // every test in this block would leak one test's placed instances
    // into the next (confirmed live: it did, before this fix). A fresh
    // world per test keeps each one's otherCharacters isolated, same as
    // it always was back when this lived in ephemeral per-room memory.
    let world: ReturnType<typeof trackedWorld>;
    beforeEach(() => {
      world = trackedWorld(game.id, `Multi-Character Test World ${Date.now()}-${Math.random().toString(36).slice(2)}`, "limestone_slab", SLAB_PARAMS);
    });

    it("placeCharacter adds a new WORLD-level otherCharacters entry for one of the sender's OWN other characters, within range of their focused position", async () => {
      const focused = store.createCharacter(owner.id, "Focused", [1, 0, 0]);
      const placed = store.createCharacter(owner.id, "Placed", [0, 1, 0]);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { accountId: owner.id, characterId: focused.id });
      const player = room.state.players.get(client.sessionId)!;

      client.send("placeCharacter", { characterId: placed.id, x: player.currentInstance.x + 2, y: player.currentInstance.y, z: player.currentInstance.z });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(room.state.otherCharacters).toHaveLength(1);
      expect(room.state.otherCharacters[0]).toMatchObject({ characterId: placed.id, characterName: "Placed", x: player.currentInstance.x + 2, placedByAccountId: owner.id });
      expect(room.state.otherCharacters[0].instanceId).not.toBe(""); // real identity, not derived from characterId
    });

    it("placeCharacter creates a SEPARATE, independent instance each time, even for the SAME character -- real request: \"I can't add multiple instances of the same character. I would want to do that for monsters\"", async () => {
      const focused = store.createCharacter(owner.id, "GoblinHandler", [1, 0, 0]);
      const goblin = store.createCharacter(owner.id, "Goblin", [0, 1, 0]);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { accountId: owner.id, characterId: focused.id });
      const player = room.state.players.get(client.sessionId)!;

      client.send("placeCharacter", { characterId: goblin.id, x: player.currentInstance.x + 1, y: player.currentInstance.y, z: player.currentInstance.z });
      client.send("placeCharacter", { characterId: goblin.id, x: player.currentInstance.x + 2, y: player.currentInstance.y, z: player.currentInstance.z });
      client.send("placeCharacter", { characterId: goblin.id, x: player.currentInstance.x + 3, y: player.currentInstance.y, z: player.currentInstance.z });
      await new Promise((resolve) => setTimeout(resolve, 50));

      const placedGoblins = room.state.otherCharacters.filter((o) => o.characterId === goblin.id);
      expect(placedGoblins).toHaveLength(3); // three goblins, not one moved entry
      const instanceIds = placedGoblins.map((o) => o.instanceId);
      expect(new Set(instanceIds).size).toBe(3); // each has its own real identity
      expect(placedGoblins.map((o) => o.x)).toEqual([player.currentInstance.x + 1, player.currentInstance.x + 2, player.currentInstance.x + 3]); // independent positions, not all moved to the last drop
    });

    it("placeCharacter allows placing ANOTHER instance of the character you're currently focused on -- real correction: \"if you're controlling an instance of 'bob' and you drag in another 'bob', that should still work\"", async () => {
      const bob = store.createCharacter(owner.id, "Bob", [1, 0, 0]);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { accountId: owner.id, characterId: bob.id });
      const player = room.state.players.get(client.sessionId)!;

      client.send("placeCharacter", { characterId: bob.id, x: player.currentInstance.x + 1, y: player.currentInstance.y, z: player.currentInstance.z });
      await new Promise((resolve) => setTimeout(resolve, 50));

      const placedBobs = room.state.otherCharacters.filter((o) => o.characterId === bob.id);
      expect(placedBobs).toHaveLength(1);
      expect(placedBobs[0].placedByAccountId).toBe(owner.id);
      expect(player.currentInstance.characterId).toBe(bob.id); // the one you're controlling is untouched -- this placed a SEPARATE instance
    });

    it("placeCharacter rejects a drop farther than MAX_CHARACTER_PLACEMENT_DISTANCE from the sender's own live position (never trusts a client-side distance check)", async () => {
      const focused = store.createCharacter(owner.id, "FarFocused", [1, 0, 0]);
      const placed = store.createCharacter(owner.id, "FarPlaced", [0, 1, 0]);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { accountId: owner.id, characterId: focused.id });
      const player = room.state.players.get(client.sessionId)!;

      client.send("placeCharacter", { characterId: placed.id, x: player.currentInstance.x + 999999, y: player.currentInstance.y, z: player.currentInstance.z });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(room.state.otherCharacters.some((o) => o.characterId === placed.id)).toBe(false);
    });

    it("placeCharacter rejects a character owned by someone else -- you can only ever place your OWN characters", async () => {
      const focused = store.createCharacter(owner.id, "SelfFocused", [1, 0, 0]);
      const otherOwner = trackedAccount(`WorldRoom-test-multi-otherowner-${Date.now()}`);
      const notMine = store.createCharacter(otherOwner.id, "NotMine", [0, 0, 1]);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { accountId: owner.id, characterId: focused.id });
      const player = room.state.players.get(client.sessionId)!;

      client.send("placeCharacter", { characterId: notMine.id, x: player.currentInstance.x, y: player.currentInstance.y, z: player.currentInstance.z });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(room.state.otherCharacters.some((o) => o.characterId === notMine.id)).toBe(false);
    });

    it("focusCharacter swaps the focused character and a placed otherCharacters entry's data (position, body size, bars all move with it)", async () => {
      const focused = store.createCharacter(owner.id, "WasFocused", [1, 0, 0]);
      const toFocus = store.createCharacter(owner.id, "WillBeFocused", [0, 1, 0]);
      store.updateCharacterSheet(toFocus.id, null, null, { bodyWidth: 1.0, bodyHeight: 2.0, bodyDepth: 1.0 });
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { accountId: owner.id, characterId: focused.id });
      const player = room.state.players.get(client.sessionId)!;
      const placedAt = { x: player.currentInstance.x + 1, y: player.currentInstance.y, z: player.currentInstance.z + 1 };
      client.send("placeCharacter", { characterId: toFocus.id, ...placedAt });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const placedInstanceId = room.state.otherCharacters.find((o) => o.characterId === toFocus.id)!.instanceId;

      client.send("focusCharacter", { instanceId: placedInstanceId, direction: "next" });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(player.currentInstance.characterId).toBe(toFocus.id);
      expect([player.currentInstance.x, player.currentInstance.y, player.currentInstance.z]).toEqual([placedAt.x, placedAt.y, placedAt.z]);
      expect(player.currentInstance.bodyHeight).toBe(2.0);
      expect(player.currentInstance.instanceId).toBe(placedInstanceId); // the SAME object, moved in -- not a copy
      const nowPlaced = room.state.otherCharacters.find((o) => o.characterId === focused.id);
      expect(nowPlaced).toBeDefined(); // the previously-focused one, now idle
      expect(nowPlaced!.instanceId).not.toBe(""); // real identity, the same one it had all along
      expect(nowPlaced!.placedByAccountId).toBe(owner.id);
    });

    it("focusCharacter cycles forward through a 3-character ring, FILTERED TO THE SENDER'S OWN placed instances, and returns to the start after 3 'next' presses (Tab) -- another account's monster in the same world is never part of this ring", async () => {
      const a = store.createCharacter(owner.id, "RingA", [1, 0, 0]);
      const b = store.createCharacter(owner.id, "RingB", [0, 1, 0]);
      const c = store.createCharacter(owner.id, "RingC", [0, 0, 1]);
      const otherAccount = trackedAccount(`WorldRoom-test-ring-otheraccount-${Date.now()}`);
      const notMine = store.createCharacter(otherAccount.id, "NotInMyRing", [0.5, 0.5, 0.5]);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { accountId: owner.id, characterId: a.id });
      const player = room.state.players.get(client.sessionId)!;
      const otherClient = await colyseus.connectTo(room, { accountId: otherAccount.id, characterId: notMine.id });
      const otherPlayer = room.state.players.get(otherClient.sessionId)!;
      client.send("placeCharacter", { characterId: b.id, x: player.currentInstance.x, y: player.currentInstance.y, z: player.currentInstance.z });
      client.send("placeCharacter", { characterId: c.id, x: player.currentInstance.x, y: player.currentInstance.y, z: player.currentInstance.z });
      otherClient.send("placeCharacter", { characterId: notMine.id, x: otherPlayer.currentInstance.x, y: otherPlayer.currentInstance.y, z: otherPlayer.currentInstance.z });
      await new Promise((resolve) => setTimeout(resolve, 50));

      const myRing = () => room.state.otherCharacters.filter((o) => o.placedByAccountId === owner.id);
      expect(myRing().map((o) => o.characterId)).toEqual([b.id, c.id]); // notMine never appears in MY ring

      // Tab always targets the front of the SENDER'S OWN filtered ring -- same selection net.ts's own focus-cycling module uses.
      client.send("focusCharacter", { instanceId: myRing()[0].instanceId, direction: "next" });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(player.currentInstance.characterId).toBe(b.id);
      expect(myRing().map((o) => o.characterId)).toEqual([c.id, a.id]);

      client.send("focusCharacter", { instanceId: myRing()[0].instanceId, direction: "next" });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(player.currentInstance.characterId).toBe(c.id);
      expect(myRing().map((o) => o.characterId)).toEqual([a.id, b.id]);

      client.send("focusCharacter", { instanceId: myRing()[0].instanceId, direction: "next" });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(player.currentInstance.characterId).toBe(a.id);
      expect(myRing().map((o) => o.characterId)).toEqual([b.id, c.id]); // back to the exact starting arrangement

      // The other account's own character never moved or got caught up
      // in any of this -- their placed instance of their OWN focused
      // character (allowed: "if you're controlling an instance of
      // 'bob' and you drag in another 'bob', that should still work")
      // exists, but was never part of MY ring at any point above.
      expect(otherPlayer.currentInstance.characterId).toBe(notMine.id);
      const notMinePlaced = room.state.otherCharacters.find((o) => o.characterId === notMine.id);
      expect(notMinePlaced?.placedByAccountId).toBe(otherAccount.id);
    });

    it("focusCharacter's 'previous' direction (Shift+Tab) is the true inverse of 'next' (Tab) -- one of each returns to the exact original state", async () => {
      const a = store.createCharacter(owner.id, "InverseA", [1, 0, 0]);
      const b = store.createCharacter(owner.id, "InverseB", [0, 1, 0]);
      const c = store.createCharacter(owner.id, "InverseC", [0, 0, 1]);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { accountId: owner.id, characterId: a.id });
      const player = room.state.players.get(client.sessionId)!;
      client.send("placeCharacter", { characterId: b.id, x: player.currentInstance.x, y: player.currentInstance.y, z: player.currentInstance.z });
      client.send("placeCharacter", { characterId: c.id, x: player.currentInstance.x, y: player.currentInstance.y, z: player.currentInstance.z });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const myRing = () => room.state.otherCharacters.filter((o) => o.placedByAccountId === owner.id);

      // Tab (next): targets the front.
      client.send("focusCharacter", { instanceId: myRing()[0].instanceId, direction: "next" });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(player.currentInstance.characterId).toBe(b.id);

      // Shift+Tab (previous): targets the back -- same selection net.ts's own module uses.
      client.send("focusCharacter", { instanceId: myRing()[myRing().length - 1].instanceId, direction: "previous" });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(player.currentInstance.characterId).toBe(a.id); // back to the exact original focus
      expect(myRing().map((o) => o.characterId)).toEqual([b.id, c.id]); // and the exact original arrangement
    });

    it("focusCharacter is a no-op for an instanceId that isn't one of the sender's own placed instances (also covers the right-click 'Control' item -- same message/handler)", async () => {
      const focused = store.createCharacter(owner.id, "StaysFocused", [1, 0, 0]);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { accountId: owner.id, characterId: focused.id });
      const player = room.state.players.get(client.sessionId)!;

      client.send("focusCharacter", { instanceId: "not-a-real-instance", direction: "next" });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(player.currentInstance.characterId).toBe(focused.id);
    });

    it("focusCharacter (Control) refuses a DIFFERENT account's real placed instance for an ordinary session, but an ADMIN session can take it over -- real gap, docs/ROADMAP.md item 2: 'I can't select root's bob from another tab... better ownership check'", async () => {
      const placerAccount = trackedAccount(`WorldRoom-test-focus-admin-placer-${Date.now()}`);
      const placerChar = store.createCharacter(placerAccount.id, "OtherPlayersGoblin", [0, 1, 0]);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const placerClient = await colyseus.connectTo(room, { accountId: placerAccount.id, characterId: placerChar.id });
      const placerPlayer = room.state.players.get(placerClient.sessionId)!;
      placerClient.send("placeCharacter", { characterId: placerChar.id, x: placerPlayer.currentInstance.x + 2, y: placerPlayer.currentInstance.y, z: placerPlayer.currentInstance.z });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const instanceId = room.state.otherCharacters.find((o) => o.characterId === placerChar.id)!.instanceId;

      const bystanderAccount = trackedAccount(`WorldRoom-test-focus-admin-bystander-${Date.now()}`);
      const bystanderChar = store.createCharacter(bystanderAccount.id, "Bystander", [0, 0, 1]);
      const bystanderClient = await colyseus.connectTo(room, { accountId: bystanderAccount.id, characterId: bystanderChar.id });
      bystanderClient.send("focusCharacter", { instanceId, direction: "next" });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(room.state.players.get(bystanderClient.sessionId)!.currentInstance.characterId).toBe(bystanderChar.id); // refused -- not this account's instance, not an admin

      const adminClient = await colyseus.connectTo(room, { accountId: owner.id }); // owner.id IS this game's admin, per trackedGame above
      adminClient.send("focusCharacter", { instanceId, direction: "next" });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(room.state.players.get(adminClient.sessionId)!.currentInstance.characterId).toBe(placerChar.id); // admin bypass works
    });

    it("focusCharacter (the same handler 'Control' uses) moves the target's own override deltas into the focused slot (same instanceId, same instanceVariableOverrides entry) WITHOUT touching the character's PERMANENT sheet record -- real correction: this used to merge them into the shared record, which is exactly the 'affects all the others' bug a direct bar edit on your own focused character had too", async () => {
      const focused = store.createCharacter(owner.id, "ControlSwitcher", [1, 0, 0]);
      const goblinSheet = store.createCharacter(owner.id, "ControlledGoblin", [0, 1, 0]);
      const customSheet = {
        name: "Sheet",
        pages: [],
        variables: [
          { id: "hp", label: "HP", type: "xOfY" as const, default: 10, max: 10 },
          { id: "mp", label: "MP", type: "xOfY" as const, default: 5, max: 5 },
        ],
        bars: [
          { variableId: "hp", color: [1, 0, 0] as [number, number, number] },
          { variableId: "mp", color: [0, 0, 1] as [number, number, number] },
        ],
      };
      store.updateCharacterSheet(goblinSheet.id, null, customSheet, { hp: 10, mp: 5 });
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { accountId: owner.id, characterId: focused.id });
      const player = room.state.players.get(client.sessionId)!;
      client.send("placeCharacter", { characterId: goblinSheet.id, x: player.currentInstance.x, y: player.currentInstance.y, z: player.currentInstance.z });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const instance = room.state.otherCharacters.find((o) => o.characterId === goblinSheet.id)!;
      client.send("setCharacterVariableValue", { characterId: goblinSheet.id, instanceId: instance.instanceId, variableId: "hp", value: 3 });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(store.getCharacter(goblinSheet.id)?.variableValues.hp).toBe(10); // still the base value -- not focused yet

      // "Control"-click (or Tab) to take over this damaged goblin.
      client.send("focusCharacter", { instanceId: instance.instanceId, direction: "next" });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(player.currentInstance.characterId).toBe(goblinSheet.id);
      expect(player.currentInstance.instanceId).toBe(instance.instanceId); // the SAME object/identity moved in, not a copy
      expect(player.currentInstance.bars[0].value).toBe(3); // the token's own bar reflects the damage, as before
      expect(store.getCharacter(goblinSheet.id)?.variableValues.hp).toBe(10); // the permanent sheet record is NEVER touched by a swap

      // Confirm the deviation truly moved into the focused slot, not just
      // disappeared: a later sheet edit to a DIFFERENT variable this
      // session has no deviation of its own for still reaches it (the
      // focused-slot registry really was re-pointed at the new
      // characterId), while the overridden hp stays protected.
      store.updateCharacterSheet(goblinSheet.id, null, customSheet, { hp: 7, mp: 2 });
      notifyCharacterSheetChanged(goblinSheet.id);
      expect(player.currentInstance.bars[1].value).toBe(2); // mp -- no override, cascades through
      expect(player.currentInstance.bars[0].value).toBe(3); // hp -- still this session's own deviation, untouched by the sheet edit

      // Leaving never bakes a deviation into the permanent sheet record
      // -- it persists through store's placedCharacters list instead
      // (same as any other placed instance), exactly so a later
      // resume (or an idle instance just sitting in the world) gets
      // the damaged value back without ever touching the shared record.
      await client.leave();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(store.getCharacter(goblinSheet.id)?.variableValues.hp).toBe(7); // permanent record reflects the earlier direct sheet edit, still never the override
      const persisted = store.getWorld(world.id)?.placedCharacters?.find((p) => p.instanceId === instance.instanceId);
      expect(persisted?.variableOverrides.hp).toBe(3); // the deviation survives via the instance's own persisted record
    });

    it("removeCharacterInstance deletes ONE specific placed instance but never the character record itself, and leaves other instances of the SAME character untouched (right-click 'Delete instance' -- not deleteCharacter/unlinkCharacterFromGame)", async () => {
      const focused = store.createCharacter(owner.id, "KeepsFocus", [1, 0, 0]);
      const goblin = store.createCharacter(owner.id, "ToRemove", [0, 1, 0]);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { accountId: owner.id, characterId: focused.id });
      const player = room.state.players.get(client.sessionId)!;
      client.send("placeCharacter", { characterId: goblin.id, x: player.currentInstance.x, y: player.currentInstance.y, z: player.currentInstance.z });
      client.send("placeCharacter", { characterId: goblin.id, x: player.currentInstance.x + 1, y: player.currentInstance.y, z: player.currentInstance.z });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const goblins = room.state.otherCharacters.filter((o) => o.characterId === goblin.id);
      expect(goblins).toHaveLength(2);
      const [first, second] = goblins;

      client.send("removeCharacterInstance", { instanceId: first.instanceId });
      await new Promise((resolve) => setTimeout(resolve, 50));

      const remaining = room.state.otherCharacters.filter((o) => o.characterId === goblin.id);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].instanceId).toBe(second.instanceId); // the OTHER goblin instance survives untouched
      expect(store.getCharacter(goblin.id)).toBeDefined(); // the character record itself survives regardless
    });

    it("removeCharacterInstance cannot even address the character the sender is controlling -- it has no instanceId at all (structural, not a separate check): real request, keep at least one controllable instance", async () => {
      const focused = store.createCharacter(owner.id, "CannotSelfDelete", [1, 0, 0]);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { accountId: owner.id, characterId: focused.id });
      const player = room.state.players.get(client.sessionId)!;

      client.send("removeCharacterInstance", { instanceId: "not-a-real-instance" });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(player.currentInstance.characterId).toBe(focused.id); // unchanged -- still connected and playing as this character
    });

    it("removeCharacterInstance refuses to delete an instance placed by a DIFFERENT account", async () => {
      const placer = store.createCharacter(owner.id, "RealPlacer", [1, 0, 0]);
      const goblin = store.createCharacter(owner.id, "GuardedGoblin", [0, 1, 0]);
      const bystanderAccount = trackedAccount(`WorldRoom-test-remove-bystander-${Date.now()}`);
      const bystanderChar = store.createCharacter(bystanderAccount.id, "Bystander", [0, 0, 1]);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const placerClient = await colyseus.connectTo(room, { accountId: owner.id, characterId: placer.id });
      const placerPlayer = room.state.players.get(placerClient.sessionId)!;
      placerClient.send("placeCharacter", { characterId: goblin.id, x: placerPlayer.currentInstance.x, y: placerPlayer.currentInstance.y, z: placerPlayer.currentInstance.z });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const instanceId = room.state.otherCharacters.find((o) => o.characterId === goblin.id)!.instanceId;

      const bystanderClient = await colyseus.connectTo(room, { accountId: bystanderAccount.id, characterId: bystanderChar.id });
      bystanderClient.send("removeCharacterInstance", { instanceId });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(room.state.otherCharacters.some((o) => o.instanceId === instanceId)).toBe(true); // still there -- not the placer
    });

    it("removeCharacterInstance (Delete instance) can be used by an ADMIN session on a DIFFERENT account's placed instance -- same gap/fix as focusCharacter above", async () => {
      const placerAccount = trackedAccount(`WorldRoom-test-remove-admin-placer-${Date.now()}`);
      const placerChar = store.createCharacter(placerAccount.id, "OtherPlayersGoblinToDelete", [0, 1, 0]);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const placerClient = await colyseus.connectTo(room, { accountId: placerAccount.id, characterId: placerChar.id });
      const placerPlayer = room.state.players.get(placerClient.sessionId)!;
      placerClient.send("placeCharacter", { characterId: placerChar.id, x: placerPlayer.currentInstance.x + 2, y: placerPlayer.currentInstance.y, z: placerPlayer.currentInstance.z });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const instanceId = room.state.otherCharacters.find((o) => o.characterId === placerChar.id)!.instanceId;

      const adminClient = await colyseus.connectTo(room, { accountId: owner.id }); // owner.id IS this game's admin, per trackedGame above
      adminClient.send("removeCharacterInstance", { instanceId });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(room.state.otherCharacters.some((o) => o.instanceId === instanceId)).toBe(false); // admin bypass works
    });

    it("notifyCharacterSheetChanged refreshes EVERY placed instance of a character, not just the first", async () => {
      const focused = store.createCharacter(owner.id, "FocusedForRefresh", [1, 0, 0]);
      const placedChar = store.createCharacter(owner.id, "PlacedForRefresh", [0, 1, 0]);
      const customSheet = { name: "Sheet", pages: [], variables: [{ id: "hp", label: "HP", type: "xOfY" as const, default: 10, max: 10 }], bars: [{ variableId: "hp", color: [1, 0, 0] as [number, number, number] }] };
      store.updateCharacterSheet(placedChar.id, null, customSheet, { hp: 10 });
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { accountId: owner.id, characterId: focused.id });
      const player = room.state.players.get(client.sessionId)!;
      client.send("placeCharacter", { characterId: placedChar.id, x: player.currentInstance.x, y: player.currentInstance.y, z: player.currentInstance.z });
      client.send("placeCharacter", { characterId: placedChar.id, x: player.currentInstance.x + 1, y: player.currentInstance.y, z: player.currentInstance.z });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const placedInstances = () => room.state.otherCharacters.filter((o) => o.characterId === placedChar.id);
      expect(placedInstances().map((o) => o.bars[0].value)).toEqual([10, 10]);

      store.updateCharacterSheet(placedChar.id, null, customSheet, { hp: 2 });
      notifyCharacterSheetChanged(placedChar.id);

      expect(placedInstances().map((o) => o.bars[0].value)).toEqual([2, 2]);
    });

    it("setCharacterVariableValue with an instanceId gives independent, per-instance stats -- real request: \"I would want to do that for monsters\" (killing one goblin shouldn't zero out the others)", async () => {
      const focused = store.createCharacter(owner.id, "GoblinKeeper", [1, 0, 0]);
      const goblinSheet = store.createCharacter(owner.id, "IndependentGoblin", [0, 1, 0]);
      const customSheet = { name: "Sheet", pages: [], variables: [{ id: "hp", label: "HP", type: "xOfY" as const, default: 10, max: 10 }], bars: [{ variableId: "hp", color: [1, 0, 0] as [number, number, number] }] };
      store.updateCharacterSheet(goblinSheet.id, null, customSheet, { hp: 10 });
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { accountId: owner.id, characterId: focused.id });
      const player = room.state.players.get(client.sessionId)!;
      client.send("placeCharacter", { characterId: goblinSheet.id, x: player.currentInstance.x, y: player.currentInstance.y, z: player.currentInstance.z });
      client.send("placeCharacter", { characterId: goblinSheet.id, x: player.currentInstance.x + 1, y: player.currentInstance.y, z: player.currentInstance.z });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const [goblinA, goblinB] = room.state.otherCharacters.filter((o) => o.characterId === goblinSheet.id);

      // Damage ONLY goblin A.
      client.send("setCharacterVariableValue", { characterId: goblinSheet.id, instanceId: goblinA.instanceId, variableId: "hp", value: 3 });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(room.state.otherCharacters.find((o) => o.instanceId === goblinA.instanceId)!.bars[0].value).toBe(3);
      expect(room.state.otherCharacters.find((o) => o.instanceId === goblinB.instanceId)!.bars[0].value).toBe(10); // untouched -- independent, not a shared pool
      expect(store.getCharacter(goblinSheet.id)?.variableValues.hp).toBe(10); // the shared record itself is never touched by an instance-scoped edit
    });

    it("setCharacterVariableValue on the FOCUSED slot's own instanceId updates its live bar immediately, but does NOT touch a placed sibling instance's own independent value OR the shared character record while this session stays connected -- real correction: editing your own focused character used to write straight through, which retroactively changed every OTHER placed instance of the same character with no override of its own yet", async () => {
      const focused = store.createCharacter(owner.id, "SharedEditOwner", [1, 0, 0]);
      const customSheet = { name: "Sheet", pages: [], variables: [{ id: "hp", label: "HP", type: "xOfY" as const, default: 10, max: 10 }], bars: [{ variableId: "hp", color: [1, 0, 0] as [number, number, number] }] };
      store.updateCharacterSheet(focused.id, null, customSheet, { hp: 10 });
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { accountId: owner.id, characterId: focused.id });
      const player = room.state.players.get(client.sessionId)!;
      client.send("placeCharacter", { characterId: focused.id, x: player.currentInstance.x, y: player.currentInstance.y, z: player.currentInstance.z });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const sibling = room.state.otherCharacters.find((o) => o.characterId === focused.id)!;

      client.send("setCharacterVariableValue", { characterId: focused.id, instanceId: player.currentInstance.instanceId, variableId: "hp", value: 4 });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(player.currentInstance.bars[0].value).toBe(4); // the focused slot updates immediately
      expect(room.state.otherCharacters.find((o) => o.instanceId === sibling.instanceId)!.bars[0].value).toBe(10); // a separately placed copy of the SAME character is untouched
      expect(store.getCharacter(focused.id)?.variableValues.hp).toBe(10); // and the shared record isn't written through while still connected

      // Leaving never bakes into the shared record -- the deviation
      // persists via the instance's own placedCharacters record instead
      // (same mechanism as any other placed instance's override).
      await client.leave();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(store.getCharacter(focused.id)?.variableValues.hp).toBe(10); // still untouched
      const persisted = store.getWorld(world.id)?.placedCharacters?.find((p) => p.instanceId === player.currentInstance.instanceId);
      expect(persisted?.variableOverrides.hp).toBe(4);
    });

    it("placed instances (position AND their own independent stat overrides) survive the room being recreated -- real bug found live: \"the tokens do not persist upon exiting and re-entering games, so if gms/players refresh, then monsters will disappear\"", async () => {
      const persistWorld = trackedWorld(game.id, "Monster Persistence Test World", "limestone_slab", SLAB_PARAMS);
      const focused = store.createCharacter(owner.id, "PersistenceHandler", [1, 0, 0]);
      const goblinSheet = store.createCharacter(owner.id, "PersistentGoblin", [0, 1, 0]);
      const customSheet = { name: "Sheet", pages: [], variables: [{ id: "hp", label: "HP", type: "xOfY" as const, default: 10, max: 10 }], bars: [{ variableId: "hp", color: [1, 0, 0] as [number, number, number] }] };
      store.updateCharacterSheet(goblinSheet.id, null, customSheet, { hp: 10 });

      const firstRoom = await colyseus.createRoom<WorldRoom>("world", { worldId: persistWorld.id });
      const firstClient = await colyseus.connectTo(firstRoom, { accountId: owner.id, characterId: focused.id });
      const firstPlayer = firstRoom.state.players.get(firstClient.sessionId)!;
      firstClient.send("placeCharacter", { characterId: goblinSheet.id, x: firstPlayer.currentInstance.x + 3, y: firstPlayer.currentInstance.y, z: firstPlayer.currentInstance.z + 3 });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const placedInstanceId = firstRoom.state.otherCharacters.find((o) => o.characterId === goblinSheet.id)!.instanceId;
      // Damage it -- this is the actual regression: losing a monster's
      // damage on refresh would be just as real a bug as losing its
      // position entirely.
      firstClient.send("setCharacterVariableValue", { characterId: goblinSheet.id, instanceId: placedInstanceId, variableId: "hp", value: 4 });
      await new Promise((resolve) => setTimeout(resolve, 50));

      // A brand-new room instance for the SAME worldId -- same situation
      // as everyone leaving (Colyseus's default auto-dispose) and the
      // next join creating a fresh room, same precedent this file's own
      // respawn-anchor persistence test above already established.
      const secondRoom = await colyseus.createRoom<WorldRoom>("world", { worldId: persistWorld.id });
      const reloaded = secondRoom.state.otherCharacters.find((o) => o.instanceId === placedInstanceId);
      expect(reloaded).toBeDefined(); // still there, with nobody having placed it again
      expect(reloaded!.characterId).toBe(goblinSheet.id);
      expect(reloaded!.placedByAccountId).toBe(owner.id);
      expect([reloaded!.x, reloaded!.y, reloaded!.z]).toEqual([firstPlayer.currentInstance.x + 3, firstPlayer.currentInstance.y, firstPlayer.currentInstance.z + 3]);
      expect(reloaded!.bars[0].value).toBe(4); // the damage survived too, not just the position

      // And it's still independently editable in the new room -- not a
      // dead, read-only leftover.
      const secondClient = await colyseus.connectTo(secondRoom, { accountId: owner.id, characterId: focused.id });
      secondClient.send("setCharacterVariableValue", { characterId: goblinSheet.id, instanceId: placedInstanceId, variableId: "hp", value: 1 });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(secondRoom.state.otherCharacters.find((o) => o.instanceId === placedInstanceId)!.bars[0].value).toBe(1);
    });
  });

  describe("turn-order tracker, phase 1: manual add/remove/clear/reorder/next-turn (docs/BATTLE_SYSTEM.md)", () => {
    const owner = trackedAccount(`WorldRoom-test-turnorder-owner-${Date.now()}`);
    const game = trackedGame(`WorldRoom-test-turnorder-game-${Date.now()}`, owner.id);
    // Same "a shared world fixture leaks one test's state into the next"
    // lesson the multi-character-presence block above already learned --
    // a fresh world per test keeps each one's turn order isolated.
    let world: ReturnType<typeof trackedWorld>;
    beforeEach(() => {
      world = trackedWorld(game.id, `Turn Order Test World ${Date.now()}-${Math.random().toString(36).slice(2)}`, "limestone_slab", SLAB_PARAMS);
    });

    it("addToTurnOrder (GM) with a bare label creates an entry with no live binding", async () => {
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const adminClient = await colyseus.connectTo(room, { accountId: owner.id });

      adminClient.send("addToTurnOrder", { label: "Orc Captain" });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(room.state.turnOrder).toHaveLength(1);
      expect(room.state.turnOrder[0]).toMatchObject({ label: "Orc Captain", instanceId: "", characterId: "" });
      expect(room.state.turnOrder[0].turnEntryId).not.toBe("");
    });

    it("addToTurnOrder (GM) referencing a real placed instance uses its own name, ignoring the given label", async () => {
      const focused = trackedCharacterOwner();
      const goblin = store.createCharacter(owner.id, "RealGoblin", [0, 1, 0]);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const adminClient = await colyseus.connectTo(room, { accountId: owner.id, characterId: focused.id });
      const player = room.state.players.get(adminClient.sessionId)!;
      adminClient.send("placeCharacter", { characterId: goblin.id, x: player.currentInstance.x, y: player.currentInstance.y, z: player.currentInstance.z });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const instance = room.state.otherCharacters.find((o) => o.characterId === goblin.id)!;

      adminClient.send("addToTurnOrder", { label: "ignored", instanceId: instance.instanceId, characterId: goblin.id });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(room.state.turnOrder[0]).toMatchObject({ label: "RealGoblin", instanceId: instance.instanceId, characterId: goblin.id });
    });

    it("addToTurnOrder is refused from a non-admin session for a bare label -- real correction, 2026-10-23: a non-character ('Add non-character...') add stays admin-only even though character-owned adds are now relaxed below", async () => {
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const stranger = await colyseus.connectTo(room);

      stranger.send("addToTurnOrder", { label: "Sneaky Add" });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(room.state.turnOrder).toHaveLength(0);
    });

    it("addToTurnOrder (a non-admin session) is allowed for a character THEY OWN (piloted or idle-placed) -- real correction, 2026-10-23: \"if it's the player owning their own characters, then sure, they should be able to... add their characters\"", async () => {
      const playerAccount = trackedAccount(`WorldRoom-test-turnorder-selfadd-${Date.now()}`);
      const piloted = store.createCharacter(playerAccount.id, "SelfPiloted", [1, 0, 0]);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { accountId: playerAccount.id, characterId: piloted.id });
      const player = room.state.players.get(client.sessionId)!;

      client.send("addToTurnOrder", { label: "ignored", instanceId: player.currentInstance.instanceId, characterId: piloted.id });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(room.state.turnOrder).toHaveLength(1);
      expect(room.state.turnOrder[0]).toMatchObject({ label: "SelfPiloted", instanceId: player.currentInstance.instanceId, characterId: piloted.id });
    });

    it("addToTurnOrder (a non-admin session) is refused for a character they DON'T own, even with a real instanceId/characterId", async () => {
      const ownerForOther = trackedAccount(`WorldRoom-test-turnorder-notmine-owner-${Date.now()}`);
      const notMine = store.createCharacter(ownerForOther.id, "NotMine", [0, 1, 0]);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const otherClient = await colyseus.connectTo(room, { accountId: ownerForOther.id, characterId: notMine.id });
      const otherPlayer = room.state.players.get(otherClient.sessionId)!;
      const stranger = await colyseus.connectTo(room);

      stranger.send("addToTurnOrder", { label: "ignored", instanceId: otherPlayer.currentInstance.instanceId, characterId: notMine.id });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(room.state.turnOrder).toHaveLength(0);
    });

    it("nextTurn (GM-only) advances the current index without touching the round, and wraps with a round increment", async () => {
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const adminClient = await colyseus.connectTo(room, { accountId: owner.id });
      adminClient.send("addToTurnOrder", { label: "A" });
      adminClient.send("addToTurnOrder", { label: "B" });
      adminClient.send("addToTurnOrder", { label: "C" });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(room.state.turnOrderCurrentIndex).toBe(0);
      expect(room.state.turnOrderRound).toBe(1);

      adminClient.send("nextTurn");
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(room.state.turnOrderCurrentIndex).toBe(1);
      expect(room.state.turnOrderRound).toBe(1);

      adminClient.send("nextTurn");
      adminClient.send("nextTurn"); // wraps from C back to A
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(room.state.turnOrderCurrentIndex).toBe(0);
      expect(room.state.turnOrderRound).toBe(2);
    });

    it("nextTurn is refused from a non-admin session, and is a no-op on an empty order", async () => {
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const adminClient = await colyseus.connectTo(room, { accountId: owner.id });
      const stranger = await colyseus.connectTo(room);
      adminClient.send("addToTurnOrder", { label: "A" });
      adminClient.send("addToTurnOrder", { label: "B" });
      await new Promise((resolve) => setTimeout(resolve, 50));

      stranger.send("nextTurn");
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(room.state.turnOrderCurrentIndex).toBe(0); // unaffected

      adminClient.send("clearTurnOrder");
      await new Promise((resolve) => setTimeout(resolve, 50));
      adminClient.send("nextTurn"); // nothing to advance through
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(room.state.turnOrderCurrentIndex).toBe(0);
      expect(room.state.turnOrderRound).toBe(1);
    });

    it("removeFromTurnOrder (GM) shifts the current index back by one when removing an entry BEFORE the current turn", async () => {
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const adminClient = await colyseus.connectTo(room, { accountId: owner.id });
      adminClient.send("addToTurnOrder", { label: "A" });
      adminClient.send("addToTurnOrder", { label: "B" });
      adminClient.send("addToTurnOrder", { label: "C" });
      await new Promise((resolve) => setTimeout(resolve, 50));
      adminClient.send("nextTurn"); // now B's turn (index 1)
      await new Promise((resolve) => setTimeout(resolve, 50));
      const bId = room.state.turnOrder[1].turnEntryId;
      const aId = room.state.turnOrder[0].turnEntryId;

      adminClient.send("removeFromTurnOrder", { turnEntryId: aId });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(room.state.turnOrder.map((e) => e.turnEntryId)).toEqual([bId, room.state.turnOrder[1].turnEntryId]);
      expect(room.state.turnOrderCurrentIndex).toBe(0); // still B's turn, just shifted down
      expect(room.state.turnOrder[room.state.turnOrderCurrentIndex].turnEntryId).toBe(bId);
    });

    it("removeFromTurnOrder (GM) clamps the current index when removing the LAST entry while it was also the current one", async () => {
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const adminClient = await colyseus.connectTo(room, { accountId: owner.id });
      adminClient.send("addToTurnOrder", { label: "A" });
      adminClient.send("addToTurnOrder", { label: "B" });
      await new Promise((resolve) => setTimeout(resolve, 50));
      adminClient.send("nextTurn"); // now B's turn (index 1, the last one)
      await new Promise((resolve) => setTimeout(resolve, 50));
      const bId = room.state.turnOrder[1].turnEntryId;

      adminClient.send("removeFromTurnOrder", { turnEntryId: bId });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(room.state.turnOrder).toHaveLength(1);
      expect(room.state.turnOrderCurrentIndex).toBe(0); // clamped, not left pointing past the end
    });

    it("removeFromTurnOrder is refused from a non-admin session for a bare-label entry (nothing to own)", async () => {
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const adminClient = await colyseus.connectTo(room, { accountId: owner.id });
      const stranger = await colyseus.connectTo(room);
      adminClient.send("addToTurnOrder", { label: "A" });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const entryId = room.state.turnOrder[0].turnEntryId;

      stranger.send("removeFromTurnOrder", { turnEntryId: entryId });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(room.state.turnOrder).toHaveLength(1);
    });

    it("removeFromTurnOrder (a non-admin session) is allowed for their OWN character's entry, but refused for someone else's -- real correction, 2026-10-23: \"if it's the player owning their own characters, then sure, they should be able to remove their specific characters\"", async () => {
      const playerAccount = trackedAccount(`WorldRoom-test-turnorder-selfremove-${Date.now()}`);
      const mine = store.createCharacter(playerAccount.id, "SelfRemovable", [1, 0, 0]);
      const otherAccount = trackedAccount(`WorldRoom-test-turnorder-selfremove-other-${Date.now()}`);
      const notMine = store.createCharacter(otherAccount.id, "NotRemovable", [0, 1, 0]);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { accountId: playerAccount.id, characterId: mine.id });
      const otherClient = await colyseus.connectTo(room, { accountId: otherAccount.id, characterId: notMine.id });
      const player = room.state.players.get(client.sessionId)!;
      const otherPlayer = room.state.players.get(otherClient.sessionId)!;
      client.send("addToTurnOrder", { label: "ignored", instanceId: player.currentInstance.instanceId, characterId: mine.id });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const adminClient = await colyseus.connectTo(room, { accountId: owner.id });
      adminClient.send("addToTurnOrder", { label: "ignored", instanceId: otherPlayer.currentInstance.instanceId, characterId: notMine.id });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const [mineEntryId, notMineEntryId] = room.state.turnOrder.map((e) => e.turnEntryId);

      client.send("removeFromTurnOrder", { turnEntryId: notMineEntryId }); // not theirs -- refused
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(room.state.turnOrder).toHaveLength(2);

      client.send("removeFromTurnOrder", { turnEntryId: mineEntryId }); // their own -- allowed
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(room.state.turnOrder.map((e) => e.turnEntryId)).toEqual([notMineEntryId]);
    });

    it("clearTurnOrder (GM) resets entries, current index, and round together", async () => {
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const adminClient = await colyseus.connectTo(room, { accountId: owner.id });
      adminClient.send("addToTurnOrder", { label: "A" });
      adminClient.send("addToTurnOrder", { label: "B" });
      adminClient.send("addToTurnOrder", { label: "C" });
      await new Promise((resolve) => setTimeout(resolve, 50));
      adminClient.send("nextTurn");
      adminClient.send("nextTurn");
      adminClient.send("nextTurn"); // wraps -- round 2
      await new Promise((resolve) => setTimeout(resolve, 50));

      adminClient.send("clearTurnOrder");
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(room.state.turnOrder).toHaveLength(0);
      expect(room.state.turnOrderCurrentIndex).toBe(0);
      expect(room.state.turnOrderRound).toBe(1);
    });

    it("reorderTurnOrder (GM) moves an entry while keeping turnOrderCurrentIndex pointing at the SAME logical entry", async () => {
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const adminClient = await colyseus.connectTo(room, { accountId: owner.id });
      adminClient.send("addToTurnOrder", { label: "A" });
      adminClient.send("addToTurnOrder", { label: "B" });
      adminClient.send("addToTurnOrder", { label: "C" });
      await new Promise((resolve) => setTimeout(resolve, 50));
      adminClient.send("nextTurn"); // now B's turn (index 1)
      await new Promise((resolve) => setTimeout(resolve, 50));
      const bId = room.state.turnOrder[1].turnEntryId;
      const aId = room.state.turnOrder[0].turnEntryId;

      // Move A (index 0) to the end -- B should now be at index 0.
      adminClient.send("reorderTurnOrder", { turnEntryId: aId, newIndex: 2 });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(room.state.turnOrder[0].turnEntryId).toBe(bId);
      expect(room.state.turnOrderCurrentIndex).toBe(0);
      expect(room.state.turnOrder[room.state.turnOrderCurrentIndex].turnEntryId).toBe(bId); // still B's turn
    });

    it("reorderTurnOrder (GM) moves an entry EARLIER (the up-arrow's own direction) and keeps turnOrderCurrentIndex pointing at the SAME logical entry -- real bug found live: \"I press up on hi and it changes from bob's turn to hi's turn instead of moving hi above bob\" (splice-removing and reinserting the SAME schema object within one mutation silently left the array order unchanged while the current-index re-lookup landed on the wrong entry)", async () => {
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const adminClient = await colyseus.connectTo(room, { accountId: owner.id });
      adminClient.send("addToTurnOrder", { label: "bob" });
      adminClient.send("addToTurnOrder", { label: "hi" });
      adminClient.send("addToTurnOrder", { label: "root" });
      await new Promise((resolve) => setTimeout(resolve, 50));
      // bob is current by default (index 0) -- nobody called nextTurn.
      const bobId = room.state.turnOrder[0].turnEntryId;
      const hiId = room.state.turnOrder[1].turnEntryId;

      // The up-arrow on "hi" (index 1) sends newIndex 0.
      adminClient.send("reorderTurnOrder", { turnEntryId: hiId, newIndex: 0 });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(room.state.turnOrder.map((e) => e.turnEntryId)).toEqual([hiId, bobId, room.state.turnOrder[2].turnEntryId]); // hi actually moved above bob
      expect(room.state.turnOrder[room.state.turnOrderCurrentIndex].turnEntryId).toBe(bobId); // still bob's turn, not hi's
    });

    it("sortTurnOrderByRoll (GM) sorts by rollValue (ascending or descending), treating no-roll-yet as 0, and keeps turnOrderCurrentIndex pointing at the SAME logical entry -- real request: \"now there are numbers, editable by gm, but the gm can't sort by those, so there should be sort ascending and sort descending buttons\"", async () => {
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const adminClient = await colyseus.connectTo(room, { accountId: owner.id });
      adminClient.send("addToTurnOrder", { label: "Low" });
      adminClient.send("addToTurnOrder", { label: "High" });
      adminClient.send("addToTurnOrder", { label: "NoRollYet" });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const lowId = room.state.turnOrder[0].turnEntryId;
      const highId = room.state.turnOrder[1].turnEntryId;
      const noRollId = room.state.turnOrder[2].turnEntryId;
      adminClient.send("setTurnOrderRollValue", { turnEntryId: lowId, value: 5 });
      adminClient.send("setTurnOrderRollValue", { turnEntryId: highId, value: 20 });
      await new Promise((resolve) => setTimeout(resolve, 50));
      adminClient.send("nextTurn"); // High (index 1) becomes current
      await new Promise((resolve) => setTimeout(resolve, 50));

      adminClient.send("sortTurnOrderByRoll", { direction: "asc" });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(room.state.turnOrder.map((e) => e.turnEntryId)).toEqual([noRollId, lowId, highId]); // 0, 5, 20
      expect(room.state.turnOrder[room.state.turnOrderCurrentIndex].turnEntryId).toBe(highId); // still High's turn

      adminClient.send("sortTurnOrderByRoll", { direction: "desc" });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(room.state.turnOrder.map((e) => e.turnEntryId)).toEqual([highId, lowId, noRollId]); // 20, 5, 0
      expect(room.state.turnOrder[room.state.turnOrderCurrentIndex].turnEntryId).toBe(highId); // still High's turn
    });

    it("sortTurnOrderByRoll is refused from a non-admin session", async () => {
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const adminClient = await colyseus.connectTo(room, { accountId: owner.id });
      const stranger = await colyseus.connectTo(room);
      adminClient.send("addToTurnOrder", { label: "A" });
      adminClient.send("addToTurnOrder", { label: "B" });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const before = room.state.turnOrder.map((e) => e.turnEntryId);

      stranger.send("sortTurnOrderByRoll", { direction: "asc" });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(room.state.turnOrder.map((e) => e.turnEntryId)).toEqual(before);
    });

    it("setTurnOrderRollValue (GM) sets both rollValue and hasRollValue -- real request: \"the number (default 0 if no roll)... editable by gm and not others\"", async () => {
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const adminClient = await colyseus.connectTo(room, { accountId: owner.id });
      adminClient.send("addToTurnOrder", { label: "A" });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const entryId = room.state.turnOrder[0].turnEntryId;
      expect(room.state.turnOrder[0]).toMatchObject({ hasRollValue: false, rollValue: 0 });

      adminClient.send("setTurnOrderRollValue", { turnEntryId: entryId, value: 17 });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(room.state.turnOrder[0]).toMatchObject({ hasRollValue: true, rollValue: 17 });
    });

    it("setTurnOrderRollValue is refused from a non-admin session, even for their OWN character's entry -- unlike add/remove, the sort/display number stays GM-only", async () => {
      const playerAccount = trackedAccount(`WorldRoom-test-turnorder-rollvalue-${Date.now()}`);
      const mine = store.createCharacter(playerAccount.id, "RollValueOwner", [1, 0, 0]);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { accountId: playerAccount.id, characterId: mine.id });
      const player = room.state.players.get(client.sessionId)!;
      client.send("addToTurnOrder", { label: "ignored", instanceId: player.currentInstance.instanceId, characterId: mine.id });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const entryId = room.state.turnOrder[0].turnEntryId;

      client.send("setTurnOrderRollValue", { turnEntryId: entryId, value: 99 });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(room.state.turnOrder[0]).toMatchObject({ hasRollValue: false, rollValue: 0 });
    });

    it("removeCharacterInstance cascades to remove any turn-order entry pointing at that instance", async () => {
      const focused = trackedCharacterOwner();
      const goblin = store.createCharacter(owner.id, "ToRemoveFromTracker", [0, 1, 0]);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const adminClient = await colyseus.connectTo(room, { accountId: owner.id, characterId: focused.id });
      const player = room.state.players.get(adminClient.sessionId)!;
      adminClient.send("placeCharacter", { characterId: goblin.id, x: player.currentInstance.x, y: player.currentInstance.y, z: player.currentInstance.z });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const instance = room.state.otherCharacters.find((o) => o.characterId === goblin.id)!;
      adminClient.send("addToTurnOrder", { label: "ignored", instanceId: instance.instanceId, characterId: goblin.id });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(room.state.turnOrder).toHaveLength(1);

      adminClient.send("removeCharacterInstance", { instanceId: instance.instanceId });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(room.state.turnOrder).toHaveLength(0);
    });

    it("the turn order survives the room being recreated -- real requirement: a mid-combat disconnect/refresh/rejoin must not drop anyone from it", async () => {
      const persistWorld = trackedWorld(game.id, `Turn Order Persistence World ${Date.now()}`, "limestone_slab", SLAB_PARAMS);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: persistWorld.id });
      const adminClient = await colyseus.connectTo(room, { accountId: owner.id });
      adminClient.send("addToTurnOrder", { label: "A" });
      adminClient.send("addToTurnOrder", { label: "B" });
      await new Promise((resolve) => setTimeout(resolve, 50));
      adminClient.send("nextTurn");
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(room.state.turnOrderCurrentIndex).toBe(1);

      const secondRoom = await colyseus.createRoom<WorldRoom>("world", { worldId: persistWorld.id });

      expect(secondRoom.state.turnOrder.map((e) => e.label)).toEqual(["A", "B"]);
      expect(secondRoom.state.turnOrderCurrentIndex).toBe(1);
      expect(secondRoom.state.turnOrderRound).toBe(1);
    });

    function trackedCharacterOwner() {
      return store.createCharacter(owner.id, `Focused-${Date.now()}-${Math.random().toString(36).slice(2)}`, [1, 0, 0]);
    }
  });

  describe("mod load mechanism (MVP goal item 3, docs/ROADMAP.md)", () => {
    it("a world whose PARENT GAME has the example-noop mod enabled has it actually registered when the world's room is created (per-GAME scope, not per-world -- real correction, 2026-10-17)", async () => {
      const owner = trackedAccount(`WorldRoom-test-mod-owner-${Date.now()}`);
      const game = trackedGame(`WorldRoom-test-mod-game-${Date.now()}`, owner.id);
      const world = trackedWorld(game.id, "Mod Test World", "limestone_slab", SLAB_PARAMS);
      store.enableModForGame(game.id, "example-noop");

      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      // Loading is fire-and-forget in onCreate (not awaited -- see that
      // method's own comment on why), so give it a tick to actually run.
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(room.modLoader.isLoaded("example-noop")).toBe(true);
      // Dynamic import with a computed path, not a static relative
      // specifier -- the real fixture lives outside tsconfig's `rootDir`
      // (packages/server/mods/, deliberately not mixed into the compiled
      // source tree), which a static import would fail typecheck against.
      const fixture = (await import(pathToFileURL(join(process.cwd(), "mods", "example-noop", "entry.ts")).href)) as { registered: boolean };
      expect(fixture.registered).toBe(true);
    });

    it("a world with no mods enabled doesn't load anything", async () => {
      const owner = trackedAccount(`WorldRoom-test-no-mod-owner-${Date.now()}`);
      const game = trackedGame(`WorldRoom-test-no-mod-game-${Date.now()}`, owner.id);
      const world = trackedWorld(game.id, "No Mod Test World", "limestone_slab", SLAB_PARAMS);

      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(room.modLoader.isLoaded("example-noop")).toBe(false);
    });
  });

  describe("GM-only seeThroughWalls toggle (gmPanel.ts)", () => {
    it("a world's room state initializes seeThroughWalls from its PARENT GAME's persisted value, defaulting true", async () => {
      const owner = trackedAccount(`WorldRoom-test-stw-owner-${Date.now()}`);
      const game = trackedGame(`WorldRoom-test-stw-game-${Date.now()}`, owner.id);
      const world = trackedWorld(game.id, "SeeThroughWalls Test World", "limestone_slab", SLAB_PARAMS);

      const defaultRoom = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      expect(defaultRoom.state.seeThroughWalls).toBe(true);

      store.setSeeThroughWallsForGame(game.id, false);
      const freshWorld = trackedWorld(game.id, "SeeThroughWalls Test World 2", "limestone_slab", SLAB_PARAMS);
      const offRoom = await colyseus.createRoom<WorldRoom>("world", { worldId: freshWorld.id });
      expect(offRoom.state.seeThroughWalls).toBe(false);
    });

    it("setSeeThroughWalls is ignored from a non-admin, and updates the Schema-synced state + persists to the parent game when sent by the admin", async () => {
      const owner = trackedAccount(`WorldRoom-test-stw-admin-owner-${Date.now()}`);
      const stranger = trackedAccount(`WorldRoom-test-stw-admin-stranger-${Date.now()}`);
      const game = trackedGame(`WorldRoom-test-stw-admin-game-${Date.now()}`, owner.id);
      const world = trackedWorld(game.id, "SeeThroughWalls Admin Test World", "limestone_slab", SLAB_PARAMS);

      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const adminClient = await colyseus.connectTo(room, { accountId: owner.id });
      const strangerClient = await colyseus.connectTo(room, { accountId: stranger.id });

      strangerClient.send("setSeeThroughWalls", { enabled: false });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(room.state.seeThroughWalls).toBe(true);
      expect(store.getGame(game.id)?.seeThroughWalls).toBe(true);

      adminClient.send("setSeeThroughWalls", { enabled: false });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(room.state.seeThroughWalls).toBe(false);
      expect(store.getGame(game.id)?.seeThroughWalls).toBe(false);
    });
  });

  describe("waypoint/distance measurement (docs/BATTLE_SYSTEM.md)", () => {
    it("addWaypoint pushes to the sender's OWN waypoint chain while enabled, and is a no-op while disabled", async () => {
      const owner = trackedAccount(`WorldRoom-test-wp-add-owner-${Date.now()}`);
      const game = trackedGame(`WorldRoom-test-wp-add-game-${Date.now()}`, owner.id);
      const world = trackedWorld(game.id, "Waypoint Add Test World", "limestone_slab", SLAB_PARAMS);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { accountId: owner.id });

      client.send("addWaypoint", { x: 1.5, y: 2.5, z: 3.5 }); // waypointsEnabled defaults false
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(room.state.players.get(client.sessionId)!.waypoints).toHaveLength(0);

      room.state.waypointsEnabled = true;
      client.send("addWaypoint", { x: 1.5, y: 2.5, z: 3.5 });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const waypoints = room.state.players.get(client.sessionId)!.waypoints;
      expect(waypoints).toHaveLength(1);
      expect(waypoints[0]).toMatchObject({ x: 1.5, y: 2.5, z: 3.5 });
    });

    it("removeWaypoint pops the LAST waypoint off the sender's own chain, and is a no-op while disabled or empty", async () => {
      const owner = trackedAccount(`WorldRoom-test-wp-remove-owner-${Date.now()}`);
      const game = trackedGame(`WorldRoom-test-wp-remove-game-${Date.now()}`, owner.id);
      const world = trackedWorld(game.id, "Waypoint Remove Test World", "limestone_slab", SLAB_PARAMS);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { accountId: owner.id });
      room.state.waypointsEnabled = true;
      client.send("addWaypoint", { x: 1, y: 1, z: 1 });
      client.send("addWaypoint", { x: 2, y: 2, z: 2 });
      await new Promise((resolve) => setTimeout(resolve, 50));

      room.state.waypointsEnabled = false;
      client.send("removeWaypoint");
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(room.state.players.get(client.sessionId)!.waypoints).toHaveLength(2); // disabled -- no-op

      room.state.waypointsEnabled = true;
      client.send("removeWaypoint");
      await new Promise((resolve) => setTimeout(resolve, 50));
      const remaining = room.state.players.get(client.sessionId)!.waypoints;
      expect(remaining).toHaveLength(1);
      expect(remaining[0]).toMatchObject({ x: 1, y: 1, z: 1 }); // the SECOND one was removed, not the first
    });

    it("clearWaypoints wipes the sender's whole chain -- real request: \"Finalizing the current waypoint chain\" (Enter)", async () => {
      const owner = trackedAccount(`WorldRoom-test-wp-clear-owner-${Date.now()}`);
      const game = trackedGame(`WorldRoom-test-wp-clear-game-${Date.now()}`, owner.id);
      const world = trackedWorld(game.id, "Waypoint Clear Test World", "limestone_slab", SLAB_PARAMS);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { accountId: owner.id });
      room.state.waypointsEnabled = true;
      client.send("addWaypoint", { x: 1, y: 1, z: 1 });
      client.send("addWaypoint", { x: 2, y: 2, z: 2 });
      await new Promise((resolve) => setTimeout(resolve, 50));

      client.send("clearWaypoints");
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(room.state.players.get(client.sessionId)!.waypoints).toHaveLength(0);
    });

    it("a session's own waypoint chain is independent of another session's", async () => {
      const owner = trackedAccount(`WorldRoom-test-wp-independent-owner-${Date.now()}`);
      const game = trackedGame(`WorldRoom-test-wp-independent-game-${Date.now()}`, owner.id);
      const world = trackedWorld(game.id, "Waypoint Independent Test World", "limestone_slab", SLAB_PARAMS);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const a = await colyseus.connectTo(room, { accountId: owner.id });
      const b = await colyseus.connectTo(room);
      room.state.waypointsEnabled = true; // after both already joined -- neither gets an automatic core waypoint from THIS

      a.send("addWaypoint", { x: 1, y: 1, z: 1 });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(room.state.players.get(a.sessionId)!.waypoints).toHaveLength(1);
      expect(room.state.players.get(b.sessionId)!.waypoints).toHaveLength(0);
    });

    it("toggleWaypoints (GM-only) flips waypointsEnabled and persists it, refused from a non-admin", async () => {
      const owner = trackedAccount(`WorldRoom-test-wp-toggle-owner-${Date.now()}`);
      const stranger = trackedAccount(`WorldRoom-test-wp-toggle-stranger-${Date.now()}`);
      const game = trackedGame(`WorldRoom-test-wp-toggle-game-${Date.now()}`, owner.id);
      const world = trackedWorld(game.id, "Waypoint Toggle Test World", "limestone_slab", SLAB_PARAMS);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const adminClient = await colyseus.connectTo(room, { accountId: owner.id });
      const strangerClient = await colyseus.connectTo(room, { accountId: stranger.id });
      expect(room.state.waypointsEnabled).toBe(false);

      strangerClient.send("toggleWaypoints");
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(room.state.waypointsEnabled).toBe(false); // refused

      adminClient.send("toggleWaypoints");
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(room.state.waypointsEnabled).toBe(true);
      expect(store.getWorld(world.id)?.waypointsEnabled).toBe(true);

      adminClient.send("toggleWaypoints");
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(room.state.waypointsEnabled).toBe(false);
      expect(store.getWorld(world.id)?.waypointsEnabled).toBe(false);
    });

    it("auto-ON: adding the FIRST entry to an empty turn order enables waypoints, when the checkbox is on (the default)", async () => {
      const owner = trackedAccount(`WorldRoom-test-wp-autoon-owner-${Date.now()}`);
      const game = trackedGame(`WorldRoom-test-wp-autoon-game-${Date.now()}`, owner.id);
      const world = trackedWorld(game.id, "Waypoint AutoOn Test World", "limestone_slab", SLAB_PARAMS);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const adminClient = await colyseus.connectTo(room, { accountId: owner.id });
      expect(room.state.waypointAutoOnWithTurnOrder).toBe(true); // default
      expect(room.state.waypointsEnabled).toBe(false);

      adminClient.send("addToTurnOrder", { label: "A" });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(room.state.waypointsEnabled).toBe(true);
      expect(store.getWorld(world.id)?.waypointsEnabled).toBe(true);
    });

    it("auto-ON does nothing when its checkbox is off", async () => {
      const owner = trackedAccount(`WorldRoom-test-wp-autoonoff-owner-${Date.now()}`);
      const game = trackedGame(`WorldRoom-test-wp-autoonoff-game-${Date.now()}`, owner.id);
      store.setWaypointAutoOnForGame(game.id, false);
      const world = trackedWorld(game.id, "Waypoint AutoOn-Off Test World", "limestone_slab", SLAB_PARAMS);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const adminClient = await colyseus.connectTo(room, { accountId: owner.id });
      expect(room.state.waypointAutoOnWithTurnOrder).toBe(false);

      adminClient.send("addToTurnOrder", { label: "A" });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(room.state.waypointsEnabled).toBe(false); // the GM must turn it on manually
    });

    it("auto-OFF: removing the LAST entry disables waypoints, when the checkbox is on (the default)", async () => {
      const owner = trackedAccount(`WorldRoom-test-wp-autooff-owner-${Date.now()}`);
      const game = trackedGame(`WorldRoom-test-wp-autooff-game-${Date.now()}`, owner.id);
      const world = trackedWorld(game.id, "Waypoint AutoOff Test World", "limestone_slab", SLAB_PARAMS);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const adminClient = await colyseus.connectTo(room, { accountId: owner.id });
      adminClient.send("addToTurnOrder", { label: "A" }); // also auto-enables waypoints
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(room.state.waypointsEnabled).toBe(true);
      const entryId = room.state.turnOrder[0].turnEntryId;

      adminClient.send("removeFromTurnOrder", { turnEntryId: entryId });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(room.state.waypointsEnabled).toBe(false);
      expect(store.getWorld(world.id)?.waypointsEnabled).toBe(false);
    });

    it("auto-OFF does nothing when its checkbox is off -- a GM measuring between combats isn't interrupted", async () => {
      const owner = trackedAccount(`WorldRoom-test-wp-autooffoff-owner-${Date.now()}`);
      const game = trackedGame(`WorldRoom-test-wp-autooffoff-game-${Date.now()}`, owner.id);
      store.setWaypointAutoOffForGame(game.id, false);
      const world = trackedWorld(game.id, "Waypoint AutoOff-Off Test World", "limestone_slab", SLAB_PARAMS);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const adminClient = await colyseus.connectTo(room, { accountId: owner.id });
      adminClient.send("addToTurnOrder", { label: "A" });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const entryId = room.state.turnOrder[0].turnEntryId;

      adminClient.send("removeFromTurnOrder", { turnEntryId: entryId });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(room.state.waypointsEnabled).toBe(true); // stays on
    });

    it("the manual toggle overrides the current state even with entries still in the order, and a LATER qualifying transition overwrites it again", async () => {
      const owner = trackedAccount(`WorldRoom-test-wp-override-owner-${Date.now()}`);
      const game = trackedGame(`WorldRoom-test-wp-override-game-${Date.now()}`, owner.id);
      const world = trackedWorld(game.id, "Waypoint Override Test World", "limestone_slab", SLAB_PARAMS);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const adminClient = await colyseus.connectTo(room, { accountId: owner.id });
      adminClient.send("addToTurnOrder", { label: "A" });
      adminClient.send("addToTurnOrder", { label: "B" });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(room.state.waypointsEnabled).toBe(true); // auto-on from the first add

      // Manual OFF while the order still has 2 entries -- neither
      // auto-rule applies (no 0<->1+ transition happened).
      adminClient.send("toggleWaypoints");
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(room.state.waypointsEnabled).toBe(false);

      const [aId] = room.state.turnOrder.map((e) => e.turnEntryId);
      adminClient.send("removeFromTurnOrder", { turnEntryId: aId }); // 2 -> 1, still no transition
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(room.state.waypointsEnabled).toBe(false); // untouched

      const [bId] = room.state.turnOrder.map((e) => e.turnEntryId);
      adminClient.send("removeFromTurnOrder", { turnEntryId: bId }); // 1 -> 0, a real transition
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(room.state.waypointsEnabled).toBe(false); // auto-off fires too, but it was already false

      adminClient.send("addToTurnOrder", { label: "C" }); // 0 -> 1, auto-ON overwrites the manual OFF
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(room.state.waypointsEnabled).toBe(true);
    });

    it("setWaypointAutoOn/setWaypointAutoOff (GM-only) persist to the parent GAME, and a fresh room for the same game reflects them", async () => {
      const owner = trackedAccount(`WorldRoom-test-wp-settings-owner-${Date.now()}`);
      const stranger = trackedAccount(`WorldRoom-test-wp-settings-stranger-${Date.now()}`);
      const game = trackedGame(`WorldRoom-test-wp-settings-game-${Date.now()}`, owner.id);
      const world = trackedWorld(game.id, "Waypoint Settings Test World", "limestone_slab", SLAB_PARAMS);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const adminClient = await colyseus.connectTo(room, { accountId: owner.id });
      const strangerClient = await colyseus.connectTo(room, { accountId: stranger.id });

      strangerClient.send("setWaypointAutoOn", { enabled: false });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(room.state.waypointAutoOnWithTurnOrder).toBe(true); // refused

      adminClient.send("setWaypointAutoOn", { enabled: false });
      adminClient.send("setWaypointAutoOff", { enabled: false });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(room.state.waypointAutoOnWithTurnOrder).toBe(false);
      expect(room.state.waypointAutoOffWithoutTurnOrder).toBe(false);
      expect(store.getGame(game.id)?.waypointAutoOnWithTurnOrder).toBe(false);
      expect(store.getGame(game.id)?.waypointAutoOffWithoutTurnOrder).toBe(false);

      const freshWorld = trackedWorld(game.id, "Waypoint Settings Test World 2", "limestone_slab", SLAB_PARAMS);
      const freshRoom = await colyseus.createRoom<WorldRoom>("world", { worldId: freshWorld.id });
      expect(freshRoom.state.waypointAutoOnWithTurnOrder).toBe(false);
      expect(freshRoom.state.waypointAutoOffWithoutTurnOrder).toBe(false);
    });

    it("setWaypointDistanceMetric (GM-only) persists PER-WORLD (not per-game), rejects a non-finite/non-positive p, refused from a non-admin", async () => {
      const owner = trackedAccount(`WorldRoom-test-wp-metric-owner-${Date.now()}`);
      const stranger = trackedAccount(`WorldRoom-test-wp-metric-stranger-${Date.now()}`);
      const game = trackedGame(`WorldRoom-test-wp-metric-game-${Date.now()}`, owner.id);
      const world = trackedWorld(game.id, "Waypoint Metric Test World", "limestone_slab", SLAB_PARAMS);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const adminClient = await colyseus.connectTo(room, { accountId: owner.id });
      const strangerClient = await colyseus.connectTo(room, { accountId: stranger.id });
      expect(room.state.waypointDistanceMetricP).toBe(2); // default Euclidean

      strangerClient.send("setWaypointDistanceMetric", { p: 1 });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(room.state.waypointDistanceMetricP).toBe(2); // refused

      adminClient.send("setWaypointDistanceMetric", { p: 0 });
      adminClient.send("setWaypointDistanceMetric", { p: NaN });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(room.state.waypointDistanceMetricP).toBe(2); // both rejected

      adminClient.send("setWaypointDistanceMetric", { p: 1 }); // Manhattan
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(room.state.waypointDistanceMetricP).toBe(1);
      expect(store.getWorld(world.id)?.waypointDistanceMetricP).toBe(1);

      // Per-WORLD, not per-game -- a second world in the SAME game
      // still defaults to Euclidean.
      const otherWorld = trackedWorld(game.id, "Waypoint Metric Test World 2", "limestone_slab", SLAB_PARAMS);
      const otherRoom = await colyseus.createRoom<WorldRoom>("world", { worldId: otherWorld.id });
      expect(otherRoom.state.waypointDistanceMetricP).toBe(2);
    });

    it("waypointsEnabled/metric survive a room being recreated, but a session's own waypoint chain does NOT (not persisted -- scratch measurement data, not something the unreliable-connections principle protects); a fresh core waypoint is stamped instead, since waypoints are still on", async () => {
      const owner = trackedAccount(`WorldRoom-test-wp-persist-owner-${Date.now()}`);
      const game = trackedGame(`WorldRoom-test-wp-persist-game-${Date.now()}`, owner.id);
      const world = trackedWorld(game.id, "Waypoint Persist Test World", "limestone_slab", SLAB_PARAMS);
      const firstRoom = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(firstRoom, { accountId: owner.id });
      firstRoom.state.waypointsEnabled = true;
      client.send("addWaypoint", { x: 1, y: 1, z: 1 });
      await new Promise((resolve) => setTimeout(resolve, 50));
      store.setWaypointsEnabledForWorld(world.id, true); // the manual path (toggleWaypoints) would do this; set directly since this test bypasses that handler

      const secondRoom = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      expect(secondRoom.state.waypointsEnabled).toBe(true); // persisted
      const secondClient = await colyseus.connectTo(secondRoom, { accountId: owner.id });
      const resumedWaypoints = secondRoom.state.players.get(secondClient.sessionId)!.waypoints;
      expect(resumedWaypoints).toHaveLength(1); // NOT the old chain -- a FRESH core, since waypoints are still on at join time
      expect(resumedWaypoints[0].isCore).toBe(true);
      expect([resumedWaypoints[0].x, resumedWaypoints[0].y, resumedWaypoints[0].z]).not.toEqual([1, 1, 1]); // not the stale (1,1,1) from before -- wherever they actually spawned
    });

    it("resetAllCoreWaypoints (triggered by turning waypoints on, auto or manual) replaces EVERY connected session's own chain with just one fresh core at their current position, discarding any stale chain from before", async () => {
      const owner = trackedAccount(`WorldRoom-test-wp-core-owner-${Date.now()}`);
      const game = trackedGame(`WorldRoom-test-wp-core-game-${Date.now()}`, owner.id);
      const world = trackedWorld(game.id, "Waypoint Core Test World", "limestone_slab", SLAB_PARAMS);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const adminClient = await colyseus.connectTo(room, { accountId: owner.id });
      const player = room.state.players.get(adminClient.sessionId)!;

      adminClient.send("addToTurnOrder", { label: "A" }); // 0 -> 1 entries, auto-ON
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(player.waypoints).toHaveLength(1);
      expect(player.waypoints[0]).toMatchObject({ isCore: true, x: player.currentInstance.x, y: player.currentInstance.y, z: player.currentInstance.z });
    });

    it("removeWaypoint refuses to remove the core waypoint even when it's the only one left -- real request: \"there should be a core waypoint... that can't be removed from the list\"", async () => {
      const owner = trackedAccount(`WorldRoom-test-wp-core-remove-owner-${Date.now()}`);
      const game = trackedGame(`WorldRoom-test-wp-core-remove-game-${Date.now()}`, owner.id);
      const world = trackedWorld(game.id, "Waypoint Core Remove Test World", "limestone_slab", SLAB_PARAMS);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const adminClient = await colyseus.connectTo(room, { accountId: owner.id });
      adminClient.send("addToTurnOrder", { label: "A" }); // auto-ON, stamps the core
      await new Promise((resolve) => setTimeout(resolve, 50));
      const player = room.state.players.get(adminClient.sessionId)!;
      expect(player.waypoints).toHaveLength(1);

      adminClient.send("removeWaypoint");
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(player.waypoints).toHaveLength(1); // refused -- still just the core

      adminClient.send("addWaypoint", { x: 9, y: 9, z: 9 });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(player.waypoints).toHaveLength(2);

      adminClient.send("removeWaypoint"); // removes the NON-core one
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(player.waypoints).toHaveLength(1);
      expect(player.waypoints[0].isCore).toBe(true);
    });

    it("clearWaypoints keeps the core waypoint, dropping everything else", async () => {
      const owner = trackedAccount(`WorldRoom-test-wp-core-clear-owner-${Date.now()}`);
      const game = trackedGame(`WorldRoom-test-wp-core-clear-game-${Date.now()}`, owner.id);
      const world = trackedWorld(game.id, "Waypoint Core Clear Test World", "limestone_slab", SLAB_PARAMS);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const adminClient = await colyseus.connectTo(room, { accountId: owner.id });
      adminClient.send("addToTurnOrder", { label: "A" }); // auto-ON, stamps the core
      await new Promise((resolve) => setTimeout(resolve, 50));
      adminClient.send("addWaypoint", { x: 9, y: 9, z: 9 });
      adminClient.send("addWaypoint", { x: 8, y: 8, z: 8 });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const player = room.state.players.get(adminClient.sessionId)!;
      expect(player.waypoints).toHaveLength(3);

      adminClient.send("clearWaypoints");
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(player.waypoints).toHaveLength(1);
      expect(player.waypoints[0].isCore).toBe(true);
    });

    it("a latecomer joining WHILE waypoints are already on gets a core waypoint too", async () => {
      const owner = trackedAccount(`WorldRoom-test-wp-core-latecomer-owner-${Date.now()}`);
      const latecomer = trackedAccount(`WorldRoom-test-wp-core-latecomer-${Date.now()}`);
      const game = trackedGame(`WorldRoom-test-wp-core-latecomer-game-${Date.now()}`, owner.id);
      const world = trackedWorld(game.id, "Waypoint Core Latecomer Test World", "limestone_slab", SLAB_PARAMS);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const adminClient = await colyseus.connectTo(room, { accountId: owner.id });
      adminClient.send("addToTurnOrder", { label: "A" }); // auto-ON
      await new Promise((resolve) => setTimeout(resolve, 50));

      const latecomerClient = await colyseus.connectTo(room, { accountId: latecomer.id });
      const latecomerPlayer = room.state.players.get(latecomerClient.sessionId)!;
      expect(latecomerPlayer.waypoints).toHaveLength(1);
      expect(latecomerPlayer.waypoints[0]).toMatchObject({ isCore: true, x: latecomerPlayer.currentInstance.x, y: latecomerPlayer.currentInstance.y, z: latecomerPlayer.currentInstance.z });
    });

    it("nextTurn (GM-only) re-stamps the core waypoint at the player's CURRENT position and clears the rest of the chain -- real request: \"the core waypoint should re-stamp on every next turn, and... the whole list... should clear, and just that core waypoint should be left\"", async () => {
      const owner = trackedAccount(`WorldRoom-test-wp-core-nextturn-owner-${Date.now()}`);
      const game = trackedGame(`WorldRoom-test-wp-core-nextturn-game-${Date.now()}`, owner.id);
      const world = trackedWorld(game.id, "Waypoint Core NextTurn Test World", "limestone_slab", SLAB_PARAMS);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const adminClient = await colyseus.connectTo(room, { accountId: owner.id });
      adminClient.send("addToTurnOrder", { label: "A" }); // auto-ON, stamps the first core
      await new Promise((resolve) => setTimeout(resolve, 50));
      const player = room.state.players.get(adminClient.sessionId)!;
      const originalCorePos = { x: player.waypoints[0].x, y: player.waypoints[0].y, z: player.waypoints[0].z };

      // The player wanders around during their turn, placing waypoints
      // along the way, then moves to a new live position.
      adminClient.send("addWaypoint", { x: 9, y: 9, z: 9 });
      adminClient.send("addWaypoint", { x: 8, y: 8, z: 8 });
      adminClient.send("pos", { x: 20, y: 20, z: 20, yaw: 0 });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(player.waypoints).toHaveLength(3);

      adminClient.send("nextTurn");
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(player.waypoints).toHaveLength(1); // the whole chain cleared, just the core left
      expect(player.waypoints[0].isCore).toBe(true);
      expect([player.waypoints[0].x, player.waypoints[0].y, player.waypoints[0].z]).toEqual([20, 20, 20]); // re-stamped at the CURRENT position
      expect([player.waypoints[0].x, player.waypoints[0].y, player.waypoints[0].z]).not.toEqual([originalCorePos.x, originalCorePos.y, originalCorePos.z]);
    });

    it("nextTurn still re-stamps the core even when the player never moved -- a harmless no-op position-wise, but still clears any waypoints placed that turn", async () => {
      const owner = trackedAccount(`WorldRoom-test-wp-core-nextturn-nomove-owner-${Date.now()}`);
      const game = trackedGame(`WorldRoom-test-wp-core-nextturn-nomove-game-${Date.now()}`, owner.id);
      const world = trackedWorld(game.id, "Waypoint Core NextTurn NoMove Test World", "limestone_slab", SLAB_PARAMS);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const adminClient = await colyseus.connectTo(room, { accountId: owner.id });
      adminClient.send("addToTurnOrder", { label: "A" });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const player = room.state.players.get(adminClient.sessionId)!;
      const corePos = { x: player.waypoints[0].x, y: player.waypoints[0].y, z: player.waypoints[0].z };
      adminClient.send("addWaypoint", { x: 9, y: 9, z: 9 });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(player.waypoints).toHaveLength(2);

      adminClient.send("nextTurn"); // no "pos" sent -- player stayed put
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(player.waypoints).toHaveLength(1);
      expect([player.waypoints[0].x, player.waypoints[0].y, player.waypoints[0].z]).toEqual([corePos.x, corePos.y, corePos.z]);
    });

    it("setWaypointColor (self-only, no admin needed) sets a session's own marker color", async () => {
      const owner = trackedAccount(`WorldRoom-test-wp-color-owner-${Date.now()}`);
      const game = trackedGame(`WorldRoom-test-wp-color-game-${Date.now()}`, owner.id);
      const world = trackedWorld(game.id, "Waypoint Color Test World", "limestone_slab", SLAB_PARAMS);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { accountId: owner.id });
      const player = room.state.players.get(client.sessionId)!;
      expect([player.waypointColorR, player.waypointColorG, player.waypointColorB]).toEqual([1, 0.9, 0.2]); // default yellow

      client.send("setWaypointColor", { r: 0.2, g: 0.6, b: 1 });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect([player.waypointColorR, player.waypointColorG, player.waypointColorB]).toEqual([0.2, 0.6, 1]);
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
