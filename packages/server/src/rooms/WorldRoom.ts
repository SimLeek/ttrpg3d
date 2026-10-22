import { Room, type Client } from "colyseus";
import { CHUNK_SIZE, AIR, DEFAULT_GENERATOR_ID, encodeChunk, resolveCharacterBars, RESERVED_BODY_SIZE_VARIABLES, MAX_CHARACTER_PLACEMENT_DISTANCE, type ChunkRequest, type GeneratorParams } from "@ttrpg3d/shared";
import { WorldState, PlayerState, StatusEffectState, BarState, OtherCharacterState, type WorldStateType, type PlayerStateType, type OtherCharacterStateType, type BarStateType, type StatusEffectStateType } from "./WorldState.js";
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

/**
 * Replaces the old hp/maxHp/mp/maxMp-specific SetCharacterStatMessage
 * -- `variableId` is whichever sheet variable the clicked bar points
 * at (always the CURRENT half; `max` is edited on the character sheet
 * page, not in-game).
 *
 * `instanceId` (MVP goal item 4 follow-up, "multiple instances of the
 * same character... for monsters"): when present, this edit applies
 * ONLY to that one placed otherCharacters instance, as an ephemeral
 * override that never touches the shared CharacterRecord and never
 * affects any other instance or the focused slot -- see WorldRoom.ts's
 * `instanceVariableOverrides` doc. Omitted (the original behavior):
 * edits the shared record and refreshes the FOCUSED slot of whichever
 * session(s) are playing that character.
 */
interface SetCharacterVariableValueMessage {
  characterId: string;
  instanceId?: string;
  variableId: string;
  value: number;
}

interface SetStatusEffectsMessage {
  characterId: string;
  instanceId?: string;
  statusEffects: StatusEffect[];
}

interface SetCharacterTokenMessage {
  characterId: string;
  instanceId?: string;
  color: [number, number, number];
}

/** MVP goal item 4 follow-up (drag-and-drop placement). Always creates a brand-new otherCharacters instance -- see placeCharacter's own doc for why this no longer finds-or-updates an existing one by characterId. */
interface PlaceCharacterMessage {
  characterId: string;
  x: number;
  y: number;
  z: number;
}

/**
 * MVP goal item 4 follow-up (Tab/Shift+Tab focus cycling). `direction`
 * decides WHERE the previously-focused character goes back into
 * `otherCharacters` (its tail for "next", its head for "previous") --
 * required for Tab and Shift+Tab to be true inverses of each other
 * around the ring [focused, ...otherCharacters]. Worked out on paper,
 * not guessed: without it, "previous" would just be "next" with extra
 * steps (both ends of the swap land in the same place), so repeatedly
 * pressing Tab then Shift+Tab would NOT return to the original focus.
 *
 * Keyed by `instanceId`, not `characterId` -- now that multiple
 * instances of the same character can coexist (see OtherCharacterState's
 * own doc), characterId alone can no longer identify WHICH one to
 * focus.
 */
interface FocusCharacterMessage {
  instanceId: string;
  direction: "next" | "previous";
}

/** MVP goal item 4 follow-up (right-click "Delete instance"). Keyed by `instanceId`, same reason as FocusCharacterMessage -- also means this can no longer even ADDRESS the focused slot (which has no instanceId), so "can't delete the character you're controlling" is now structural, not a separate check. */
interface RemoveCharacterInstanceMessage {
  instanceId: string;
}

function flatIndex(i: number, j: number, k: number): number {
  return i * CHUNK_SIZE * CHUNK_SIZE + j * CHUNK_SIZE + k;
}

/** Mirrors store.ts's own private `newId()` -- intentionally separate, not shared: these ids are EPHEMERAL (room-scoped, never persisted, lost on server restart -- see `instanceVariableOverrides`'s own doc for why that's an accepted limitation for now), unlike store.ts's ids. */
function newInstanceId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * MVP goal item 4 follow-up (multi-character presence): a session's
 * currently-FOCUSED character (PlayerStateType) and one of its
 * placed-but-unfocused `otherCharacters` entries (OtherCharacterStateType)
 * share this exact field shape (bars + body size), just on two
 * different Schema types -- this is the structural interface both
 * `applyBarsToCharacterTarget`/`applyBodySizeToCharacterTarget` below
 * (and the focus-swap helpers further down) operate against, so the
 * same logic works for either without duplicating it per-type.
 */
