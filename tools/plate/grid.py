#!/usr/bin/env python3
"""Lay a labelled 0.05-step UV grid over a plate, for reading off eye ellipses.

Image coordinates: top-left origin, y down, fractions of width and height. That
is the space src/plates/types.ts stores, and the flip to GL UV happens exactly
once, in src/gaze/rig.ts. Read the numbers off this image as they are; do not
flip anything by hand.

Output is a throwaway. Write it to the scratchpad, never to the repo.

    python3 tools/plate/grid.py public/plates/nietzsche/albedo.jpg /tmp/grid.png
"""

import sys
from PIL import Image, ImageDraw

STEP = 0.05


def main(src: str, dst: str) -> None:
    im = Image.open(src).convert("RGB")
    w, h = im.size
    d = ImageDraw.Draw(im)
    n = int(round(1 / STEP))
    for i in range(n + 1):
        u = i * STEP
        x, y = int(u * (w - 1)), int(u * (h - 1))
        major = i % 2 == 0
        col = (255, 96, 96) if major else (90, 160, 255)
        d.line([(x, 0), (x, h)], fill=col, width=2 if major else 1)
        d.line([(0, y), (w, y)], fill=col, width=2 if major else 1)
        if major:
            d.text((x + 3, 3), f"{u:.2f}", fill=(255, 220, 120))
            d.text((3, y + 3), f"{u:.2f}", fill=(255, 220, 120))
    im.save(dst)
    print(f"{src} {w}x{h} -> {dst}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
