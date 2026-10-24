// Player transforms go through Colyseus's Schema state (automatic
// binary-delta sync) per the architecture plan's Schema-vs-raw-binary
// split; chunk data does not (see ../world/testArea.ts + WorldRoom's
// "requestChunk"/"chunk" messages for that half).
//
// isAdmin/worldBottomY/hasRespawnAnchor+xyz (core/mod-boundary plan: GM
// admin-override escape hatch + respawn core primitives) are ALSO Schema
// fields, not one-time messages sent from WorldRoom.onJoin -- real race
// found live (a message client.send() in onJoin can arrive before a test's
// (or game.ts's) onMessage listener is registered, since connectTo()/
// joinOrCreate() resolves on the join handshake, not after every message
// the server happens to fire immediately afterward; confirmed via a
// flaky-by-design `@colyseus/sdk: onMessage() not registered` warning and
// a real test timeout). Schema fields don't have this race: the initial
// state snapshot (including these fields) is part of the join handshake
// itself, so they're already present the moment `joinOrCreate()` resolves
// -- same reasoning the existing x/y/z/yaw player-position fields already
// relied on, just not noticed until this needed a *reliably present at
// join* value too.

import { schema, t, MapSchema } from "@colyseus/schema";

/**
 * Real bug found live, three times over: -20 (first value, chosen to sit
 * just below testArea.ts's own CATCH_FLOOR_Y = -6 solid floor) was WAY
 * too shallow; -10000 was STILL wrong -- the actual cave generator is
 * genuinely infinitely deep with ground always present ("the cave
 * generation is actually infinitely deep here and there's always
 * ground"), so ANY finite value is eventually reachable by legitimate
 * deep digging and would falsely trigger; -Infinity (conceptually
 * correct -- `y < -Infinity` is never true for any finite y) turned out
 * to not survive this field's real wire encoding at all -- confirmed via
 * a real @colyseus/testing round-trip test, NOT assumed: `t.number()`'s
 * codec silently CLAMPS -Infinity to Number.MIN_SAFE_INTEGER
 * (-9007199254740991) on the wire, so a connected client never actually
 * received -Infinity even though the server-side JS value was correct.
 * Using that same clamped value directly, explicitly, here avoids relying
 * on a surprising silent transform and achieves the identical practical
 * effect (unreachable by any real gameplay y-coordinate) honestly. Per
 * the core/mod-boundary plan, a real per-world DM-configurable value is
 * Phase 7 DM-tools scope, not this PR -- every world uses this one fixed
 * default (effectively off) for now.
 */
export const DEFAULT_WORLD_BOTTOM_Y = Number.MIN_SAFE_INTEGER;

/** Mirrors store.ts's StatusEffect shape -- a flat {icon,label} entry, no mod-based catalog yet (MVP item 3, later). */
export const StatusEffectState = schema(
  {
    icon: t.string().default(""),
    label: t.string().default(""),
  },
  "StatusEffectState",
);

/**
 * One resolved billboard bar (mirrors shared/characterSheet.ts's
 * ResolvedBar) -- replaces the old fixed hp/maxHp/mp/maxMp fields
 * below. A player's bar LIST is now whatever their sheet's `bars`
 * config says, resolved against their own `variableValues`
 * (WorldRoom.ts's onJoin + setCharacterVariableValue), not a fixed
 * pair every character always has (docs/ROADMAP.md item 4 follow-up:
 * "HP/MP become DEFAULT ... not permanent/fixed ... linked to the
 * billboard bars").
 */
export const BarState = schema(
  {
    variableId: t.string().default(""),
    label: t.string().default(""),
    value: t.number().default(0),
    max: t.number().default(0),
    colorR: t.number().default(1),
    colorG: t.number().default(1),
    colorB: t.number().default(1),
  },
  "BarState",
);

/** docs/BATTLE_SYSTEM.md's waypoint/distance measurement -- one marked position in a session's own waypoint chain (M/N keybinds, the panel's W+/W- buttons). Snapped to voxel-grid centers client-side before being sent (same "client reports its own position, server trusts it" convention the "pos" message already uses), not re-validated server-side beyond finiteness. */
export const WaypointState = schema(
  {
    x: t.number().default(0),
    y: t.number().default(0),
    z: t.number().default(0),
  },
  "WaypointState",
);

