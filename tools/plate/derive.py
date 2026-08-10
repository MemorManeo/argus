#!/usr/bin/env python3
"""Master render to published albedo: crop to exactly 4:5, match the paper, encode.

Every plate in this room is 4:5, so one frame fits all of them and the room's
CSS carries a single aspect-ratio. The crop is centred horizontally and anchored
to the top, because the framing the prompt asks for puts a little black above
the hair and runs the shoulders off the bottom edge: trimming the bottom costs
nothing and trimming the top costs the composition.

    python3 tools/plate/derive.py docs/plates-src/nietzsche-accepted-928.png nietzsche
    python3 tools/plate/derive.py docs/plates-src/camus-accepted.png camus --match-paper

--match-paper is the one correction this pipeline allows itself, and it is worth
being clear about why it is allowed when nothing else is. Everything that makes
a plate work or fail lives in structure: where the iris sits, how close the
hatching is laid, whether the sclera is bare. None of that can be repaired after
the fact and none of it should be attempted; a render that fails on structure is
re-rolled, which is what docs/plates-src and the rejection log are for.

The colour of the paper is not structure. It is a single global property with no
spatial component, the plate equivalent of the stock the sheet was printed on,
and a generator with no conversation drifts on it freely between sittings. So
this scales the three channels so the bare paper lands on the mean of the plates
already hanging, leaves black at black (a scale fixes zero), and prints what it
did. It cannot move an edge, close a gap in the hatching, or touch an eye.

Judge the result with tools/plate/tone.py, which reports paper warmth against the
shipped spread and is the reason this drift is visible at all.
"""

import argparse
from pathlib import Path

import numpy as np
from PIL import Image

# The gate PLATES.md derives from PLATE_W_MAX in src/room/slider.ts, and which
# test/rig.test.ts recomputes so the two cannot drift. Restated here because a
# Python tool cannot import it; if they disagree, the test is right.
MIN_WIDTH = 970
GOOD_WIDTH = 1100
QUALITY = 92

PLATES = Path("public/plates")
BACKGROUND_MAX = 24  # below this a pixel is the black field, not the plate


def paper_of(rgb: np.ndarray) -> np.ndarray:
    """The bare paper, as the mean of the brightest sliver of the figure.

    A mean over the whole figure would be dominated by hatching and would say
    nothing about what colour the paper is.
    """
    grey = rgb.mean(2)
    fig = rgb[grey >= BACKGROUND_MAX]
    if fig.size == 0:
        raise SystemExit("no figure found, the whole frame reads as background")
    lum = fig.mean(1)
    return fig[lum >= np.percentile(lum, 98)].mean(0)


def shipped_paper(exclude: str) -> np.ndarray | None:
    """The paper colour to aim at: the mean of every plate already hanging."""
    papers = []
    for d in sorted(PLATES.iterdir()) if PLATES.is_dir() else []:
        if not d.is_dir() or d.name == exclude:
            continue
        alb = d / "albedo.jpg"
        if alb.exists():
            papers.append(paper_of(np.asarray(Image.open(alb).convert("RGB"), dtype=float)))
    return np.mean(papers, axis=0) if papers else None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("src")
    ap.add_argument("slug")
    ap.add_argument(
        "--match-paper",
        action="store_true",
        help="scale the channels so bare paper matches the plates already hanging",
    )
    a = ap.parse_args()

    im = Image.open(a.src).convert("RGB")
    w, h = im.size

    # Largest exact 4:5 box that fits, with both sides even.
    cw = min(w, (h * 4) // 5)
    cw -= cw % 2
    ch = (cw * 5) // 4
    left = (w - cw) // 2
    out = im.crop((left, 0, left + cw, ch))

    print(f"{a.src}  {w}x{h}")
    print(f"  cropped to {cw}x{ch}  (exactly 4:5: {cw * 5 == ch * 4})")
    print(f"  trimmed {w - cw}px of width, {h - ch}px of height")

    arr = np.asarray(out, dtype=float)
    mine = paper_of(arr)
    print(f"  paper #{''.join(f'{int(round(c)):02x}' for c in mine)}  "
          f"warmth R-B {mine[0] - mine[2]:+.1f}")

    if a.match_paper:
        want = shipped_paper(exclude=a.slug)
        if want is None:
            print("  no other plate to match against, leaving the paper alone")
        else:
            # A per-channel scale: black stays black, paper lands on target, and
            # everything between moves proportionally, which is what a change of
            # stock does. No spatial term, so no edge can move.
            k = np.where(mine > 1e-6, want / np.maximum(mine, 1e-6), 1.0)
            arr = np.clip(arr * k, 0, 255)
            out = Image.fromarray(arr.astype(np.uint8))
            got = paper_of(arr)
            print(f"  matched paper to #{''.join(f'{int(round(c)):02x}' for c in want)} "
                  f"(mean of the plates already hanging), scale "
                  f"{k[0]:.3f}/{k[1]:.3f}/{k[2]:.3f}")
            print(f"  paper now #{''.join(f'{int(round(c)):02x}' for c in got)}  "
                  f"warmth R-B {got[0] - got[2]:+.1f}")

    dst = PLATES / a.slug
    dst.mkdir(parents=True, exist_ok=True)
    path = dst / "albedo.jpg"
    out.save(path, "JPEG", quality=QUALITY, optimize=True, progressive=True)
    print(f"  wrote {path}  {path.stat().st_size / 1024:.0f} KB")

    if cw < MIN_WIDTH:
        print(f"  REJECT: {cw}px wide, below the {MIN_WIDTH}px floor")
        return 1
    if cw < GOOD_WIDTH:
        print(f"  WARN: {cw}px wide, under the {GOOD_WIDTH}px authoring target.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
