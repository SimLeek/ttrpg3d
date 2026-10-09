// Place/break interaction. Breaking is unchanged from the original
// Phase-2 stub (always sets the targeted block to AIR, type-agnostic --
// matches the old game's del_vox_item.gd, which isn't equip-gated
// either). Placing now places whatever's equipped in the hotbar
// (hotbar.ts), not a hardcoded block type -- the Phase 4 extension this
// file was always scoped to become (see the old header comment this
// replaces).
//
// Binds noa's own default "fire"/"alt-fire" actions (left-click/right-
// click -- confirmed via game-inputs' source: DOM MouseEvent.button + 1,
// so button 0/left -> "Mouse1" -> "fire", button 2/right -> "Mouse3" ->
// "alt-fire") rather than adding new ones. noa.targetedBlock.position is
// the solid block being looked at (for breaking); .adjacent is the empty
// cell next to it along the hit normal (for placing) -- both read
// directly from noa's own block-targeting, not recomputed by hand. This
// is exactly the old game's voxel_interactor.gd's placement-position
// formula (hit voxel stepped back along the normal) -- noa already does
// that math internally, nothing to port there.
//
// Character-overlap guard (don't let the player place a block that would
// overlap their own collision box) is a direct port of
// voxel_interactor.gd's `_is_voxel_overlapping_character`, adapted to
// noa's own position-component shape (`.position` is the entity's
// bottom-center/feet anchor, `.width`/`.height` build the box upward and
// outward from there -- confirmed directly in noa's own
// updatePositionExtents) instead of Godot's CollisionShape3D lookup.

import type { Engine } from "noa-engine";
import { aabbsOverlap, type AABB, type Item } from "@ttrpg3d/shared";

const AIR = 0;

function playerAabb(noa: Engine): AABB {
  const state = noa.ents.getPositionData(noa.playerEntity) as { position: number[]; width: number; height: number };
  const [x, y, z] = state.position;
  const hw = state.width / 2;
  return { minX: x - hw, minY: y, minZ: z - hw, maxX: x + hw, maxY: y + state.height, maxZ: z + hw };
}

function blockAabb(x: number, y: number, z: number): AABB {
  return { minX: x, minY: y, minZ: z, maxX: x + 1, maxY: y + 1, maxZ: z + 1 };
}

export function installVoxelEditor(
  noa: Engine,
  getEquippedItem: () => Item | null,
  onEdit: (x: number, y: number, z: number, voxelId: number) => void,
  // GM admin-override escape hatch (core/mod-boundary plan): instant
  // build/delete bypasses the overlap guard while active -- a live check
  // (called per placement, not read once), matching gmOverride.ts's own
  // toggle semantics. Optional/defaulted so every existing call site (and
  // every test) that doesn't care about GM mode keeps working unchanged.
  isGmModeActive: () => boolean = () => false,
): void {
  noa.inputs.down.on("fire", () => {
    const tgt = noa.targetedBlock;
    if (!tgt) return;
    const [x, y, z] = tgt.position;
    noa.setBlock(AIR, x, y, z);
    onEdit(x, y, z, AIR);
  });

  noa.inputs.down.on("alt-fire", () => {
    const item = getEquippedItem();
    if (!item || item.kind !== "place-block") return; // nothing equipped, or a future non-block item kind with no placement behavior
    const tgt = noa.targetedBlock;
    if (!tgt) return;
    const [x, y, z] = tgt.adjacent;
    if (!isGmModeActive() && aabbsOverlap(blockAabb(x, y, z), playerAabb(noa))) return; // would overlap the player -- refuse, same as the old game (GM mode bypasses this, same as it bypasses terrain collision)
    noa.setBlock(item.voxelId, x, y, z);
    onEdit(x, y, z, item.voxelId);
  });
}
