// Builds the standalone (non-atlas) textures for "transparent"-mode cube
// types (water/watertop/quartz -- see voxelTypes.ts's transparencyMode
// doc). These don't get packed into the shared core atlas, and unlike
// dirt/grass etc. they don't need a different crop per face: the old
// repo's own source atlases for these three are visually uniform/
// repeating across their whole 48x32 canvas (checked directly), so one
// representative 16x16 crop (the "py"/top-face region, same crop region
// build-block-atlas.mjs uses) is used on all 6 faces.
//
// Run once (`node scripts/build-block-standalone-textures.mjs`) and
// commit the output -- not a build step, same as build-block-atlas.mjs.

import { Jimp } from "jimp";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_DIR = join(__dirname, "..", "packages", "client", "textures-source", "blocks");
const OUTPUT_DIR = join(__dirname, "..", "packages", "client", "public", "textures", "blocks");

const TILE_SIZE = 16;
// Matches build-block-atlas.mjs's own "py" (+Y / top face) region.
const CROP_REGION = { x: 0, y: 0, w: TILE_SIZE, h: TILE_SIZE };

const STANDALONE_TYPES = ["water", "watertop", "quartz"];

for (const name of STANDALONE_TYPES) {
  const srcPath = join(SOURCE_DIR, `${name}.png`);
  const image = await Jimp.read(srcPath);
  const cropped = image.clone().crop(CROP_REGION);
  const outPath = join(OUTPUT_DIR, `${name}.png`);
  await cropped.write(outPath);
  console.log(`wrote standalone texture ${outPath}`);
}
