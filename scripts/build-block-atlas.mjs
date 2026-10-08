// Builds the CORE atlas (voxelTypes.ts's CORE_ATLAS_URL) -- one shared
// texture-array atlas holding every BUILT-IN cube-mesh block type's 6
// faces, using noa-engine's own real atlas support (confirmed directly in
// its source, terrainMaterials.js's TerrainMaterialPlugin: a Babylon
// RawTexture2DArray, where `numLayers = height / width` -- i.e. the image
// must be a single-column vertical strip of square tiles, one per layer).
// noa's own official example even recommends this ("it's recommended to
// have all your terrain textures in a single atlas, if possible").
//
// "The core atlas," not "the atlas" -- noa's material registration is
// per-material (registerMaterial(name, {textureURL, atlasIndex})), so
// nothing stops a different set of block types (a future mod, Phase 6,
// not built yet) from using a SEPARATE atlas file of their own, built by
// their own equivalent of this script, with their own VoxelTypeDef
// entries pointing at it via atlasUrl/atlasBaseLayer. This script only
// ever builds the one atlas the CURRENT built-in block set uses.
//
// Replaces an earlier approach of shipping one separate real PNG file per
// (block type, face) pair (90+ files) -- correct, but defeats the point of
// an atlas (one shared GPU texture, far fewer binds/loads). Each 16x16
// face still gets cropped out of its block type's real source atlas
// (packages/client/textures-source/blocks/, the old game's 3x2-grid
// layout -- see voxelTypes.ts's `mesh` doc), just packed into one output
// image instead of 6 separate files.
//
// Run once (`node scripts/build-block-atlas.mjs`) and commit the output --
// not a build step, since the source atlases never change.

import { Jimp } from "jimp";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// Relative import, not the "@ttrpg3d/shared" package name -- this script
// lives outside any workspace package's own node_modules resolution tree
// (it's at the repo root, not inside packages/client or packages/server),
// so the bare specifier doesn't resolve here the way it does from inside
// a real package.
import { CORE_ATLAS_URL, CUBE_TYPE_NAMES, FACE_ORDER, VOXEL_TYPES } from "../packages/shared/src/index.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_DIR = join(__dirname, "..", "packages", "client", "textures-source", "blocks");
const OUTPUT_PATH = join(__dirname, "..", "packages", "client", "public", "textures", "blocks", CORE_ATLAS_URL);

const TILE_SIZE = 16;

// Pixel regions within each 48x32 source atlas, decoded from dirt.obj's
// real UV coordinates (see docs/PORTING_CHECKLIST.md / session notes for
// the u/v -> grid-cell derivation). Row1 (v: 0.5-1.0) is the TOP half of
// the image file; Row0 (v: 0-0.5) is the BOTTOM half.
const FACE_REGIONS = {
  nx: { x: 16, y: 16, w: TILE_SIZE, h: TILE_SIZE }, // -X: Col1,Row0 (bottom-middle)
  px: { x: 32, y: 0, w: TILE_SIZE, h: TILE_SIZE }, // +X: Col2,Row1 (top-right)
  ny: { x: 0, y: 16, w: TILE_SIZE, h: TILE_SIZE }, // -Y (bottom): Col0,Row0 (bottom-left)
  py: { x: 0, y: 0, w: TILE_SIZE, h: TILE_SIZE }, // +Y (top): Col0,Row1 (top-left)
  nz: { x: 32, y: 16, w: TILE_SIZE, h: TILE_SIZE }, // -Z: Col2,Row0 (bottom-right)
  pz: { x: 16, y: 0, w: TILE_SIZE, h: TILE_SIZE }, // +Z: Col1,Row1 (top-middle)
};

// marker.png isn't a real ported asset (the old game never had this
// block), so generate its source atlas here rather than requiring it to
// exist on disk already -- keeps the whole pipeline reproducible from
// nothing but this script.
const markerPath = join(SOURCE_DIR, "marker.png");
const markerImage = new Jimp({ width: 48, height: 32, color: 0xff1acc_ff });
await markerImage.write(markerPath);
console.log("generated marker.png source atlas");

const textureFileByName = new Map(VOXEL_TYPES.map((t) => [t.name, t.textureFile]));

const numLayers = CUBE_TYPE_NAMES.length * FACE_ORDER.length;
const atlas = new Jimp({ width: TILE_SIZE, height: TILE_SIZE * numLayers, color: 0x000000_00 });

let layer = 0;
for (const typeName of CUBE_TYPE_NAMES) {
  const textureFile = textureFileByName.get(typeName);
  const srcPath = join(SOURCE_DIR, textureFile);
  const image = await Jimp.read(srcPath);
  for (const face of FACE_ORDER) {
    const cropped = image.clone().crop(FACE_REGIONS[face]);
    atlas.composite(cropped, 0, layer * TILE_SIZE);
    layer++;
  }
  console.log(`packed ${typeName} (${textureFile}) -> layers ${layer - 6}..${layer - 1}`);
}

await atlas.write(OUTPUT_PATH);
console.log(`wrote ${numLayers}-layer atlas to ${OUTPUT_PATH}`);
