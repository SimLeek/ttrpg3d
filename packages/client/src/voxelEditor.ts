// Minimal place/break interaction -- the "place/break one hardcoded block
// type" piece that was originally scoped for Phase 2 but got deferred when
// movement/origin-shift was reprioritized ahead of it. Full multi-block-type
// placement (grid-snap, face-normal placement, self-overlap checks --
// voxel_interactor.gd) is still Phase 5; this is just enough to make the new
// per-world persistence (WorldRoom's "editBlock") actually exercisable.
//
// Binds noa's own default "fire"/"alt-fire" actions (left-click/right-click
// -- confirmed via game-inputs' source: DOM MouseEvent.button + 1, so
// button 0/left -> "Mouse1" -> "fire", button 2/right -> "Mouse3" ->
// "alt-fire") rather than adding new ones. noa.targetedBlock.position is
// the solid block being looked at (for breaking); .adjacent is the empty
// cell next to it along the hit normal (for placing) -- both read directly
// from noa's own block-targeting, not recomputed by hand.

import type { Engine } from "noa-engine";

const AIR = 0;
const GROUND = 1;

export function installVoxelEditor(noa: Engine, onEdit: (x: number, y: number, z: number, voxelId: number) => void): void {
  noa.inputs.down.on("fire", () => {
    const tgt = noa.targetedBlock;
    if (!tgt) return;
    const [x, y, z] = tgt.position;
    noa.setBlock(AIR, x, y, z);
    onEdit(x, y, z, AIR);
  });

  noa.inputs.down.on("alt-fire", () => {
    const tgt = noa.targetedBlock;
    if (!tgt) return;
    const [x, y, z] = tgt.adjacent;
    noa.setBlock(GROUND, x, y, z);
    onEdit(x, y, z, GROUND);
  });
}
