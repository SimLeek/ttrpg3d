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
   * - "cube": a regular terrain-meshed cube. textureFile names its source
   *   atlas under packages/client/textures-source/blocks/ (the old game's
   *   3x2-grid-of-16x16-per-face-cells layout, the same grid dirt.obj's
   *   own UVs index into) -- NOT loaded directly at runtime. Instead,
   *   scripts/build-block-atlas.mjs crops each cube type's 6 faces out of
   *   its source atlas and packs them into ONE shared, real noa-engine
   *   texture-array atlas (public/textures/blocks-atlas.png, a vertical
   *   strip of 16x16 layers -- noa's own supported atlas mechanism,
   *   confirmed via its terrainMaterials.js/TerrainMaterialPlugin and its
   *   own official example's "recommended to have all your terrain
   *   textures in a single atlas" note). This replaced an earlier,
   *   much worse approach of shipping 6 separate real PNG files per cube
   *   type. Each type's actual runtime atlas location is `atlasUrl` +
   *   `atlasBaseLayer` below (computed once, right after this table, from
   *   this array's order + FACE_ORDER) -- game.ts's registration loop
   *   just reads those two fields per type, so it works unmodified for
   *   any future type (mod-provided or otherwise) that sets its own.
   * - "cross": a custom thin X-cross plant mesh (packages/client/src/
   *   plantMesh.ts), reusing the SAME 3x2 atlas layout and real decoded
   *   UVs as "cube" (confirmed via tall_grass.obj -- its 6 faces index the
   *   identical grid dirt.obj's faces do), rendered with alpha-cutout
   *   against the atlas's real alpha channel instead of noa's regular
   *   opaque terrain mesher. textureFile here IS loaded directly at
   *   runtime (from public/textures/blocks/), since this mesh samples the
   *   whole unsliced atlas with its own literal UVs, not noa's per-face
   *   texture-array system.
   * - "none": no texture, flat color only (e.g. the ttrpg3d-specific
   *   MARKER QA block, which never existed in the old game).
   */
  mesh: "cube" | "cross" | "none";
  /** Source atlas filename (see `mesh` for exactly how/where it's used), or null for "none". */
  textureFile: string | null;
  /**
   * Which runtime texture-array atlas this "cube" type's faces live in
   * (a URL under packages/client/public/textures/blocks/, resolved against
   * noa's `texturePath`), or null for non-"cube" types. Deliberately a
   * per-type field, not a single global constant -- noa's own material
   * registration is already per-material (`registerMaterial(name,
   * {textureURL, atlasIndex})`), so different block types can freely point
   * at different atlases with no engine-side limitation. Keeping this on
   * each type (rather than one hardcoded atlas URL in game.ts) is what
   * lets a *future* mod register its own blocks against its own separate
   * atlas file later (Phase 6, not built yet) without touching the core
   * registration loop at all -- it would just populate these same two
   * fields on its own entries. All of the current built-in "cube" types
   * share one atlas (the most performant arrangement for a fixed, known
   * block set) -- see CUBE_TYPE_NAMES/FACE_ORDER below for how.
   */
  atlasUrl: string | null;
  /** This type's first face's layer index within `atlasUrl` -- its 6 faces occupy `atlasBaseLayer + FACE_ORDER.indexOf(face)`. Null for non-"cube" types. */
  atlasBaseLayer: number | null;
  /**
   * Which of the old game's two real xray-if-behind shaders this type's
   * block material should use (both read in full from
   * 3dAssets/shaders/xray_if_behind_{cutout,transparent}.gdshader --
   * identical cone-fade math, only the alpha handling at the end differs):
   * - "cutout": hard `discard` once faded alpha drops below ~1 (render_mode
   *   depth_prepass_alpha in the old shader). This is the UNIVERSAL
   *   default -- confirmed by grepping every real shader_*.tres in the old
   *   repo: dirt/grass/log/leaves/glass/wall/shrub all use the cutout
   *   variant, not just the handful of types that are visually see-through.
   * - "transparent": real soft alpha blend, only discarding fully-invisible
   *   pixels, with backface culling off (render_mode blend_mix,
   *   depth_draw_always, cull_disabled). Used by exactly 3 types in the old
   *   repo: water, watertop, quartz. These also come OFF the shared core
   *   atlas (see CUBE_TYPE_NAMES below) and get their own small standalone
   *   texture instead -- game.ts's registration loop branches on this
   *   field, not on a hardcoded type-name list, so a future mod type can
   *   opt into either mode the same way.
   */
  transparencyMode: "cutout" | "transparent";
  /** [r,g,b] 0..1, used as a fallback before a texture loads, or always for "none" types. */
  color: [number, number, number];
  solid: boolean;
  fluid: boolean;
  /**
   * Whether a player can select this type in the hotbar/inventory and
   * place it (packages/shared/src/items.ts's `buildBlockCatalog`). True
   * for every real voxel type from the old game -- `noa.setBlock` already
   * handles every mesh kind (cube, cross) uniformly, so there's no extra
   * placement-side work needed to support any of them, and the inventory
   * grid (not a fixed slot count) is what bounds the catalog's size, not
   * this flag. False only for MARKER, the ttrpg3d-specific internal QA
   * block that was never part of the old game.
   */
  placeable: boolean;
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
  { id: DIRT, name: "dirt", mesh: "cube", textureFile: "dirt.png", transparencyMode: "cutout", color: [0.45, 0.36, 0.22], atlasUrl: null, atlasBaseLayer: null, placeable: true, solid: true, fluid: false },
  { id: GRASS, name: "grass", mesh: "cube", textureFile: "grass.png", transparencyMode: "cutout", color: [0.3, 0.55, 0.25], atlasUrl: null, atlasBaseLayer: null, placeable: true, solid: true, fluid: false },
  // water/watertop: "transparent" (soft blend, cull disabled) in the old
  // game too -- see VoxelTypeDef.transparencyMode's doc. Off the shared
  // core atlas (see CUBE_TYPE_NAMES below); textureFile here is a plain
  // standalone file loaded directly from public/textures/blocks/, not a
  // source atlas to crop (scripts/build-block-standalone-textures.mjs).
  { id: WATER_FULL, name: "water", mesh: "cube", textureFile: "water.png", transparencyMode: "transparent", color: [0.2, 0.4, 0.8], atlasUrl: null, atlasBaseLayer: null, placeable: true, solid: false, fluid: true },
  { id: WATER_TOP, name: "watertop", mesh: "cube", textureFile: "watertop.png", transparencyMode: "transparent", color: [0.25, 0.45, 0.85], atlasUrl: null, atlasBaseLayer: null, placeable: true, solid: false, fluid: true },
  { id: LOG, name: "log", mesh: "cube", textureFile: "log.png", transparencyMode: "cutout", color: [0.4, 0.28, 0.15], atlasUrl: null, atlasBaseLayer: null, placeable: true, solid: true, fluid: false },
  { id: LEAVES, name: "leaves", mesh: "cube", textureFile: "leaves.png", transparencyMode: "cutout", color: [0.2, 0.45, 0.15], atlasUrl: null, atlasBaseLayer: null, placeable: true, solid: true, fluid: false },
  { id: TALL_GRASS, name: "tallgrass", mesh: "cross", textureFile: "tallgrass.png", transparencyMode: "cutout", color: [0.35, 0.6, 0.25], atlasUrl: null, atlasBaseLayer: null, placeable: true, solid: false, fluid: false },
  { id: DEAD_SHRUB, name: "deadshrub", mesh: "cross", textureFile: "deadshrub.png", transparencyMode: "cutout", color: [0.5, 0.4, 0.25], atlasUrl: null, atlasBaseLayer: null, placeable: true, solid: false, fluid: false },
  { id: MUDSTONE, name: "mudstone", mesh: "cube", textureFile: "mudstone.png", transparencyMode: "cutout", color: [0.4, 0.38, 0.35], atlasUrl: null, atlasBaseLayer: null, placeable: true, solid: true, fluid: false },
  { id: PLASTIGLOMERATE, name: "plastiglomerate", mesh: "cube", textureFile: "plastiglomerate.png", transparencyMode: "cutout", color: [0.3, 0.3, 0.35], atlasUrl: null, atlasBaseLayer: null, placeable: true, solid: true, fluid: false },
  { id: COAL_ORE, name: "coal_ore", mesh: "cube", textureFile: "coal.png", transparencyMode: "cutout", color: [0.15, 0.15, 0.15], atlasUrl: null, atlasBaseLayer: null, placeable: true, solid: true, fluid: false },
  { id: GYPSUM_ORE, name: "gypsum_ore", mesh: "cube", textureFile: "gypsum.png", transparencyMode: "cutout", color: [0.85, 0.85, 0.8], atlasUrl: null, atlasBaseLayer: null, placeable: true, solid: true, fluid: false },
  { id: HALITE_ORE, name: "halite_ore", mesh: "cube", textureFile: "halite.png", transparencyMode: "cutout", color: [0.9, 0.75, 0.75], atlasUrl: null, atlasBaseLayer: null, placeable: true, solid: true, fluid: false },
  { id: COPPER_ORE, name: "copper_ore", mesh: "cube", textureFile: "copper.png", transparencyMode: "cutout", color: [0.55, 0.4, 0.25], atlasUrl: null, atlasBaseLayer: null, placeable: true, solid: true, fluid: false },
  // quartz: real transparent variant too, same as water/watertop.
  // textureFile corrected to the old repo's real transparent source
  // (3dAssets/blocks/transparent/16xquartz.png) -- `quartz.png` here was
  // flagged earlier this session as an approximation that didn't match.
  { id: QUARTZ, name: "quartz", mesh: "cube", textureFile: "quartz.png", transparencyMode: "transparent", color: [0.8, 0.8, 0.85], atlasUrl: null, atlasBaseLayer: null, placeable: true, solid: true, fluid: false },
  { id: MAGNETITE, name: "magnetite", mesh: "cube", textureFile: "magnetite.png", transparencyMode: "cutout", color: [0.2, 0.2, 0.25], atlasUrl: null, atlasBaseLayer: null, placeable: true, solid: true, fluid: false },
  { id: MARKER, name: "marker", mesh: "cube", textureFile: "marker.png", transparencyMode: "cutout", color: [1.0, 0.1, 0.8], atlasUrl: null, atlasBaseLayer: null, placeable: false, solid: true, fluid: false },
];

/**
 * Fixed per-face ordering used to build the shared block texture atlas
 * (scripts/build-block-atlas.mjs) and to look up each face's layer index
 * within a type's atlas (`atlasBaseLayer + FACE_ORDER.indexOf(face)`).
 * Values match noa-engine's own real 6-element `registerBlock`
 * material-array order ([+x,-x,+y,-y,+z,-z], confirmed by tracing noa's
 * terrainMesher.js directly -- its own registerBlock doc comment states a
 * different, wrong order), reused here only because it's already a fixed,
 * agreed-upon order -- an atlas's own internal layer order doesn't need to
 * match noa's array position, it just needs the atlas's builder and
 * consumer to agree, which importing this one constant in both places
 * guarantees.
 */
export const FACE_ORDER = ["px", "nx", "py", "ny", "pz", "nz"] as const;

/**
 * All "cube"-mesh voxel types that live in the shared core atlas, in the
 * fixed array order it was built in. Excludes "transparent"-mode types
 * (water/watertop/quartz) -- they're still `mesh: "cube"` (real
 * terrain-meshed cubes, not cross meshes), but get their own small
 * standalone texture instead of a core-atlas slot (see
 * VoxelTypeDef.transparencyMode's doc for why).
 */
export const CUBE_TYPE_NAMES: readonly string[] = VOXEL_TYPES.filter((t) => t.mesh === "cube" && t.transparencyMode === "cutout").map((t) => t.name);

/**
 * The one shared atlas every CURRENT (built-in) "cube" type's faces live
 * in -- a single texture is the most performant arrangement for a fixed,
 * known block set (see VoxelTypeDef.atlasUrl's doc for why this is a
 * per-type field rather than a single hardcoded constant used everywhere:
 * a future mod can add blocks against its own separate atlas without
 * this file or game.ts's registration loop needing to change at all).
 */
export const CORE_ATLAS_URL = "blocks-atlas.png";

// Assign every built-in "cube" type its real atlas location -- mutating
// the objects in place (VOXEL_TYPES itself is a readonly ARRAY, not an
// array of readonly elements, so this is allowed) right after
// construction, rather than threading atlas-index arithmetic through the
// array literal above, keeps that literal readable. This is the ONE place
// "which layer does type X's face Y live at" gets computed -- scripts/
// build-block-atlas.mjs independently derives the identical numbers from
// the same CUBE_TYPE_NAMES/FACE_ORDER inputs, so the two can't drift.
for (const type of VOXEL_TYPES) {
  if (type.mesh !== "cube" || type.transparencyMode !== "cutout") continue;
  type.atlasUrl = CORE_ATLAS_URL;
  type.atlasBaseLayer = CUBE_TYPE_NAMES.indexOf(type.name) * FACE_ORDER.length;
}
