#!/usr/bin/env python3
"""
generate_glass_texture.py -- build the glass voxel's sprite sheet.

Matches the existing block-texture convention (see 16xdirt.png,
16xquartz.png): a 3-wide x 2-tall sheet of 16x16 cells, one cell per cube
face slot Blender's dirt.obj UVs expect (all six faces share this same
mesh/UV layout across every block in the game -- see dirt.obj/dirt.mtl).

Phase 10's simplified glass spec: white opaque border, fully transparent
(alpha 0) interior, per cell -- no per-face variation needed. Rendered
through the existing cutout shader (xray_if_behind_cutout.gdshader, same
one dirt/grass/ores use), which does a hard alpha>=0.999-or-discard test
with no blending -- so "mostly transparent" edges aren't a partial-alpha
value (that would just discard under this shader), they're an opaque
border that's thin relative to the fully-discarded interior, making the
whole face read as "mostly see-through" even though every drawn pixel is
fully opaque.

Usage:
    python3 generate_glass_texture.py [output.png]

Defaults to writing 3dAssets/blocks/transparent/16xglass.png.
"""
import sys
from PIL import Image

CELL = 16
COLS, ROWS = 3, 2
BORDER = 2
WHITE = (255, 255, 255, 255)
CLEAR = (0, 0, 0, 0)

DEFAULT_OUT = "3dAssets/blocks/transparent/16xglass.png"


def make_cell() -> Image.Image:
    cell = Image.new("RGBA", (CELL, CELL), CLEAR)
    px = cell.load()
    for y in range(CELL):
        for x in range(CELL):
            on_border = x < BORDER or x >= CELL - BORDER or y < BORDER or y >= CELL - BORDER
            px[x, y] = WHITE if on_border else CLEAR
    return cell


def main() -> None:
    out_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUT
    sheet = Image.new("RGBA", (CELL * COLS, CELL * ROWS), CLEAR)
    cell = make_cell()
    for row in range(ROWS):
        for col in range(COLS):
            sheet.paste(cell, (col * CELL, row * CELL))
    sheet.save(out_path)
    print(f"Wrote {sheet.size[0]}x{sheet.size[1]} sheet -> {out_path}")


if __name__ == "__main__":
    main()
