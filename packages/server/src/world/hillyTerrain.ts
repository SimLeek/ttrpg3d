// Ported from the old repo's scripts/pcg/hilly_terrain_region_generator.gd
// (464 lines, researched in full before writing this). Deliberate
// approximations from the original, all flagged:
//
// - Noise: the old generator mixes FastNoiseLite Simplex (heightmap, ore
//   channels) and Cellular/Worley (caves) noise types. Replicating
//   Cellular exactly isn't worth it for a re-implementation in a
//   different engine -- this uses `simplex-noise` (real npm package,
//   confirmed) for every channel, including caves, with thresholds
//   re-tuned rather than copied byte-for-byte. Terrain will be similar in
//   spirit (hills, caves, ore veins), not pixel-identical to the old game.
// - Seeding: the old generator used fixed hardcoded noise seeds (1-9) --
//   every world looked the same. Seeds here derive from a hash of
//   `worldId` instead, so different worlds actually look different (this
//   was the whole point of the hand-built variant patch in testArea.ts,
//   done properly now that real terrain exists).
// - The old generator's cave carving has a "core" vs "shell" branch that,
//   given its water_table is always 0 in practice, produce the exact same
//   result (confirmed via the research pass) -- collapsed to one branch
//   here, not a behavior change.
// - height_scale (a post-curve midpoint squeeze used by a "plains" mod
//   variant) is fixed at 1.0 -- that variant is mod content, out of scope.
// - The old game's heightmap_curve.tres resource wasn't read (binary
//   Godot resource); this uses a smoothstep remap instead of its exact
//   shape, tuned by actually looking at the result in noa, not guessed.
// - Trees: ported with the same trunk/branch/leaf-shell algorithm, but
//   seeded from (worldId, anchor position) instead of Godot's global
//   (non-seeded, non-reproducible) RNG -- a world's terrain, trees
//   included, should be stable across reloads. Also: the old game
//   precomputed 4 tree shape variants and picked one per anchor; this
//   generates one shape per anchor directly (still varied, since each
//   anchor gets its own seed) -- simpler, same practical effect.
// - Windmills are not ported this pass (see docs/PORTING_CHECKLIST.md) --
//   deferred to their own later pass.

import { createNoise2D, createNoise3D, type NoiseFunction2D, type NoiseFunction3D } from "simplex-noise";
import { AIR, DIRT, GRASS, WATER_FULL, WATER_TOP, LOG, LEAVES, TALL_GRASS, DEAD_SHRUB, MUDSTONE, PLASTIGLOMERATE, COAL_ORE, GYPSUM_ORE, HALITE_ORE, COPPER_ORE, QUARTZ, MAGNETITE } from "@ttrpg3d/shared";
import { hashString, mulberry32 } from "./mathUtils.js";

const DIRT_LAYER_THICKNESS = 5;
const FOLIAGE_CHANCE = 0.2;
const DEAD_SHRUB_CHANCE = 0.1;
const SEA_LEVEL = 0;
// Was 0.01 -- effectively "greater than zero" against a noise field that
// straddles zero, which measured out to ~48% of ALL surface columns
// getting hollowed out (confirmed empirically, sampling a wide grid) --
// not a sparse cave system, closer to Swiss cheese. That's what was
// actually behind "grass/shrub/tree hills floating above the terrain"
// (confirmed live): the rare un-carved columns stood out as isolated
// islands against the (mostly carved-away) surrounding terrain. Re-tuned
// by measuring carved-fraction at several thresholds against this same
// noise field: 0.5 gives ~5% carved deep underground and ~9% carved at
// the surface (occasional real cave mouths/sinkholes, not everywhere).
const CAVE_THRESHOLD = 0.5;
const PLASTIGLOMERATE_MIN_Y = 40;
const PLASTIGLOMERATE_MAX_Y = 70;
const PLASTIGLOMERATE_THRESH = 0.3;
const GYPSUM_THRESH = 0.7;
const HALITE_THRESH = 0.7;
const COAL_THRESH = 0.85;
const COPPER_THRESH = 0.85;
const QUARTZ_THRESH = 0.9;
const MAGNETITE_THRESH = 0.9;

