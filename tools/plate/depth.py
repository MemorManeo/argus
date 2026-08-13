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

--calibrate is the other half, and it reads a FINISHED depth.png rather than
making one, because a shipped plate's map generally cannot be regenerated: the
bytes are what they are and the repair has to work from them. It prints the
`depth: { pivot, scale }` pair for the plate record. See calibrate() for what
those two mean and why the shader needs them.

    python3 tools/plate/depth.py --calibrate public/plates/*/depth.png

That path deliberately imports numpy and PIL and nothing else. Estimation pulls
in torch and transformers, and a consumer who only needs to calibrate five PNGs
they already have must not be made to install a gigabyte of them; scipy is
imported inside feather() for the same reason.
"""

import argparse
from pathlib import Path

import numpy as np
from PIL import Image

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
    # Imported here, not at module scope, so --calibrate stays on numpy and PIL.
    from scipy import ndimage as ndi

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


def otsu(d: np.ndarray) -> float:
    """The threshold that best splits these values into two classes.

    Otsu rather than a fixed percentile because the sitter's share of the plate
    is the one thing that genuinely differs between these portraits: a
    head-and-shoulders bust fills more of the frame than a head alone, and a
    percentile that suits one crops the other's jaw off. The maps are strongly
    bimodal (a backdrop near 0.10 against a sitter near 0.77), which is the
    situation Otsu is exactly right for.
    """
    hist, _ = np.histogram(d, bins=256, range=(0.0, 1.0))
    p = hist.astype(np.float64) / max(float(hist.sum()), 1.0)
    centre = (np.arange(256) + 0.5) / 256.0
    w0 = np.cumsum(p)[:-1]
    w1 = 1.0 - w0
    csum = np.cumsum(p * centre)
    m0 = np.divide(csum[:-1], w0, out=np.zeros_like(w0), where=w0 > 0)
    m1 = np.divide(csum[-1] - csum[:-1], w1, out=np.zeros_like(w1), where=w1 > 0)
    between = w0 * w1 * (m0 - m1) ** 2
    return float((int(np.argmax(between)) + 1) / 256.0)


def calibrate(d: np.ndarray, percentile: float | None = None) -> dict:
    """The `pivot` and `scale` this map wants, plus everything needed to judge them.

    pivot is the mean depth over the SITTER, because that is the plane the head
    should rotate about: it puts half the face in front of the pivot and half
    behind, which is what makes a head-turn read as rotation instead of as the
    whole head sliding sideways. 0.5 is not that plane on any real map, and the
    gap between the two is this whole repair.

    scale is the reciprocal of half the p5-to-p95 spread over the same mask, so
    the face's own relief comes out at roughly +-1 and the shader's tanh stays
    in its near-linear middle across it. p5/p95 rather than min/max: the extremes
    of a mask are its silhouette ring and a stray highlight, and calibrating to
    them would spend the range on the two things that are not the face again.

    The mask is reported with them because the numbers are meaningless without
    it: the same map masked at the jaw and masked at the shoulders gives two
    different pivots, and both are correct for what they measured.

    Otsu is run TWICE, which is the one thing here that is not obvious. These
    maps are feathered (depth.py's own sigma 6, over an estimator that is
    already soft at a silhouette), so the ramp from backdrop to sitter is tens
    of pixels wide and a fifth of the plate by area. One Otsu splits at the
    middle of that ramp and hands back a mask that is a third ramp by area: on
    Nietzsche it reads a pivot of 0.705 and a spread of 0.376, which is the
    silhouette measuring itself again, exactly the failure the pivot exists to
    stop. A second Otsu inside the sitter class separates ramp from body and
    reads 0.770 and 0.188, which matches what a hand measurement of that plate
    gives. Pass --mask-percentile to override the whole thing.
    """
    if percentile is not None:
        coarse = thr = float(np.percentile(d, percentile))
        how = f"percentile {percentile:g} at {thr:.3f}"
    else:
        coarse = otsu(d)
        thr = otsu(d[d >= coarse])
        how = f"Otsu at {coarse:.3f}, then again at {thr:.3f} to drop the feathered ring"
    mask = d >= thr
    sub = d[mask]
    # Below the COARSE threshold, so this is the backdrop itself and not the
    # backdrop plus the ring the second pass just discarded. It exists to be
    # checked against tanh: a backdrop that does not saturate would slide.
    back = d[d < coarse]
    if sub.size < 64:
        raise ValueError("the mask caught almost nothing; pass --mask-percentile")
    p5, p95 = (float(v) for v in np.percentile(sub, [5, 95]))
    pivot = float(sub.mean())
    spread = max(p95 - p5, 1e-6)
    return {
        "mask": how,
        "coverage": float(mask.mean()),
        "pivot": pivot,
        "scale": 2.0 / spread,
        "p5": p5,
        "p95": p95,
        "spread": spread,
        "background": float(back.mean()) if back.size else 0.0,
        "near_half": float(((d >= 0.45) & (d <= 0.55)).mean()),
    }


def report(path: Path, c: dict) -> None:
    """One plate's calibration, in the form the plate record wants it."""
    bg = np.tanh((c["background"] - c["pivot"]) * c["scale"])
    edge = np.tanh((c["p5"] - c["pivot"]) * c["scale"])
    print(f"{path}")
    print(f"  mask {c['mask']}, covering {c['coverage'] * 100:.1f}% of the plate")
    print(f"  sitter p5 {c['p5']:.3f}  mean {c['pivot']:.3f}  p95 {c['p95']:.3f}"
          f"   spread {c['spread']:.3f}")
    print(f"  backdrop {c['background']:.3f}   pixels near 0.5: {c['near_half'] * 100:.1f}%")
    print(f"  depth: {{ pivot: {c['pivot']:.3f}, scale: {c['scale']:.2f} }},")
    # The two numbers that say the remap is safe rather than merely applied. The
    # backdrop must saturate (tanh flat, so the silhouette cannot tear) while
    # the face's own p5 must NOT (tanh still near-linear, so relief survives).
    print(f"  after the remap: backdrop at {bg:+.3f}, the sitter's far edge at {edge:+.3f}")


def selftest_calibrate() -> bool:
    """calibrate() on a synthetic map whose answer is known in closed form.

    numpy only, so the half of --selftest that matters to a consumer who never
    generates a map still runs for them. The figure below is a real plate's
    histogram in miniature and is built with the FEATHERED RING in it on
    purpose: a bare disc on a flat backdrop would pass with one Otsu, and the
    ring is the entire reason there are two. Here it is a fifth of the frame,
    as it is on the shipped plates.

    The answer is known by construction: the body is the disc, so calibrate has
    to come back with the disc's own mean and its own p5-to-p95 spread, having
    thrown the ring away.
    """
    n = 512
    y, x = np.mgrid[0:n, 0:n] / n
    r = np.hypot(x - 0.5, y - 0.5)
    body = r <= 0.30
    dome = 0.86 - 0.6 * r  # 0.86 at the nose down to 0.68 at the jaw
    ramp = 0.68 - (0.68 - 0.10) * np.clip((r - 0.30) / 0.12, 0, 1)
    d = np.where(body, dome, np.maximum(ramp, 0.10)).astype(np.float32)
    c = calibrate(d)
    want_pivot = float(d[body].mean())
    want_scale = 2.0 / float(np.diff(np.percentile(d[body], [5, 95]))[0])
    ok = abs(c["pivot"] - want_pivot) < 0.02 and abs(c["scale"] / want_scale - 1) < 0.15
    print(f"  calibrate: pivot {c['pivot']:.4f} (want {want_pivot:.4f}), "
          f"scale {c['scale']:.3f} (want {want_scale:.3f}), "
          f"mask {c['coverage'] * 100:.1f}% against the disc's true 28.3%")
    print("  " + ("PASS: calibrate recovers a known pivot and spread"
                  if ok else "FAIL: calibrate has drifted"))
    return ok


def selftest() -> int:
    """Regenerate the shipped philosopher's map and find the sigma that matches."""
    cal_ok = selftest_calibrate()
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
    return 0 if ok and cal_ok else 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("albedo", nargs="?", help="published albedo.jpg to derive from")
    ap.add_argument("--sigma", type=float, default=6.0)
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--calibrate", nargs="+", type=Path, metavar="DEPTH_PNG",
                    help="read finished depth maps and print their pivot and scale")
    ap.add_argument("--mask-percentile", type=float,
                    help="mask the sitter at this percentile instead of by Otsu")
    a = ap.parse_args()

    if a.selftest:
        return selftest()
    if a.calibrate:
        for path in a.calibrate:
            d = np.asarray(Image.open(path).convert("L"), dtype=np.float32) / 255.0
            report(path, calibrate(d, a.mask_percentile))
        return 0
    if not a.albedo:
        ap.error("give an albedo, --calibrate, or --selftest")

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
