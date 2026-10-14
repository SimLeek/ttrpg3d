// Direct port of the old game's real scripts/pcg/limestone_slab_generator.gd
// (read in full, not guessed): a solid width x height x depth slab of one
// configurable voxel type starting at the origin, air everywhere else. No
// randomness at all -- same params always produce the same (trivial)
// result, and it's bounded rather than endless-streaming, which is what
// makes it "finite" in worldGenerators.ts's classification. Defaults to
// DIRT, not the old game's "limestone" -- that block type was never ported
// (no equivalent in packages/shared/src/voxelTypes.ts), so the old
// default's actual visual (a plain solid-color block) just isn't
// meaningfully different from using DIRT here.

import { AIR } from "@ttrpg3d/shared";
import type { LimestoneSlabParams } from "@ttrpg3d/shared";

/** World-voxel coords -> block id. Pure function, same input always gives same output. */
export function blockAt(wx: number, wy: number, wz: number, params: LimestoneSlabParams): number {
  if (wx < 0 || wx >= params.width) return AIR;
  if (wy < 0 || wy >= params.height) return AIR;
  if (wz < 0 || wz >= params.depth) return AIR;
  return params.voxelId;
}

export function fillChunk(voxels: Uint8Array, chunkSize: number, originX: number, originY: number, originZ: number, params: LimestoneSlabParams): void {
  let idx = 0;
  for (let i = 0; i < chunkSize; i++) {
    for (let j = 0; j < chunkSize; j++) {
      for (let k = 0; k < chunkSize; k++) {
        voxels[idx++] = blockAt(originX + i, originY + j, originZ + k, params);
      }
    }
  }
}

/** Centered above the slab, not inside/under it -- direct port of the old generator's own spawn_position(). */
export function spawnPosition(params: LimestoneSlabParams): [number, number, number] {
  return [params.width / 2, params.height + 2, params.depth / 2];
}