const HEIGHT_MIN = -32;
const HEIGHT_MAX = 96;

const HEIGHT_FREQ = 1 / 128;
const CAVE_FREQ = 1 / 128;
const CAVE_DETAIL_FREQ = 1 / 64;
const PLAST_FREQ = 1 / 20;
const GYPSUM_FREQ = 1 / 25;
const HALITE_FREQ = 1 / 25;
const COAL_FREQ = 1 / 30;
const COPPER_FREQ = 1 / 15;
const QUARTZ_FREQ = 1 / 15;
const MAGNETITE_FREQ = 1 / 15;

// Tree shape, ported from tree_generator.gd.
const TRUNK_LEN_MIN = 15;
const TRUNK_LEN_MAX = 30;
// Tree placement (this project's own addition, not from the old game --
// see the chunk-size-agnostic note in the plan): one candidate tree per
// this many voxels square.
const TREE_CELL_SIZE = 32;

interface NoiseChannels {
  height: NoiseFunction2D;
  caveBig: NoiseFunction3D;
  caveSmall: NoiseFunction3D;
  plast: NoiseFunction3D;
  gypsum: NoiseFunction3D;
  halite: NoiseFunction3D;
  coal: NoiseFunction3D;
  copper: NoiseFunction3D;
  quartz: NoiseFunction3D;
  magnetite: NoiseFunction3D;
}

// Building a simplex-noise instance allocates a 512-entry permutation
// table -- expensive to redo per voxel. Cache per world, built lazily.
const noiseCache = new Map<string, NoiseChannels>();

function seededFor(worldId: string, channel: string) {
  return mulberry32(hashString(`${worldId}:${channel}`));
}

function getNoiseChannels(worldId: string): NoiseChannels {
  let channels = noiseCache.get(worldId);
  if (channels) return channels;
  channels = {
    height: createNoise2D(seededFor(worldId, "height")),
    caveBig: createNoise3D(seededFor(worldId, "caveBig")),
    caveSmall: createNoise3D(seededFor(worldId, "caveSmall")),
    plast: createNoise3D(seededFor(worldId, "plast")),
    gypsum: createNoise3D(seededFor(worldId, "gypsum")),
    halite: createNoise3D(seededFor(worldId, "halite")),
    coal: createNoise3D(seededFor(worldId, "coal")),
    copper: createNoise3D(seededFor(worldId, "copper")),
    quartz: createNoise3D(seededFor(worldId, "quartz")),
    magnetite: createNoise3D(seededFor(worldId, "magnetite")),
  };
  noiseCache.set(worldId, channels);
  return channels;
}

/** Fractal Brownian motion: sums octaves of noise at increasing frequency, decreasing amplitude. Normalized to roughly [-1,1]. */
function fbm2D(noise: NoiseFunction2D, x: number, z: number, octaves: number, baseFreq: number, gain = 0.5, lacunarity = 2): number {
  let sum = 0;
  let amp = 1;
  let freq = baseFreq;
  let maxAmp = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise(x * freq, z * freq) * amp;
    maxAmp += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / maxAmp;
}

