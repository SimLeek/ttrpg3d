import { Room, type Client } from "colyseus";
import { CHUNK_SIZE, AIR, DEFAULT_GENERATOR_ID, encodeChunk, type ChunkRequest, type GeneratorParams } from "@ttrpg3d/shared";
import { WorldState, PlayerState, StatusEffectState, type WorldStateType } from "./WorldState.js";
import type { StatusEffect } from "../data/store.js";
import { fillChunk, spawnPositionFor, blockAt as genBlockAt, type WorldGenInput } from "../world/worldGen.js";
import { createWorldStorage, type WorldStorage } from "../world/storage.js";
import { mod } from "../world/mathUtils.js";
import { store } from "../data/store.js";
import { join } from "node:path";

/** Fallback used only if this room's worldId has no real WorldRecord in store.ts (e.g. a room created directly with an arbitrary id, no world ever registered) -- same "don't throw, work with a sensible default" spirit the old worldId fallback below already had. */
const DEFAULT_WORLD_GEN: WorldGenInput = { generatorId: DEFAULT_GENERATOR_ID, params: {} as GeneratorParams };

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

interface JoinOptions {
  name?: string;
  /** Lobby-account id (packages/client/src/api.ts's Account.id) -- used ONLY to check world owner/admin/root status server-side (store.isWorldAdmin), per the core/mod-boundary plan's GM admin-override escape hatch. Never trusted blindly: a forged/missing id just means "not admin," checked fresh against the store, not taken from the client as-is. */
  accountId?: string;
  /** MVP goal items 1-2 (docs/ROADMAP.md) -- resolved server-side via store.getCharacter in onJoin, never trusted as-is. A missing/unknown id is a real state (no character selected yet), not an error -- the player simply joins with no token. */
  characterId?: string;
}

type CharacterStat = "hp" | "maxHp" | "mp" | "maxMp";
const CHARACTER_STATS: readonly CharacterStat[] = ["hp", "maxHp", "mp", "maxMp"];

interface SetCharacterStatMessage {
  characterId: string;
  stat: CharacterStat;
  value: number;
}

interface SetStatusEffectsMessage {
  characterId: string;
  statusEffects: StatusEffect[];
}

interface SetCharacterTokenMessage {
  characterId: string;
  color: [number, number, number];
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
  /** Looked up once in onCreate (store.getWorld), not re-fetched per chunk -- a world's generatorId/params don't change mid-session. Falls back to DEFAULT_WORLD_GEN if no real WorldRecord exists for this id (see that constant's own doc). */
  worldGen: WorldGenInput = DEFAULT_WORLD_GEN;

  // GM admin-override escape hatch state (core/mod-boundary plan) -- which
  // currently-connected sessions are this world's owner/admin/root,
  // tracked server-side rather than trusting a client-sent flag (checked
  // once at join via store.isWorldAdmin, not re-derived per message).
  private adminSessionIds = new Set<string>();

  // Respawn anchor: real bug found live ("the respawn anchor doesn't seem
  // to persist when switching pages") -- it used to live ONLY in this
  // room's in-memory Schema state. Colyseus disposes an empty room by
  // default, which is exactly what happens leaving a page during a
  // switch (pageManager.ts's stop()+startGame() cycle) in solo/small-
  // group testing -- switching back created a FRESH room with the anchor
  // silently reset. Now persisted to the WorldRecord itself
  // (store.setWorldRespawnAnchor), seeded back into Schema state below on
  // room creation so it survives a room being recreated. worldBottomY is
  // still a fixed schema default for every world (see WorldState.ts's
  // DEFAULT_WORLD_BOTTOM_Y doc) -- real per-world config is Phase 7
  // DM-tools scope.

