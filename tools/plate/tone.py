#!/usr/bin/env python3
"""Measure a plate's tone against the ones already hanging, so style drift is a
number rather than an argument.

The room's claim is that every sitter appears to come from one workshop. That
survives a conversation with a generator; it does not survive twelve one-shot
renders cut on different days. This prints what actually varies between plates
so a new one can be judged before it is calibrated, which is the expensive part.

Judge a new plate against the SPREAD of the shipped ones, not against either
alone. The two that ship already differ by more than most people would guess:
the philosopher's median figure tone is 144 and Nietzsche's is 169, both
accepted. A new plate landing between them is fine. One landing outside both,
on paper warmth or on the deep-hatch floor especially, will read as a different
workshop when it hangs beside them.

    python3 tools/plate/tone.py public/plates/<slug>/albedo.jpg
    python3 tools/plate/tone.py /tmp/attempt-5.png --against philosopher nietzsche

The background is measured separately and must be genuinely black: the shader
composites the print over the frame's aperture, and a background that is merely
dark grey lifts the whole plate away from the ones beside it.
"""

import argparse
from pathlib import Path

import numpy as np
from PIL import Image

# Below this a pixel is the black field behind the sitter rather than the plate.
# The acceptance gate asks for #000000, so anything this dark is background by
# construction and not a very deep hatch.
BACKGROUND_MAX = 24

# The philosopher ships at example/albedo.jpg, resolved from this file rather
# than the working directory, so the default comparison works from anywhere.
# He is the only plate this package ships, so he is the only slug this
# shortcut covers; anyone with their own gallery of named slugs under
# public/plates/<slug>/ still reaches them by passing --against explicitly.
REPO = Path(__file__).resolve().parents[2]
SHIPPED = {"philosopher": REPO / "example" / "albedo.jpg"}

PLATES = Path("public/plates")

# A box on the cheek and jaw, below the eyes and inside the face, as fractions of
# width and height. Hair is excluded deliberately: a bald white-haired sitter and
# a dark-haired one differ enormously over the whole figure for reasons that have
# nothing to do with how the plate was cut.
FACE_BOX = (0.36, 0.52, 0.64, 0.70)

# An engraving builds its greys from thousands of close lines, so most of the
# face lands between these. A pen-and-ink drawing puts the same quantity of ink
# into sharp lines on bare paper and leaves this band empty, which is the failure
# that median tone catches only by accident.
MID_LO, MID_HI = 70, 190


def measure(path: Path) -> dict[str, float]:
    im = Image.open(path).convert("RGB")
    a = np.asarray(im).astype(float)
    grey = a.mean(2)
    is_bg = grey < BACKGROUND_MAX
    fig = a[~is_bg]
    if fig.size == 0:
        raise SystemExit(f"{path}: no figure found, the whole frame reads as background")
    fig_grey = fig.mean(1)
    # The paper itself, taken as the brightest sliver of the figure. A mean over
    # the whole figure would be dominated by hatching and would say nothing
    # about what colour the paper is.
    paper = fig[fig_grey >= np.percentile(fig_grey, 98)].mean(0)
    return {
        "width": im.size[0],
        "height": im.size[1],
        "background_pct": float(is_bg.mean() * 100),
        "background_mean": float(grey[is_bg].mean()) if is_bg.any() else 0.0,
        "paper_r": float(paper[0]),
        "paper_g": float(paper[1]),
        "paper_b": float(paper[2]),
        "paper_warmth": float(paper[0] - paper[2]),
        "p5": float(np.percentile(fig_grey, 5)),
        "p50": float(np.percentile(fig_grey, 50)),
        "p95": float(np.percentile(fig_grey, 95)),
        **face_coverage(grey),
    }


def face_coverage(grey: np.ndarray) -> dict[str, float]:
    """How much of the cheek and jaw carries tone rather than bare paper.

    This is the measurement that separates an engraving from a line drawing, and
    it is the one worth trusting. Three Schopenhauer attempts carried the same
    quantity of ink as the shipped philosopher (18.0% against 17.6%) and still
    read as sketches, because the ink sat in sharp lines with 57% of the face
    untouched against his 37%.
    """
    h, w = grey.shape
    x0, y0, x1, y1 = (
        int(FACE_BOX[0] * w),
        int(FACE_BOX[1] * h),
        int(FACE_BOX[2] * w),
        int(FACE_BOX[3] * h),
    )
    box = grey[y0:y1, x0:x1].ravel()
    if box.size == 0:
        return {"face_ink": 0.0, "face_mid": 0.0, "face_bare": 0.0}
    return {
        "face_ink": float((box < MID_LO).mean() * 100),
        "face_mid": float(((box >= MID_LO) & (box < MID_HI)).mean() * 100),
        "face_bare": float((box >= MID_HI).mean() * 100),
    }


