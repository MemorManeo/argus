#!/usr/bin/env python3
"""Crop the eye band and upscale it with a POINT filter, for the acceptance gates.

At native size a hatched engraving hides everything that matters. Every rejection
in docs/prompts/plate-prompt.md was invisible until the eyes were looked at this
way: the clipped iris, the hatched inner sclera, the spectacle rim.

Two gates, and both are judged by eye on this image, not by any number:
  1. Each iris is a complete unbroken circle, not clipped by the upper eyelid.
  2. Clean unhatched white shows on BOTH sides of BOTH irises, nose side as well
     as outer side. That white is the travel room; maxX of 0.01 UV needs
     somewhere to go.

    python3 tools/plate/eyes.py public/plates/nietzsche/albedo.jpg /tmp/eyes.png
    python3 tools/plate/eyes.py public/plates/nietzsche/albedo.jpg /tmp/eyes.png --band 0.30 0.44
"""

import argparse
from PIL import Image

SCALE = 4


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--band", nargs=2, type=float, default=[0.28, 0.46],
                    help="top and bottom of the eye band, fractions of height")
    ap.add_argument("--scale", type=int, default=SCALE)
    a = ap.parse_args()

    im = Image.open(a.src).convert("RGB")
    w, h = im.size
    top, bot = int(a.band[0] * h), int(a.band[1] * h)
    crop = im.crop((int(0.18 * w), top, int(0.86 * w), bot))
    big = crop.resize((crop.width * a.scale, crop.height * a.scale), Image.NEAREST)
    big.save(a.dst)
    print(f"{a.src}: rows {top}-{bot} at {a.scale}x point -> {a.dst} ({big.width}x{big.height})")


if __name__ == "__main__":
    main()
