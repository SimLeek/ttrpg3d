// Voxel type table -- single source of truth for both client material
// registration (packages/client/src/game.ts) and server terrain
// generation (packages/server/src/world/hillyTerrain.ts). IDs match the
// old Godot repo's real scripts/pcg/voxel_types.gd numbering (not
// renumbered) -- useful if old worlds ever get imported later, and a
// reasonable default regardless.
//
// `solid`/`fluid` mirror the old NON_COLLIDABLE list exactly:
// [AIR, WATER_FULL, WATER_TOP, TALL_GRASS, DEAD_SHRUB] were the only
// non-collidable types there; everything else defaults solid=true.

export interface VoxelTypeDef {
  id: number;
  name: string;
  /**
   * How this type renders, decoded from the old game's real Blender/Godot
   * source files (dirt.obj + voxel_library.tres), not guessed:
   * - "cube": a regular terrain-meshed cube. textureFile is the base atlas
   *   filename (e.g. "dirt.png") -- the actual per-face textures are
   *   `${basename}_nx.png`/`_px.png`/`_ny.png`/`_py.png`/`_nz.png`/`_pz.png`
   *   under public/textures/blocks/ (produced once by
   *   scripts/slice-block-textures.mjs from the atlas's 3x2 grid of 16x16
   *   per-face cells -- the same grid dirt.obj's own UVs index into).
   * - "cross": a custom thin X-cross plant mesh (packages/client/src/
   *   plantMesh.ts), reusing the SAME 3x2 atlas layout and real decoded
   *   UVs as "cube" (confirmed via tall_grass.obj -- its 6 faces index the
   *   identical grid dirt.obj's faces do), rendered with alpha-cutout
   *   against the atlas's real alpha channel instead of noa's regular
   *   opaque terrain mesher.
   * - "none": no texture, flat color only (e.g. the ttrpg3d-specific
   *   MARKER QA block, which never existed in the old game).
   */
  mesh: "cube" | "cross" | "none";
  /** Base atlas filename under packages/client/public/textures/blocks/ (see `mesh` for how it's used), or null for "none". */
  textureFile: string | null;
  /** [r,g,b] 0..1, used as a fallback before a texture loads, or always for "none" types. */
  color: [number, number, number];
  solid: boolean;
  fluid: boolean;
}

export const AIR = 0;
export const DIRT = 1;
export const GRASS = 6;
export const WATER_FULL = 7;
export const WATER_TOP = 8;
export const LOG = 9;
export const LEAVES = 10;
export const TALL_GRASS = 11;
export const DEAD_SHRUB = 12;
export const MUDSTONE = 16;
export const PLASTIGLOMERATE = 17;
export const COAL_ORE = 18;
export const GYPSUM_ORE = 19;
export const HALITE_ORE = 20;
export const COPPER_ORE = 21;
export const QUARTZ = 22;
export const MAGNETITE = 23;

// ttrpg3d-specific QA block, not from the old game. NOT 998 anymore --
// found live (R&D session, see docs/PORTING_CHECKLIST.md's mod-id-base
// note): chunk voxel data is transported end-to-end as a single byte per
// voxel (Uint8Array, both the wire format in packages/shared/src/index.ts
// and the SQLite BLOB storage), so any id >255 silently wraps -- 998 mod
// 256 = 230, confirmed by finding literal id-230 voxels in a saved
// chunk's data where only id 998 (MARKER) should have been. Moved to a
// safely in-range value, clear of the real voxel ids (0-23) with plenty
// of headroom. The MOD_VOXEL_ID_BASE=1000 plan this was originally kept
// clear of hasn't been built yet (Phase 6) and will need to account for
// this same byte-width limit when it is -- flagged in the checklist too.
export const MARKER = 254;

export const VOXEL_TYPES: readonly VoxelTypeDef[] = [
  { id: DIRT, name: "dirt", mesh: "cube", textureFile: "dirt.png", color: [0.45, 0.36, 0.22], solid: true, fluid: false },
  { id: GRASS, name: "grass", mesh: "cube", textureFile: "grass.png", color: [0.3, 0.55, 0.25], solid: true, fluid: false },
  { id: WATER_FULL, name: "water", mesh: "cube", textureFile: "water.png", color: [0.2, 0.4, 0.8], solid: false, fluid: true },
  { id: WATER_TOP, name: "watertop", mesh: "cube", textureFile: "watertop.png", color: [0.25, 0.45, 0.85], solid: false, fluid: true },
  { id: LOG, name: "log", mesh: "cube", textureFile: "log.png", color: [0.4, 0.28, 0.15], solid: true, fluid: false },
  { id: LEAVES, name: "leaves", mesh: "cube", textureFile: "leaves.png", color: [0.2, 0.45, 0.15], solid: true, fluid: false },
  { id: TALL_GRASS, name: "tallgrass", mesh: "cross", textureFile: "tallgrass.png", color: [0.35, 0.6, 0.25], solid: false, fluid: false },
  { id: DEAD_SHRUB, name: "deadshrub", mesh: "cross", textureFile: "deadshrub.png", color: [0.5, 0.4, 0.25], solid: false, fluid: false },
  { id: MUDSTONE, name: "mudstone", mesh: "cube", textureFile: "mudstone.png", color: [0.4, 0.38, 0.35], solid: true, fluid: false },
  { id: PLASTIGLOMERATE, name: "plastiglomerate", mesh: "cube", textureFile: "plastiglomerate.png", color: [0.3, 0.3, 0.35], solid: true, fluid: false },
  { id: COAL_ORE, name: "coal_ore", mesh: "cube", textureFile: "coal.png", color: [0.15, 0.15, 0.15], solid: true, fluid: false },
  { id: GYPSUM_ORE, name: "gypsum_ore", mesh: "cube", textureFile: "gypsum.png", color: [0.85, 0.85, 0.8], solid: true, fluid: false },
  { id: HALITE_ORE, name: "halite_ore", mesh: "cube", textureFile: "halite.png", color: [0.9, 0.75, 0.75], solid: true, fluid: false },
  { id: COPPER_ORE, name: "copper_ore", mesh: "cube", textureFile: "copper.png", color: [0.55, 0.4, 0.25], solid: true, fluid: false },
  { id: QUARTZ, name: "quartz", mesh: "cube", textureFile: "quartz.png", color: [0.8, 0.8, 0.85], solid: true, fluid: false },
  { id: MAGNETITE, name: "magnetite", mesh: "cube", textureFile: "magnetite.png", color: [0.2, 0.2, 0.25], solid: true, fluid: false },
  { id: MARKER, name: "marker", mesh: "cube", textureFile: "marker.png", color: [1.0, 0.1, 0.8], solid: true, fluid: false },
];