/**
 * MVP goal item 4 follow-up (drag-and-drop placement + Tab/Shift+Tab
 * focus cycling): one real character instance in this world. Lives in
 * exactly one of two places at any moment -- an element of
 * `WorldState.otherCharacters` (idle/placed, nobody currently piloting
 * it) OR referenced by exactly one session's `PlayerState.
 * currentInstance` (being piloted right now) -- moved between the two
 * (`t.ref`, the SAME object, not copied) by WorldRoom.ts's
 * focusCharacter/onJoin/onLeave, never both at once (confirmed:
 * `@colyseus/schema` instances can't have two parents simultaneously).
 * This is a real correction, 2026-10-23: earlier, a piloted character
 * had NO instance of its own at all, just a separate set of fields
 * duplicated onto PlayerState directly -- see PlayerState's own doc
 * for the two real bugs that caused (couldn't reference your own
 * piloted character from the turn order; disconnecting lost its
 * position/stats entirely instead of persisting them).
 *
 * Real request: "I can't add multiple instances of the same character.
 * I would want to do that for monsters for example." `characterId`
 * alone used to be this entry's identity, which meant placing the same
 * character twice just moved/updated one shared entry -- `instanceId`
 * (server-generated, WorldRoom.ts's own placeCharacter/focusCharacter
 * handlers) is the REAL identity now, unique per placed instance, so
 * five goblins from one "Goblin" character sheet are five independent
 * entries. Independent stats too, not just independent position/looks
 * -- see WorldRoom.ts's `instanceVariableOverrides` doc for why bars/
 * body size are resolved per-instance rather than shared off the one
 * character record.
 *
 * Lives on `WorldState.otherCharacters` now (top-level, per-WORLD),
 * not `PlayerState.otherCharacters` (per-session) -- real feedback:
 * "the tokens do not persist upon exiting and re-entering games, so
 * if gms/players refresh, then monsters will disappear... they should
 * be stored and loaded with the page/world." A session-scoped array
 * can never survive that session disconnecting no matter what
 * persistence sits underneath it; these belong to the world, not
 * whoever happened to place them (store.ts's own
 * `setPlacedCharactersForWorld`/`WorldRecord.placedCharacters` is the
 * actual persisted-to-disk half). `placedByAccountId` replaces "is in
 * MY session's array" as the ownership test this now needs --
 * `placeCharacter` already requires owning the underlying character to
 * create one, so this just makes that ownership durable past the
 * placing session's own lifetime.
 */
export const OtherCharacterState = schema(
  {
    instanceId: t.string().default(""),
    characterId: t.string().default(""),
    characterName: t.string().default(""),
    placedByAccountId: t.string().default(""),
    x: t.number().default(0),
    y: t.number().default(0),
    z: t.number().default(0),
    yaw: t.number().default(0),
    tokenColorR: t.number().default(0),
    tokenColorG: t.number().default(0),
    tokenColorB: t.number().default(0),
    bars: t.array(BarState),
    bodyWidth: t.number().default(0.6),
    bodyHeight: t.number().default(1.8),
    bodyDepth: t.number().default(0.6),
    statusEffects: t.array(StatusEffectState),
  },
  "OtherCharacterState",
);

