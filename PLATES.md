# Adding a sitter

The shader is generic. What is per-portrait is a small set of measured numbers,
chiefly two ellipses per eye: the iris, which moves as one piece, and the rim,
where the warp stops, and a directory of two images. Everything below is
about getting those right the first time, because getting them wrong is the
difference between ten minutes and an afternoon.

This was written inside the private gallery argus was extracted from, and it is
kept close to as it was written, because its numbers were paid for. It works two
calibrated plates as examples: the philosopher, who ships here as
`example/plate.ts` with his albedo and depth map beside him, and Nietzsche, who
stayed in that gallery. Read Nietzsche as a second worked example you cannot
open, not as a file that has gone missing.

The Python tools under `tools/plate/` came across with it and still assume that
gallery's asset layout. They read and write `public/plates/<slug>/albedo.jpg`
relative to the directory you run them from, and `derive.py` creates it. That is
their convention and not the library's: `createRig` only ever takes two URLs, so
put the images wherever your own build serves them from and pass the paths.
`warp.py` is the one tool that needs more than a path substitution to run outside
that gallery, and it takes `--plates` and `--dir` for exactly that; see
[Rendering the warp](#rendering-the-warp).

## Before you start: the toolkit's dependencies

    python3 -m venv .venv && . .venv/bin/activate
    pip install -r tools/plate/requirements.txt

That is numpy, pillow and scipy, and it covers seven of the eight tools.

`depth.py` is the exception. Estimating a depth map runs Depth Anything V2 Small,
so it additionally wants torch and transformers, which are a multi-gigabyte
install and a model download on first use:

    pip install "torch>=2.0" "transformers>=4.38"

Install those only when you need to generate a map. If you already have a depth
map, or you are painting one by hand, the rest of the pipeline runs without them.

## What decides whether a plate will work

Two things, and both are about the eyes.

1. **The full circle of each iris must be visible**, not clipped by the upper
   eyelid. The eyelid is a hard line and the warp will drag it.
2. **Clean, unhatched white must show on both sides of each iris**, on the nose
   side as well as the outer side. That white is the travel room. The pupil
   slides a small fraction of the image width and it needs somewhere to go.

A near-frontal pose with both eye sockets out of shadow costs about ten minutes
to calibrate. A three-quarter turn with one eye in shade costs an afternoon.

## Acceptance gates

Reject the render if any of these is true. Do not compromise: regenerating is
minutes, and calibrating around a bad plate is not.

- Either iris is clipped by the upper eyelid.
- Clean unhatched white is not visible on both sides of both irises.
- The head is turned more than a few degrees.
- Anything crosses the eyes: glasses, hair, a shadow edge.
- The background is not flat pure black, or anything is behind the figure.
- Any lettering, plate mark, border or paper edge appears.
- The source is narrower than the width floor your own layout sets. In the
  gallery this came from that floor is 970 pixels, derived below.

970 is not arbitrary, and the arithmetic is worth repeating for your own page.
There, the aperture is 72.2 percent of a plate's layout width, but the canvas
inside it is wider still (it is sized `height: 110%` of the aperture at 4:5, so
the aperture is a window onto something larger than itself), and you therefore
see 83.3 percent of the canvas. At the device-pixel-ratio cap of 2, which
`bufferSize` enforces, that comes to **1.733 source pixels per CSS pixel of the
plate's layout width** for 1:1.

Nothing sits on top of that. The page shows a print at its own layout size with
no perspective on it and no zoom, so the whole budget is that factor times the
widest a plate is ever laid out, which that gallery caps at 560px:
560 x 1.733 = **970**. It derives the gate from the cap in a test rather than
writing 970 down in two places, so raising the cap raises the gate and neither
can drift. Do the same with your own cap.

Both plates that shipped there are below it. Nietzsche at 920px is 5 percent
upsampled at the widest layout, which is nothing. The philosopher in `example/`
at 733px is 32 percent; he is this package's frozen regression target and his
bytes must not change, so he is a documented exception and not a target.
**Author above 1100**, which clears the floor with headroom for a wider page
later.

**Check the eyes by cropping the region and upscaling it 4x with a point filter.**
At native size a hatched engraving hides everything that matters. Every rejection
that gallery logged was invisible until the eyes were looked at that way.

    python3 tools/plate/eyes.py public/plates/<slug>/albedo.jpg /tmp/eyes.png

The default band is 0.28 to 0.46 of the height, which suits the philosopher. Pass
`--band` when a sitter's eyes sit elsewhere: Nietzsche's wanted 0.39 to 0.49.

## The pipeline

    python3 tools/plate/tone.py <master>.png                    # before anything else
    python3 tools/plate/derive.py <master>.png <slug>          # crop to 4:5, encode
    python3 tools/plate/depth.py public/plates/<slug>/albedo.jpg --sigma 6
    python3 tools/plate/measure.py public/plates/<slug>/albedo.jpg
    python3 tools/plate/eyes.py public/plates/<slug>/albedo.jpg /tmp/eyes.png
    python3 tools/plate/grid.py public/plates/<slug>/albedo.jpg /tmp/grid.png

`derive.py` is the one tool here that CREATES a directory rather than reading
one, and by default it creates `public/plates/<slug>/`. In a Next.js, Vite or
Create React App tree `public/` already means something specific, so say where
the plate should go and pass the same path to the tools that follow:

    python3 tools/plate/derive.py <master>.png <slug> --out assets/plates
    python3 tools/plate/depth.py assets/plates/<slug>/albedo.jpg --sigma 6

`--out` also decides which plates `--match-paper` matches against, since it
compares against the ones the new plate is about to sit beside.

`tone.py` runs first because it is the cheapest rejection. It reports a render's
paper colour, figure tonal range, background purity and width against the plates
already hanging, and a master that lands outside the shipped spread will read as
a different workshop no matter how good its eyes are. Judge against the spread of
both shipped plates rather than either alone: they differ from each other by more
than most people would guess (median figure tone 144 against 169) and both are
accepted. It catches a failure that previously took an eye to see; the rejected
`attempt-3-symmetric-mask`, which stayed behind in that gallery's rejection log,
reads median 195 against those two, which is the "uniformly pale, no modelling"
verdict as a number.

Depth maps come from Depth Anything V2 Small on CPU. White is nearest, the map
matches the albedo's pixel dimensions exactly, and then it is **feathered**: a
gaussian blur that kills the silhouette echo which otherwise appears as a ghost
edge beside the head at strong head-turn. Sigma 6 is the value the shipped
philosopher needed; `tools/plate/depth.py --selftest` recovers it from
`example/albedo.jpg` and `example/depth.png`, and that is the tool's own
regression test.

Judge the feather on a rendered plate, not in the numbers. The interior relief
statistics cannot see it: on a real plate the nose band moves by 0.002 between
sigma 0 and sigma 6, while the silhouette echo it exists to remove is plainly
visible.

Record the sigma you settle on beside the plate, wherever your project keeps its
provenance, so the next person regenerating the map does not start from scratch.
The gallery keeps a `plate.json` per slug with a `depthSigma` field. `GazePlate`
has no room for it on purpose: the shader never reads it, and the type holds only
what `createRig` needs.

## Calibration

1. Overlay a labelled 0.05-step UV grid with `tools/plate/grid.py`.
2. Read off both eye centres in **image coordinates**: top-left origin, y down,
   fractions of width and height.
3. Measure the **iris** ellipse: the drawn iris, out to the LIMBUS, where the
   disc meets the sclera. Not the pupil, and not the pupil plus the inner ring
   of hatching, which is what it looks like on a plate whose iris is drawn with
   concentric lines. Everything inside this translates rigidly and everything
   outside it lags, so an iris that pokes outside it shears as it slides. This
   is the one number where erring small is the bug, and both shipped plates were
   measured small: the fix was 1.2x on the philosopher and 1.4x on Nietzsche.

   The CENTRE is the same number and is easier to get wrong, because a pupil with
   a catchlight on one side does not look centred where it is. Nietzsche's was
   6px and 8.5px outward and 3.5px to 5px high, on eyes whose iris is 18.5px
   across. Fit it as what it is drawn as, a disc: search the circle whose
   interior is darkest against the ring just outside it, and leave the TOP sector
   out of that ring, because the upper sclera lies in the lid's shadow and will
   drag the fit upward. It wants a clear limbus to work: it scored 126 and 120 on
   Nietzsche and 84 and 48 on the philosopher, whose eyes are a hatched squint,
   and on that plate it returned a circle spanning both lids and was thrown out.
   A fit you have not drawn back over the plate is a guess.

   The plateau has to cover the CATCHLIGHT too. It is a few white pixels near the
   top of the iris and it is the brightest thing in the eye, so an eye whose
   plateau stops under it has its most legible feature pinned while the pupil
   slides out from beneath, which reads as a pupil stuck along its top edge. The
   philosopher's right eye was exactly this. Paint the gain over the eye and
   look: whatever the pupil covers should be at gain 1, and the lid lines should
   not be.

   The symptom is unmistakable once seen, and it does not look like shearing. It
   looks like the pupil CHANGING SIZE: the part of the disc inside the plateau
   travels the whole way and the part outside it barely moves, so the disc
   stretches when the gaze runs toward the side with the room and squashes when
   it runs the other way. On a pair of eyes it is mirrored, one pupil swelling
   while the other shrinks, because the plateau falls short on each eye's inner
   side. Sweep the cursor from one page edge to the other and watch one pupil.
4. Open the **rim** ellipse until the pupil has somewhere to go, and stop
   before the lid line. Horizontally there is usually plenty of room; vertically
   on a wide-open eye there is almost none, which is why these are two ellipses
   and not one ellipse plus a feather.

   Measure that lid line, do not assume it. Take a column through the iris
   centre and read where the sclera's bright bank ends: on Nietzsche the lash is
   31px above the centre and the lower lid edge 27px below it, and rim.ry had
   been left at 20.1px, which was inside the DISC and not merely inside the lid.
   The bottom of his iris was left with no gain at all, so it did not move, in
   any direction, and a pupil anchored along its lower edge is what that looks
   like. 24px clears the disc, keeps a band under it and still stops short of
   both lids.
5. Draw both back over the plate with `tools/plate/ellipse.py` and adjust. Two
   or three rounds is normal. It also reports the gap between the two RIM
   regions, which must stay positive: the shader sums both eyes' contributions
   and that is only exact while they are disjoint.
6. Store them as measured, in image coordinates, with a comment. The conversion
   to GL UV happens exactly once, at the uniform upload.
7. Set `gaze.maxX` and `gaze.maxY`, the pupil's travel. These are per-plate, not
   a shared constant, and they have a computable ceiling: see the fold note
   below. Take the number the test gives you and come down from it until the
   pupil reads as a disc through the whole sweep, and sweep to the EDGES of the
   page: the gaze is normalised against the half-viewport, so a cursor kept near
   the frame never asks for the travel that breaks.
8. Verify the signs visually: cursor right means pupils right. If they go the
   wrong way an ellipse is mirrored; the gaze maths is unit-tested.
9. Only if the neutral gaze misses the viewer, add `restDown`.
10. Only for a three-quarter pose, add `restR`.
11. Only if the iris is clipped by the upper lid, add `lidFade`. A frontal plate
    that passes the acceptance gates wants `lidFade: 0`, and a non-zero value
    there is simply a gaze that will not look down. It fades the down-warp
    *after* the gain has been clamped to 1, so a plate that needs it is buying
    shear on a downward gaze in exchange for keeping lid ink out of the eye.

    When a dark mass appears across the top of the eye on a downward gaze, that
    is this repair being too weak, and the instinct is to shrink the vertical rim
    until the warp stops short of the lashes. Raise the fade first. Shrinking the
    rim narrows the band under the plateau on BOTH sides, so the down-warp starts
    folding along the lower lid instead, and it is a worse artefact in a brighter
    place: on the philosopher it would have taken his vertical overshoot from
    1.85x its fold to 4.16x. A fade of 1.0 is allowed and he ships at it.

    It reaches the VERTICAL term only, and that is load-bearing. It used to
    multiply the scalar gain, which meant a repair about not dragging lash ink
    downward also throttled the pupil SIDEWAYS: the philosopher's ran at 0.15 of
    the travel along its top edge and 1.0 along its bottom, and `restDown` holds
    the gate open over all but the top eighth of the screen, so it was throttled
    essentially always. A pupil that looks anchored along one edge while the rest
    of it slides is this, not geometry. Check it with `restDown` live, because
    the gate is `uGaze.y < 0` and a plate at a level gaze will not show it.
12. If the vertical fold is what is holding `maxY` back, set `lidFollow`. It is
    how much of the vertical gaze the lid carries with the iris, 0 to 1, and a
    real eye looking down brings its lid down too. The band between iris and rim
    then absorbs only the difference between the two, so the fold moves out by
    `1 / (1 - lidFollow)` and `maxY` has somewhere to go: on Nietzsche 0.6 took
    it from 3.0px to 7.4px. Raise `maxY` afterwards, or the change spends its
    headroom on nothing and the eye reads as looking down *less*, since the iris
    moves less within its own socket. `lidFollow: 0` is exact, not merely
    neutral: the vertical offset is `gaze.y * g` again, bit for bit, so a plate
    whose appearance is frozen keeps 0 and needs no re-verification.
13. Then set `lidReach`, where the lid's motion dies, as a multiple of the rim.
    Judge it on a render and not on the fold, which it usually does not touch:
    capture the same pose with `lidFollow` at 0 and at its real value and diff
    the two. What changed should be an ellipse around the socket. If the brow or
    the cheek is in it, come down. 2.0 is Nietzsche's; 2.6 already reaches his
    brow. Both eyes' regions must stay disjoint out at the reach, since the
    shader sums them, whatever `lidFollow` says. That check is per-plate, so it
    belongs in your own suite, over your own faces; `lidGain` is exported from
    `@memormaneo/argus/testing` to write it against.

`lidFade` and `lidFollow` pull against each other: one suppresses the down-warp
near the upper lid, the other carries the lid down with the eye. Neither shipped
plate sets both, and a plate that wants both is a question nobody has answered.

The pupil's travel has a real ceiling: the width of the iris-to-rim band, not
how wide the eye looks. The gain runs from 1 at the iris down to 0 at the rim,
and past a point the sampling map folds on itself, the hatching folds over and
the pupil sprouts a hook. No fraction of the band is worth quoting, because the
steepest part of the gain sits at an off-axis diagonal where the two ellipses
crowd together, and because a wide eye whose iris nearly fills the fissure has
generous horizontal room and almost none vertical. Get the number instead:
`foldTravel()`, exported from `@memormaneo/argus/testing`, computes it from a
measured iris and rim pair.

    import { foldTravel } from "@memormaneo/argus/testing";

    const { iris, rim } = plate.eyes.l;
    const lid = {
      fade: plate.gaze.lidFade,
      follow: plate.gaze.lidFollow,
      reach: plate.gaze.lidReach,
    };
    const acrossPx = foldTravel(iris, rim, "x", lid) * sourceWidthPx;
    const downPx = foldTravel(iris, rim, "y", lid) * sourceHeightPx;

It returns a UV length, so the horizontal fold scales by the source WIDTH and the
vertical one by the source HEIGHT. Write it into your own test suite as a gate on
the travel you chose, one assertion per eye per axis, so no later retune can push
a pupil past its own fold without the suite saying so. On Nietzsche's 920x1150
plate it is 9.7px across and, with no lid follow, 3.0px down off one iris, which
is 42 percent of his horizontal band and 65 percent of his vertical one.

Widening the plateau to the limbus costs less travel than it looks like it
should, and sometimes none. The fold is set by the STEEPEST gain gradient, not
by the band width, and a plateau pushed outward meets the rim over a stretch
where the two ellipses crowd together less; that very nearly cancels the band it
took away. Re-fitting Nietzsche from 15.6px to 21.9px, band 23px down to 16.7px,
moved his fold from 9.67px to 9.58px and cost him 0.0001 of `maxX`. Where it
does bite, widen the RIM with it: the philosopher's plateau went to 1.2x and his
rim to 1.15x, and his folds moved OUT, 6.47px to 7.13px and 5.96px to 6.55px, so
he kept the travel he had. Widen the rim horizontally only unless the lid line
genuinely has room. Across, the limit is the two eyes staying disjoint and the
corners not dragging; down, it is lash ink, and it is always closer.

This ceiling is what `lidFollow` buys headroom against, and only vertically. It
is also why a wide-open eye needs it: the horizontal band is generous and the
vertical one is a few pixels, so `maxY` is where a plate runs out of room first.
`foldTravel()` reads the plate's own `lidFollow`, so the number it hands back is
already the one that applies.

Horizontally the ceiling is hard and no plate is exempt. Vertically it is a
guide: a fold above or below the iris happens in lid ink and under a `lidFade`,
and the philosopher ships at 2.4 times his, because a gaze that could not look
down at all was the worse failure. Across, the fold lands on bright sclera at
the iris edge with nothing over it, and the pupil visibly stops being a disc and
smears into a slash. The philosopher shipped at 1.23 times his horizontal fold
for a while and it did not show, because on memormaneo.com he was one small
portrait on a long page and `normalizePointer` divides by the half-viewport, so
the cursor never asked for more than a third of his travel. One plate filling a
dark screen asks for all of it, and he broke; his `maxX` came down from 0.01 to
0.0055. Both plates' ratios are pinned, with the reasoning beside them, in that
gallery's own plate suite. Pin yours the same way: a ratio that moves without
somebody meaning to move it is the failure this whole section is about.

Count `restR` against the horizontal ceiling. The rig uploads it as the right
eye's share of `uGaze`, so that eye travels `maxX + |restR.x|` at one extreme
while the left travels `maxX`. It is 31 percent of the philosopher's right-eye
budget, it is why that eye broke first, and it is why that gate has to measure
the sum rather than `maxX`. Leaving it out is what let him ship at 1.54 times
his right eye's fold while a gate reading 1.23 passed him.

Do not calibrate against another sitter's deformation either. The philosopher's
warp determinant floors read -0.133 and -0.230 today but +0.013 and -0.071
before the gain became scalar, so his left eye only began folding in that
change, and Nietzsche's vertical overshoot was then accepted for staying inside
those floors.

Do not calibrate a new plate's `lidFollow` against Nietzsche's 0.6 either. What
it should be depends on how much of the fissure that sitter's iris fills, which
is the ratio his 0.6 was chosen from.

Four of the philosopher's numbers are compensations for one specific plate and
must never be copied to a new face without measuring:

- His `r.iris.cy` is centred on the **drawn iris** rather than the fissure
  midline, because that iris is clipped high under the lid.
- His `restR.x` pulls that iris inward at rest, because his three-quarter pose
  draws it glancing toward the outer corner. It is also what caps his `maxX`:
  that eye carries it on top of the whole travel.
- His `restDown` lowers the whole gaze, because the etching draws him looking up.
- His `lidFade` of 1.0 exists because his clipped iris has no sclera above it
  to reveal, so a down-warp would smear lid ink into the eye. It repaired that
  at 0.85 for a while and still found lash, which is the note in
  `example/plate.ts`.

A frontal plate with both sockets lit needs none of the four. Nietzsche needs
none of the four. That is most of why frontal poses are worth insisting on.

## Rendering the warp

Every other tool here measures the plate at rest. `warp.py` applies both warps at
full travel and crops the eyes, and it is the only check that catches the drawn
iris poking outside the plateau, which is invisible at rest and invisible in the
numbers and obvious the moment you render it. That failure once survived three
hand-written detectors and an ellipse overlay in one sitting. So render it.

It needs the plate record as data. Hand it a JSON file with `--plates`, and the
directory holding that plate's two images with `--dir`. If the record is authored
in TypeScript, as `example/plate.ts` is, node will print it for you:

    node --experimental-strip-types \
      -e 'import("./example/plate.ts").then(m => console.log(JSON.stringify([m.PHILOSOPHER])))' \
      > /tmp/plates.json
    python3 tools/plate/warp.py philosopher --plates /tmp/plates.json --dir example

The file may hold one record or a list of them. Any way of getting a `GazePlate`
into JSON will do; the node line is just the shortest one when it lives in a
module. With `--plates` omitted the tool falls back to reading a `PLATES` manifest
out of `./src/plates/index.ts` and images out of `public/plates/<slug>/`, which is
the gallery's layout and is why the flags exist.

It writes a strip per eye: rest on top, then full gaze left, right and down. Read
the BORDER of the iris, not its middle. A disc that translates rigidly keeps its
outline; one whose edge is outside the plateau grows a flat, a hook, or a hard
dark arc where the compression piles pixels up. The `--iris-rx/ry` and
`--rim-rx/ry` overrides let a candidate calibration be seen before it is written
down, and they apply to both eyes.

## What the plates are

The one plate that ships here is a generated engraving, not a scan of a
historical print, and he depicts nobody: he was prompted into existence for
memormaneo.com, no museum holds him, and he carries no provenance because there
is none to carry.

The gallery's other sitters were made the same way, an image model prompted with
two references, this philosopher as the style anchor and a public domain likeness
of the sitter. Those are new images in an old manner, depicting real people who
died long ago, and each one records what it was drawn from. If you generate a
plate of a real person, write down what it was drawn from somewhere a reader can
find it. A thing built to look old should say plainly that it is not.

See `NOTICE.md` for the licence on the images in `example/`, which is not the
licence on the code.
