// Phase 2 test area: a deterministic, hand-built region near spawn (steps/
// gap/wall/markers, for movement/origin-shift QA) plus the real hilly
// terrain generator (hillyTerrain.ts) everywhere else. The hand-built area
// stays exactly as it was -- it's still valuable movement-testing
// infrastructure -- but what's *outside* it is now actual varied terrain
// instead of a flat plane with grid pillars (those pillars were only ever
// a stopgap for "nothing to gauge movement against on a flat plane," a
// need real terrain's own hills/trees now meet on their own).
//
// Block ids come from packages/shared's voxel type table (the old game's
// real numeric IDs, preserved) -- this file's own GROUND/MARKER constants
// are gone; DIRT (same id the old GROUND=1 used) and MARKER (see
// shared/voxelTypes.ts for its current value and why it moved twice) are
// imported instead.

import { AIR, DIRT, MARKER } from "@ttrpg3d/shared";
import { hashString } from "./mathUtils.js";
import { blockAt as hillyBlockAt, stampTrees } from "./hillyTerrain.js";

export { AIR, DIRT as GROUND, MARKER };

export const AREA_SIZE = 48; // the hand-built area's footprint: x and z span [0, AREA_SIZE) -- beyond that, the real hilly terrain generator takes over
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

// Marker pillars: fixed, well-known points spanning the hand-built area so
// an origin shift is visible while walking in any direction from spawn.
const MARKER_POINTS: ReadonlyArray<readonly [number, number]> = [
  [4, 4],
  [AREA_SIZE - 4, 4],
  [4, AREA_SIZE - 4],
  [AREA_SIZE - 4, AREA_SIZE - 4],
  [AREA_SIZE / 2, AREA_SIZE / 2],
];
const MARKER_HEIGHT = 5; // blocks above the floor

// Per-world variant region: a small 5x5 footprint near spawn, clear of the
// stairs/gap/wall/markers, whose actual block structure depends on the
// world's id. Added back when every world's terrain was identical; real
// per-world hilly terrain (outside this area) now also differs by world,
// but this stays too -- it's a precise, guaranteed landmark close to
// spawn, cheaper to keep than to re-litigate.
const VARIANT_X0 = 36;
const VARIANT_Z0 = 20;
const VARIANT_SIZE = 5;

function inHandBuiltArea(x: number, z: number): boolean {
  return x >= 0 && x < AREA_SIZE && z >= 0 && z < AREA_SIZE;
}

/** Which of the 4 variant patterns `localX,localZ` (each 0..VARIANT_SIZE-1) belongs to, for pattern index `variant`. */
function inVariantPattern(variant: number, localX: number, localZ: number): boolean {
  const mid = Math.floor(VARIANT_SIZE / 2);
  switch (variant) {
    case 0: // solid platform
      return true;
    case 1: // plus/cross
      return localX === mid || localZ === mid;
    case 2: // hollow ring
      return localX === 0 || localX === VARIANT_SIZE - 1 || localZ === 0 || localZ === VARIANT_SIZE - 1;
    default: // lone center pillar (handled separately below for extra height)
      return localX === mid && localZ === mid;
  }
}

function variantRegionBlockAt(worldId: string, wx: number, wy: number, wz: number): number | null {
  const localX = wx - VARIANT_X0;
  const localZ = wz - VARIANT_Z0;
  if (localX < 0 || localX >= VARIANT_SIZE || localZ < 0 || localZ >= VARIANT_SIZE) return null;

  const variant = hashString(worldId) % 4;
  const height = variant === 3 ? FLOOR_TOP + 6 : FLOOR_TOP + 1; // pattern 3 is a single tall pillar, the rest are one block tall
  if (inVariantPattern(variant, localX, localZ) && wy > FLOOR_TOP && wy <= height) return MARKER;
  return null;
}

function inStairColumn(wx: number): number | null {
  if (wx < STAIR_X0) return null;
  const step = Math.floor((wx - STAIR_X0) / STAIR_STEP_DEPTH);
  if (step >= STAIR_STEPS) return null;
  return step; // 0-indexed step number
}

function handBuiltAreaBlockAt(worldId: string, wx: number, wy: number, wz: number): number {
  // Marker pillars take priority -- thin (1x1), so they don't interfere with
  // the floor/stair/wall layout around them.
  for (const [mx, mz] of MARKER_POINTS) {
    if (wx === mx && wz === mz && wy > FLOOR_TOP && wy <= FLOOR_TOP + MARKER_HEIGHT) {
      return MARKER;
    }
  }

  const variantBlock = variantRegionBlockAt(worldId, wx, wy, wz);
  if (variantBlock !== null) return variantBlock;

  const overGap = wx >= GAP_X0 && wx < GAP_X1;
  const overWall = wx >= WALL_X0 && wx < WALL_X1 && wz >= WALL_Z0 && wz < WALL_Z1;

  if (overWall && wy > FLOOR_TOP && wy <= WALL_TOP) return DIRT;

  const stairStep = wz >= STAIR_Z0 && wz < STAIR_Z1 ? inStairColumn(wx) : null;
  if (stairStep !== null) {
    const stepTop = FLOOR_TOP + 1 + stairStep;
    if (wy <= stepTop) return DIRT;
    return AIR;
  }

  if (!overGap && wy <= FLOOR_TOP) return DIRT;

  // Catch floor under the whole area (including the gap/pit) so a missed
  // jump lands on solid ground instead of falling forever.
  if (wy === CATCH_FLOOR_Y) return DIRT;

  return AIR;
}

/** World-voxel coords -> block id, salted by worldId. Pure function, same input always gives same output. Terrain shape only -- trees are a separate buffer-mutating pass, see fillChunk. */
export function blockAt(worldId: string, wx: number, wy: number, wz: number): number {
  return inHandBuiltArea(wx, wz) ? handBuiltAreaBlockAt(worldId, wx, wy, wz) : hillyBlockAt(worldId, wx, wy, wz);
}

/** Fill a CHUNK_SIZE^3 flat voxel array (x-major, matching noa's ndarray.set(i,j,k,v) order) for the chunk whose low corner is (originX, originY, originZ) in world-voxel space. */
export function fillChunk(
  voxels: Uint8Array,
  chunkSize: number,
  originX: number,
  originY: number,
  originZ: number,
  worldId: string,
): void {
  let idx = 0;
  for (let i = 0; i < chunkSize; i++) {
    for (let j = 0; j < chunkSize; j++) {
      for (let k = 0; k < chunkSize; k++) {
        voxels[idx++] = blockAt(worldId, originX + i, originY + j, originZ + k);
      }
    }
  }
  stampTrees(voxels, chunkSize, originX, originY, originZ, worldId, inHandBuiltArea);
}

/**
 * A clear spot on open floor -- NOT the exact area center. The center marker
 * pillar sits at (AREA_SIZE/2, AREA_SIZE/2), which is also right on the
 * gap's edge (GAP_X0 == AREA_SIZE/2 given the current layout constants) --
 * spawning there put the player's whole collision box inside solid marker
 * blocks with no floor underneath either, reproduced live ("stuck in a
 * pillar, can't move"). This spot is clear of the stairs, gap, wall, and
 * every marker column.
 */
export function spawnPosition(): [number, number, number] {
  return [8, FLOOR_TOP + 3, AREA_SIZE / 2];
}
