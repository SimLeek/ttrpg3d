// Per-world generator dispatch -- replaces testArea.ts (deleted, along
// with its hand-built test area: stairs/gap/wall/marker pillars blended
// into every world regardless of id). That scaffolding was Phase-2-only
// infrastructure for exercising movement/origin-shift before real
// terrain existed; retired now that real per-world generator selection
// does (games-and-world-generators PR, confirmed explicitly by the user).
//
// "hilly" and "plains" are the SAME underlying algorithm (hillyTerrain.ts)
// with different fixed params, not two separate generators -- direct port
// of the old game's real structure (mods/plains_biome/register.gd reused
// generator_main.gd/hilly_terrain_region_generator.gd with
// trees_enabled=false, height_scale=0.12; see hillyTerrain.ts's own doc
// on heightScale). "limestone_slab" is a genuinely distinct, trivial
// bounded-box generator (limestoneSlab.ts).

import { AIR, type GeneratorId, type GeneratorParams, type LimestoneSlabParams } from "@ttrpg3d/shared";
import * as hillyTerrain from "./hillyTerrain.js";
import * as limestoneSlab from "./limestoneSlab.js";

export interface WorldGenInput {
  generatorId: GeneratorId;
  params: GeneratorParams;
}

const PLAINS_HEIGHT_SCALE = 0.12;

function hillyParamsFor(generatorId: GeneratorId): { heightScale: number; treesEnabled: boolean } {
  if (generatorId === "plains") return { heightScale: PLAINS_HEIGHT_SCALE, treesEnabled: false };
  return { heightScale: 1, treesEnabled: true };
}

/** Fill a CHUNK_SIZE^3 flat voxel array (x-major, matching noa's ndarray.set(i,j,k,v) order) for the chunk whose low corner is (originX, originY, originZ) in world-voxel space. */
export function fillChunk(voxels: Uint8Array, chunkSize: number, originX: number, originY: number, originZ: number, worldId: string, world: WorldGenInput): void {
  if (world.generatorId === "limestone_slab") {
    limestoneSlab.fillChunk(voxels, chunkSize, originX, originY, originZ, world.params as LimestoneSlabParams);
    return;
  }

  const { heightScale, treesEnabled } = hillyParamsFor(world.generatorId);
  let idx = 0;
  for (let i = 0; i < chunkSize; i++) {
    for (let j = 0; j < chunkSize; j++) {
      for (let k = 0; k < chunkSize; k++) {
        voxels[idx++] = hillyTerrain.blockAt(worldId, originX + i, originY + j, originZ + k, heightScale);
      }
    }
  }
  hillyTerrain.stampTrees(voxels, chunkSize, originX, originY, originZ, worldId, heightScale, treesEnabled);
}

/** Single-voxel coords -> block id, dispatched the same way fillChunk is. Used by the safe-spawn scan below. */
export function blockAt(worldId: string, wx: number, wy: number, wz: number, world: WorldGenInput): number {
  if (world.generatorId === "limestone_slab") {
    return limestoneSlab.blockAt(wx, wy, wz, world.params as LimestoneSlabParams);
  }
  const { heightScale } = hillyParamsFor(world.generatorId);
  return hillyTerrain.blockAt(worldId, wx, wy, wz, heightScale);
}

// Real bug found live: a fixed "surface height + 3" spawn (the previous
// approach) isn't actually safe -- a column's surface can be well inside
// a cave mouth/overhang (hilly/plains) or the fixed offset can simply be
// wrong for arbitrary limestone_slab dimensions, both reproduced live as
// "spawns underground" in BOTH generators. Real fix, per the user's own
// suggested algorithm: scan upward from a point low enough to be below
// any real ground, and use the first spot with two consecutive AIR
// voxels (room to stand) as spawn -- works generically for any
// generator/params without hardcoding per-generator assumptions about
// where "the surface" is.
const SCAN_MAX_Y = 300; // generous upper bound so a pathological world (e.g. limestone_slab with height=0) can't scan forever

function scanStartY(generatorId: GeneratorId): number {
  // limestone_slab is open air infinitely below y=0 (nothing solid down
  // there to climb above) -- start at the slab's own floor instead.
  // hilly/plains are solid (at least nominally -- caves can still carve
  // pockets even this low) below HEIGHT_MIN at every column, a safe
  // floor to scan up FROM.
  return generatorId === "limestone_slab" ? 0 : hillyTerrain.HEIGHT_MIN;
}

/** A clear, safe spawn point for this world's generator/params -- the first (x=8,z=8) column position with 2 consecutive air voxels, scanning up from a generator-appropriate floor. */
export function spawnPositionFor(worldId: string, world: WorldGenInput): [number, number, number] {
  const x = 8;
  const z = 8;
  let y = scanStartY(world.generatorId);
  while (y < SCAN_MAX_Y) {
    if (blockAt(worldId, x, y, z, world) === AIR && blockAt(worldId, x, y + 1, z, world) === AIR) {
      return [x, y, z];
    }
    y++;
  }
  return [x, SCAN_MAX_Y, z]; // pathological fallback, shouldn't be reachable in practice
}
