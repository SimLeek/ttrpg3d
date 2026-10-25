import { Room, type Client } from "colyseus";
import { CHUNK_SIZE, AIR, DEFAULT_GENERATOR_ID, encodeChunk, resolveCharacterBars, RESERVED_BODY_SIZE_VARIABLES, RESERVED_TOKEN_IMAGE_VARIABLES, MAX_CHARACTER_PLACEMENT_DISTANCE, type ChunkRequest, type GeneratorParams } from "@ttrpg3d/shared";
import { WorldState, PlayerState, StatusEffectState, BarState, OtherCharacterState, TurnOrderEntryState, WaypointState, MeasurementShapeState, MeasurementPointState, type WorldStateType, type PlayerStateType, type OtherCharacterStateType, type BarStateType, type StatusEffectStateType, type TurnOrderEntryStateType, type MeasurementShapeStateType } from "./WorldState.js";
import type { StatusEffect, CharacterRecord, PlacedCharacterInstanceRecord, TurnOrderEntryRecord, MeasurementShapeRecord } from "../data/store.js";
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
  /** MVP goal items 1-2 (docs/ROADMAP.md) -- resolved server-side via store.getCharacter in onJoin, never trusted as-is. A missing/unknown id is a real state (no character selected yet), not an error -- the player simply joins with no token. Ignored once `instanceId` below successfully resumes something. */
  characterId?: string;
  /**
   * Real correction (2026-10-23): names the SPECIFIC instance this
   * session was last piloting (not just which character), persisted
   * client-side across a disconnect/refresh/rejoin -- resolving by
   * instanceId, not characterId, is required now that several
   * independent instances can share one characterId. Only honored if
   * it still exists and is owned by this account (never trusted
   * blindly, same spirit as every other id here); falls through to
   * `characterId`/the account default otherwise, same as before this
   * existed.
   */
  instanceId?: string;
}

/**
 * Backs "Edit a bar," "Select status effects," and "Edit token
 * properties" -- real correction (2026-10-23): `instanceId` is now
 * ALWAYS required, never optional. Every character instance (piloted
 * right now or just sitting idle in the world) has a real, stable id
 * (PlayerState.currentInstance's own doc explains why), so there's no
 * more "the focused slot has no id, special-case it" branch to carry
 * -- editing your own currently-piloted character and editing an idle
 * placed instance are now the exact same code path.
 */
interface SetCharacterVariableValueMessage {
  characterId: string;
  instanceId: string;
  variableId: string;
  value: number;
}

interface SetStatusEffectsMessage {
  characterId: string;
  instanceId: string;
  statusEffects: StatusEffect[];
}

