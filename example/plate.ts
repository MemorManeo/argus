import type { GazePlate } from "../src/plate.ts";

/**
 * The philosopher: an invented sitter, drawn for memormaneo.com, and the plate
 * every other portrait in the original gallery was styled against.
 *
 * He is here as the worked example of a calibrated plate. Every number below was
 * measured off albedo.jpg rather than guessed, and the comments are the argument
 * for each one. See PLATES.md for how to produce them for a face of your own.
 *
 * The image is CC BY-NC 4.0, not MIT: see NOTICE.md.
 */
export const PHILOSOPHER: GazePlate = {
  slug: "philosopher",
  // Measured on albedo.jpg via a 0.05-step UV grid overlay, then DERIVED into
  // the iris/rim pair when the gain became scalar: the old gains held a
  // plateau to 0.55 of the ellipse and reached zero at 0.95 rx / 0.90 ry, so
  // iris is 0.55 of what shipped and rim is 0.95 / 0.90 of it. The VERTICAL
  // pair is still exactly that and must stay so; a regression test in the
  // gallery this plate came from enforces it, and that gallery is not part of
  // this package.
  //
  // The horizontal pair is not, any more. 0.55 of the ellipse put the plateau
  // well inside his drawn iris, so the outer third of the disc sat in the
  // falloff and lagged the middle as it slid: the pupil deformed instead of
  // travelling, which is the failure tools/plate/ellipse.py warns that
  // undersizing this ring reintroduces. The plateau now traces the disc at
  // 1.2x, and the rim is 1.15x to keep a band under it.
  //
  // The vertical PLATEAU went the same way afterwards, at 1.3x, and for the
  // same reason: 0.55 of the ellipse was a plateau 5px tall in an aperture of
  // 20, so the top of his iris lay in the falloff and dragged while the middle
  // slid. On his right eye it was the CATCHLIGHT that sat there, which is the
  // brightest thing in the eye and the last thing that should lag.
  //
  // The vertical rim follows at 1.3x too, and that is a choice with a cost.
  // It carries the down-warp closer to his lash line, which came back into the
  // eye as a dark mass across the top of it, and shrinking it back is the
  // obvious repair and the wrong one: the band under the plateau would be
  // 1.7px, the down-warp would fold along the LOWER lid instead, and his
  // vertical overshoot would go from 1.85x its fold to 4.16x. The band stays;
  // lidFade takes the top instead, at 1.0.
  eyes: {
    l: {
      iris: { cx: 0.48, cy: 0.378, rx: 0.02508, ry: 0.00715 },
      rim: { rx: 0.0415, ry: 0.0117 },
    },
    // Centred on the DRAWN iris, which is clipped high under the lid, rather
    // than on the fissure midline at 0.387: at the midline it sits where the
    // gain has already decayed and barely moves.
    r: {
      iris: { cx: 0.687, cy: 0.3845, rx: 0.0231, ry: 0.00572 },
      rim: { rx: 0.0382, ry: 0.00936 },
    },
  },
  gaze: {
    // 0.01 until it was driven to its limit and seen to break: at full travel
    // the sampling map doubled back over the sclera and the pupil smeared into
    // a slash with a bright hook. It came down to 0.0055, which was 0.984 of
    // what his right eye could carry AT THE TIME; widening his rim afterwards
    // moved that ceiling to 0.00644 and this number was left behind. 0.006 is
    // it collected, at 0.93 of the ceiling.
    //
    // He still travels well short of Nietzsche and that is his geometry, not a
    // choice. His eye is a squint whose rim already sits at the canthi, so the
    // band the warp shreds across is 11px against Nietzsche's 23, and his right
    // eye spends 0.0025 of what is left on restR before the gaze gets any. The
    // next 30 percent is in that rest correction, not in the rim: carried on
    // one eye it costs 28 percent of that eye's budget, and split across both
    // it would cost 14 of each. It is not split here because the correction
    // repairs how HIS right iris is drawn, and halving it onto the left eye
    // would buy travel by introducing an error in an eye that has none.
    //
    // It never showed on memormaneo.com because normalizePointer divides by
    // the HALF-VIEWPORT: one small portrait on a long page never asked for
    // more than a third of the range, which is why the break went unseen until
    // he was rendered large. One plate filling a dark screen asks for all of it
    // the moment the cursor crosses the room.
    maxX: 0.006,
    maxY: 0.004,
    // The etching draws his gaze elevated, and a dark hatch cluster in the
    // right eye's lower sclera comes unglued from the iris shadow when the
    // pupil warps away from it. Resting lower fixes both.
    restDown: 0.003,
    // His three-quarter pose draws that iris glancing toward the outer corner,
    // so it needs pulling inward at rest for both eyes to converge.
    restR: { x: -0.0025, y: 0 },
    // His iris is clipped: there is no sclera above it to reveal, so the
    // down-warp has to fade out across the top or it drags lid ink in.
    //
    // 0.85 left 15 percent of it running, and 15 percent of a 6.4px down-warp
    // reaching over a plateau that is now 6.55px tall still finds lash. At 1.0
    // the down-warp is over completely above 0.75 of the iris, and the top of
    // his eye stays his eye. It costs the top edge of the disc its sink, which
    // is shear, and it is the trade this field has always been: he is the one
    // plate whose iris has no sclera above it to give.
    lidFade: 1.0,
    // He is the extraction's frozen regression target, so he opts out. At 0
    // the vertical warp is uGaze.y * g again, bit for bit what shipped, which
    // is what let the lid follow land without re-verifying him.
    lidFollow: 0,
    // Inert while lidFollow is 0: it scales a term multiplied by zero. Stated
    // rather than left at some implicit default so that raising the follow is
    // one edit, and stated at a value his eyes are actually disjoint at.
    lidReach: 2.0,
  },
  amp: 0.045,
  phase: 0,
};
