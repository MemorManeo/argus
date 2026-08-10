/**
 * The engine's view of a plate: everything createRig actually reads to draw a
 * sitter. Plate-domain concerns (a caption, a slot on the ring, provenance
 * text) are not here; the Plate type in src/plates layers those on top of
 * this shape.
 *
 * Nothing in this file, or anywhere else under src/gaze/, imports from
 * src/plates. The dependency runs one way, src/plates depends on src/gaze and
 * never the reverse, so src/gaze/ can be lifted out with GazePlate and Ellipse
 * carried along and nothing else.
 */

/** An axis-aligned ellipse in IMAGE coordinates: top-left origin, y down,
 *  fractions of width and height. The flip to GL UV happens once, at the
 *  uniform upload in src/gaze/rig.ts, and nowhere else. */
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
  /** Directory name under public/plates. */
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

  /** Head-turn amplitude fed to the parallax warp. 0.045 is known good; 0.07 was
   *  tried on the philosopher and reverted, because the stronger warp magnifies
   *  every depth-map imperfection at the silhouette. */
  amp: number;

  /** Glance-clock offset in seconds. Set it with phaseFor(index), never by hand. */
  phase: number;
};
