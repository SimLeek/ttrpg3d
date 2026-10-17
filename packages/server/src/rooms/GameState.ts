// Presence Schema for GameRoom -- "who is currently in this game," real
// Colyseus Schema state (auto-delta-synced), direct structural mirror of
// WorldState.ts's own PlayerState/WorldState pair. See GameRoom.ts's own
// header comment for why this is the ONE piece of Schema state that room
// has: presence is continuously-synced live state (what Schema is for),
// unlike chat itself (a discrete event log, broadcast+persisted, not
// Schema).

import { schema, t, MapSchema } from "@colyseus/schema";

export const PlayerPresence = schema(
  {
    name: t.string().default("Player"),
    /** MVP goal items 1-2 (docs/ROADMAP.md) -- lets partyListPanel.ts render a real per-character token color instead of today's initial-letter placeholder. Not full HP/MP/status here; that's WorldState.ts's PlayerState, scoped to an actual world session. A characterless join (real state, not an error -- see WorldRoom.ts's onJoin) leaves hasCharacter false and the color fields at their defaults -- an explicit flag rather than inferring "no character" from a zero color, which a deliberately black token would otherwise collide with. */
    hasCharacter: t.boolean().default(false),
    tokenColorR: t.number().default(0),
    tokenColorG: t.number().default(0),
    tokenColorB: t.number().default(0),
  },
  "PlayerPresence",
);

export const GameState = schema(
  {
    players: t.map(PlayerPresence),
  },
  "GameState",
);

export type GameStateType = InstanceType<typeof GameState>;
export type PlayerPresenceType = InstanceType<typeof PlayerPresence>;
export type PresenceMap = MapSchema<PlayerPresenceType>;