interface SetCharacterTokenMessage {
  characterId: string;
  instanceId: string;
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
 * MVP goal item 4 follow-up (Tab/Shift+Tab focus cycling, and now the
 * right-click "Control" item). `direction` decides WHERE the
 * previously-focused character goes back into `otherCharacters` (its
 * tail for "next", its head for "previous") -- required for Tab and
 * Shift+Tab to be true inverses of each other around the ring
 * [focused, ...otherCharacters]. Worked out on paper, not guessed:
 * without it, "previous" would just be "next" with extra steps (both
 * ends of the swap land in the same place), so repeatedly pressing Tab
 * then Shift+Tab would NOT return to the original focus. "Control" (a
 * direct, non-ring jump to an arbitrary instance) always sends "next"
 * -- there's no ring position to invert for an arbitrary jump, and
 * "next" is the same "old focus goes to the tail" behavior Tab itself
 * already uses, so no third direction value is needed.
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

/** MVP goal item 4 follow-up (right-click "Delete instance"). Keyed by `instanceId`. Can't address whatever the sender is CURRENTLY piloting -- removeCharacterInstance only ever searches the idle `otherCharacters` array (findInstance, not findAnyInstance), same structural "can't delete the character you're controlling" guarantee as before, just because of what it searches rather than because the target has no id at all. */
interface RemoveCharacterInstanceMessage {
  instanceId: string;
}

/**
 * docs/BATTLE_SYSTEM.md's turn-order tracker, phase 1 (manual Add --
 * initiative-roll-driven adds are phase 2, not this message).
 * `instanceId`/`characterId` are both optional and go together: a
 * manual Add can reference ANY live instance (idle in `otherCharacters`
 * OR actively being piloted right now -- real correction, 2026-10-23:
 * "I cannot add my currently controlled character to the turn order
 * for some reason... even though I should be able to", resolved by
 * `findAnyInstance` below searching both places), or be a bare
 * free-text label with no live token at all (both omitted).
 */
interface AddToTurnOrderMessage {
  label: string;
  instanceId?: string;
  characterId?: string;
}

interface RemoveFromTurnOrderMessage {
  turnEntryId: string;
}

/** Moves the entry to `newIndex` in the list (up/down arrow buttons -- drag-and-drop was tried and dropped, "pretty bad" in practice) -- clamped server-side, never trusts the client's own bounds-checking. */
interface ReorderTurnOrderMessage {
  turnEntryId: string;
  newIndex: number;
}

/** GM-only inline roll-value edit (real request: a manually-typed initiative number, not yet the `[[]]` roll-eval function docs/BATTLE_SYSTEM.md's later phase describes) -- sets both `rollValue` and `hasRollValue` together, since typing a value (even 0) is itself the thing that gives this entry one. */
interface SetTurnOrderRollValueMessage {
  turnEntryId: string;
  value: number;
}

function flatIndex(i: number, j: number, k: number): number {
  return i * CHUNK_SIZE * CHUNK_SIZE + j * CHUNK_SIZE + k;
}

/** Mirrors store.ts's own private `newId()` -- intentionally separate, not shared: these ids are generated here (never on the client, same "don't trust a client-chosen id" spirit as everything else in this file), independent of store.ts's own id sequence. */
function newInstanceId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * MVP goal item 4 follow-up (multi-character presence): the structural
 * shape `applyBarsToCharacterTarget`/`applyReservedVariablesToCharacterTarget`
 * below operate against -- every `OtherCharacterState` (idle or
 * currently piloted, see that type's own doc) satisfies this.
 */
interface CharacterSheetTarget {
  bars: { clear(): void; push(bar: BarStateType): void };
  bodyWidth: number;
  bodyHeight: number;
  bodyDepth: number;
  tokenImage: string;
}

/**
 * MVP goal item 4 follow-up ("multiple instances of the same
 * character... for monsters," independent stats): `overrides`, when
 * given, is one placed INSTANCE's own persisted variable deltas
 * (`instanceVariableOverrides`), merged on top of the character's own
 * base `variableValues` -- never mutating the base record itself. A
 * fresh (not-yet-edited) instance passes no overrides, resolving
 * straight off the base record.
 */
function resolveVariableValues(character: CharacterRecord, overrides?: Readonly<Record<string, number>>): Readonly<Record<string, number | string>> {
  return overrides ? { ...character.variableValues, ...overrides } : character.variableValues;
}

/** Re-resolves a character's configured bars (shared/characterSheet.ts's resolveCharacterBars) against its CURRENT variableValues (optionally merged with one instance's own overrides, see resolveVariableValues) and replaces the target's whole `bars` Schema array -- used at join, after any setCharacterVariableValue edit, and for a placed otherCharacters entry, so every connected session always sees a freshly-derived list rather than a stale one. */
function applyBarsToCharacterTarget(target: CharacterSheetTarget, character: CharacterRecord, overrides?: Readonly<Record<string, number>>): void {
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
const DEFAULT_TOKEN_IMAGE = RESERVED_TOKEN_IMAGE_VARIABLES.find((v) => v.id === "tokenImage")!.default as string;

/** Real bug found live ("I tried adjusting the character width/height/depth and that did nothing"): `RESERVED_BODY_SIZE_VARIABLES` existed as editable sheet data but nothing read it onto anything real. Mirrors applyBarsToCharacterTarget's own shape (including the same optional per-instance `overrides`) -- used at join, after any sheet edit (notifyCharacterSheetChanged below), and for a placed otherCharacters entry, so every connected session always sees the character's CURRENT body size (and, docs/CHARACTER_SHEET_IMPORT.md part 2: tokenImage) rather than a stale/default one. */
function applyReservedVariablesToCharacterTarget(target: CharacterSheetTarget, character: CharacterRecord, overrides?: Readonly<Record<string, number>>): void {
  const values = resolveVariableValues(character, overrides);
  target.bodyWidth = typeof values.bodyWidth === "number" ? values.bodyWidth : DEFAULT_BODY_WIDTH;
  target.bodyHeight = typeof values.bodyHeight === "number" ? values.bodyHeight : DEFAULT_BODY_HEIGHT;
  target.bodyDepth = typeof values.bodyDepth === "number" ? values.bodyDepth : DEFAULT_BODY_DEPTH;
  target.tokenImage = typeof values.tokenImage === "string" ? values.tokenImage : DEFAULT_TOKEN_IMAGE;
}

/**
 * True if `instanceId` is either THIS SENDER'S own currently-piloted
 * instance, OR a world-level `otherCharacters` entry this sender
 * placed. The single ownership test for every instance-scoped edit
 * now (setCharacterVariableValue/setStatusEffects/setCharacterToken) --
 * real correction, 2026-10-23: these used to have a SEPARATE
 * characterId-based "is this my own focused character" check, back
 * when the focused slot had no instance identity of its own to check
 * against directly. It does now (PlayerState.currentInstance's own
 * doc), so there's only one check.
 */
function isSendersOwnInstance(sender: PlayerStateType | undefined, otherCharacters: readonly OtherCharacterStateType[], instanceId: string): boolean {
  if (!sender) return false;
  if (sender.currentInstance.instanceId === instanceId) return true;
  return otherCharacters.some((o) => o.instanceId === instanceId && o.placedByAccountId === sender.accountId);
}

/** Idle-only lookup -- an `otherCharacters` array entry specifically, never a currently-piloted instance. The right choice for anything that needs a target someone could focus/take-over/delete (focusCharacter, removeCharacterInstance): you can't focus, delete, or steal a body someone else (or you, under a different name) is actively piloting. */
function findInstance(otherCharacters: readonly OtherCharacterStateType[], instanceId: string): OtherCharacterStateType | undefined {
  return otherCharacters.find((o) => o.instanceId === instanceId);
}

/**
 * Called by server.ts's putCharacterSheet, after persisting, to
 * refresh bars for every live FOCUSED session AND every placed
 * otherCharacters instance of this character, across every WorldRoom
 * that has one. Each instance's OWN overrides (instanceVariableOverrides,
 * keyed by instanceId regardless of whether it's idle or currently
 * piloted -- real simplification, 2026-10-23: there used to be a
 * SEPARATE focusedVariableOverrides map just for the piloted case,
 * only because that case had no stable id of its own to key by
 * before) stay layered on top of the freshly-edited base record, so a
 * template-level sheet edit cascades the new BASE stats into every
 * goblin while each goblin's own accumulated damage/etc. is
 * undisturbed. No-op (not an error) if the character isn't currently
 * played or placed anywhere.
 */
export function notifyCharacterSheetChanged(characterId: string): void {
  const character = store.getCharacter(characterId);
  if (!character) return;

  const sessions = activeCharacterSessions.get(characterId);
  if (sessions) {
    for (const { room, sessionId } of sessions) {
      const player = room.state.players.get(sessionId);
      if (player?.currentInstance.characterId === characterId) {
        const overrides = room.instanceVariableOverrides.get(player.currentInstance.instanceId);
        applyBarsToCharacterTarget(player.currentInstance, character, overrides);
        applyReservedVariablesToCharacterTarget(player.currentInstance, character, overrides);
      }
    }
  }

  const rooms = activeCharacterRooms.get(characterId);
  if (rooms) {
    for (const room of rooms) {
      for (const other of room.state.otherCharacters) {
        if (other.characterId !== characterId) continue;
        const overrides = room.instanceVariableOverrides.get(other.instanceId);
        applyBarsToCharacterTarget(other, character, overrides);
        applyReservedVariablesToCharacterTarget(other, character, overrides);
      }
    }
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
 * Schema-synced bars. This in-process registry (every room lives in
 * the same Node process) tracks which (room, sessionId) pairs are
 * currently FOCUSED on each characterId, so a REST edit can reach
 * them directly -- no new message/poll loop, just a same-process
 * function call. Keyed by characterId since a character can in
 * principle be active in more than one room at once (two tabs/
 * sessions); cleaned up in onLeave, and re-pointed at the new
 * characterId on every focus swap (focusCharacter).
 */
const activeCharacterSessions = new Map<string, Set<{ room: WorldRoom; sessionId: string }>>();

/**
 * The world-level counterpart to activeCharacterSessions above --
 * which ROOMS currently have a placed otherCharacters instance of this
 * characterId (independent of any particular session; a placed
 * monster has no "session playing it," it just exists in the world).
 * `WorldRoom.syncCharacterRoomRegistration` keeps this current after
 * every otherCharacters mutation; `onDispose` removes this room from
 * every entry it was part of.
 */
const activeCharacterRooms = new Map<string, Set<WorldRoom>>();

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
  /** This room's own half of the activeCharacterSessions registry above -- which characterId each currently-connected session is currently FOCUSED on, so onLeave/focusCharacter can find and update the right entry. */
  private sessionCharacterIds = new Map<string, string>();

  /**
   * MVP goal item 4 follow-up ("I can't add multiple instances of the
   * same character. I would want to do that for monsters"): each
   * instance's own variable-value DELTAS (sparse -- only the keys
   * someone has actually edited, e.g. `{hp: 7}` after one goblin takes
   * damage), merged on top of the shared CharacterRecord's own
   * variableValues when resolving that instance's bars/body size
   * (resolveVariableValues above) -- so five goblins placed from one
   * "Goblin" character sheet each track their own HP independently
   * instead of all sharing one pool. Keyed by instanceId regardless of
   * whether that instance is idle (in `otherCharacters`) or currently
   * piloted (a player's `currentInstance`) -- real simplification,
   * 2026-10-23: a piloted instance keeps the SAME instanceId the whole
   * time now (PlayerState.currentInstance's own doc), so there's no
   * more need to move a deviation between two different maps on every
   * focus swap the way the old focusedVariableOverrides/
   * instanceVariableOverrides split required.
   *
   * The real source of truth is `store.ts`'s `WorldRecord.
   * placedCharacters` (each record's own `variableOverrides`), loaded
   * back into this map at `onCreate` and written back out via
   * `persistPlacedCharacters` after every mutation.
   */
  instanceVariableOverrides = new Map<string, Record<string, number>>();

  /** Which characterIds THIS room is currently registered under in the module-level `activeCharacterRooms` map -- tracked so `onDispose` can remove this room from exactly those entries (and only those) when the room is destroyed. */
  private registeredRoomCharacterIds = new Set<string>();

  /** Keeps `activeCharacterRooms` (module-level) and `registeredRoomCharacterIds` (this room's own bookkeeping of it) in sync for one characterId, by simply re-deriving "does this room still have ANY instance of it -- idle OR currently piloted" from current Schema state -- called after every mutation that could have added or removed the last instance of a given characterId. */
  private syncCharacterRoomRegistration(characterId: string): void {
    const stillPresent = this.state.otherCharacters.some((o) => o.characterId === characterId) || Array.from(this.state.players.values()).some((p) => p.currentInstance.characterId === characterId);
    if (stillPresent) {
      this.registeredRoomCharacterIds.add(characterId);
      const rooms = activeCharacterRooms.get(characterId) ?? new Set<WorldRoom>();
      rooms.add(this);
      activeCharacterRooms.set(characterId, rooms);
    } else {
      this.registeredRoomCharacterIds.delete(characterId);
      const rooms = activeCharacterRooms.get(characterId);
      if (!rooms) return;
      rooms.delete(this);
      if (rooms.size === 0) activeCharacterRooms.delete(characterId);
    }
  }

  /**
   * Finds the live instance with this id, wherever it currently lives
   * -- an idle entry in `otherCharacters`, OR whichever session is
   * CURRENTLY piloting it. The canonical lookup for anything that
   * needs to reach a specific instance's current data regardless of
   * who's piloting it (turn-order Add, stat/color/status-effect
   * edits). `findInstance` (array-only, module-level function above)
   * stays the right choice for anything that specifically needs an
   * IDLE target (focusCharacter, removeCharacterInstance, Control/
   * Delete) -- you can't take over or delete a body someone's
   * actively piloting.
   */
  private findAnyInstance(instanceId: string): OtherCharacterStateType | undefined {
    for (const player of this.state.players.values()) {
      if (player.currentInstance.instanceId === instanceId) return player.currentInstance;
    }
    return findInstance(this.state.otherCharacters, instanceId);
  }

  /**
   * Serializes every live instance this room currently has -- idle
   * `otherCharacters` entries AND every connected session's own
   * currently-piloted `currentInstance` (real correction, 2026-10-23:
   * a piloted character's edits used to never reach disk until
   * disconnect; now a stat/color edit made WHILE piloting is captured
   * immediately too, same as an idle instance's always was) -- and
   * writes the whole list to store.ts. Called after every place/
   * remove/instance-edit/focus-swap/join/leave, NOT on every "pos"
   * update (position alone isn't worth a disk write every few ticks;
   * the one case that matters, a clean disconnect, already pushes the
   * leaving instance into `otherCharacters` before this runs).
   */
  private persistPlacedCharacters(): void {
    const live = [...this.state.otherCharacters, ...Array.from(this.state.players.values(), (p) => p.currentInstance).filter((i) => i.characterId !== "")];
    const records: PlacedCharacterInstanceRecord[] = live.map((o) => ({
      instanceId: o.instanceId,
      characterId: o.characterId,
      placedByAccountId: o.placedByAccountId,
      x: o.x,
      y: o.y,
      z: o.z,
      yaw: o.yaw,
      tokenColor: [o.tokenColorR, o.tokenColorG, o.tokenColorB],
      statusEffects: Array.from(o.statusEffects).map((e) => ({ icon: e.icon, label: e.label })),
      variableOverrides: this.instanceVariableOverrides.get(o.instanceId) ?? {},
      // Real correction, 2026-10-24: waypoints now persist too --
      // "we'll want to persist those waypoints... they should remain
      // on exit/re-entry." See PlacedCharacterInstanceRecord's own doc.
      waypoints: Array.from(o.waypoints).map((w) => ({ x: w.x, y: w.y, z: w.z, isCore: w.isCore })),
      waypointColor: [o.waypointColorR, o.waypointColorG, o.waypointColorB],
    }));
    store.setPlacedCharactersForWorld(this.worldId, records);
  }

  /** Serializes this room's CURRENT turn order and writes it to store.ts -- same whole-state-overwrite shape as persistPlacedCharacters above, called after every add/remove/clear/reorder/next-turn. */
  private persistTurnOrder(): void {
    const entries: TurnOrderEntryRecord[] = this.state.turnOrder.map((e) => ({
      turnEntryId: e.turnEntryId,
      label: e.label,
      instanceId: e.instanceId,
      characterId: e.characterId,
      hasRollValue: e.hasRollValue,
      rollValue: e.rollValue,
    }));
    store.setTurnOrderForWorld(this.worldId, { entries, currentIndex: this.state.turnOrderCurrentIndex, round: this.state.turnOrderRound });
  }

  /** docs/BATTLE_SYSTEM.md's measurement shapes -- same whole-list-overwrite shape as persistTurnOrder above, called after every place/delete. */
  private persistMeasurementShapes(): void {
    const shapes: MeasurementShapeRecord[] = this.state.measurementShapes.map((s) => ({
      shapeId: s.shapeId,
      kind: s.kind as MeasurementShapeRecord["kind"],
      ownerAccountId: s.ownerAccountId,
      points: Array.from(s.points).map((p) => ({ x: p.x, y: p.y, z: p.z })),
      broadcast: s.broadcast,
      coneDegrees: s.coneDegrees,
      isFrustum: s.isFrustum,
      beamWidth: s.beamWidth,
    }));
    store.setMeasurementShapesForWorld(this.worldId, shapes);
  }

  /**
   * Rewrites the WHOLE turn order to `newOrder`'s order by reassigning
   * each slot's own FIELD VALUES onto the array's EXISTING
   * `TurnOrderEntryState` objects -- never splice/remove/reinsert an
   * object. Real bug found live, 2026-10-23: the up-arrow button's
   * own reorder used to splice-remove the moved entry and splice-
   * insert that SAME object back into the array within one
   * synchronous mutation, which confused @colyseus/schema's own
   * change-tracking -- the visible array order silently failed to
   * change at all, while `turnOrderCurrentIndex`'s own re-lookup
   * (below) landed on the WRONG entry, reproduced live as "I press up
   * on hi and it changes to hi's turn instead of moving hi above
   * bob." Shared by reorderTurnOrder (one-slot move) and
   * sortTurnOrderByRoll (a full sort) below -- same safe rewrite
   * either way, and the same "whose turn it is" preservation
   * (`currentEntryId`) every other turn-order mutation already
   * applies.
   */
  private reassignTurnOrder(newOrder: readonly TurnOrderEntryRecord[]): void {
    const currentEntryId = this.state.turnOrder[this.state.turnOrderCurrentIndex]?.turnEntryId;
    newOrder.forEach((data, i) => {
      const target = this.state.turnOrder[i];
      target.turnEntryId = data.turnEntryId;
      target.label = data.label;
      target.instanceId = data.instanceId;
      target.characterId = data.characterId;
      target.hasRollValue = data.hasRollValue;
      target.rollValue = data.rollValue;
    });
    if (currentEntryId) {
      const newCurrentIndex = this.state.turnOrder.findIndex((e) => e.turnEntryId === currentEntryId);
      if (newCurrentIndex !== -1) this.state.turnOrderCurrentIndex = newCurrentIndex;
    }
  }

  /** Plain-data snapshot of the CURRENT turn order, in its current order -- the starting point reassignTurnOrder's own callers (reorderTurnOrder, sortTurnOrderByRoll) reorder/sort before writing back. */
  private snapshotTurnOrder(): TurnOrderEntryRecord[] {
    return this.state.turnOrder.map((e) => ({ turnEntryId: e.turnEntryId, label: e.label, instanceId: e.instanceId, characterId: e.characterId, hasRollValue: e.hasRollValue, rollValue: e.rollValue }));
  }

  /** Removes one turn-order entry by its own id, keeping `turnOrderCurrentIndex` pointing at the SAME logical entry (shifting it back by one if the removed entry was earlier in the list; clamping if it WAS the current entry and was also the last one). Shared by removeFromTurnOrder and removeTurnOrderEntriesByInstanceId below -- same adjustment either way. */
  private removeTurnOrderEntryById(turnEntryId: string): void {
    const index = this.state.turnOrder.findIndex((e) => e.turnEntryId === turnEntryId);
    if (index === -1) return;
    const beforeCount = this.state.turnOrder.length;
    this.state.turnOrder.splice(index, 1);
    if (index < this.state.turnOrderCurrentIndex) this.state.turnOrderCurrentIndex--;
    else if (index === this.state.turnOrderCurrentIndex && this.state.turnOrderCurrentIndex >= this.state.turnOrder.length) {
      this.state.turnOrderCurrentIndex = Math.max(0, this.state.turnOrder.length - 1);
    }
    this.persistTurnOrder();
    this.applyWaypointAutoToggle(beforeCount);
  }

  /**
   * docs/BATTLE_SYSTEM.md's waypoint/distance measurement -- auto-flips
   * `waypointsEnabled` on a 0<->1+ turn-order-entry-count TRANSITION,
   * each direction independently gated by its own GM settings
   * checkbox (`waypointAutoOnWithTurnOrder`/
   * `waypointAutoOffWithoutTurnOrder`). Called after every add/remove/
   * clear to the turn order, with the entry count from BEFORE that
   * mutation. A manual toggle via the panel's own on/off button
   * (`toggleWaypoints` handler) overrides `waypointsEnabled` at any
   * time -- that value only gets overwritten again by the NEXT
   * qualifying transition here, confirmed directly by the user as the
   * intended (if "tricky") behavior, not a bug to "fix" by making this
   * sticky some other way.
   */
  private applyWaypointAutoToggle(beforeCount: number): void {
    const afterCount = this.state.turnOrder.length;
    if (beforeCount === 0 && afterCount > 0 && this.state.waypointAutoOnWithTurnOrder) {
      this.state.waypointsEnabled = true;
      this.resetAllCoreWaypoints();
    } else if (beforeCount > 0 && afterCount === 0 && this.state.waypointAutoOffWithoutTurnOrder) {
      this.state.waypointsEnabled = false;
    } else {
      return; // no qualifying transition -- nothing changed, nothing to persist
    }
    store.setWaypointsEnabledForWorld(this.worldId, this.state.waypointsEnabled);
  }

  /**
   * Real request: "there should be a core waypoint as long as
   * waypoints are on, one that can't be removed from the list, since
   * that would be the waypoint at the start of the turn, for
   * reverting positions." Real correction, 2026-10-24: waypoints
   * (and this core-stamping) now belong to whichever INSTANCE the
   * turn order actually references, not "every connected session" --
   * "it should really be waypoints just following a specific
   * instance, which would make more sense with the turn order and
   * swapping control." Resets every turn-order member's own waypoint
   * chain down to just one fresh, non-removable entry (`isCore`) at
   * wherever that instance currently is -- called whenever
   * `waypointsEnabled` flips false -> true (here and in
   * `toggleWaypoints`'s own manual path) and on every `nextTurn`,
   * discarding whatever stale chain an instance might still have from
   * earlier. A bare-label turn-order entry (no instanceId) has
   * nothing to stamp, same as every other instance-scoped operation.
   */
  private resetAllCoreWaypoints(): void {
    for (const entry of this.state.turnOrder) {
      if (!entry.instanceId) continue;
      const instance = this.findAnyInstance(entry.instanceId);
      if (instance) this.resetWaypointsToCore(instance);
    }
  }

  /** One instance's own half of resetAllCoreWaypoints -- also called from addToTurnOrder, for a character joining the turn order (and so needing its own fresh core) WHILE waypoints are already enabled, without touching every OTHER already-active combatant's own chain. Never reuses an existing WaypointState object across the clear+push (the same `@colyseus/schema` reparenting-within-one-mutation hazard the turn-order reorder bug already taught this file) -- always a brand new instance. */
  private resetWaypointsToCore(instance: OtherCharacterStateType): void {
    instance.waypoints.clear();
    const core = new WaypointState();
    core.x = instance.x;
    core.y = instance.y;
    core.z = instance.z;
    core.isCore = true;
    instance.waypoints.push(core);
  }

  /** removeCharacterInstance's own cleanup -- a turn-order entry can't outlive the live instance it points to. A bare-label entry (no instanceId) is never touched by this, same as it's never touched by any other instance-scoped operation. */
  private removeTurnOrderEntriesByInstanceId(instanceId: string): void {
    for (const entry of [...this.state.turnOrder]) {
      if (entry.instanceId === instanceId) this.removeTurnOrderEntryById(entry.turnEntryId);
    }
  }

  /** Registers (room, sessionId) as the session CURRENTLY FOCUSED on characterId -- used at join and on every focus swap (focusCharacter). Each session only ever has ONE focused characterId at a time (unlike the room-level registry above, which can have several placed instances) -- callers always pair this with unregisterActiveCharacter for whatever characterId the session was PREVIOUSLY focused on. */
  private registerActiveCharacter(sessionId: string, characterId: string): void {
    this.sessionCharacterIds.set(sessionId, characterId);
    const sessions = activeCharacterSessions.get(characterId) ?? new Set();
    sessions.add({ room: this, sessionId });
    activeCharacterSessions.set(characterId, sessions);
  }

  /** The inverse of registerActiveCharacter -- used by onLeave and by focusCharacter (for whatever characterId the session is FOCUSED-AWAY-FROM). */
  private unregisterActiveCharacter(sessionId: string, characterId: string): void {
    this.sessionCharacterIds.delete(sessionId);
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

    // MVP goal item 4 follow-up -- real bug found live: "the tokens do
    // not persist upon exiting and re-entering games, so if gms/players
    // refresh, then monsters will disappear." Loads every persisted
    // IDLE instance for this world back into live Schema state --
    // currently-piloted instances load back differently, via onJoin's
    // own `instanceId` resume path below, since they need a connecting
    // session to attach to. Synchronous (store.ts is a synchronous
    // JSON-file store, same as the respawnAnchor seeding right above),
    // re-resolving bars/body size fresh against the character's
    // CURRENT sheet + this instance's own overrides (never persisted
    // redundantly -- see PlacedCharacterInstanceRecord's own doc). A
    // character record deleted since this was last saved is skipped,
    // not a crash -- same "stale id, not an error" convention as every
    // other lookup here.
    for (const record of world?.placedCharacters ?? []) {
      const character = store.getCharacter(record.characterId);
      if (!character) continue;
      const other = new OtherCharacterState();
      other.instanceId = record.instanceId;
      other.characterId = record.characterId;
      other.characterName = character.name;
      other.placedByAccountId = record.placedByAccountId;
      // Real bug found live, 2026-10-23: a client-side NaN from the
      // PlayerState/OtherCharacterState refactor got persisted to disk
      // before the "pos" handler's own validation (above) existed --
      // JSON.stringify turns NaN into null, so a record already
      // corrupted this way loads back as `null`, not `NaN`, and would
      // otherwise reproduce the exact same "infinite blue space"
      // symptom forever. Self-heals any already-corrupted record on
      // load by falling back to a safe spawn position instead of
      // propagating the bad value -- the same fallback a genuinely
      // fresh join gets.
      const [sx, sy, sz] = Number.isFinite(record.x) && Number.isFinite(record.y) && Number.isFinite(record.z) ? [record.x, record.y, record.z] : spawnPositionFor(this.worldId, this.worldGen);
      other.x = sx;
      other.y = sy;
      other.z = sz;
      other.yaw = Number.isFinite(record.yaw) ? record.yaw : 0;
      other.tokenColorR = record.tokenColor[0];
      other.tokenColorG = record.tokenColor[1];
      other.tokenColorB = record.tokenColor[2];
      for (const effect of record.statusEffects) {
        const effectState = new StatusEffectState();
        effectState.icon = effect.icon;
        effectState.label = effect.label;
        other.statusEffects.push(effectState);
      }
      if (Object.keys(record.variableOverrides).length > 0) this.instanceVariableOverrides.set(record.instanceId, record.variableOverrides);
      applyBarsToCharacterTarget(other, character, record.variableOverrides);
      applyReservedVariablesToCharacterTarget(other, character, record.variableOverrides);
      // Real correction, 2026-10-24: restore a persisted waypoint
      // chain too -- see PlacedCharacterInstanceRecord's own doc.
      for (const w of record.waypoints ?? []) {
        const waypoint = new WaypointState();
        waypoint.x = w.x;
        waypoint.y = w.y;
        waypoint.z = w.z;
        waypoint.isCore = w.isCore;
        other.waypoints.push(waypoint);
      }
      if (record.waypointColor) {
        other.waypointColorR = record.waypointColor[0];
        other.waypointColorG = record.waypointColor[1];
        other.waypointColorB = record.waypointColor[2];
      }
      this.state.otherCharacters.push(other);
      this.syncCharacterRoomRegistration(record.characterId);
    }

    // docs/BATTLE_SYSTEM.md's turn-order tracker -- same load-back
    // shape as placedCharacters just above, survives a room being
    // recreated and a disconnect/refresh/rejoin (nothing here
    // references a sessionId, see TurnOrderEntryState's own doc).
    if (world?.turnOrder) {
      for (const record of world.turnOrder.entries) {
        const entry = new TurnOrderEntryState();
        entry.turnEntryId = record.turnEntryId;
        entry.label = record.label;
        entry.instanceId = record.instanceId;
        entry.characterId = record.characterId;
        entry.hasRollValue = record.hasRollValue;
        entry.rollValue = record.rollValue;
        this.state.turnOrder.push(entry);
      }
      this.state.turnOrderCurrentIndex = world.turnOrder.currentIndex;
      this.state.turnOrderRound = world.turnOrder.round;
    }

    // docs/BATTLE_SYSTEM.md's waypoint/distance measurement -- same
    // per-WORLD/per-GAME split as respawnAnchor/seeThroughWalls above:
    // the live enabled-state + distance metric are per-WORLD
    // (WorldRecord), the two auto-on/off GM settings checkboxes are
    // per-GAME (GameRecord), same tier as seeThroughWalls/modIds.
    this.state.waypointsEnabled = world?.waypointsEnabled ?? false;
    this.state.waypointDistanceMetricP = world?.waypointDistanceMetricP ?? 2;
    this.state.waypointAutoOnWithTurnOrder = game?.waypointAutoOnWithTurnOrder ?? true;
    this.state.waypointAutoOffWithoutTurnOrder = game?.waypointAutoOffWithoutTurnOrder ?? true;

    // docs/BATTLE_SYSTEM.md's measurement shapes -- same per-WORLD
    // persistence tier as waypointDistanceMetricP above (retroactively
    // shared with the waypoint system's own distance labels too).
    this.state.ftPerVoxel = world?.ftPerVoxel ?? 5;

    // docs/BATTLE_SYSTEM.md's measurement shapes -- same "survives a
    // room being recreated" load-back as placedCharacters/turnOrder
    // above. A 1:1 field copy (MeasurementShapeRecord mirrors
    // MeasurementShapeState exactly, see both types' own docs), not a
    // re-resolve-against-something-else load like placedCharacters'
    // bars/body-size.
    for (const record of world?.measurementShapes ?? []) {
      const shape = new MeasurementShapeState();
      shape.shapeId = record.shapeId;
      shape.kind = record.kind;
      shape.ownerAccountId = record.ownerAccountId;
      shape.broadcast = record.broadcast;
      shape.coneDegrees = record.coneDegrees;
      shape.isFrustum = record.isFrustum;
      shape.beamWidth = record.beamWidth;
      for (const p of record.points) {
        const point = new MeasurementPointState();
        point.x = p.x;
        point.y = p.y;
        point.z = p.z;
        shape.points.push(point);
      }
      this.state.measurementShapes.push(shape);
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
      const px = Math.floor(player.currentInstance.x);
      const py = Math.floor(player.currentInstance.y);
      const pz = Math.floor(player.currentInstance.z);
      const isSafe = genBlockAt(this.worldId, px, py, pz, this.worldGen) === AIR && genBlockAt(this.worldId, px, py + 1, pz, this.worldGen) === AIR;
      if (!isSafe) return;

      this.state.hasRespawnAnchor = true;
      this.state.respawnAnchorX = player.currentInstance.x;
      this.state.respawnAnchorY = player.currentInstance.y;
      this.state.respawnAnchorZ = player.currentInstance.z;
      store.setWorldRespawnAnchor(this.worldId, { x: player.currentInstance.x, y: player.currentInstance.y, z: player.currentInstance.z });
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
    // re-validating the move. Writes straight to the piloted instance now
    // (PlayerState.currentInstance's own doc) -- it's the only place
    // position lives any more, characterless or not.
    this.onMessage<PlayerInput>("pos", (client, { x, y, z, yaw }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      // Real bug found live, 2026-10-23: a client-side NaN (the
      // PlayerState/OtherCharacterState refactor briefly teleported a
      // resuming player to [undefined, undefined, undefined]) got sent
      // here, written straight into Schema state, then PERSISTED on
      // that session's leave (persistPlacedCharacters) -- corrupting
      // this instance's position on disk permanently (JSON.stringify
      // turns NaN into null), reproduced as "infinite blue
      // space... character disappears" on every subsequent resume,
      // even after the client bug itself was fixed. Never trust a
      // client-reported position blindly (same "never trusted
      // blindly" convention every other id/value in this file already
      // follows) -- silently dropping a non-finite update is a safe
      // no-op, leaving the last good position in place instead of
      // corrupting it.
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !Number.isFinite(yaw)) return;
      player.currentInstance.x = x;
      player.currentInstance.y = y;
      player.currentInstance.z = z;
      player.currentInstance.yaw = yaw;
    });

    // Click-to-edit bars backend (MVP goal items 1-2, generalized per
    // docs/ROADMAP.md item 4's follow-up -- was HP/MP-specific
    // setCharacterStat). `instanceId` is now ALWAYS required (real
    // correction, 2026-10-23 -- see SetCharacterVariableValueMessage's
    // own doc): editing your own currently-piloted character and
    // editing an idle placed instance are the same code path now,
    // since both have a real, stable instanceId.
    this.onMessage<SetCharacterVariableValueMessage>("setCharacterVariableValue", (client, { characterId, instanceId, variableId, value }) => {
      const sender = this.state.players.get(client.sessionId);
      const isAdmin = this.adminSessionIds.has(client.sessionId);
      if (!isSendersOwnInstance(sender, this.state.otherCharacters, instanceId) && !isAdmin) return;
      const entry = this.findAnyInstance(instanceId);
      if (!entry || entry.characterId !== characterId) return; // instanceId must actually belong to the claimed characterId -- sanity check, not just trust
      const character = store.getCharacter(characterId);
      if (!character) return;
      const overrides = { ...(this.instanceVariableOverrides.get(instanceId) ?? {}), [variableId]: value };
      this.instanceVariableOverrides.set(instanceId, overrides);
      applyBarsToCharacterTarget(entry, character, overrides);
      applyReservedVariablesToCharacterTarget(entry, character, overrides);
      this.persistPlacedCharacters();
    });

    // Backs the "Select status effects" context-menu item -- same
    // gating/instanceId routing as setCharacterVariableValue above.
    this.onMessage<SetStatusEffectsMessage>("setStatusEffects", (client, { characterId, instanceId, statusEffects }) => {
      const sender = this.state.players.get(client.sessionId);
      const isAdmin = this.adminSessionIds.has(client.sessionId);
      if (!isSendersOwnInstance(sender, this.state.otherCharacters, instanceId) && !isAdmin) return;
      const entry = this.findAnyInstance(instanceId);
      if (!entry || entry.characterId !== characterId) return;
      entry.statusEffects.clear();
      for (const effect of statusEffects) {
        const effectState = new StatusEffectState();
        effectState.icon = effect.icon;
        effectState.label = effect.label;
        entry.statusEffects.push(effectState);
      }
      this.persistPlacedCharacters();
    });

    // Backs the "Edit token properties" context-menu item -- same
    // gating/instanceId routing as setCharacterVariableValue/
    // setStatusEffects above.
    this.onMessage<SetCharacterTokenMessage>("setCharacterToken", (client, { characterId, instanceId, color }) => {
      const sender = this.state.players.get(client.sessionId);
      const isAdmin = this.adminSessionIds.has(client.sessionId);
      if (!isSendersOwnInstance(sender, this.state.otherCharacters, instanceId) && !isAdmin) return;
      const entry = this.findAnyInstance(instanceId);
      if (!entry || entry.characterId !== characterId) return;
      entry.tokenColorR = color[0];
      entry.tokenColorG = color[1];
      entry.tokenColorB = color[2];
      this.persistPlacedCharacters();
    });

    // MVP goal item 4 follow-up (drag-and-drop character placement):
    // drops one of the SENDER'S OWN characters (never someone else's --
    // no admin override, matching linkCharacterToGame's own self-
    // service shape) at a world position. The sender's live position is
    // always their CURRENTLY-PILOTED instance's own x/y/z -- distance
    // is re-validated server-side against that, never trusting the
    // client's own pre-check, same "light validation on meaningful
    // actions" spirit as setRespawnAnchor's not-underground check.
    //
    // ALWAYS creates a brand-new instance -- real request: "I can't
    // add multiple instances of the same character. I would want to
    // do that for monsters for example." Dragging the same character
    // onto the world twice places TWO independent instances. Pushed to
    // the WORLD-level `otherCharacters` (real feedback: placed
    // instances need to survive the placing session disconnecting).
    //
    // Real correction: placing another instance of the character
    // you're CURRENTLY piloting is explicitly fine -- "if you're
    // controlling an instance of 'bob' and you drag in another 'bob',
    // that should still work." No special case needed: this always
    // creates a genuinely new, independent instance regardless of
    // what the sender currently has focused.
    this.onMessage<PlaceCharacterMessage>("placeCharacter", (client, { characterId, x, y, z }) => {
      const sender = this.state.players.get(client.sessionId);
      if (!sender) return;
      const character = store.getCharacter(characterId);
      if (!character || character.ownerAccountId !== sender.accountId) return;

      const dx = x - sender.currentInstance.x;
      const dy = y - sender.currentInstance.y;
      const dz = z - sender.currentInstance.z;
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) > MAX_CHARACTER_PLACEMENT_DISTANCE) return;

      const other = new OtherCharacterState();
      other.instanceId = newInstanceId();
      other.characterId = character.id;
      other.characterName = character.name;
      other.placedByAccountId = sender.accountId;
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
      applyReservedVariablesToCharacterTarget(other, character);
      this.state.otherCharacters.push(other);
      this.syncCharacterRoomRegistration(characterId);
      this.persistPlacedCharacters();
    });

    // MVP goal item 4 follow-up (Tab/Shift+Tab focus cycling, and now
    // the right-click "Control" item -- same message/handler for both,
    // "direction" is the only thing that differs, see
    // FocusCharacterMessage's own doc). Self-only (must be a
    // world-level otherCharacters entry THIS SENDER placed, or an
    // admin) -- no-op, not an error, otherwise. Moves the SAME
    // `OtherCharacterState` objects between `otherCharacters` and
    // `currentInstance` (real simplification, 2026-10-23 -- no more
    // field-by-field copying: `t.ref` lets the target's own object
    // identity just become the new focused slot directly, and the
    // outgoing one becomes a real otherCharacters entry the same way,
    // not a freshly-constructed snapshot of it). Never a different
    // physics entity (noa.playerEntity stays the one and only) --
    // purely a client-side teleport+relabel in response to this.
    //
    // Real request: "for tab/shift tab/control swapping from context,
    // those should thus set the character sheet details from the
    // token" -- moving the target's own object in means the focused
    // slot immediately reflects whatever body you're piloting,
    // including its own override deltas (instanceVariableOverrides
    // stays keyed by the SAME instanceId the whole time now, nothing
    // to move between maps the way an earlier round of this feature
    // needed). The reverse direction (a sheet edit refreshing the
    // focused token's bars) already works via notifyCharacterSheetChanged,
    // unrelated to this.
    // Re-points this session's FOCUSED-slot registration at the new
    // characterId too (activeCharacterSessions) -- without that, a
    // sheet edit to whatever you just switched TO would stop reaching
    // this session.
    this.onMessage<FocusCharacterMessage>("focusCharacter", (client, { instanceId, direction }) => {
      const sender = this.state.players.get(client.sessionId);
      if (!sender) return;
      const isAdmin = this.adminSessionIds.has(client.sessionId);
      const targetIndex = this.state.otherCharacters.findIndex((o) => o.instanceId === instanceId && (o.placedByAccountId === sender.accountId || isAdmin));
      if (targetIndex === -1) return;

      const target = this.state.otherCharacters[targetIndex];
      const previousCharacterId = sender.currentInstance.characterId;

      this.state.otherCharacters.splice(targetIndex, 1);
      const previouslyFocused = sender.currentInstance;
      sender.currentInstance = target;
      if (direction === "previous") this.state.otherCharacters.unshift(previouslyFocused);
      else this.state.otherCharacters.push(previouslyFocused);

      this.unregisterActiveCharacter(client.sessionId, previousCharacterId);
      this.registerActiveCharacter(client.sessionId, target.characterId);
      this.syncCharacterRoomRegistration(target.characterId);
      this.syncCharacterRoomRegistration(previouslyFocused.characterId);
      this.persistPlacedCharacters();
    });

    // MVP goal item 4 follow-up (right-click context menu "Delete
    // instance"): removes the LIVE 3D instance only -- never the
    // character record or its game link (those are PR A's REST-backed
    // deleteCharacter/unlinkCharacterFromGame, a completely separate
    // action). Self-only (must be a world-level entry THIS SENDER
    // placed) UNLESS admin. Searches `otherCharacters` ONLY (`findInstance`,
    // not `findAnyInstance`) -- "can't delete the character you're
    // controlling" (real request: "that keeps at least one controllable
    // instance") stays structural: a currently-piloted instance simply
    // isn't in that array to find.
    this.onMessage<RemoveCharacterInstanceMessage>("removeCharacterInstance", (client, { instanceId }) => {
      const sender = this.state.players.get(client.sessionId);
      if (!sender) return;
      const isAdmin = this.adminSessionIds.has(client.sessionId);
      const index = this.state.otherCharacters.findIndex((o) => o.instanceId === instanceId && (o.placedByAccountId === sender.accountId || isAdmin));
      if (index === -1) return;

      const [removed] = this.state.otherCharacters.splice(index, 1);
      this.instanceVariableOverrides.delete(instanceId);
      this.syncCharacterRoomRegistration(removed.characterId);
      this.persistPlacedCharacters();
      // docs/BATTLE_SYSTEM.md: a turn-order entry can't outlive the
      // live instance it points to -- there's nothing left to track
      // position/stats for or Reset Turn against.
      this.removeTurnOrderEntriesByInstanceId(instanceId);
    });

    // docs/BATTLE_SYSTEM.md's turn-order tracker, phase 1. Real
    // correction, 2026-10-23: a character-scoped add is now allowed
    // for whoever OWNS that instance (admin OR isSendersOwnInstance),
    // not admin-only -- "if it's the player owning their own
    // characters, then sure, they should be able to... add their
    // characters." A bare-label (non-character) add stays admin-only
    // -- that's the "Add non-character..." free-text fallback for
    // traps/environmental effects with no owner to check, same tier as
    // Next Turn/Clear All below. `findAnyInstance` (not `findInstance`)
    // -- a currently-piloted instance is just as real and addable as
    // an idle one ("I cannot add my currently controlled character to
    // the turn order... even though I should be able to").
    this.onMessage<AddToTurnOrderMessage>("addToTurnOrder", (client, { label, instanceId, characterId }) => {
      const sender = this.state.players.get(client.sessionId);
      const isAdmin = this.adminSessionIds.has(client.sessionId);
      const entry = new TurnOrderEntryState();
      entry.turnEntryId = newInstanceId();
      if (instanceId && characterId) {
        if (!isSendersOwnInstance(sender, this.state.otherCharacters, instanceId) && !isAdmin) return;
        const existing = this.findAnyInstance(instanceId);
        if (!existing || existing.characterId !== characterId) return; // instanceId must actually belong to the claimed characterId -- sanity check, not just trust
        entry.instanceId = instanceId;
        entry.characterId = characterId;
        entry.label = existing.characterName;
      } else {
        if (!isAdmin) return;
        entry.label = label;
      }
      const beforeCount = this.state.turnOrder.length;
      this.state.turnOrder.push(entry);
      this.persistTurnOrder();
      this.applyWaypointAutoToggle(beforeCount);
      // Real correction, 2026-10-24: a character JOINING combat
      // mid-fight (turn order already non-empty, so the 0->1
      // transition above doesn't fire) still needs its OWN fresh
      // core waypoint, without touching any other already-active
      // combatant's chain -- applyWaypointAutoToggle only resets
      // EVERYONE on a 0<->1+ transition, not on every individual add.
      if (entry.instanceId && this.state.waypointsEnabled) {
        const instance = this.findAnyInstance(entry.instanceId);
        if (instance) this.resetWaypointsToCore(instance);
      }
    });

    // Real correction, 2026-10-23: same ownership relaxation as
    // addToTurnOrder above -- a player can remove their OWN
    // character's entry, but a bare-label (non-character) entry, or
    // someone else's character, still requires admin.
    this.onMessage<RemoveFromTurnOrderMessage>("removeFromTurnOrder", (client, { turnEntryId }) => {
      const sender = this.state.players.get(client.sessionId);
      const isAdmin = this.adminSessionIds.has(client.sessionId);
      const entry = this.state.turnOrder.find((e) => e.turnEntryId === turnEntryId);
      if (!entry) return;
      const ownsEntry = !!entry.instanceId && isSendersOwnInstance(sender, this.state.otherCharacters, entry.instanceId);
      if (!ownsEntry && !isAdmin) return;
      this.removeTurnOrderEntryById(turnEntryId);
    });

    this.onMessage("clearTurnOrder", (client) => {
      if (!this.adminSessionIds.has(client.sessionId)) return;
      const beforeCount = this.state.turnOrder.length;
      this.state.turnOrder.clear();
      this.state.turnOrderCurrentIndex = 0;
      this.state.turnOrderRound = 1;
      this.persistTurnOrder();
      this.applyWaypointAutoToggle(beforeCount);
    });

    this.onMessage<ReorderTurnOrderMessage>("reorderTurnOrder", (client, { turnEntryId, newIndex }) => {
      if (!this.adminSessionIds.has(client.sessionId)) return;
      const oldIndex = this.state.turnOrder.findIndex((e) => e.turnEntryId === turnEntryId);
      if (oldIndex === -1) return;
      const clampedNewIndex = Math.max(0, Math.min(newIndex, this.state.turnOrder.length - 1));
      if (clampedNewIndex === oldIndex) return;
      const snapshot = this.snapshotTurnOrder();
      const [moved] = snapshot.splice(oldIndex, 1);
      snapshot.splice(clampedNewIndex, 0, moved);
      this.reassignTurnOrder(snapshot);
      this.persistTurnOrder();
    });

    // Real request: "the gm can't sort by those [roll values], so
    // there should be sort ascending and sort descending buttons" --
    // GM-only (confirmed in the same message: "gm only for those sort
    // buttons of course"). An entry with no roll yet sorts as 0, the
    // same default the widget already displays for it.
    this.onMessage<{ direction: "asc" | "desc" }>("sortTurnOrderByRoll", (client, { direction }) => {
      if (!this.adminSessionIds.has(client.sessionId)) return;
      const snapshot = this.snapshotTurnOrder();
      snapshot.sort((a, b) => (direction === "asc" ? a.rollValue - b.rollValue : b.rollValue - a.rollValue));
      this.reassignTurnOrder(snapshot);
      this.persistTurnOrder();
    });

    // GM-only, real request: "the number (default 0 if no roll)...
    // editable by gm and not others" -- a manual, directly-typed
    // initiative value (not the `[[]]` roll-eval function, a later
    // phase). Not ownership-relaxed like add/remove above -- unlike
    // "which characters are IN the order," what number they're
    // sorted/displayed by is a GM-tier call.
    this.onMessage<SetTurnOrderRollValueMessage>("setTurnOrderRollValue", (client, { turnEntryId, value }) => {
      if (!this.adminSessionIds.has(client.sessionId)) return;
      if (!Number.isFinite(value)) return;
      const entry = this.state.turnOrder.find((e) => e.turnEntryId === turnEntryId);
      if (!entry) return;
      entry.rollValue = value;
      entry.hasRollValue = true;
      this.persistTurnOrder();
    });

    // GM-only, confirmed directly ("Only the GM should be able to
    // click next turn") -- a deliberate change from the old game's own
    // turn_tracker.gd, which had no permission check at all. No-op on
    // an empty order (nothing to advance through).
    this.onMessage("nextTurn", (client) => {
      if (!this.adminSessionIds.has(client.sessionId)) return;
      if (this.state.turnOrder.length === 0) return;
      this.state.turnOrderCurrentIndex++;
      if (this.state.turnOrderCurrentIndex >= this.state.turnOrder.length) {
        this.state.turnOrderCurrentIndex = 0;
        this.state.turnOrderRound++;
      }
      this.persistTurnOrder();
      // Real request: "the core waypoint should re-stamp on every
      // next turn, and in fact the whole list if a player moved
      // around, should clear, and just that core waypoint should be
      // left." Unconditional, not just when someone actually moved --
      // resetAllCoreWaypoints re-stamping at the SAME position a
      // player never left is a harmless no-op, and this is simpler
      // than tracking "did they move" separately. A precursor to the
      // fuller Reset Turn snapshot-on-advance feature (docs/
      // BATTLE_SYSTEM.md section 3), not that feature itself -- this
      // is position-only, not stats.
      if (this.state.waypointsEnabled) this.resetAllCoreWaypoints();
    });

    // docs/BATTLE_SYSTEM.md's waypoint/distance measurement. Operates
    // on whichever INSTANCE the sender currently pilots
    // (`currentInstance`) -- real correction, 2026-10-24: "it should
    // really be waypoints just following a specific instance, which
    // would make more sense with the turn order and swapping
    // control," not the piloting session itself (tabbing to a
    // different character used to leave the OLD chain's "live"
    // segment jumping to the NEW character's position, since the
    // chain stayed with the session). Self-only (a session can only
    // ever add/remove/clear the chain for whatever they're CURRENTLY
    // piloting, no admin bypass needed -- there's nothing here for an
    // admin to need access to on someone else's behalf). A no-op
    // while `waypointsEnabled` is false, for everyone, GM included --
    // "M/N and the panel's W+/W- do nothing while disabled."
    //
    // Position is CLIENT-reported (same "client reports its own
    // position, server trusts it" convention the "pos" handler
    // already uses -- no anti-cheat per the migration plan), snapped
    // to voxel-grid centers CLIENT-side before being sent; only
    // validated for finiteness here, same as "pos".
    this.onMessage<{ x: number; y: number; z: number }>("addWaypoint", (client, { x, y, z }) => {
      if (!this.state.waypointsEnabled) return;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
      const sender = this.state.players.get(client.sessionId);
      if (!sender) return;
      const waypoint = new WaypointState();
      waypoint.x = x;
      waypoint.y = y;
      waypoint.z = z;
      sender.currentInstance.waypoints.push(waypoint);
    });

    // Real request: "walk back to the last waypoint first, then a
    // second press actually removes it" -- that "am I standing on it"
    // check is entirely CLIENT-side (waypoints.ts reads its own
    // locally-known position against the synced last waypoint and
    // only sends this message once it's already decided to actually
    // remove, teleporting locally via playerController.teleportTo
    // otherwise -- same client/server split respawnControl.ts's own
    // Shift+R already uses). This handler just pops unconditionally --
    // EXCEPT the core waypoint (`isCore`, always whatever's left once
    // the chain is down to one entry), which can never be removed:
    // "there should be a core waypoint as long as waypoints are on,
    // one that can't be removed from the list."
    this.onMessage("removeWaypoint", (client) => {
      if (!this.state.waypointsEnabled) return;
      const sender = this.state.players.get(client.sessionId);
      const waypoints = sender?.currentInstance.waypoints;
      if (!waypoints || waypoints.length === 0) return;
      if (waypoints[waypoints.length - 1].isCore) return;
      waypoints.pop();
    });

    // Real request: "Finalizing the current waypoint chain" (Enter) --
    // commits/clears the WHOLE chain explicitly, without needing to
    // end the current turn to do it. Keeps the core waypoint, if any
    // (same "can't be removed from the list" rule as removeWaypoint
    // above) -- a fresh WaypointState with its same position/flag,
    // never the removed object itself (see resetWaypointsToCore's own
    // doc on why).
    this.onMessage("clearWaypoints", (client) => {
      const sender = this.state.players.get(client.sessionId);
      if (!sender) return;
      const waypoints = sender.currentInstance.waypoints;
      const existingCore = waypoints.find((w) => w.isCore);
      const coreData = existingCore ? { x: existingCore.x, y: existingCore.y, z: existingCore.z } : undefined;
      waypoints.clear();
      if (coreData) {
        const core = new WaypointState();
        core.x = coreData.x;
        core.y = coreData.y;
        core.z = coreData.z;
        core.isCore = true;
        waypoints.push(core);
      }
    });

    // GM-only manual override (the panel's own on/off toggle button) --
    // admin-gated server-side regardless of the G-key gmOverride toggle
    // the CLIENT additionally hides this behind (same split every other
    // "GM-only" turn-tracker control already uses). Sticks until the
    // NEXT 0<->1+ turn-order transition whose own checkbox is checked
    // (applyWaypointAutoToggle above) overwrites it again -- confirmed
    // directly by the user as the intended behavior.
    this.onMessage("toggleWaypoints", (client) => {
      if (!this.adminSessionIds.has(client.sessionId)) return;
      this.state.waypointsEnabled = !this.state.waypointsEnabled;
      if (this.state.waypointsEnabled) this.resetAllCoreWaypoints();
      store.setWaypointsEnabledForWorld(this.worldId, this.state.waypointsEnabled);
    });

    // Real request: "add a little color picker for them in the
    // waypoint window" -- sets whichever INSTANCE the sender
    // currently pilots (not admin-gated; everyone picks their OWN
    // waypoint color), same "follows the instance, not the session"
    // correction as addWaypoint/removeWaypoint/clearWaypoints above.
    // Not persisted, same reasoning as the waypoints themselves.
    this.onMessage<{ r: number; g: number; b: number }>("setWaypointColor", (client, { r, g, b }) => {
      if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return;
      const sender = this.state.players.get(client.sessionId);
      if (!sender) return;
      sender.currentInstance.waypointColorR = r;
      sender.currentInstance.waypointColorG = g;
      sender.currentInstance.waypointColorB = b;
    });

    // GM settings checkboxes (chatPanel.ts's GM tab) -- per-GAME, same
    // tier/pattern as setSeeThroughWalls above.
    this.onMessage<{ enabled: boolean }>("setWaypointAutoOn", (client, { enabled }) => {
      if (!this.adminSessionIds.has(client.sessionId) || !this.gameId) return;
      this.state.waypointAutoOnWithTurnOrder = enabled;
      store.setWaypointAutoOnForGame(this.gameId, enabled);
    });

    this.onMessage<{ enabled: boolean }>("setWaypointAutoOff", (client, { enabled }) => {
      if (!this.adminSessionIds.has(client.sessionId) || !this.gameId) return;
      this.state.waypointAutoOffWithoutTurnOrder = enabled;
      store.setWaypointAutoOffForGame(this.gameId, enabled);
    });

    // GM-only setting (the panel's expanded state) -- per-WORLD (see
    // WorldState.ts's own doc on why), the Minkowski exponent every
    // displayed distance label uses.
    this.onMessage<{ p: number }>("setWaypointDistanceMetric", (client, { p }) => {
      if (!this.adminSessionIds.has(client.sessionId)) return;
      if (!Number.isFinite(p) || p <= 0) return;
      this.state.waypointDistanceMetricP = p;
      store.setWaypointDistanceMetricForWorld(this.worldId, p);
    });

    // docs/BATTLE_SYSTEM.md's measurement shapes -- GM-only, per-WORLD,
    // same tier as setWaypointDistanceMetric above (retroactively
    // shared with the waypoint system's own distance labels too).
    this.onMessage<{ ftPerVoxel: number }>("setFtPerVoxel", (client, { ftPerVoxel }) => {
      if (!this.adminSessionIds.has(client.sessionId)) return;
      if (!Number.isFinite(ftPerVoxel) || ftPerVoxel <= 0) return;
      this.state.ftPerVoxel = ftPerVoxel;
      store.setFtPerVoxelForWorld(this.worldId, ftPerVoxel);
    });

    // docs/BATTLE_SYSTEM.md's measurement shapes -- sent once, only
    // when a shape is actually FINALIZED client-side (a chain via
    // Enter; a fixed-point-count shape -- cube/sphere/cone/beam --
    // the moment its last required point is placed). Everything
    // before that (the live ghost-preview/WASD/Tab editing) is pure
    // client-side state, never reaching the server at all -- see
    // MeasurementShapeState's own doc for why. `shapeId` is always
    // SERVER-generated (never trust a client-supplied id for
    // identity, same convention every other id in this file already
    // follows) -- the client discovers its own new shape's real id
    // from the Schema sync that naturally follows this push, not from
    // this message's own (nonexistent) reply.
    this.onMessage<{ kind: string; points: { x: number; y: number; z: number }[]; broadcast: boolean; coneDegrees?: number; isFrustum?: boolean; beamWidth?: number }>(
      "placeMeasurementShape",
      (client, { kind, points, broadcast, coneDegrees, isFrustum, beamWidth }) => {
        const sender = this.state.players.get(client.sessionId);
        if (!sender) return;
        if (!["chain", "cube", "sphere", "cone", "beam"].includes(kind)) return;
        if (points.length === 0 || !points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z))) return;

        // Real correction, 2026-10-24: "each session has ONE current
        // measurement object at a time... starting a new one replaces
        // whatever was active before" -- placing a new one discards
        // this sender's own previous shape first (same single-slot
        // precedent the waypoint chain already established).
        const previousIndex = this.state.measurementShapes.findIndex((s) => s.ownerAccountId === sender.accountId);
        if (previousIndex !== -1) this.state.measurementShapes.splice(previousIndex, 1);

        const shape = new MeasurementShapeState();
        shape.shapeId = newInstanceId();
        shape.kind = kind;
        shape.ownerAccountId = sender.accountId;
        shape.broadcast = broadcast;
        if (Number.isFinite(coneDegrees)) shape.coneDegrees = coneDegrees!;
        shape.isFrustum = !!isFrustum;
        if (Number.isFinite(beamWidth)) shape.beamWidth = beamWidth!;
        for (const p of points) {
          const point = new MeasurementPointState();
          point.x = p.x;
          point.y = p.y;
          point.z = p.z;
          shape.points.push(point);
        }
        this.state.measurementShapes.push(shape);
        this.persistMeasurementShapes();
      },
    );

    // The panel's own "remove my current measurement object" button,
    // AND the 3D right-click context menu's "Delete" entry (both send
    // the same message -- see MeasurementShapeState's own doc). Self-
    // only (must own the shape) unless admin, same ownership tier
    // every other instance-scoped handler in this file already uses.
    this.onMessage<{ shapeId: string }>("deleteMeasurementShape", (client, { shapeId }) => {
      const sender = this.state.players.get(client.sessionId);
      const isAdmin = this.adminSessionIds.has(client.sessionId);
      const index = this.state.measurementShapes.findIndex((s) => s.shapeId === shapeId);
      if (index === -1) return;
      const shape = this.state.measurementShapes[index];
      if (shape.ownerAccountId !== sender?.accountId && !isAdmin) return;
      this.state.measurementShapes.splice(index, 1);
      this.persistMeasurementShapes();
    });
  }