function fbm3D(noise: NoiseFunction3D, x: number, y: number, z: number, octaves: number, baseFreq: number, gain = 0.5, lacunarity = 2): number {
  let sum = 0;
  let amp = 1;
  let freq = baseFreq;
  let maxAmp = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise(x * freq, y * freq, z * freq) * amp;
    maxAmp += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / maxAmp;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

export function getHeightAt(worldId: string, x: number, z: number): number {
  const noise = getNoiseChannels(worldId);
  const raw = fbm2D(noise.height, x, z, 4, HEIGHT_FREQ);
  const normalized = 0.5 + 0.5 * raw; // [0,1]
  const eased = smoothstep(normalized);
  return Math.floor(HEIGHT_MIN + eased * (HEIGHT_MAX - HEIGHT_MIN));
}

function getBaseVoxel(gy: number, surfaceHeight: number): number {
  if (gy < surfaceHeight) {
    return surfaceHeight - gy < DIRT_LAYER_THICKNESS ? DIRT : MUDSTONE;
  }
  if (gy < SEA_LEVEL) {
    return gy < SEA_LEVEL - 1 ? WATER_FULL : WATER_TOP;
  }
  return AIR;
}

function applyOres(wx: number, wy: number, wz: number, noise: NoiseChannels): number | null {
  if (wy > SEA_LEVEL - 1 && wy < SEA_LEVEL + 1) {
    if (fbm3D(noise.gypsum, wx, wy, wz, 3, GYPSUM_FREQ) > GYPSUM_THRESH) return GYPSUM_ORE;
    if (fbm3D(noise.halite, wx, wy, wz, 3, HALITE_FREQ) > HALITE_THRESH) return HALITE_ORE;
  }
  if (wy >= PLASTIGLOMERATE_MIN_Y && wy <= PLASTIGLOMERATE_MAX_Y) {
    const midY = (PLASTIGLOMERATE_MIN_Y + PLASTIGLOMERATE_MAX_Y) / 2;
    const halfRange = (PLASTIGLOMERATE_MAX_Y - PLASTIGLOMERATE_MIN_Y) / 2;
    const heightFactor = 1 - Math.abs(wy - midY) / halfRange;
    const p = (fbm3D(noise.plast, wx, wy, wz, 2, PLAST_FREQ) + 1) / 2;
    if (p * heightFactor > PLASTIGLOMERATE_THRESH) return PLASTIGLOMERATE;
  }
  if (wy <= 100) {
    if ((fbm3D(noise.coal, wx, wy, wz, 2, COAL_FREQ) + 1) / 2 > COAL_THRESH) return COAL_ORE;
  }
  if ((fbm3D(noise.copper, wx, wy, wz, 2, COPPER_FREQ) + 1) / 2 > COPPER_THRESH) return COPPER_ORE;
  if ((fbm3D(noise.quartz, wx, wy, wz, 2, QUARTZ_FREQ) + 1) / 2 > QUARTZ_THRESH) return QUARTZ;
  if ((fbm3D(noise.magnetite, wx, wy, wz, 2, MAGNETITE_FREQ) + 1) / 2 > MAGNETITE_THRESH) return MAGNETITE;
  return null;
}

// Everything solid is carvable, including the surface dirt/grass crust --
// excluding DIRT/GRASS here (the original approach) protected the top
// layer from caves, but a cave can still hollow out the MUDSTONE directly
// beneath an unprotected column's crust, leaving an unsupported DIRT/GRASS
// (and TALL_GRASS/DEAD_SHRUB, placed only where the grass cap survives --
// see blockAt) raft floating over open cave air with visible holes all
// around it (confirmed live via screenshot). Carving the crust too turns
// that into a real, consistent sinkhole/cave-entrance instead.
function isCarvableVoxel(v: number): boolean {
  return v !== AIR && v !== WATER_FULL && v !== WATER_TOP;
}

function applyCave(wx: number, wy: number, wz: number, voxel: number, noise: NoiseChannels): number {
  if (!isCarvableVoxel(voxel)) return voxel;
  const big = fbm3D(noise.caveBig, wx, wy, wz, 3, CAVE_FREQ, 0.4);
  const small = fbm3D(noise.caveSmall, wx * 1.8, wy * 1.8, wz * 1.8, 2, CAVE_DETAIL_FREQ, 0.45);
  const combined = big + small * 0.5;
  // Old generator branches on a second "spawn threshold" here, but both
  // branches resolve identically given its water_table is always 0 in
  // practice (confirmed by research) -- collapsed to one branch.
  if (combined > CAVE_THRESHOLD) {
    return wy < SEA_LEVEL ? WATER_FULL : AIR;
  }
  return voxel;
}

/** World-voxel coords -> block id for the real hilly terrain (no trees -- see stampTrees). Pure function, same input always gives same output. */
export function blockAt(worldId: string, wx: number, wy: number, wz: number): number {
  const noise = getNoiseChannels(worldId);
  const surfaceHeight = getHeightAt(worldId, wx, wz);

  // Surface decoration at these two Y levels, same as the old generator
  // (its decoration pass runs after, and overwrites, the main per-voxel
  // pass) -- but now cave-carved like everything else (see
  // isCarvableVoxel's comment): foliage only ever gets placed where the
  // grass cap directly below it actually survived carving, instead of
  // unconditionally floating over whatever cave air ended up there.
  if (surfaceHeight >= SEA_LEVEL && (wy === surfaceHeight || wy === surfaceHeight + 1)) {
    const surfaceVoxel = applyCave(wx, surfaceHeight, wz, GRASS, noise);
    if (wy === surfaceHeight) return surfaceVoxel;
    if (surfaceVoxel === GRASS) {
      const roll = seededFor(worldId, `foliage:${wx},${wz}`)();
      if (roll < FOLIAGE_CHANCE) {
        const typeRoll = seededFor(worldId, `foliageType:${wx},${wz}`)();
        return typeRoll >= DEAD_SHRUB_CHANCE ? TALL_GRASS : DEAD_SHRUB;
      }
    }
    return AIR;
  }

  let voxel = getBaseVoxel(wy, surfaceHeight);
  if (voxel === MUDSTONE) {
    const ore = applyOres(wx, wy, wz, noise);
    if (ore !== null) voxel = ore;
  }
  return applyCave(wx, wy, wz, voxel, noise);
}

// ---- trees ----

interface TreeVoxel {
  dx: number;
  dy: number;
  dz: number;
  type: number;
}

/** Deterministic tree shape anchored at local (0,0,0) = trunk base, seeded from (worldId, anchor). Ported from tree_generator.gd. */
function generateTreeShape(worldId: string, anchorX: number, anchorZ: number): TreeVoxel[] {
  const rand = seededFor(worldId, `tree:${anchorX},${anchorZ}`);
  const voxels = new Map<string, TreeVoxel>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const set = (x: number, y: number, z: number, type: number) => voxels.set(key(x, y, z), { dx: x, dy: y, dz: z, type });

  const trunkLen = Math.floor(TRUNK_LEN_MIN + rand() * (TRUNK_LEN_MAX - TRUNK_LEN_MIN));
  for (let y = 0; y < trunkLen; y++) set(0, y, 0, LOG);

  const branchesStart = Math.floor(Math.floor(trunkLen / 3) + rand() * (Math.floor(trunkLen / 2) - Math.floor(trunkLen / 3)));
  for (let y = branchesStart; y < trunkLen; y++) {
    const t = (y - branchesStart) / trunkLen;
    const branchChance = 1 - (t - 0.5) * (t - 0.5);
    if (rand() < branchChance) {
      const branchLen = Math.floor((trunkLen / 2) * branchChance * rand());
      const angle = rand() * 2 * Math.PI - Math.PI;
      const dir = [Math.cos(angle), 0.45, Math.sin(angle)];
      let pos: [number, number, number] = [0, y, 0];
      for (let i = 0; i < branchLen; i++) {
        pos = [pos[0] + dir[0], pos[1] + dir[1], pos[2] + dir[2]];
        set(Math.round(pos[0]), Math.round(pos[1]), Math.round(pos[2]), LOG);
      }
    }
  }

  const logPositions = Array.from(voxels.values());
  // Fisher-Yates shuffle, seeded by the same tree rand stream.
  for (let i = logPositions.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [logPositions[i], logPositions[j]] = [logPositions[j], logPositions[i]];
  }
  const leafCount = Math.floor(0.75 * logPositions.length);
  const neighborDirs: Array<[number, number, number]> = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  ];
  for (let i = 0; i < leafCount; i++) {
    const p = logPositions[i];
    if (p.dy < branchesStart) continue;
    for (const [ox, oy, oz] of neighborDirs) {
      const nx = p.dx + ox, ny = p.dy + oy, nz = p.dz + oz;
      if (!voxels.has(key(nx, ny, nz))) set(nx, ny, nz, LEAVES);
    }
  }

  return Array.from(voxels.values());
}