interface CharacterSheetTarget {
  bars: { clear(): void; push(bar: BarStateType): void };
  bodyWidth: number;
  bodyHeight: number;
  bodyDepth: number;
}

/**
 * MVP goal item 4 follow-up ("multiple instances of the same
 * character... for monsters," independent stats): `overrides`, when
 * given, is one placed INSTANCE's own ephemeral variable deltas
 * (`instanceVariableOverrides`), merged on top of the character's own
 * base `variableValues` -- never mutating the base record itself. The
 * focused slot and a fresh (not-yet-edited) instance both pass no
 * overrides, resolving straight off the base record, same as always.
 */
function resolveVariableValues(character: CharacterRecord, overrides?: Readonly<Record<string, number | string>>): Readonly<Record<string, number | string>> {
  return overrides ? { ...character.variableValues, ...overrides } : character.variableValues;
}

/** Re-resolves a character's configured bars (shared/characterSheet.ts's resolveCharacterBars) against its CURRENT variableValues (optionally merged with one instance's own overrides, see resolveVariableValues) and replaces the target's whole `bars` Schema array -- used at join, after any setCharacterVariableValue edit, and for a placed otherCharacters entry, so every connected session always sees a freshly-derived list rather than a stale one, regardless of focus state. */
function applyBarsToCharacterTarget(target: CharacterSheetTarget, character: CharacterRecord, overrides?: Readonly<Record<string, number | string>>): void {
  target.bars.clear();
  for (const resolved of resolveCharacterBars(character.customSheet, resolveVariableValues(character, overrides))) {
    const bar = new BarState();
    bar.variableId = resolved.variableId;
    bar.label = resolved.label;
    bar.value = resolved.value;
    bar.max = resolved.max;
    bar.colorR = resolved.color[0];
    bar.colorG = resolved.color[1];
    bar.colorB = resolved.color[2];
    target.bars.push(bar);
  }
}

const DEFAULT_BODY_WIDTH = RESERVED_BODY_SIZE_VARIABLES.find((v) => v.id === "bodyWidth")!.default as number;
const DEFAULT_BODY_HEIGHT = RESERVED_BODY_SIZE_VARIABLES.find((v) => v.id === "bodyHeight")!.default as number;
const DEFAULT_BODY_DEPTH = RESERVED_BODY_SIZE_VARIABLES.find((v) => v.id === "bodyDepth")!.default as number;

/** Real bug found live ("I tried adjusting the character width/height/depth and that did nothing"): `RESERVED_BODY_SIZE_VARIABLES` existed as editable sheet data but nothing read it onto anything real. Mirrors applyBarsToCharacterTarget's own shape (including the same optional per-instance `overrides`) -- used at join, after any sheet edit (notifyCharacterSheetChanged below), and for a placed otherCharacters entry, so every connected session always sees the character's CURRENT body size rather than a stale/default one. */
function applyBodySizeToCharacterTarget(target: CharacterSheetTarget, character: CharacterRecord, overrides?: Readonly<Record<string, number | string>>): void {
  const values = resolveVariableValues(character, overrides);
  target.bodyWidth = typeof values.bodyWidth === "number" ? values.bodyWidth : DEFAULT_BODY_WIDTH;
  target.bodyHeight = typeof values.bodyHeight === "number" ? values.bodyHeight : DEFAULT_BODY_HEIGHT;
  target.bodyDepth = typeof values.bodyDepth === "number" ? values.bodyDepth : DEFAULT_BODY_DEPTH;
}

