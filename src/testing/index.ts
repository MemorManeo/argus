/**
 * The GLSL warp, mirrored in TypeScript.
 *
 * The regex pins in test/shader.test.ts prove the shader SAYS a thing; these
 * functions prove that what it says is right. They live in src/ rather than in
 * the test file because two different repositories need them: argus runs them
 * over synthetic ellipses to check the model, and a gallery runs them over its
 * own measured plates to check a face. Duplicating them would produce two
 * mirrors that drift, which is the exact failure they exist to catch.
 *
 * `clamp01`, `smoothstep` and `mix` are deliberately local rather than imported
 * from ../motion.ts. A mirror exists to reproduce an expression, so it spells the
 * expression the way the GLSL spells it: mix here is a * (1 - t) + b * t, where
 * motion.ts writes a + (b - a) * t. The two are the same number in algebra and
 * not always the same float, and a paraphrase's last bits are nobody's intent.
 *
 * The t = 0 identity is not what makes the local copy necessary, though it reads
 * like it. Both spellings return `a` bit for bit there: measured over 400000
 * random pairs they disagree 0 times at t = 0, and in roughly a third of them at
 * interior t, by up to 8e-12 relative. Swapping motion.ts's spelling in leaves
 * the whole suite passing, so this is a convention and not a check. Whoever
 * breaks it will not be told.
 */
import type { Ellipse, Radii } from "../plate.ts";

// gazeY and lidFade have no defaults on purpose. The lid-fade term survived a
// whole review unmirrored because this function had no parameter for it, and a
// default would let the next caller drop it the same silent way.
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

export function gain(px: number, py: number, eye: Ellipse, rim: Radii): number {
  const ax = (px - eye.cx) / eye.rx;
  const ay = (py - eye.cy) / eye.ry;
  const bx = (px - eye.cx) / rim.rx;
  const by = (py - eye.cy) / rim.ry;
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  const t = clamp01((la - 1) / Math.max(la - lb, 1e-4));
  return 1 - smoothstep(0, 1, t);
}

/** How much of the DOWN-warp survives near the upper lid, 0.15 to 1 on the
 *  philosopher. It multiplies the vertical term only: a repair against dragging
 *  lash ink downward has no business scaling the sideways warp, and when it did
 *  it pinned the top of his pupil at 0.15 of the travel. gazeY is the RAW
 *  uGaze.y, before any rest correction, because that is the shader's gate. */
export function lidFadeAt(px: number, py: number, eye: Ellipse, gazeY: number, fade: number): number {
  if (gazeY >= 0) return 1;
  return 1 - fade * smoothstep(0.15, 0.75, (py - eye.cy) / eye.ry);
}

/** The lid's own gain: 1 everywhere inside the rim, easing to 0 at rim * reach.
 *  The same construction as `gain` above, one ellipse pair further out, which is
 *  the point: an eye whose lid travels with its iris translates as a unit, so
 *  the feather band absorbs only the difference between the two. */
export function lidGain(px: number, py: number, eye: Ellipse, rim: Radii, reach: number): number {
  const ax = (px - eye.cx) / rim.rx;
  const ay = (py - eye.cy) / rim.ry;
  const bx = (px - eye.cx) / (rim.rx * reach);
  const by = (py - eye.cy) / (rim.ry * reach);
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  const t = clamp01((la - 1) / Math.max(la - lb, 1e-4));
  return 1 - smoothstep(0, 1, t);
}

/** GLSL's mix, spelled the way GLSL spells it. At t = 0 it returns `a` bit for
 *  bit, and that is the entire safety argument for lidFollow: see the identity
 *  test below. */
const mix = (a: number, b: number, t: number): number => a * (1 - t) + b * t;

/** The three per-plate lid numbers, together, because no caller wants two of
 *  them. `fade` suppresses the iris warp near the upper lid; `follow` and
 *  `reach` move the lid instead. They are independent and no shipped plate uses
 *  both. */
type Lid = { fade: number; follow: number; reach: number };
export type { Lid };

/** One eye's contribution to the sampling offset: the TypeScript mirror of
 *  eyeOffset in the GLSL. gazeY is the RAW uGaze.y, before any rest correction,
 *  because that is what the shader's lid-fade gate reads. */
export function offsetAt(
  px: number,
  py: number,
  gazeX: number,
  gazeY: number,
  eye: Ellipse,
  rim: Radii,
  lid: Lid,
): { x: number; y: number } {
  const g = gain(px, py, eye, rim);
  const l = lidGain(px, py, eye, rim, lid.reach);
  const f = lidFadeAt(px, py, eye, gazeY, lid.fade);
  return { x: gazeX * g, y: gazeY * mix(g * f, l, lid.follow) };
}

export const RAYS = 16;
/** A grid over the whole warped region, in units of the rim radii, dense enough
 *  that no ray, boundary or corner of the field goes unvisited. */
