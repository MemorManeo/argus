#!/usr/bin/env python3
"""Render what the shader actually does to a plate, and look at it.

Every other tool here measures the plate at rest. This one applies both warps at
full travel and crops the eyes, which is the only check that catches the failure
this repository keeps rediscovering: the drawn iris poking outside the gain's
plateau, so its edge lags the centre and creases.

That failure survived three separate hand-written detectors and a visual ellipse
overlay in one sitting. It is invisible at rest and invisible in the numbers; it
is obvious the moment you render it. So render it.

Point it at a plate record as JSON and at the directory holding that plate's two
images. On the worked example in this repository:

    node --experimental-strip-types \\
      -e 'import("./example/plate.ts").then(m => console.log(JSON.stringify([m.PHILOSOPHER])))' \\
      > /tmp/plates.json
    python3 tools/plate/warp.py philosopher --plates /tmp/plates.json --dir example
    python3 tools/plate/warp.py philosopher --plates /tmp/plates.json --dir example \\
      --iris-ry 0.0208 --rim-ry 0.026
    python3 tools/plate/warp.py --all --plates /tmp/plates.json --dir example

The record is whatever `GazePlate` holds, so any way of getting one to JSON will
do; the node line above is only the shortest way when it is authored in
TypeScript. With --plates omitted the tool falls back to reading a `PLATES`
manifest out of ./src/plates/index.ts and the images out of public/plates/<slug>/,
which is the layout of the gallery this toolkit was written in.

Writes a strip per eye: rest on top, full gaze to each side beneath. Read the
BORDER of the iris, not its middle. A disc that translates rigidly keeps its
outline; one whose edge is outside the plateau grows a flat, a hook or a hard
dark arc where the compression piles pixels up.

The overrides exist so a candidate calibration can be seen before it is written
down. They apply to both eyes.
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

PLATES = Path("public/plates")


def assets_for(slug: str, override: Path | None) -> Path:
    """Where this plate's albedo.jpg and depth.png live.

    Defaults to the gallery's layout so nothing that worked before changes; pass
    --dir for any other arrangement, since the library itself only ever takes two
    URLs and has no opinion about where they sit.
    """
    d = override if override is not None else PLATES / slug
    for name in ("albedo.jpg", "depth.png"):
        if not (d / name).is_file():
            sys.exit(f"{d / name} not found; pass --dir with the directory holding both images")
    return d


def load_plates(src: Path | None) -> list[dict]:
    """Plate records, from a JSON file if one was given and from the gallery's
    TypeScript manifest if not.

    The JSON route is the portable one: a plate record is plain data, so a caller
    holding one in any language can hand it over without this tool knowing how it
    was authored. It accepts a single record or a list of them.

    The fallback reads the manifest through node rather than parsing TypeScript.
    The values that matter are the ones the shader is handed, so they are worth
    taking from the module the shader is fed by and not from a regex over it.
    """
    if src is not None:
        try:
            data = json.loads(src.read_text())
        except (OSError, json.JSONDecodeError) as err:
            sys.exit(f"could not read {src}: {err}")
        plates = data if isinstance(data, list) else [data]
        for p in plates:
            if "slug" not in p or "eyes" not in p or "gaze" not in p:
                sys.exit(f"{src}: not a plate record; needs slug, eyes and gaze")
        return plates

    out = subprocess.run(
        [
            "node",
            "--experimental-strip-types",
            "-e",
            'import("./src/plates/index.ts").then(m => console.log(JSON.stringify(m.PLATES)))',
        ],
        capture_output=True,
        text=True,
    )
    if out.returncode != 0:
        sys.exit(f"could not read the manifest:\n{out.stderr}")
    return json.loads(out.stdout)


def hermite(t: np.ndarray) -> np.ndarray:
    return t * t * (3 - 2 * t)


def between(px, py, cx, cy, ax, ay, bx, by):
    """The shader's ray-normalised falloff: 1 inside the inner ellipse, 0 at the
    outer, along every ray out of the shared centre."""
    la = np.hypot((px - cx) / ax, (py - cy) / ay)
    lb = np.hypot((px - cx) / bx, (py - cy) / by)
    t = np.clip((la - 1) / np.maximum(la - lb, 1e-4), 0, 1)
    return 1 - hermite(t)


def warp(albedo: np.ndarray, depth: np.ndarray, p: dict, mouse: tuple[float, float],
         over: dict) -> np.ndarray:
    """Both warps, in image coordinates.

    The stored ellipses are image space (y down) and the shader flips once at the
    uniform upload, so working in image space here means flipping the gaze's y
    instead. Everything else is the fragment shader line for line.
    """
    h, w = albedo.shape[:2]
    X, Y = np.meshgrid(np.arange(w) / w, np.arange(h) / h)
    mx, my = mouse

    # parallax head-turn, exactly as main() does it
    d = depth / 255.0
    sx = X - (d - 0.5) * p["amp"] * mx
    sy = Y - (d - 0.5) * p["amp"] * (-my) * -1.0

    gz_x = np.clip(mx, -1, 1) * p["gaze"]["maxX"]
    gz_y = np.clip(my, -1, 1) * p["gaze"]["maxY"] + p["gaze"]["restDown"]

    off_x = np.zeros_like(X)
    off_y = np.zeros_like(X)
    for side in ("l", "r"):
        e = p["eyes"][side]
        cx, cy = e["iris"]["cx"], e["iris"]["cy"]
        irx = over.get("iris_rx", e["iris"]["rx"])
        iry = over.get("iris_ry", e["iris"]["ry"])
        rrx = over.get("rim_rx", e["rim"]["rx"])
        rry = over.get("rim_ry", e["rim"]["ry"])
        g = between(sx, sy, cx, cy, irx, iry, rrx, rry)
        reach = p["gaze"]["lidReach"]
        lid = between(sx, sy, cx, cy, rrx, rry, rrx * reach, rry * reach)
        follow = p["gaze"]["lidFollow"]
        rest_x = p["gaze"]["restR"]["x"] if side == "r" else 0.0
        off_x += (gz_x + rest_x) * g
        off_y += gz_y * ((1 - follow) * g + follow * lid)

    ux = np.clip(((sx - off_x) * w).round().astype(int), 0, w - 1)
    uy = np.clip(((sy - off_y) * h).round().astype(int), 0, h - 1)
    return albedo[uy, ux]


def strip(p: dict, over: dict, zoom: int, out_dir: Path, assets: Path) -> list[Path]:
    alb = np.asarray(Image.open(assets / "albedo.jpg").convert("RGB"), dtype=float)
    dep = np.asarray(Image.open(assets / "depth.png").convert("L"), dtype=float)
    h, w = alb.shape[:2]
    frames = [
        ("rest", warp(alb, dep, p, (0.0, 0.0), over)),
        ("left", warp(alb, dep, p, (-1.0, 0.0), over)),
        ("right", warp(alb, dep, p, (1.0, 0.0), over)),
        ("down", warp(alb, dep, p, (0.0, 1.0), over)),
    ]
    written = []
    for side in ("l", "r"):
        e = p["eyes"][side]
        rrx = over.get("rim_rx", e["rim"]["rx"])
        rry = over.get("rim_ry", e["rim"]["ry"])
        cx, cy = int(e["iris"]["cx"] * w), int(e["iris"]["cy"] * h)
        rx, ry = int(rrx * w * 1.9), int(rry * h * 2.6)
        tiles = []
        for _, img in frames:
            c = Image.fromarray(img[cy - ry:cy + ry, cx - rx:cx + rx].astype(np.uint8))
            tiles.append(c.resize((c.width * zoom, c.height * zoom), Image.NEAREST))
        tw, th = tiles[0].size
        sheet = Image.new("RGB", (tw, th * len(tiles) + 6 * (len(tiles) - 1)), (190, 0, 0))
        for i, t in enumerate(tiles):
            sheet.paste(t, (0, i * (th + 6)))
        path = out_dir / f"warp-{p['slug']}-{side}.png"
        sheet.save(path)
        written.append(path)
    return written


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("slug", nargs="?")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--iris-rx", type=float)
    ap.add_argument("--iris-ry", type=float)
    ap.add_argument("--rim-rx", type=float)
    ap.add_argument("--rim-ry", type=float)
    ap.add_argument("--zoom", type=int, default=5)
    ap.add_argument("--out", type=Path, default=Path("/tmp"))
    ap.add_argument("--plates", type=Path,
                    help="JSON file holding one plate record or a list of them")
    ap.add_argument("--dir", type=Path, dest="assets",
                    help="directory holding albedo.jpg and depth.png "
                         "(default: public/plates/<slug>)")
    a = ap.parse_args()

    over = {k: v for k, v in (
        ("iris_rx", a.iris_rx), ("iris_ry", a.iris_ry),
        ("rim_rx", a.rim_rx), ("rim_ry", a.rim_ry)) if v is not None}

    plates = load_plates(a.plates)
    want = [p for p in plates if a.all or p["slug"] == a.slug]
    if not want:
        sys.exit(f"no plate named {a.slug!r}; have {[p['slug'] for p in plates]}")
    if a.assets is not None and len(want) > 1:
        sys.exit("--dir names one plate's images, so it cannot be used with --all")

    for p in want:
        assets = assets_for(p["slug"], a.assets)
        with Image.open(assets / "albedo.jpg") as im:
            w, h = im.size
        e = p["eyes"]["l"]
        irx = over.get("iris_rx", e["iris"]["rx"]) * w
        iry = over.get("iris_ry", e["iris"]["ry"]) * h
        print(f"{p['slug']}: iris {irx:.1f} x {iry:.1f}px, rx/ry {irx / iry:.2f}"
              f"{'   <-- not a circle. A whole drawn iris is; only a clipped one, like the philosopher, is not' if abs(irx / iry - 1) > 0.08 else ''}")
        for path in strip(p, over, a.zoom, a.out, assets):
            print(f"  {path}   rows: rest, gaze left, gaze right, gaze down")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
