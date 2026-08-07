#!/usr/bin/env python3
"""
shrink_screenshot.py -- downscale (and optionally crop) a screenshot before
Claude "looks" at it, to cut vision-token cost.

Claude's image tokenization is roughly one token per 28x28 pixel patch, so
a full ~956x1041 game-window screenshot costs about
ceil(956/28) * ceil(1041/28) = 35 * 38 = 1330 tokens. Downscaling to a
modest width (default 400px) brings that down to well under 200 tokens
while staying legible for verifying game state / UI layout.

Note: opencv is installed but currently broken on this system (missing
libprotobuf.so.34.1.0 -- a version mismatch, not a missing package), so
this uses PIL instead, which does everything needed here (resize, crop)
without that dependency.

Usage:
    python3 shrink_screenshot.py <input.png> [output.png] [--width N] [--crop x,y,w,h]

If output.png is omitted, writes to <input>_small.png next to the input.
--crop takes x,y,w,h in ORIGINAL image pixels, applied before resizing --
use this to zoom into one region (a tooltip, a menu) instead of shrinking
the whole frame, when that's what you actually need to read.
Always prints the estimated token cost of the input and the output so you
can decide whether to shrink/crop further before spending a Read call.
"""
import sys
import argparse
import math
from PIL import Image


def estimate_tokens(width: int, height: int, patch: int = 28) -> int:
    return math.ceil(width / patch) * math.ceil(height / patch)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("output", nargs="?", default=None)
    parser.add_argument("--width", type=int, default=400, help="Target output width in pixels")
    parser.add_argument("--crop", type=str, default=None, help="x,y,w,h in ORIGINAL image pixels, applied before resize")
    args = parser.parse_args()

    img = Image.open(args.input).convert("RGB")
    orig_w, orig_h = img.size
    orig_tokens = estimate_tokens(orig_w, orig_h)

    if args.crop:
        x, y, w, h = (int(v) for v in args.crop.split(","))
        img = img.crop((x, y, x + w, y + h))

    w, h = img.size
    if w > args.width:
        scale = args.width / w
        new_w = args.width
        new_h = max(1, round(h * scale))
        img = img.resize((new_w, new_h), Image.LANCZOS)

    out_path = args.output or (args.input.rsplit(".", 1)[0] + "_small.png")
    img.save(out_path)

    final_w, final_h = img.size
    final_tokens = estimate_tokens(final_w, final_h)
    print(f"Input:  {orig_w}x{orig_h} (~{orig_tokens} tokens)")
    print(f"Output: {final_w}x{final_h} (~{final_tokens} tokens) -> {out_path}")


if __name__ == "__main__":
    main()