export const GRID = 61;
export function* overRegion(
  eye: Ellipse,
  rim: Radii,
  span: number,
): Generator<{ px: number; py: number }> {
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      yield {
        px: eye.cx + rim.rx * span * (-1 + (2 * i) / (GRID - 1)),
        py: eye.cy + rim.ry * span * (-1 + (2 * j) / (GRID - 1)),
      };
    }
  }
}

/** Points inside the iris, on RAYS rays out of the centre. */
export function* insideIris(iris: Ellipse): Generator<{ px: number; py: number; f: number; th: number }> {
  for (let i = 0; i < RAYS; i++) {
    const th = (2 * Math.PI * i) / RAYS;
    for (const f of [0, 0.25, 0.5, 0.75, 0.999]) {
      yield {
        px: iris.cx + f * iris.rx * Math.cos(th),
        py: iris.cy + f * iris.ry * Math.sin(th),
        f,
        th,
      };
    }
  }
}

// --- Where the travel folds -------------------------------------------------
//
// The shader maps p to p - G g(p), so its Jacobian is I - G (grad g)^T and its
// determinant is exactly 1 - G . grad g. Where that reaches zero the map stops
// being one-to-one, the hatching doubles back and the pupil sprouts a hook. For
// travel along one axis the ceiling is therefore 1 / max(dg/daxis), maximised
// over the whole gain field, with dg the component of the warp that axis rides:
// the iris gain across, the lid-blended one down.
//
// That blend is the whole reason lidFollow exists. The vertical field falls from
// 1 to lidFollow across the iris-to-rim band instead of from 1 to 0, so its
// steepest slope drops by (1 - lidFollow) and the fold moves out by the
// reciprocal. The remaining lidFollow is then shed across the far wider rim to
// rim*reach band, where the slope is small enough not to bind.
//
// It has to be searched in two dimensions, not reasoned about on one axis. The
// horizontal peak sits off-axis, on the diagonal where the two ellipses crowd
// together: scanning only the x axis through Nietzsche's iris centre reads his
// horizontal fold as 10.87px against a true 9.67px, while his vertical peak is
// on the axis and reads correctly. The fold is not a fixed fraction of the
// iris-to-rim band either: his horizontal band is 23.0px and the fold lands at
// 42 percent of it, his vertical band is 4.6px and the fold lands at 65
// percent. Carrying either fraction to the other axis oversets the travel.

/** Finite-difference step, in UV. The gradient peak is sharp, and a step near
 *  the pixel scale reads Nietzsche's vertical fold half a percent wide; this is
 *  four orders below the band width and still far above double-precision noise. */
const DIFF = 1e-6;
const SEARCH_STEPS = 128;
const SEARCH_PASSES = 8;

/** The travel at which the map folds, in UV, along one axis. Measured on the
 *  bare iris-to-rim geometry plus the lid follow, which genuinely changes it:
 *  lidFade is a separate, per-plate deformation on top of this and is pinned by
 *  its own test above. */
export function foldTravel(iris: Ellipse, rim: Radii, axis: "x" | "y", lid: Lid): number {
  const dx = axis === "x" ? DIFF : 0;
  const dy = axis === "x" ? 0 : DIFF;
  // Unit gaze on the axis in question, so the offset is the warp factor itself.
  // Upward and with no fade, because this measures the geometry the fade and
  // the sign sit on top of.
  const factor = (px: number, py: number): number =>
    axis === "x"
      ? offsetAt(px, py, 1, 0, iris, rim, lid).x
      : offsetAt(px, py, 0, 1, iris, rim, lid).y;
  const slope = (px: number, py: number): number =>
    (factor(px + dx, py + dy) - factor(px - dx, py - dy)) / (2 * DIFF);

  // Sweep the whole eye region, then close in on the best point. The gain is C1
  // across both boundaries, so once a pass has the right basin the refinement
  // is safe; the first pass is wide enough to find it.
  //
  // How wide "the whole region" is depends on what the axis rides. Only a
  // vertical search with a live lid follow has anything outside the rim to
  // find; widening the window otherwise would re-tread a field of zeros and
  // coarsen the early refinement passes, which would move numbers that must not
  // move.
  const span = axis === "y" && lid.follow > 0 ? lid.reach : 1;
  let cx = iris.cx;
  let cy = iris.cy;
  let sx = rim.rx * 1.6 * span;
  let sy = rim.ry * 1.6 * span;
  let best = Number.NEGATIVE_INFINITY;
  for (let pass = 0; pass < SEARCH_PASSES; pass++) {
    let bx = cx;
    let by = cy;
    best = Number.NEGATIVE_INFINITY;
    for (let i = 0; i <= SEARCH_STEPS; i++) {
      const px = cx - sx + (2 * sx * i) / SEARCH_STEPS;
      for (let j = 0; j <= SEARCH_STEPS; j++) {
        const py = cy - sy + (2 * sy * j) / SEARCH_STEPS;
        const v = slope(px, py);
        if (v > best) {
          best = v;
          bx = px;
          by = py;
        }
      }
    }
    cx = bx;
    cy = by;
    sx = (4 * sx) / SEARCH_STEPS;
    sy = (4 * sy) / SEARCH_STEPS;
  }
  return 1 / best;
}
