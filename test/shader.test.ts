import { test } from "node:test";
import assert from "node:assert/strict";

import { VERT, FRAG, UNIFORMS } from "../src/shader.ts";
import {
  gain,
  lidGain,
  lidFadeAt,
  offsetAt,
  foldTravel,
  insideIris,
  overRegion,
  RAYS,
  type Lid,
} from "../src/testing/index.ts";

/** Every uniform name FRAG actually DECLARES, as opposed to merely mentions.
 *  Both directions of the UNIFORMS cross-check read from this one set, so neither
 *  direction can drift from the other. */
const declared = new Set(
  [...FRAG.matchAll(/^\s*uniform\s+\w+\s+([^;]+);/gm)]
    .flatMap((m) => (m[1] ?? "").split(",").map((s) => s.trim()))
    .filter(Boolean),
);

test("both stages declare GLSL ES 3.00 on the very first line", () => {
  // Compared UNTRIMMED on purpose. #version has to be the first characters in
  // the string, and an indented directive fails to compile with no useful
  // message. An earlier version of this test trimmed first, which made it blind
  // to the one thing it exists to catch.
  assert.equal(VERT.split("\n")[0], "#version 300 es");
  assert.equal(FRAG.split("\n")[0], "#version 300 es");
});

test("the fragment stage declares every uniform the rig sets", () => {
  // DECLARES, not mentions. Deleting a declaration while a usage of the same
  // identifier survives is a GLSL compile error, and an earlier version of this
  // test searched for the bare name anywhere in the source, so it passed on
  // exactly that mistake.
  for (const name of UNIFORMS) {
    assert.ok(declared.has(name), `${name} is not DECLARED in FRAG`);
  }
});

test("the eye gain is a single scalar, applied to both axes", () => {
  // The repair. A vec2 gain with a different shape per axis is what sheared
  // the pupil: the middle band of the iris slid at full gain while its top and
  // bottom were pinned. One float cannot do that. Reintroducing a gx and a gy
  // looks like a refinement and is the bug, and this is what forbids it: the
  // function has one float to return.
  assert.match(FRAG, /return vec2\(g\);/);
});

test("nothing writes to the gain between the clamp and the return", () => {
  // The lid-fade line used to be the one permitted write here, and it was the
  // one thing that made the gain vary inside the iris. It multiplies the
  // vertical term now, so this counts ZERO writes: the clamp is the last word on
  // the gain, and a disc inside the plateau translates rigidly on both axes
  // whatever any per-plate repair says.
  //
  // Counted rather than searched for by name, because searching cannot catch a
  // term nobody has thought of yet, which is how the fade got into the mirror
  // below a whole review late.
  const from = FRAG.indexOf("float g = 1.0");
  const to = FRAG.indexOf("return vec2(g);");
  assert.ok(from > 0 && to > from, "eyeGain no longer has the shape this test reads");
  const body = FRAG.slice(FRAG.indexOf("\n", from) + 1, to);
  const writes = [...body.matchAll(/(?<![\w.])g\s*[-+*/]?=(?!=)/g)].map((m) =>
    m[0].replace(/\s+/g, " "),
  );
  assert.deepEqual(writes, [], "something writes to the eye gain again");
});

test("the gain runs between an iris ellipse and a rim ellipse", () => {
  // t is 0 on the iris boundary and 1 on the rim boundary along every ray out
  // of the centre. The clamp is what makes the interior exactly 1.0 rather
  // than approximately, and the max guards the centre where both lengths are 0.
  assert.match(FRAG, /float t = clamp\(\(la - 1\.0\) \/ max\(la - length\(b\), 1e-4\), 0\.0, 1\.0\);/);
  assert.match(FRAG, /float g = 1\.0 - smoothstep\(0\.0, 1\.0, t\);/);
});