/** Shared by both directions of a focus-swap (WorldRoom.ts's "focusCharacter" handler) -- copies bars + status effects from one character slot (focused OR an otherCharacters entry) onto another, since both are plain Schema arrays of the exact same element types regardless of which side they live on. */
function copyBarsAndStatusEffects(
  from: { bars: Iterable<BarStateType>; statusEffects: Iterable<StatusEffectStateType> },
  to: { bars: { clear(): void; push(bar: BarStateType): void }; statusEffects: { clear(): void; push(effect: StatusEffectStateType): void } },
): void {
  to.bars.clear();
  for (const bar of from.bars) {
    const copy = new BarState();
    copy.variableId = bar.variableId;
    copy.label = bar.label;
    copy.value = bar.value;
    copy.max = bar.max;
    copy.colorR = bar.colorR;
    copy.colorG = bar.colorG;
    copy.colorB = bar.colorB;
    to.bars.push(copy);
  }
  to.statusEffects.clear();
  for (const effect of from.statusEffects) {
    const copy = new StatusEffectState();
    copy.icon = effect.icon;
    copy.label = effect.label;
    to.statusEffects.push(copy);
  }
}

/** Snapshots a session's CURRENTLY-focused character into a brand-new `OtherCharacterState` -- the first half of a Tab/Shift+Tab focus swap (the player's top-level fields are about to be overwritten by the target character's data, so this has to happen first). Gets a FRESH instanceId (the focused slot never has one of its own) -- a known, accepted limitation: swapping a character OUT then back IN via focus cycling does not preserve any per-instance stat overrides it had before being focused (there weren't any to begin with -- the focused slot always resolves straight off the shared record), so this is only a gap if something else (e.g. a future "focus a monster to puppet it" GM flow) edits an instance's stats, swaps it to focused, then swaps it back out. */
function snapshotFocusedCharacter(player: PlayerStateType): OtherCharacterStateType {
  const snapshot = new OtherCharacterState();
  snapshot.instanceId = newInstanceId();
  snapshot.characterId = player.characterId;
  snapshot.characterName = player.characterName;
  snapshot.x = player.x;
  snapshot.y = player.y;
  snapshot.z = player.z;
  snapshot.yaw = player.yaw;
  snapshot.tokenColorR = player.tokenColorR;
  snapshot.tokenColorG = player.tokenColorG;
  snapshot.tokenColorB = player.tokenColorB;
  snapshot.bodyWidth = player.bodyWidth;
  snapshot.bodyHeight = player.bodyHeight;
  snapshot.bodyDepth = player.bodyDepth;
  copyBarsAndStatusEffects(player, snapshot);
  return snapshot;
}

/**
 * True if `characterId` is the SENDER'S OWN currently-FOCUSED character
 * -- the self-edit allowance for setCharacterVariableValue/
 * setStatusEffects/setCharacterToken's non-instance path. MVP goal
 * item 4 follow-up ("multiple instances... for monsters"): this used
 * to also match a sender's own otherCharacters entries by characterId,
 * back when characterId alone identified "the one live representation
 * of this character" -- now that several independent instances can
 * share a characterId, editing "by characterId" can only still mean
 * "my own focused character" unambiguously; editing a SPECIFIC
 * instance goes through `isSendersOwnInstance` instead.
 */
function isSendersOwnCharacter(sender: PlayerStateType | undefined, characterId: string): boolean {
  return !!sender && sender.characterId === characterId;
}

/** True if `instanceId` is one of the SENDER'S OWN placed otherCharacters entries -- the instance-edit equivalent of isSendersOwnCharacter above (placeCharacter already required character ownership to create an instance in the first place, so "is it in MY otherCharacters array" is the right self-edit gate here, not a separate character-ownership re-check). */
function isSendersOwnInstance(sender: PlayerStateType | undefined, instanceId: string): boolean {
  return !!sender && sender.otherCharacters.some((o) => o.instanceId === instanceId);
}

