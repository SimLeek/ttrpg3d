// Generates one real top-face icon PNG per placeable voxel type, for the
// hotbar/inventory UI (hotbar.ts) -- replaces flat `color` swatches with
// an actual recognizable block face. Crops the same "py" (top-face) grid
// cell scripts/build-block-atlas.mjs uses for the terrain atlas (Col0,
// Row1 of the old game's 3x2-grid source atlas, decoded from dirt.obj's
// real UVs -- see that script/docs/PORTING_CHECKLIST.md for the
// derivation), just output as standalone 16x16 files instead of packed
// into a texture array, since <img> tags need a plain 2D image, not a
// texture-array layer a WebGL shader samples.
//
// Cube-type sources live in packages/client/textures-source/blocks/ (not
// shipped to public/ -- see that directory's own reasoning); cross-type
// (plant) sources stay in packages/client/public/textures/blocks/ since
// those ARE loaded directly at runtime by plantMesh.ts. Both are 3x2-grid
// atlases in the same layout, so the same crop region works for either.
//
// Run once (`node scripts/build-block-icons.mjs`) and commit the output --
// not a build step, since the source atlases never change.

import { Jimp } from "jimp";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { VOXEL_TYPES } from "../packages/shared/src/index.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CUBE_SOURCE_DIR = join(__dirname, "..", "packages", "client", "textures-source", "blocks");
const CROSS_SOURCE_DIR = join(__dirname, "..", "packages", "client", "public", "textures", "blocks");
const OUTPUT_DIR = join(__dirname, "..", "packages", "client", "public", "textures", "icons");

const TOP_FACE_REGION = { x: 0, y: 0, w: 16, h: 16 }; // Col0,Row1 -- same "py" cell build-block-atlas.mjs uses

for (const type of VOXEL_TYPES) {
  if (!type.placeable || !type.textureFile) continue;
  const sourceDir = type.mesh === "cross" ? CROSS_SOURCE_DIR : CUBE_SOURCE_DIR;
  const srcPath = join(sourceDir, type.textureFile);
  const image = await Jimp.read(srcPath);
  const icon = image.clone().crop(TOP_FACE_REGION);
  const outPath = join(OUTPUT_DIR, `${type.name}.png`);
  await icon.write(outPath);
  console.log(`wrote icon for ${type.name} -> ${outPath}`);
}