  async onDispose() {
    this.storage.close();
    for (const modId of this.loadedModIds) await this.modLoader.unloadMod(modId);
    // This room is going away -- remove it from every characterId entry
    // in the module-level activeCharacterRooms registry it was part of
    // (placed instances themselves are fine, already persisted; this is
    // purely cleaning up the in-process routing index so it doesn't
    // leak a reference to a dead room).
    for (const characterId of this.registeredRoomCharacterIds) {
      const rooms = activeCharacterRooms.get(characterId);
      if (!rooms) continue;
      rooms.delete(this);
      if (rooms.size === 0) activeCharacterRooms.delete(characterId);
    }
  }

  onJoin(client: Client, options?: JoinOptions) {
    const player = new PlayerState();
    player.name = options?.name || `Player-${client.sessionId.slice(0, 4)}`;
    this.state.players.set(client.sessionId, player);

    const isAdmin = store.isWorldAdmin(this.worldId, options?.accountId);
    if (isAdmin) this.adminSessionIds.add(client.sessionId);
    player.isAdmin = isAdmin;
    // Mirrors GameState.ts's own presence.accountId (GameRoom.ts) -- MVP goal item 4 follow-up: needed so placeCharacter can verify ownership.
    player.accountId = options?.accountId ?? "";

    // Real correction (2026-10-23): resume the EXACT instance (position,
    // stats, everything) this account was last piloting, if it names
    // one and still owns it -- "disconnecting and reconnecting puts
    // the player back to where they were exactly instead of
    // respawning." Never trusted blindly (same spirit as every other
    // id in this file): must actually exist, idle, and belong to this
    // account.
    const resumeIndex = options?.instanceId ? this.state.otherCharacters.findIndex((o) => o.instanceId === options.instanceId && o.placedByAccountId === player.accountId) : -1;
    if (resumeIndex !== -1) {
      const [resumed] = this.state.otherCharacters.splice(resumeIndex, 1);
      player.currentInstance = resumed;
      this.registerActiveCharacter(client.sessionId, resumed.characterId);
      this.syncCharacterRoomRegistration(resumed.characterId);
      // Real correction, 2026-10-24: waypoints now live on the
      // INSTANCE itself (`resumed`), not the piloting session -- its
      // existing chain (if any -- e.g. still in the turn order from
      // before this session disconnected) comes back for free with
      // the SAME object, nothing to stamp or reset here.
      console.log(`[WorldRoom:${this.worldId}] ${player.name} (${client.sessionId}) joined${isAdmin ? " [admin]" : ""}, resuming ${resumed.characterName}`);
      return;
    }

    // No resumable instance -- a genuinely fresh join (or the
    // previously-resumed instance is gone/not found). Spawn at the
    // admin-set anchor if one exists (a DM-prepared landing spot should
    // apply to new joiners too, not only explicit Shift+R respawns),
    // otherwise the safe-spawn scan.
    const [sx, sy, sz] = this.state.hasRespawnAnchor
      ? [this.state.respawnAnchorX, this.state.respawnAnchorY, this.state.respawnAnchorZ]
      : spawnPositionFor(this.worldId, this.worldGen);
    player.currentInstance.x = sx;
    player.currentInstance.y = sy;
    player.currentInstance.z = sz;

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
    const character = (options?.characterId ? store.getCharacter(options.characterId) : undefined) ?? store.getDefaultCharacterForAccount(player.accountId);
    if (character) {
      player.currentInstance.instanceId = newInstanceId();
      player.currentInstance.characterId = character.id;
      player.currentInstance.characterName = character.name;
      player.currentInstance.placedByAccountId = player.accountId;
      player.currentInstance.tokenColorR = character.token.color[0];
      player.currentInstance.tokenColorG = character.token.color[1];
      player.currentInstance.tokenColorB = character.token.color[2];
      applyBarsToCharacterTarget(player.currentInstance, character);
      applyReservedVariablesToCharacterTarget(player.currentInstance, character);
      this.registerActiveCharacter(client.sessionId, character.id);
      for (const effect of character.statusEffects) {
        const effectState = new StatusEffectState();
        effectState.icon = effect.icon;
        effectState.label = effect.label;
        player.currentInstance.statusEffects.push(effectState);
      }
      this.syncCharacterRoomRegistration(character.id);
    }

    // Real correction, 2026-10-24: a BRAND NEW instance (this is a
    // fresh join, never previously known to anything) has no reason
    // to get a core waypoint here -- it isn't in the turn order yet.
    // If it's later added to one (addToTurnOrder), that handler
    // stamps its own core then.

    console.log(`[WorldRoom:${this.worldId}] ${player.name} (${client.sessionId}) joined${isAdmin ? " [admin]" : ""}${character ? ` as ${character.name}` : ""}`);
  }