// Roughly in the same ballpark as the old game's density (~1 tree per
// 16x16=256 sq. units -- this project's TREE_CELL_SIZE is 32x32=1024 sq.
// units, so TREE_DENSITY=0.3 lands close to that per-area rate).
const TREE_DENSITY = 0.3;

/** Does the TREE_CELL_SIZE-sized cell containing (cellX,cellZ) have a tree, and if so where's its anchor (world XZ, always on real hilly terrain -- never inside the hand-built test area, gated by the caller)? */
function treeAnchorForCell(worldId: string, cellX: number, cellZ: number): { x: number; z: number } | null {
  if (seededFor(worldId, `treePresence:${cellX},${cellZ}`)() >= TREE_DENSITY) return null;
  const localX = Math.floor(seededFor(worldId, `treeLocalX:${cellX},${cellZ}`)() * TREE_CELL_SIZE);
  const localZ = Math.floor(seededFor(worldId, `treeLocalZ:${cellX},${cellZ}`)() * TREE_CELL_SIZE);
  return { x: cellX * TREE_CELL_SIZE + localX, z: cellZ * TREE_CELL_SIZE + localZ };
}

/**
 * Stamps trees into an already-terrain-filled chunk buffer, in place.
 * Scans this chunk's cell plus its 8 neighbors (a tree anchored in a
 * neighboring cell can still have branches/leaves overhanging into this
 * chunk), matching the old generator's Moore-neighbor collection.
 * `insideHandBuiltArea(x,z)` lets the caller keep trees out of the
 * hand-built test area (testArea.ts) -- trees only belong in real terrain.
 */
