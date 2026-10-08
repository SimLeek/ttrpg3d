// Pure AABB-overlap check -- used by the client's voxelEditor.ts to stop
// a player placing a block that would overlap their own collision box
// (direct port of the old game's voxel_interactor.gd's
// `_is_voxel_overlapping_character`, just against noa's own
// position-component shape instead of Godot's CollisionShape3D). Pure
// geometry, nothing noa-specific about the check itself, so it lives
// here where it can get a real unit test rather than in the client
// package (which has no test runner -- this project's established split
// keeps pure/non-3D logic testable in shared/server, client stays thin
// wiring around it).

export interface AABB {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/** True if the two boxes share any volume. Touching exactly at a boundary (shared face/edge/corner, zero overlap volume) does NOT count as overlapping. */
export function aabbsOverlap(a: AABB, b: AABB): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY && a.minZ < b.maxZ && a.maxZ > b.minZ;
}