/** The second half of a focus swap -- pulls a (previously-placed) otherCharacters entry's data onto the player's top-level focused fields. Position/yaw included: the newly-focused character should appear where it was last placed/left, same spirit as a fresh join using the respawn anchor. */
function applyOtherCharacterAsFocused(player: PlayerStateType, other: OtherCharacterStateType): void {
  player.characterId = other.characterId;
  player.characterName = other.characterName;
  player.x = other.x;
  player.y = other.y;
  player.z = other.z;
  player.yaw = other.yaw;
  player.tokenColorR = other.tokenColorR;
  player.tokenColorG = other.tokenColorG;
  player.tokenColorB = other.tokenColorB;
  player.bodyWidth = other.bodyWidth;
  player.bodyHeight = other.bodyHeight;
  player.bodyDepth = other.bodyDepth;
  copyBarsAndStatusEffects(other, player);
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
 *
 * MVP goal item 4 follow-up (multi-character presence): a session can
 * now be responsible for MORE than one characterId at once -- its
 * currently-focused one, plus any placed-but-unfocused
 * `otherCharacters` entries -- so a single characterId can map to
 * EITHER slot depending on current focus state. `notifyCharacterSheetChanged`
 * below checks both.
 */
const activeCharacterSessions = new Map<string, Set<{ room: WorldRoom; sessionId: string }>>();

/**
 * Called by server.ts's putCharacterSheet, after persisting, to
 * refresh bars for every live session currently playing this
 * character -- across every WorldRoom that has one, not just the
 * current room (same reason setCharacterVariableValue's own handler
 * now also calls this instead of looping its own room only). Checks
 * the focused slot AND every otherCharacters entry for this
 * characterId (MVP goal item 4 follow-up: there can be several placed
 * instances of the same character now, not just one) -- each
 * instance's OWN overrides (instanceVariableOverrides) stay layered on
 * top of the freshly-edited base record, so a template-level sheet
 * edit cascades the new BASE stats into every goblin while each
 * goblin's own accumulated damage/etc. is undisturbed. No-op (not an
 * error) if the character isn't currently played anywhere.
 */
export function notifyCharacterSheetChanged(characterId: string): void {
  const sessions = activeCharacterSessions.get(characterId);
  if (!sessions || sessions.size === 0) return;
  const character = store.getCharacter(characterId);
  if (!character) return;
  for (const { room, sessionId } of sessions) {
    const player = room.state.players.get(sessionId);
    if (!player) continue;
    if (player.characterId === characterId) {
      applyBarsToCharacterTarget(player, character);
      applyBodySizeToCharacterTarget(player, character);
    }
    for (const other of player.otherCharacters) {
      if (other.characterId !== characterId) continue;
      const overrides = room.instanceVariableOverrides.get(other.instanceId);
      applyBarsToCharacterTarget(other, character, overrides);
      applyBodySizeToCharacterTarget(other, character, overrides);
    }
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
  /**
   * This room's own half of the activeCharacterSessions registry above
   * -- which characterId(s) each currently-connected session is
   * responsible for, so onLeave can find and remove the right entries.
   * MVP goal item 4 follow-up: a Set, not a single id, now that a
   * session can be responsible for its focused character PLUS any
   * placed `otherCharacters` entries at once.
   */
  private sessionCharacterIds = new Map<string, Set<string>>();

  /**
   * MVP goal item 4 follow-up ("I can't add multiple instances of the
   * same character. I would want to do that for monsters"): each
   * placed otherCharacters instance's own variable-value DELTAS
   * (sparse -- only the keys someone has actually edited on THIS
   * instance, e.g. `{hp: 7}` after one goblin takes damage), merged on
   * top of the shared CharacterRecord's own variableValues when
   * resolving that instance's bars/body size (resolveVariableValues
   * above) -- so five goblins placed from one "Goblin" character sheet
   * each track their own HP independently instead of all sharing one
   * pool.
   *
   * Deliberately EPHEMERAL -- room-scoped, in-memory only, never
   * persisted to store.ts. Accepted limitation, not an oversight:
   * monster instances are inherently per-encounter/per-session in
   * spirit (unlike a player's own character sheet, which IS meant to
   * persist), and persisting them would mean a whole new store.ts
   * entity/REST surface for comparatively little benefit this round.
   * Cleaned up on `removeCharacterInstance` and whenever a session
   * disconnects with live instances still in its otherCharacters
   * (onLeave).
   */
  instanceVariableOverrides = new Map<string, Record<string, number | string>>();

  /** The otherCharacters entry with this instanceId, across EVERY connected player in this room (not just one session) -- an admin may need to edit someone else's placed instance, same spirit as the admin override already allowed for setCharacterVariableValue/setStatusEffects/setCharacterToken. */
  private findInstance(instanceId: string): OtherCharacterStateType | undefined {
    for (const player of this.state.players.values()) {
      const found = player.otherCharacters.find((o) => o.instanceId === instanceId);
      if (found) return found;
    }
    return undefined;
  }

  /** Registers (room, sessionId) as responsible for characterId in BOTH the per-room and the cross-room registries -- used at join (the focused character) and placeCharacter (a newly-placed otherCharacters entry). A characterId already registered for this session is a no-op (Set-backed). */
  private registerActiveCharacter(sessionId: string, characterId: string): void {
    const ids = this.sessionCharacterIds.get(sessionId) ?? new Set<string>();
    ids.add(characterId);
    this.sessionCharacterIds.set(sessionId, ids);
    const sessions = activeCharacterSessions.get(characterId) ?? new Set();
    sessions.add({ room: this, sessionId });
    activeCharacterSessions.set(characterId, sessions);
  }

  /** The inverse of registerActiveCharacter -- used by onLeave (every characterId the session held) and removeCharacterInstance (just the one deleted entry). */
  private unregisterActiveCharacter(sessionId: string, characterId: string): void {
    this.sessionCharacterIds.get(sessionId)?.delete(characterId);
    const sessions = activeCharacterSessions.get(characterId);
    if (!sessions) return;
    for (const entry of sessions) {
      if (entry.room === this && entry.sessionId === sessionId) sessions.delete(entry);
    }
    if (sessions.size === 0) activeCharacterSessions.delete(characterId);
  }

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
    //
    // MVP goal item 4 follow-up ("multiple instances... for monsters"):
    // an `instanceId` routes this edit to ONE placed instance's own
    // ephemeral override instead -- never touching the shared
    // CharacterRecord, never visible to any other instance or the
    // focused slot. See instanceVariableOverrides's own doc.
    this.onMessage<SetCharacterVariableValueMessage>("setCharacterVariableValue", (client, { characterId, instanceId, variableId, value }) => {
      const sender = this.state.players.get(client.sessionId);
      const isAdmin = this.adminSessionIds.has(client.sessionId);

      if (instanceId) {
        if (!isSendersOwnInstance(sender, instanceId) && !isAdmin) return;
        const entry = this.findInstance(instanceId);
        if (!entry || entry.characterId !== characterId) return; // instanceId must actually belong to the claimed characterId -- sanity check, not just trust
        const character = store.getCharacter(characterId);
        if (!character) return;
        const overrides = { ...(this.instanceVariableOverrides.get(instanceId) ?? {}), [variableId]: value };
        this.instanceVariableOverrides.set(instanceId, overrides);
        applyBarsToCharacterTarget(entry, character, overrides);
        applyBodySizeToCharacterTarget(entry, character, overrides);
        return;
      }

      if (!isSendersOwnCharacter(sender, characterId) && !isAdmin) return;
      store.updateCharacterVariableValue(characterId, variableId, value);
      notifyCharacterSheetChanged(characterId);
    });

    // Backs the "Select status effects" context-menu item -- same
    // gating/instanceId routing as setCharacterVariableValue above.
    // Non-instance path now only ever touches the FOCUSED slot (never
    // loops over otherCharacters by characterId match any more) --
    // once instances are independently editable, a base-record edit
    // shouldn't retroactively repaint every placed instance that
    // happens to share a characterId.
    this.onMessage<SetStatusEffectsMessage>("setStatusEffects", (client, { characterId, instanceId, statusEffects }) => {
      const sender = this.state.players.get(client.sessionId);
      const isAdmin = this.adminSessionIds.has(client.sessionId);

      if (instanceId) {
        if (!isSendersOwnInstance(sender, instanceId) && !isAdmin) return;
        const entry = this.findInstance(instanceId);
        if (!entry || entry.characterId !== characterId) return;
        entry.statusEffects.clear();
        for (const effect of statusEffects) {
          const effectState = new StatusEffectState();
          effectState.icon = effect.icon;
          effectState.label = effect.label;
          entry.statusEffects.push(effectState);
        }
        return;
      }

      if (!isSendersOwnCharacter(sender, characterId) && !isAdmin) return;
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

    // Backs the "Edit token properties" context-menu item -- same
    // gating/instanceId routing as setCharacterVariableValue/
    // setStatusEffects above.
    this.onMessage<SetCharacterTokenMessage>("setCharacterToken", (client, { characterId, instanceId, color }) => {
      const sender = this.state.players.get(client.sessionId);
      const isAdmin = this.adminSessionIds.has(client.sessionId);

      if (instanceId) {
        if (!isSendersOwnInstance(sender, instanceId) && !isAdmin) return;
        const entry = this.findInstance(instanceId);
        if (!entry || entry.characterId !== characterId) return;
        entry.tokenColorR = color[0];
        entry.tokenColorG = color[1];
        entry.tokenColorB = color[2];
        return;
      }

      if (!isSendersOwnCharacter(sender, characterId) && !isAdmin) return;
      store.setCharacterToken(characterId, color);
      for (const player of this.state.players.values()) {
        if (player.characterId !== characterId) continue;
        player.tokenColorR = color[0];
        player.tokenColorG = color[1];
        player.tokenColorB = color[2];
      }
    });

    // MVP goal item 4 follow-up (drag-and-drop character placement):
    // drops one of the SENDER'S OWN characters (never someone else's --
    // no admin override, matching linkCharacterToGame's own self-
    // service shape) at a world position. The sender's live `x/y/z` is
    // always their FOCUSED character's position (PlayerState's own
    // meaning, unchanged) -- distance is re-validated server-side
    // against that, never trusting the client's own pre-check, same
    // "light validation on meaningful actions" spirit as
    // setRespawnAnchor's not-underground check.
    //
    // ALWAYS creates a brand-new instance now -- real request: "I
    // can't add multiple instances of the same character. I would
    // want to do that for monsters for example." The old
    // find-an-existing-entry-by-characterId-and-move-it behavior is
    // gone; dragging the same character onto the world twice now
    // places TWO independent instances, not one moved entry. Placing
    // the currently-focused character itself still makes no sense (it
    // already has a live position -- wherever you are) and is
    // rejected.
    this.onMessage<PlaceCharacterMessage>("placeCharacter", (client, { characterId, x, y, z }) => {
      const sender = this.state.players.get(client.sessionId);
      if (!sender || characterId === sender.characterId) return;
      const character = store.getCharacter(characterId);
      if (!character || character.ownerAccountId !== sender.accountId) return;

      const dx = x - sender.x;
      const dy = y - sender.y;
      const dz = z - sender.z;
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) > MAX_CHARACTER_PLACEMENT_DISTANCE) return;

      const other = new OtherCharacterState();
      other.instanceId = newInstanceId();
      other.characterId = character.id;
      other.characterName = character.name;
      other.tokenColorR = character.token.color[0];
      other.tokenColorG = character.token.color[1];
      other.tokenColorB = character.token.color[2];
      for (const effect of character.statusEffects) {
        const effectState = new StatusEffectState();
        effectState.icon = effect.icon;
        effectState.label = effect.label;
        other.statusEffects.push(effectState);
      }
      other.x = x;
      other.y = y;
      other.z = z;
      applyBarsToCharacterTarget(other, character);
      applyBodySizeToCharacterTarget(other, character);
      sender.otherCharacters.push(other);
      this.registerActiveCharacter(client.sessionId, characterId);
    });

    // MVP goal item 4 follow-up (Tab/Shift+Tab focus cycling): self-only
    // (must be one of the SENDER'S OWN placed otherCharacters entries --
    // no-op, not an error, if it isn't one of theirs at all). Swaps the
    // currently-focused character's live data into a fresh
    // otherCharacters entry, and the target's stored data onto the
    // top-level focused fields -- never a different physics entity
    // (noa.playerEntity stays the one and only), purely a client-side
    // teleport+relabel in response to this. Keyed by `instanceId`, not
    // `characterId` -- see FocusCharacterMessage's own doc for why.
    // `direction` decides where the old focus goes back in -- see that
    // same doc for why this has to be explicit, not inferred, for
    // Tab/Shift+Tab to be true inverses.
    this.onMessage<FocusCharacterMessage>("focusCharacter", (client, { instanceId, direction }) => {
      const sender = this.state.players.get(client.sessionId);
      if (!sender) return;
      const targetIndex = sender.otherCharacters.findIndex((o) => o.instanceId === instanceId);
      if (targetIndex === -1) return;

      const target = sender.otherCharacters[targetIndex];
      const previouslyFocused = snapshotFocusedCharacter(sender);
      applyOtherCharacterAsFocused(sender, target);
      sender.otherCharacters.splice(targetIndex, 1);
      if (direction === "previous") sender.otherCharacters.unshift(previouslyFocused);
      else sender.otherCharacters.push(previouslyFocused);
    });

    // MVP goal item 4 follow-up (right-click context menu "Delete
    // instance"): removes the LIVE 3D instance only -- never the
    // character record or its game link (those are PR A's REST-backed
    // deleteCharacter/unlinkCharacterFromGame, a completely separate
    // action). Self-only. Keyed by `instanceId`, not `characterId` --
    // see RemoveCharacterInstanceMessage's own doc: this can no longer
    // even ADDRESS the focused slot (it has no instanceId), so "can't
    // delete the character you're controlling" (real request: "that
    // keeps at least one controllable instance") is now structural,
    // not a separate check to maintain.
    this.onMessage<RemoveCharacterInstanceMessage>("removeCharacterInstance", (client, { instanceId }) => {
      const sender = this.state.players.get(client.sessionId);
      if (!sender) return;
      const index = sender.otherCharacters.findIndex((o) => o.instanceId === instanceId);
      if (index === -1) return;

      const [removed] = sender.otherCharacters.splice(index, 1);
      this.instanceVariableOverrides.delete(instanceId);
      // MVP goal item 4 follow-up: multiple instances (and/or the
      // focused slot) can share a characterId now -- only unregister
      // it if THIS was the session's last live representation of that
      // character, otherwise notifyCharacterSheetChanged would stop
      // reaching this session for its remaining instance(s).
      const stillHasCharacter = sender.characterId === removed.characterId || sender.otherCharacters.some((o) => o.characterId === removed.characterId);
      if (!stillHasCharacter) this.unregisterActiveCharacter(client.sessionId, removed.characterId);
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
    // Mirrors GameState.ts's own presence.accountId (GameRoom.ts) -- MVP goal item 4 follow-up: needed so placeCharacter can verify ownership.
    player.accountId = options?.accountId ?? "";

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
      applyBarsToCharacterTarget(player, character);
      applyBodySizeToCharacterTarget(player, character);
      this.registerActiveCharacter(client.sessionId, character.id);
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
    // MVP goal item 4 follow-up: the Schema side of a disconnecting
    // session's placed instances is cleaned up for free below (the
    // whole PlayerState, otherCharacters included, is deleted) -- but
    // instanceVariableOverrides is a SEPARATE, non-Schema map, so each
    // instanceId has to be cleared explicitly here first, before that
    // list disappears.
    const leavingPlayer = this.state.players.get(client.sessionId);
    if (leavingPlayer) {
      for (const other of leavingPlayer.otherCharacters) this.instanceVariableOverrides.delete(other.instanceId);
    }
    this.state.players.delete(client.sessionId);
    this.adminSessionIds.delete(client.sessionId);
    // MVP goal item 4 follow-up: a session can now hold more than one
    // characterId (focused + any placed otherCharacters) -- unregister
    // all of them, not just one.
    const characterIds = this.sessionCharacterIds.get(client.sessionId);
    if (characterIds) {
      for (const characterId of characterIds) this.unregisterActiveCharacter(client.sessionId, characterId);
      this.sessionCharacterIds.delete(client.sessionId);
    }
    console.log(`[WorldRoom:${this.worldId}] ${client.sessionId} left`);
  }
}
