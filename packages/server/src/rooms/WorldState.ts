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

export const PlayerState = schema(
  {
    name: t.string().default("Player"),
    x: t.number().default(0),
    y: t.number().default(0),
    z: t.number().default(0),
    yaw: t.number().default(0),
    /** GM admin-override escape hatch (core/mod-boundary plan) -- set once in WorldRoom.onJoin from store.isWorldAdmin, never re-derived from anything the client sends. */
    isAdmin: t.boolean().default(false),
  },
  "PlayerState",
);

export const WorldState = schema(
  {
    players: t.map(PlayerState),
    worldBottomY: t.number().default(DEFAULT_WORLD_BOTTOM_Y),
    /** Respawn core primitive -- a plain `{x,y,z}|null` doesn't have a direct Schema equivalent used elsewhere in this codebase yet, so modeled as a presence flag + 3 flat numbers rather than reaching for an unverified optional-ref pattern. */
    hasRespawnAnchor: t.boolean().default(false),
    respawnAnchorX: t.number().default(0),
    respawnAnchorY: t.number().default(0),
    respawnAnchorZ: t.number().default(0),
  },
  "WorldState",
);

export type WorldStateType = InstanceType<typeof WorldState>;
export type PlayerStateType = InstanceType<typeof PlayerState>;
export type PlayerMap = MapSchema<PlayerStateType>;
