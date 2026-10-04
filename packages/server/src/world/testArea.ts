// Phase 2 test area: a deterministic generator (same input always gives the
// same output, no randomness, matching the old repo's
// limestone_slab_generator.gd in spirit) with two regions:
// - A hand-built, bounded area near spawn with actual jump/climb geometry
//   -- steps, a gap, a wall -- instead of a flat slab, since movement feel
//   can't be evaluated on a flat plane. Carries a few fixed marker pillars
//   at known coordinates so a floating-origin shift is visually checkable
//   close to spawn.
// - Beyond that area: an actually-infinite flat plane with a regular grid
//   of pillars for distance/movement reference -- the hand-built area
//   alone (48x48) turned out too small to really exercise origin-shifting,
//   per live feedback once movement itself was working. This is the part
//   that makes the generator "infinite" rather than bounded -- it must
//   answer for any chunk coordinates, arbitrarily far from spawn.
//
// Block ids (single hardcoded "ground" type is all Phase 2 scope calls for;
// AIR=0 and GROUND=1 match the values already wired up in the client's
// Phase 0 scaffold -- MARKER=2 is new).
export const AIR = 0;
export const GROUND = 1;
export const MARKER = 2;

export const AREA_SIZE = 48; // the hand-built area's footprint: x and z span [0, AREA_SIZE) -- beyond that, the infinite flat plane takes over (see infinitePlaneBlockAt below)
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

// Beyond the hand-built area: an actually-infinite flat plane (not bounded
// like the rest of this generator) with a regular grid of pillars, purely
// so there's something to perceive movement/an origin-shift against once
// you've walked past the test area -- the hand-built area alone (48x48) is
// too small a span to really exercise that, per live feedback after the
// movement/origin-shift fixes landed. Reuses the MARKER block/color; a
// second "regular pillar" type isn't worth the extra id for what's purely
// a visual distance reference.
const GRID_PILLAR_SPACING = 16;
const GRID_PILLAR_HEIGHT = 4;

// Per-world variant region: a small 5x5 footprint near spawn, clear of the
// stairs/gap/wall/markers, whose actual block structure depends on the
// world's id. Added because two different worlds looked completely
// identical in practice -- confirmed live ("impossible to tell which I'm
// in") -- an on-screen label was tried first and explicitly rejected in
// favor of this: real, lookable-at differences in the terrain itself.
// Deliberately NOT full per-world storage (that's still Phase 4) -- this
// is one more deterministic function of (worldId, position), same spirit
// as everything else in this file, just salted by worldId too.
const VARIANT_X0 = 36;
const VARIANT_Z0 = 20;
const VARIANT_SIZE = 5;

/** Small, deterministic string hash (not cryptographic, doesn't need to be) -- just needs to spread different world ids across the variant patterns below. */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
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

/** Positive-and-negative-safe modulo (JS's `%` can return negatives). */
function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
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

function infinitePlaneBlockAt(wx: number, wy: number, wz: number): number {
  if (mod(wx, GRID_PILLAR_SPACING) === 0 && mod(wz, GRID_PILLAR_SPACING) === 0) {
    if (wy > FLOOR_TOP && wy <= FLOOR_TOP + GRID_PILLAR_HEIGHT) return MARKER;
  }
  if (wy <= FLOOR_TOP) return GROUND;
  return AIR;
}

/** World-voxel coords -> block id, salted by worldId (see the variant region above). Pure function, same input always gives same output. */
export function blockAt(worldId: string, wx: number, wy: number, wz: number): number {
  const inHandBuiltArea = wx >= 0 && wx < AREA_SIZE && wz >= 0 && wz < AREA_SIZE;
  return inHandBuiltArea ? handBuiltAreaBlockAt(worldId, wx, wy, wz) : infinitePlaneBlockAt(wx, wy, wz);
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