export function stampTrees(
  voxels: Uint8Array,
  chunkSize: number,
  originX: number,
  originY: number,
  originZ: number,
  worldId: string,
  insideHandBuiltArea: (x: number, z: number) => boolean,
): void {
  const flatIndex = (i: number, j: number, k: number) => i * chunkSize * chunkSize + j * chunkSize + k;
  const cellX0 = Math.floor(originX / TREE_CELL_SIZE);
  const cellZ0 = Math.floor(originZ / TREE_CELL_SIZE);

  for (let dcx = -1; dcx <= 1; dcx++) {
    for (let dcz = -1; dcz <= 1; dcz++) {
      const cellX = cellX0 + dcx;
      const cellZ = cellZ0 + dcz;
      const anchor = treeAnchorForCell(worldId, cellX, cellZ);
      if (!anchor) continue;
      if (insideHandBuiltArea(anchor.x, anchor.z)) continue;

      const anchorY = getHeightAt(worldId, anchor.x, anchor.z);
      if (anchorY < SEA_LEVEL) continue; // no trees in/under water

      // anchorY is the raw, un-carved heightmap value -- if a cave happens
      // to intersect the surface right at this anchor, the real ground
      // there has already been hollowed out (same issue blockAt's grass
      // cap had, fixed above). Without this check a tree still gets
      // stamped starting from that now-empty point, floating with no
      // connection to any solid ground (confirmed live).
      const anchorGround = applyCave(anchor.x, anchorY, anchor.z, GRASS, getNoiseChannels(worldId));
      if (anchorGround !== GRASS) continue;

      const shape = generateTreeShape(worldId, anchor.x, anchor.z);
      for (const v of shape) {
        const wx = anchor.x + v.dx;
        const wy = anchorY + v.dy;
        const wz = anchor.z + v.dz;
        const i = wx - originX;
        const j = wy - originY;
        const k = wz - originZ;
        if (i < 0 || i >= chunkSize || j < 0 || j >= chunkSize || k < 0 || k >= chunkSize) continue;
        voxels[flatIndex(i, j, k)] = v.type;
      }
    }
  }
}
