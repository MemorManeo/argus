/**
 * The engine's view of a plate: everything createRig actually reads to draw a
 * sitter. Plate-domain concerns (a caption, a slot on a ring, provenance text)
 * are not here. They belong to whatever owns the sitter, which layers its own
 * richer record on top of this shape.
 *
 * The dependency runs one way and must keep running one way: the engine never
 * reaches back into the caller's plate domain. That is what let this rig be
 * lifted out of the gallery it was written in with GazePlate and Ellipse
 * carried along and nothing else.
 */

/** An axis-aligned ellipse in IMAGE coordinates: top-left origin, y down,
 *  fractions of width and height. The flip to GL UV happens once, at the
 *  uniform upload in rig.ts, and nowhere else. */
export type Ellipse = { cx: number; cy: number; rx: number; ry: number };

/** Radii only, in the same image fractions. A length has no origin, so unlike
 *  an Ellipse there is nothing here to flip. */
export type Radii = { rx: number; ry: number };

/**
 * One eye, as two boundaries sharing a centre.
 *
 * The warp's gain is exactly 1 inside `iris` and exactly 0 outside `rim`, so
 * the drawn disc translates rigidly and the lid is never dragged. The one
 * qualification is `gaze.lidFade`: a non-zero value fades the down-warp across
 * the top of the eye after that clamp, so on a downward gaze the gain does vary
 * inside the iris, and such a plate is accepting shear rather than avoiding it.
 *
 * `gaze.lidFollow` deliberately does drag the lid, vertically, out to
 * `rim * gaze.lidReach`. It leaves the rigid disc alone, since both gains are 1
 * inside the iris, and it is what buys a wide-open eye enough vertical travel to
 * read as looking down.
 *
 * Storing one ellipse and a feather scalar would be smaller and would not work:
 * the feather room is genuinely anisotropic, since a wide-open eye leaves half
 * its width free horizontally while the iris nearly fills the fissure vertically.
 */
export type EyeRegion = {
  /** The drawn iris. Everything inside this moves as one piece. */
  iris: Ellipse;
  /** Where the warp reaches zero. Must stay inside the lid line: this is the
   *  number that drags lash ink into the eye when it is too generous, and it
   *  is the one to shrink first when a plate misbehaves. */
  rim: Radii;
};

/**
 * Everything createRig reads from a plate. slug names its asset directory;
 * eyes, gaze and amp drive the shader; phase offsets its glance clock. A
 * second consumer of the engine needs exactly these fields and nothing else.
 */
export type GazePlate = {
  /** Identifies this plate in warnings and errors. The rig never resolves it to
   *  a path: the albedo and depth URLs are passed to createRig directly. */
  slug: string;

  eyes: { l: EyeRegion; r: EyeRegion };

  gaze: {
    /** Max pupil travel in UV, horizontal. */
    maxX: number;
    /** Max pupil travel in UV, vertical. */
    maxY: number;
    /** Lowers the neutral gaze, for artwork drawn looking up. 0 for a frontal
     *  plate with both sockets lit. */
    restDown: number;
    /** Per-eye rest correction, three-quarter poses only. Zero otherwise. */
    restR: { x: number; y: number };
    /** How much of the down-warp to fade out across the top of the eye, 0 to 1.
     *  A plate whose iris is clipped high under the lid has no sclera above it
     *  to reveal, so a down-warp smears lid ink into the eye as a top shadow;
     *  0.85 repairs that. A frontal sitter with a whole iris wants 0, and a
     *  non-zero value there is simply a gaze that will not look down.
     *
     *  It is also the only thing that breaks the gain-is-1-inside-the-iris rule
     *  above: it multiplies the gain after that clamp, so on a downward gaze the
     *  disc shears. Set it only where the iris is dark enough to hide it. */
    lidFade: number;

    /** How much of the VERTICAL gaze the lid carries with the iris, 0 to 1.
     *
     *  A real eye looking down brings its upper lid down too, and doing the same
     *  here is what lifts the ceiling on `maxY`. With the lid following, the
     *  iris-to-rim band absorbs only the difference between iris and lid rather
     *  than the whole travel, so its slope drops by (1 - lidFollow) and the
     *  travel at which the sampling map folds moves out by the reciprocal. On a
     *  wide-open eye whose iris nearly fills the fissure, that band is a few
     *  pixels tall and this is the only thing that makes looking down possible.
     *
     *  0 is not a neutral default, it is an exact one: the vertical offset
     *  becomes `gaze.y * g` again, bit for bit what shipped before this field
     *  existed. That is why the frozen philosopher keeps it and needs no
     *  re-verification. */
    lidFollow: number;

    /** How far the lid's motion reaches, as a multiple of the rim radii, so
     *  strictly greater than 1. The lid gain is 1 inside the rim and eases to 0
     *  at `rim * lidReach`; too generous and the brow and the cheek move with
     *  the eye. Both eyes' regions must still be disjoint out here, since the
     *  shader sums them. Inert while `lidFollow` is 0. */
    lidReach: number;
  };

  /** Head-turn amplitude fed to the parallax warp: how hard this sitter turns,
   *  an artistic knob.
   *
   *  0.045 is the number an UNCALIBRATED plate wants, and it is the one where
   *  0.07 was tried on the philosopher and reverted because the stronger warp
   *  magnified every depth-map imperfection at the silhouette. That reversal is
   *  a symptom of the depth range being spent on the silhouette rather than on
   *  the face; see `depth` below. A calibrated plate wants roughly an eighth of
   *  it, because `depth.scale` has taken over the job of turning this map's
   *  range into relief, and the two multiply.
   *
   *  They are mathematically redundant and are kept apart anyway: collapsing
   *  them would make every plate's `amp` unreadable, since a number that is
   *  half calibration and half intent cannot be compared across two sitters
   *  whose maps came out differently. */
  amp: number;

  /** How this plate's depth map becomes relief. Optional, and absent means the
   *  parallax term is `(d - 0.5)` exactly, bit for bit what shipped before this
   *  field existed: 0 is not a neutral default for `scale`, it is an exact one,
   *  the same treatment `gaze.lidFollow` gets and for the same reason.
   *
   *  A monocular estimator spends most of its 0..1 separating the sitter from
   *  the backdrop: across the five plates this rig was calibrated on, that step
   *  is 0.67 to 0.77 while the whole relief of the FACE is 0.165 to 0.231, and
   *  almost nothing sits at 0.5. So an uncalibrated plate rotates about a plane
   *  that lies in the empty gap between sitter and backdrop, the head
   *  translates wholesale instead of turning, and the sitter reads as a stack
   *  of flat cards sliding over each other.
   *
   *  Measure both with `tools/plate/depth.py --calibrate <depth.png>`, which
   *  needs only numpy and PIL and reads a finished map, since a shipped plate's
   *  depth.png generally cannot be regenerated. */
  depth?: {
    /** The depth value the head rotates about: the mean depth over the sitter.
     *  Around 0.77 on these plates, nowhere near 0.5. */
    pivot: number;
    /** Multiplier taking the sitter's own relief out to roughly +-1, the
     *  reciprocal of half its p5-to-p95 spread. Around 10. The shader passes
     *  the scaled depth through `tanh`, so the backdrop saturates smoothly
     *  instead of tearing the silhouette open, and a value of 0 turns the whole
     *  remap off. */
    scale: number;
  };

  /** Glance-clock offset in seconds. Set it with phaseFor(index), never by hand. */
  phase: number;
};
