#!/usr/bin/env python3
"""Draw a proposed eye ellipse over a plate, so calibration is a loop and not a guess.

Takes exactly the coordinates the manifest stores: image space, top-left origin,
y down, fractions of width and height. Draws each ellipse's outline, its centre
cross and its two axis end-points, then you look and adjust and run it again.

Three things to check, and all three are about the two boundaries:

  - The INNER ring traces the drawn iris. Everything inside it translates
    rigidly, so an iris that pokes outside the inner ring is an iris that will
    shear as it slides. This is the failure the scalar gain was built to make
    impossible, and undersizing this ring is how to reintroduce it.
  - The OUTER ring stops INSIDE the lid line, top and bottom. This is the
    number that drags lash ink into the eye when it is too generous, and it is
    the most common calibration error there is. When in doubt, shrink the rim.
  - The two outer rings do not touch. The shader sums both eyes and that is
    exact only while they are disjoint.

    python3 tools/plate/ellipse.py public/plates/nietzsche/albedo.jpg /tmp/fit.png \\
        --l 0.375 0.438 0.017 0.0135 --l-rim 0.042 0.0175 \\
        --r 0.662 0.437 0.017 0.0135 --r-rim 0.042 0.0175 --zoom 6
"""

import argparse
from PIL import Image, ImageDraw


def draw(
    d: ImageDraw.ImageDraw,
    e: list[float],
    rim: list[float],
    w: int,
    h: int,
    colour: tuple[int, int, int],
) -> None:
    """Iris solid and heavy, rim thin and dimmed. Two boundaries, two jobs:
    the iris is what must move as one piece, the rim is what must stop short
    of the lid."""
    cx, cy = e[0] * w, e[1] * h
    irx, iry = e[2] * w, e[3] * h
    rrx, rry = rim[0] * w, rim[1] * h
    dim = tuple(c // 2 for c in colour)
    d.ellipse([cx - rrx, cy - rry, cx + rrx, cy + rry], outline=dim, width=1)
    d.ellipse([cx - irx, cy - iry, cx + irx, cy + iry], outline=colour, width=2)
    d.line([(cx - irx, cy), (cx + irx, cy)], fill=colour, width=1)
    d.line([(cx, cy - iry), (cx, cy + iry)], fill=colour, width=1)
    for px, py in ((cx - irx, cy), (cx + irx, cy), (cx, cy - iry), (cx, cy + iry)):
        d.ellipse([px - 3, py - 3, px + 3, py + 3], fill=colour)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--l", nargs=4, type=float, required=True, metavar=("CX", "CY", "RX", "RY"))
    ap.add_argument("--l-rim", nargs=2, type=float, required=True, metavar=("RX", "RY"))
    ap.add_argument("--r", nargs=4, type=float, required=True, metavar=("CX", "CY", "RX", "RY"))
    ap.add_argument("--r-rim", nargs=2, type=float, required=True, metavar=("RX", "RY"))
    ap.add_argument("--zoom", type=int, default=5)
    a = ap.parse_args()

    im = Image.open(a.src).convert("RGB")
    w, h = im.size
    d = ImageDraw.Draw(im)
    draw(d, a.l, a.l_rim, w, h, (60, 220, 90))
    draw(d, a.r, a.r_rim, w, h, (255, 90, 90))

    # Crop to the two rims with a generous margin, then point-upscale, so the
    # boundary is judged against pixels rather than against a resampling.
    left = min(a.l[0] - a.l_rim[0], a.r[0] - a.r_rim[0]) - 0.04
    right = max(a.l[0] + a.l_rim[0], a.r[0] + a.r_rim[0]) + 0.04
    top = min(a.l[1] - a.l_rim[1], a.r[1] - a.r_rim[1]) - 0.03
    bot = max(a.l[1] + a.l_rim[1], a.r[1] + a.r_rim[1]) + 0.03
    box = im.crop((int(left * w), int(top * h), int(right * w), int(bot * h)))
    box.resize((box.width * a.zoom, box.height * a.zoom), Image.NEAREST).save(a.dst)

    gap = abs(a.l[0] - a.r[0]) - (a.l_rim[0] + a.r_rim[0])
    print(f"{a.src} -> {a.dst}")
    print(f"  green = viewer-left, red = viewer-right")
    print(f"  gap between rims: {gap:.4f} UV  "
          f"{'(disjoint, the shader sums them exactly)' if gap > 0 else '(OVERLAPPING, the sum is wrong)'}")


if __name__ == "__main__":
    main()