  onCreate(options?: { worldId?: string }) {
    this.worldId = options?.worldId || "default";
    this.storage = createWorldStorage(join(process.cwd(), "data", "worlds"), this.worldId);
    this.setState(new WorldState());

    const world = store.getWorld(this.worldId);
    if (world) this.worldGen = { generatorId: world.generatorId, params: world.params };
    if (world?.respawnAnchor) {
      this.state.hasRespawnAnchor = true;
      this.state.respawnAnchorX = world.respawnAnchor.x;
      this.state.respawnAnchorY = world.respawnAnchor.y;
      this.state.respawnAnchorZ = world.respawnAnchor.z;
    }

    // Admin-only: sets the shared respawn anchor (Schema fields, auto-
    // synced to every client -- same mechanism the "pos" handler below
    // already relies on for x/y/z/yaw, no manual broadcast needed) to the
    // sender's current position. The core respawnPlayer/setAnchor
    // *functions* are this plus respawnControl.ts's client-side
    // teleportTo call; this message IS the "calling them is mod/policy"
    // layer the plan described (gated to admin here, not pluggable yet --
    // see the plan's explicit out-of-scope note on that).
    this.onMessage("setRespawnAnchor", (client) => {
      if (!this.adminSessionIds.has(client.sessionId)) return;
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      // Real request: "it shouldn't be able to be set underground" --
      // genuinely reachable even for an admin (NoclipFlyProvider's whole
      // point is passing through terrain, so a GM setting an anchor mid-
      // fly could easily be inside solid rock). Refuse rather than
      // silently accept a bad anchor -- same two-voxels-of-headroom check
      // worldGen.ts's own safe-spawn scan uses.
      const px = Math.floor(player.x);
      const py = Math.floor(player.y);
      const pz = Math.floor(player.z);
      const isSafe = genBlockAt(this.worldId, px, py, pz, this.worldGen) === AIR && genBlockAt(this.worldId, px, py + 1, pz, this.worldGen) === AIR;
      if (!isSafe) return;

      this.state.hasRespawnAnchor = true;
      this.state.respawnAnchorX = player.x;
      this.state.respawnAnchorY = player.y;
      this.state.respawnAnchorZ = player.z;
      store.setWorldRespawnAnchor(this.worldId, { x: player.x, y: player.y, z: player.z });
    });

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
      fillChunk(voxels, CHUNK_SIZE, cx * CHUNK_SIZE, cy * CHUNK_SIZE, cz * CHUNK_SIZE, this.worldId, this.worldGen);
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
        fillChunk(voxels, CHUNK_SIZE, cx * CHUNK_SIZE, cy * CHUNK_SIZE, cz * CHUNK_SIZE, this.worldId, this.worldGen);
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

    // Click-to-edit HP/MP backend (MVP goal items 1-2). Gated to the
    // editing character's own owner session or an admin -- same spirit as
    // setRespawnAnchor's admin gate above, plus a self-edit allowance since
    // this is a per-character stat a player edits on their own token.
    this.onMessage<SetCharacterStatMessage>("setCharacterStat", (client, { characterId, stat, value }) => {
      if (!CHARACTER_STATS.includes(stat)) return;
      const sender = this.state.players.get(client.sessionId);
      const isSelf = sender?.characterId === characterId;
      if (!isSelf && !this.adminSessionIds.has(client.sessionId)) return;

      store.updateCharacterStats(characterId, stat, value);
      for (const player of this.state.players.values()) {
        if (player.characterId === characterId) player[stat] = value;
      }
    });

    // Backs the "Select status effects" context-menu item -- same gating
    // as setCharacterStat above.
    this.onMessage<SetStatusEffectsMessage>("setStatusEffects", (client, { characterId, statusEffects }) => {
      const sender = this.state.players.get(client.sessionId);
      const isSelf = sender?.characterId === characterId;
      if (!isSelf && !this.adminSessionIds.has(client.sessionId)) return;

      store.setCharacterStatusEffects(characterId, statusEffects);
      for (const player of this.state.players.values()) {
        if (player.characterId !== characterId) continue;
        player.statusEffects.clear();
        for (const effect of statusEffects) {
          const effectState = new StatusEffectState();
          effectState.icon = effect.icon;
          effectState.label = effect.label;
          player.statusEffects.push(effectState);
        }
      }
    });

    // Backs the "Edit token properties" context-menu item -- same gating
    // as setCharacterStat/setStatusEffects above.
    this.onMessage<SetCharacterTokenMessage>("setCharacterToken", (client, { characterId, color }) => {
      const sender = this.state.players.get(client.sessionId);
      const isSelf = sender?.characterId === characterId;
      if (!isSelf && !this.adminSessionIds.has(client.sessionId)) return;

      store.setCharacterToken(characterId, color);
      for (const player of this.state.players.values()) {
        if (player.characterId !== characterId) continue;
        player.tokenColorR = color[0];
        player.tokenColorG = color[1];
        player.tokenColorB = color[2];
      }
    });
  }

  onDispose() {
    this.storage.close();
  }

  onJoin(client: Client, options?: JoinOptions) {
    const player = new PlayerState();
    player.name = options?.name || `Player-${client.sessionId.slice(0, 4)}`;
    // Join at the admin-set anchor if one exists (a DM-prepared landing
    // spot, e.g. "the party's camp," should apply to new joiners too, not
    // only to explicit Shift+R respawns) -- otherwise the safe-spawn scan.
    const [sx, sy, sz] = this.state.hasRespawnAnchor
      ? [this.state.respawnAnchorX, this.state.respawnAnchorY, this.state.respawnAnchorZ]
      : spawnPositionFor(this.worldId, this.worldGen);
    player.x = sx;
    player.y = sy;
    player.z = sz;
    this.state.players.set(client.sessionId, player);

    const isAdmin = store.isWorldAdmin(this.worldId, options?.accountId);
    if (isAdmin) this.adminSessionIds.add(client.sessionId);
    player.isAdmin = isAdmin;

    // MVP goal items 1-2: flattened once at join, same precedent as isAdmin
    // above. Real request found live: a characterless join used to leave
    // every character field at its Schema default (no token rendered, no
    // owned-token interactions possible) -- a dead end requiring a trip
    // through the lobby's create-character form first. Now falls back to
    // store.getDefaultCharacterForAccount (resolves/auto-creates the
    // account's default character) whenever no real one was explicitly
    // picked. Only a join with no accountId at all (or an unknown one)
    // still has nothing to default to -- genuinely nothing to attach a
    // character to in that case.
    const character = (options?.characterId ? store.getCharacter(options.characterId) : undefined) ?? store.getDefaultCharacterForAccount(options?.accountId ?? "");
    if (character) {
      player.characterId = character.id;
      player.characterName = character.name;
      player.tokenColorR = character.token.color[0];
      player.tokenColorG = character.token.color[1];
      player.tokenColorB = character.token.color[2];
      player.hp = character.hp;
      player.maxHp = character.maxHp;
      player.mp = character.mp;
      player.maxMp = character.maxMp;
      for (const effect of character.statusEffects) {
        const effectState = new StatusEffectState();
        effectState.icon = effect.icon;
        effectState.label = effect.label;
        player.statusEffects.push(effectState);
      }
    }

    console.log(`[WorldRoom:${this.worldId}] ${player.name} (${client.sessionId}) joined${isAdmin ? " [admin]" : ""}${character ? ` as ${character.name}` : ""}`);
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    this.adminSessionIds.delete(client.sessionId);
    console.log(`[WorldRoom:${this.worldId}] ${client.sessionId} left`);
  }
}