def report(name: str, m: dict[str, float]) -> None:
    hexes = "".join(f"{int(round(m[c])):02x}" for c in ("paper_r", "paper_g", "paper_b"))
    print(f"{name}")
    print(f"  size            {int(m['width'])} x {int(m['height'])}")
    print(f"  paper           #{hexes}  warmth R-B {m['paper_warmth']:+.1f}")
    print(f"  figure tone     p5 {m['p5']:.0f}   median {m['p50']:.0f}   p95 {m['p95']:.0f}")
    print(f"  background      {m['background_pct']:.1f}% of frame, mean {m['background_mean']:.1f}")
    print(
        f"  face coverage   ink {m['face_ink']:.1f}%   midtone {m['face_mid']:.1f}%   "
        f"bare paper {m['face_bare']:.1f}%"
    )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("src", type=Path, help="the albedo to measure")
    ap.add_argument(
        "--against",
        nargs="*",
        default=["philosopher"],
        help="slugs to compare with: philosopher resolves to the shipped "
        "example, anything else is looked up under public/plates/<slug> "
        "(default: the shipped philosopher)",
    )
    ap.add_argument(
        "--floor",
        type=int,
        default=970,
        help="source width floor. 970 is the source gallery's own number, "
        "1.733 * that gallery's PLATE_W_MAX (see PLATES.md); recompute it for "
        "your own layout, this default is not a constant argus defines",
    )
    a = ap.parse_args()

    mine = measure(a.src)
    report(str(a.src), mine)

    refs: dict[str, dict[str, float]] = {}
    for slug in a.against:
        p = SHIPPED.get(slug, PLATES / slug / "albedo.jpg")
        if not p.exists():
            print(f"\n  (no plate at {p}, skipping)")
            continue
        refs[slug] = measure(p)

    for slug, m in refs.items():
        print()
        report(f"{slug} (shipped)", m)

    if not refs:
        return

    print("\nverdict")
    lo_warm = min(m["paper_warmth"] for m in refs.values())
    hi_warm = max(m["paper_warmth"] for m in refs.values())
    lo_mid = min(m["p50"] for m in refs.values())
    hi_mid = max(m["p50"] for m in refs.values())
    lo_deep = min(m["p5"] for m in refs.values())
    hi_deep = max(m["p5"] for m in refs.values())

    def verdict(label: str, value: float, lo: float, hi: float, slack: float) -> None:
        if lo - slack <= value <= hi + slack:
            print(f"  {label:<16} {value:6.1f}  inside the shipped spread [{lo:.1f}, {hi:.1f}]")
        else:
            print(
                f"  {label:<16} {value:6.1f}  OUTSIDE [{lo:.1f}, {hi:.1f}], "
                f"this will read as a different workshop"
            )

    verdict("paper warmth", mine["paper_warmth"], lo_warm, hi_warm, 4)
    verdict("median tone", mine["p50"], lo_mid, hi_mid, 12)
    verdict("deep hatch", mine["p5"], lo_deep, hi_deep, 8)

    # Bare paper is reported, never verdicted. Two attempts at turning it into a
    # gate both misled: an area fraction scores facial hair as coverage (the box
    # lands on the philosopher's beard and Nietzsche's moustache but on a
    # clean-shaven sitter's cheek), and a white-run-length measure puts the
    # accepted Nietzsche at 3/6/13px against a rejected render's 3/6/14. Two
    # reference plates that differ from each other more than a candidate differs
    # from one of them cannot calibrate a threshold. Print it and let the eye
    # decide, which is what PLATES.md says to do anyway.
    spread = ", ".join(f"{m['face_bare']:.0f}" for m in refs.values())
    print(
        f"  bare paper       {mine['face_bare']:6.1f}  shipped: {spread}. "
        f"NOT A GATE, the box catches beard on some sitters and cheek on others. "
        f"Judge the hatching by eye on a 4x crop."
    )

    if mine["background_mean"] > 6:
        print(
            f"  background       {mine['background_mean']:6.1f}  NOT BLACK ENOUGH, "
            f"the gate asks for #000000"
        )
    else:
        print(f"  background       {mine['background_mean']:6.1f}  black enough")

    if mine["width"] < a.floor:
        print(
            f"  width            {int(mine['width']):6d}  UNDER THE {a.floor}px FLOOR, "
            f"it will be upsampled at the widest layout"
        )
    else:
        print(f"  width            {int(mine['width']):6d}  clears the {a.floor}px floor")


if __name__ == "__main__":
    main()