/**
 * Real correction (2026-10-23), replacing this session's own
 * duplicated characterId/characterName/tokenColor/bars/bodySize/
 * statusEffects/x/y/z/yaw fields entirely: the character a session is
 * piloting is now a REAL `OtherCharacterState` instance, held here by
 * reference (`t.ref`, moved -- not copied field-by-field -- out of
 * `WorldState.otherCharacters` while piloted, same object identity the
 * whole time) rather than a separate parallel representation. Real
 * bugs this fixes, found live:
 * - "I cannot add my currently controlled character to the turn
 *   order" -- it had no stable instanceId to add, since it wasn't a
 *   real instance at all while focused.
 * - "the controlled player starts in spawn instead [of where they
 *   were], which is 100% wrong" on a disconnect/refresh/rejoin --
 *   onLeave used to delete the whole PlayerState outright, discarding
 *   whatever position/stats this had reached. Now the instance itself
 *   is just pushed back into `otherCharacters`, untouched, and
 *   resuming it on rejoin (`currentInstanceId` in `JoinOptions`) picks
 *   up EXACTLY where it left off -- not a new copy, not respawn.
 *
 * ALWAYS present (never `undefined`), even for a genuinely
 * characterless session -- `currentInstance.characterId === ""` is
 * that state now (same "render no token" signal
 * `OtherCharacterState.characterId` already carried), not a second,
 * separate "no character" representation. This is also what lets
 * `instanceVariableOverrides` (WorldRoom.ts) be the ONLY override map
 * now -- the earlier `focusedVariableOverrides` existed purely
 * because the focused slot had no stable id to key overrides by; it
 * does now, so that whole map is gone.
 */
export const PlayerState = schema(
  {
    name: t.string().default("Player"),
    /** GM admin-override escape hatch (core/mod-boundary plan) -- set once in WorldRoom.onJoin from store.isWorldAdmin, never re-derived from anything the client sends. */
    isAdmin: t.boolean().default(false),
    /** Mirrors GameState.ts's own presence.accountId (GameRoom.ts) -- same "never trusted for anything auth-related beyond a fresh store check" rule. MVP goal item 4 follow-up: needed so `placeCharacter` can verify the sender actually owns the character they're placing. */
    accountId: t.string().default(""),
    currentInstance: t.ref(OtherCharacterState),
    /** docs/BATTLE_SYSTEM.md's waypoint/distance measurement -- a SESSION's own navigation aid (M/N, the panel's W+/W-), independent of whichever character they're currently piloting -- tabbing to a different character keeps your own waypoint chain, it doesn't move with the character. Not persisted (store.ts): lost on disconnect, same as any other scratch-measurement tool, not something the "assume unreliable connections" standing principle needs to protect. */
    waypoints: t.array(WaypointState),
  },
  "PlayerState",
);

/**
 * docs/BATTLE_SYSTEM.md -- one row in the turn-order tracker. Phase 1
 * (manual Add/Remove/Clear/Next Turn, built now) always has a STABLE
 * identity: either `instanceId` (an existing, already-placed
 * `OtherCharacterState` entry) or neither (a free-text `label` with no
 * live token at all -- same flexibility the old game's own "Add" had,
 * e.g. "Orc Captain" with nothing backing it). Deliberately does NOT
 * reference a session/PlayerState directly -- a Colyseus `sessionId`
 * is not stable across a disconnect/rejoin, and turn order has to
 * survive that (docs/BATTLE_SYSTEM.md's own persistence requirement,
 * "player b mid combat has an internet glitch... should they be
 * removed from combat? No."). That means a character someone is
 * CURRENTLY piloting (the focused slot, which has no `instanceId` of
 * its own) can't be referenced here yet -- initiative rolls (phase 2,
 * "I can tab between them, press 'initiative roll'...") have to solve
 * that separately, not assumed solved by this shape.
 */
export const TurnOrderEntryState = schema(
  {
    turnEntryId: t.string().default(""),
    label: t.string().default(""),
    instanceId: t.string().default(""),
    characterId: t.string().default(""),
    hasRollValue: t.boolean().default(false),
    rollValue: t.number().default(0),
  },
  "TurnOrderEntryState",
);