test("the down-warp fade survives, and reaches the DOWN-warp only", () => {
  // The repair that took a session to find. A plate whose iris is clipped high
  // under the lid has no sclera above it to reveal, so dragging the upper band
  // down smears lid ink into the eye as a top shadow. It was a hard-coded 0.85
  // that every plate paid; it is now the philosopher's number and Nietzsche's
  // zero. Deleting it looks like a simplification and is not.
  assert.match(FRAG, /return 1\.0 - uLidFade \* smoothstep\(0\.15, 0\.75, \(p\.y - eye\.y\) \/ eye\.w\);/);
  // And this is the half that took a second session. It lived inside eyeGain,
  // which returns one scalar for both axes, so a repair about dragging ink
  // DOWNWARD also throttled the sideways warp: the top of the philosopher's
  // pupil ran at 0.15 of the travel while its bottom ran at 1.0, and his
  // restDown holds the gate open over all but the top eighth of the screen. It
  // must not appear in eyeGain, and it must reach gaze.y and nothing else.
  const gainBody = FRAG.slice(FRAG.indexOf("vec2 eyeGain"), FRAG.indexOf("float lidFadeAt"));
  assert.doesNotMatch(gainBody, /uLidFade/, "the fade is back inside the scalar gain");
  assert.match(FRAG, /gaze\.y \* mix\(g\.y \* lidFadeAt\(p, eye\), l, uLidFollow\)/);
  assert.doesNotMatch(FRAG, /gaze\.x \* g\.x \* lidFadeAt/);
});

test("the lid gain is the eye gain's construction, one ellipse pair further out", () => {
  // Same ray normalisation, so t runs 0 on the rim to 1 on rim * reach along
  // every ray, exactly, and everything inside the rim carries the lid's motion
  // rigidly just as the iris carries the pupil's. Rewriting it as a plain radial
  // falloff would reintroduce, across the whole socket, the shear the scalar
  // gain exists to forbid.
  assert.match(FRAG, /vec2 b = \(p - eye\.xy\) \/ \(rim \* reach\);/);
  assert.match(FRAG, /return 1\.0 - smoothstep\(0\.0, 1\.0, t\);/);
  const clamps = [...FRAG.matchAll(/float t = clamp\(\(la - 1\.0\) \/ max\(la - length\(b\), 1e-4\), 0\.0, 1\.0\);/g)];
  assert.equal(clamps.length, 2, "the two gains no longer share one construction");
});

test("only the vertical offset follows the lid", () => {
  // Horizontal is the iris gain alone. A real eye barely moves its lids
  // sideways, and the horizontal travel is tuned right up against its own fold,
  // so putting the lid term on x would move that fold and silently invalidate
  // every maxX in the room.
  assert.match(
    FRAG,
    /return vec2\(gaze\.x \* g\.x, gaze\.y \* mix\(g\.y \* lidFadeAt\(p, eye\), l, uLidFollow\)\);/,
  );
});

