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
