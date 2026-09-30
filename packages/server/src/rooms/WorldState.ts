// Player transforms go through Colyseus's Schema state (automatic
// binary-delta sync) per the architecture plan's Schema-vs-raw-binary
// split; chunk data does not (see ../world/testArea.ts + WorldRoom's
// "requestChunk"/"chunk" messages for that half).

import { schema, t, MapSchema } from "@colyseus/schema";

export const PlayerState = schema(
  {
    name: t.string().default("Player"),
    x: t.number().default(0),
    y: t.number().default(0),
    z: t.number().default(0),
    yaw: t.number().default(0),
  },
  "PlayerState",
);

export const WorldState = schema(
  {
    players: t.map(PlayerState),
  },
  "WorldState",
);

export type WorldStateType = InstanceType<typeof WorldState>;
export type PlayerStateType = InstanceType<typeof PlayerState>;
export type PlayerMap = MapSchema<PlayerStateType>;
