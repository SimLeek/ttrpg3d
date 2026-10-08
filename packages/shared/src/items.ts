// Item catalog -- direct analogue of the old game's item_catalog.gd +
// voxelitem.gd pattern: multi-block support isn't N different item
// scripts, it's one generic item *kind* instantiated once per placeable
// voxel type. A tagged union (not just a bare voxel id) so a future item
// kind (a pickaxe, say) can be added later without the hotbar/equip code
// that stores and reads `Item`s needing to change at all.
//
// Shared (not client-only) since the server may eventually want the same
// catalog shape for stock-tracking (Phase 5's "DM-vs-player inventory
// split") -- cheap to put here now, matches voxelTypes.ts's own
// placement as a client+server source of truth.

import { VOXEL_TYPES } from "./voxelTypes.js";

export interface PlaceBlockItem {
  kind: "place-block";
  voxelId: number;
  name: string;
  color: [number, number, number];
}

export type Item = PlaceBlockItem;

/** One `place-block` item per `placeable` voxel type, in VOXEL_TYPES's own order. */
export function buildBlockCatalog(): Item[] {
  return VOXEL_TYPES.filter((t) => t.placeable).map((t) => ({
    kind: "place-block",
    voxelId: t.id,
    name: t.name,
    color: t.color,
  }));
}