export const WorldState = schema(
  {
    players: t.map(PlayerState),
    /** MVP goal item 4 follow-up -- every placed-but-unfocused character instance in this WORLD (not just one session's own), persisted (store.ts) so they survive a session refreshing/leaving and a room being recreated. See OtherCharacterState's own doc. */
    otherCharacters: t.array(OtherCharacterState),
    worldBottomY: t.number().default(DEFAULT_WORLD_BOTTOM_Y),
    /** Respawn core primitive -- a plain `{x,y,z}|null` doesn't have a direct Schema equivalent used elsewhere in this codebase yet, so modeled as a presence flag + 3 flat numbers rather than reaching for an unverified optional-ref pattern. */
    hasRespawnAnchor: t.boolean().default(false),
    respawnAnchorX: t.number().default(0),
    respawnAnchorY: t.number().default(0),
    respawnAnchorZ: t.number().default(0),
    /** GM-only panel (gmPanel.ts): whether players can see through walls in third person (blockShaders.ts's xray-cutout shader). Room-level, not per-player -- same tier as worldBottomY/hasRespawnAnchor above. Seeded from the world's parent GameRecord.seeThroughWalls at WorldRoom.onCreate, then live-toggleable via the admin-gated "setSeeThroughWalls" message -- auto-synced to every connected client the instant it changes, no reload needed (unlike mods). */
    seeThroughWalls: t.boolean().default(true),
    /** docs/BATTLE_SYSTEM.md's turn-order tracker -- world-level (not per-session), persisted (store.ts), so it survives a disconnect/refresh/rejoin the same way otherCharacters already does. */
    turnOrder: t.array(TurnOrderEntryState),
    /** Index into `turnOrder` of whoever's turn it notionally is. Meaningless (0) when `turnOrder` is empty -- not a separate "is combat running" flag; see TurnOrderEntryState's own doc for why phase 1 keeps this simple. */
    turnOrderCurrentIndex: t.number().default(0),
    turnOrderRound: t.number().default(1),
    /**
     * docs/BATTLE_SYSTEM.md's waypoint/distance measurement -- the
     * REAL on/off state for M/N/the panel's W+/W- (not derived purely
     * from turn-order entry count, real correction: "the panel's own
     * visibility is cosmetic/per-client... that isn't the right
     * signal"). Per-WORLD, persisted (store.ts's
     * `setWaypointsEnabledForWorld`) so it survives a disconnect/
     * refresh/rejoin/room-recreation like every other world-level
     * state here. Auto-flips on a 0<->1+ turn-order-entry-count
     * TRANSITION (WorldRoom.ts's `applyWaypointAutoToggle`, gated by
     * the two settings below), and independently GM-toggleable at any
     * time via the panel's own on/off button -- that manual value
     * sticks until the next qualifying transition overwrites it
     * again, confirmed directly by the user as the intended (if
     * "tricky") behavior.
     */
    waypointsEnabled: t.boolean().default(false),
    /** GM settings checkbox (chatPanel.ts's GM tab, same tier as seeThroughWalls/mod toggles) -- per-GAME, default true. When true, `waypointsEnabled` auto-flips to true the moment the turn order goes from 0 to 1+ entries. */
    waypointAutoOnWithTurnOrder: t.boolean().default(true),
    /** Same tier as waypointAutoOnWithTurnOrder, independently settable -- per-GAME, default true. When true, `waypointsEnabled` auto-flips to false the moment the turn order goes from 1+ entries down to 0. */
    waypointAutoOffWithoutTurnOrder: t.boolean().default(true),
    /** GM-only setting (the panel's expanded state) -- the Minkowski exponent `p` every displayed waypoint distance label uses (shared/src/distance.ts's `minkowskiDistance`). 1 = Manhattan, 2 (default) = ordinary Euclidean. Per-WORLD (not per-game): "a world-level setting shared by everyone's displayed distances, not a per-player one." */
    waypointDistanceMetricP: t.number().default(2),
  },
  "WorldState",
);

export type WorldStateType = InstanceType<typeof WorldState>;
export type PlayerStateType = InstanceType<typeof PlayerState>;
export type PlayerMap = MapSchema<PlayerStateType>;
export type StatusEffectStateType = InstanceType<typeof StatusEffectState>;
export type BarStateType = InstanceType<typeof BarState>;
export type OtherCharacterStateType = InstanceType<typeof OtherCharacterState>;
export type TurnOrderEntryStateType = InstanceType<typeof TurnOrderEntryState>;
export type WaypointStateType = InstanceType<typeof WaypointState>;
