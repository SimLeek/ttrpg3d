// Phase 2 test area: a finite, deterministic, bounded generator in the same
// spirit as the old repo's limestone_slab_generator.gd ("same params always
// produce the same trivial result, no randomness, bounded not streaming"),
// but laid out with actual jump/climb geometry -- steps, a gap, a wall --
// instead of a flat slab, since movement feel can't be evaluated on a flat
// plane. Also carries a few fixed marker pillars (a distinct block id) at
// known world coordinates specifically so a floating-origin shift is
// visually checkable while playing, not just inferable from the console log
// noa-engine's rebase emits (see net.ts on the client for that log).
//
// Block ids (single hardcoded "ground" type is all Phase 2 scope calls for;
// AIR=0 and GROUND=1 match the values already wired up in the client's
// Phase 0 scaffold -- MARKER=2 is new).
export const AIR = 0;
export const GROUND = 1;
export const MARKER = 2;

export const AREA_SIZE = 48; // x and z span [0, AREA_SIZE) -- comfortably past noa's default 25-unit origin-rebase distance in every direction from center spawn
const FLOOR_TOP = 2; // floor occupies y in [0, FLOOR_TOP]
const CATCH_FLOOR_Y = -6; // safety net under the gap/pit so a missed jump doesn't fall forever

// Staircase: climbs from floor height up to STAIR_TOP, one step per STAIR_STEP_DEPTH along x.
const STAIR_X0 = 10;
const STAIR_STEPS = 6;
const STAIR_STEP_DEPTH = 2; // blocks of x per step
const STAIR_Z0 = 6;
const STAIR_Z1 = 12;

// Gap: a chasm to jump across, between the stairs and the wall.
const GAP_X0 = STAIR_X0 + STAIR_STEPS * STAIR_STEP_DEPTH + 2;
const GAP_X1 = GAP_X0 + 3;

// Wall: a short climbable/kickable wall segment past the gap (not yet used by
// any movement system this phase -- wall-kick lands later -- but cheap to
// build into the test area now rather than editing the generator again then).
const WALL_X0 = GAP_X1 + 6;
const WALL_X1 = WALL_X0 + 1;
const WALL_Z0 = 6;
const WALL_Z1 = 12;
const WALL_TOP = FLOOR_TOP + 4;

// Marker pillars: fixed, well-known points spanning the area so an origin
// shift is visible while walking in any direction from spawn.
const MARKER_POINTS: ReadonlyArray<readonly [number, number]> = [
  [4, 4],
  [AREA_SIZE - 4, 4],
  [4, AREA_SIZE - 4],
  [AREA_SIZE - 4, AREA_SIZE - 4],
  [AREA_SIZE / 2, AREA_SIZE / 2],
];
const MARKER_HEIGHT = 5; // blocks above the floor

function inStairColumn(wx: number): number | null {
  if (wx < STAIR_X0) return null;
  const step = Math.floor((wx - STAIR_X0) / STAIR_STEP_DEPTH);
  if (step >= STAIR_STEPS) return null;
  return step; // 0-indexed step number
}

/** World-voxel coords -> block id. Pure function, same input always gives same output. */
export function blockAt(wx: number, wy: number, wz: number): number {
  const inBounds = wx >= 0 && wx < AREA_SIZE && wz >= 0 && wz < AREA_SIZE;
  if (!inBounds) return AIR;

  // Marker pillars take priority -- thin (1x1), so they don't interfere with
  // the floor/stair/wall layout around them.
  for (const [mx, mz] of MARKER_POINTS) {
    if (wx === mx && wz === mz && wy > FLOOR_TOP && wy <= FLOOR_TOP + MARKER_HEIGHT) {
      return MARKER;
    }
  }

  const overGap = wx >= GAP_X0 && wx < GAP_X1;
  const overWall = wx >= WALL_X0 && wx < WALL_X1 && wz >= WALL_Z0 && wz < WALL_Z1;

  if (overWall && wy > FLOOR_TOP && wy <= WALL_TOP) return GROUND;

  const stairStep = wz >= STAIR_Z0 && wz < STAIR_Z1 ? inStairColumn(wx) : null;
  if (stairStep !== null) {
    const stepTop = FLOOR_TOP + 1 + stairStep;
    if (wy <= stepTop) return GROUND;
    return AIR;
  }

  if (!overGap && wy <= FLOOR_TOP) return GROUND;

  // Catch floor under the whole area (including the gap/pit) so a missed
  // jump lands on solid ground instead of falling forever.
  if (wy === CATCH_FLOOR_Y) return GROUND;

  return AIR;
}

/** Fill a CHUNK_SIZE^3 flat voxel array (x-major, matching noa's ndarray.set(i,j,k,v) order) for the chunk whose low corner is (originX, originY, originZ) in world-voxel space. */
export function fillChunk(
  voxels: Uint8Array,
  chunkSize: number,
  originX: number,
  originY: number,
  originZ: number,
): void {
  let idx = 0;
  for (let i = 0; i < chunkSize; i++) {
    for (let j = 0; j < chunkSize; j++) {
      for (let k = 0; k < chunkSize; k++) {
        voxels[idx++] = blockAt(originX + i, originY + j, originZ + k);
      }
    }
  }
}

/** Centered above the middle of the test area, matching limestone_slab_generator.gd's spawn_position() convention (centered above, not inside/under). */
export function spawnPosition(): [number, number, number] {
  return [AREA_SIZE / 2, FLOOR_TOP + 3, AREA_SIZE / 2];
}
