import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
      expect({ x: joined.x, y: joined.y, z: joined.z }).toEqual(anchorPos);
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
      expect(joined.characterId).toBe(character.id);
      expect(joined.characterName).toBe("Aria");
      expect([joined.tokenColorR, joined.tokenColorG, joined.tokenColorB]).toEqual([0.5, 0.25, 0.75]);
      expect(joined.bars).toHaveLength(1);
      expect(joined.bars[0]).toMatchObject({ variableId: "hp", label: "HP", value: 7, max: 10, colorR: 0.75, colorG: 0.22, colorB: 0.17 });
      // MVP goal item 4 follow-up ("I tried adjusting the character width/height/depth and that did nothing") -- real bug fix.
      expect([joined.bodyWidth, joined.bodyHeight, joined.bodyDepth]).toEqual([1.0, 2.2, 0.8]);

      const withoutCharacter = await colyseus.connectTo(room);
      const joinedBare = room.state.players.get(withoutCharacter.sessionId)!;
      expect(joinedBare.characterId).toBe("");
      expect(joinedBare.bars).toHaveLength(0);
      expect([joinedBare.bodyWidth, joinedBare.bodyHeight, joinedBare.bodyDepth]).toEqual([0.6, 1.8, 0.6]); // RESERVED_BODY_SIZE_VARIABLES' own shared defaults

      const withUnknownCharacter = await colyseus.connectTo(room, { characterId: "not-a-real-character" });
      const joinedUnknown = room.state.players.get(withUnknownCharacter.sessionId)!;
      expect(joinedUnknown.characterId).toBe("");
    });

    it("notifyCharacterSheetChanged also refreshes a connected session's body size after a plain REST-style sheet update, same mechanism as the bars fix", async () => {
      const character = store.createCharacter(owner.id, "ResizedViaRest", [1, 0, 0]);
      store.updateCharacterSheet(character.id, null, null, { bodyWidth: 0.6, bodyHeight: 1.8, bodyDepth: 0.6 });
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { characterId: character.id });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(room.state.players.get(client.sessionId)!.bodyHeight).toBe(1.8);

      store.updateCharacterSheet(character.id, null, null, { bodyWidth: 1.2, bodyHeight: 2.4, bodyDepth: 1.2 });
      expect(room.state.players.get(client.sessionId)!.bodyHeight).toBe(1.8); // not yet -- the room doesn't know

      notifyCharacterSheetChanged(character.id);
      expect([room.state.players.get(client.sessionId)!.bodyWidth, room.state.players.get(client.sessionId)!.bodyHeight, room.state.players.get(client.sessionId)!.bodyDepth]).toEqual([1.2, 2.4, 1.2]);
    });

    it("a join with an accountId but no (or an unknown) characterId falls back to that account's default character instead of staying blank", async () => {
      const fallbackOwner = trackedAccount(`WorldRoom-test-fallback-owner-${Date.now()}`);
      const defaultCharacter = store.createCharacter(fallbackOwner.id, "Fallback", [0.1, 0.2, 0.3]);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });

      const noCharacterId = await colyseus.connectTo(room, { accountId: fallbackOwner.id });
      const joinedNoId = room.state.players.get(noCharacterId.sessionId)!;
      expect(joinedNoId.characterId).toBe(defaultCharacter.id);
      expect([joinedNoId.tokenColorR, joinedNoId.tokenColorG, joinedNoId.tokenColorB]).toEqual([0.1, 0.2, 0.3]);

      const unknownCharacterId = await colyseus.connectTo(room, { accountId: fallbackOwner.id, characterId: "not-a-real-character" });
      const joinedUnknownId = room.state.players.get(unknownCharacterId.sessionId)!;
      expect(joinedUnknownId.characterId).toBe(defaultCharacter.id);
    });

    it("a join with an accountId that has no characters yet auto-creates a default one, real request: deleting your last character isn't a dead end", async () => {
      const freshOwner = trackedAccount(`WorldRoom-test-fresh-owner-${Date.now()}`);
      expect(store.listCharactersForAccount(freshOwner.id)).toEqual([]);

      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { accountId: freshOwner.id });
      const joined = room.state.players.get(client.sessionId)!;

      expect(joined.characterId).not.toBe("");
      expect(store.getCharacter(joined.characterId)?.ownerAccountId).toBe(freshOwner.id);
    });

    it("setCharacterVariableValue writes back through store.getCharacter and re-resolves the live Schema bar when sent by the character's own owner", async () => {
      const character = store.createCharacter(owner.id, "Statted", [1, 0, 0]);
      const customSheet = { name: "Sheet", pages: [], variables: [{ id: "hp", label: "HP", type: "xOfY" as const, default: 10, max: 10 }], bars: [{ variableId: "hp", color: [1, 0, 0] as [number, number, number] }] };
      store.updateCharacterSheet(character.id, null, customSheet, { hp: 10 });
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { characterId: character.id });

      client.send("setCharacterVariableValue", { characterId: character.id, variableId: "hp", value: 3 });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(room.state.players.get(client.sessionId)!.bars[0].value).toBe(3);
      expect(store.getCharacter(character.id)?.variableValues.hp).toBe(3);
    });

    it("notifyCharacterSheetChanged refreshes a connected session's bars after a plain REST-style sheet update (real bug found live: a popout/popup/standalone-page edit, which has no WorldRoom connection of its own, left in-game bars stale until an unrelated room message happened to trigger a refresh)", async () => {
      const character = store.createCharacter(owner.id, "RestEdited", [1, 0, 0]);
      const customSheet = { name: "Sheet", pages: [], variables: [{ id: "hp", label: "HP", type: "xOfY" as const, default: 10, max: 10 }], bars: [{ variableId: "hp", color: [1, 0, 0] as [number, number, number] }] };
      store.updateCharacterSheet(character.id, null, customSheet, { hp: 10 });
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { characterId: character.id });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(room.state.players.get(client.sessionId)!.bars[0].value).toBe(10);

      // The REST endpoint's own half (server.ts's putCharacterSheet) --
      // simulated directly here as the plain store write it actually
      // is, with NO room message sent at all.
      store.updateCharacterSheet(character.id, null, customSheet, { hp: 4 });
      expect(room.state.players.get(client.sessionId)!.bars[0].value).toBe(10); // not yet -- the room doesn't know

      notifyCharacterSheetChanged(character.id);
      expect(room.state.players.get(client.sessionId)!.bars[0].value).toBe(4);
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
      const bystander = await colyseus.connectTo(room);

      bystander.send("setCharacterVariableValue", { characterId: character.id, variableId: "hp", value: 1 });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(store.getCharacter(character.id)?.variableValues.hp).toBe(10);
    });

    it("setCharacterToken writes back through store.getCharacter and the live Schema fields when sent by the character's own owner", async () => {
      const character = store.createCharacter(owner.id, "Recolored", [1, 0, 0]);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { characterId: character.id });

      client.send("setCharacterToken", { characterId: character.id, color: [0, 1, 0] });
      await new Promise((resolve) => setTimeout(resolve, 50));

      const synced = room.state.players.get(client.sessionId)!;
      expect([synced.tokenColorR, synced.tokenColorG, synced.tokenColorB]).toEqual([0, 1, 0]);
      expect(store.getCharacter(character.id)?.token).toEqual({ color: [0, 1, 0] });
    });

    it("setStatusEffects writes back through store.getCharacter and the live Schema array when sent by the character's own owner", async () => {
      const character = store.createCharacter(owner.id, "Effected", [0, 0, 1]);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { characterId: character.id });

      client.send("setStatusEffects", { characterId: character.id, statusEffects: [{ icon: "poison.svg", label: "Poisoned" }] });
      await new Promise((resolve) => setTimeout(resolve, 50));

      const synced = room.state.players.get(client.sessionId)!;
      expect(synced.statusEffects.length).toBe(1);
      expect(synced.statusEffects[0].icon).toBe("poison.svg");
      expect(store.getCharacter(character.id)?.statusEffects).toEqual([{ icon: "poison.svg", label: "Poisoned" }]);
    });
  });

  describe("multi-character presence: placement, focus cycling, instance delete (MVP goal item 4 follow-up)", () => {
    const owner = trackedAccount(`WorldRoom-test-multi-owner-${Date.now()}`);
    const game = trackedGame(`WorldRoom-test-multi-game-${Date.now()}`, owner.id);
    const world = trackedWorld(game.id, "Multi-Character Test World", "limestone_slab", SLAB_PARAMS);

    it("placeCharacter adds a new otherCharacters entry for one of the sender's OWN other characters, within range of their focused position", async () => {
      const focused = store.createCharacter(owner.id, "Focused", [1, 0, 0]);
      const placed = store.createCharacter(owner.id, "Placed", [0, 1, 0]);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { accountId: owner.id, characterId: focused.id });
      const player = room.state.players.get(client.sessionId)!;

      client.send("placeCharacter", { characterId: placed.id, x: player.x + 2, y: player.y, z: player.z });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(player.otherCharacters).toHaveLength(1);
      expect(player.otherCharacters[0]).toMatchObject({ characterId: placed.id, characterName: "Placed", x: player.x + 2 });
      expect(player.otherCharacters[0].instanceId).not.toBe(""); // real identity, not derived from characterId
    });

    it("placeCharacter creates a SEPARATE, independent instance each time, even for the SAME character -- real request: \"I can't add multiple instances of the same character. I would want to do that for monsters\"", async () => {
      const focused = store.createCharacter(owner.id, "GoblinHandler", [1, 0, 0]);
      const goblin = store.createCharacter(owner.id, "Goblin", [0, 1, 0]);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { accountId: owner.id, characterId: focused.id });
      const player = room.state.players.get(client.sessionId)!;

      client.send("placeCharacter", { characterId: goblin.id, x: player.x + 1, y: player.y, z: player.z });
      client.send("placeCharacter", { characterId: goblin.id, x: player.x + 2, y: player.y, z: player.z });
      client.send("placeCharacter", { characterId: goblin.id, x: player.x + 3, y: player.y, z: player.z });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(player.otherCharacters).toHaveLength(3); // three goblins, not one moved entry
      expect(player.otherCharacters.every((o) => o.characterId === goblin.id)).toBe(true);
      const instanceIds = player.otherCharacters.map((o) => o.instanceId);
      expect(new Set(instanceIds).size).toBe(3); // each has its own real identity
      expect(player.otherCharacters.map((o) => o.x)).toEqual([player.x + 1, player.x + 2, player.x + 3]); // independent positions, not all moved to the last drop
    });

    it("placeCharacter rejects a drop farther than MAX_CHARACTER_PLACEMENT_DISTANCE from the sender's own live position (never trusts a client-side distance check)", async () => {
      const focused = store.createCharacter(owner.id, "FarFocused", [1, 0, 0]);
      const placed = store.createCharacter(owner.id, "FarPlaced", [0, 1, 0]);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { accountId: owner.id, characterId: focused.id });
      const player = room.state.players.get(client.sessionId)!;

      client.send("placeCharacter", { characterId: placed.id, x: player.x + 9999, y: player.y, z: player.z });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(player.otherCharacters).toHaveLength(0);
    });

    it("placeCharacter rejects a character owned by someone else -- you can only ever place your OWN characters", async () => {
      const focused = store.createCharacter(owner.id, "SelfFocused", [1, 0, 0]);
      const otherOwner = trackedAccount(`WorldRoom-test-multi-otherowner-${Date.now()}`);
      const notMine = store.createCharacter(otherOwner.id, "NotMine", [0, 0, 1]);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { accountId: owner.id, characterId: focused.id });
      const player = room.state.players.get(client.sessionId)!;

      client.send("placeCharacter", { characterId: notMine.id, x: player.x, y: player.y, z: player.z });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(player.otherCharacters).toHaveLength(0);
    });

    it("focusCharacter swaps the focused character and a placed otherCharacters entry's data (position, body size, bars all move with it)", async () => {
      const focused = store.createCharacter(owner.id, "WasFocused", [1, 0, 0]);
      const toFocus = store.createCharacter(owner.id, "WillBeFocused", [0, 1, 0]);
      store.updateCharacterSheet(toFocus.id, null, null, { bodyWidth: 1.0, bodyHeight: 2.0, bodyDepth: 1.0 });
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { accountId: owner.id, characterId: focused.id });
      const player = room.state.players.get(client.sessionId)!;
      const placedAt = { x: player.x + 1, y: player.y, z: player.z + 1 };
      client.send("placeCharacter", { characterId: toFocus.id, ...placedAt });
      await new Promise((resolve) => setTimeout(resolve, 50));

      client.send("focusCharacter", { instanceId: player.otherCharacters[0].instanceId, direction: "next" });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(player.characterId).toBe(toFocus.id);
      expect([player.x, player.y, player.z]).toEqual([placedAt.x, placedAt.y, placedAt.z]);
      expect(player.bodyHeight).toBe(2.0);
      expect(player.otherCharacters).toHaveLength(1);
      expect(player.otherCharacters[0].characterId).toBe(focused.id); // the previously-focused one, snapshotted
      expect(player.otherCharacters[0].instanceId).not.toBe(""); // the snapshot gets its own real identity too
    });

    it("focusCharacter cycles forward through a 3-character ring and returns to the start after 3 'next' presses (Tab)", async () => {
      const a = store.createCharacter(owner.id, "RingA", [1, 0, 0]);
      const b = store.createCharacter(owner.id, "RingB", [0, 1, 0]);
      const c = store.createCharacter(owner.id, "RingC", [0, 0, 1]);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { accountId: owner.id, characterId: a.id });
      const player = room.state.players.get(client.sessionId)!;
      client.send("placeCharacter", { characterId: b.id, x: player.x, y: player.y, z: player.z });
      client.send("placeCharacter", { characterId: c.id, x: player.x, y: player.y, z: player.z });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(player.otherCharacters.map((o) => o.characterId)).toEqual([b.id, c.id]);

      // Tab always targets otherCharacters[0] -- same selection net.ts's own focus-cycling module uses.
      client.send("focusCharacter", { instanceId: player.otherCharacters[0].instanceId, direction: "next" });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(player.characterId).toBe(b.id);
      expect(player.otherCharacters.map((o) => o.characterId)).toEqual([c.id, a.id]);

      client.send("focusCharacter", { instanceId: player.otherCharacters[0].instanceId, direction: "next" });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(player.characterId).toBe(c.id);
      expect(player.otherCharacters.map((o) => o.characterId)).toEqual([a.id, b.id]);

      client.send("focusCharacter", { instanceId: player.otherCharacters[0].instanceId, direction: "next" });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(player.characterId).toBe(a.id);
      expect(player.otherCharacters.map((o) => o.characterId)).toEqual([b.id, c.id]); // back to the exact starting arrangement
    });

    it("focusCharacter's 'previous' direction (Shift+Tab) is the true inverse of 'next' (Tab) -- one of each returns to the exact original state", async () => {
      const a = store.createCharacter(owner.id, "InverseA", [1, 0, 0]);
      const b = store.createCharacter(owner.id, "InverseB", [0, 1, 0]);
      const c = store.createCharacter(owner.id, "InverseC", [0, 0, 1]);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { accountId: owner.id, characterId: a.id });
      const player = room.state.players.get(client.sessionId)!;
      client.send("placeCharacter", { characterId: b.id, x: player.x, y: player.y, z: player.z });
      client.send("placeCharacter", { characterId: c.id, x: player.x, y: player.y, z: player.z });
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Tab (next): targets otherCharacters[0].
      client.send("focusCharacter", { instanceId: player.otherCharacters[0].instanceId, direction: "next" });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(player.characterId).toBe(b.id);

      // Shift+Tab (previous): targets otherCharacters[last] -- same selection net.ts's own module uses.
      client.send("focusCharacter", { instanceId: player.otherCharacters[player.otherCharacters.length - 1].instanceId, direction: "previous" });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(player.characterId).toBe(a.id); // back to the exact original focus
      expect(player.otherCharacters.map((o) => o.characterId)).toEqual([b.id, c.id]); // and the exact original arrangement
    });

    it("focusCharacter is a no-op for an instanceId that isn't one of the sender's own placed instances", async () => {
      const focused = store.createCharacter(owner.id, "StaysFocused", [1, 0, 0]);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { accountId: owner.id, characterId: focused.id });
      const player = room.state.players.get(client.sessionId)!;

      client.send("focusCharacter", { instanceId: "not-a-real-instance", direction: "next" });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(player.characterId).toBe(focused.id);
    });

    it("removeCharacterInstance deletes ONE specific placed instance but never the character record itself, and leaves other instances of the SAME character untouched (right-click 'Delete instance' -- not deleteCharacter/unlinkCharacterFromGame)", async () => {
      const focused = store.createCharacter(owner.id, "KeepsFocus", [1, 0, 0]);
      const goblin = store.createCharacter(owner.id, "ToRemove", [0, 1, 0]);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { accountId: owner.id, characterId: focused.id });
      const player = room.state.players.get(client.sessionId)!;
      client.send("placeCharacter", { characterId: goblin.id, x: player.x, y: player.y, z: player.z });
      client.send("placeCharacter", { characterId: goblin.id, x: player.x + 1, y: player.y, z: player.z });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(player.otherCharacters).toHaveLength(2);
      const [first, second] = player.otherCharacters;

      client.send("removeCharacterInstance", { instanceId: first.instanceId });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(player.otherCharacters).toHaveLength(1);
      expect(player.otherCharacters[0].instanceId).toBe(second.instanceId); // the OTHER goblin instance survives untouched
      expect(store.getCharacter(goblin.id)).toBeDefined(); // the character record itself survives regardless
    });

    it("removeCharacterInstance cannot even address the character the sender is controlling -- it has no instanceId at all (structural, not a separate check): real request, keep at least one controllable instance", async () => {
      const focused = store.createCharacter(owner.id, "CannotSelfDelete", [1, 0, 0]);
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { accountId: owner.id, characterId: focused.id });
      const player = room.state.players.get(client.sessionId)!;

      client.send("removeCharacterInstance", { instanceId: "not-a-real-instance" });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(player.characterId).toBe(focused.id); // unchanged -- still connected and playing as this character
    });

    it("notifyCharacterSheetChanged refreshes EVERY placed instance of a character, not just the first", async () => {
      const focused = store.createCharacter(owner.id, "FocusedForRefresh", [1, 0, 0]);
      const placedChar = store.createCharacter(owner.id, "PlacedForRefresh", [0, 1, 0]);
      const customSheet = { name: "Sheet", pages: [], variables: [{ id: "hp", label: "HP", type: "xOfY" as const, default: 10, max: 10 }], bars: [{ variableId: "hp", color: [1, 0, 0] as [number, number, number] }] };
      store.updateCharacterSheet(placedChar.id, null, customSheet, { hp: 10 });
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { accountId: owner.id, characterId: focused.id });
      const player = room.state.players.get(client.sessionId)!;
      client.send("placeCharacter", { characterId: placedChar.id, x: player.x, y: player.y, z: player.z });
      client.send("placeCharacter", { characterId: placedChar.id, x: player.x + 1, y: player.y, z: player.z });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(player.otherCharacters.map((o) => o.bars[0].value)).toEqual([10, 10]);

      store.updateCharacterSheet(placedChar.id, null, customSheet, { hp: 2 });
      notifyCharacterSheetChanged(placedChar.id);

      expect(player.otherCharacters.map((o) => o.bars[0].value)).toEqual([2, 2]);
    });

    it("setCharacterVariableValue with an instanceId gives independent, per-instance stats -- real request: \"I would want to do that for monsters\" (killing one goblin shouldn't zero out the others)", async () => {
      const focused = store.createCharacter(owner.id, "GoblinKeeper", [1, 0, 0]);
      const goblinSheet = store.createCharacter(owner.id, "IndependentGoblin", [0, 1, 0]);
      const customSheet = { name: "Sheet", pages: [], variables: [{ id: "hp", label: "HP", type: "xOfY" as const, default: 10, max: 10 }], bars: [{ variableId: "hp", color: [1, 0, 0] as [number, number, number] }] };
      store.updateCharacterSheet(goblinSheet.id, null, customSheet, { hp: 10 });
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { accountId: owner.id, characterId: focused.id });
      const player = room.state.players.get(client.sessionId)!;
      client.send("placeCharacter", { characterId: goblinSheet.id, x: player.x, y: player.y, z: player.z });
      client.send("placeCharacter", { characterId: goblinSheet.id, x: player.x + 1, y: player.y, z: player.z });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const [goblinA, goblinB] = player.otherCharacters;

      // Damage ONLY goblin A.
      client.send("setCharacterVariableValue", { characterId: goblinSheet.id, instanceId: goblinA.instanceId, variableId: "hp", value: 3 });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(player.otherCharacters.find((o) => o.instanceId === goblinA.instanceId)!.bars[0].value).toBe(3);
      expect(player.otherCharacters.find((o) => o.instanceId === goblinB.instanceId)!.bars[0].value).toBe(10); // untouched -- independent, not a shared pool
      expect(store.getCharacter(goblinSheet.id)?.variableValues.hp).toBe(10); // the shared record itself is never touched by an instance-scoped edit
    });

    it("setCharacterVariableValue WITHOUT an instanceId still edits the shared character record as before, and does not touch a placed instance's own independent value", async () => {
      const focused = store.createCharacter(owner.id, "SharedEditOwner", [1, 0, 0]);
      const customSheet = { name: "Sheet", pages: [], variables: [{ id: "hp", label: "HP", type: "xOfY" as const, default: 10, max: 10 }], bars: [{ variableId: "hp", color: [1, 0, 0] as [number, number, number] }] };
      store.updateCharacterSheet(focused.id, null, customSheet, { hp: 10 });
      const room = await colyseus.createRoom<WorldRoom>("world", { worldId: world.id });
      const client = await colyseus.connectTo(room, { accountId: owner.id, characterId: focused.id });

      client.send("setCharacterVariableValue", { characterId: focused.id, variableId: "hp", value: 4 });
      await new Promise((resolve) => setTimeout(resolve, 50));

      const player = room.state.players.get(client.sessionId)!;
      expect(player.bars[0].value).toBe(4); // the focused slot, exactly as before this round
      expect(store.getCharacter(focused.id)?.variableValues.hp).toBe(4);
    });
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
