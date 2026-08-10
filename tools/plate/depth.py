#!/usr/bin/env python3
"""Albedo to depth map: Depth Anything V2 Small, normalise, feather.

Verified on this box 2026-08-06 with torch 2.11.0 and transformers 4.38.2, model
already in the Hugging Face cache so it runs offline. Load 7.2s, inference 3.4s
for a 928x1152 plate on CPU.

The model returns an 8-bit L image at the input resolution with WHITE NEAREST
already, so there is no inversion here and there should not be one: checked on
two plates, the nose band reads 0.81 and 0.84 against background corners of 0.20
and 0.31.

Then feather it. The shipped philosopher needed gaussian sigma 6 to kill the
silhouette echo at strong head-turn, and that number is recoverable: regenerating
his map and matching it against the shipped depth.png bottoms out at exactly
sigma 6 (RMSE 0.0158, against 0.0211 unfeathered). --selftest re-runs that check.

Judge the sigma per plate anyway. It is a silhouette repair, and the interior
relief statistics cannot see it: on Nietzsche the nose band moves from 0.0691 to
0.0673 between sigma 0 and sigma 6, which is nothing. Look at the map, and look
at the plate under a strong head-turn in the room.

    python3 tools/plate/depth.py public/plates/nietzsche/albedo.jpg --sigma 6
    python3 tools/plate/depth.py --selftest
"""

import argparse
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

MODEL = "depth-anything/Depth-Anything-V2-Small-hf"
# The philosopher in example/, resolved from this file rather than from the
# working directory, so --selftest runs from anywhere and for anybody. These are
# the same bytes the selftest was written against.
REPO = Path(__file__).resolve().parents[2]
SHIPPED_ALBEDO = REPO / "example/albedo.jpg"
SHIPPED_DEPTH = REPO / "example/depth.png"


def estimate(path: Path) -> np.ndarray:
    from transformers import pipeline

    pipe = pipeline("depth-estimation", model=MODEL, device=-1)
    raw = np.asarray(pipe(Image.open(path).convert("RGB"))["depth"], dtype=np.float32)
    lo, hi = float(raw.min()), float(raw.max())
    return (raw - lo) / max(hi - lo, 1e-6)


def feather(d: np.ndarray, sigma: float) -> np.ndarray:
    if sigma <= 0:
        return d
    b = ndi.gaussian_filter(d, sigma)
    lo, hi = float(b.min()), float(b.max())
    return (b - lo) / max(hi - lo, 1e-6)


def polarity(d: np.ndarray) -> tuple[float, float]:
    h, w = d.shape
    return float(d[: int(h * 0.06), : int(w * 0.06)].mean()), float(
        d[int(h * 0.42) : int(h * 0.55), int(w * 0.42) : int(w * 0.58)].mean()
    )


def selftest() -> int:
    """Regenerate the shipped philosopher's map and find the sigma that matches."""
    fresh = estimate(SHIPPED_ALBEDO)
    ship = np.asarray(Image.open(SHIPPED_DEPTH).convert("L"), dtype=np.float32) / 255.0
    if fresh.shape != ship.shape:
        print(f"FAIL: shapes differ, {fresh.shape} against {ship.shape}")
        return 1
    best = (9e9, -1.0)
    for s in [0, 2, 4, 5, 6, 7, 8, 10]:
        rmse = float(np.sqrt(((feather(fresh, s) - ship) ** 2).mean()))
        print(f"  sigma {s:>2}  rmse {rmse:.4f}")
        if rmse < best[0]:
            best = (rmse, s)
    print(f"best sigma {best[1]:.0f} at rmse {best[0]:.4f}")
    ok = best[1] == 6 and best[0] < 0.02
    print("PASS: the pipeline reproduces the shipped map" if ok else "FAIL: pipeline has drifted")
    return 0 if ok else 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("albedo", nargs="?", help="published albedo.jpg to derive from")
    ap.add_argument("--sigma", type=float, default=6.0)
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()

    if a.selftest:
        return selftest()
    if not a.albedo:
        ap.error("give an albedo, or --selftest")

    src = Path(a.albedo)
    d = feather(estimate(src), a.sigma)
    corner, nose = polarity(d)
    dst = src.with_name("depth.png")
    Image.fromarray((d * 255.0 + 0.5).astype(np.uint8), "L").save(dst, optimize=True)

    src_size = Image.open(src).size
    print(f"{src} {src_size[0]}x{src_size[1]}")
    print(f"  wrote {dst}  {d.shape[1]}x{d.shape[0]}  sigma {a.sigma}")
    print(f"  dimensions match albedo: {(d.shape[1], d.shape[0]) == src_size}")
    print(f"  background corner {corner:.3f}, nose {nose:.3f} -> "
          f"{'white is nearest, correct' if nose > corner else 'INVERTED, do not ship'}")
    return 0 if nose > corner and (d.shape[1], d.shape[0]) == src_size else 1


if __name__ == "__main__":
    raise SystemExit(main())
