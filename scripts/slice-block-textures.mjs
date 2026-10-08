// One-time asset-prep step: slices each cube-type block's 48x32 texture
// atlas (3 columns x 2 rows of 16x16 cells -- the same layout the old
// Godot game's dirt.obj/.mtl pair used, decoded directly from that file's
// real UV coordinates, not guessed) into 6 separate 16x16 per-face PNGs.
// Output feeds noa-engine's registerBlock 6-element material array
// ([-x,+x,-y,+y,-z,+z]), replacing the earlier bug where the whole
// uncropped atlas was stretched onto every face.
//
// Run once (`node scripts/slice-block-textures.mjs`) and commit the
// output -- not a build step, since the source atlases never change.
//
// Source atlases live in packages/client/textures-source/blocks/, NOT
// public/ -- only the sliced per-face output (plus tallgrass.png/
// deadshrub.png, which the cross-plane plant mesh loads directly as a
// whole atlas, see plantMesh.ts) is ever actually requested by the
// running client. Keeping the unsliced source atlases out of public/
// means they don't ship as dead weight in the client build.

import { Jimp } from "jimp";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_DIR = join(__dirname, "..", "packages", "client", "textures-source", "blocks");
const OUTPUT_DIR = join(__dirname, "..", "packages", "client", "public", "textures", "blocks");

// Pixel regions within the 48x32 atlas, decoded from dirt.obj's real UV
// coordinates (see docs/PORTING_CHECKLIST.md / session notes for the
// u/v -> grid-cell derivation). Row1 (v: 0.5-1.0) is the TOP half of the
// image file; Row0 (v: 0-0.5) is the BOTTOM half.
const FACE_REGIONS = {
  nx: { x: 16, y: 16, w: 16, h: 16 }, // -X: Col1,Row0 (bottom-middle)
  px: { x: 32, y: 0, w: 16, h: 16 }, // +X: Col2,Row1 (top-right)
  ny: { x: 0, y: 16, w: 16, h: 16 }, // -Y (bottom): Col0,Row0 (bottom-left)
  py: { x: 0, y: 0, w: 16, h: 16 }, // +Y (top): Col0,Row1 (top-left)
  nz: { x: 32, y: 16, w: 16, h: 16 }, // -Z: Col2,Row0 (bottom-right)
  pz: { x: 16, y: 0, w: 16, h: 16 }, // +Z: Col1,Row1 (top-middle)
};

// Every voxel type whose mesh is a regular cube (terrain-meshed, not a
// custom blockMesh) and therefore needs real per-face textures. Plant
// types (tallgrass/deadshrub) are excluded -- they use a custom cross
// mesh sampling the whole unsliced atlas directly with its own real UVs
// (see plantMesh.ts), not this per-face slicing.
const CUBE_TYPES = [
  "dirt",
  "grass",
  "water",
  "watertop",
  "log",
  "leaves",
  "mudstone",
  "plastiglomerate",
  "coal",
  "gypsum",
  "halite",
  "copper",
  "quartz",
  "magnetite",
  // Flat-color QA block, not from the old game -- generated below (not
  // ported) as a solid-magenta 48x32 atlas so it goes through the exact
  // same real-per-face-texture path as every other block (noa's
  // registerBlock takes a 6-element material array either way; a uniform
  // flat image slices into 6 identical faces, which is fine). Previously
  // used noa's flat-color-material path directly, which somehow rendered
  // invisible live (unconfirmed root cause) -- this sidesteps it entirely
  // rather than chasing a second, separate rendering code path.
  "marker",
];

// marker.png isn't a real ported asset (the old game never had this
// block), so generate its source atlas here rather than requiring it to
// exist on disk already -- keeps the whole pipeline reproducible from
// nothing but this script.
const markerPath = join(SOURCE_DIR, "marker.png");
const markerImage = new Jimp({ width: 48, height: 32, color: 0xff1acc_ff });
await markerImage.write(markerPath);
console.log("generated marker.png source atlas");

for (const name of CUBE_TYPES) {
  const srcPath = join(SOURCE_DIR, `${name}.png`);
  const image = await Jimp.read(srcPath);
  for (const [face, region] of Object.entries(FACE_REGIONS)) {
    const cropped = image.clone().crop(region);
    const outPath = join(OUTPUT_DIR, `${name}_${face}.png`);
    await cropped.write(outPath);
  }
  console.log(`sliced ${name}.png -> 6 faces`);
}