test("the eye gains are evaluated at the parallax-shifted uv, not the raw one", () => {
  // Gains at suv keep the regions glued to the eye pixels while the head turns.
  assert.match(FRAG, /eyeOffset\(suv, uGaze \+ uRest\.xy, uEyeL, uRimL\)/);
  assert.match(FRAG, /eyeOffset\(suv, uGaze \+ uRest\.zw, uEyeR, uRimR\)/);
  assert.doesNotMatch(FRAG, /eyeOffset\(uv,/);
  // And both gains inside it read that same point, so the iris warp and the lid
  // warp can never come apart by a parallax shift.
  assert.match(FRAG, /vec2 g = eyeGain\(p, eye, rim\);/);
  assert.match(FRAG, /float l = lidGain\(p, eye, rim, uLidReach\);/);
});

test("the head turns about the plate's own depth, not about the middle of the byte range", () => {
  // The bug this pins is the sitter reading as sliding cards. A monocular depth
  // map spends its 0..1 on the sitter-against-backdrop step, so 0.5 lands in the
  // empty gap between them: the whole face sits on one side of the pivot and
  // translates as one piece, and the face's own relief, which is the only part
  // that reads as ROTATION, is 3.5 to 4.6 times smaller than the step it is
  // riding on. Measured across five plates. Putting the pivot back on the face
  // is the fix; uScale is what makes the relief that is left worth turning.
  assert.match(FRAG, /float turn = uScale > 0\.0 \? tanh\(\(d - uPivot\) \* uScale\) : d - 0\.5;/);
  assert.match(FRAG, /vec2 suv = uv - turn \* uAmp \* uMouse;/);
  // And NOT a clamp. A clamp is a gradient discontinuity landing exactly on the
  // silhouette, which is the one place this rig cannot afford one: the whole
  // lesson of tools/plate/warp.py is that discontinuities crease, and a crease
  // at the silhouette is precisely the artifact the pivot exists to remove.
  assert.doesNotMatch(FRAG, /clamp\(\s*\(?d - uPivot/);
});

test("an uncalibrated plate's parallax is the exact term that shipped before the pivot", () => {
  // The same guarantee gaze.lidFollow gives, spelled the same way: 0 is not a
  // neutral default for uScale, it is an exact one. tanh(d - 0.5) is not
  // d - 0.5, so an unconditional remap would move every frozen plate by a hair
  // and quietly invalidate every amp in every room. The branch is on a uniform,
  // so it is uniform control flow and costs nothing.
  const parallax = FRAG.slice(FRAG.indexOf("float turn ="), FRAG.indexOf("vec2 off ="));
  assert.match(parallax, /: d - 0\.5;/);
  assert.doesNotMatch(parallax, /tanh\(d - 0\.5\)/);
});

test("the lamp's pseudo-normal reads the raw depth, not the remapped turn", () => {
  // Decided rather than overlooked. A calibrated uScale is around 10, so
  // differencing the remapped field here would multiply every gradient by that
  // and rewrite the specular on every plate. Changing the lighting while fixing
  // the parallax would make one change unreviewable as two.
  // Comments stripped first, because the paragraph in the shader that explains
  // this decision necessarily names the very identifiers the check forbids.
  const normal = FRAG.slice(FRAG.indexOf("float e = 1.0/512.0"), FRAG.indexOf("vec3 n = normalize"))
    .replace(/\/\/[^\n]*/g, "");
  assert.match(normal, /float dx = dep\(uv\+vec2\(e,0\.\)\) - dep\(uv-vec2\(e,0\.\)\);/);
  assert.match(normal, /float dy = dep\(uv\+vec2\(0\.,e\)\) - dep\(uv-vec2\(0\.,e\)\);/);
  assert.doesNotMatch(normal, /uScale|uPivot|tanh|turn/);
});

test("the lamp radius is a uniform, so one torch can light the whole wall", () => {
  // The 0.85 that used to be here was a radius in plate heights, which meant
  // every plate lit itself identically and a wall of twelve had twelve suns.
  // As a uniform the room can set it in screen pixels, per plate, from that
  // plate's projected rect.
  assert.match(FRAG, /float lamp = pow\(smoothstep\(uReach, 0\.0, length\(lv\)\), 1\.5\);/);
  assert.doesNotMatch(FRAG, /smoothstep\(0\.85, 0\.0,/);
});

test("the lamp falloff still reads the way its CPU mirror does", () => {
  // litAtCentre in src/rig.ts is these two lines, hand-written in
  // TypeScript and evaluated at uv (0.5, 0.5), because the moulding around a
  // print is a DOM layer no shader ever samples. Nothing at runtime compares the
  // two, so this is the pin: edit the falloff here and this test sends the next
  // reader to the mirror, which test/rig.test.ts holds still.
  //
  // The inverted edges are the whole subtlety. edge0 is uReach and edge1 is 0,
  // so the gain falls with distance; spelled the usual way round it would light
  // the far wall instead of the plate under the cursor.
  assert.match(FRAG, /vec2 lv = \(uLight - uv\) \* vec2\(uAspect, 1\.0\);/);
  assert.match(FRAG, /float lamp = pow\(smoothstep\(uReach, 0\.0, length\(lv\)\), 1\.5\);/);
});

test("the albedo is sampled with a negative LOD bias, and the depth is not", () => {
  // These two belong together and are pinned together, because either alone is
  // a regression. src/rig.ts calls generateMipmap so that a plate the
  // torch has not reached stops aliasing its own hatching; without the bias
  // that same call spends most of its weight on the half-resolution mip at the
  // size a plate is ACTUALLY displayed at, and the engraving turns to smooth
  // tone. Measured on the shipped Nietzsche: hatching visible on the forehead
  // with the bias, gone without it, aliased with neither.
  assert.match(FRAG, /const float LOD_BIAS = -0\.75;/);
  assert.match(FRAG, /texture\(uAlbedo, suv - off, LOD_BIAS\)/);
  // The depth map is a blurred field with no high frequency to protect, and
  // dep() is differenced twice to build the normal. Biasing it would sharpen
  // nothing and make that normal noisier.
  assert.match(FRAG, /float dep\(vec2 uv\)\{ return texture\(uDepth, uv\)\.r; \}/);
});

test("the print falls to three and a half percent away from the light", () => {
  // This is why a plate must carry full tonal range: a pale flat face becomes a
  // pale flat slab. It is also the acceptance gate behind PLATES.md, and it is
  // what a distant plate actually sits at.
  //
  // It was 0.16, which put an untorched print at 41 of 255 against a background
  // at 12 and left all twelve sitters plainly readable in a room that is
  // supposed to be dark. At 0.035 a plate the torch has not reached is a shape,
  // and the room is discovered by sweeping rather than by looking.
  assert.match(FRAG, /vec3 lit = vec3\(0\.035\)/);
});

test("no uniform is declared that the rig does not set", () => {
  // The other direction, off the same `declared` set. UNIFORMS is a readonly
  // tuple of literals, so widen it before asking whether it contains an
  // arbitrary string.
  const known: readonly string[] = UNIFORMS;
  for (const name of declared) {
    assert.ok(known.includes(name), `FRAG declares ${name} but UNIFORMS does not list it`);
  }
});

const IRIS = { cx: 0.4, cy: 0.5, rx: 0.02, ry: 0.012 };
const RIM = { rx: 0.045, ry: 0.019 };

test("gain is exactly 1 everywhere inside the iris, unconditionally", () => {
  // THE test, for every plate that can afford it. A pupil tears when different
  // parts of it move by different amounts, and gain 1.0 across the whole disc
  // means the whole disc translates. It now holds unconditionally: the gain has
  // no gaze and no lidFade to take, because the fade multiplies the vertical
  // term in eyeOffset instead. The gaze-dependent part of the disc's motion is
  // the down-warp alone, two tests down.
  for (const { px, py, f, th } of insideIris(IRIS)) {
    const g = gain(px, py, IRIS, RIM);
    assert.equal(g, 1, `gain dipped to ${g} at f=${f} th=${th}`);
  }
});

test("gain is 1 on the iris boundary and 0 on the rim boundary, on every ray", () => {
  for (let i = 0; i < RAYS; i++) {
    const th = (2 * Math.PI * i) / RAYS;
    const onIris = gain(
      IRIS.cx + IRIS.rx * Math.cos(th),
      IRIS.cy + IRIS.ry * Math.sin(th),
      IRIS, RIM);
    const onRim = gain(
      IRIS.cx + RIM.rx * Math.cos(th),
      IRIS.cy + RIM.ry * Math.sin(th),
      IRIS, RIM);
    assert.ok(Math.abs(onIris - 1) < 1e-9, `iris boundary gain ${onIris} at th=${th}`);
    assert.ok(Math.abs(onRim) < 1e-9, `rim boundary gain ${onRim} at th=${th}`);
  }
});

test("gain falls monotonically between the two boundaries", () => {
  for (let i = 0; i < RAYS; i++) {
    const th = (2 * Math.PI * i) / RAYS;
    let prev = Number.POSITIVE_INFINITY;
    for (let s = 0; s <= 20; s++) {
      const f = s / 20;
      const rx = IRIS.rx + f * (RIM.rx - IRIS.rx);
      const ry = IRIS.ry + f * (RIM.ry - IRIS.ry);
      const g = gain(IRIS.cx + rx * Math.cos(th), IRIS.cy + ry * Math.sin(th), IRIS, RIM);
      assert.ok(g <= prev + 1e-12, `gain rose at f=${f} th=${th}`);
      prev = g;
    }
  }
});

test("gain is zero well outside the rim and never negative", () => {
  assert.equal(gain(IRIS.cx + 0.3, IRIS.cy, IRIS, RIM), 0);
  assert.equal(gain(IRIS.cx, IRIS.cy + 0.3, IRIS, RIM), 0);
});

// --- The lid follow, and the one property that makes it safe ----------------

test("at lidFollow 0 the offset is exactly the gaze times the eye gain", () => {
  // THE safety property. The vertical term is mix(g, l, lidFollow), so at
  // lidFollow 0 it is g multiplied by one and l multiplied by zero, which is g
  // to the last bit in both TypeScript and GLSL. A plate that does not opt in is
  // therefore not merely close to what shipped before the lid existed, it is
  // identical, and no regression hunt is owed. Exact equality, not a tolerance:
  // a tolerance here would hide precisely the drift this test exists to forbid.
  for (const [gx, gy] of [
    [0.0104, 0.0045],
    [-0.0104, -0.0045],
    [0, -0.0045],
    [0.0104, 0],
    [0, 0],
  ] as const) {
    for (const fade of [0, 0.85]) {
      for (const reach of [1.2, 2, 4]) {
        for (const { px, py } of overRegion(IRIS, RIM, 4)) {
          const g = gain(px, py, IRIS, RIM);
          const f = lidFadeAt(px, py, IRIS, gy, fade);
          const o = offsetAt(px, py, gx, gy, IRIS, RIM, { fade, follow: 0, reach });
          assert.equal(o.x, gx * g, `x drifted at (${px}, ${py}) gaze (${gx}, ${gy})`);
          assert.equal(o.y, gy * (g * f), `y drifted at (${px}, ${py}) gaze (${gx}, ${gy})`);
        }
      }
    }
  }
});

test("the lid gain is 1 on the rim boundary and 0 at rim times reach, on every ray", () => {
  const reach = 2;
  for (let i = 0; i < RAYS; i++) {
    const th = (2 * Math.PI * i) / RAYS;
    const onRim = lidGain(
      IRIS.cx + RIM.rx * Math.cos(th),
      IRIS.cy + RIM.ry * Math.sin(th),
      IRIS, RIM, reach,
    );
    const onReach = lidGain(
      IRIS.cx + RIM.rx * reach * Math.cos(th),
      IRIS.cy + RIM.ry * reach * Math.sin(th),
      IRIS, RIM, reach,
    );
    assert.ok(Math.abs(onRim - 1) < 1e-9, `lid gain ${onRim} on the rim at th=${th}`);
    assert.ok(Math.abs(onReach) < 1e-9, `lid gain ${onReach} at the reach at th=${th}`);
  }
});

test("the three regions carry the travel the lid model promises", () => {
  // At the iris both gains are 1, so the pupil gets the whole gaze whatever
  // lidFollow says: this is what keeps the disc rigid, and it is why the lid
  // follow costs nothing that the scalar gain won. On the rim the iris gain has
  // died and the lid gain has not, so what is left is exactly lidFollow. Outside
  // the reach both are 0 and the brow does not move.
  for (const follow of [0, 0.3, 0.6, 1]) {
    const lid: Lid = { fade: 0, follow, reach: 2 };
    const gy = -0.006;
    for (const { px, py } of insideIris(IRIS)) {
      const o = offsetAt(px, py, 0.01, gy, IRIS, RIM, lid);
      assert.ok(Math.abs(o.y - gy) < 1e-12, `follow ${follow}: iris travels ${o.y}, not ${gy}`);
      assert.ok(Math.abs(o.x - 0.01) < 1e-12, `follow ${follow}: iris x travels ${o.x}`);
    }
    const onRim = offsetAt(IRIS.cx, IRIS.cy + RIM.ry, 0.01, gy, IRIS, RIM, lid);
    assert.ok(
      Math.abs(onRim.y - gy * follow) < 1e-9,
      `follow ${follow}: the lid travels ${onRim.y}, not ${gy * follow}`,
    );
    assert.ok(Math.abs(onRim.x) < 1e-9, `follow ${follow}: the lid moved sideways by ${onRim.x}`);
    const outside = offsetAt(IRIS.cx, IRIS.cy + RIM.ry * 2.5, 0.01, gy, IRIS, RIM, lid);
    // Through Math.abs, because a downward gaze times a zero gain is negative
    // zero, which strict equality distinguishes from zero and no eye does.
    assert.equal(Math.abs(outside.y), 0, `follow ${follow}: the brow moved`);
    assert.equal(Math.abs(outside.x), 0, `follow ${follow}: the brow moved sideways`);
  }
});

test("the vertical warp falls monotonically from the iris out to the reach", () => {
  // A gain that rose anywhere between the two would mean an inner ring of the
  // socket lagging an outer one, which is the fold this whole change exists to
  // buy headroom against, arriving by a different door.
  const lid: Lid = { fade: 0, follow: 0.6, reach: 2 };
  for (let i = 0; i < RAYS; i++) {
    const th = (2 * Math.PI * i) / RAYS;
    let prev = Number.POSITIVE_INFINITY;
    for (let s = 0; s <= 60; s++) {
      const f = (s / 60) * lid.reach;
      const px = IRIS.cx + RIM.rx * f * Math.cos(th);
      const py = IRIS.cy + RIM.ry * f * Math.sin(th);
      // Unit gaze, so the offset IS the vertical factor. Upward, because the
      // lid fade is gated on a downward gaze and this test is about the
      // geometry underneath it.
      const v = offsetAt(px, py, 0, 1, IRIS, RIM, lid).y;
      assert.ok(v <= prev + 1e-12, `the vertical warp rose at f=${f} th=${th}`);
      prev = v;
    }
  }
});

// --- The fold search --------------------------------------------------------

test("the lid follow moves the vertical fold out by 1 / (1 - follow), and leaves the horizontal one alone", () => {
  // The three cases that used to exercise foldTravel are per-plate and live in
  // the gallery now, so without this one a refactor of its two-dimensional
  // search would go green here and only break over there, on faces this
  // repository cannot see. It pins the relationship rather than a measurement:
  // no plate geometry is needed to state it, and a number read off a plate
  // would not have survived the split anyway.
  //
  // The claim is the one src/testing/index.ts argues in prose above foldTravel.
  // The vertical field falls from 1 to lidFollow across the iris-to-rim band
  // instead of from 1 to 0, so its steepest slope drops by (1 - lidFollow), and
  // the fold, which is one over that slope, moves out by the reciprocal.
  const base: Lid = { fade: 0, follow: 0, reach: 2 };
  const across = foldTravel(IRIS, RIM, "x", base);
  const down = foldTravel(IRIS, RIM, "y", base);
  assert.ok(Number.isFinite(across) && across > 0, `the horizontal fold came back at ${across}`);
  assert.ok(Number.isFinite(down) && down > 0, `the vertical fold came back at ${down}`);

  // The sweep stops at 0.6 for a reason, and the block below it is the reason.
  for (const follow of [0.2, 0.4, 0.6]) {
    const lid: Lid = { fade: 0, follow, reach: 2 };
    // Relative, and on the ratio rather than on the fold itself, because the
    // fold is a UV length whose absolute size means nothing here. The search
    // shrinks its window 32-fold on each of 8 passes, so the located maximum is
    // good to 5e-13 on these fixtures, measured. 1e-9 sits three orders above
    // that floor and seven below the 7.6e-2 miss the model shows when the reach
    // is too narrow, so it can neither flake nor pass a broken blend.
    const got = foldTravel(IRIS, RIM, "y", lid) / down;
    const want = 1 / (1 - follow);
    assert.ok(
      Math.abs(got / want - 1) < 1e-9,
      `follow ${follow}: the vertical fold moved out ${got} times, not ${want}`,
    );
    // Exactly, not approximately. The horizontal offset is gaze.x * g and the
    // lid blend never reaches it, so a horizontal fold that shifts by any
    // amount at all means the blend has escaped onto the one axis every plate
    // is tuned right up against.
    assert.equal(
      foldTravel(IRIS, RIM, "x", lid),
      across,
      `follow ${follow}: the horizontal fold moved`,
    );
  }

  // The reciprocal is a ceiling the outer band has to be wide enough to pay
  // for, not an identity. The follow is shed a second time across rim to
  // rim * reach, and once that slope is the steeper of the two it binds first:
  // at this reach a follow of 0.8 lands at 3.03 times rather than 5, which is
  // why the sweep above stops at 0.6. Bounded on both sides rather than pinned
  // to 3.03, because the point is which band binds and not the digits.
  //
  // The upper bound is the one that matters to a face. Reading a fold as wider
  // than it is hands a plate headroom that is not there, and headroom that is
  // not there is a pupil that doubles back over its own sclera.
  const strained = foldTravel(IRIS, RIM, "y", { fade: 0, follow: 0.8, reach: 2 }) / down;
  assert.ok(strained > 1, `a lid that follows should still move the fold out, not to ${strained}`);
  assert.ok(
    strained < 1 / (1 - 0.8),
    `the outer band should bind before the reciprocal, but the fold reached ${strained}`,
  );
});
