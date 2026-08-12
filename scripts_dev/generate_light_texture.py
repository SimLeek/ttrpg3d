#!/usr/bin/env python3
"""
generate_light_texture.py -- build the demo light voxel's texture.

Phase 7's demo light block is deliberately plain: "just make a simple
white light cube not a torch -- no fancy mesh needed, a plain emissive
white voxel is enough to prove it out." So this is just a flat, fully
opaque white sheet, matching the existing 3-wide x 2-tall/16x16-cell
block-texture convention (see 16xdirt.png) so it drops into the same
full-cube mesh/shader every other solid block uses -- the glow itself
comes from the material's emission parameters (see shader_light.tres),
not the texture.

Usage:
    python3 generate_light_texture.py [output.png]

Defaults to writing 3dAssets/blocks/light/16xlight.png.
"""
import sys
from PIL import Image

CELL = 16
COLS, ROWS = 3, 2
WHITE = (255, 255, 255, 255)

DEFAULT_OUT = "3dAssets/blocks/light/16xlight.png"


def main() -> None:
    out_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUT
    sheet = Image.new("RGBA", (CELL * COLS, CELL * ROWS), WHITE)
    sheet.save(out_path)
    print(f"Wrote {sheet.size[0]}x{sheet.size[1]} sheet -> {out_path}")


if __name__ == "__main__":
    main()
