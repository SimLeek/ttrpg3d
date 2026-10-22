import { Room, type Client } from "colyseus";
import { CHUNK_SIZE, AIR, DEFAULT_GENERATOR_ID, encodeChunk, resolveCharacterBars, type ChunkRequest, type GeneratorParams } from "@ttrpg3d/shared";
import { WorldState, PlayerState, StatusEffectState, BarState, type WorldStateType, type PlayerStateType } from "./WorldState.js";
import type { StatusEffect, CharacterRecord } from "../data/store.js";
import { fillChunk, spawnPositionFor, blockAt as genBlockAt, type WorldGenInput } from "../world/worldGen.js";
import { createWorldStorage, type WorldStorage } from "../world/storage.js";
import { mod } from "../world/mathUtils.js";
import { store } from "../data/store.js";
import { createModLoader, type ModLoader } from "../mods/modLoader.js";
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

/** Replaces the old hp/maxHp/mp/maxMp-specific SetCharacterStatMessage -- `variableId` is whichever sheet variable the clicked bar points at (always the CURRENT half; `max` is edited on the character sheet page, not in-game). */
interface SetCharacterVariableValueMessage {
  characterId: string;
  variableId: string;
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

/** Re-resolves a character's configured bars (shared/characterSheet.ts's resolveCharacterBars) against its CURRENT variableValues and replaces the player's whole `bars` Schema array -- used both at join and after any setCharacterVariableValue edit, so every connected session always sees a freshly-derived list rather than a stale one. */
function applyBarsToPlayer(player: PlayerStateType, character: CharacterRecord): void {
  player.bars.clear();
  for (const resolved of resolveCharacterBars(character.customSheet, character.variableValues)) {
    const bar = new BarState();
    bar.variableId = resolved.variableId;
    bar.label = resolved.label;
    bar.value = resolved.value;
    bar.max = resolved.max;
    bar.colorR = resolved.color[0];
    bar.colorG = resolved.color[1];
    bar.colorB = resolved.color[2];
    player.bars.push(bar);
  }
}

/**
 * MVP goal item 4 follow-up ("characters" tab/popup) -- real bug found
 * live: "updating the popout page variables didn't update the in-game
 * bars, until I selected one bar, escaped, and the other updated."
 * Root cause: characters.ts's standalone page, the in-game popup, and
 * the pop-out window all persist sheet edits via a plain REST PUT
 * (server.ts's putCharacterSheet) -- which has no way to reach a LIVE
 * WorldRoom session for that same character to re-resolve its
 * Schema-synced bars. The "escaping a bar editor updated the OTHER
 * bar too" symptom was `setCharacterVariableValue`'s own handler
 * (below) incidentally re-resolving the WHOLE bars array -- it just
 * takes some UNRELATED room message to trigger that refresh today.
 *
 * This in-process registry (every room lives in the same Node
 * process) tracks which (room, sessionId) pairs are currently playing
 * each characterId, so a REST edit can reach them directly -- no new
 * message/poll loop, just a same-process function call. Keyed by
 * characterId since a character can in principle be active in more
 * than one room at once (two tabs/sessions); cleaned up in onLeave.
 */
const activeCharacterSessions = new Map<string, Set<{ room: WorldRoom; sessionId: string }>>();

/** Called by server.ts's putCharacterSheet, after persisting, to refresh bars for every live session currently playing this character -- across every WorldRoom that has one, not just the current room (same reason setCharacterVariableValue's own handler now also calls this instead of looping its own room only). No-op (not an error) if the character isn't currently played anywhere. */
export function notifyCharacterSheetChanged(characterId: string): void {
  const sessions = activeCharacterSessions.get(characterId);
  if (!sessions || sessions.size === 0) return;
  const character = store.getCharacter(characterId);
  if (!character) return;
  for (const { room, sessionId } of sessions) {
    const player = room.state.players.get(sessionId);
    if (player) applyBarsToPlayer(player, character);
  }
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

  // MVP goal item 3 (docs/ROADMAP.md): one ModLoader per WorldRoom
  // instance (two worlds could have different mods enabled, see
  // modLoader.ts's own header for why), loaded once at onCreate from
  // this world's persisted modIds -- no hot-reload, matching the
  // established respawn-anchor precedent (a value persisted via
  // store.ts, re-applied when onCreate next runs, not live-pushed into
  // an already-running room).
  modLoader!: ModLoader;
  private loadedModIds: string[] = [];
  /** Captured in onCreate for the "setSeeThroughWalls" message handler below, which persists back to the world's PARENT game (store.setSeeThroughWallsForGame) -- undefined only for the no-real-WorldRecord fallback case the worldId doc above describes. */
  private gameId?: string;

  // GM admin-override escape hatch state (core/mod-boundary plan) -- which
  // currently-connected sessions are this world's owner/admin/root,
  // tracked server-side rather than trusting a client-sent flag (checked
  // once at join via store.isWorldAdmin, not re-derived per message).
  private adminSessionIds = new Set<string>();
  /** This room's own half of the activeCharacterSessions registry above -- which characterId (if any) each currently-connected session is playing, so onLeave can find and remove the right entry. */
  private sessionCharacterIds = new Map<string, string>();

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

    // Fire-and-forget, not awaited: loading happens in the background
    // rather than delaying room creation/message-handler registration
    // (the handlers below must register synchronously, before any
    // `await`, per this file's own established "a message sent in
    // onJoin can arrive before the client's listener is ready" lesson --
    // the same ordering concern applies to delaying onCreate itself).
    // Per-GAME scope, not per-world (real correction, see GameRecord.
    // modIds's own doc in store.ts) -- resolved through this world's
    // PARENT game, even though the actual registration still happens at
    // THIS WorldRoom's own creation (the timing half of the original
    // per-world design is unchanged, only the scope of "which mods" is).
    this.modLoader = createModLoader(join(process.cwd(), "mods"));
    const game = world ? store.getGame(world.gameId) : undefined;
    this.gameId = world?.gameId;
    this.loadedModIds = game?.modIds ?? [];
    for (const modId of this.loadedModIds) void this.modLoader.loadMod(modId);

    // GM-only panel (gmPanel.ts) -- same per-GAME-scope/per-WORLD-timing
    // split as modIds just above, reusing the same `game` lookup.
    this.state.seeThroughWalls = game?.seeThroughWalls ?? true;

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

    // GM-only panel (gmPanel.ts) -- admin-gated the same way setRespawnAnchor
    // above is. Schema-synced, so every connected client picks this up on
    // its very next render frame, no reload needed (unlike mods below).
    // Persisted to the world's PARENT game (per-GAME scope, same as modIds)
    // so a future room creation for any of this game's worlds starts from
    // the GM's last choice -- this room's OWN live state is what actually
    // takes effect immediately, the persistence is just for next time.
    this.onMessage<{ enabled: boolean }>("setSeeThroughWalls", (client, { enabled }) => {
      if (!this.adminSessionIds.has(client.sessionId)) return;
      this.state.seeThroughWalls = enabled;
      if (this.gameId) store.setSeeThroughWallsForGame(this.gameId, enabled);
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

    // Click-to-edit bars backend (MVP goal items 1-2, generalized per
    // docs/ROADMAP.md item 4's follow-up -- was HP/MP-specific
    // setCharacterStat). Gated to the editing character's own owner
    // session or an admin -- same spirit as setRespawnAnchor's admin
    // gate above, plus a self-edit allowance since this is a
    // per-character value a player edits on their own token.
    this.onMessage<SetCharacterVariableValueMessage>("setCharacterVariableValue", (client, { characterId, variableId, value }) => {
      const sender = this.state.players.get(client.sessionId);
      const isSelf = sender?.characterId === characterId;
      if (!isSelf && !this.adminSessionIds.has(client.sessionId)) return;

      store.updateCharacterVariableValue(characterId, variableId, value);
      notifyCharacterSheetChanged(characterId);
    });

    // Backs the "Select status effects" context-menu item -- same gating
    // as setCharacterVariableValue above.
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
    // as setCharacterVariableValue/setStatusEffects above.
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

  async onDispose() {
    this.storage.close();
    for (const modId of this.loadedModIds) await this.modLoader.unloadMod(modId);
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
      applyBarsToPlayer(player, character);
      this.sessionCharacterIds.set(client.sessionId, character.id);
      const sessions = activeCharacterSessions.get(character.id) ?? new Set();
      sessions.add({ room: this, sessionId: client.sessionId });
      activeCharacterSessions.set(character.id, sessions);
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
    const characterId = this.sessionCharacterIds.get(client.sessionId);
    if (characterId) {
      const sessions = activeCharacterSessions.get(characterId);
      if (sessions) {
        for (const entry of sessions) {
          if (entry.room === this && entry.sessionId === client.sessionId) sessions.delete(entry);
        }
        if (sessions.size === 0) activeCharacterSessions.delete(characterId);
      }
      this.sessionCharacterIds.delete(client.sessionId);
    }
    console.log(`[WorldRoom:${this.worldId}] ${client.sessionId} left`);
  }
}
