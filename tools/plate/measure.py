#!/usr/bin/env python3
"""Print the numbers that describe a plate. None of them are pass/fail on their own.

Depth relief, over fixed bands so plates are comparable with each other. Known
readings, measured 2026-08-06:

    philosopher (shipped)   eye/brow 0.071   nose 0.047
    nietzsche   (accepted)  eye/brow 0.038   nose 0.069

Aggregate depth numbers mislead. A candidate once scored the highest depth
variance of three while having the flattest face, because a rendering artifact
inflated the figure. Flat eye sockets are in fact mildly helpful: the eye region
then translates rigidly with the face instead of shearing inside the exact zone
where the pupil warp operates. What sells the head-turn is nose and cheek relief,
and clean silhouette separation from the black. LOOK AT THE MAP.

Sharpness is printed and gates nothing. The spec proposed a Laplacian threshold
to catch a downscaled preview; measured across the four masters plus the shipped
plate, no formulation separates the known-downscaled files from the known-good
ones, because an engraving is high-frequency hatching everywhere. Compare two
saves of the SAME render with it and it is informative; compare two different
plates and it is noise.

    python3 tools/plate/measure.py public/plates/nietzsche/albedo.jpg
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

# Fixed bands, as fractions of (height, width). Comparability beats precision.
EYE_BAND = (0.30, 0.42, 0.28, 0.75)
NOSE_BAND = (0.40, 0.56, 0.38, 0.62)
MIN_WIDTH = 824


def band(a: np.ndarray, b: tuple[float, float, float, float]) -> np.ndarray:
    h, w = a.shape
    return a[int(h * b[0]) : int(h * b[1]), int(w * b[2]) : int(w * b[3])]


def main(albedo: str) -> int:
    src = Path(albedo)
    im = Image.open(src).convert("L")
    a = np.asarray(im, dtype=np.float64) / 255.0
    w, h = im.size
    ok = True

    # 4:5 within a pixel. The philosopher's albedo is 733x916, one pixel off
    # exact, and it is deliberately never re-encoded: it is copied byte for byte
    # from the live site so the extraction regression stays meaningful. Anything
    # derive.py produces is exact.
    off = abs(w * 5 - h * 4) / (h * 4)
    print(f"  aspect 4:5:         {w}:{h}  off by {off * 100:.3f}%")
    if off > 0.005:
        ok = False
    print(f"  width floor {MIN_WIDTH}:   {'pass' if w >= MIN_WIDTH else 'REJECT'}")
    if w < MIN_WIDTH:
        ok = False

    # Background: the prompt demands pure black, completely empty. The shader
    # multiplies the print down to 16 percent away from the light, and anything
    # that is not black behind the figure becomes a grey haze in the dark.
    edge = np.concatenate([a[:, :8].ravel(), a[:, -8:].ravel(), a[:8, :].ravel()])
    print(f"  border mean:        {edge.mean():.4f}   (want under 0.02)")
    print(f"  border max:         {edge.max():.4f}   (want under 0.10)")
    if edge.mean() > 0.02:
        ok = False

    # Tonal range. A pale flat face becomes a pale flat slab inside the shader.
    lo, hi = np.percentile(a, [1, 99])
    print(f"  tonal range p1-p99: {lo:.3f} to {hi:.3f}   (want hi above 0.85)")
    if hi < 0.85:
        ok = False

    k = np.array([[0, 1, 0], [1, -4, 1], [0, 1, 0]], dtype=np.float64)
    print(f"  laplacian std:      {ndi.convolve(a, k, mode='reflect').std():.4f}   "
          f"(informational only, see the docstring)")

    depth = src.with_name("depth.png")
    if depth.exists():
        d = np.asarray(Image.open(depth).convert("L"), dtype=np.float64) / 255.0
        print(f"  depth {depth.name}: {d.shape[1]}x{d.shape[0]}  "
              f"matches albedo: {(d.shape[1], d.shape[0]) == (w, h)}")
        if (d.shape[1], d.shape[0]) != (w, h):
            ok = False
        print(f"  eye/brow band std:  {band(d, EYE_BAND).std():.3f}   "
              f"(philosopher 0.071, nietzsche 0.038)")
        print(f"  nose band std:      {band(d, NOSE_BAND).std():.3f}   "
              f"(philosopher 0.047, nietzsche 0.069)")
    else:
        print(f"  no {depth.name} yet")

    print("  => automatic checks pass" if ok else "  => automatic checks FAIL")
    print("  The gates that matter are still the eyes. Run tools/plate/eyes.py and look.")
    return 0 if ok else 1


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    raise SystemExit(main(sys.argv[1]))
