// World generator catalog -- the roll20-"pages" concept's own type menu.
// Direct port of the old game's real scripts/pcg/world_generator_catalog.gd
// (read in full, not guessed): repeatable/non_repeatable/finite are
// classification TAGS shown next to each entry in the old DM creation UI
// (scripts/ui/dm_world_menu.gd), not the world types themselves. The old
// catalog had exactly 3 real entries -- "hilly" (repeatable), "plains"
// (repeatable -- NOT a separate algorithm, mods/plains_biome/register.gd
// reused the SAME hilly generator with fixed params `trees_enabled=false,
// windmills_enabled=false, height_scale=0.12`), "limestone_slab"
// (repeatable+finite, a bounded width/height/depth box of one voxel type).
// Same 3 types, same 2-underlying-algorithms structure, kept here.
//
// Shared (not server-only) because the client's new in-game page-
// management panel (packages/client/src/pageManager.ts) needs this same
// list/labels to build its generator-type picker, same reasoning as
// voxelTypes.ts/items.ts being shared.

import { DIRT } from "./voxelTypes.js";

export type Classification = "repeatable" | "non_repeatable" | "finite";

export type GeneratorId = "hilly" | "plains" | "limestone_slab";

export interface WorldGeneratorDef {
  id: GeneratorId;
  name: string;
  classifications: readonly Classification[];
}

export const WORLD_GENERATORS: readonly WorldGeneratorDef[] = [
  { id: "hilly", name: "Hilly Terrain", classifications: ["repeatable"] },
  { id: "plains", name: "Plains", classifications: ["repeatable"] },
  { id: "limestone_slab", name: "Limestone Slab", classifications: ["repeatable", "finite"] },
];

/**
 * 2026-10-11 decision: the auto-created starter world for a new game
 * defaults to "plains", not "hilly" -- aesthetics/marketability driven,
 * not a gameplay change (both stay fully selectable in the catalog).
 * Confirmed by directly comparing the old (`ttrpg3dgame.png`) and new
 * (`ttrpg3dgame-newdef.png`) reference screenshots: "hilly"'s default
 * heightScale=1.0 produces dramatic, near-vertical mountains ("amplified
 * minecraft"), while "plains" (heightScale=0.12, confirmed live as
 * "more just normal gen") matches the gentler rolling-hills look the
 * reference image shows -- including its lack of trees, consistent with
 * plains' own `treesEnabled=false`.
 */
export const DEFAULT_GENERATOR_ID: GeneratorId = "plains";

export function getGeneratorDef(id: GeneratorId): WorldGeneratorDef {
  const def = WORLD_GENERATORS.find((g) => g.id === id);
  if (!def) throw new Error(`Unknown generator id: ${id}`);
  return def;
}

/** "hilly"/"plains" take no player-supplied params -- their difference is the fixed params baked into worldGen.ts's dispatch, matching the old game's mod-variant structure exactly (see this file's header). Only "limestone_slab" has real per-world params. */
export interface LimestoneSlabParams {
  width: number;
  height: number;
  depth: number;
  voxelId: number;
}

export type GeneratorParams = LimestoneSlabParams | Record<string, never>;

export const DEFAULT_LIMESTONE_SLAB_PARAMS: LimestoneSlabParams = {
  width: 32,
  height: 8,
  depth: 32,
  voxelId: DIRT,
};