  onLeave(client: Client) {
    // Real correction (2026-10-23): the piloted instance is NOT
    // discarded any more -- it's pushed back into `otherCharacters`
    // (idle, exactly where it was) and persisted, same as any other
    // placed instance already was. Fixes a real bug found live: "the
    // controlled player starts in spawn instead [of where they were],
    // which is 100% wrong" -- onLeave used to delete the whole
    // PlayerState outright, discarding position/stats entirely.
    // Genuinely characterless (characterId === "") has nothing worth
    // keeping -- discarded, same as always.
    const player = this.state.players.get(client.sessionId);
    if (player) {
      const instance = player.currentInstance;
      const characterId = instance.characterId;
      // Removed from `players` BEFORE pushing into `otherCharacters` and
      // persisting -- real bug found while fixing this refactor:
      // persistPlacedCharacters's own `live` list reads BOTH
      // `otherCharacters` and every connected player's `currentInstance`,
      // so doing this in the other order double-counted the SAME
      // instance (still "connected" AND freshly pushed) into one
      // duplicated persisted record.
      this.state.players.delete(client.sessionId);
      if (characterId) {
        this.state.otherCharacters.push(instance);
        this.syncCharacterRoomRegistration(characterId);
        this.persistPlacedCharacters();
        this.unregisterActiveCharacter(client.sessionId, characterId);
      }
    } else {
      this.state.players.delete(client.sessionId);
    }
    this.adminSessionIds.delete(client.sessionId);
    console.log(`[WorldRoom:${this.worldId}] ${client.sessionId} left`);
  }
}
